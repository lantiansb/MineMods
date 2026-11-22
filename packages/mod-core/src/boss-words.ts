/**
 * The fixed vocabulary and every limit of the boss runtime (boss runtime, 10-12): a hostile creature's bar, wake-up,
 * phases, death show and leash, and the two ability events that shake a player's screen and throw up pieces of the
 * ground. The schema, the generated Java, the checks and the words on the cards all read from here.
 * Every number in this file comes from docs/specs/2026-10-12-boss-runtime.md (the section named on
 * each line); nothing here knows a subject. No imports, so the app's window can read it.
 */

/** The boss bar colours and notch styles Minecraft's `BossEvent.BossBarColor` / `BossEvent.BossBarOverlay` have, each with the word a person knows it by (spec: 数据, `bar`). */
export const BOSS_BAR_COLORS = { pink: "粉色", blue: "蓝色", red: "红色", green: "绿色", yellow: "黄色", purple: "紫色", white: "白色" } as const
export const BOSS_BAR_COLOR_IDS = Object.keys(BOSS_BAR_COLORS) as [keyof typeof BOSS_BAR_COLORS, ...(keyof typeof BOSS_BAR_COLORS)[]]
export const BOSS_BAR_STYLES = { progress: "一整条", notched_6: "分 6 格", notched_10: "分 10 格", notched_12: "分 12 格", notched_20: "分 20 格" } as const
export const BOSS_BAR_STYLE_IDS = Object.keys(BOSS_BAR_STYLES) as [keyof typeof BOSS_BAR_STYLES, ...(keyof typeof BOSS_BAR_STYLES)[]]

/**
 * What a boss may be told, and what the generated runtime holds itself to.
 * - `wake`, `seconds`, `phases`, `below`, `speed`, `damage`, `death`, `bursts`, `leash`, `reset`: the ranges of the
 *   data in the spec's 「数据：生物 runtime 里的 boss」 block.
 * - `battle`: blocks. The spec says a boss resets when no player is "在战斗范围里" for `reset` seconds but gives no
 *   number; it is the widest wake distance (32), the farthest a player can be and still have been part of the fight; it is also at least `ABILITY_LIMITS.distance` (32), the farthest any ability reaches, so a creature that still fights a target is never counted as having none (a test).
 * - `watch`: ticks between two looks for a player near the boss (waking up, the leash); a look costs a scan of the
 *   world's players, so it is not made every tick. Half a second is well inside the shortest time that matters (0.5 s).
 * - `combat`: ticks a boss stays "in combat" (the sky stays dark) after it last had somebody to fight: five seconds,
 *   so the sky does not flicker between two swings. The spec only says the sky is dark during the fight.
 * - `opening.floor`: seconds. The least time a boss with a named first attack (`intro.opening`) is given, from the moment the fight begins, to start it before
 *   the other abilities are let go. It is the ten seconds the game's own generated creatures give any chase or walk before they give up
 *   (`FLIGHT_LIMITS.giveUpSeconds`, a test says the two agree; this file has no imports), enough to close in on a target that stands outside the
 *   ability's window. The rest of the bound is read from the ability and the flight (`bossOpeningTicks`).
 */
export const BOSS_LIMITS = {
  wake: { min: 4, max: 32 },
  seconds: { min: 0.5, max: 10 },
  phases: 3,
  below: { min: 0.05, max: 0.95 },
  speed: { min: 1, max: 2 },
  damage: { min: 1, max: 3 },
  death: { min: 1, max: 10 },
  bursts: 20,
  leash: { min: 16, max: 96 },
  reset: { min: 5, max: 120 },
  battle: 32,
  watch: 10,
  combat: 100,
  opening: { floor: 10 },
} as const

