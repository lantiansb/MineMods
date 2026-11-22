import { rangedSound } from "../sound-range"
import { fixtureStatement } from "../fixture-events"
import { combatResult } from "../combat"
import { emitArguments } from "../common/emit"
import { groundFxSpec, GROUND_FX_RUNTIME } from "../common/ground-fx"
import { z } from "zod"
import { BOSS_SHOW_FEATURES, bossShowPlan, type BossShowName, type BossShowPlan, type BossShowStep } from "../boss-show"
import { shakeExtended } from "../boss-look-words"
import type { Boss } from "../entity-runtime"
import type { Place } from "../creature-abilities"
import { extendedEmit, resolvedAsset } from "../particle-emission"
import type { SoundRef } from "../sound"
import type { GenTarget } from "../platform/adapter"
import { PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"
import { BOSS_LOOK_RUNTIME } from "./boss-look"
import { BOSS_RUNTIME } from "./boss-runtime"
import { BOSS_WEATHER } from "./boss-weather"
import { EFFECT_RUNTIME } from "./effect"
import { PARTICLE_RUNTIME } from "../common/particles"

/**
 * Boss 能力 15 (多步演出) as what a generated mod carries:
 * - in the boss's own class (`bossShowSource`, joined in by `entity-boss.ts`): the steps of its wake-up and its death as tables, and the one method the server runs
 *   them by, tick by tick, in the order they are written; the server tells every player's game only the game time the wake-up began (a synced long), and each game
 *   reads off that time (and its own death's tick) which motion plays, which bones are hidden and how bright each glowing picture is, so a player who walks up in the
 *   middle of a show sees it where it is. The weather is handed to item 7's `StudioBossWeather` for the players of its bar, parts come off as item 10's, shakes are
 *   item 8's, effects and particles the abilities'.
 * - once for the mod (`compileBossShow`): `StudioBossShow`, what sets a structure down (a vanilla tree or rock grown the game's own way, or a list of blocks laid
 *   turned with the boss, only into air and plants, never when the world forbids mobs to change blocks: the game rule on Fabric, the loader's own mob-griefing
 *   question on a facade target, which claim mods answer), and a watcher a check or gameplay code may set to be told of every step as it runs.
 * Nothing of this is written for a boss without steps, so every other boss is the Java it always was. Every Minecraft name is Mojang's own, read with javap from the
 * three targets' class paths.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const float = (value: number) => `${real(value)}f`
const ints = (values: readonly number[]) => `{${values.join(", ")}}`
const floats = (values: readonly number[]) => `{${values.map(float).join(", ")}}`
const SHOWS = { intro: 1, death: 2 } as const
const UPPER = { intro: "INTRO", death: "DEATH" } as const

/** The class every boss reaches its structures and its watcher through. */
export const BOSS_SHOW_RUNTIME = { helper: "StudioBossShow" } as const

export type ShowDropPlace = { from: Place; rest: Place } | null

/**
 * The pieces of a boss's class its shows add (`compileBoss` puts each where it belongs); null for a boss without steps.
 * - `managed`: the bones something else of it sets before every frame (item 10's, a thrown part's): the shows hide them when they say so and otherwise leave them be.
 * - `places`: where each part a show drops comes off (`bossShowDropPlaces`), by the drop steps of each show in order.
 */
export function bossShowSource(input: {
  entity: string
  model: string
  modId: string
  stanceIndex?: (id: string) => number
  boss: Boss | null
  stances?: import("../entity-runtime").Stances
  sound: (ref: SoundRef) => { event: string; source: string }
  places: { intro: ShowDropPlace[]; death: ShowDropPlace[] }
  particleIndices?: Record<string,number>
  bone?: (name:string,clip:string | undefined,time:number)=>Place | null
  managed: readonly string[]
}) {
  const extra = input.stances?.list.flatMap(row => row.events ?? []) ?? []
  const phases = input.boss?.phases ?? []
  const plan = bossShowPlan(input.boss ?? { death: { seconds: 0 }, phases: [] }, extra.length > 0)
  if (!plan) return null
  const intro = Boolean(input.boss?.intro)
  const looks = plan.bones.length > 0
  const clips = plan.clips.length > 0
  const glows = plan.slots.length > 0
  const weathers = plan.weather.intro.length > 0 || plan.weather.death.length > 0
  const free = plan.bones.reduce((mask, bone, index) => (input.managed.includes(bone) ? mask : mask | (1 << index)), 0)
  const table = (show: BossShowName) => `
${
  looks
    ? `    private static final int[] BOSS_SHOW_${UPPER[show]}_LOOK_TICKS = ${ints(plan.look[show].map((row) => row.tick))};
    private static final int[] BOSS_SHOW_${UPPER[show]}_LOOK = ${ints(plan.look[show].map((row) => row.mask))};
`
    : ""
}${
  clips
    ? `    private static final int[] BOSS_SHOW_${UPPER[show]}_CLIP_TICKS = ${ints(plan.clip[show].map((row) => row.tick))};
    private static final int[] BOSS_SHOW_${UPPER[show]}_CLIPS = ${ints(plan.clip[show].map((row) => row.clip))};
`
    : ""
}${
  glows
    ? `    private static final int[] BOSS_SHOW_${UPPER[show]}_GLOW_TICKS = ${ints(plan.glow[show].map((row) => row.tick))};
    private static final int[] BOSS_SHOW_${UPPER[show]}_GLOW_SLOTS = ${ints(plan.glow[show].map((row) => row.slot))};
    private static final float[] BOSS_SHOW_${UPPER[show]}_GLOW_FROM = ${floats(plan.glow[show].map((row) => row.from))};
    private static final float[] BOSS_SHOW_${UPPER[show]}_GLOW_TO = ${floats(plan.glow[show].map((row) => row.to))};
    private static final int[] BOSS_SHOW_${UPPER[show]}_GLOW_SPANS = ${ints(plan.glow[show].map((row) => row.ticks))};
`
    : ""
}${
  weathers
    ? `    private static final int[] BOSS_SHOW_${UPPER[show]}_WEATHER_TICKS = ${ints(plan.weather[show].map((row) => row.tick))};
    private static final float[][] BOSS_SHOW_${UPPER[show]}_WEATHER = {${plan.weather[show].map((row) => floats([row.weather.rain ? 1 : 0, row.weather.thunder ? 1 : 0, row.weather.dark])).join(", ")}};
`
    : ""
}`.replace(/^\n/, "")
  const fields = `    // ---- Boss 能力 15: its wake-up and its death as timed steps (登场、死亡的多步演出); the server runs them, every player's game reads what they show off the time ----
    // The game time the wake-up's tick 0 is at, for every player's game (Long.MIN_VALUE: not begun). The death's time is its own deathTime.
    private static final EntityDataAccessor<Long> BOSS_SHOW_AT = SynchedEntityData.defineId(${input.entity}.class, EntityDataSerializers.LONG);
${
  looks
    ? `    // The bones its shows show, hide and drop (a bit each): hidden before the wake-up, in the fight after it, and from each tick of a show on; those nothing else of it sets before a frame.
    private static final String[] BOSS_SHOW_BONES = {${plan.bones.map((bone) => JSON.stringify(bone)).join(", ")}};
    private static final int BOSS_SHOW_ASLEEP = ${plan.asleep};
    private static final int BOSS_SHOW_AWAKE = ${plan.awake};
    private static final int BOSS_SHOW_FREE = ${free};
`
    : ""
}${
  clips
    ? `    // The motions its shows play, each held on its last frame until the next or the end of the show.
    private static final RawAnimation[] BOSS_SHOW_CLIPS = {${plan.clips.map((clip) => `RawAnimation.begin().thenPlayAndHold("animation.${input.model}.${clip}")`).join(", ")}};
    private int bossShowShown = -1;
`
    : ""
}${
  glows
    ? `    // Each glowing picture its shows fade: how bright before the wake-up and in the fight after it; per fade of a show, its tick, its picture, from, to and the ticks between.
    private static final float[] BOSS_SHOW_GLOW_ASLEEP = ${floats(plan.asleepGlow)};
    private static final float[] BOSS_SHOW_GLOW_AWAKE = ${floats(plan.awakeGlow)};
`
    : ""
}${weathers ? `    // Per stage of the fight: the wake-up's last weather lasts into it (no phase has a weather of its own by then). Per weather step of a show, its tick and {rain, thunder, darkness}.\n    private static final boolean[] BOSS_SHOW_CARRY = {${plan.carry.join(", ")}};\n` : ""}${intro ? table("intro") : ""}${table("death")}`
  const step = (show: BossShowName | "finish", index: number, entry: { step: BossShowStep; index: number; tick: number }, drops: { place: number }, finishClip?:string) => {
    const value = entry.step
    if (value.type === "particle" && extendedEmit(value)) {
      const nominal=Math.round(value.at*20), first=entry.tick, every=value.every_ticks??2
      const last=Math.max(first,Math.round((value.until??value.at)*20))
      const active=nominal===first ? "(tick - "+first+") % "+every+" == 0" : "(tick == "+first+" || (tick - "+nominal+") % "+every+" == 0)"
      const at=(tick:number)=>{
        const track=show === "finish" ? undefined : plan.steps[show].filter(r=>r.step.type==="clip" && r.tick<=tick).at(-1)
        const clip=track?.step.type==="clip" ? track.step.clip : show==="intro" ? input.boss?.intro?.clip ?? undefined : finishClip
        const p=value.bone ? input.bone?.(value.bone,clip,(tick-(track?.tick??0))/20) : null
        return (["forward","up","left"] as const).map(axis=>real(value[axis])+(p?.[axis] ? " + ("+real(p[axis])+") * getScale()" : "")).join(", ")
      }
      const samples=Array.from({length:1+Math.floor((last-nominal)/every)},(_,i)=>at(Math.max(first,nominal+i*every)))
      const changes=samples.some(sample=>sample!==samples[0])
      const origin=changes ? "switch ((tick - "+nominal+") / "+every+") { "+samples.map((sample,i)=>"case "+i+" -> bossShowPoint("+sample+");").join(" ")+" default -> position(); }" : "bossShowPoint("+samples[0]+")"
      return "            if (tick >= "+first+" && tick <= "+last+" && "+active+") {\n                var origin = "+origin+";\n                StudioEmit.send(world, origin, yBodyRot, "+emitArguments(value,input.particleIndices)+");\n                "+BOSS_SHOW_RUNTIME.helper+'.fired(this, "'+show+'", '+entry.index+', tick, "particle");\n            }'
    }
    const told = (what: string) => `${BOSS_SHOW_RUNTIME.helper}.fired(this, "${show}", ${entry.index}, tick, ${what});`
    const body = (() => {
      switch (value.type) {
        case "stance": return [`stanceRequest(${input.stanceIndex?.(value.to) ?? -1}, ${show === "death" ? 4 : 2});`, told(JSON.stringify(`stance ${value.to}`))]
        case "fixture": return [fixtureStatement(value, input.boss?.arena, show), told(JSON.stringify("fixture " + value.do))]
        case "clip":
          return [told(JSON.stringify(`clip ${value.clip}`))]
        case "glow":
          return [told(JSON.stringify(`glow${value.show?.length ? ` show ${value.show.join(",")}` : ""}${value.hide?.length ? ` hide ${value.hide.join(",")}` : ""}${value.glow ? ` fade ${value.glow.from}->${value.glow.to}` : ""}`))]
        case "weather":
          return [told(JSON.stringify(`weather rain=${value.weather.rain} thunder=${value.weather.thunder} dark=${value.weather.dark}`))]
        case "sound": {
          const played = input.sound(value.sound as SoundRef)
          return [`level().playSound(null, getX(), getY(), getZ(), ${rangedSound(played.event.startsWith("SoundEvents.") ? `net.minecraft.sounds.${played.event}` : played.event,value.range_blocks)}, ${played.source}, ${float(value.volume)}, ${float(value.pitch)});`, told('"sound"')]
        }
        case "particle":
          return [
            typeof value.particle === "string"
              ? `bossShowParticles(net.minecraft.core.particles.ParticleTypes.${value.particle.toUpperCase()}, ${real(value.forward)}, ${real(value.up)}, ${real(value.left)}, ${value.count}, ${real(typeof value.spread === "number" ? value.spread : 0)});`
              : `bossShowOwnParticles("${resolvedAsset(value.particle as Exclude<typeof value.particle, string>)}", ${real(value.forward)}, ${real(value.up)}, ${real(value.left)}, ${value.count}, ${real(typeof value.spread === "number" ? value.spread : 0)});`,
            told('"particle"'),
          ]
        case "effect":
          return [`bossShowEffect("${value.effect}", ${real(value.forward)}, ${real(value.up)}, ${real(value.left)}, ${value.count}, ${value.layout === "ring"}, ${real(value.spread)});`, told('"effect"')]
        case "shake": {
          const ticks = Math.max(1, Math.round(value.seconds * 20))
          const base = `world, position(), ${float(value.strength)}, ${float(value.radius)}, ${ticks}`
          return [`${BOSS_RUNTIME.shake}.send(${shakeExtended({ ...value, type: "shake" } as never) ? `${base}, ${float(value.roll ?? 0)}, ${float(value.fov ?? 0)}, ${value.falloff !== "none"}, ${float(value.frequency ?? 1)}` : base});`, told('"shake"')]
        }
        case "drop": {
          const place = input.places[show === "finish" ? "intro" : show][drops.place++] ?? null
          const at = (place ? [place.from.forward, place.from.up, place.from.left, place.rest.forward, place.rest.up, place.rest.left] : [0, 0, 0, 0, 0, 0]).map(float).join(", ")
          return [`${BOSS_LOOK_RUNTIME.entity}.drop(this, ${JSON.stringify(input.model)}, ${JSON.stringify(value.bone)}, ${Math.max(1, Math.round(value.stay_seconds * 20))}, ${at});`, told(JSON.stringify(`drop ${value.bone}`))]
        }
        case "place_structure": {
          const structure = value.structure
          const call =
            "feature" in structure
              ? `${BOSS_SHOW_RUNTIME.helper}.feature(this, "minecraft:${structure.feature}", ${structure.count}, ${real(structure.spread)}, ${real(value.forward)}, ${real(value.left)}, ${BOSS_SHOW_FEATURES[structure.feature].soil})`
              : `${BOSS_SHOW_RUNTIME.helper}.blocks(this, new String[] {${structure.blocks.map((block) => JSON.stringify(block.block.includes(":") ? block.block : `${input.modId}:${block.block}`)).join(", ")}}, new int[] {${structure.blocks.flatMap((block) => [block.forward, block.up, block.left]).join(", ")}}, ${real(value.forward)}, ${real(value.left)})`
          return [`int placed${index} = ${call};`, told(`"place_structure " + (placed${index} < 0 ? "skipped (mob griefing is off)" : "placed " + placed${index} + " blocks")`)]
        }
      }
    })()
    return `            if (tick == ${entry.tick}) {\n${body.map((line) => `                ${line}`).join("\n")}\n            }`
  }
  const runs = (show: BossShowName) => {
    const drops = { place: 0 }
    return plan.steps[show].map((entry, index) => step(show, index, entry, drops)).join("\n")
  }
  const sustainedFinish=phases.some(phase=>phase.finish?.some(s=>s.type==="particle" && s.until!==undefined))
  const finish = phases.flatMap((phase, phaseIndex) => !phase.finish ? [] : [` else if (show == ${3 + phaseIndex}) {\n${combatResult({ events: phase.finish }).events.map((value, index) => value.type === "ground" ? value.ground.map(fx => `            ${sustainedFinish ? "if (tick == 0) " : ""}${GROUND_FX_RUNTIME.entity}.start(world, ${groundFxSpec(fx)}, position(), yBodyRot, this, null, bossDamageScale(), null);`).join("\n") : step("finish", index, { step: { ...value, at: 0 }, index, tick: 0 }, { place: 0 }, phase.clip ?? undefined)).join("\n")}\n        }`]).join("")
  const stanceSteps = input.stances?.list.flatMap((row, stance) => !row.events ? [] : [` else if (show == ${100 + stance}) {
${row.events.map((value, index) => value.type === "ground" ? value.ground.map(fx => `            if (tick == 0) ${GROUND_FX_RUNTIME.entity}.start(world, ${groundFxSpec(fx)}, position(), yBodyRot, this, null, ${input.boss ? "bossDamageScale()" : "1.0f"}, null);`).join("\n") : step("finish", index, { step: { ...value, at: 0 }, index, tick: 0 }, { place: 0 }, row.change?.clip ?? undefined)).join("\n")}
        }`]).join("") ?? ""
  const events = [...plan.steps.intro.map(entry => entry.step), ...plan.steps.death.map(entry => entry.step), ...phases.flatMap(phase => phase.finish ?? []), ...extra]
  const kinds = new Set(events.map(event => event.type))
  const ownParticles = events.some(event => event.type === "particle" && typeof event.particle !== "string")
  const methods = `    /** Boss 能力 15: which show this game is in now: 1 its wake-up, 2 its death, 0 neither. */
    private int bossShowWhich() { return isDeadOrDying() ? 2 : ${input.boss ? "bossState() == BOSS_INTRO ? 1 : 0" : "0"}; }

    /** How far into show \`show\` it is in this game, in ticks (below 0: not begun): the wake-up from the game time the server says it began, the death by its own deathTime. */
    private float bossShowTime(int show, float partialTick) {
        if (show == 2) return deathTime + partialTick;
        long at = getEntityData().get(BOSS_SHOW_AT);
        return at == Long.MIN_VALUE ? -1.0f : (float) (level().getGameTime() - at) + partialTick;
    }

    /** The place of the last of \`ticks\` (in order) that has come by \`time\`; -1 for none. */
    private static int bossShowLast(int[] ticks, float time) {
        int found = -1;
        for (int index = 0; index < ticks.length && ticks[index] <= time; index++) found = index;
        return found;
    }

${
  intro
    ? `    /** A tick of the wake-up on the server: every player's game is told when it began, and the steps of this tick run. */
    private void bossShowIntro(int tick) {
        getEntityData().set(BOSS_SHOW_AT, level().getGameTime() - tick);
        bossShowStep(1, tick);
    }

`
    : ""
}    /** What the steps of show \`show\` (1 the wake-up, 2 the death) at tick \`tick\` do on the server, in the order written; each is told to the watcher (${BOSS_SHOW_RUNTIME.helper}). */
    private void bossShowStep(int show, int tick) {
        if (!(level() instanceof net.minecraft.server.level.ServerLevel world)) return;
        if (show == 1) {
${intro ? runs("intro") : ""}
        } else if (show == 2) {
${runs("death")}
        }${finish}${stanceSteps}
    }

${
  kinds.has("particle") || kinds.has("effect")
    ? `    /** A place \`forward\`, \`up\` and \`left\` of its feet in its own terms (the way its body faces), in blocks. */
    private net.minecraft.world.phys.Vec3 bossShowPoint(double forward, double up, double left) {
        float turn = yBodyRot * Mth.DEG_TO_RAD;
        return new net.minecraft.world.phys.Vec3(getX() - forward * Mth.sin(turn) + left * Mth.cos(turn), getY() + up, getZ() + forward * Mth.cos(turn) + left * Mth.sin(turn));
    }

`
    : ""
}${
  kinds.has("particle")
    ? `    private void bossShowParticles(net.minecraft.core.particles.ParticleOptions particle, double forward, double up, double left, int count, double spread) {
        if (!(level() instanceof net.minecraft.server.level.ServerLevel world)) return;
        net.minecraft.world.phys.Vec3 at = bossShowPoint(forward, up, left);
        world.sendParticles(particle, at.x, at.y, at.z, count, spread, spread, spread, 0.02);
    }

${
  ownParticles
    ? `    /** One of this mod's own particles, by its asset id; only one the game has registered can be sent. */
    private void bossShowOwnParticles(String asset, double forward, double up, double left, int count, double spread) {
        net.minecraft.core.particles.SimpleParticleType type = ${PARTICLE_RUNTIME.table}.byAsset(asset);
        if (type != null && ${PARTICLE_RUNTIME.table}.registered(type)) bossShowParticles(type, forward, up, left, count, spread);
    }

`
    : ""
}`
    : ""
}${
  kinds.has("effect")
    ? `    /** Shows one of this mod's effects \`count\` times from a place of its feet: on a circle of radius \`spread\` (each turned to face outward) or in a row \`spread\` long ahead. */
    private void bossShowEffect(String id, double forward, double up, double left, int count, boolean ring, double spread) {
        for (int index = 0; index < count; index++) {
            double angle = ring && count > 1 ? index * 2.0 * Math.PI / count : 0.0;
            double ahead = forward + (ring && count > 1 ? spread * Math.cos(angle) : count > 1 ? spread * index / (count - 1) : 0.0);
            double side = left + (ring && count > 1 ? spread * Math.sin(angle) : 0.0);
            ${EFFECT_RUNTIME.table}.spawn(id, level(), bossShowPoint(ahead, up, side), yBodyRot - (float) Math.toDegrees(angle), this, getTarget());
        }
    }

`
    : ""
}${
  looks
    ? `    /** The bones its shows change (read by its renderer, a bit each in \`bossShowHidden\`), and those nothing else of it sets before a frame. */
    public String[] bossShowBones() { return BOSS_SHOW_BONES; }

    public int bossShowFree() { return BOSS_SHOW_FREE; }

    /** The bones its shows hide now, in this game: before the wake-up, through it step by step, in the fight as it left them, and through the death. */
    public int bossShowHidden() {
        int show = bossShowWhich();
        if (show == 2) {
            int at = bossShowLast(BOSS_SHOW_DEATH_LOOK_TICKS, bossShowTime(2, 0.0f));
            return at < 0 ? BOSS_SHOW_AWAKE : BOSS_SHOW_DEATH_LOOK[at];
        }
${
  intro
    ? `        if (show == 1) {
            int at = bossShowLast(BOSS_SHOW_INTRO_LOOK_TICKS, bossShowTime(1, 0.0f));
            return at < 0 ? BOSS_SHOW_ASLEEP : BOSS_SHOW_INTRO_LOOK[at];
        }
`
    : ""
}        return bossState() == BOSS_DORMANT ? BOSS_SHOW_ASLEEP : BOSS_SHOW_AWAKE;
    }

`
    : ""
}${
  glows
    ? `    /** How bright glowing picture \`slot\` of its shows is now, 0 to 1, in this game. */
    public float bossShowGlow(int slot, float partialTick) {
        int show = bossShowWhich();
        float level = bossState() == BOSS_DORMANT && show == 0 ? BOSS_SHOW_GLOW_ASLEEP[slot] : BOSS_SHOW_GLOW_AWAKE[slot];
${intro ? "        if (show == 1) level = bossShowFade(BOSS_SHOW_INTRO_GLOW_TICKS, BOSS_SHOW_INTRO_GLOW_SLOTS, BOSS_SHOW_INTRO_GLOW_FROM, BOSS_SHOW_INTRO_GLOW_TO, BOSS_SHOW_INTRO_GLOW_SPANS, slot, bossShowTime(1, partialTick), BOSS_SHOW_GLOW_ASLEEP[slot]);\n" : ""}        if (show == 2) level = bossShowFade(BOSS_SHOW_DEATH_GLOW_TICKS, BOSS_SHOW_DEATH_GLOW_SLOTS, BOSS_SHOW_DEATH_GLOW_FROM, BOSS_SHOW_DEATH_GLOW_TO, BOSS_SHOW_DEATH_GLOW_SPANS, slot, bossShowTime(2, partialTick), level);
        return level;
    }

    /** A picture's brightness at \`time\` of a show: its last fade by then, as far through as it is; \`before\` when none has come. */
    private static float bossShowFade(int[] ticks, int[] slots, float[] from, float[] to, int[] spans, int slot, float time, float before) {
        float level = before;
        for (int index = 0; index < ticks.length && ticks[index] <= time; index++) {
            if (slots[index] != slot) continue;
            float done = spans[index] <= 0 ? 1.0f : Mth.clamp((time - ticks[index]) / spans[index], 0.0f, 1.0f);
            level = Mth.lerp(done, from[index], to[index]);
        }
        return level;
    }

`
    : ""
}${
  clips
    ? `    /** The clip step of the show running now that has come last (the show times 1024 and its place), -1 for none: what its own controller plays. */
    private int bossShowClipStep() {
        int show = bossShowWhich();
        if (show == 0) return -1;
        int at = bossShowLast(show == 1 ? ${intro ? "BOSS_SHOW_INTRO_CLIP_TICKS" : "new int[0]"} : BOSS_SHOW_DEATH_CLIP_TICKS, bossShowTime(show, 0.0f));
        return at < 0 ? -1 : show * 1024 + at;
    }

`
    : ""
}${
  weathers
    ? `    /** The weather its shows give the players of its bar now (null: none of theirs): the wake-up's up to now, the death's, and in the fight the wake-up's last while no phase has one. */
    private float[] bossShowWeather() {
        if (isDeadOrDying()) {
            int at = bossShowLast(BOSS_SHOW_DEATH_WEATHER_TICKS, deathTime);
            return at < 0 ? null : BOSS_SHOW_DEATH_WEATHER[at];
        }
        int state = bossState();
${
  intro
    ? `        if (state == BOSS_INTRO) {
            int at = bossShowLast(BOSS_SHOW_INTRO_WEATHER_TICKS, BOSS_WAKE_TICKS - bossTimer);
            return at < 0 ? null : BOSS_SHOW_INTRO_WEATHER[at];
        }
        if ((state == BOSS_FIGHT || state == BOSS_CHANGE) && BOSS_SHOW_INTRO_WEATHER.length > 0 && BOSS_SHOW_CARRY[Math.min(bossPhase(), BOSS_SHOW_CARRY.length - 1)]) return BOSS_SHOW_INTRO_WEATHER[BOSS_SHOW_INTRO_WEATHER.length - 1];
`
    : ""
}        return null;
    }

`
    : ""
}`
  return {
    fields,
    methods,
    /** The statement that registers its synced value, beside the boss's own in `defineSynchedData`. */
    tracker: "        builder.define(BOSS_SHOW_AT, Long.MIN_VALUE);\n",
    /** Run as it wakes: the wake-up's time is not begun until the first tick it counts. */
    wake: intro ? "        getEntityData().set(BOSS_SHOW_AT, Long.MIN_VALUE);\n" : "",
    /** What counts a tick of the wake-up and ends it (in place of the plain `if (--bossTimer <= 0) …`), `indent` deep. */
    introTick: (begin: string, indent: string) => `${indent}bossTimer--;\n${indent}bossShowIntro(BOSS_WAKE_TICKS - bossTimer);\n${indent}if (bossTimer <= 0) ${begin}\n`,
    /** Run on every tick of its death on the server, before it is removed. */
    deathTick: "        bossShowStep(2, deathTime);\n",
    /** Run on every server tick: the weather of its shows. */
    weatherTick: weathers ? `        // Boss 能力 15: the weather of its wake-up and its death to the players of its bar (and the wake-up's last into the fight while no phase has its own).\n        ${BOSS_WEATHER.server}.fight(this, bossBar.getPlayers(), bossShowWeather());\n` : "",
    controller: clips
      ? `        // Boss 能力 15: the motions its wake-up's and its death's steps play, each from its tick, read off the show's time by every player's game.
        controllers.add(new AnimationController<>(this, "boss_show", 0, state -> {
            int step = bossShowClipStep();
            if (step < 0) {
                bossShowShown = -1;
                return PlayState.STOP;
            }
            if (step != bossShowShown) {
                bossShowShown = step;
                state.getController().forceAnimationReset();
            }
            return state.setAndContinue(BOSS_SHOW_CLIPS[(step >> 10 == 1 ? ${intro ? "BOSS_SHOW_INTRO_CLIPS" : "new int[0]"} : BOSS_SHOW_DEATH_CLIPS)[step & 1023]]);
        }));
`
      : "",
    /** Whether a show plays motions of its own in the wake-up, in the death (the boss's own wake-up motion and the death motion give way to them). */
    clips: { intro: plan.clip.intro.length > 0, death: plan.clip.death.length > 0, any: clips },
    /** What its renderer does before each frame: the bones its shows hide now are hidden, the free ones shown again. */
    render: looks
      ? `        // Boss 能力 15: the bones its wake-up and its death hide now are hidden (those nothing else sets are shown again when they do not).
        String[] showBones = creature.bossShowBones();
        int showHidden = creature.bossShowHidden();
        int showFree = creature.bossShowFree();
        for (int index = 0; index < showBones.length; index++) {
            boolean off = (showHidden & (1 << index)) != 0;
            if (off || (showFree & (1 << index)) != 0) model.getBone(showBones[index]).ifPresent(bone -> bone.setHidden(off));
        }
`
      : "",
    /** The glowing layer its renderer adds, given where each picture is (`glowFile`); empty without glows. */
    layer: (glowFile: (slot: BossShowPlan["slots"][number], index: number) => string) =>
      glows
        ? `\n        // Boss 能力 15: the glowing pictures its wake-up and its death fade, each as bright as the show says now.\n        addRenderLayer(new ${BOSS_LOOK_RUNTIME.glow}<>(this, new ResourceLocation[] {${plan.slots.map((slot, index) => `ResourceLocation.fromNamespaceAndPath("${input.modId}", "${glowFile(slot, index)}")`).join(", ")}}, (creature, slot, partialTick) -> creature.bossShowGlow(slot, partialTick)));`
        : "",
    /** The model's own glowing parts are its shows' to fade: GeckoLib's always-on glow layer is then not added. */
    glowsOwn: plan.slots.includes("emissive"),
    plan,
  }
}
export type BossShowSource = NonNullable<ReturnType<typeof bossShowSource>>

/** Where a glowing picture of a creature's shows is in the mod's resources: the model's own glow mask, or the asset's picture written beside its texture. */
export const bossShowGlowFile = (creature: string, slot: BossShowPlan["slots"][number], index: number) => (slot === "emissive" ? `textures/entity/${creature}_glowmask.png` : `textures/entity/${creature}_show_glow_${index}.png`)

/** What the mod adds for its bosses' shows besides their own classes: which of the shared runtimes they need. */
export function bossShowNeeds(bosses: readonly (Boss | null | undefined)[], extra: Readonly<NonNullable<Boss["phases"][number]["finish"]>> = []) {
  const steps = [...bosses.flatMap((boss) => [...(boss?.intro?.steps ?? []), ...(boss?.death.steps ?? []), ...(boss?.phases.flatMap(phase => phase.finish ?? []) ?? [])]), ...extra]
  return {
    any: steps.length > 0,
    shake: steps.some((step) => step.type === "shake"),
    shakeMore: steps.some((step) => step.type === "shake" && shakeExtended({ ...step, type: "shake" } as never)),
    drop: steps.some((step) => step.type === "drop"),
    glow: steps.some((step) => step.type === "glow" && step.glow !== undefined),
    weather: steps.some((step) => step.type === "weather"),
  }
}

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
})

