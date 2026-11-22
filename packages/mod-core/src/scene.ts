import { posedCorners } from "@minemods/studio-ai/model-motion"
import { FLIGHT_LIMITS, turnRadius } from "./flight-words"
import { creatureName } from "./gameplay"

/**
 * 「测试场」: the smallest game a built mod can be looked at in — the built jar itself, the mods it needs and
 * nothing else, in a flat empty world with everything the mod adds set out in rows. One plan serves two
 * users: a check that runs without a window (the game's own server, driven over its console) for an AI,
 * and the same world opened in the game for the person. Everything here is plain data and words: which
 * commands set the things out, what the game says back when one worked, and how a log is read. No Node APIs.
 *
 * Nothing in it knows any subject: a thing is placed by its kind (creature, block, item) and its registry
 * name, and judged only by what the game itself answered.
 */

export const SCENE = {
  /** The folder of the world inside the instance's `saves`, and what `--quickPlaySingleplayer` is given. ASCII: it is typed on a command line. */
  world: "test_scene",
  /** The classic flat world: bedrock, two dirt, grass at y=-61; things stand at y=-60. */
  ground: -60,
  /** Blocks between two blocks in their row; between two creatures at least this many, more for a wide one. */
  gap: { block: 2, creature: 6 },
  /**
   * Everything stands in one row across the person's view, side by side so nothing hides anything (round 27: one thing behind
   * another hid it): items on the right, blocks in the middle, creatures on the left (they face +Z, so +X is on their left).
   * `near` is the closest the row comes (round 26–29: at 6 a block, its name and a chest are all in the first look). When the row
   * is wider than the view there, it moves back until it fits (broad1, round 35: creatures set out past the edge were not in
   * the first look): the default view is 70° high, about 51° to each side at 16:9, so at distance d a row reaches `view` × d to
   * each side. broad2: with the edge of a pen a degree inside the view, a creature walking to it went out of the picture three
   * seconds later, so the reach counts the creature's own half-width too and `view` is tan 42°, nine degrees inside the edge.
   */
  near: 6,
  view: 0.9,
  /**
   * The same for height: the game's default view is 70° high, so 35° above the eye line (the person stands looking straight ahead), and the same nine
   * degrees are kept inside the edge as at the sides: tan 26°. A creature is in the first look when its top is within `rise` times the distance, above the
   * eye (`eye`, blocks above the ground: the height of a standing player's eyes in the game, 1.62). Below the eye line the ground is in view for any height.
   */
  rise: 0.488,
  eye: 1.62,
  /**
   * Items float in the row as themselves, facing the person, so the first look shows them (broad1, round 35: in a closed chest
   * none was seen). Past this many the rest are in the chests only: a row of 29 would stand too far off to see any. Eight fill
   * about the width of the view at `near`.
   */
  shown_items: 8,
  /** One chest holds 27 stacks. */
  chest: 27,
  /**
   * How long the things are left alone before they are asked about again, in seconds. 10 s is 200 game ticks:
   * a creature that removes itself when nobody is near (the game checks once a tick, at random within 600
   * ticks at most beyond 32 blocks, at once beyond 128) is not caught by this — the check has no player at
   * all, so anything that needs one near says nothing here. It catches what goes wrong by itself: falling
   * through the ground, dying on the spot, an error on its first ticks.
   */
  settle: 10,
  /**
   * broad8: a flier is not penned (it flies over a wall), so by the time the check saved the world (10 s after placing) the eagle had flown off and was
   * not in the first look. A creature that flies and has no home in its document is told to keep within this many blocks of where it was put (the
   * NBT value `FlightRoam`, read by the generated flier). 8 is the smallest home radius the data allows (`HABIT_LIMITS.radius.min`), so a flier is no
   * more free here than the smallest home a document can give it, and about the radius of the pen of a creature a few blocks wide (`penRadius`: 3 to 5):
   * the row is laid out so that this radius round its place is inside the view. It is the least a roam is: a flier that cannot fly a circle of its own
   * inside it is given the room it does need (`flightRoam`), which is why small fliers keep exactly this and a giant one has more.
   */
  roam: 8,
  /**
   * Why a flier was out of the first look (the lava wyvern of the tester's run): put on the ground in view, it rolled the mood for the air at once (`air_share`, 0.6 of
   * the time) and rose to a band of 10 to 40 blocks, above the 35° the person sees over the eye line when looking straight ahead (the row would have to stand
   * (40 + its height - `eye`) / `rise` = 79 blocks back and more, 200 for the highest band the data allows (96), where the game is sent only 6 chunks = 96 blocks: `view-distance` below), or, a boss with a
   * wake-up, it walked its roam toward the person, came inside the wake-up distance and showed itself circling high over the person, behind them. Neither
   * is about the picture of the row, so the flier is kept down instead: it is summoned in the mood to stay on the ground (the NBT values `FlightState`, `FlightMoodAir`
   * and `FlightMoodLeft` the generated flier saves its mood with), walking within its roam, the creature the row was laid out for, for this many seconds, and goes up by
   * itself after. 90 s: the 10 s the check lets it settle before the world is saved (`settle`), the loading of the terrain the person waits for (tens of seconds on a
   * first start) and a first look of more than 30 s after that, a screenshot at the start and others at 3 s and more. Whatever it is told to do (a fight, a request of
   * the project's code, a boss's wake-up) is not held: that is not the mood.
   */
  look: 90,
  /** Seconds a first start may take before it is called stuck: the game remaps itself on the first run. */
  boot: 420,
  /** Seconds each answer is waited for. */
  answer: 20,
  /** Lines of the game's log kept as the tail of a report. */
  tail: 60,
} as const

export type SceneKind = "creature" | "block" | "item"
export type SceneThing = { kind: SceneKind; id: string; title: string; at: readonly [number, number, number] }
/** One line sent to the game's console. `ok` is how the game's own answer reads when it worked; `about` is the index of the thing it is about. */
export type SceneStep = { command: string; about?: number; ok?: string; ask?: "there" | "where" | "health" | "saved" | "label" }
export type ScenePlan = { things: SceneThing[]; place: SceneStep[]; ask: SceneStep[]; close: SceneStep[]; region: readonly [number, number, number, number] }

type Hitbox = { core?: { width?: number; height?: number } | null; parts?: readonly { forward: number; up: number; left: number; width: number; height: number }[] | null }
type Content = {
  mod_id: string
  entities: readonly { id: string; name: string; hitbox?: Hitbox | null; behavior?: string; boss?: { intro: { wake_distance: number } | null } | null; flight?: unknown }[]
  blocks: readonly { identifier: string; name: string }[]
  items: readonly { identifier: string; name: string }[]
  /** The documents of the project: a creature's model is among them (its asset has the creature's id), which is how big it looks. Left out: only the hitbox says. */
  workspace?: { assets: readonly { id: string; document: unknown }[] }
}

