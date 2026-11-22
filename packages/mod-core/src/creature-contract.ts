import { soundLookup } from "./sound"
import { compileProjectEntity } from "./build-source"
import { CREATURE_BABY } from "./creature-capability"
import { BASELINE_GOALS } from "./creature-goals"
import { projectContentSource } from "./fabric/gameplay"
import { VANILLA_ITEM_NAMES } from "./fabric/content-vanilla"
import { GAMEPLAY_API, creatureName, gameplayThings, type GameplayDocument } from "./gameplay"
import { governedCreatures } from "./gameplay-references"
import { GOAL_BAND } from "./creature-goals"
import { GAMEPLAY_GENERATED_TITLE } from "./gameplay-words"
import { openProject } from "./project"
import { TICKS } from "./ability-words"
import { NEVER_PLAYED, creatureBindings, type CreatureBindings } from "./creature-abilities"
import { effectLookup } from "./effect-abilities"
import { EFFECT_RUNTIME } from "./fabric/effect"

/**
 * What the part of a mod that Studio generates guarantees about the creatures a gameplay works on, for
 * whoever reviews that gameplay: the reviewer is given the AI's code but not Studio's, and has taken a
 * true statement ("calling doHurtTarget plays the attack motion") for a missing one.
 *
 * Nothing here is remembered about the generator. Every sentence is said because of something found in
 * the Java and the loot table the build would write for this project right now (`compileProjectEntity`,
 * `projectContentSource`): a goal is listed because the generated `registerGoals` adds it, the attack motion
 * is promised because the generated `doHurtTarget` triggers it, and where the generated code does not do a
 * thing the sentence says it does not. A generator that changes changes the contract with it; one that
 * changes shape so that a reading no longer finds what it looks for yields a sentence that says so.
 */

/** The heading the contract carries wherever it is shown. */
export const CONTRACT_TITLE = GAMEPLAY_GENERATED_TITLE

/**
 * The vanilla goal classes the generator uses: what each does in a player's words, and the controls it
 * holds while it runs (read with javap from the 1.21.1 jar; two running goals cannot hold the same one).
 * A class not listed here is named as it is, so a new goal in the generator is never silently left out.
 */
const GOAL_WORDS: Record<string, { does: string; holds: string }> = {
  FloatGoal: { does: "掉进水里会往上游", holds: "JUMP" },
  MeleeAttackGoal: { does: "有目标时追上去，够得着就调用自己的 doHurtTarget 出手", holds: "MOVE、LOOK" },
  TemptGoal: { does: "跟着手里拿着小麦的玩家走", holds: "MOVE、LOOK" },
  WaterAvoidingRandomStrollGoal: { does: "没事的时候四处闲逛", holds: "MOVE" },
  LookAtPlayerGoal: { does: "看向走近的玩家", holds: "LOOK" },
  RandomLookAroundGoal: { does: "原地张望", holds: "MOVE、LOOK" },
  NearestAttackableTargetGoal: { does: "自己把看得见的玩家当成目标", holds: "TARGET" },
  // Flight and habits (10-12): the goals the generated class defines itself for them.
  GroundWanderGoal: { does: "没事的时候在地上闲逛（会飞的在天上时不走；有窝的不选窝外面的地方）", holds: "MOVE" },
  HabitAlertGoal: { does: "玩家第一次走近时停下、看着玩家、播一次警觉动作", holds: "MOVE、LOOK" },
  HabitEatGoal: { does: "捕到猎物以后站着吃、播进食动作（会飞的先落地）", holds: "MOVE、LOOK" },
  HabitHuntGoal: { does: "饿了又在活动时间里，去追最近的猎物、够得着就调用自己的 doHurtTarget", holds: "MOVE、LOOK" },
  HabitRestGoal: { does: "不在活动时间时回窝（有窝的话）、停下、播休息动作；有目标时不运行", holds: "MOVE、LOOK" },
  HabitReturnGoal: { does: "离窝超过半径时走（或飞）回来，直到离窝只剩半个半径", holds: "MOVE、LOOK" },
}

const NOT_READ = (what: string) => `这一版生成的代码里没有读到${what}，评审不能当它有。`

