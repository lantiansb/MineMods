import { builtinParticle, builtinSound } from "../common/builtin"
import type { Builtin } from "../builtin"
import type { Ability, Hitbox } from "../entity-runtime"
import { hasHitboxCombat } from "../hitbox-combat"

const single = (value: number) => `${value}f`

/** Opt-in owner methods. A player's complete vanilla attack still runs against the living owner. */
export function hitboxCombatSource(hitbox: Hitbox | null | undefined, abilities: readonly Ability[], boss: boolean, builtin?: Builtin, stances?: import("../entity-runtime").Stances) {
  if (!hasHitboxCombat(hitbox, abilities, stances)) return null
  const parts = hitbox!.parts!
  const contacts = parts.flatMap((part, index) => (part.contact ?? []).map((contact) => ({ ...contact, part: index, index: abilities.findIndex((ability) => ability.id === contact.ability) })))
  const fields = `    // The part of a redirected melee attack; consumed by hurt before any nested attack can reuse it.
    private int hitboxAttackIndex = -1;
${contacts.length ? `    private int hitboxContactSerial = -1;
    private final java.util.Set<java.util.UUID> hitboxContactStruck = new java.util.HashSet<>();
` : ""}`
  const stanceScales = (name: string, fallback: string) => {
    const rows = stances?.list.flatMap((row, index) => {
      const scale = row.part_scales?.find(entry => entry.part === name)
      return scale ? [`case ${index} -> ${single(scale.damage_scale)};`] : []
    })
    return rows?.length ? `switch (stanceIndex()) { ${rows.join(" ")} default -> ${fallback}; }` : fallback
  }
  const methods = `    @Override public void hitboxAttack(int index, net.minecraft.world.entity.player.Player player) {
        if (!isAlive()) return;
        int previous = hitboxAttackIndex;
        hitboxAttackIndex = index;
        try { player.attack(this); }
        finally { hitboxAttackIndex = previous; }
    }

    @Override public boolean hitboxHurt(int index, net.minecraft.world.damagesource.DamageSource source, float amount) {
        int previous = hitboxAttackIndex;
        hitboxAttackIndex = index;
        try { return hurt(source, amount); }
        finally { hitboxAttackIndex = previous; }
    }

    private float hitboxDamage(int index, float amount) {
        if (index < 0 || index >= hitboxParts.length || amount <= 0) return amount;
        float scale = switch (index) {
${parts.map((part, index) => `            case ${index} -> ${stanceScales(part.name, boss && part.phase_scales?.length ? `switch (bossPhase()) { ${part.phase_scales.map((entry) => `case ${entry.phase} -> ${single(entry.damage_scale)};`).join(" ")} default -> ${single(part.damage_scale ?? 1)}; }` : single(part.damage_scale ?? 1))};`).join("\n")}
            default -> 1f;
        };
        if (level() instanceof net.minecraft.server.level.ServerLevel server && hitboxParts[index] != null) {
            net.minecraft.world.entity.Entity part = hitboxParts[index];
            if (scale == 0f || scale > 1f) {
                ${builtin?.immune_hit?.particle==="none" || builtin?.weak_hit?.particle==="none" ? `if (scale == 0f ? ${builtin?.immune_hit?.particle!=="none"} : ${builtin?.weak_hit?.particle!=="none"}) ` : ""}server.sendParticles(scale == 0f ? ${builtinParticle(!!builtin?.immune_hit?.particle,"this","immune_hit","net.minecraft.core.particles.ParticleTypes.ELECTRIC_SPARK")} : ${builtinParticle(!!builtin?.weak_hit?.particle,"this","weak_hit","net.minecraft.core.particles.ParticleTypes.CRIT")}, part.getX(), part.getY() + part.getBbHeight() / 2.0, part.getZ(), 8, part.getBbWidth() / 4.0, part.getBbHeight() / 4.0, part.getBbWidth() / 4.0, 0.05);
                if (scale == 0f) ${builtin?.immune_hit?.sound==="none" ? "{} else if (false) " : ""}server.playSound(null, part.blockPosition(), ${builtinSound(!!builtin?.immune_hit?.sound,"this","immune_hit","net.minecraft.sounds.SoundEvents.ANVIL_LAND","block.anvil.land")}, net.minecraft.sounds.SoundSource.HOSTILE, 0.5f, 1.6f);
                ${builtin?.weak_hit?.sound ? `else ${builtin.weak_hit.sound==="none" ? "if (false) " : ""}server.playSound(null, part.blockPosition(), ${builtinSound(true,"this","weak_hit","","entity.player.attack.crit")}, net.minecraft.sounds.SoundSource.HOSTILE, 0.7f, 1f);` : `else switch (index) {
${parts.flatMap((part, index) => part.weakpoint_sound ? [`                    case ${index} -> server.playSound(null, part.blockPosition(), net.minecraft.sounds.SoundEvents.${part.weakpoint_sound === "entity.player.attack.crit" ? "PLAYER_ATTACK_CRIT" : "ANVIL_LAND"}, net.minecraft.sounds.SoundSource.HOSTILE, 0.7f, 1f);`] : []).join("\n")}
                    default -> { }
                }`}
            }
        }
        return amount * scale;
    }

${contacts.length ? `    /** Called after placing the parts; one ability serial shares its struck players across every part and time window. */
    private void hitboxContact() {
        if (hitboxContactSerial != abilitySerial) {
            hitboxContactSerial = abilitySerial;
            hitboxContactStruck.clear();
        }
        if (!isAlive() || abilityIndex < 0 || abilityTick < 0${boss ? " || bossState() != BOSS_FIGHT" : ""}) return;
${contacts.map((contact) => `        if (abilityIndex == ${contact.index} && abilityTick >= ${Math.round((contact.from ?? 0) * 20)} && abilityTick < ${Math.round((contact.to ?? abilities[contact.index]!.length) * 20)} && hitboxParts[${contact.part}] != null) {
            for (net.minecraft.world.entity.player.Player player : level().getEntitiesOfClass(net.minecraft.world.entity.player.Player.class, hitboxParts[${contact.part}].getBoundingBox(), player -> player.isAlive() && !player.isSpectator() && !player.isCreative())) {
                if (!hitboxContactStruck.add(player.getUUID())) continue;
                if (player.hurt(damageSources().mobAttack(this), ${single(contact.damage)}${boss ? " * bossDamageScale()" : ""})) player.knockback(${single(contact.knockback)}, getX() - player.getX(), getZ() - player.getZ());
            }
        }`).join("\n")}
    }

` : ""}`
  const head = `        if (hitboxAttackIndex >= 0) {
            int part = hitboxAttackIndex;
            hitboxAttackIndex = -1;
            amount = hitboxDamage(part, amount);
            if (amount <= 0) return false;
        }
`
  return {
    fields, methods, tick: contacts.length ? "\n        hitboxContact();" : "",
    hurt(source: string) {
      if (source.includes("return combatHurt(source, amount);")) return source
      const signature = "    @Override public boolean hurt(DamageSource source, float amount) {\n"
      if (source.includes(signature)) return source.replace(signature, signature + head)
      const fully = "    @Override public boolean hurt(net.minecraft.world.damagesource.DamageSource source, float amount) {\n"
      return source.replace("    @Override public float[][] hitboxParts()", `${fully}${head}        return super.hurt(source, amount);\n    }\n\n    @Override public float[][] hitboxParts()`)
    },
  }
}