const row = (count: number, gap: number) => Array.from({ length: count }, (_, index) => index * gap - Math.floor(((count - 1) * gap) / 2))
const quote = (text: string) => JSON.stringify(text).replaceAll("\\", "\\\\").replaceAll("'", "\\'")
/**
 * Round 33 and 34: a sign's letters could not be read from where the person first stands; round 35: a creature's name tag (the
 * game's fixed size) could not either. Every name is shown the same way: a floating label that always faces the camera, on a dark
 * backing, `SCENE_LABEL_SCALE` times a name tag at `SCENE.near`, where round 35 read the blocks' names; a row set further back
 * gets them larger in step with its distance, so they look the same size. A block's floats just above it (nothing covers its
 * faces), an item's above the item, and a creature's rides on it, so it goes where the creature goes.
 */
export const SCENE_LABEL_SCALE = 1.5
/**
 * broad4 w1: two blocks side by side had their names drawn over each other ("苔藓石砖" and "萤火虫玻璃灯笼" at two blocks apart),
 * so neither could be read. A name's width, in blocks, at scale 1: the game draws text at a fortieth of a block a font pixel (as a
 * name tag); a Chinese character is 9 font pixels wide with its spacing, a Latin one about 6, and the dark backing adds a pixel
 * each side. Neighbours in the row stand far enough apart for both names, with half a block between them.
 */
const LABEL_PIXEL = 1 / 40
const labelWidth = (title: string, scale: number) => ([...title].reduce((sum, char) => sum + (/[\u2E80-\uFFFF]/u.test(char) ? 9 : 6), 0) + 2) * LABEL_PIXEL * scale
/** An item shown in the row, at `SCENE.near`: about the size of a held one. Scaled with the row's distance like the names. */
export const SCENE_ITEM_SCALE = 1
const scaled = (scale: number, lift = 0) => `transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,${lift}f,0f],scale:[${scale}f,${scale}f,${scale}f]}`
const label = (at: readonly [number, number, number], title: string, scale: number) =>
  `summon minecraft:text_display ${at[0] + 0.5} ${at[1] + 0.25} ${at[2] + 0.5} {text:'${quote(title)}',billboard:"center",${scaled(scale)}}`
/**
 * The tag on a name that rides a creature, and only on those: a block's and an item's names stand by themselves and stay.
 * broad21: a creature's name rides on it as a passenger, and a passenger whose vehicle is removed (the creature died, was killed, went) is let go and is a
 * standalone entity from then on: the boss was gone, its bar was gone, and its name hung in the air at the size of a boss's. A rider is tied to the creature by
 * nothing but the riding, so the world is given a rule about exactly that (`SCENE_DATAPACK`): a tagged name that rides nothing is removed.
 */
export const SCENE_RIDER_TAG = "minemods_scene_label"
// Lifted half a block off the creature's top, where a name tag sits.
const rider = (title: string, scale: number) => `Passengers:[{id:"minecraft:text_display",Tags:["${SCENE_RIDER_TAG}"],text:'${quote(title)}',billboard:"center",${scaled(scale, 0.5)}}]`
const shownItem = (at: readonly [number, number, number], id: string, scale: number) =>
  `summon minecraft:item_display ${at[0] + 0.5} ${at[1] + 1.2} ${at[2] + 0.5} {item:{id:"${id}",count:1},billboard:"center",${scaled(scale)}}`
/** Round to two places, the way a scale is written into a command. */
const twoPlaces = (value: number) => Math.round(value * 100) / 100

/** How big a creature looks, in blocks: `half` the farthest any of it reaches from its middle sideways (it turns to face any way), `height` how tall it stands. */
export type CreatureSize = { half: number; height: number }

/** One thing to set out, by the name the game knows it under (`mod:name`). `width` is a creature's own, in blocks; it only spaces the row. */
export type SceneEntry = {
  kind: SceneKind
  id: string
  title: string
  width?: number
  /** A boss that starts asleep wakes when a player comes within this many blocks (boss runtime, 10-12). */
  wake?: number
  /** A creature that flies is not penned: two blocks of wall cannot keep it in, and it takes off and sets down where it likes (flight, 10-12). It is told to keep within a roam of where it is put instead (`flightRoam`). */
  flies?: boolean
  /** The radius, in blocks, of the tightest circle a flier can fly (`turnRadius`): what its roam is made from. Left out: the data does not say, and the roam is `SCENE.roam`. */
  turning?: number
  /** How big it looks, when the project says (`creatureSize`): what the distance of the row is made from, besides its width. Left out: only `width`. */
  size?: CreatureSize
}

const BLOCK = 16
// Moments of a motion looked at for how far it reaches: the keys and the midpoints between them, at most this many of them evenly spread (`SAMPLES` of `model-motion.ts`: the same bound on a clip).
const REACH_SAMPLES = 32
type Pose = { name: string; length: number; channels: readonly { bone: string; keyframes: readonly { time: number }[] }[] }
type Model = { bones: Parameters<typeof posedCorners>[0]["bones"]; animations?: readonly Pose[] }
const isModel = (document: unknown): document is Model => !!document && typeof document === "object" && (document as { kind?: unknown }).kind === "model" && Array.isArray((document as { bones?: unknown }).bones)
/** The clips a flier is seen in: every one the document names for flying (not a name that is not played, which `flightMotions` leaves out, but a clip it has is no harm). */
const flightClips = (flight: unknown): string[] => {
  const { takeoff, land, clips } = (flight ?? {}) as { takeoff?: { clip?: unknown }; land?: { clip?: unknown }; clips?: Record<string, unknown> }
  return [takeoff?.clip, land?.clip, ...Object.values(clips ?? {})].filter((name): name is string => typeof name === "string")
}

/**
 * How big a creature looks, from what the project says of it: its hitbox (the core's width and height; each part's box, however far out it stands) and
 * its model, in the pose it is built in and, for a flier, in every pose of the motions it flies with (wings are folded at rest and spread in the air; a
 * wingspan is that of the spread ones). The model's corners are in pixels (16 to a block), the hitbox's in blocks. Null when neither says anything.
 */
export function creatureSize(entity: { id: string; hitbox?: Hitbox | null; flight?: unknown }, workspace: Content["workspace"]): CreatureSize | null {
  const found: CreatureSize[] = []
  const core = entity.hitbox?.core
  if (core && typeof core.width === "number") found.push({ half: core.width / 2, height: typeof core.height === "number" ? core.height : 0 })
  for (const part of entity.hitbox?.parts ?? []) found.push({ half: Math.hypot(part.left, part.forward) + part.width / 2, height: part.up + part.height })
  const model = workspace?.assets.find((asset) => asset.id === entity.id)?.document
  if (isModel(model)) {
    const wanted = new Set(entity.flight ? flightClips(entity.flight) : [])
    const clips = (model.animations ?? []).filter((clip) => wanted.has(clip.name))
    const moments = (clip: Pose) => {
      const keys = [...new Set([0, clip.length, ...clip.channels.flatMap((channel) => channel.keyframes.map((key) => Math.min(key.time, clip.length)))])].sort((a, b) => a - b)
      const all = keys.flatMap((time, index) => (index ? [(keys[index - 1]! + time) / 2, time] : [time]))
      return all.length <= REACH_SAMPLES ? all : Array.from({ length: REACH_SAMPLES }, (_, index) => all[Math.round((index * (all.length - 1)) / (REACH_SAMPLES - 1))]!)
    }
    const corners = [posedCorners(model, null), ...clips.flatMap((clip) => moments(clip).map((time) => posedCorners(model, clip as Parameters<typeof posedCorners>[1], time)))].flat()
    // A giant flier's corners over every sampled pose run to hundreds of thousands: folded, never spread into one call (epic game2: a RangeError at the engine's argument limit).
    if (corners.length) found.push({ half: corners.reduce((most, point) => Math.max(most, Math.hypot(point[0], point[2])), Number.NEGATIVE_INFINITY) / BLOCK, height: corners.reduce((most, point) => Math.max(most, point[1]), 0) / BLOCK })
  }
  return found.length ? { half: Math.max(...found.map((value) => value.half)), height: Math.max(...found.map((value) => value.height)) } : null
}