/** What one generated creature class and its loot table say, as facts. Pure reading of text. */
export function readGeneratedCreature(java: string, lootTable: string | null) {
  const breakStops = /cut \|= switch \(result\) \{([^}]+)\}/.exec(java)?.[1] ?? ""
  const breakFalls = /fall = switch \(result\) \{([^}]+)\}/.exec(java)?.[1] ?? ""
  const cutGroups = new Set([
    ...[...breakStops.matchAll(/case (\d+) -> true;/g)].map(match => match[1]),
    ...[...breakFalls.matchAll(/case (\d+) -> \d+;/g)].map(match => match[1]),
  ])
  const breaksByWindow = /int group = switch \(window\) \{([^}]+)\}/.exec(java)?.[1] ?? ""
  const cutWindows = new Set([...breaksByWindow.matchAll(/case (\d+) -> (\d+);/g)].filter(match => cutGroups.has(match[2])).map(match => match[1]))
  const cutAbilities = new Set([...java.matchAll(/if \(move == (\d+) && [^\n]+\) return (\d+);/g)].filter(match => cutWindows.has(match[2])).map(match => Number(match[1])))
  const goals = [...java.matchAll(/\b(goalSelector|targetSelector)\.addGoal\((\d+),\s*new\s+(\w+)/g)].map((found) => ({ target: found[1] === "targetSelector", priority: Number(found[2]), type: found[3]!, at: found.index }))
  const applied = java.indexOf(`${GAMEPLAY_API.content}.applyGoals(this, goalSelector, targetSelector)`)
  // Goals the generated class defines itself are read from their own bodies: which controls they take, whether they pick a player by themselves, whether they swing.
  const nearest = /Player runtimeNearestPlayer\(\) \{([\s\S]*?)\n    \}/.exec(java)?.[1] ?? null
  const inner = [...java.matchAll(/private final class (\w+) extends Goal \{([\s\S]*?)\n    \}\n/g)].map((found) => ({
    type: found[1]!,
    holds: (/setFlags\(EnumSet\.of\(([^)]*)\)\)/.exec(found[2]!)?.[1] ?? "").replaceAll("Flag.", "").split(",").map((value) => value.trim()).filter(Boolean),
    // The generated lookup returns null for a creature that is after nobody; otherwise the nearest player it can see who is not in creative.
    seeks: /target = runtimeNearestPlayer\(\);/.test(found[2]!) && nearest !== null && !/^\s*return null;\s*$/.test(nearest),
    wheat: nearest !== null && /Items\.WHEAT/.test(nearest),
    // The creature's document names what lures it (`tempt`): the lookup asks the class's own list instead of wheat.
    lured: nearest !== null && /isLure\(/.test(nearest),
    swings: /if \(true && runtimeAttackCooldown == 0 && isWithinMeleeAttackRange\(target\)\) \{\s*doHurtTarget\(target\);/.test(found[2]!),
    // G2: it goes after whatever target the creature has (set by a target goal or by gameplay code), and it starts abilities.
    chases: /target = getTarget\(\);[\s\S]*getNavigation\(\)\.moveTo\(/.test(found[2]!),
    starts: /startAbility\(target\)/.test(found[2]!),
    // The goal that gives it a target by itself: only while it has none, and whom it looks for.
    picks: !/if \(getTarget\(\) != null\) return false;[\s\S]*setTarget\(found\);/.test(found[2]!) ? null : /found = level\(\)\.getEntitiesOfClass\(Player\.class,[^;]*engageAllows\(player\) && hasLineOfSight\(player\)/.test(found[2]!) ? ("any_player" as const) : /LivingEntity attacker = getLastHurtByMob\(\);\s*found = [^;]*engageAllows\(attacker\) \? attacker : null;/.test(found[2]!) ? ("provoked" as const) : ("unread" as const),
  }))
  // Who it fights, when the class decides that in one place: the question it asks about a candidate, and the tick that lets a target go.
  const allows = /private boolean engageAllows\(LivingEntity candidate\) \{([\s\S]*?)\n    \}/.exec(java)?.[1] ?? null
  const keeps = /protected void customServerAiStep\(\) \{([\s\S]*?)\n    \}/.exec(java)?.[1] ?? ""
  const constant = (name: string) => ((found) => (found ? Number(found[1]) : null))(new RegExp(`${name} = ([\\d.]+)f?;`).exec(java))
  const numbers = (name: string) => (new RegExp(`${name} = \\{([^}]*)\\}`).exec(java)?.[1] ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  // Each ability's own method: the ticks on which it reaches for somebody (a shape checked, or something thrown), once per time it does.
  const steps = [...java.matchAll(/private void abilityStep(\d+)\(int tick\) \{\n([\s\S]*?)\n    \}\n/g)].map((found) =>
    found[2]!.split(/(?=^        if \(tick == \d+\) \{$)/m).flatMap((block) => Array.from({ length: (block.match(/abilityVictims\(|addFreshEntity\(shot\)/g) ?? []).length }, () => Number(/tick == (\d+)/.exec(block)?.[1]))),
  )
  // H3: the effects each ability's own method shows, with the tick and how many: read from the calls it makes, and counted only when the class really hands them on to the effect table.
  const spawns = new RegExp(`private void abilityEffect\\(String id,[\\s\\S]*?${EFFECT_RUNTIME.table}\\.spawn\\(id, level\\(\\), at,`).test(java)
  // J2: effects laid out along a hit's aim are counted only when the class really tilts the layout and hands the tilt on.
  const aimed = new RegExp(`private void abilityEffectAimed\\(String id, Vec3 origin, Vec3 aim,[\\s\\S]*?Vec3 rise = aim\\.cross\\(side\\);[\\s\\S]*?${EFFECT_RUNTIME.table}\\.spawn\\(id, level\\(\\), at, abilityYaw, tilt,`).test(java)
  const shows = [...java.matchAll(/private void abilityStep(\d+)\(int tick\) \{\n([\s\S]*?)\n    \}\n/g)].map((found) =>
    found[2]!.split(/(?=^        if \(tick == \d+\) \{$)/m).flatMap((block) => [...block.matchAll(/abilityEffect(Aimed)?\("([0-9a-f-]{36})",[^;]*?, (\d+), (?:true|false), [\d.]+\);/g)].flatMap((call) => (call[1] && !aimed ? [] : [{ tick: Number(/tick == (\d+)/.exec(block)?.[1]), effect: call[2]!, count: Number(call[3]), aimed: Boolean(call[1]) }]))),
  )
  // J2: the ticks on which each ability checks a beam or a cone that is kept level (it is handed the level direction, not the one toward the target).
  const levels = [...java.matchAll(/private void abilityStep(\d+)\(int tick\) \{\n([\s\S]*?)\n    \}\n/g)].map((found) =>
    found[2]!.split(/(?=^        if \(tick == \d+\) \{$)/m).flatMap((block) => (/abilityIn(?:Line|Cone)\(victim, abilityLevel\(\),/.test(block) && /private Vec3 abilityLevel\(\) \{[\s\S]*?new Vec3\(-Mth\.sin\(turn\), 0\.0, Mth\.cos\(turn\)\);/.test(java) ? [Number(/tick == (\d+)/.exec(block)?.[1])] : [])),
  )
  // The ticks on which each ability hands a moment to a gameplay's entry (`ProjectContent.runAbility`), and the entry's name: not a hit that reaches for anybody, so it is read apart.
  const handed = [...java.matchAll(/private void abilityStep(\d+)\(int tick\) \{\n([\s\S]*?)\n    \}\n/g)].map((found) =>
    found[2]!.split(/(?=^        if \(tick == \d+\) \{$)/m).flatMap((block) => [...block.matchAll(new RegExp(`${GAMEPLAY_API.content}\\.runAbility\\("([a-z][a-z0-9_]*)", this, abilityTarget\\);`, "g"))].map((call) => ({ tick: Number(/tick == (\d+)/.exec(block)?.[1]), action: call[1]! }))),
  )
  const starter = [...java.matchAll(/private final class (\w+) extends Goal \{([\s\S]*?)\n    \}\n/g)].find((found) => /startAbility\(target\)/.test(found[2]!))?.[1] ?? null
  const constants = Object.fromEntries([...java.matchAll(/private static final RawAnimation (\w+) = RawAnimation\.begin\(\)\.\w+\("animation\.[a-z0-9_]+\.(\w+)"/g)].map((found) => [found[1]!, found[2]!]))
  const shown = /new AnimationController<>\(this, "ability", 0,[\s\S]*?getEntityData\(\)\.get\(ABILITY\)[\s\S]*?state\.setAndContinue\(ABILITY_CLIPS\[\(shown & 255\) - 1\]\)/.test(java) && /builder\.define\(ABILITY, 0\)/.test(java)
  const abilityClips = [...(/ABILITY_CLIPS = \{([\s\S]*?)\n    \};/.exec(java)?.[1] ?? "").matchAll(/"animation\.[a-z0-9_]+\.(\w+)"/g)].map((found) => found[1]!)
  // boss runtime (10-12): the clips its controller plays for a wake-up and a change of phase, read from the constants it plays them from.
  const boss = /private final ServerBossEvent bossBar/.test(java)
  const bossClipNames = [...(/BOSS_CHANGE_CLIPS = \{([^;]*)\};/.exec(java)?.[1] ?? "").matchAll(/"animation\.[a-z0-9_]+\.(\w+)"/g)].map((found) => found[1]!)
  const bossPlays = boss && /new AnimationController<>\(this, "boss", 0,/.test(java) ? [...(constants.BOSS_INTRO_CLIP ? [constants.BOSS_INTRO_CLIP] : []), ...bossClipNames] : []
  const flier = /private static final EntityDataAccessor<Byte> FLIGHT = /.test(java) && /RawAnimation flying = flightClip\(\);\s*if \(flying != null\) return state\.setAndContinue\(flying\);/.test(java)
  const flightPlays = flier ? ["FLIGHT_TAKEOFF_CLIP", "FLIGHT_LAND_CLIP", "FLIGHT_FLY_CLIP", "FLIGHT_GLIDE_CLIP", "FLIGHT_HOVER_CLIP"].flatMap((name) => (constants[name] ? [constants[name]!] : [])) : []
  const habitPlays = /new AnimationController<>\(this, "habit", 0,[\s\S]*?state\.setAndContinue\(clip\)/.test(java) && /builder\.define\(HABIT, \(byte\) 0\)/.test(java) ? ["HABIT_REST_CLIP", "HABIT_EAT_CLIP", "HABIT_ALERT_CLIP"].flatMap((name) => (constants[name] ? [constants[name]!] : [])) : []
  const swing = /public boolean doHurtTarget\(Entity target\) \{([\s\S]*?)\n    \}/.exec(java)?.[1] ?? null
  // The motions gameplay code can ask it to play (`ProjectContent.playMotion`): counted only when the class answers to the call, starts each of them on a controller of its own and the call reaches that controller.
  const asked = /PLAYABLE_MOTIONS = java\.util\.Set\.of\(([^;]*)\);/.exec(java)?.[1] ?? ""
  const playable = new RegExp(`implements GeoEntity[^{]*${GAMEPLAY_API.content}\\.${GAMEPLAY_API.actor}`).test(java) && /if \(!isDeadOrDying\(\)\) triggerAnim\("motion", motion\);/.test(java)
    ? [...asked.matchAll(/"(\w+)"/g)].map((found) => found[1]!).filter((name) => java.includes(`.triggerableAnim("${name}", RawAnimation.begin().then("animation.`))
    : []
  const attribute = (name: string) => ((found) => (found ? Number(found[1]) : null))(new RegExp(`Attributes\\.${name},\\s*([\\d.]+)\\)`).exec(java))
  const pools: unknown = lootTable ? (JSON.parse(lootTable) as { pools?: unknown }).pools : []
  // What lures a follower, as the registry ids the class holds in its LURES set; null when the class has no such list (wheat, or it follows nobody).
  const lures = ((set) => (set === null ? null : [...set.matchAll(/ResourceLocation\.fromNamespaceAndPath\("([a-z0-9_.-]+)", "([a-z0-9_./-]+)"\)/g)].map((found) => `${found[1]}:${found[2]}`)))(/LURES = java\.util\.Set\.of\(([^;]*)\);/.exec(java)?.[1] ?? null)
  return {
    goals,
    steady: /STEADY_BODY = ([\d.]+)f;\s+private static final float STEADY_HEAD = ([\d.]+)f;/.exec(java)?.slice(1).map(n => Number(n) * TICKS),
    inner,
    lures,
    /** The motions gameplay code can play on it through the accessor. */
    playable,
    /**
     * It can be a baby (`setBaby(true)`): counted only when the class is the game's own ageing animal (the age kept and saved, the baby's flag told to every player), has the one method that class leaves open, takes half its size from
     * its scale, and does not apply the game's own half to the box as well (that would be a quarter).
     */
    grows: /extends AgeableMob implements GeoEntity/.test(java) && /public AgeableMob getBreedOffspring\(net\.minecraft\.server\.level\.ServerLevel world, AgeableMob other\) \{[\s\S]*?child\.setBaby\(true\);/.test(java) && /public float getScale\(\) \{ return super\.getScale\(\) \* \(isBaby\(\) \? net\.minecraft\.world\.entity\.LivingEntity\.EXTRA_RENDER_CULLING_SIZE_WITH_BIG_HAT : 1\.0f\); \}/.test(java) && /public float getAgeScale\(\) \{ return 1\.0f; \}/.test(java),
    /**
     * Null for a class that does not decide whom it fights in one place (the older shape: see `inner[].seeks`).
     * Otherwise what was read of that place; a part that was not found is false or null, never assumed.
     */
    engage:
      allows === null
        ? null
        : {
            distance: /distanceToSqr\(candidate\) <= ENGAGE_DISTANCE \* ENGAGE_DISTANCE/.test(allows) ? constant("ENGAGE_DISTANCE") : null,
            unseen: /engageUnseenTicks = hasLineOfSight\(target\) \? 0 : engageUnseenTicks \+ 1;/.test(keeps) ? constant("ENGAGE_UNSEEN_TICKS") : null,
            attackable: /candidate\.isAlive\(\) && candidate\.level\(\) == level\(\) && canAttack\(candidate\)/.test(allows),
            /** Gameplay's rules are asked about every candidate and every target. */
            ruled: new RegExp(`${GAMEPLAY_API.content}\\.mayTarget\\(this, candidate\\)`).test(allows),
            /** A target that no longer qualifies is let go on that tick. */
            lets_go: /if \(!engageAllows\(target\) \|\| engageUnseenTicks > ENGAGE_UNSEEN_TICKS\) setTarget\(null\);/.test(keeps),
            /** A warning before it attacks: it picks a player only within this many blocks of it, or one who has hit it (`habits.alert.attack_distance`); null: from as far as it fights. */
            attack_distance:
              /private boolean engageNear\(LivingEntity candidate\) \{\s*return distanceToSqr\(candidate\) <= ENGAGE_ATTACK_DISTANCE \* ENGAGE_ATTACK_DISTANCE \|\| candidate == getLastHurtByMob\(\);/.test(java) && /engageAllows\(player\) && hasLineOfSight\(player\) && engageNear\(player\)/.test(java)
                ? constant("ENGAGE_ATTACK_DISTANCE")
                : null,
            /** An ability begun against somebody ends when they stop being the target. */
            ability_ends: /\|\| abilityTarget != getTarget\(\)\) \{\s*stopAbility\(\);/.test(java),
          },
    /** How far the creature's own goal notices a player, in blocks, when it has such a goal. */
    notices: ((found) => (found ? Number(found[1]) : null))(/RUNTIME_TARGET_DISTANCE = ([\d.]+)/.exec(java)),
    /** The gameplay's own goals are applied, and after every goal of the creature's own. */
    takes_added: applied >= 0 && goals.every((goal) => goal.at < applied),
    /** `doHurtTarget` is overridden to start the attack motion before the hit, and a controller exists to play it. */
    attack_motion: swing !== null && /triggerAnim\("attack", "attack"\)/.test(swing) && /super\.doHurtTarget\(target\)/.test(swing) && /triggerableAnim\("attack", ATTACK\)/.test(java),
    hurt_motion: /hurtTime > lastHurtTime[\s\S]*?setAndContinue\(HURT\)/.test(java),
    death_motion: /isDeadOrDying\(\) \? state\.setAndContinue\(DEATH\)/.test(java),
    /** How long the body stays, in ticks: the generated override's, else vanilla's second. */
    death_ticks: ((found) => (found ? Number(found[1]) : 20))(/(?:DEATH_DURATION|DEATH_TICKS) = (\d+);/.exec(java)),
    /** It is never removed for being far from every player (`requiresCustomPersistence`): all but a hostile creature with a natural spawn. */
    stays: /@Override public boolean requiresCustomPersistence\(\) \{ return true; \}/.test(java),
    moves: /new PacedController\(state -> \{[^}]*?state\.setAndContinue\(IDLE\);[^}]*?state\.setAndContinue\(WALK\);/.test(java),
    /**
     * The abilities the class carries, as its own arrays and methods say them (ticks). Empty when it has none,
     * or when they are there but nothing starts them or nothing shows them: a reviewer must not count on those.
     */
    abilities: shown && starter !== null
      ? abilityClips.map((clip, index) => ({ clip, windup: Number(numbers("ABILITY_WINDUP")[index]), length: Number(numbers("ABILITY_LENGTH")[index]), cooldown: Number(numbers("ABILITY_COOLDOWN")[index]), weight: Number(numbers("ABILITY_WEIGHT")[index]), tracks: numbers("ABILITY_TRACKS")[index] === "true", hurt_stops: numbers("ABILITY_HURT_STOPS")[index] === "true", ...(cutAbilities.has(index) ? { break_stops: true } : {}), hits: steps[index] ?? [], handed: handed[index] ?? [], effects: spawns ? (shows[index] ?? []) : [], level_hits: levels[index] ?? [] }))
      : [],
    /** H3: an ability that is cut short takes with it the effects made to end with it. */
    effects_cut: /stopAbility\(\);\s*abilityCutEffects\(\);/.test(java) && /if \(shown\.endsWithOwner\(\)\) shown\.discard\(\);/.test(java),
    /** The goal that starts an ability, by its class name; null without abilities. */
    ability_starter: starter,
    /** While an ability shows, the movement controller plays neither walk nor idle. */
    // broad12: a walking creature nearer than the window of a ready ability steps back into it (abilityBackOff); the review read nothing of it and judged as if it would only stand.
    ability_backs: /private boolean abilityBackOff\(LivingEntity target\)/.test(java),
    // epic game5: an ability whose hits lie ahead of it starts only when the body already points at the target within what the hit covers, and it turns to the target until then.
    ability_faces: /\|\| !abilityFaces\(index, target\)\) return false;/.test(java) && /private boolean abilityFaces\(int index, LivingEntity target\)/.test(java),
    ability_alone: /new PacedController\(state -> \{[^}]*?if \(getEntityData\(\)\.get\(ABILITY\) != 0\) return PlayState\.STOP;/.test(java),
    /** Every motion the class starts, with what starts it: read from its constants, its controllers and its rules. */
    plays: [
      ...(/new PacedController\(state -> \{[^}]*?state\.setAndContinue\(IDLE\);[^}]*?state\.setAndContinue\(WALK\);/.test(java) ? [{ clip: constants.IDLE ?? "", by: "idle" }, { clip: constants.WALK ?? "", by: "walk" }] : []),
      ...(/hurtTime > lastHurtTime[\s\S]*?setAndContinue\(HURT\)/.test(java) ? [{ clip: constants.HURT ?? "", by: "hurt" }] : []),
      ...(/isDeadOrDying\(\) \? state\.setAndContinue\(DEATH\)/.test(java) ? [{ clip: constants.DEATH ?? "", by: "death" }] : []),
      ...(swing !== null && /triggerAnim\("attack", "attack"\)/.test(swing) && /triggerableAnim\("attack", ATTACK\)/.test(java) ? [{ clip: constants.ATTACK ?? "", by: "attack" }] : []),
      ...(shown && starter !== null ? abilityClips.map((clip) => ({ clip, by: "ability" })) : []),
      ...bossPlays.map((clip) => ({ clip, by: "boss" })),
      // Flight and habits (10-12): the motions the movement controller and the "habit" controller play, read from the constants they play them from.
      ...flightPlays.map((clip) => ({ clip, by: "flight" })),
      ...habitPlays.map((clip) => ({ clip, by: "habit" })),
      ...[...java.matchAll(/\.triggerableAnim\("logic_\d+", RawAnimation\.begin\(\)\.then\("animation\.[a-z0-9_]+\.(\w+)"/g)].map((found) => ({ clip: found[1]!, by: "rule" })),
    ],
    /** boss runtime (10-12): what the class does as a boss, as its own constants say it; null for a class that is not one. */
    boss: boss
      ? {
          bar: /BossEvent\.BossBarColor\.(\w+), BossEvent\.BossBarOverlay\.(\w+)\)/.exec(java)?.slice(1, 3) ?? null,
          phases: numbers("BOSS_BELOW").map(Number),
          intro_ticks: constant("BOSS_WAKE_TICKS"),
          wake_distance: constant("BOSS_WAKE_DISTANCE"),
          death_ticks: constant("BOSS_DEATH_TICKS"),
          bursts: numbers("BOSS_BURSTS").length,
          leash_ticks: constant("BOSS_LEASH_TICKS"),
          leash_distance: constant("BOSS_LEASH_DISTANCE"),
          clamps: /\(before > line && getHealth\(\) <= line\) \{\s*setHealth\(line\);/.test(java),
          // Not fighting means not moving, except for a boss whose habits say it is active: that one lives them until it meets someone (bossLives).
          immobile: /protected boolean isImmobile\(\) \{ return super\.isImmobile\(\) \|\| (?:bossState\(\) != BOSS_FIGHT|\(bossState\(\) != BOSS_FIGHT && !bossLives\(\)\)); \}/.test(java),
          /** A dormant boss with habits that say "active" lives them (roams, patrols, hunts, flies) and has not met anyone: nobody is its target and it picks none until the wake-up. */
          lives: /private boolean bossLives\(\)/.test(java) && /public boolean canAttack\(LivingEntity target\) \{ return bossState\(\) != BOSS_DORMANT && super\.canAttack\(target\); \}/.test(java),
          /** A flying boss's wake-up is an air display: it takes off if grounded and circles above whoever woke it for the intro, playing the intro clip. */
          display: /private boolean bossDisplay\(\)/.test(java) && /private void flightShow\(Vec3 around\)/.test(java),
          /**
           * A named first attack (`intro.opening`): its place in the ability list, the ticks after which the others no longer wait for it, and whether the class really holds the others back
           * (the gate in `bossAllows`), marks the attack when an ability starts and arms it again when a fight begins. Only for a class that has one.
           */
          ...(/private static final int BOSS_OPENING = /.test(java)
            ? {
                opening: {
                  index: constant("BOSS_OPENING"),
                  ticks: constant("BOSS_OPENING_TICKS"),
                  gated: /return index == BOSS_OPENING \|\| bossOpened \|\| \(mask & \(1 << BOSS_OPENING\)\) == 0 \|\| tickCount - bossFightAt > BOSS_OPENING_TICKS;/.test(java),
                  marked: /abilityIndex = index;\s*bossStarted\(index\);/.test(java) && /private void bossStarted\(int index\) \{\s*if \(index == BOSS_OPENING\) bossOpened = true;/.test(java),
                  armed: /private void bossBegin\(\) \{\s*bossSet\(BOSS_FIGHT, 0\);\s*bossOpened = false;\s*bossFightAt = tickCount;/.test(java) && /if \(--bossTimer <= 0\) bossBegin\(\);/.test(java) && java.split("bossSet(BOSS_FIGHT, 0)").length === 2,
                },
              }
            : {}),
        }
      : null,
    /** Flight (10-12): what the class does as a flier, as its own constants and methods say it; null for a class that is not one. */
    flight: flier
      ? {
          soar: /FLIGHT_SOAR = true;/.test(java),
          cruise: constant("FLIGHT_CRUISE"),
          altitude: [constant("FLIGHT_ALT_MIN"), constant("FLIGHT_ALT_MAX")] as const,
          turn: constant("FLIGHT_TURN"),
          takeoff_ticks: constant("FLIGHT_TAKEOFF_TICKS"),
          land_ticks: constant("FLIGHT_LAND_TICKS"),
          air_share: constant("FLIGHT_AIR_SHARE"),
          /** It takes no damage from a fall. */
          no_fall_damage: /public boolean causeFallDamage\(float fallDistance, float damageMultiplier, DamageSource damageSource\) \{ return false; \}/.test(java),
          /** In the air its own movement replaces the game's walking: goals that ask for a path do nothing there. */
          carried: /public void travel\(Vec3 movementInput\) \{\s*if \(flightState\(\) == FLIGHT_GROUND \|\| isDeadOrDying\(\)\) \{\s*super\.travel\(movementInput\);\s*return;\s*\}\s*move\(MoverType\.SELF, getDeltaMovement\(\)\);/.test(java),
          /** Abilities start only where their document says. */
          gated: /\|\| !flightAllows\(index\)( \|\| !flightFaces\(index, target\))?( \|\| !flightReaches\(index, target\))?\) return false;/.test(java),
          // broad11 w1 recheck: in the air an ability laid out ahead of it waits until it can turn to the one it fights in time.
          faces: /\|\| !flightFaces\(index, target\)( \|\| !flightReaches\(index, target\))?\) return false;/.test(java) && /private boolean flightFaces\(int index, LivingEntity target\)/.test(java),
          dives: numbers("FLIGHT_DIVE").filter((value) => value === "true").length,
          /** A dive's charge is timed to the first hit: the speed is worked out each tick from the distance left and the ticks left, between a least and a most. */
          charges: /private static double flightDiveSpeed\(double distance, int left, double least, double most, double floor\)/.test(java) && /flightDiveSpeed\(distance, FLIGHT_FIRST\[abilityIndex\] - abilityTick - 1, (?:FLIGHT_DIVE_LEAST|flightDiveLeast\(\)), FLIGHT_DIVE_MOST, (?:FLIGHT_STALL|flightStall\(\))\);/.test(java),
          dive_least: constant("FLIGHT_DIVE_LEAST"),
          dive_most: constant("FLIGHT_DIVE_MOST"),
          /** It reads a roam from the NBT value "FlightRoam" (a creature with a home in its document keeps that home and has no roam). */
          roams: /nbt\.getDouble\("FlightRoam"\)/.test(java) && /private boolean flightRoamInside\(Vec3 point\)/.test(java),
          // Only said when true, so that a flier without them reads exactly as before.
          /** Its flight speeds (cruise, turn, dive limits) are scaled by the boss phase's speed multiplier, the dive never past FLIGHT_DIVE_MOST. */
          ...(/private double flightPace\(\)/.test(java) ? { paced: true } : {}),
          // epic game1: in the air an ability aimed at the one it fights starts only when its hits can reach them by the first, and the flier holds station where they reach while it runs.
          ...(/\|\| !flightReaches\(index, target\)\) return false;/.test(java) && /private Vec3 flightReachStation\(int index, LivingEntity target, boolean closing\)/.test(java) ? { reaches: true } : {}),
          ...(/private void abilityFollow\(LivingEntity target\)/.test(java) ? { follows: true } : {}),
          // epic game1: a flier that eats on the ground eats to the end; a mood for the air does not take it up.
          ...(/if \(habitEatLeft > 0\) return false;/.test(java) ? { meal: true } : {}),
          /** It lands near its target for an ability that only works on the ground when no air one is ready, and takes off again when one is. */
          ...(/private int flightGroundWanted\(LivingEntity target\)/.test(java) ? { lands: true } : {}),
        }
      : null,
    /** Habits (10-12): the same for a creature that lives by habits. */
    habits: /EntityDataAccessor<Byte> HABIT = /.test(java)
      ? {
          mode: constant("HABIT_MODE"),
          home_radius: constant("HABIT_HOME_RADIUS"),
          hunger_ticks: constant("HABIT_HUNGER"),
          prey: [...(/HABIT_PREY = \{([^}]*)\}/.exec(java)?.[1] ?? "").matchAll(/EntityType\.(\w+)/g)].map((found) => found[1]!.toLowerCase()),
          alert_distance: constant("HABIT_ALERT_DISTANCE"),
          alert_cooldown: constant("HABIT_ALERT_COOLDOWN"),
        }
      : null,
    experience: ((found) => (found ? Number(found[1]) : 0))(/xpReward = (\d+);/.exec(java)),
    damage: attribute("ATTACK_DAMAGE"),
    follow: attribute("FOLLOW_RANGE"),
    drops: (Array.isArray(pools) ? pools : []).flatMap((pool: { conditions?: { condition?: string; chance?: number }[]; entries?: { name?: string; functions?: { function?: string; count?: unknown }[] }[] }) =>
      (pool.entries ?? []).map((entry) => {
        const looting = Boolean(entry.functions?.some((value) => value.function === "minecraft:enchanted_count_increase"))
        const count = entry.functions?.find((value) => value.function === "minecraft:set_count")?.count as number | { min?: number; max?: number } | undefined
        return {
          item: entry.name ?? "",
          min: typeof count === "number" ? count : (count?.min ?? 1),
          max: typeof count === "number" ? count : (count?.max ?? 1),
          chance: pool.conditions?.find((value) => value.condition === "minecraft:random_chance")?.chance ?? 1,
          player_only: Boolean(pool.conditions?.some((value) => value.condition === "minecraft:killed_by_player")),
          looting,
        }
      }),
    ),
  }
}
export type GeneratedCreature = ReturnType<typeof readGeneratedCreature>

/** One goal in words: a vanilla one from the table, one the generated class defines from what its body was read to do, any other by its name alone. */
const goalWords = (facts: GeneratedCreature, type: string, named: (item: string) => string) => {
  // The goals of the habits are told by what they are for, not by the generic reading of a goal that has no target of its own.
  if (/^Habit\w+Goal$/.test(type) && GOAL_WORDS[type]) return `（Studio 生成的习性：${GOAL_WORDS[type].does}；占 ${GOAL_WORDS[type].holds}）`
  const own = facts.inner.find((value) => value.type === type)
  // The lure a follower goes by: the items its document lists, else the wheat it always was.
  const lure = facts.lures?.length ? facts.lures.map((item) => `「${named(item)}」`).join("或") : "小麦"
  if (type === "TemptGoal" && facts.lures?.length) return `（跟着手里拿着${lure}的玩家走；占 ${GOAL_WORDS[type]!.holds}）`
  if (own?.picks) return `（Studio 生成的：只在它还没有目标的时候，${own.picks === "any_player" ? `把${facts.engage?.distance ? ` ${facts.engage.distance} 格内` : ""}看得见的、最近的、可以打的玩家${facts.engage?.attack_distance ? `（而且只有玩家走近到 ${facts.engage.attack_distance} 格以内，或者玩家打过它，才挑他；再远一点它只警觉、不挑他）` : ""}` : own.picks === "provoked" ? "把刚打了它的那一个（同类不算）" : "把它找到的（找谁没有读出来）"}定为目标；占 ${own.holds.join("、") || "不明"}）`
  if (own) return `（Studio 生成的：${own.seeks ? `自己找${facts.notices === null ? "" : ` ${facts.notices} 格内`}看得见的、最近的${own.wheat ? "、手里拿着小麦的" : own.lured ? `、手里拿着${lure}的` : ""}玩家并靠近（创造模式的不算）` : own.chases ? "有目标时追上去（目标由 targetSelector 或玩法代码定）" : "不自己找目标，所以自己不会开始"}，${own.starts ? "当下有能用的招式就开始一个，" : ""}${own.swings ? "够得着就调用自己的 doHurtTarget 出手" : "不调用 doHurtTarget"}；占 ${own.holds.join("、") || "不明"}）`
  return GOAL_WORDS[type] ? `（${GOAL_WORDS[type].does}；占 ${GOAL_WORDS[type].holds}）` : ""
}
const listed = (facts: GeneratedCreature, goals: GeneratedCreature["goals"], named: (item: string) => string) => goals.map((goal) => `${goal.priority} ${goal.type}${goalWords(facts, goal.type, named)}`).join("，")

/** One creature's facts as the sentences a reviewer is given. `named` turns a registry name of a drop into the name a player knows. */
export function creatureContractLines(creature: { title: string; key: string; /** The other ids of the same creature (its model's asset and the asset of its rules). */ aliases?: readonly string[] }, facts: GeneratedCreature, named: (item: string) => string = (item) => item, bindings: CreatureBindings | null = null, effectTitle: (id: string) => string | null = () => null) {
  const seconds = (ticks: number) => Number((ticks / TICKS).toFixed(2))
  const abilityName = (index: number, clip: string) => bindings?.abilities[index]?.name ?? clip
  const interruption = (ability: GeneratedCreature["abilities"][number]) => ability.break_stops
    ? "打够破绽会打断它" + (ability.hurt_stops ? "，其他命中也可按打断条件打断" : "，别的挨打不会停")
    : `挨打${ability.hurt_stops ? "会" : "不会"}打断它`
  const own = facts.goals.filter((goal) => !goal.target)
  const targets = facts.goals.filter((goal) => goal.target)
  const engage = facts.engage
  // Its own goals at the fighting priority that go after the target it has.
  const fighters = own.filter((goal) => facts.inner.some((value) => value.type === goal.type && value.chases) || goal.type === "MeleeAttackGoal").map((goal) => goal.type)
  const seeker = own.find((goal) => facts.inner.some((value) => value.type === goal.type && value.seeks))
  const drops = facts.drops.map((drop) => `${drop.chance < 1 ? `${Number((drop.chance * 100).toFixed(1))}% 的机会掉 ` : ""}${drop.min === drop.max ? drop.max : `${drop.min}–${drop.max}`} 个「${named(drop.item)}」${drop.player_only ? "（要玩家亲手打败）" : ""}`)
  return [
    `生物「${creature.title}」（代码里写作 "${creature.key}"${creature.aliases?.length ? `；${creature.aliases.map((alias) => `"${alias}"`).join("、")} 是读同一只生物的另一个 id，不是另一只生物，下面说的对它们一样` : ""}）的类是 Studio 生成的，AI 写的玩法代码里看不到它。下面每一句都是从这一版会生成的 Java 里读出来的。`,
    ...(facts.steady ? [`不出招时身体每秒最多转 ${facts.steady[0]}°，头每秒最多转 ${facts.steady[1]}°。`] : []),
    own.length ? `它自己的行为（goalSelector，数字越小越优先）：${listed(facts, own, named)}。${targets.length ? `选目标（targetSelector）：${listed(facts, targets, named)}。` : engage ? "它的 targetSelector 里没有它自己的行为：它自己从不选目标，只有玩法代码给它目标（addTargetGoal 加的行为，或者 mob.setTarget(...)）它才开打。" : "它的 targetSelector 是空的：除了上面写明自己找玩家的行为，它不会自己给自己定目标（getTarget() 是空的，除非玩法代码去设）。"}` : NOT_READ("它自己的行为"),
    ...(engage
      ? [
          `它打谁：它自己所有去打人的行为${fighters.length ? `（${fighters.join("、")}）` : ""}都只对它的目标（getTarget()）行动，目标是谁定的都一样。没有目标时这些行为不运行，它的身体（MOVE、LOOK）是空出来的：玩法加在 ${GOAL_BAND.over_idle[0]} 到 ${GOAL_BAND.over_idle[1]} 的行为这时可以上场，没有的话它照常闲逛、张望。`,
          engage.lets_go
            ? `目标每一刻都重新核对（生成的 customServerAiStep，服务端），不管目标是谁定的：目标死了、不在同一个世界了${engage.attackable ? "、成了打不了的人（创造或旁观模式的玩家；和平难度下的玩家）" : ""}${engage.distance === null ? "" : `、离它超过 ${engage.distance} 格`}${engage.unseen === null ? "" : `、连续 ${engage.unseen} 刻看不见`}${engage.ruled ? `，或者玩法代码用 ${GAMEPLAY_API.content}.targetRule 给这种生物登记的规则对这个目标答了 false` : ""}——它当刻放掉目标（setTarget(null)），去打人的行为随后一两刻内停下${facts.abilities.length ? (engage.ability_ends ? "，进行到一半的招式当刻中断、之后的判定都不会发生" : `，${NOT_READ("招式跟着目标中断的那一步")}`) : ""}。${engage.ruled ? "它自己选目标之前也先问同一条规则：规则不答应的，不会被选上。" : `这一版生成的代码不问 ${GAMEPLAY_API.content}.targetRule 的规则。`}`
            : NOT_READ("目标不再合格时放掉它的那一步"),
        ]
      : seeker
        ? [`它打谁：这一版里 ${seeker.type} 不看它的目标——它自己找玩家、自己追，getTarget() 是谁都不影响它，玩法代码定的目标它不会去打；它运行的时候占着 MOVE、LOOK，玩法加在 ${GOAL_BAND.over_idle[0]} 到 ${GOAL_BAND.over_idle[1]} 的行为上不了场。玩法代码一旦对这种生物调用 ${GAMEPLAY_API.content}.targetRule 或 addTargetGoal，或者生物文档写了 engagement，生成的类就改成只对目标行动（那时这里的说法会跟着变）。`]
        : []),
    facts.takes_added
      ? `玩法代码用 ${GAMEPLAY_API.content}.addGoal / addTargetGoal 加的行为，在它自己的 registerGoals 末尾、排在上面这些之后加进去；它自己的行为一个都不会被拿掉。`
      : NOT_READ(`它接收 ${GAMEPLAY_API.content}.addGoal 加的行为的那一步`),
    ...(facts.abilities.length
      ? [
          `招式：它有 ${facts.abilities.length} 个招式，全部由生成的类在服务端运行，玩法代码不用也不能去触发它们。${facts.ability_starter} 在它有目标时，从当下能用的招式里按权重挑一个开始；招式进行中它站在原地、不调用 doHurtTarget${facts.ability_alone ? "，也不播 walk / idle" : ""}；它自己死了、目标死了或不见了，招式立刻中断，之后的判定都不会发生。正在播哪个招式是同步给所有看得见它的玩家的。${facts.ability_backs ? "目标离它比某个已经好了的招式的最近距离（start.min_distance，至少 2 格、比两者身体加起来的一半还远）还近时，它不再往目标身上走，而是面向目标倒着退进那个招式的起手距离里，退到了再出招。" : ""}${facts.ability_faces ? "判定摆在它身前、不朝目标瞄的招式（扇形、方块、球、水平光束），要它的身体已经朝着目标、偏差不超过判定罩得住的角度才会开始；还没朝着的时候它先转向目标。" : ""}`,
          ...facts.abilities.map(
            (ability, index) =>
              `招式「${abilityName(index, ability.clip)}」：开始时从头播 ${ability.clip} 动作；${ability.windup > 0 ? `前 ${seconds(ability.windup)} 秒是蓄力${ability.tracks ? "，一直转向目标" : "，朝向不变"}，` : "没有蓄力，"}${ability.hits.length ? `第 ${ability.hits.map(seconds).join("、")} 秒出手（第 ${ability.hits.join("、")} 刻；按那一刻每个人实际站的位置判定，不在范围里就不受伤）` : ability.handed.length ? "" : NOT_READ("它出手的时刻")}${ability.handed.length ? `${ability.hits.length ? "；" : ""}第 ${ability.handed.map((call) => seconds(call.tick)).join("、")} 秒（第 ${ability.handed.map((call) => call.tick).join("、")} 刻）不是判定，而是调用玩法登记的入口 ${ability.handed.map((call) => call.action).join("、")}（传进去的是放招的生物和它的目标；那一刻做什么是那个玩法的事，这里没有读，要进游戏看）` : ""}，第 ${seconds(ability.length)} 秒结束，之后 ${seconds(ability.cooldown)} 秒内不会再用；${interruption(ability)}。${ability.effects.length ? `它会放出效果：${ability.effects.map((shown) => `第 ${seconds(shown.tick)} 秒「${effectTitle(shown.effect) ?? shown.effect}」${shown.count > 1 ? ` ×${shown.count}` : ""}${shown.aimed ? "（顺着那次出手瞄的方向摆，目标站得高或者低，它跟着判定一起倾斜）" : ""}`).join("、")}。` : ""}${ability.level_hits.length ? `第 ${ability.level_hits.map(seconds).join("、")} 秒那一下是水平打出去的：只朝它面对的方向，不随目标站得高低倾斜。` : ""}`,
          ),
          // H3: what an effect is, said once, when any ability shows one.
          ...(facts.abilities.some((ability) => ability.effects.length)
            ? [`效果：招式放出的效果是 Studio 生成的另一种实体，只给人看——不伤人、打不到、不挡路、不存盘，到时间自己消失；由生成的类在服务端按上面的时刻放出来，玩法代码不用也不该替它放。${facts.effects_cut ? "招式被打断时，做成“随那一招结束”的效果当刻消失，其余的留到时间结束。" : NOT_READ("招式被打断时收掉效果的那一步")}`]
            : []),
        ]
      : []),
    facts.attack_motion
      ? `出手：它的模型有 attack 动作。任何人调用它的 doHurtTarget(目标)——它自己的行为，或者玩法代码里的 mob.doHurtTarget(...)——生成的 doHurtTarget 都会先从服务端触发 attack 动作（附近的玩家同时看到），再结算伤害${facts.damage === null ? "" : `（攻击力 ${facts.damage}）`}。所以“出手时播 attack 动作”这件事，玩法代码只要调用了 doHurtTarget 就已经做到，不需要自己再去播。`
      : `出手：它的模型没有 attack 动作，生成的类也没有改写 doHurtTarget。调用 doHurtTarget(目标) 只结算伤害${facts.damage === null ? "" : `（攻击力 ${facts.damage}）`}，它身上不会播任何出手的动作；说明里要是答应了出手时有自己的动作，只调用 doHurtTarget 的代码没有做到。`,
    facts.hurt_motion ? "挨打：每次受伤立刻播模型的 hurt 动作（原版的变红和击退照旧）。" : NOT_READ("挨打时播 hurt 动作的那一步"),
    facts.death_motion
      ? `死亡：播模型的 death 动作，播完才消失（${facts.death_ticks} 刻，约 ${Number((facts.death_ticks / 20).toFixed(1))} 秒）。`
      : `死亡：它的模型没有 death 动作，按原版的样子侧身倒下，${facts.death_ticks} 刻后消失。`,
    // boss runtime (10-12): what the class does as a boss, said only as far as it was read.
    ...(facts.boss
      ? [
          `Boss：${facts.boss.bar ? `屏幕上方有名字血条（${facts.boss.bar[0]!.toLowerCase()}、${facts.boss.bar[1]!.toLowerCase()}）` : NOT_READ("血条")}；${
            facts.boss.intro_ticks === null ? "没有登场，一出来就开打" : `${facts.boss.lives ? "一开始还没见过谁，照自己的习性活动（要巡、要猎、要飞都照做，但不挑任何人当目标）" : "一开始睡着"}，玩家走近 ${facts.boss.wake_distance ?? "?"} 格或者打到它才醒，醒来 ${facts.boss.intro_ticks} 刻里${facts.boss.display ? "飞到那个玩家头顶盘旋着演出（在地上就先起飞），期间打不死" : "不动也打不死"}${
              facts.boss.opening
                ? `；登场以后的第一招是${facts.boss.opening.index === null || !facts.abilities[facts.boss.opening.index] ? NOT_READ("哪一个招式") : `「${abilityName(facts.boss.opening.index, facts.abilities[facts.boss.opening.index]!.clip)}」`}，${facts.boss.opening.gated && facts.boss.opening.marked && facts.boss.opening.armed ? `这一场里它没用过之前别的招式都不出（最多等 ${facts.boss.opening.ticks ?? "?"} 刻，等不到就放开），重置后下一场重新先用它` : NOT_READ("先用第一招、别的招式等着的那一步")}`
                : ""
            }`
          }；${facts.boss.phases.length ? `${facts.boss.phases.length} 个阶段（血量掉到 ${facts.boss.phases.map((below) => `${Number((below * 100).toFixed(1))}%`).join("、")} 时变身${facts.boss.clamps ? "，一下打不穿两个阶段" : `，${NOT_READ("一下打不穿两个阶段的那一步")}`}）` : "没有阶段"}；死亡演出 ${facts.boss.death_ticks ?? "?"} 刻${facts.boss.bursts ? `，经验分 ${facts.boss.bursts} 次喷出` : ""}；${
            facts.boss.leash_ticks === null ? "走多远也不回出生点" : `离出生点超过 ${facts.boss.leash_distance ?? "?"} 格、${facts.boss.leash_ticks} 刻里没人在附近就回去回满血${facts.boss.lives ? "，并回到没见过谁的样子" : ""}`
          }。${facts.boss.immobile ? "" : NOT_READ("睡着和变身时不动的那一步")}`,
        ]
      : []),
    // Flight and habits (10-12): said only as far as they were read.
    ...(facts.flight
      ? [
          `飞行：它会飞（${facts.flight.soar ? "滑翔型，在天上不停" : "悬停型，能停在空中"}）：巡航每秒 ${facts.flight.cruise === null ? "?" : Number((facts.flight.cruise * TICKS).toFixed(1))} 格，平时离地 ${facts.flight.altitude[0] ?? "?"}–${facts.flight.altitude[1] ?? "?"} 格，起飞用 ${facts.flight.takeoff_ticks ?? "?"} 刻、落地用 ${facts.flight.land_ticks ?? "?"} 刻。${facts.flight.no_fall_damage ? "不受摔落伤害。" : NOT_READ("不受摔落伤害的那一步")}${facts.flight.carried ? "它在天上的移动全由飞行自己控制：玩法代码给它加的行为里用 getNavigation() 找路、走过去的，在天上不会让它动（路径被每刻清掉），只在它站在地上时起作用；改它的速度或位置（setDeltaMovement、teleportTo）在天上会被下一刻的飞行覆盖。" : NOT_READ("天上的移动由飞行自己控制的那一步")}${facts.flight.gated ? "招式照文档写的 where 在地上或天上才会开始（起飞、落地和飞回出生点时都不开始），俯冲只在天上。" : ""}${facts.flight.faces ? "在天上，判定范围摆在它身前的招式（扇形、方块、球、水平光束），要它在蓄力结束前转得过来面向目标才会开始；朝目标打的光束、锥形和射出去的东西从出手的地方直接对准目标站的位置，不管它当时朝哪边。" : ""}${facts.flight.reaches ? "在天上，朝目标打的光束和锥形，要出手的地方离目标够得着才会开始（照它现在的飞法一路飞到最后一下出手，每一下出手的地方都在射程以内，并留出前几下把目标推开的距离和一步的余地，也不会近到射程的三分之一以内）；招式进行时它飞到并停在一个出手的地方离目标约三分之二射程远、高出目标约三分之一射程的位置，不再一路飞过去（滑翔型停不下来，只能以最慢的速度往前飞）。" : ""}${facts.flight.follows ? "蓄力时一直转向目标（facing: track）的这类招式，蓄力结束后瞄准点仍会跟着目标，每刻最多转它自己的转弯速度，也不会离蓄力结束时瞄的地方超过前几下击退的距离再加一步：被推开的目标还在瞄准里，自己走开的躲得开。" : ""}${facts.flight.meal ? "吃东西时（在地上）它不会因为一时兴起起飞，吃完才会；要打的目标、被叫去哪里、Boss 的登场这些更急的事照样让它起飞。" : ""}${facts.flight.paced ? "Boss 进入变快的阶段，飞行的速度（巡航、转弯、俯冲的快慢）跟着按同样的倍数变快，俯冲仍然不超过每刻最大速度、仍然正好在第一次出手那一刻到。" : ""}${facts.flight.lands ? "战斗时没有天上的招式能放、而地上的招式已经好了（放得下），它就落到目标身边用地上的招式；天上的招式好了、被打到或者目标走远了就再起飞。" : ""}${
            facts.flight.dives
              ? facts.flight.charges
                ? `俯冲：蓄力一结束锁定目标身体中间的位置，直线冲过去，每一刻按“还有多远 ÷ 离第一次出手还有几刻”重算速度（至少每刻 ${facts.flight.dive_least === null ? "?" : Number(facts.flight.dive_least.toFixed(2))} 格，最多每刻 ${facts.flight.dive_most ?? "?"} 格），到了就等在那里；所以目标站着不动、又在冲得到的距离里，它正好在第一次出手的那一刻到。出手的时刻照文档，被挡住或太远冲不到，它也照那一刻判定，不会等。`
                : NOT_READ("俯冲按离第一次出手还有多久算速度的那一步")
              : ""
          }${facts.flight.roams ? "用命令放它的时候可以写 NBT FlightRoam（格），它就只在放下的地方这么远以内飞、走（测试场就是这样放的）；不写就和平常一样。" : ""}`,
        ]
      : []),
    ...(facts.habits
      ? [
          `习性：${facts.habits.mode === 2 ? "一直活动" : `${facts.habits.mode === 0 ? "白天" : "夜里"}活动，其余时间回窝休息（按世界时间，不看天气）`}${facts.habits.home_radius === null ? "" : `；窝在出生点，半径 ${facts.habits.home_radius} 格，走远了自己回来`}${facts.habits.prey.length ? `；吃饱 ${facts.habits.hunger_ticks === null ? "?" : Number((facts.habits.hunger_ticks / TICKS / 60).toFixed(1))} 分钟后饿，饿了去追原版的 ${facts.habits.prey.join("、")} 并打（打死就吃饱）` : ""}${facts.habits.alert_distance === null ? "" : `；玩家第一次走近 ${facts.habits.alert_distance} 格先警觉一次，之后 ${facts.habits.alert_cooldown === null ? "?" : Number((facts.habits.alert_cooldown / TICKS).toFixed(0))} 秒内不再${facts.engage?.attack_distance ? `；先只警告，玩家走近到 ${facts.engage.attack_distance} 格以内（或者打过它）才开打` : ""}`}。这些行为的优先级见上面它自己的行为：0 到 4 之间，比追击低、比闲逛高（警觉和进食除外，它们不被打断）。`,
        ]
      : []),
    facts.stays
      ? "留在世界里：玩家走远它也不会被游戏清掉，退出再进来还在（不用另外给它打不消失的标记）。"
      : "留在世界里：它是会自然出现的敌对生物，和原版怪物一样——附近 128 格内没有玩家就会被清掉，32 格以外久了也可能消失。说明里要是指望某一只一直在（守着一个地方、被召唤出来的那一只），玩法代码要自己对那一只调用 setPersistenceRequired()。",
    facts.moves ? "平时：只要身体在地上被带着走就播 walk 动作（走得再慢也算，播放的快慢跟着它实际走的快慢），站着时播 idle 动作。" : NOT_READ("平时播 walk / idle 的那一步"),
    // The binding list: every motion of its model with what starts it. A source the document promises and the generated class does not show is said as not read.
    ...(bindings
      ? [
          `动作去向（它的模型里每个动作由什么播）：${bindings.clips
            .map((bound) => {
              const read = bound.sources.filter((source) => facts.plays.some((played) => played.clip === bound.clip && played.by === source.by))
              return `${bound.clip}——${read.length ? read.map((source) => source.words).join("，") : NEVER_PLAYED}${read.length < bound.sources.length ? `（${NOT_READ(`「${bound.sources.filter((source) => !read.includes(source)).map((source) => source.words).join("、")}」`)}）` : ""}`
            })
            .join("；")}。${bindings.abilities.some((ability) => ability.missing.length) ? `招式里找不到的东西：${bindings.abilities.flatMap((ability) => ability.missing.map((missing) => `「${ability.name}」的${missing}`)).join("、")}。` : ""}`,
        ]
      : []),
    // Whether it can be a baby is read off the class, like the rest: a class that cannot says so, and a reviewer must not count on it.
    facts.grows
      ? `幼年：${CREATURE_BABY.capability}`
      : "幼年：这一版生成的类没有幼年的做法，玩法代码对它调用 setBaby(...) 在游戏里没有效果（原版的 setBaby 对普通生物什么也不做）；评审不能当它有。",
    ...(facts.playable.length
      ? [`玩法代码调用 ${GAMEPLAY_API.content}.${GAMEPLAY_API.motionMethod}(生物, "动作名") 就让它在服务端把模型里的这个动作从头播一遍（附近的玩家同时看到，盖在它正在做的事上），能这样播的动作：${facts.playable.join("、")}。上面写“${NEVER_PLAYED}”的动作，只有玩法代码这样调用才会播。`]
      : []),
    `被打败：${drops.length ? `掉 ${drops.join("；")}（掉落表是 Studio 生成的${facts.drops.some((drop) => drop.looting) ? "，抢夺附魔会多掉" : ""}）` : "什么都不掉（没有生成掉落表）"}；${facts.experience ? `给 ${facts.experience} 点经验` : "不给经验"}。玩法代码不需要、也不能替换这张掉落表。`,
  ]
}

/** How `addGoal` and `addTargetGoal` behave, read from the accessor the build generates. */
export function accessorContractLines(source: string) {
  const adds = (method: string, target: boolean) => new RegExp(`public static void ${method}\\(String id, int priority, Function<PathfinderMob, Goal> factory\\) \\{\\s*added\\(id, new AddedGoal\\(${target}, priority, factory\\)\\);`).test(source)
  const applied = /\(goal\.target\(\) \? targets : goals\)\.addGoal\(goal\.priority\(\), goal\.factory\(\)\.apply\(mob\)\)/.test(source)
  // A creature is looked up by its own id or by another name it is read by; an id that is neither stops the gameplay at start.
  const checked = /private static String registry\(String id\) \{\s*String registry = ENTITIES\.get\(ALIASES\.getOrDefault\(id, id\)\);\s*if \(registry == null\) throw new IllegalArgumentException/.test(source)
  if (!adds("addGoal", false) || !adds("addTargetGoal", true) || !applied) return [NOT_READ(`${GAMEPLAY_API.content}.addGoal / addTargetGoal 的做法`)]
  const ruled = /public static void targetRule\(String id, BiPredicate<PathfinderMob, LivingEntity> rule\) \{[\s\S]*?TARGET_RULES\.computeIfAbsent\(registry\(id\), name -> new ArrayList<>\(\)\)\.add\(rule\);/.test(source) && /public static boolean mayTarget\(PathfinderMob mob, LivingEntity candidate\) \{[\s\S]*?if \(!rule\.test\(mob, candidate\)\) return false;\s*return true;/.test(source)
  return [
    `${GAMEPLAY_API.content}.addGoal("生物的 id", 优先级, 工厂) 只是登记：以后每一只这种生物进入世界、建立自己的行为时，都会用工厂新建一个 Goal，按写的优先级加进它的 goalSelector；addTargetGoal 一样，只是加进 targetSelector（选目标用）。优先级的数字就是写的那个数字，Studio 不会改。${checked ? "id 不是这个工程的生物时，这个玩法一启动就会报错。" : ""}`,
    ruled
      ? `${GAMEPLAY_API.content}.targetRule("生物的 id", (mob, 候选) -> 可不可以打) 也只是登记：规则由这种生物自己来问（见上面“目标每一刻都重新核对”那一句），同一种生物登记了几条就要全部答 true。规则只回答可不可以，不替它选目标，也不移动它。`
      : NOT_READ(`${GAMEPLAY_API.content}.targetRule 的做法`),
    // Steering a flier: read off the accessor, so the words cannot promise more than it does.
    /public static void flyTo\(Mob creature, double x, double y, double z\) \{\s*if \(creature\.level\(\)\.isClientSide\(\)\) return;\s*if \(creature instanceof StudioFlier flier\) flier\.studioFlyTo\(x, y, z\);\s*else creature\.getNavigation\(\)\.moveTo\(x, y, z, 1\.0\);/.test(source)
      ? `${GAMEPLAY_API.content}.flyTo(生物, x, y, z) 只是一个请求：会飞的生物（实现了 StudioFlier 的，也就是这个工程里生成的飞行生物）自己起飞、飞过去、在那里悬停或盘旋几秒，之后它自己的闲逛接着来；其他生物只是用寻路沿地面走过去一次。isFlying 和 land 同理，只对生成的飞行生物有效。请求不改它的目标、Goal 和战斗。`
      : NOT_READ(`${GAMEPLAY_API.content}.flyTo 的做法`),
    // H3: said only when the accessor of this project can show effects at all.
    ...(/public static Entity spawnEffect\(String id, [^)]*Entity owner\) \{\s*return [\w.]+\.spawn\(id, world, pos, yaw, owner, null\);/.test(source)
      ? [`${GAMEPLAY_API.content}.spawnEffect("效果的 id", world, pos, yaw) 在服务端把这个工程的一个效果放到 pos、正面转到 yaw；再加一个 owner 参数时，效果按它自己的设定跟着 owner、或者随 owner 死亡而消失。效果只给人看，不伤人、不存盘、到时间自己消失；在客户端调用什么都不会发生，返回 null。`]
      : []),
    // An ability's moment that a gameplay does: read off the accessor, so the words promise no more than it does.
    ...(/public static void abilityAction\(String name, \w+ action\)/.test(source)
      ? [
          /public static void runAbility\(String name, Mob creature, LivingEntity target\) \{[\s\S]*?action\.run\(creature, target\);[\s\S]*?catch \(RuntimeException \| LinkageError error\) \{\s*LOGGER\.error/.test(source)
            ? `${GAMEPLAY_API.content}.abilityAction("入口名", (creature, target) -> …) 只是登记：生物的招式里写了交给玩法的一刻（type 写 gameplay），到那一刻生成的类在服务端调用同名的入口，传进去的是放招的生物和它的目标，在玩家自己的游戏里不调用。入口里抛出的异常只记进日志，招式照常往下走；没有人登记的名字只在日志里说一次、什么也不做；同一个名字登记两次，玩法一启动就会报错。入口里做什么，这里没有读。`
            : NOT_READ(`${GAMEPLAY_API.content}.abilityAction 的做法`),
        ]
      : []),
    `自带行为的优先级是 游泳 ${BASELINE_GOALS.swim}、追击或攻击 ${BASELINE_GOALS.engage}、闲逛 ${BASELINE_GOALS.wander}、看向玩家 ${BASELINE_GOALS.look_at_player}、张望 ${BASELINE_GOALS.look_around}；玩法加的行为写在这些之外的优先级，check_code 已经核对过。玩法加在 ${GOAL_BAND.over_idle[0]} 到 ${GOAL_BAND.over_idle[1]} 的行为运行的时候，排在它后面、和它占同一样东西（MOVE 或 LOOK）的自带行为不运行：占了 MOVE，闲逛和张望停；占了 LOOK，看向玩家和张望停。它的 canUse 要是一直答应，这几样就一直不运行。`,
  ]
}

/**
 * The contract for the creatures a gameplay lists under `uses`, as lines; empty when it lists none (there
 * is then nothing Studio generates that the gameplay leans on beyond what its own code shows). `draft` is
 * the gameplay being reviewed when it is not the saved one: it stands in for its saved version.
 */
export async function gameplayContract(directory: string, uses: readonly string[], draft?: { asset_id: string | null; document: Pick<GameplayDocument, "sources"> }) {
  const project = await openProject(directory)
  const things = gameplayThings(project)
  // The gameplay under review may not be saved yet, and its own calls decide how the creatures it governs are generated.
  const governed = governedCreatures(project, draft)
  // One entry for each creature the gameplay lists (under whichever of its ids): the creature itself, and the other ids it is read by, so a reviewer does not take them for other creatures.
  const used = new Set(things.filter((thing) => thing.kind === "creature" && uses.includes(thing.asset_id) && thing.registry && thing.key).map((thing) => thing.registry!))
  const creatures = [...used].flatMap((registry) => {
    const ids = things.filter((thing) => thing.kind === "creature" && thing.registry === registry && thing.key)
    const primary = ids.find((thing) => thing.alias_of === null) ?? ids[0]
    return primary ? [{ ...primary, aliases: ids.filter((thing) => thing !== primary).map((thing) => thing.key!) }] : []
  })
  if (!creatures.length) return []
  const named = (item: string) => {
    const [space, name] = item.includes(":") ? (item.split(":") as [string, string]) : [project.mod_id, item]
    return space === "minecraft" ? (VANILLA_ITEM_NAMES[name] ?? item) : ([...project.items, ...project.blocks].find((value) => value.identifier === name)?.name ?? item)
  }
  const read = await Promise.all(
    creatures.map(async (thing) => {
      const index = project.entities.findIndex((entity) => creatureName(entity) === thing.registry)
      // A creature that cannot be generated right now (no saved model, a drop that names nothing) has no contract; the build itself will say why.
      const files = await compileProjectEntity(directory, project, project.entities[index]!, index, true, governed).then((made) => made.files as Record<string, unknown>, () => null)
      const java = files ? Object.entries(files).find((entry) => typeof entry[1] === "string" && /extends AgeableMob implements GeoEntity/.test(entry[1]))?.[1] : undefined
      if (typeof java !== "string") return [`生物「${thing.title}」现在还生成不出来（模型没有保存，或者它的掉落物找不到），所以这一版说不出它保证了什么；评审对它只能照 AI 的代码判断。`]
      const loot = Object.entries(files!).find((entry) => entry[0].includes("/loot_table/entities/"))?.[1]
      // The model's motions as the build writes them: the names and lengths in the generated animation file.
      const motions = Object.entries(files!).find((entry) => /\/animations\/[^/]+\.animation\.json$/.test(entry[0]))?.[1]
      const clips = typeof motions === "string" ? Object.entries((JSON.parse(motions) as { animations?: Record<string, { animation_length?: number }> }).animations ?? {}).map(([name, value]) => ({ name: name.split(".").at(-1)!, length: value.animation_length ?? 0 })) : []
      const entity = project.entities[index]!
      const bindings = creatureBindings(entity.behavior === "hostile" ? entity : { abilities: [], flight: entity.flight, habits: entity.habits }, clips, project.logic.filter((rule) => rule.entity_id === entity.id), (id) => effectLookup(project)(id)?.title ?? null, (id) => soundLookup(project)(id)?.title ?? null)
      return creatureContractLines({ title: thing.title, key: thing.key!, aliases: thing.aliases }, readGeneratedCreature(java, typeof loot === "string" ? loot : null), named, bindings, (id) => effectLookup(project)(id)?.title ?? null)
    }),
  )
  return [
    ...read.flat(),
    ...accessorContractLines(
      projectContentSource({
        modId: project.mod_id,
        items: things.flatMap((thing) => (thing.kind === "item" && thing.key ? [thing.key] : [])),
        blocks: things.flatMap((thing) => (thing.kind === "block" && thing.key ? [thing.key] : [])),
        creatures: things.flatMap((thing) => (thing.kind === "creature" && thing.key && thing.registry ? [{ key: thing.key, registry: thing.registry }] : [])),
        ...(things.some((thing) => thing.kind === "effect") ? { effects: true } : {}),
      }),
    ),
  ]
}