/**
 * The limits of the four optional boss fields (`boss-base.ts`):
 * - `cap`: the most life one blow may take (`damage_cap`): no blow kills it outright, however big. 1024 is the game's own most life (`Attributes.MAX_HEALTH`).
 * - `dps`: the most life it loses in `seconds` seconds (`dps_cap`), counted over the last `seconds` seconds at every blow (a sliding window, by ticks), so no build melts it.
 *   30 seconds at most: the window is kept as one slot a tick (600 at most), and a longer one would be a fight's length, not a rate.
 * - `regen`: life a second it gets back (`per_second`) once it has lost none for `after` seconds; `in_fight` false only while it has nobody to fight. 50 a second is a
 *   1024-life boss whole again in 20 seconds, the fastest worth writing; 120 seconds of quiet, the longest leash reset.
 * - `scaling`: per player more than one within `radius` blocks (up to `players` counted, the first included), its whole life and its damage grow by `health` and `damage`
 *   (shares of its own). Counted every `BOSS_LIMITS.watch` ticks of the fight; its life keeps its share as the most changes, so the bar and the lines of its phases stay true.
 *   The game holds the most life to 1024 whatever is asked.
 */
export const BOSS_BASE_LIMITS = {
  cap: { min: 1, max: 1024 },
  dps: { amount: { min: 1, max: 1024 }, seconds: { min: 1, max: 30 } },
  regen: { per_second: { min: 0.1, max: 50 }, after: { min: 0, max: 120 } },
  scaling: { health: { min: 0, max: 2 }, damage: { min: 0, max: 1 }, radius: { min: 8, max: 64 }, players: { min: 2, max: 16 } },
  /** The game's own most life a creature may have (`Attributes.MAX_HEALTH`'s ceiling). */
  most: 1024,
} as const

/** The states of a boss the server keeps and every player's game is told (spec: 登场, DORMANT、INTRO、FIGHT; CHANGE is the pause of a phase change, the spec's 变身 seconds). */
export const BOSS_STATES = { dormant: 0, intro: 1, fight: 2, change: 3 } as const

/**
 * The two ability events that make a fight felt (spec: 招式里新增两种事件).
 * - shake: `strength` 0.2..8 (Boss 能力 8; it was 3), `radius` 4..48 blocks, `seconds` 0.1..3; the camera's sum is capped at `cap` (8; `legacyCap`, 3, for a project written as before).
 * - debris: `radius` 1..8, `count` 1..24; `alive` is the most pieces in the whole world at once (spec: 最多 64 个);
 *   a piece is shown `scale` blocks wide and lives `life` ticks (spec: 缩小到 0.3–0.5, 8–20 tick).
 * - `ring`: the dust ring is laid at this many points at most, and at least `ringLeast`: a ring is one packet to every player
 *   near for each point, so it is bounded; 32 points is a point every 1.5 blocks on the widest ring (radius 8).
 */
export const SHAKE_LIMITS = {
  strength: { min: 0.2, max: 8 },
  radius: { min: 4, max: 48 },
  seconds: { min: 0.1, max: 3 },
  cap: 8,
  /**
   * Boss 能力 8: a project whose shakes all stay within what could be written before (strength up to 3, none of `roll`, `fov`, `falloff`, `frequency`)
   * keeps the runtime it always had, byte for byte, and its sum stays capped at this (spec: 上限 3). Any shake past that gets the runtime capped at `cap`.
   */
  legacyCap: 3,
  /** Degrees the screen turns about the line of sight at the centre and the start of a shake (it swings both ways); several are added, never beyond `max`. */
  roll: { max: 10 },
  /** Degrees the field of view is widened (positive) or narrowed (negative) at the centre and the start, settling with the shake; several are added, never beyond `max` either way. */
  fov: { max: 10 },
  /** How fast it shakes, against the shake as it always was (1): 0.25 is a slow sway, 4 a fast rattle. */
  frequency: { min: 0.25, max: 4 },
} as const
export const DEBRIS_LIMITS = { radius: { min: 1, max: 8 }, count: { min: 1, max: 24 }, alive: 64, scale: { min: 0.3, max: 0.5 }, life: { min: 8, max: 20 }, ring: 32, ringLeast: 8 } as const