/**
 * The radius of the area a flier is told to keep to, in blocks. It is the room its own turn needs: the tightest circle it can fly (`turning`), with the
 * margin it keeps when it circles (`FLIGHT_LIMITS.turnRoom`), has to fit inside the share of the roam that it picks the points it flies to from
 * (`FLIGHT_LIMITS.homeShare`); and never less than `SCENE.roam`, which is what every flier had, nor more than a roam may be (`FLIGHT_LIMITS.roam`).
 * A flier whose data says nothing of its turn, or turns tightly (a circle of 4 blocks or less is within the 8), keeps `SCENE.roam`.
 */
export const flightRoam = (turning?: number) => (turning === undefined ? SCENE.roam : Math.min(FLIGHT_LIMITS.roam.max, Math.max(SCENE.roam, Math.ceil((turning * FLIGHT_LIMITS.turnRoom) / FLIGHT_LIMITS.homeShare))))
/** The roam a creature of the plan is told to keep to; 0 for one that does not fly. */
export const roamOf = (entry: Pick<SceneEntry, "flies" | "turning">) => (entry.flies ? flightRoam(entry.turning) : 0)

/** A creature of the project as the plan sets it out. */
export function creatureEntry(project: Pick<Content, "mod_id" | "workspace">, entity: Content["entities"][number]): SceneEntry {
  const flight = entity.flight as { speed?: unknown; turn?: unknown } | null | undefined
  const size = creatureSize(entity, project.workspace)
  return {
    kind: "creature",
    id: `${project.mod_id}:${creatureName(entity)}`,
    title: entity.name,
    width: entity.hitbox?.core?.width,
    ...(entity.behavior === "hostile" && entity.boss?.intro ? { wake: entity.boss.intro.wake_distance } : {}),
    ...(entity.flight ? { flies: true } : {}),
    ...(flight && typeof flight.speed === "number" && typeof flight.turn === "number" && flight.turn > 0 ? { turning: turnRadius({ speed: flight.speed, turn: flight.turn }) } : {}),
    ...(size ? { size } : {}),
  }
}

/**
 * What is set out and how, from the saved project alone. The same project gives the same plan.
 * Creatures are summoned with `PersistenceRequired` so the world the person opens still has them; that the
 * creature keeps itself in the world without it is a separate fact the guide asks the person to look at.
 */
export function scenePlan(project: Content): ScenePlan {
  return scenePlanOf([
    ...project.blocks.map((block): SceneEntry => ({ kind: "block", id: `${project.mod_id}:${block.identifier}`, title: block.name })),
    ...project.items.map((item): SceneEntry => ({ kind: "item", id: `${project.mod_id}:${item.identifier}`, title: item.name })),
    ...project.entities.map((entity) => creatureEntry(project, entity)),
  ])
}

/**
 * The same plan from a plain list of registry names, for a mod that has no Studio project behind it (a Fabric
 * source tree somebody wrote by hand or with another tool). Whatever order the list is in, the rows are the
 * same: blocks, then items, then creatures, each kind in the order given.
 */
/**
 * Round 28: a creature that walks had wandered eight blocks off by the time the check asked where it was, and out of the
 * first look. Each stands in a pen of its own, wide enough for its width: it still walks, turns and shows its motion, and
 * it is where its name says. Round 30: a pen of fences hid the creature's legs, so the pen is made of glass panes, which are
 * seen through. broad23: the first pen was the game's invisible wall (barrier): the person walked up and swung at a boss they
 * could not see was walled in, and took the test scene for a game already started. A pen is something the person can see and
 * can go into, the same for every creature that has one: panes two high so nothing jumps it, and on the side that faces the
 * person a closed fence gate (the game's mobs open doors but not fence gates), with the block above it left open so the person
 * walks through. A pane stops a mob seeing the person, so a hostile creature in a pen stays quiet until the gate is opened:
 * the first look is of it standing under its name, and opening the gate is the person starting the trial. Its radius is half the
 * creature's width rounded up and two, so the widest one has a block to step in each way.
 */
export const penRadius = (width: number | undefined) => Math.ceil((width ?? 0.6) / 2) + 2
export const SCENE_PEN = { wall: "minecraft:glass_pane", gate: "minecraft:oak_fence_gate[facing=south,open=false]" } as const
const pen = (at: readonly [number, number, number], radius: number): SceneStep[] => {
  const [x, y, z] = at
  const edge = (from: readonly [number, number], to: readonly [number, number]) => ({ command: `fill ${from[0]} ${y} ${from[1]} ${to[0]} ${y + 1} ${to[1]} ${SCENE_PEN.wall}` })
  return [
    edge([x - radius, z - radius], [x + radius, z - radius]),
    edge([x - radius, z + radius], [x + radius, z + radius]),
    edge([x - radius, z - radius], [x - radius, z + radius]),
    edge([x + radius, z - radius], [x + radius, z + radius]),
    // The way in, in the middle of the side toward the person (who stands at the origin, so the near side is the lower z): a gate where the pane was, and nothing above it.
    { command: `setblock ${x} ${y} ${z - radius} ${SCENE_PEN.gate}` },
    { command: `setblock ${x} ${y + 1} ${z - radius} minecraft:air` },
  ]
}

