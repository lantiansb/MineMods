import { IMPACT_FX, impactSlots, type ImpactFx, type ImpactSlot } from "../impact-fx"
import { shakeTicks } from "../boss-look-words"
import type { SoundRef } from "../sound"
import { variedPitch } from "../sound"
import { PARTICLE_RUNTIME } from "../common/particles"
import { BOSS_RUNTIME } from "./boss-runtime"

/**
 * r29 撞上那一刻 in the generated creature: one method, `abilityImpact(slot, at)`, that plays the sound, sends the particles and shakes the screens of one
 * moment (numbered as `impactSlots` numbers them) at the place it is given, and the places themselves: the middle of its front where it meets a wall
 * (`abilityImpactFront`) and the point of the other's box nearest to its own middle where it meets a living thing (`abilityImpactOn`). A creature with no
 * such moment gets none of it, so it is generated as it always was.
 */
const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const single = (value: number) => `${real(value)}f`

type Played = { event: string; source: string }
export type ImpactJava = { slots: ImpactSlot[]; slot: (key: string) => number; fields: string; methods: string }

export function compileImpacts(input: { abilities: Parameters<typeof impactSlots>[0]; staggers: Parameters<typeof impactSlots>[1]; sound: (ref: SoundRef) => Played; touched: boolean }): ImpactJava {
  const slots = impactSlots(input.abilities, input.staggers)
  const slot = (key: string) => slots.findIndex((row) => row.key === key)
  if (!slots.length) return { slots, slot, fields: "", methods: "" }
  const statements = (fx: ImpactFx) => {
    const lines: string[] = []
    if (fx.sound !== undefined) {
      // Named in full: the creature imports `SoundEvents` only for the sounds of its abilities' moments.
      const played = input.sound(fx.sound)
      const event = played.event.replace(/^SoundEvents\./, "net.minecraft.sounds.SoundEvents.")
      lines.push(`level().playSound(null, at.x, at.y, at.z, ${event}, ${played.source}, ${single(fx.volume ?? IMPACT_FX.volume)}, ${variedPitch(single(fx.pitch ?? IMPACT_FX.pitch), undefined, "getRandom()")});`)
    }
    const server: string[] = []
    const particle = fx.particle
    if (particle !== undefined) {
      const spread = real(fx.spread ?? IMPACT_FX.spread)
      const send = (type: string) => `world.sendParticles(${type}, at.x, at.y, at.z, ${fx.count ?? IMPACT_FX.count}, ${spread}, ${spread}, ${spread}, 0.02);`
      if (typeof particle === "string") server.push(send(`net.minecraft.core.particles.ParticleTypes.${particle.toUpperCase()}`))
      else if ("asset" in particle)
        server.push(`{ var type = ${PARTICLE_RUNTIME.table}.byAsset(${JSON.stringify(particle.asset)}); if (type != null && ${PARTICLE_RUNTIME.table}.registered(type)) ${send("type")} }`)
      else throw new Error(`撞上那一刻的粒子别名「${particle.alias}」没有解析。`)
    }
    if (fx.shake) server.push(`${BOSS_RUNTIME.shake}.send(world, at, ${single(fx.shake.strength)}, ${single(fx.shake.radius)}, ${shakeTicks(fx.shake)});`)
    if (server.length) lines.push(`if (level() instanceof net.minecraft.server.level.ServerLevel world) {`, ...server.map((line) => `    ${line}`), "}")
    return lines
  }
  const fields = `    // ---- r29: per moment of impact, the start of the ability (its serial plus one) it was last shown in: a wall is met once a start, however long it is pushed against ----
    private final int[] abilityImpactShown = new int[${slots.length}];
`
  const methods = `    /** r29: what is heard, seen and felt the moment it runs into something (\`slot\`: which moment, as \`impactSlots\` numbers them), at \`at\`. Only on the server. */
    private void abilityImpact(int slot, net.minecraft.world.phys.Vec3 at) {
        if (level().isClientSide()) return;
        switch (slot) {
${slots.map((row, index) => `            case ${index} -> { // ${row.key}\n${statements(row.fx).map((line) => `                ${line}`).join("\n")}\n            }`).join("\n")}
            default -> { }
        }
    }

    /** r29: the same, at most once in one start of the running ability: a wall it is held against is met on every tick. */
    private void abilityImpactOnce(int slot, net.minecraft.world.phys.Vec3 at) {
        if (abilityImpactShown[slot] == abilitySerial + 1) return;
        abilityImpactShown[slot] = abilitySerial + 1;
        abilityImpact(slot, at);
    }

    /** r29: where it meets a wall going \`way\`: the middle of the side of its box that faces that way, halfway up. */
    private net.minecraft.world.phys.Vec3 abilityImpactFront(net.minecraft.world.phys.Vec3 way) {
        double flat = Math.sqrt(way.x * way.x + way.z * way.z);
        double reach = getBbWidth() * 0.5;
        return flat < 1.0e-6 ? position().add(0.0, getBbHeight() * 0.5, 0.0) : position().add(way.x / flat * reach, getBbHeight() * 0.5, way.z / flat * reach);
    }

    /** r29: where it meets \`other\`: the point of the other's box nearest to the middle of its own. */
    private net.minecraft.world.phys.Vec3 abilityImpactOn(net.minecraft.world.entity.Entity other) {
        var middle = getBoundingBox().getCenter();
        var box = other.getBoundingBox();
        return new net.minecraft.world.phys.Vec3(net.minecraft.util.Mth.clamp(middle.x, box.minX, box.maxX), net.minecraft.util.Mth.clamp(middle.y, box.minY, box.maxY), net.minecraft.util.Mth.clamp(middle.z, box.minZ, box.maxZ));
    }
${input.touched ? `
    /** r29: the living thing not of its own kind its body touches (as \`abilityTouching\` counts them), or null. */
    private net.minecraft.world.entity.LivingEntity abilityTouched() {
        var found = level().getEntitiesOfClass(net.minecraft.world.entity.LivingEntity.class, getBoundingBox().inflate(0.35),
            other -> other != this && other.isAlive() && other.getType() != getType() && !other.isSpectator() && !(other instanceof net.minecraft.world.entity.player.Player player && player.isCreative()));
        return found.isEmpty() ? null : found.get(0);
    }
` : ""}
`
  return { slots, slot, fields, methods }
}