/**
 * An ability that breaks blocks of the world (`break`, 铁额撞 smashing a pillar): an upright cylinder `radius` blocks round its place and `height` blocks up from it.
 * `hardness` is the hardest block it breaks, by the game's own hardness (dirt 0.5, stone and logs 1.5–2, cobblestone and bricks 2, iron block 5, obsidian 50); the
 * limit keeps a boss from mining through what a player builds of obsidian. `blocks`: the most one event breaks, so a wide one cannot stall the server.
 * It never breaks a block with a store (chests, furnaces: a block entity), one the game calls unbreakable, or a fluid; and only where the world lets mobs change blocks.
 */
export const BREAK_LIMITS = { radius: { min: 0.5, max: 4 }, height: { min: 1, max: 8 }, hardness: { min: 0.1, max: 10 }, blocks: 256 } as const

/**
 * Calling a boss up (`summon`): `cooldown` seconds before the same item calls again (0: at once); `ahead`, blocks in front of the player it appears at; `near`, while
 * one of its kind lives within this many blocks of the player nothing more is called (the boss bar's own reach is 48, so a second would fight the same player);
 * `rise`, how many blocks up from where it should stand it looks for room for its body.
 */
export const SUMMON_LIMITS = { cooldown: { min: 0, max: 600 }, ahead: { min: 1, max: 16 }, near: 96, rise: 6 } as const

/** A phase's rule for which abilities it may start: a whole list (`abilities`), or what it adds to and takes from the phase before it (`add`, `remove`). */
export type BossPhaseRule = { abilities?: readonly string[] | undefined; add?: readonly string[] | undefined; remove?: readonly string[] | undefined }

/** A phase written as a change of the one before it (`add` or `remove`), not as a whole list. */
export const bossPhaseRelative = (phase: BossPhaseRule) => Boolean(phase.add?.length || phase.remove?.length)

/**
 * Which abilities and combos (by id) a boss may start in each stage of its fight: [first phase, after the first line, after the second, ...]. `ids` are all it has, in order.
 * - The first phase, before any line of life is crossed: the ones no phase lists in `abilities` or `add`, and all of them when every one is (a boss is never left without a move).
 * - A phase with a whole list (`abilities`, not empty): exactly that list. One with neither a list nor a change: all of them (a phase that only changes how it looks and how fast it is).
 * - A phase with `add` / `remove`: the stage before it, with `add` put in and `remove` taken out ("原有两招之外再加一招" is `add` with that one).
 * The one rule the masks of the generated Java, the document's checks, the words and the guide's test steps all read. What is wrong with a rule (an id it does not have,
 * adding one already there, removing one not there, a stage left with none) is the document's check's to say (`bossPhaseIssues`); here such a part is only skipped.
 */
export function bossPhaseIds(phases: readonly BossPhaseRule[], ids: readonly string[], strict = false) {
  const listed = new Set(phases.flatMap((phase) => [...(phase.abilities ?? []), ...(phase.add ?? [])]))
  const free = ids.filter((id) => !listed.has(id))
  const stages: string[][] = [strict || free.length ? free : [...ids]]
  for (const phase of phases) {
    const before = stages.at(-1)!
    if (bossPhaseRelative(phase)) {
      const gone = new Set(phase.remove ?? [])
      stages.push(ids.filter((id) => (before.includes(id) && !gone.has(id)) || (phase.add ?? []).includes(id)))
    } else stages.push(phase.abilities && (strict || phase.abilities.length) ? [...phase.abilities] : [...ids])
  }
  return stages
}

/**
 * Which abilities (by id) a boss may start in its first phase, the one before any line of life is crossed (`bossPhaseIds`, its first stage). The masks of the generated Java,
 * the document's check on `intro.opening` and the guide's test steps all read it.
 */