/**
 * The one class of the mod every boss's shows set their structures down and tell their watcher through. Plain game code but for one question: whether the world
 * lets this mob change blocks (Fabric: the game rule; a facade target: `StudioPlatform.mobGriefing`, the loader's own event, which claim mods answer).
 */
export function compileBossShow(value: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const facade = target.loader.facade
  const source = `package ${input.packageName}.entity;

${facade ? `import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};\n` : ""}import java.util.function.Consumer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.BlockTags;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
${facade ? "" : "import net.minecraft.world.level.GameRules;\n"}import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;

/**
 * Generated by MineMods Studio (Boss 能力 15): what a boss's wake-up and death set down in the world, and who is told of their steps. Only air and plants (grass,
 * flowers, saplings, snow) are ever replaced, never a block of anybody's building, and nothing at all when the world does not let this mob change blocks.
 */
public final class ${BOSS_SHOW_RUNTIME.helper} {
    /** Told of every step a boss's show runs, as one line ("<creature> <show> step <n> tick <t> <what>"); null: nobody listens. For checks and gameplay code. */
    public static volatile Consumer<String> watcher;

    private ${BOSS_SHOW_RUNTIME.helper}() {}

    public static void fired(Entity boss, String show, int step, int tick, String what) {
        Consumer<String> told = watcher;
        if (told != null) told.accept(BuiltInRegistries.ENTITY_TYPE.getKey(boss.getType()) + " " + show + " step " + step + " tick " + tick + " " + what);
    }

    /** Whether the world lets this boss change blocks: ${facade ? "the loader's own mob-griefing question (the game rule, and whatever a claim mod says)" : "the game rule mobGriefing"}. */
    public static boolean griefs(Entity boss) {
        return ${facade ? `${PLATFORM_CLASS}.mobGriefing(boss)` : "boss.level() instanceof ServerLevel world && world.getGameRules().getBoolean(GameRules.RULE_MOBGRIEFING)"};
    }

    /** Air, or a plant that gives way (grass, flowers, saplings, snow), with no water or lava in it. */
    static boolean free(BlockState state) {
        return state.isAir() || state.getFluidState().isEmpty() && (state.canBeReplaced() || state.is(BlockTags.SMALL_FLOWERS) || state.is(BlockTags.SAPLINGS));
    }

    /** Where \`forward\` and \`left\` of the boss's feet are, in its own terms (the way its body faces). */
    private static double[] point(LivingEntity boss, double forward, double left) {
        float turn = boss.yBodyRot * Mth.DEG_TO_RAD;
        return new double[] {boss.getX() - forward * Mth.sin(turn) + left * Mth.cos(turn), boss.getZ() + forward * Mth.cos(turn) + left * Mth.sin(turn)};
    }

    /**
     * Lays blocks (\`blocks\` by id, each at whole \`offsets\` {forward, up, left}) round the block \`forward\`, \`left\` of the boss's feet, turned with the boss to the nearest quarter.
     * Only where there is air or a plant. The blocks laid, or -1 when the world does not let it.
     */
    public static int blocks(LivingEntity boss, String[] blocks, int[] offsets, double forward, double left) {
        if (!(boss.level() instanceof ServerLevel world) || !griefs(boss)) return -1;
        float quarter = Math.floorMod(Math.round(boss.yBodyRot / 90.0f), 4) * 90.0f * Mth.DEG_TO_RAD;
        int sin = Math.round(Mth.sin(quarter));
        int cos = Math.round(Mth.cos(quarter));
        double[] at = point(boss, forward, left);
        BlockPos origin = BlockPos.containing(at[0], boss.getY(), at[1]);
        int placed = 0;
        for (int index = 0; index < blocks.length; index++) {
            ResourceLocation id = ResourceLocation.tryParse(blocks[index]);
            if (id == null) continue;
            BlockState state = BuiltInRegistries.BLOCK.get(id).defaultBlockState();
            if (state.isAir()) continue;
            int ahead = offsets[index * 3];
            int side = offsets[index * 3 + 2];
            BlockPos here = origin.offset(-ahead * sin + side * cos, offsets[index * 3 + 1], ahead * cos + side * sin);
            if (!world.isLoaded(here) || !free(world.getBlockState(here))) continue;
            if (world.setBlock(here, state, Block.UPDATE_ALL)) placed++;
        }
        return placed;
    }

    /**
     * Grows \`count\` of the game's own trees or rocks (configured feature \`feature\`) scattered within \`spread\` of the place \`forward\`, \`left\` of the boss's feet, each on the
     * ground found there (a tree, \`soil\`, only on dirt or grass: the game turns the block under a tree to dirt); the game's own growing takes only air, leaves
     * and plants. The blocks they added, or -1 when the world does not let it.
     */
    public static int feature(LivingEntity boss, String feature, int count, double spread, double forward, double left, boolean soil) {
        if (!(boss.level() instanceof ServerLevel world) || !griefs(boss)) return -1;
        ResourceLocation id = ResourceLocation.tryParse(feature);
        if (id == null) return 0;
        var found = world.registryAccess().registryOrThrow(Registries.CONFIGURED_FEATURE).getHolder(ResourceKey.create(Registries.CONFIGURED_FEATURE, id));
        if (found.isEmpty()) return 0;
        ConfiguredFeature<?, ?> grown = found.get().value();
        double[] at = point(boss, forward, left);
        float turn = boss.yBodyRot * Mth.DEG_TO_RAD;
        int placed = 0;
        // Where each one grew, so the next keeps \`gap\` from it (half the spread, at most 3 blocks) and they do not crowd into one.
        java.util.List<BlockPos> grownAt = new java.util.ArrayList<>();
        double gap = Math.min(3.0, spread * 0.5);
        for (int index = 0; index < count; index++) {
            double far = count > 1 ? spread * Math.sqrt((index + 0.5) / count) : 0.0;
            // Where one cannot grow (no ground there, as on a ring of blocks an earlier step laid, or no room, or too near one grown), it is tried again a block
            // further out and turned round, still within \`spread\`, six times at most; when none of the six keeps the gap, once more without it.
            boolean done = false;
            for (int pass = 0; pass < 2 && !done; pass++) {
                for (int attempt = 0; attempt < 6 && !done; attempt++) {
                    double angle = index * 2.399963 + turn + attempt * 2.399963;
                    double distance = Math.min(Math.max(spread, far), far + attempt);
                    BlockPos ground = ground(world, BlockPos.containing(at[0] + distance * Math.cos(angle), boss.getY(), at[1] + distance * Math.sin(angle)), soil);
                    if (ground == null || (pass == 0 && crowded(grownAt, ground, gap))) continue;
                    int before = solid(world, ground);
                    if (grown.place(world, world.getChunkSource().getGenerator(), world.getRandom(), ground)) {
                        placed += Math.max(0, solid(world, ground) - before);
                        grownAt.add(ground);
                        done = true;
                    }
                }
            }
        }
        return placed;
    }

    /** Whether a place is nearer than \`gap\` (across the ground) to one already grown. */
    static boolean crowded(java.util.List<BlockPos> grown, BlockPos at, double gap) {
        for (BlockPos other : grown) {
            double dx = other.getX() - at.getX(), dz = other.getZ() - at.getZ();
            if (dx * dx + dz * dz < gap * gap) return true;
        }
        return false;
    }

    /** The first place with room above solid ground, from four blocks above \`at\` to eight below (for \`soil\`, only dirt or grass will do); null when there is none. */
    static BlockPos ground(ServerLevel world, BlockPos at, boolean soil) {
        for (int up = 4; up >= -8; up--) {
            BlockPos here = at.above(up);
            BlockPos under = here.below();
            if (!world.isLoaded(here)) return null;
            BlockState below = world.getBlockState(under);
            if (free(world.getBlockState(here)) && !free(below) && below.isFaceSturdy(world, under, Direction.UP)) return soil && !below.is(BlockTags.DIRT) ? null : here;
        }
        return null;
    }

    /** How many blocks round a place (six to each side, sixteen up) are neither air nor plants: what a tree grown there adds is counted by. */
    static int solid(ServerLevel world, BlockPos at) {
        int count = 0;
        for (BlockPos pos : BlockPos.betweenClosed(at.offset(-6, 0, -6), at.offset(6, 16, 6))) if (!free(world.getBlockState(pos))) count++;
        return count;
    }
}
`
  const file = `src/main/java/${input.packageName.replaceAll(".", "/")}/entity/${BOSS_SHOW_RUNTIME.helper}.java`
  return { files: { [file]: facade ? target.version.rewriteJava(source) : source }, classes: [`${input.packageName.replaceAll(".", "/")}/entity/${BOSS_SHOW_RUNTIME.helper}.class`] }
}