export function scenePlanOf(list: readonly SceneEntry[]): ScenePlan {
  const y = SCENE.ground
  const creatureWidth = (id: string) => list.find((entry) => entry.id === id)?.width
  const sleeping = (id: string) => !!list.find((entry) => entry.id === id)?.wake
  const flies = (id: string) => !!list.find((entry) => entry.id === id)?.flies
  // The roam each flier is told, and how big each creature looks (null: the project does not say, then only its width counts, as before).
  const roamFor = (id: string) => roamOf(list.find((entry) => entry.id === id) ?? {})
  const sizeOf = (id: string) => list.find((entry) => entry.id === id)?.size ?? null
  const of = (kind: SceneKind) => list.filter((entry) => entry.kind === kind)
  // A creature with no width given is taken as a player-sized one (0.6), the same as its pen is.
  const widest = Math.max(0, ...of("creature").map((entry) => entry.width ?? 0.6))
  // Pens side by side with a block between them.
  // A creature that looks wider than its width (a model with a tail, wings) is given the same four blocks between it and the next, by how far it reaches each way.
  const reaches = Math.max(0, ...of("creature").map((entry) => 2 * (entry.size?.half ?? 0)))
  const apart = Math.max(SCENE.gap.creature, Math.ceil(widest) + 4, 2 * penRadius(widest) + 2, Math.ceil(reaches) + 4)
  // One row, right to left: the items shown, the blocks, then the pens, each kind spaced as before and the kinds two blocks apart.
  const shownCount = Math.min(of("item").length, SCENE.shown_items)
  const radius = penRadius(widest)
  const spans: { kind: SceneKind; width: number; index: number }[] = [
    ...Array.from({ length: shownCount }, (_, index) => ({ kind: "item" as const, width: SCENE.gap.block, index })),
    ...of("block").map((_, index) => ({ kind: "block" as const, width: SCENE.gap.block, index })),
    ...of("creature").map((_, index) => ({ kind: "creature" as const, width: apart, index })),
  ]
  // The names shown above the row: an item's (only those shown) and a block's. A creature's rides on it, inside its pen.
  const titleOf = (span: { kind: SceneKind; index: number }) => (span.kind === "creature" ? "" : of(span.kind)[span.index]!.title)
  const named = (span: { kind: SceneKind } | undefined) => !!span && span.kind !== "creature"
  // Boss runtime (10-12): a boss that starts asleep is set out further from where the person stands than it wakes at, so the first look is of it asleep and it is the person who walks up and wakes it; the scene never wakes it.
  // A flier is not penned: it walks its roam, which may be toward the person, and wakes (the game asks for a player within `wake` of its middle) when the nearest edge of its roam
  // is inside it, then shows itself circling high over the person: the row stands back by the roam as well. A creature that does not fly has no roam (0): the distance it had.
  const asleep = Math.max(0, ...of("creature").map((entry) => (entry.wake ? Math.ceil(entry.wake + roamOf(entry)) + 2 : 0)))
  // Neighbours stand far enough apart for both names at the size they are drawn (broad4 w1). Names grow with the distance and the
  // distance with the row's width, so the two are settled together: lay the row out for names of the size a distance gives, step
  // back as far as that row needs, and again until it no longer moves.
  const layout = (scale: number) => {
    const xs: number[] = []
    spans.forEach((span, index) => {
      const before = spans[index - 1]
      const step = !before ? 0 : before.kind !== span.kind ? (before.width + span.width) / 2 + 2 : span.kind === "creature" ? apart : SCENE.gap.block
      const names = named(before) && named(span) ? (labelWidth(titleOf(before!), scale) + labelWidth(titleOf(span), scale)) / 2 + 0.5 : 0
      xs.push(index === 0 ? 0 : xs[index - 1]! + Math.ceil(Math.max(step, names)))
    })
    const middle = xs.length ? Math.floor((xs[0]! + xs.at(-1)!) / 2) : 0
    const at = xs.map((x) => x - middle)
    // How far off the row stands: near, or further back until its widest reach (for a creature, its pen's edge and its own half-width; for a flier, which has no pen, the roam it is given) is inside the view, and its top is.
    // A creature that looks wider than its width is counted by how far it reaches; one the project says nothing of by its width, as before.
    const reachX = Math.max(0, ...at.map((x, index) => Math.abs(x) + (spans[index]!.kind === "creature" ? Math.max(radius, roamFor(of("creature")[spans[index]!.index]!.id)) + Math.max(Math.ceil(widest / 2), Math.ceil(sizeOf(of("creature")[spans[index]!.index]!.id)?.half ?? 0)) : 1)))
    // The person looks straight ahead from `SCENE.eye` high: a creature is whole in the first look when its top is within `rise` times the distance above the eye, counted to its nearest side.
    const reachUp = Math.max(0, ...of("creature").map((entry) => (entry.size ? Math.ceil((entry.size.height - SCENE.eye) / SCENE.rise + entry.size.half) : 0)))
    return { at, distance: Math.max(SCENE.near, Math.ceil(reachX / SCENE.view), reachUp, asleep) }
  }
  // A row whose names, at the size that keeps them as large as at `near`, are together wider than the view never settles (stepping
  // back grows them as fast as it makes room): it is laid out for names at their `near` size, and those that would then reach a
  // neighbour are drawn smaller (`nameScale`).
  let placed = layout(SCENE_LABEL_SCALE)
  for (let pass = 0, tried = placed; pass < 6; pass++) {
    const next = layout(SCENE_LABEL_SCALE * (tried.distance / SCENE.near))
    if (next.distance <= tried.distance) {
      placed = next
      break
    }
    tried = next
  }
  const at = placed.at
  const distance = placed.distance
  const grow = distance / SCENE.near
  const xOf = (kind: SceneKind, index: number) => at[spans.findIndex((span) => span.kind === kind && span.index === index)]!
  const blocks = of("block").map((entry, index): SceneThing => ({ kind: "block", id: entry.id, title: entry.title, at: [xOf("block", index), y, distance] }))
  // The chests stand right behind the items shown (or straight ahead when no item is shown), so what is shown can be taken too.
  const chests = Math.ceil(of("item").length / SCENE.chest)
  const shownXs = Array.from({ length: shownCount }, (_, index) => xOf("item", index))
  const chestCenter = shownXs.length ? Math.round((Math.min(...shownXs) + Math.max(...shownXs)) / 2) : 0
  const chestAt = row(chests, 2).map((x) => x + chestCenter)
  const chestZ = distance + 2
  const items = of("item").map((item, index): SceneThing => ({ kind: "item", id: item.id, title: item.title, at: [chestAt[Math.floor(index / SCENE.chest)]!, y, chestZ] }))
  const creatures = of("creature").map((entry, index): SceneThing => ({ kind: "creature", id: entry.id, title: entry.title, at: [xOf("creature", index), y, distance] }))
  const things = [...blocks, ...items, ...creatures]
  // What was held round a creature (8 blocks, 24 beyond its pen) was for the roam every flier had; a flier with more roam than that is held that much further out.
  const beyond = Math.max(0, ...of("creature").map((entry) => roamOf(entry) - SCENE.roam))
  const reach = Math.max(16, ...things.map((thing) => Math.abs(thing.at[0]) + 8), ...shownXs.map((x) => Math.abs(x) + 8)) + beyond
  const region = [-reach, -16 - beyond, reach, distance + radius + 24 + beyond] as const
  const labelScale = twoPlaces(SCENE_LABEL_SCALE * grow)
  // A row set further back grows its names with the distance (above); a name grown past the room beside it would cover its
  // neighbour's again (broad4 w1), so each name grows only as far as half a block short of the names next to it.
  const nameScale = (kind: SceneKind, index: number) => {
    const here = spans.findIndex((span) => span.kind === kind && span.index === index)
    const own = labelWidth(titleOf(spans[here]!), 1)
    const room = [here - 1, here + 1]
      .filter((other) => named(spans[other]))
      .map((other) => (Math.abs(at[other]! - at[here]!) - 0.5) / ((own + labelWidth(titleOf(spans[other]!), 1)) / 2))
    return twoPlaces(Math.min(SCENE_LABEL_SCALE * grow, ...room))
  }
  const itemScale = twoPlaces(SCENE_ITEM_SCALE * grow)
  const place: SceneStep[] = [
    { command: "gamerule doMobSpawning false" },
    { command: "gamerule doDaylightCycle false" },
    { command: "gamerule doWeatherCycle false" },
    { command: "time set 6000" },
    { command: "weather clear" },
    // Exactly there, facing the rows: the game otherwise puts a new player anywhere within ten blocks of it.
    { command: "gamerule spawnRadius 0" },
    { command: `setworldspawn 0 ${y} 0` },
    // What is not loaded cannot be changed, and what is not loaded does not tick.
    { command: `forceload add ${region[0]} ${region[1]} ${region[2]} ${region[3]}` },
    ...chestAt.map((x): SceneStep => ({ command: `setblock ${x} ${y} ${chestZ} minecraft:chest` })),
    // The items shown, each with its name above it.
    ...shownXs.flatMap((x, index): SceneStep[] => [
      { command: shownItem([x, y, distance], of("item")[index]!.id, itemScale) },
      { command: label([x, y + 2, distance], of("item")[index]!.title, nameScale("item", index)) },
    ]),
    ...things.flatMap((thing, about): SceneStep[] =>
      thing.kind === "block"
        ? // The name stands on the block, not in front of it: round 28's first look had every block's face behind its sign.
          [
            { command: `setblock ${thing.at[0]} ${thing.at[1]} ${thing.at[2]} ${thing.id}`, about, ok: "^Changed the block at " },
            { command: label([thing.at[0], y + 1, thing.at[2]], thing.title, nameScale("block", about)), about, ok: "^Summoned new ", ask: "label" },
          ]
        : thing.kind === "item"
          ? [{ command: `item replace block ${thing.at[0]} ${thing.at[1]} ${thing.at[2]} container.${items.indexOf(thing) % SCENE.chest} with ${thing.id}`, about, ok: "^Replaced a slot " }]
          : // broad6 w1: the pen's wall also stops a creature seeing out, so a boss in it never fought until the person opened the gate (broad23). A boss that starts
            // asleep stands still until the person walks up (and its leash brings it home), so it needs no pen and is left free to fight.
            // 10-12 flight: a creature that flies is left free too: it flies over a wall of two blocks, and a pen would only be in the way of its takeoff and landing.
            // broad6 w3: summoned facing the game's default (south, away from the person), a sleeping boss showed its back at the first look; every creature faces the person.
            // And it is kept on the ground for the first look (`SCENE.look`): on the ground in its roam is what the row is laid out for, a flier in the air is above the view and goes out of it.
            // broad8: and it is told to stay within its roam (`flightRoam`, at least `SCENE.roam` blocks) of where it stands, so it is still in view when the world is saved and opened.
            [...(sleeping(thing.id) || flies(thing.id) ? [] : pen(thing.at, penRadius(creatureWidth(thing.id)))), { command: `summon ${thing.id} ${thing.at[0]} ${thing.at[1]} ${thing.at[2]} {PersistenceRequired:1b,${flies(thing.id) ? `FlightState:0,FlightMoodAir:0b,FlightMoodLeft:${SCENE.look * 20},` : ""}Rotation:[180f,0f],${flies(thing.id) ? `FlightRoam:${roamFor(thing.id)}.0d,` : ""}${rider(thing.title, labelScale)}}`, about, ok: "^Summoned new " }],
    ),
  ]
  const ask = things.flatMap((thing, about): SceneStep[] =>
    thing.kind === "creature"
      ? [
          { command: `execute if entity @e[type=${thing.id}]`, about, ok: "^Test passed", ask: "there" },
          { command: `data get entity @e[type=${thing.id},limit=1] Pos`, about, ask: "where" },
          { command: `data get entity @e[type=${thing.id},limit=1] Health`, about, ask: "health" },
        ]
      : [],
  )
  return { things, place, ask, close: [{ command: "save-all flush", ok: "Saved the game", ask: "saved" }], region }
}