export const bossFirstPhaseIds = (phases: readonly BossPhaseRule[], ids: readonly string[], strict = false) => bossPhaseIds(phases, ids, strict)[0]!

/**
 * What is wrong with the rules of a boss's phases against what it has (`ids`: its abilities and combos), in the person's words, each with where it is.
 * A whole list and a change are not written together; every id is one it has, written once; an id added is not already there and one removed is;
 * and a change leaves the phase with at least one.
 */
export function bossPhaseIssues(phases: readonly BossPhaseRule[], ids: readonly string[], strict = false) {
  const found: { path: (string | number)[]; message: string }[] = []
  const known = new Set(ids)
  const stages = bossPhaseIds(phases, ids, strict)
  phases.forEach((phase, index) => {
    const at = (field: string, place?: number) => ["boss", "phases", index, field, ...(place === undefined ? [] : [place])]
    const before = stages[index]!
    const said = (field: "abilities" | "add" | "remove", list: readonly string[] | undefined, more: (id: string) => string | null) =>
      (list ?? []).forEach((id, place) => {
        if (!known.has(id)) found.push({ path: at(field, place), message: `第 ${index + 1} 个阶段的 ${field} 里写的 ${id} 在这个生物的招式（abilities）和连招（combos）里都找不到` })
        else if (list!.indexOf(id) !== place) found.push({ path: at(field, place), message: `第 ${index + 1} 个阶段的 ${field} 里不要把 ${id} 写两遍` })
        else {
          const wrong = more(id)
          if (wrong) found.push({ path: at(field, place), message: wrong })
        }
      })
    if (phase.abilities?.length && bossPhaseRelative(phase))
      found.push({ path: at("abilities"), message: `第 ${index + 1} 个阶段同时写了整份名单（abilities）和增减（add / remove）：二选一。想在上一阶段的基础上加招或减招，就只写 add / remove，abilities 不写或写空数组；想整份重列，就只写 abilities` })
    said("abilities", phase.abilities, () => null)
    said("add", phase.add, (id) => (before.includes(id) ? `第 ${index + 1} 个阶段 add 了 ${id}，可是上一阶段已经能用它了：add 只写上一阶段还不能用的。上一阶段能用的是：${before.join("、")}` : null))
    said("remove", phase.remove, (id) => (!before.includes(id) ? `第 ${index + 1} 个阶段 remove 了 ${id}，可是上一阶段本来就不能用它：remove 只写上一阶段能用的。上一阶段能用的是：${before.join("、")}` : null))
    ;(phase.add ?? []).forEach((id, place) => (phase.remove ?? []).includes(id) && found.push({ path: at("add", place), message: `第 ${index + 1} 个阶段把 ${id} 既写进 add 又写进 remove：只写一边` }))
    if (!strict && bossPhaseRelative(phase) && !stages[index + 1]!.length) found.push({ path: at("remove"), message: `第 ${index + 1} 个阶段 remove 之后一招都不剩了：至少留一招，或者用 add 补上` })
  })
  return found
}