/**
 * The data pack the scene's world carries (1.21.1 reads data packs from `datapacks/` in the world folder, and a pack in it before the world is first made
 * is switched on with it). It belongs to the test world and to nothing else: the mod does not know it, and a mod built from the same project plays the same
 * with or without it. Every tick (the game runs the functions of the `minecraft:tick` tag each tick) it removes the names of the creatures that are gone:
 *   1. every name that was put on a creature (`SCENE_RIDER_TAG`) is marked as loose;
 *   2. every entity's passengers are unmarked, so the mark stays only on a name that rides nothing;
 *   3. the marked ones are killed (a text display has no death of its own: it is just gone).
 * Names that ride a living creature are unmarked in step 2 and never touched, so a creature that is alive keeps its name in the picture however it moves.
 * The marks are a tag of their own and are gone with the entity or at the end of the same tick; nothing else is read or changed. It is one tick of
 * a handful of entities in a flat empty world; the tick is the finest the game offers, and a name hung in the air for a second is what the person saw.
 * The pack lives at `<world>/datapacks/<folder>/<path>`.
 */
export const SCENE_DATAPACK = {
  folder: "minemods_scene",
  /** 1.21 and 1.21.1 read data packs of format 48. */
  format: 48,
  files: {
    "pack.mcmeta": `${JSON.stringify({ pack: { pack_format: 48, description: "MineMods 测试场：只清理已经离开的生物留下的名字，不改动模组" } }, null, 2)}\n`,
    "data/minecraft/tags/function/tick.json": `${JSON.stringify({ values: ["minemods_scene:tidy"] }, null, 2)}\n`,
    "data/minemods_scene/function/tidy.mcfunction": [
      "# 跟着生物的名字，生物不在了就一起清掉（生物被杀、消失，名字会变成独立的一个，留在原地）",
      `tag @e[type=minecraft:text_display,tag=${SCENE_RIDER_TAG}] add minemods_loose`,
      "execute as @e[type=!minecraft:text_display] on passengers run tag @s remove minemods_loose",
      "kill @e[type=minecraft:text_display,tag=minemods_loose]",
      "",
    ].join("\n"),
  },
} as const

/** The lines of `server.properties` the check starts the game's server with: one flat world, this computer only, no account asked. */
export function sceneServerProperties(port: number) {
  return [
    "level-type=minecraft\\:flat",
    "generate-structures=false",
    "gamemode=creative",
    "difficulty=easy",
    "online-mode=false",
    "server-ip=127.0.0.1",
    `server-port=${port}`,
    "enable-rcon=false",
    "enable-query=false",
    "enable-status=false",
    "spawn-protection=0",
    "allow-flight=true",
    "view-distance=6",
    "simulation-distance=6",
    "max-players=1",
    "sync-chunk-writes=true",
    "motd=MineMods test scene",
    "",
  ].join("\n")
}

/** `options.txt` for the person's first look: no tutorial, no first-run screens, and the game keeps running when the window is not in front. */
export const SCENE_OPTIONS = ["onboardAccessibility:false", "tutorialStep:none", "skipMultiplayerWarning:true", "joinedFirstServer:true", "pauseOnLostFocus:false", "narrator:0", "lang:zh_cn", ""].join("\n")

export type SceneLibrary = { name: string; url: string; sha1: string; path: string }
type Rule = { action: "allow" | "disallow"; os?: { name?: string; arch?: string }; features?: Record<string, boolean> }
type VersionLibrary = { name: string; rules?: Rule[]; downloads?: { artifact?: { path: string; sha1: string; url: string } } }
export type SceneOs = "windows" | "osx" | "linux"

/** The game's own rule for whether a library belongs on this system: with rules, the last one that applies decides, and none applying means no. */
const allowed = (rules: readonly Rule[] | undefined, os: SceneOs) =>
  !rules?.length || rules.reduce((verdict, rule) => (rule.features ? verdict : !rule.os?.name || rule.os.name === os ? rule.action === "allow" : verdict), false)

/**
 * The libraries the game's client needs on this system, as its own version file lists them (natives included:
 * since 1.19 they are ordinary jars the game unpacks by itself). The version file is pinned by its SHA-1 in the
 * profile, and each library by the SHA-1 written in it.
 */
export function sceneClientLibraries(version: unknown, os: SceneOs, arch: "x64" | "x86" | "arm64" = "x64"): SceneLibrary[] {
  // Round 19, the real list: each native library comes three times for Windows (plain = 64-bit, "-x86", "-arm64") and the rules
  // tell them apart by system only. The game picks the right one by itself, so the others are only weight: 16 jars not fetched.
  const foreign = (name: string) => ((kind) => (kind === undefined ? false : (kind[1] ?? "x64") !== arch))(/:natives-[a-z]+(?:-(x86|arm64))?$/.exec(name) ?? undefined)
  const libraries = ((version as { libraries?: VersionLibrary[] }).libraries ?? []).filter((library) => allowed(library.rules, os) && !foreign(library.name))
  const found = libraries.flatMap((library) => (library.downloads?.artifact ? [{ name: library.name, url: library.downloads.artifact.url, sha1: library.downloads.artifact.sha1, path: library.downloads.artifact.path }] : []))
  return [...new Map(found.map((library) => [library.path, library])).values()]
}

/** A Maven coordinate as a path under a repository. */
export const mavenPath = (name: string) => {
  const [group, artifact, version, classifier] = name.split(":")
  if (!group || !artifact || !version) throw new Error("INVALID_MAVEN_COORDINATE")
  return `${group.replaceAll(".", "/")}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ""}.jar`
}

/** What Fabric Loader itself needs beside it, read from the `fabric-installer.json` inside its (pinned) jar; each entry carries its own SHA-1. */
export function sceneLoaderLibraries(installer: unknown, side: "client" | "server"): SceneLibrary[] {
  const groups = (installer as { libraries?: Record<string, { name: string; url: string; sha1?: string }[]> }).libraries ?? {}
  return [...(groups.common ?? []), ...(groups[side] ?? [])].map((library) => {
    if (!library.sha1 || !/^[a-f0-9]{40}$/.test(library.sha1)) throw new Error("LOADER_LIBRARY_UNPINNED")
    return { name: library.name, url: `${library.url.replace(/\/?$/, "/")}${mavenPath(library.name)}`, sha1: library.sha1, path: mavenPath(library.name) }
  })
}

export const SCENE_MAIN = { client: "net.fabricmc.loader.impl.launch.knot.KnotClient", server: "net.fabricmc.loader.impl.launch.knot.KnotServer" } as const

/** The command line of the check: the game's server with Fabric Loader, no window. `libraries` is a folder; Java takes every jar in it. */
export const sceneServerArgs = (input: { libraries: string; gameJar: string }) => [
  "-Xmx2G",
  "-Dfile.encoding=UTF-8",
  "-Dstdout.encoding=UTF-8",
  "-Dstderr.encoding=UTF-8",
  `-Dfabric.gameJarPath=${input.gameJar}`,
  "-classpath",
  `${input.libraries}${input.libraries.includes("\\") ? "\\" : "/"}*`,
  SCENE_MAIN.server,
  "--universe",
  "saves",
  "--world",
  SCENE.world,
  "nogui",
]

/** The command line that opens the scene for the person: the game itself with Fabric Loader, straight into the world, signed in as nobody. */
export const sceneClientArgs = (input: { libraries: string; assets: string; assetIndex: string; instance: string; version: string; os: SceneOs; world: boolean }) => [
  ...(input.os === "osx" ? ["-XstartOnFirstThread"] : []),
  "-Xmx2G",
  "-Dfile.encoding=UTF-8",
  "-classpath",
  `${input.libraries}${input.libraries.includes("\\") ? "\\" : "/"}*`,
  SCENE_MAIN.client,
  "--username",
  "Tester",
  "--version",
  input.version,
  "--gameDir",
  input.instance,
  "--assetsDir",
  input.assets,
  "--assetIndex",
  input.assetIndex,
  "--uuid",
  "00000000000000000000000000000000",
  "--accessToken",
  "0",
  "--userType",
  "legacy",
  "--width",
  "1280",
  "--height",
  "720",
  ...(input.world ? ["--quickPlaySingleplayer", SCENE.world] : []),
]

// ---- which mods go in ----

export type SceneModFile = { file: string; ids: readonly string[]; depends: readonly string[] }
/** What every scene has without a jar in `mods`: the game, Java and the loader. */
const GIVEN = ["minecraft", "java", "fabricloader"]

/**
 * The jars of the scene and what is still missing. `built` is the mod itself; `known` are the pinned libraries
 * Studio can fetch (Fabric API, GeckoLib); `extra` are jars the person put beside the project for a mod that is
 * built on other mods. Only what something in the scene asks for is put in: a library nothing depends on stays out.
 */
export function sceneMods(built: SceneModFile, known: readonly SceneModFile[], extra: readonly SceneModFile[]) {
  const grow = (chosen: readonly SceneModFile[], missing: readonly string[]): { mods: SceneModFile[]; missing: string[] } => {
    const have = new Set([...GIVEN, ...chosen.flatMap((mod) => mod.ids)])
    const wanted = [...new Set(chosen.flatMap((mod) => mod.depends))].filter((id) => !have.has(id) && !missing.includes(id))
    if (!wanted.length) return { mods: [...chosen], missing: [...missing] }
    const found = wanted.map((id) => ({ id, mod: [...extra, ...known].find((mod) => mod.ids.includes(id)) }))
    return grow([...chosen, ...new Set(found.flatMap((value) => (value.mod ? [value.mod] : [])))], [...missing, ...found.filter((value) => !value.mod).map((value) => value.id)])
  }
  // A jar the person added is there because they want it in, asked for or not.
  return grow([built, ...extra], [])
}