/**
 * A boss's lair (巢): a structure of the world's own generation that holds a round platform and the boss on it. Every number below is
 * derived, not chosen; the generated Java (`fabric/lair.ts`) reads `search`, `step`, `check` and `support` from here, so the two cannot disagree.
 * - `separation` is never written: a structure set's `separation` is a quarter of its `spacing`, rounded up (`lairSeparation`), as the game's own
 *   structure sets with a spacing of 32 or more write it: igloo, desert pyramid, jungle temple, swamp hut and pillager outpost 32/8, the woodland mansion 80/20.
 * - `spacing` (chunks, the average distance between two lairs; `minecraft:random_spread`): two starts of neighbouring regions are at least `separation + 1` chunks apart (a start
 *   lies at 0 to `spacing - separation - 1` chunks into its region). The centre of a lair is searched up to `search` blocks from the middle of its start chunk, so two centres may
 *   be as near as `16 * (separation + 1) - 2 * search` blocks; the platforms of the two biggest lairs (`radius.max` each) stay apart when that is more than `2 * radius.max`:
 *   16 * (separation + 1) > 2 * 32 + 2 * 32, so separation 8 and spacing 29 at least; 32 is the next spacing the game itself uses (the igloo's). 80 is the greatest spacing
 *   of any structure of the game (the woodland mansion's): a lair rarer than the rarest structure would hardly ever be met.
 * - `radius` (blocks): 3 is the smallest platform that still has a middle, a ring of floor round it and a rim on the outside (7 across); 32 keeps the whole lair within
 *   `search + radius` = 64 blocks (4 chunks) of the middle of its start chunk, inside the 8 chunks within which the game finds the starts that reach a chunk.
 * - `floor`: 1 to 4 blocks, the most that read as a pattern rather than as noise; the same most as the items that lure a follower (`CREATURE_LIFE_LIMITS.tempt`).
 * - `clearance` (blocks of air above the floor): at least 3, a creature of a player's height with a block of room above its head (the game's smallest ordinary mobs stand
 *   under 2); at most 24, the tallest collision box a creature may have (`HITBOX_LIMITS.size`, 16) and 8 blocks more for a boss that rises from it.
 * - `search` (blocks): how far from the middle of its start chunk the highest ground is looked for: two chunks, which keeps the platform inside the chunks above and is the
 *   distance within which a peak still counts as the place of the start. Before anything else the biome is looked at in the middle and at four points of that circle, so a region
 *   none of whose ground is of the lair's biomes costs five measures, not the whole grid (epic game2: /locate held the server 44 seconds).
 * - `step` (blocks): the grid the highest ground is looked for on; the terrain generator's noise cell is 4 blocks wide, so every second cell is looked at. `check`: the grid the
 *   platform's support is checked on, the same every second cell (8): what it guards against is a gorge too deep to build down into, and one narrower than two cells of the
 *   terrain's noise is filled down as far as `support` reaches like any other column (epic game2: the 4-block grid was 225 measures of the 275 a region took).
 * - `support` (blocks): how deep a platform may need to be held up, and how deep it is built down: twice the greatest radius, the steepest slope worth building on being two blocks of
 *   fall for every block across; a lair that would stand on stilts longer than that over a gorge is not made.
 * - `rim` is one block high and `floor` one block thick: nothing else of the platform is written, so a lair is as light as the ground it stands on.
 */
export const LAIR_LIMITS = {
  spacing: { min: 32, max: 80 },
  radius: { min: 3, max: 32 },
  floor: { min: 1, max: 4 },
  clearance: { min: 3, max: 24 },
  search: 32,
  step: 8,
  check: 8,
  support: 64,
} as const

/** The `separation` of a lair's structure set: a quarter of its spacing, rounded up (see `LAIR_LIMITS`). */
export const lairSeparation = (spacing: number) => Math.ceil(spacing / 4)

/**
 * Boss 能力 10: what a boss's phases may change of its model, and the parts it drops.
 * - `bones`: the most bones one phase may hide or show (each list); `touched`: the most bones a boss may touch in all (hidden, shown or dropped): every player's
 *   game is told which are dropped as one number, a bit a bone, so 30 (an int's bits, the sign left alone).
 * - `drops`: the most parts one phase drops when it begins.
 * - `stay`: seconds a dropped part lies in the world before it is gone (it falls first).
 * - `glow`: seconds a phase's glow takes to go from `from` to `to` (0: at once).
 * - `alive`: the most dropped parts in the whole world at once; more are not made (the bone is still hidden).
 */
export const BOSS_LOOK_LIMITS = { bones: 16, touched: 30, drops: 4, stay: { min: 1, max: 60 }, glow: { min: 0, max: 10 }, alive: 32 } as const