/** The ids a mod jar answers to and the ids it cannot start without, from its `fabric.mod.json` and those of the jars nested in it. */
export function sceneModFacts(file: string, metadata: unknown, nested: readonly unknown[] = []): SceneModFile {
  const read = (value: unknown) => {
    const root = (value ?? {}) as { id?: unknown; provides?: unknown; depends?: unknown }
    return {
      ids: [...(typeof root.id === "string" ? [root.id] : []), ...(Array.isArray(root.provides) ? root.provides.filter((id): id is string => typeof id === "string") : [])],
      depends: root.depends && typeof root.depends === "object" ? Object.keys(root.depends) : [],
    }
  }
  const own = read(metadata)
  const inside = nested.map(read)
  const ids = [...new Set([...own.ids, ...inside.flatMap((value) => value.ids)])]
  return { file, ids, depends: [...new Set([...own.depends, ...inside.flatMap((value) => value.depends)])].filter((id) => !ids.includes(id)) }
}

// ---- reading what the game said ----

/** A line of the game's log without its time and thread. */
export const sceneSaid = (line: string) => line.replace(/^\[[^\]]*\] \[[^\]]*\]:? ?/, "").trim()
export const SCENE_MARK = "MMSCENE"
/** Sent after every command: the game repeats it in its log, and what stands between two of them is the answer to one command. */
export const sceneMark = (index: number) => `say ${SCENE_MARK} ${index}`
export const SCENE_READY = /\bDone \(\d/
/** Error lines every modded game of this kind writes, which say nothing about the mod (see `sceneReport`). */
export const SCENE_USUAL = [/No data fixer registered for /, /No key layers in MapLike/] as const

export type SceneAnswer = { step: SceneStep; said: string[] }
export type SceneThingReport = {
  kind: SceneKind
  id: string
  title: string
  /** The game took the command that puts it there. */
  placed: boolean
  /** Block label creation is checked independently; absent in reports written before label checks were added. */
  label?: { placed: boolean; said: string[] }
  /** Creatures only, after the wait: still in the world, where, with how much health. Null when the game gave no such answer. */
  there?: boolean | null
  at?: readonly [number, number, number] | null
  health?: number | null
  /** What the game said when it did not work, as it said it. */
  said: string[]
}
export type SceneReport = {
  /** The game got as far as a running world with these mods. */
  started: boolean
  /** The mods the loader listed, the game and Java left out: everything that was in this game. */
  mods: string[]
  things: SceneThingReport[]
  /** Lines of the log at ERROR or with an exception that name the mod or a thing it registers, as they were written. */
  errors: string[]
  /** How many other error lines the log has that name nothing of this mod: said as a number, never as "the log is clean". Absent in older reports. */
  others?: number
  saved: boolean
  /** The end of the log when the game did not start or stopped by itself. */
  tail: string[]
  /** Findings in plain words; empty when nothing went wrong in what was checked. */
  findings: string[]
  /** What this check cannot see, said every time. */
  limits: string
}

export const SCENE_WORDS = {
  name: "测试场",
  limits:
    "这是不开窗口的检查：只装了这个模组和它必须的前置，在一个平坦的空世界里把每样东西摆出来，再问游戏它们在不在。它看不到任何画面——模型、贴图、动作、效果、界面和声音都没有检查；没有玩家在场，所以要有人靠近、挨打、右键才发生的事也没有检查；只在客户端才会出的错这里查不到。这些要打开测试场亲眼看。",
  not_started: "游戏装上这个模组以后没有启动起来。",
  missing: (ids: readonly string[]) => `缺少前置模组：${ids.join("、")}。把它们的 jar 放进工程文件夹下的 ${SCENE_EXTRA} 文件夹，再部署一次。`,
  placed: { creature: "放不出来", block: "摆不出来", item: "拿不出来" },
  set_out: { creature: "后台检查里放得出来，等了一会儿还在地面上。", block: "后台检查里摆得出来。", item: "后台检查里拿得出来。" },
  // broad6 w3 (and round 35): with the game open the drawer still said it was opening and that a first time downloads, and counted the play as waiting.
  in_game: "游戏已经开着了，到游戏窗口里看。关掉游戏窗口以后这里才算结束。",
  // The game has finished loading and sits on its title screen (no world yet, or the person has not opened one). Its window can be behind this one.
  at_title: "游戏已经打开了，现在停在游戏的主菜单。游戏窗口可能被盖在这个窗口后面，到任务栏里找一下它。关掉游戏窗口以后这里才算结束。",
  opened: "测试场打开过，这一次打包的东西都在那个世界里。有没有人把每样都看过，程序不知道。",
  gone: (title: string, seconds: number) => `「${title}」放出来 ${seconds} 秒以后已经不在世界里了（没有人碰它）。`,
  fell: (title: string, y: number) => `「${title}」放在地面上，${SCENE.settle} 秒以后掉到了 y=${y}，在地面以下。`,
  unsaved: "世界没有存下来，打开测试场时看到的可能不是这一次摆好的样子。",
  eula: "在后台跑这项检查要启动 Minecraft 自己的服务器，它要求先同意 Minecraft 最终用户许可协议（https://aka.ms/MinecraftEULA）。请在 Studio 的测试场那里看过并勾选同意，之后就不用再问。",
  clean: "摆出来的每样东西游戏都认，等了一会儿都还在，日志里没有提到这个模组或它的东西的报错。",
  others: (count: number) => `日志里另有 ${count} 行报错没有提到这个模组（原文在检查的日志里），是不是和它有关没有判断。`,
} as const
/** Beside the project: jars of the mods this one is built on. */
export const SCENE_EXTRA = "test-scene-mods"

const numbers = (text: string) => [...text.matchAll(/-?\d+(?:\.\d+)?(?:[eE]-?\d+)?/g)].map((match) => Number(match[0]))

/**
 * A report from the plan and what the game answered to each of its commands. A thing counts as placed only when
 * the game's own answer says so; anything else the game said is kept word for word as the reason.
 */
export function sceneReport(input: { mod_id: string; plan: ScenePlan; answers: readonly SceneAnswer[]; log: readonly string[]; started: boolean }): SceneReport {
  // The loader writes its list as one record: a heading, then one indented line a mod ("- id version") with the mods nested in it below ("|--", "\\--").
  const listed = input.log.findIndex((line) => /Loading \d+ mods?:/.test(line))
  const block = listed < 0 ? [] : input.log.slice(listed + 1, listed + 1 + Math.max(0, input.log.slice(listed + 1).findIndex((line) => !/^\s+[-|\\]/.test(line))))
  const mods = block
    .filter((line) => /^\s*- /.test(line))
    .map((line) => line.replace(/^\s*- /, "").trim())
    .filter((line) => !/^(minecraft|java|fabricloader|mixinextras)\b/.test(line))
  const answered = (about: number, ask?: SceneStep["ask"]) => input.answers.filter((answer) => answer.step.about === about && answer.step.ask === ask)
  const things = input.plan.things.map((thing, about): SceneThingReport => {
    const put = answered(about)[0]
    const placed = Boolean(put && put.step.ok && put.said.some((line) => new RegExp(put.step.ok!).test(line)))
    const labelStep = thing.kind === "block" ? input.plan.place.find((step) => step.about === about && step.ask === "label") : undefined
    const labelAnswer = labelStep ? answered(about, "label")[0] : undefined
    const labelPlaced = Boolean(labelAnswer && labelStep?.ok && labelAnswer.said.some((line) => new RegExp(labelStep.ok!).test(line)))
    const labelResult = labelStep ? { placed: labelPlaced, said: labelAnswer?.said ?? [] } : undefined
    if (thing.kind !== "creature") return { kind: thing.kind, id: thing.id, title: thing.title, placed, ...(labelResult ? { label: labelResult } : {}), said: placed ? [] : (put?.said ?? []) }
    const there = answered(about, "there")[0]
    const where = answered(about, "where")[0]?.said.find((line) => /entity data/.test(line))
    const health = answered(about, "health")[0]?.said.find((line) => /entity data/.test(line))
    const at = where ? numbers(where.slice(where.indexOf("data:"))) : []
    return {
      kind: thing.kind,
      id: thing.id,
      title: thing.title,
      placed,
      there: there ? there.said.some((line) => /^Test passed/.test(line)) : null,
      at: at.length >= 3 ? [at[0]!, at[1]!, at[2]!] : null,
      health: health ? (numbers(health.slice(health.indexOf("data:")))[0] ?? null) : null,
      said: placed ? [] : (put?.said ?? []),
    }
  })
  // Round 20, real logs. A line is the mod's when it names the mod or one of the things it registers: the game writes a creature's
  // registry name without the mod in front ("…for creature_64e4…"). Two lines every such game writes are not faults and are left out:
  // "No data fixer registered for <entity>" (said once for every creature a mod adds; it is about converting saves of older game
  // versions, which a new creature has none of) and "No key layers in MapLike[{}]" (the flat world's own settings left at their defaults).
  const names = [input.mod_id, ...input.plan.things.map((thing) => thing.id.split(":")[1]!)].map((name) => name.toLowerCase())
  const loud = input.log.filter((line) => (/\/(ERROR|FATAL)\]/.test(line) || /Exception|Error:/.test(line)) && !SCENE_USUAL.some((usual) => usual.test(line)))
  const errors = loud.filter((line) => names.some((name) => line.toLowerCase().includes(name))).slice(0, 40)
  const others = loud.length - loud.filter((line) => names.some((name) => line.toLowerCase().includes(name))).length
  const saved = input.answers.some((answer) => answer.step.ask === "saved" && answer.said.some((line) => /Saved the game/.test(line)))
  const findings = [
    ...(input.started ? [] : [SCENE_WORDS.not_started]),
    ...things.filter((thing) => input.started && !thing.placed).map((thing) => `「${thing.title}」${SCENE_WORDS.placed[thing.kind]}（${thing.id}）：${thing.said.join(" ") || "游戏没有回答"}`),
    ...things.filter((thing) => input.started && thing.kind === "block" && thing.label?.placed === false).map((thing) => `「${thing.title}」名字标签没有放出来（${thing.id}）：${thing.label?.said.join(" ") || "游戏没有回答"}`),
    ...things.filter((thing) => thing.placed && thing.there === false).map((thing) => SCENE_WORDS.gone(thing.title, SCENE.settle)),
    ...things.filter((thing) => thing.placed && thing.there && thing.at && thing.at[1] < SCENE.ground - 2).map((thing) => SCENE_WORDS.fell(thing.title, Math.round(thing.at![1]))),
    ...(errors.length ? [`游戏日志里有 ${errors.length} 行提到这个模组的报错，第一行：${sceneSaid(errors[0]!).slice(0, 300)}`] : []),
    ...(input.started && !saved ? [SCENE_WORDS.unsaved] : []),
  ]
  return { started: input.started, mods, things, errors, others, saved, tail: input.started && !findings.length ? [] : input.log.slice(-SCENE.tail), findings, limits: SCENE_WORDS.limits }
}

/** The report as a person reads it: what was in the game, what was found, and what was not looked at. */
export function sceneLines(report: SceneReport) {
  return [
    // What was put into `mods`; the loader's own list also counts the game, Java, itself and the modules inside each of these.
    report.started ? `游戏带着这个模组启动了。测试场里装的只有：${report.mods.join("、") || "（没有读到模组列表）"}。` : SCENE_WORDS.not_started,
    ...(report.findings.length ? report.findings : report.started ? [SCENE_WORDS.clean] : []),
    ...(report.started && report.others ? [SCENE_WORDS.others(report.others)] : []),
    report.limits,
  ]
}

type Told = {
  mod_id: string
  entities: readonly { id: string; runtime?: { texture_asset_id?: string | null } | null }[]
  blocks: readonly { id: string; identifier: string }[]
  items: readonly { id: string; identifier: string }[]
  workspace: { assets: readonly { id: string; document: { kind: string; model_asset_id?: string | null } }[] }
}

/**
 * What a run of the scene says about each saved thing, in the shape a project keeps its checks in. `built` is
 * what the build under the scene really holds; nothing outside it is ever named.
 *
 * - From a check: one case a thing that was set out. It passed when the game took the command and, for a creature,
 *   the creature was still there above the ground after the wait. A game that never started says nothing about any
 *   thing, so it gives no cases (the report's own finding says it did not start).
 * - From the person opening the scene: one case for everything in the build. It says the game was open with these
 *   in it, which is all a program can know about what somebody looked at.
 */
export function sceneCases(project: Told, built: readonly string[], from: { report: SceneReport } | { opened: true }) {
  const inBuild = new Set(built)
  if ("opened" in from) return built.length ? [{ id: "scene.opened", asset_ids: built.slice(0, 64), kind: "client" as const, passed: true, detail: SCENE_WORDS.opened }] : []
  if (!from.report.started) return []
  const of = (thing: SceneThingReport) => {
    const name = thing.id.slice(thing.id.indexOf(":") + 1)
    if (thing.kind === "block") return project.blocks.filter((block) => block.identifier === name).map((block) => block.id)
    if (thing.kind === "item") return project.items.filter((item) => item.identifier === name).map((item) => item.id)
    const entity = project.entities.find((value) => creatureName(value) === name)
    if (!entity) return []
    // A creature is its model, its numbers and its picture: three saved things, one in the game.
    return project.workspace.assets
      .filter((asset) => asset.id === entity.id || (asset.document.kind === "entity" && asset.document.model_asset_id === entity.id) || asset.id === entity.runtime?.texture_asset_id)
      .map((asset) => asset.id)
  }
  return from.report.things.flatMap((thing, index) => {
    const ids = of(thing).filter((id) => inBuild.has(id))
    if (!ids.length) return []
    const fell = !!thing.at && thing.at[1] < SCENE.ground - 2
    const passed = thing.placed && thing.there !== false && !fell
    const detail = passed ? SCENE_WORDS.set_out[thing.kind] : !thing.placed ? `${SCENE_WORDS.placed[thing.kind]}：${thing.said.join(" ") || "游戏没有回答"}` : fell ? SCENE_WORDS.fell(thing.title, Math.round(thing.at![1])) : SCENE_WORDS.gone(thing.title, SCENE.settle)
    return [{ id: `scene.thing.${index}`, asset_ids: ids, kind: "gametest" as const, passed, detail: detail.slice(0, 4000) }]
  })
}
