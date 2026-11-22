import { continuitySamplingWords } from "@minemods/studio-ai/making"
import { abilityRef, clipRef, comboRef } from "@minemods/mod-core/finding-refs"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { structureWords } from "@minemods/studio-ai/model-structure"
import { fitModelAtlas } from "@minemods/mod-core/model"
import { detailedSixView, type SixViewStyle } from "@minemods/studio-ai/making"
import { compileWorkspaceTexture, type ModuleDocument } from "@minemods/mod-core/workspace"
import { gestureFirstPersonPreview, gesturePlayerPreview } from "@minemods/mod-core/gesture"
import { abilityFault, continuityLine, HIT_PICTURE_WORDS, TRAVEL_PICTURE_WORDS, HITBOX_PICTURE_WORDS, MAKING_LIMITS, makingLimits, MakingRefusal, motionCaption, motionLabel, motionLine, NO_WORLD_WORDS, REFERENCE_SHEET_NAME, SIX_VIEW_WORDS, stillReason, TEXTURE_SEEN, textureLines, textureNote, threeViewLabel, WORLD_SHEET_NAME, type LookOptions, type ReferenceKind, type ThreeViewBy, type ThreeViewSlot, type MotionNote, type PartSheet, type ReviewNeed, type TextureNote } from "@minemods/mod-core/making"
import type { WorldPicture } from "@minemods/mod-core/making-world"
import { drawShape, measureShape, shapeLines, SHAPE_VIEWS } from "@minemods/studio-ai/block-shape-facts"
import type { BlockShape } from "@minemods/studio-ai/block-shape"
import { BLOCK_FACES, faceEntries, facePick, type FaceEntry, type Picture, type WorldFamily } from "@minemods/studio-ai/texture-facts"
import { decodeTextureDataUrl } from "@minemods/mod-core/content-texture"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import { encodePng } from "@minemods/mod-core/png"
import { modelBounds } from "@minemods/mod-core/model-bounds"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { measureMotion, posedCorners, type MotionClip, type MotionMeasure } from "@minemods/studio-ai/model-motion"
import { clipPace, measureContinuity } from "@minemods/studio-ai/motion-continuity"
import { weightAt, LAYERS } from "@minemods/studio-ai/clip-weights"
import { lookPlan, lookSolve, type Gaze } from "@minemods/studio-ai/look-bones"
import { apply, placeOf, rigOf, trackTurn, transposed } from "@minemods/studio-ai/pose-rig"
import { programClip } from "@minemods/studio-ai/program-clip"
import { epicPhrasingFaults, measurePhrasing, phrasingLine } from "@minemods/studio-ai/motion-phrasing"
import { effectShot, lookCamera, projector } from "../renderer/look-camera"
import { dashForceLabel } from "@minemods/mod-core/ability-dash-words"
import { parryTimeline, parryTimelineWords } from "@minemods/mod-core/ability-parry"
import { steadyPicture } from "@minemods/mod-core/steady-picture"
import { resolveSteady } from "@minemods/mod-core/creature-steady"
import { combatStrips } from "@minemods/mod-core/combat-picture"
import { creatureParticleSheets } from "./particle-looks"
import {layeredParticles,typicalParticles,type SceneExample} from "@minemods/mod-core/particle-context"
import { combatScaleTable } from "@minemods/mod-core/combat"
import { parryTimelinePicture } from "@minemods/mod-core/ability-parry-picture"
import { struckAbility } from "@minemods/mod-core/boss-weather"
import { abilityTravel, boxOutline, travelFaces, travelShift, travelTrails, travelWords } from "@minemods/mod-core/ability-travel"
import { deathTicks } from "@minemods/mod-core/fabric/entity"
import { impactMomentWords, impactMoments, type ImpactMoment } from "@minemods/mod-core/impact-picture"
import { IMPACT_FX, impactFxWords, type ImpactFx } from "@minemods/mod-core/impact-fx"
import { AIM_TARGET, BONE_FAULT_MARK, abilityClipAt, abilityHitShapes, abilityPlace, abilityWords, aimPitch, type Place, boneIssues, comboIssues, comboPlan, comboWords, hitLines, shapeFaces } from "@minemods/mod-core/creature-abilities"
import { hitBone } from "@minemods/mod-core/entity-runtime"
import { impactLines, landingRing, projectileLines, projectileSketch } from "@minemods/mod-core/ability-projectile"
import { groundFxPictures } from "@minemods/mod-core/ground-fx-picture"
import { diveIssues } from "@minemods/mod-core/creature-flight"
import { paintFlatness, paintFlatnessLine } from "@minemods/studio-ai/model-paint"
import { budgetDeclared, budgetLine, budgetNote, DEFAULT_TIER, GEOMETRY_TIERS, TEXTURE_SIZES, type BudgetNote } from "@minemods/studio-ai/budget"
import { bakedCounts, bakedLine } from "@minemods/studio-ai/animation"
import { effectClip, effectLines, effectMeasure, effectModel, effectRoom, effectUnplayedLine } from "@minemods/mod-core/effect"
import { effectBuildFault } from "@minemods/mod-core/effect-build"
import { abilityEffectFacts, abilityEffectFindings, abilityEffectPlan, assumedTarget, creatureTall, diveFrame, effectAimGap, effectCorners, effectEvents, effectsShown, stagedEffect, type EffectEvent, type EffectLookup, type Stand } from "@minemods/mod-core/effect-abilities"
import { TICKS, WARN_COLORS } from "@minemods/mod-core/ability-words"
import { trailEvents, trailIssues, trailLine, trailPath } from "@minemods/mod-core/ability-trails"
import { feedbackOwner } from "@minemods/mod-core/hit-feedback"
import { impactParticles, poofParticles, scatterFindings, particlePreview, type ParticleGroup } from "@minemods/mod-core/particle-preview"
import { particleScene } from "@minemods/mod-core/particle-scene"
import { particleWarnings, appearancePixels, particleAt, particleLines, particleTicks, type ParticleDocument } from "@minemods/mod-core/particle"
import { bossBarLayout, bossBarMoments, drawBossBar, evenLines, type Picture as BarPicture } from "@minemods/mod-core/boss-bar"
import { abilityShakes, bossLookPlan, phaseLookWords, shakeCap, shakeCurve, shakesOf, stageHidden } from "@minemods/mod-core/boss-look-words"
import { bossLookIssues } from "@minemods/mod-core/boss-look"
import { bonesBelow, glowingTexture, hiddenGeometry, ringFaces, shakeCurvePicture } from "@minemods/mod-core/boss-look-picture"
import { SHAKE_LIMITS } from "@minemods/mod-core/boss-words"
import { bossWords } from "@minemods/mod-core/creature-boss"
import { arenaLookSheets } from "./arena-look"
import { fixtureLines, fixtureModel } from "@minemods/mod-core/fixture"
import { bossShowClipAt, bossShowGlowAt, bossShowHiddenAt, bossShowPlan, bossShowSentence } from "@minemods/mod-core/boss-show"
import { bossShowIssues } from "@minemods/mod-core/boss-show-model"
import { bossShowTimeline, showTimelinePicture } from "@minemods/mod-core/boss-show-picture"
import { boxFaces, followKeyFrames, hitboxBoxes, hitboxBoxesAt, hitboxCaptions, hitboxFit, hitboxReport, hitboxLooked } from "@minemods/mod-core/creature-hitbox"

/**
 * What "looking" draws, decided here in words and numbers and drawn elsewhere. A look is at most
 * `MAKING_LIMITS.sheets` pictures; each picture is one contact sheet of labelled cells (angles of a
 * model, moments of a motion, a texture laid flat) so that one look fits a vision model's budget.
 * Still frames side by side hide a small motion, so every motion is also measured (`model-motion.ts`):
 * the numbers go out in words with the pictures, its frames are the moments that differ most, and the
 * last cell of its sheet lays the two furthest moments over each other.
 * A block or an item is one flat picture, and its faults do not show in that picture enlarged: it is drawn
 * the ways the game shows it (laid edge to edge, built into a wall, at the size it has on the screen, in an
 * inventory slot, in a hand) and counted (`texture-facts.ts`).
 * This file needs no window: it turns a document into a list of cells. The page under
 * `renderer/look.ts` draws them with the app's own viewport, in a window nobody sees.
 */

/**
 * Where the camera stands, in the document's own axes. The front is north (-Z) and the thing's own left is
 * +X (`orientation.ts`), so `plus_x` looks at its left side and `minus_x` at its right.
 */
export type LookView = "front" | "back" | "plus_x" | "minus_x" | "top" | "quarter" | "quarter_back"
type Vector = [number, number, number]
export type LookScene = { design: ModelDesign; preview: { geometry: unknown; textureDataUrl: string; animation?: unknown } | null }
/**
 * A scene drawn into the same 3D view as the cell's own, its root moved by `offset` (model pixels, in the viewport's space: the one `camera` and `faces` are in). It is
 * posed at the same moment as the cell's scene, by its own motion of that name, and hides and is hidden by what else is in the view. So a thing that does not fit the cell's
 * own model document (an effect 18 blocks out, on a creature that fills its tier) is a scene of its own and a part.
 */
export type LookPart = { scene: number; offset: Vector }
export type LookCell =
  | {
      kind: "view"
      particles?: ParticleGroup[]
      caption?: string[]
      label: string
      scene: number
      view: LookView
      /** Frame this part and what hangs from it, instead of the whole model. */
      focus?: string
      /** The motion to pose, and the moment in seconds. Left out: the pose it is built in. */
      animation?: string
      time?: number
      /** Write each part's name over it. */
      names?: boolean
      /** A camera to use as given (a player's own eyes) instead of one placed around the model. */
      camera?: { position: Vector; target: Vector; fov: number }
      /** The cell's own scene moved by this (model pixels), e.g. a creature standing where a dive has brought it. Left out: at the origin. */
      offset?: Vector
      /** Further scenes drawn into the same view, each at its own offset. */
      extra?: LookPart[]
    }
  | {
      /** Two moments of a motion laid over each other: what changed between them is tinted and counted. */
      kind: "compare"
      label: string
      scene: number
      view: LookView
      animation: string
      times: [number, number]
      /** The measured facts in short lines, written under the picture. */
      caption: string[]
      /** H3: a camera to use as given, for a motion that leaves the room its built pose takes (an effect growing past it). */
      camera?: { position: Vector; target: Vector; fov: number }
    }
  | {
      kind: "flat"
      label: string
      url: string
      /** A photograph or a drawing, not pixel art: scaled smoothly. One that cannot be read leaves its cell saying so; it never fails the sheet. */
      picture?: boolean
    }
  | {
      /** Flat pictures laid edge to edge, pixel for pixel: `layout` rows of indices into `textures`. */
      kind: "tiles"
      label: string
      textures: string[]
      layout: number[][]
      /** How each picture of `layout` lies, when not as drawn: quarter turns clockwise, plus 4 when flipped left to right (`LookBlock.pose`). */
      poses?: number[][]
      /** Screen pixels one pixel of the picture covers, exactly. Left out: as large as fits the cell. */
      pixel?: number
      /** A line between every two pixels, to find which pixel is wrong. */
      lines?: boolean
    }
  | {
      /** Cubes that wear flat pictures, in the game's own face shading, seen from one corner. */
      kind: "blocks"
      label: string
      textures: string[]
      blocks: LookBlock[]
      /** `wall`: from in front, a little to one side and above, as a player sees a wall. `corner`: from a corner, as the inventory shows a block. */
      view: "wall" | "corner"
      /** Dark around it: each cube is as bright as its `light` says and no brighter. */
      night?: boolean
    }
  | {
      /** A row of inventory slots at the size the game draws them, once for each of `scales` (screen pixels per interface pixel). */
      kind: "slots"
      label: string
      /** What lies in each slot; null is an empty slot. */
      icons: (string | null)[]
      /** The slot marked as the made thing, when the row holds others. */
      own?: number
      dark: boolean
      scales: number[]
      /** Every filled-in pixel in one colour: the outline alone. */
      solid?: boolean
    }
  | {
      /** An item in a hand, posed by the game's own two ways of holding. */
      kind: "held"
      label: string
      url: string
      pose: "generated" | "handheld"
    }
  | {
      /** Engineer G2: one moment of a motion with a see-through shape over it — where an ability's hit lands at that moment (`creature-abilities.ts`). */
      kind: "hit"
      sourceCorners?: Vector[]
      light?: "白天" | "夜晚" | "压暗" | "起雾"
      label: string
      scene: number
      view: LookView
      animation: string
      time: number
      /** Stands far enough back to hold the model and the shape. */
      camera: { position: Vector; target: Vector; fov: number }
      /** The shape as flat faces, in the viewport's space (model pixels). */
      faces: Vector[][]
      /** What was measured at that moment, in short lines, written under the picture. */
      caption: string[]
      /**
       * H3: scenes laid over the drawn one, each where it differs from what is under it and only as solid as `alpha` says: effects that let the world show through.
       * A layer is the cell's own scene again with the further scenes `extra` it holds (all of them: the solid ones of the cell's own `extra` and the see-through ones it adds).
       */
      over?: { scene: number; alpha: number; extra?: LookPart[] }[]
      /** The cell's own scene moved by this (model pixels), and the further scenes drawn into the same view (effects, each as a scene of its own at its own offset). */
      offset?: Vector
      extra?: LookPart[]
      /** Boss 能力 11: weapon trails, each the curve the far end of its part sweeps (the viewport's space, model pixels, one point a tick), drawn over everything in its own colour (#rrggbb). */
      particles?: ParticleGroup[]
      trails?: { points: Vector[]; color: string; /** Boss 能力 2: a thrown thing's flight, drawn dashed. */ dashed?: boolean }[]
    }
  | {
      /** K1: a creature with its collision boxes drawn see-through over it (`creature-hitbox.ts`), as it is built or at one moment of a motion. */
      kind: "boxes"
      label: string
      scene: number
      view: LookView
      animation?: string
      time?: number
      camera: { position: Vector; target: Vector; fov: number }
      /** Each box as flat faces, in the viewport's space (model pixels); `core` is the one box the game itself knows. */
      boxes: { faces: Vector[][]; core: boolean; damageScale?: number; solid?: true }[]
      /** What was measured, in short lines, written under the picture. */
      caption: string[]
    }
/** One cube of a `blocks` cell: where it stands (in blocks), what it wears (an index into `textures`; null: plain grey) and how brightly it is lit (0 to 1; left out: daylight). */
export type LookBlock = {
  at: Vector
  texture: number | null
  light?: number
  /** How the game shows the block at this place, when not as its model is written: quarter turns clockwise seen from above (the top shows them, the sides do not), plus 4 when every face is flipped left to right. */
  pose?: number
}
export type LookSheet = { label: string; columns: number; cell: [number, number]; cells: LookCell[]; weightTimeline?: { seconds: number; windup: number; rows: number[][] } }
export type LookJob = { scenes: LookScene[]; sheets: LookSheet[] }
export type LookPictures = { ok: true; pictures: { label: string; url: string }[] } | { ok: false; reason: string }
/** Draws a job. It always answers: a picture list, or why there is none. It never throws and never hangs. */
export type LookProgress = (done: number, total: number) => void
export type LookRenderer = (job: LookJob, progress?: LookProgress, signal?: AbortSignal) => Promise<LookPictures>

const TILE: [number, number] = [MAKING_LIMITS.sheet[0] / 3, MAKING_LIMITS.sheet[1] / 2]
// Words a person reads as they are: the two sides are the thing's own left and right, never the picture's.
// Which axis each is on is said once, in the instructions (`PICTURE_GUIDE`).
// The six around are named as the 六视图's views are (`SIX_VIEW_WORDS`), so a reference and the render of the same angle say the same word.
const VIEW_LABELS: Record<LookView, string> = { front: SIX_VIEW_WORDS.front, back: SIX_VIEW_WORDS.back, plus_x: SIX_VIEW_WORDS.left, minus_x: SIX_VIEW_WORDS.right, top: SIX_VIEW_WORDS.top, quarter: SIX_VIEW_WORDS.quarter, quarter_back: "斜后方" }
const AROUND: LookView[] = ["front", "back", "plus_x", "minus_x", "top", "quarter"]
/** The sides a reviewer may ask for by name, in its words or in the picture's. Left and right are the thing's own, with or without 「它的」. */
const ASKED_VIEWS: Record<string, LookView> = { front: "front", back: "back", left: "plus_x", right: "minus_x", 左侧: "plus_x", 右侧: "minus_x", top: "top", quarter: "quarter", quarter_back: "quarter_back", ...Object.fromEntries(Object.entries(VIEW_LABELS).map((entry) => [entry[1], entry[0] as LookView])) }
const CLAY = "#b9b4aa"
const SHAPE_ONLY = "只看形状"

type Model = Extract<ModuleDocument, { kind: "model" }>
type Motion = ModelDesign["animations"][number]
const designOf = (document: Model): ModelDesign => (({ kind: _kind, ...design }) => design)(document)
const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`
const seconds = (value: number) => `${Number(value.toFixed(2))} 秒`
const names = (values: string[]) => values.slice(0, 40).join("、")
/**
 * Sentences that repeat are said once, in the place of the first, with how many places say it (a creature with two claws that strike alike has one sentence about
 * when its effect appears for each of them, word for word the same). The order of first sayings is kept.
 */
export function once(lines: readonly string[]) {
  const counts = lines.reduce((found, line) => found.set(line, (found.get(line) ?? 0) + 1), new Map<string, number>())
  return [...counts].map(([line, count]) => (count > 1 ? `${line}（同样的有 ${count} 处）` : line))
}

/** The model as the app draws it once saved. One whose faces do not fit any texture is drawn in its plain face colours. */
function scene(design: ModelDesign, texture?: string): LookScene {
  // A model too large for any atlas throws here; that is a fault the standard reports, not a reason to show nothing.
  const compiled = (() => {
    try {
      return fitModelAtlas(design, "look")
    } catch {
      return null
    }
  })()
  if (!compiled) return { design, preview: null }
  return { design: compiled.design, preview: { geometry: compiled.geometry, textureDataUrl: texture ?? dataUrl(compiled.png), animation: compiled.animation } }
}

/** The same shape with nothing on it: one flat colour, no paint, no marks. */
const bare = (design: ModelDesign): LookScene => ({
  design: {
    ...design,
    bones: design.bones.map((bone) => ({
      ...bone,
      paint: null,
      cubes: bone.cubes.map((cube) => ({ ...cube, paint: null, features: null, surface_details: [], faces: { north: CLAY, east: CLAY, south: CLAY, west: CLAY, up: CLAY, down: CLAY } })),
    })),
  } as ModelDesign,
  preview: null,
})

/**
 * The moments of a motion to show: the ones asked for; else the ones that differ most from each other
 * (`differing`, measured, the two extremes first), filled up with evenly spread ones, the last frame of a
 * loop left out because it equals the first. Evenly spread frames alone can all miss the extremes.
 */
function moments(length: number, loop: boolean, asked?: number[] | null, count: number = MAKING_LIMITS.frames, differing: number[] = [], must: readonly number[] = []) {
  if (asked?.length) return asked.slice(0, count).map((time) => Math.min(time, length))
  const even = Array.from({ length: count }, (_, index) => Number(((length * index) / (loop ? count : count - 1)).toFixed(3)))
  // Round 10: `must` come before all others (the end of a wind-up, a hit: the moments a strip is read for), each once and inside the motion.
  const first = [...must.map((time) => Math.min(Math.max(time, 0), length)), ...differing].reduce<number[]>((kept, time) => (kept.some((other) => Math.abs(other - time) < 0.001) ? kept : [...kept, time]), []).slice(0, count)
  return [...first, ...even.filter((time) => !first.some((kept) => Math.abs(kept - time) < 0.001))].slice(0, count).sort((a, b) => a - b)
}

/**
 * Round 10: the moments of each motion that an ability is read by, by the motion's name: where its wind-up
 * ends and where each hit is counted. A strip of that motion shows them whatever else it shows, so the
 * contact is never the frame that was left out. Empty for a creature without abilities.
 */
export type AbilityMoments = Readonly<Record<string, readonly number[]>>
export function abilityMoments(creatures: readonly { abilities?: readonly { clip: string; windup: number; hits: readonly { at: number }[] }[] | null }[]): AbilityMoments {
  return creatures
    .flatMap((creature) => creature.abilities ?? [])
    .reduce<Record<string, number[]>>((found, ability) => ({ ...found, [ability.clip]: [...new Set([...(found[ability.clip] ?? []), ...(ability.windup > 0 ? [ability.windup] : []), ...ability.hits.map((hit) => hit.at)])].sort((a, b) => a - b) }), {})
}
/** Written on a frame that is one of those moments. */
const momentMark = (must: readonly number[], time: number) => (must.some((value) => Math.abs(value - time) < 0.001) ? " · 招式的关键一刻" : "")

/** One motion measured, its travel also as it shows in a frame of its sheet shot from `view`. */
function measured(design: ModelDesign, motion: MotionClip, view: LookView, room: Room | null = null) {
  const bounds = room ?? modelBounds(design)
  return measureMotion(design, motion, projector(lookCamera({ min: bounds.min as Vector, max: bounds.max as Vector }, view, TILE[0] / TILE[1]), TILE))
}
/** H3: the room a strip of frames is shot in when the built pose is not all the motion reaches. Left out: the room of the built pose, as always. */
type Room = { min: Vector; max: Vector }
const noted = (found: MotionMeasure): MotionNote => ({ name: found.name, travel: found.travel, mover: found.mover?.bone ?? null, cube: found.mover?.cube ?? null, between: found.between, moving: found.moving, parts: found.parts, turn: found.turn, ...(found.shift ? { shift: found.shift } : {}), ...(found.stretch ? { stretch: found.stretch } : {}), game: found.game, picture: found.picture, tall: found.tall, unseen: found.unseen })
/**
 * Every motion's facts, as records to keep with the version and as the sentences said with its pictures:
 * how much it moves, and (Engineer G3) how it holds together tick by tick, which no still frame shows.
 * `sheet` may declare a motion still or a measured fault meant; `speed` is the creature's walking speed in blocks a second when the project knows it.
 * `planned`: the plans the pictures of a motion were made from, so the travel said "in the picture" is the travel in the picture that
 * was drawn (its first row is the view the facts are said of). A motion not in it is measured as its default strip would be shot,
 * the one a look at that motion alone draws.
 */
function motionFacts(design: ModelDesign, motions: MotionClip[], sheet: Still, speed: number | null = null, planned: ReadonlyMap<string, Plan> = new Map(), attacks: readonly string[] = []) {
  const motion = motions.map((written): MotionNote => {
    // 第 2 步: measured as it is shown, its follow bones swaying.
    const value = swayed(design, written)
    const view = vantage(design, value)[0]
    const plan = planned.get(value.name) ?? planOf(design, value, [view], MAKING_LIMITS.frames)
    return { ...noted(plan.room ? measured(design, value, view, plan.room) : plan.shots[0]!.found), continuity: measureContinuity(design, value, speed, stillReason(sheet, value.name) !== null) }
  })
  // 第 2 步: how each motion that does not loop (other than a flinch or a death) is phrased (bones moved, the fastest turn, wind-up and recovery), and at the epic tier what an attack motion misses of it.
  // Flinching and dying are reactions, not moves to phrase: they are left out, as loops are.
  const phrased = motions.map((value) => (value.loop || PHRASELESS.includes(value.name) ? null : measurePhrasing(design, value)))
  const epic = design.budget === "epic" ? motions.flatMap((value, index) => (phrased[index] && (attacks.includes(value.name) || value.name === "attack") ? epicPhrasingFaults(design, phrased[index]!, motionLabel(value.name)) : [])) : []
  const sampled = motion.flatMap((note) => continuitySamplingWords(note).map((text): LookFinding => ({
    rule: "continuity_sampled", text: `${motionLabel(note.name)}：${text}。`, fix: "", refs: [clipRef(note.name)],
  })))
  return { motion, facts: motion.flatMap((note, index) => [motionLine(note, stillReason(sheet, note.name)), continuityLine(note, sheet), ...(phrased[index] ? [phrasingLine(phrased[index]!, motionLabel(note.name))] : [])]), epic, ...(sampled.length ? { findingDetails: sampled } : {}) }
}

/** 第 2 步: the motions that are not phrased (`measurePhrasing`) beside the loops. */
const PHRASELESS: readonly string[] = ["hurt", "death"]

/** 第 2 步: a motion as it is shown and measured: with the sway of the model's follow bones (a walk carried forwards at its own pace), or the very motion when the model has none. */
const swayed = <C extends MotionClip>(design: ModelDesign, clip: C): C => programClip(design, clip, clip.name === "walk" ? clipPace(design, clip).speed : 0)
type Still = Pick<PartSheet, "still" | "differs" | "justified" | "budget"> | null

/**
 * From where a motion is shot so that what moves is not hidden behind the rest: the quarter its moving
 * parts lie towards (the back one for what sits behind the middle), and a side. The front quarter shows
 * the thing's own right side and the back quarter its left, so a motion that favours neither side gets the other one.
 */
function vantage(design: ModelDesign, motion: Pick<Motion, "channels">): [LookView, LookView] {
  const middle = (bones: ModelDesign["bones"], axis: number) => bones.reduce((sum, bone) => sum + bone.pivot[axis]!, 0) / Math.max(1, bones.length)
  const moving = design.bones.filter((bone) => motion.channels.some((channel) => channel.bone === bone.name))
  const quarter = middle(moving, 2) - middle(design.bones, 2) > 1 ? "quarter_back" : "quarter"
  const lean = middle(moving, 0) - middle(design.bones, 0)
  return [quarter, Math.abs(lean) > 1 ? (lean > 0 ? "plus_x" : "minus_x") : quarter === "quarter" ? "plus_x" : "minus_x"]
}
const OTHER: Partial<Record<LookView, LookView>> = { quarter: "quarter_back", quarter_back: "quarter", plus_x: "minus_x", minus_x: "plus_x" }

const around = (label: string, sceneIndex: number, views: LookView[] = AROUND): LookSheet => ({
  label,
  columns: 3,
  cell: TILE,
  cells: views.map((view) => ({ kind: "view", label: VIEW_LABELS[view], scene: sceneIndex, view })),
})

const frames = (sceneIndex: number, animation: string, times: number[], view: LookView, must: readonly number[] = []): LookCell[] => times.map((time) => ({ kind: "view", label: `${VIEW_LABELS[view]} · ${seconds(time)}${momentMark(must, time)}`, scene: sceneIndex, view, animation, time }))

/**
 * What one row of a motion's cells shows, decided before anything is framed: the moments to draw and the
 * two that differ most, which the compare cell lays over each other. None of it depends on the camera.
 */
type Shot = { view: LookView; found: MotionMeasure; times: number[]; between: [number, number]; cells: number; must: readonly number[] }
function shotOf(design: ModelDesign, motion: MotionClip, view: LookView, cells: number, asked?: number[] | null, must: readonly number[] = []): Shot {
  const found = measured(design, motion, view)
  const times = moments(motion.length, motion.loop, asked, asked?.length ? cells : cells - 1, found.moments, must)
  return { view, found, times, between: found.mover ? found.between : [0, Number((motion.length / 2).toFixed(3))], cells, must }
}
/** Whether the compare cell has a place: only when the moments do not fill the row. */
const compares = (shot: Shot) => shot.times.length < shot.cells
/** Every moment of a motion a row draws, the compare cell's two included. */
const drawn = (shot: Shot) => (compares(shot) ? [...shot.times, ...shot.between] : shot.times)

/**
 * The room a motion is shot in, when the frame the page would give it cuts it. The page frames the built pose
 * (`lookCamera` of its bounds) and a part that swings out of that box (wings spread, a tail lashed) can leave the
 * picture. So every pose drawn of the motion (`times`; the poses `measureMotion` and the baked clip are made of, played
 * through the animation contract's own sampler by `posedCorners`) is put in the picture of each view `views` shoots it
 * from: if every corner of all of them lands inside, the page's own frame is right and the answer is null (the picture
 * is then what it always was). If any lands outside, the room is the box around the built pose and all those poses.
 */
function framing(design: ModelDesign, motion: MotionClip, times: readonly number[], views: readonly LookView[]): Room | null {
  const built = modelBounds(design)
  const corners = [...new Set(times.map((time) => Number(time.toFixed(3))))].flatMap((time) => posedCorners(design, motion, time))
  if (!corners.length) return null
  const cut = views.some((view) => {
    const flat = projector(lookCamera({ min: built.min as Vector, max: built.max as Vector }, view, TILE[0] / TILE[1]), TILE)
    return corners.some((point) => {
      const [x, y] = flat(point)
      return !(x >= 0 && x <= TILE[0] && y >= 0 && y <= TILE[1])
    })
  })
  if (!cut) return null
  // Folded, not spread into one call: the corners of every cube at every moment are too many arguments for a big model (see `clipMotion`'s `from_rest`).
  const min = [0, 1, 2].map((axis) => corners.reduce((least, point) => Math.min(least, point[axis]!), built.min[axis]!)) as Vector
  const max = [0, 1, 2].map((axis) => corners.reduce((most, point) => Math.max(most, point[axis]!), built.max[axis]!)) as Vector
  return [...min, ...max].every(Number.isFinite) ? { min, max } : null
}

/** A motion's rows decided and the room they share: one camera for all of a motion's cells, so what moves is judged against the same frame. */
type Plan = { motion: MotionClip; shots: Shot[]; room: Room | null }
/** `held`: a room the motion is shot in as given (an effect growing past its built pose); left out, the room is made from what is drawn. */
function planOf(design: ModelDesign, motion: MotionClip, views: LookView[], cells: number, asked?: number[] | null, held: Room | null = null, must: (row: number) => readonly number[] = () => []): Plan {
  const shots = views.map((view, row) => shotOf(design, motion, view, cells, asked, must(row)))
  return { motion, shots, room: held ?? framing(design, motion, shots.flatMap(drawn), views) }
}

/**
 * One row of a plan as cells: its moments, and in the last cell the two that differ most laid over each
 * other, so a motion too small to spot between stills shows as what it changes. Only when as many moments
 * are asked for as there are cells is that cell given up.
 */
function rowCells(sceneIndex: number, design: ModelDesign, plan: Plan, shot: Shot): LookCell[] {
  const { motion, room } = plan
  // What the compare cell says of how far things travel is said of the picture it is in, so it is measured in the room it is shot in.
  const found = room && compares(shot) ? measured(design, motion, shot.view, room) : shot.found
  const camera = room ? { camera: lookCamera(room, shot.view, TILE[0] / TILE[1]) } : {}
  return [
    ...frames(sceneIndex, motion.name, shot.times, shot.view, shot.must).map((cell) => ({ ...cell, ...camera })),
    ...(compares(shot) ? [{ kind: "compare" as const, label: `${shot.found.mover ? COMPARED : "两刻叠在一起"}（${seconds(shot.between[0])}和 ${seconds(shot.between[1])}）`, scene: sceneIndex, view: shot.view, animation: motion.name, times: shot.between, caption: motionCaption(noted(found)), ...camera }] : []),
  ]
}
/** Written on the cell that lays two moments of a motion over each other. */
export const COMPARED = "动得最多的两刻叠在一起"

const stripOf = (sceneIndex: number, design: ModelDesign, plan: Plan, row = 0): LookSheet => ({
  label: `${motionLabel(plan.motion.name)} · ${VIEW_LABELS[plan.shots[row]!.view]}`,
  columns: 3,
  cell: TILE,
  cells: rowCells(sceneIndex, design, plan, plan.shots[row]!),
})
const strip = (sceneIndex: number, design: ModelDesign, motion: MotionClip, view: LookView, asked?: number[] | null, held: Room | null = null, must: readonly number[] = []): LookSheet => stripOf(sceneIndex, design, planOf(design, motion, [view], MAKING_LIMITS.frames, asked, held, () => must))

/** One motion on a single sheet from two directions, one row each: its two extremes and the two laid over each other, or the three moments asked for. */
const pairOf = (sceneIndex: number, design: ModelDesign, plan: Plan): LookSheet => ({
  label: `${motionLabel(plan.motion.name)} · ${plan.shots.map((shot) => VIEW_LABELS[shot.view]).join("和")}`,
  columns: 3,
  cell: TILE,
  cells: plan.shots.flatMap((shot) => rowCells(sceneIndex, design, plan, shot)),
})
/** Round 10: with more of an ability's moments than one row holds, the rows share them: the first takes the earliest two, the next the ones after. */
const shared = (must: readonly number[]) => (row: number) => (must.length > 2 ? must.slice((row * 2) % must.length).concat(must) : must)
const pair = (sceneIndex: number, design: ModelDesign, motion: MotionClip, views: LookView[], asked?: number[] | null, must: readonly number[] = []): LookSheet => pairOf(sceneIndex, design, planOf(design, motion, views, 3, asked, null, shared(must)))

const closeUp = (sceneIndex: number, part: string): LookSheet => ({
  label: `近看「${part}」`,
  columns: 2,
  cell: TILE,
  cells: (["front", "back", "plus_x", "quarter"] as const).map((view) => ({ kind: "view" as const, label: VIEW_LABELS[view], scene: sceneIndex, view, focus: part })),
})

export const REFERENCE_SHEET = REFERENCE_SHEET_NAME
const REFERENCE_KIND_LABELS = { user: "人给的参考图", concept: "AI 画的构想图" } as const
/** What one cell says: a 六视图 by its view and whose it is (without a number or a file name: the slot is what it is), any other by whose it is. */
export const referenceLabel = (reference: { kind: ReferenceKind; name: string; view?: ThreeViewSlot; by?: ThreeViewBy; style?: SixViewStyle }, index: number) =>
  reference.kind === "three_view" ? threeViewLabel(reference.view ?? "sheet", reference.by ?? "person") + (detailedSixView(reference.style) ? " · 精细造型" : "") : `${REFERENCE_KIND_LABELS[reference.kind]} ${index + 1}${reference.name ? ` · ${reference.name.slice(0, 40)}` : ""}`

/**
 * The references of a thing on one sheet, to be shown beside its renders, in the order they are given (`shownReferences`: the 六视图
 * first — the sheet, then front, back, left, right, top and quarter, the order of the six-angle renders — then the person's own, then what
 * an AI drew), as many as `shown` allows. Null when there are none. Each cell says what it is and whose it is.
 * Views apart, or more than four pictures, are laid three to a row like the six-angle renders, so the six views sit where the renders of
 * the same angles sit (`around`); otherwise two to a row as before. The sheet never grows past `MAKING_LIMITS.sheet`: the cells shrink.
 */
export function referenceSheet(references: { kind: ReferenceKind; name: string; url: string; view?: ThreeViewSlot; by?: ThreeViewBy; style?: SixViewStyle }[], shown: number): LookSheet | null {
  const kept = references.slice(0, shown)
  if (!kept.length) return null
  const apart = kept.some((reference) => reference.kind === "three_view" && reference.view !== undefined && reference.view !== "sheet")
  const columns = kept.length === 1 ? 1 : apart || kept.length > 4 ? 3 : 2
  const rows = Math.ceil(kept.length / columns)
  const cell: [number, number] = kept.length === 1 ? [MAKING_LIMITS.sheet[1], MAKING_LIMITS.sheet[1]] : [MAKING_LIMITS.sheet[0] / columns, Math.floor(MAKING_LIMITS.sheet[1] / rows)]
  return {
    label: REFERENCE_SHEET,
    columns,
    cell,
    cells: kept.map((reference, index) => ({ kind: "flat" as const, label: referenceLabel(reference, index), url: reference.url, picture: true })),
  }
}

/** One view alone, for a small picture of a version. Never shown to an AI and never counted against a look. */
const coverOf = (cell: LookCell): LookSheet => ({ label: "封面", columns: 1, cell: [TILE[0], TILE[0]], cells: [cell] })

/** An animation document posed on the model it moves. Bones the model does not have cannot be posed; the standard reports them, the picture leaves them out. */
function posed(document: Extract<ModuleDocument, { kind: "animation" }>, wears: Model | null) {
  if (!wears) throw new MakingRefusal("这个动画没有依赖任何模型，没有东西可以摆出这个动作来看。先让它依赖一个模型。")
  const { kind: _kind, ...motion } = document
  const base = designOf(wears)
  const kept = { ...motion, channels: motion.channels.filter((channel) => base.bones.some((bone) => bone.name === channel.bone)) }
  if (!kept.channels.length) throw new MakingRefusal(`这个动画用的骨骼模型里一根都没有。模型的骨骼是：${names(base.bones.map((bone) => bone.name))}。`)
  return { motion: kept, design: { ...base, animations: [...base.animations.filter((value) => value.name !== motion.name), kept] } as ModelDesign }
}

/** A texture laid flat, and the model it dresses wearing it when the sizes agree. */
function dressed(document: Extract<ModuleDocument, { kind: "texture" }>, wears: Model | null) {
  const flat: LookCell = { kind: "flat", label: `贴图平铺（${document.width}×${document.height}）`, url: dataUrl(compileWorkspaceTexture(document)) }
  if (!wears) return { flat, worn: null, fits: false }
  const worn = scene(designOf(wears))
  const fits = worn.preview !== null && worn.design.texture_size === document.width && document.width === document.height
  return { flat, worn: fits ? { ...worn, preview: { ...worn.preview!, textureDataUrl: flat.url } } : worn, fits }
}

/**
 * `motion`: how much every motion of the thing moves, to keep with the version; `facts`: the same in sentences, said with the pictures. Both empty for a thing without motions of its own.
 * For a block or an item: `texture` is what was counted on its picture, `texture_facts` the same in sentences, and `world` the one sheet that sets it
 * among the game's own pictures. That sheet is shown and never stored: it is not a picture of this thing alone.
 */
type LookFinding = { rule: string; text: string; fix: string; refs?: FindingRef[] }
type Looked = { findingDetails?: LookFinding[]; job: LookJob; notes: string[]; cover: LookSheet; /** Round 10: sentences of `notes` that were measured to be wrong and have to be answered before the version is called finished (`abilityFault`); kinds with typed measures leave it out. */ measured?: string[]; motion: MotionNote[]; facts: string[]; texture?: TextureNote; texture_facts?: string[]; world?: LookSheet | null; /** Engineer H2: a model's counts against its geometry tier, to keep with the version, and (`budget_facts`) the same in a sentence, said with every look of a model. */ budget?: BudgetNote; budget_facts?: string[] }

/** The game's own pictures a block or an item is looked at beside (`making-world.ts`); null when the game could not be read on this machine. */
export type LookWorld = { inside: WorldPicture | null; beside: WorldPicture[]; family?: WorldFamily } | null
type Flat = Extract<ModuleDocument, { kind: "block" | "item" }>

// How bright a cube looks at one of the game's sixteen light levels: the game's own curve (level/15 = f, f / (4 − 3f)), then the screen's
// (a value half as large does not look half as bright). A preview of how far the glow reaches, not the game's exact colours.
const lit = (level: number) => ((part) => Math.max(0.05, (part / (4 - 3 * part)) ** (1 / 2.2)))(Math.max(0, Math.min(15, level)) / 15)
const rows = <Value>(width: number, height: number, pick: (x: number, y: number) => Value) => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => pick(x, y)))
// Where a few of a thing lie among others in a wall four high: a clump, as things that generate in rock lie, and one apart.
const CLUMP = ["1,1", "2,1", "2,2", "1,2", "4,0"]
const NARROW: [number, number] = [MAKING_LIMITS.sheet[0] / 4, MAKING_LIMITS.sheet[1] / 2]

/** The one picture a block or an item has: its own, or (it has none yet) its colour, which is what the game then shows. */
const flatUrl = (document: Flat) => document.texture ?? dataUrl(encodePng(Uint8Array.from({ length: 16 * 16 * 4 }, (_, index) => (index % 4 === 3 ? 255 : Number.parseInt(document.color.slice(1 + (index % 4) * 2, 3 + (index % 4) * 2), 16))), 16, 16))

/** The name of the one picture of a blind naming, as it is written on it. Nothing in it or in its cells says what the thing is. */
export const BLIND_SHEET = "只有图：按游戏里的实际大小，和放大"

/**
 * Round 17, blind naming: the picture alone, as a player meets it. An item in a light and in a dark inventory slot
 * at the size the game draws it (and the size below), then the same picture enlarged with every pixel crisp; a
 * block alone as a cube, one face at the size it has from where a block is usually looked at, and enlarged.
 * Deliberately not here: the hand it is held in (the grip says "tool"), the game's own things beside it (they are
 * its nearest kin), its name, and the colour the document gives it (a colour is a fact about the item, not a pixel of
 * its picture). Null for every other kind.
 */
export function blindSheet(document: ModuleDocument): LookSheet | null {
  if (document.kind !== "block" && document.kind !== "item") return null
  const url = flatUrl(document)
  const enlarged: LookCell = { kind: "tiles", label: "放大（同一张图，每个像素都看得清）", textures: [url], layout: [[0]] }
  if (document.kind === "item") {
    const scales = [TEXTURE_SEEN.gui, TEXTURE_SEEN.gui / 2]
    const row = [null, url, null]
    return {
      label: BLIND_SHEET,
      columns: 3,
      cell: TILE,
      cells: [
        { kind: "slots", label: `浅色的格子里 · 实际大小（${TEXTURE_SEEN.icon} 像素，和小一号的 ${TEXTURE_SEEN.small} 像素）`, icons: row, dark: false, scales },
        { kind: "slots", label: "深色的格子里 · 实际大小", icons: row, dark: true, scales },
        enlarged,
      ],
    }
  }
  // A block that is boxes put together is met as its shape, from the front, the side and above; the sheet it is cut from is not shown, it would be its picture and not what a player sees.
  if (document.kind === "block" && document.shape) {
    const shown = shapePictures(document.shape)
    return { label: BLIND_SHEET, columns: 3, cell: TILE, cells: [shown.quarter, shown.front, shown.side] }
  }
  return {
    label: BLIND_SHEET,
    columns: 3,
    cell: TILE,
    cells: [
      { kind: "blocks", label: "单独一块", textures: [url], blocks: [{ at: [0, 0, 0], texture: 0 }], view: "corner" },
      { kind: "tiles", label: `一个面 · 游戏里的实际大小（离它 ${TEXTURE_SEEN.distance} 格，一格 ${TEXTURE_SEEN.block} 像素）`, textures: [url], layout: [[0]], pixel: TEXTURE_SEEN.block / 16 },
      enlarged,
    ],
  }
}

/**
 * The side of the square picture of a shape: the largest a cell draws a picture without scaling it (the renderer
 * leaves 56 pixels of a cell for the label and 24 for the margin; a cell is `TILE` wide and high), so every pixel of it is a pixel of the picture.
 */
const SHAPE_PICTURE = TILE[1] - 56

/** The pictures of a block that is boxes put together: the game's own drawing of it from the front, the side, behind, above, and beside a player. */
function shapePictures(shape: BlockShape) {
  const sheet = (() => {
    try {
      return decodeRgbaPng(decodeTextureDataUrl(shape.sheet))
    } catch {
      throw new MakingRefusal("方块外形的 sheet 不是一张读得出来的 PNG，画不出来。sheet 要是一张 16、32 或 64 像素见方的 PNG（data URL），或者用脚本把图画出来。")
    }
  })()
  const picture = (view: keyof typeof SHAPE_VIEWS, label: string, player = false): LookCell => ({ kind: "flat", label, url: dataUrl(encodePng(drawShape(shape, sheet, SHAPE_VIEWS[view], SHAPE_PICTURE, player).pixels, SHAPE_PICTURE, SHAPE_PICTURE)) })
  return {
    sheet,
    front: picture("front", "正面（north 那一面，放下时朝着放它的人）"),
    side: picture("side", "侧面（从东边看）"),
    back: picture("back", "背面（south 那一面）"),
    quarter: picture("quarter", "斜上方（前面、东侧和顶上）"),
    player: picture("front", "和玩家比：灰色方框是玩家（宽 0.6 格、高 1.8 格），白线是她的眼睛，格线一格一条", true),
  }
}

/**
 * A block that is boxes put together (`shape`). The pictures are the game's own drawing of the shape, the sheet is shown as it is,
 * and what was counted on the two (`measureShape`) is both said and held to be answered: a face the game would not show,
 * boxes on top of each other, a box nobody can see.
 */
function shapeLook(shape: BlockShape): Looked {
  const shown = shapePictures(shape)
  const faults = measureShape(shape, shown.sheet).map((fault) => fault.text)
  const facts = [...shapeLines(shape, shown.sheet), ...faults]
  const flat = dataUrl(encodePng(shown.sheet.pixels, shown.sheet.width, shown.sheet.height))
  return {
    job: {
      scenes: [],
      sheets: [
        {
          label: "方块的外形：正面、侧面、斜上方、背面、sheet 原样、和玩家比",
          columns: 3,
          cell: TILE,
          cells: [shown.front, shown.side, shown.quarter, shown.back, { kind: "tiles", label: `sheet 原样（${shown.sheet.width}×${shown.sheet.height}，放大看每个像素）`, textures: [flat], layout: [[0]] }, shown.player],
        },
      ],
    },
    notes: facts,
    cover: coverOf(shown.quarter),
    ...MOTIONLESS,
    texture_facts: facts,
    ...(faults.length ? { measured: faults } : {}),
    world: null,
  }
}

/**
 * A block or an item as the game shows it. The first sheet is of the thing alone and is what is kept; the
 * `world` sheet sets it among the game's own pictures and exists only when they could be read here.
 */
function flatLook(document: Flat, world: LookWorld, sheet: Still = null): Looked {
  if (document.kind === "block" && document.shape) return shapeLook(document.shape)
  const label = document.kind === "block" ? "方块" : "物品"
  const url = flatUrl(document)
  const decoded = (source: string) => {
    try {
      return decodeRgbaPng(decodeTextureDataUrl(source))
    } catch {
      return null
    }
  }
  const image = decoded(url)
  if (!image) throw new MakingRefusal(`${label}的图不是一张读得出来的 PNG，画不出来。texture 要是一张完整的 PNG（data URL），或者用脚本把图画出来。`)
  // A block may have more pictures for the game to choose among from place to place, and may be mirrored or turned at random.
  const more = document.kind === "block" ? (document.variants ?? []) : []
  const mix = document.kind === "block" ? { mirror: document.random_mirror, turn: document.random_turn } : {}
  if (more.length && !document.texture) throw new MakingRefusal("方块写了 variants（更多的图），可是没有第一张：先把 texture 画出来，variants 里是另外的几张。")
  const extra = more.map((source, index): Picture => {
    const found = decoded(source)
    if (!found) throw new MakingRefusal(`方块的第 ${index + 2} 张图（variants 的第 ${index + 1} 张）不是一张读得出来的 PNG，画不出来。`)
    if (found.width !== image.width || found.height !== image.height) throw new MakingRefusal(`方块的几张图要一样大：第 1 张是 ${image.width}×${image.height}，第 ${index + 2} 张是 ${found.width}×${found.height}。`)
    return found
  })
  const note = textureNote(image, world?.beside ?? [], world?.inside ?? null, extra, mix, world?.family ?? null)
  const facts = [...(world ? [] : [NO_WORLD_WORDS]), ...textureLines(document.kind, note, sheet)]
  const others = world?.beside ?? []
  const named = (picture: WorldPicture) => `原版 · ${picture.label ?? picture.name}`
  const texel = TEXTURE_SEEN.block / image.width
  if (document.kind === "block") {
    const own = [url, ...more]
    const entries = faceEntries(own.length, mix)
    const mixed = entries.length > 1
    // What the game shows at a place: its own choice for that position (`facePick`), the wall standing at `BLOCK_FACES.height`.
    const shown = (x: number, y: number, z = 0) => entries[facePick(x, BLOCK_FACES.height + y, z, entries.length)]!
    const pose = (entry: FaceEntry, top = true) => (top ? entry.turn : 0) + (entry.mirror ? 4 : 0)
    const worn = (at: Vector, light?: number): LookBlock => ((entry) => ({ at, texture: entry.picture, ...(light === undefined ? {} : { light }), ...(pose(entry) ? { pose: pose(entry) } : {}) }))(shown(at[0], at[1], at[2]))
    // A wall seen from in front, `high` blocks tall: the picture's top row is the highest blocks. With every pose 0 the cell is written as it always was.
    const wall = (wide: number, high: number, face = shown) => ((picked) => ({ layout: picked.map((row) => row.map((entry) => entry.picture)), ...(picked.some((row) => row.some((entry) => entry.mirror)) ? { poses: picked.map((row) => row.map((entry) => pose(entry, false))) } : {}) }))(rows(wide, high, (x, y) => face(x, high - 1 - y)))
    const alone: LookCell = { kind: "blocks", label: "单独一块", textures: [url], blocks: [{ at: [0, 0, 0], texture: 0 }], view: "corner" }
    const glow = document.luminance
    const inside = world?.inside ?? null
    // Set into the rock it generates in, with one of the game's own beside it; with no such rock, built into a wall with the others in columns.
    const sitter = inside ? others.find((picture) => picture.name !== inside.name) : undefined
    const among = inside ? [...own, inside.url, ...(sitter ? [sitter.url] : [])] : [...own, ...others.map((picture) => picture.url)]
    // Which picture a place of that wall wears: one of the block's own (as the game picks it there), or one of the game's, counted after them.
    const foreign = (index: number) => own.length - 1 + index
    const cellOf = (x: number, y: number): { texture: number; pose: number } => {
      const theirs = inside ? (CLUMP.includes(`${x},${y}`) ? 0 : sitter && CLUMP.includes(`${x - 3},${y - 1}`) ? 2 : 1) : [1, 2, 0, 0, 3, 4].map((index) => (foreign(index) < among.length ? index : 0))[x]!
      return theirs ? { texture: foreign(theirs), pose: 0 } : ((entry) => ({ texture: entry.picture, pose: pose(entry) }))(shown(x, y))
    }
    const placed = (x: number, y: number): LookBlock => ((cell) => ({ at: [x, y, 0], texture: cell.texture, ...(cell.pose ? { pose: cell.pose } : {}) }))(cellOf(x, y))
    const facing = (layout: { texture: number; pose: number }[][]) => ({ layout: layout.map((row) => row.map((cell) => cell.texture)), ...(layout.some((row) => row.some((cell) => cell.pose & 4)) ? { poses: layout.map((row) => row.map((cell) => cell.pose & 4)) } : {}) })
    const night: LookCell = { kind: "blocks", label: `夜里它自己发的光（亮度 ${glow}，示意）`, textures: [url], blocks: Array.from({ length: 15 }, (_, index) => ({ x: (index % 5) - 2, y: Math.floor(index / 5) - 1 })).map((place) => ({ at: [place.x, place.y, 0] as Vector, texture: place.x || place.y ? null : 0, light: lit(glow - Math.abs(place.x) - Math.abs(place.y)) })), view: "wall", night: true }
    const ways = `${own.length} 张图${mix.mirror ? "、左右镜像" : ""}${mix.turn ? "、转向" : ""}`
    return {
      job: {
        scenes: [],
        sheets: [
          {
            label: mixed ? `方块的贴图（${ways}，按游戏的随机混法）：铺开、砌墙、实际大小` : "方块的贴图：铺开、砌墙、实际大小",
            columns: 3,
            cell: TILE,
            cells: mixed
              ? [
                  // A turn shows only from above, so a block that turns is laid as a floor here; the walls are in the next cells.
                  mix.turn
                    ? { kind: "tiles", label: "平铺 4×4 · 铺成地面从上往下看（看接缝和重复）", textures: own, ...((picked) => ({ layout: picked.map((row) => row.map((entry) => entry.picture)), poses: picked.map((row) => row.map((entry) => pose(entry))) }))(rows(4, 4, (x, z) => shown(x, 0, z))) }
                    : { kind: "tiles", label: "平铺 4×4 · 墙的正面（看接缝和重复）", textures: own, ...wall(4, 4) },
                  { kind: "blocks", label: "砌成一面墙（世界里的光）", textures: own, blocks: Array.from({ length: 18 }, (_, index) => worn([index % 3, Math.floor(index / 3) % 3, -Math.floor(index / 9)])), view: "wall" },
                  { kind: "tiles", label: `游戏里的实际大小（离它 ${TEXTURE_SEEN.distance} 格，一格 ${TEXTURE_SEEN.block} 像素）`, textures: own, ...wall(5, 5), pixel: texel },
                  { kind: "tiles", label: "对照：只用第 1 张、不镜像时的同一面墙（实际大小）", textures: [url], layout: rows(5, 5, () => 0), pixel: texel },
                  { kind: "tiles", label: own.length > 1 ? `${own.length} 张图各自放大（按顺序是第 1 到第 ${own.length} 张）` : "放大看每个像素（只用来找哪个像素不对）", textures: own, layout: own.length === 4 ? [[0, 1], [2, 3]] : [own.map((_, index) => index)], lines: true },
                  glow > 0 ? night : { kind: "tiles", label: `再远一倍（离它 ${TEXTURE_SEEN.distance * 2} 格，一格 ${TEXTURE_SEEN.far} 像素）`, textures: own, ...wall(10, 10), pixel: texel / 2 },
                ]
              : [
                  { kind: "tiles", label: "平铺 4×4（看接缝和重复）", textures: [url], layout: rows(4, 4, () => 0) },
                  { kind: "blocks", label: "砌成一面墙（世界里的光）", textures: [url], blocks: Array.from({ length: 18 }, (_, index) => ({ at: [index % 3, Math.floor(index / 3) % 3, -Math.floor(index / 9)] as Vector, texture: 0 })), view: "wall" },
                  alone,
                  { kind: "tiles", label: `游戏里的实际大小（离它 ${TEXTURE_SEEN.distance} 格，一格 ${TEXTURE_SEEN.block} 像素）`, textures: [url], layout: rows(5, 5, () => 0), pixel: texel },
                  { kind: "tiles", label: "放大看每个像素（只用来找哪个像素不对）", textures: [url], layout: [[0]], lines: true },
                  glow > 0 ? night : { kind: "tiles", label: `再远一倍（离它 ${TEXTURE_SEEN.distance * 2} 格，一格 ${TEXTURE_SEEN.far} 像素）`, textures: [url], layout: rows(10, 10, () => 0), pixel: texel / 2 },
                ],
          },
        ],
      },
      notes: facts,
      cover: coverOf(alone),
      ...MOTIONLESS,
      texture: note,
      texture_facts: facts,
      world: world
        ? {
            label: WORLD_SHEET_NAME,
            columns: 4,
            cell: NARROW,
            cells: [
              { kind: "blocks", label: inside ? `长在「${inside.label ?? inside.name}」里（墙）` : "和原版方块砌在一起", textures: among, blocks: Array.from({ length: 24 }, (_, index) => placed(index % 6, Math.floor(index / 6))), view: "wall" },
              { kind: "tiles", label: "同一面墙 · 游戏里的实际大小", textures: among, ...facing(rows(4, 4, (x, y) => cellOf(x + 1, 3 - y))), pixel: texel },
              ...own.map((picture, index): LookCell => ({ kind: "tiles", label: own.length > 1 ? `做出来的第 ${index + 1} 张` : "做出来的这一张", textures: [picture], layout: rows(2, 2, () => 0) })),
              ...others.slice(0, others.length - (own.length - 1)).map((picture): LookCell => ({ kind: "tiles", label: named(picture), textures: [picture.url], layout: rows(2, 2, () => 0) })),
            ],
          }
        : null,
    }
  }
  const tool = "tool" in document && document.tool != null
  const enlarged: LookCell = { kind: "tiles", label: "放大看每个像素（只用来找哪个像素不对）", textures: [url], layout: [[0]], lines: true }
  const scales = [TEXTURE_SEEN.gui, TEXTURE_SEEN.gui / 2]
  const row = [null, null, url, null, null]
  const among = [...others.slice(0, 2).map((picture) => picture.url), url, ...others.slice(2, 4).map((picture) => picture.url)]
  return {
    job: {
      scenes: [],
      sheets: [
        {
          label: "物品的图标：格子里、放大、拿在手里",
          columns: 3,
          cell: TILE,
          cells: [
            { kind: "slots", label: `背包格子里的实际大小（${TEXTURE_SEEN.icon} 像素，和小一号的 ${TEXTURE_SEEN.small} 像素）`, icons: row, dark: false, scales },
            { kind: "slots", label: "深色的格子里（快捷栏那样）", icons: row, dark: true, scales },
            enlarged,
            { kind: "slots", label: "只看轮廓（实际大小）", icons: row, dark: false, scales, solid: true },
            { kind: "held", label: `拿在手里 · 平着拿（普通物品）${tool ? "" : " ← 游戏里是这样"}`, url, pose: "generated" },
            { kind: "held", label: `拿在手里 · 握着柄（工具和武器）${tool ? " ← 游戏里是这样" : ""}`, url, pose: "handheld" },
          ],
        },
      ],
    },
    notes: facts,
    cover: coverOf({ kind: "tiles", label: "图标", textures: [url], layout: [[0]] }),
    ...MOTIONLESS,
    texture: note,
    texture_facts: facts,
    world: world
      ? {
          label: WORLD_SHEET_NAME,
          columns: 4,
          cell: NARROW,
          cells: [
            { kind: "slots", label: "和原版物品放在一排", icons: among, own: among.indexOf(url), dark: false, scales },
            { kind: "slots", label: "深色的格子里", icons: among, own: among.indexOf(url), dark: true, scales },
            { kind: "tiles", label: "做出来的这一个", textures: [url], layout: [[0]], lines: true },
            ...others.map((picture): LookCell => ({ kind: "tiles", label: named(picture), textures: [picture.url], layout: [[0]], lines: true })),
          ],
        }
      : null,
  }
}
const MOTIONLESS = { motion: [], facts: [] }
// The same with no epic phrasing fault, where `motionFacts` would otherwise be asked.
const UNMEASURED = { ...MOTIONLESS, epic: [] as string[] }
const NOTHING_TO_SEE = "这一类内容没有可以看的样子，不需要看图。"

// ---- r29c: what an ability that carries the creature, and its moments of impact, add to its pictures (drawn as trails over the cell, model pixels) ----

/** A wall it is taken to meet, and a shake (the way and the box of the first hit are `TRAVEL_COLOR`, `ability-travel.ts`). */
const WALL_COLOR = "#9a9a9a"
const TARGET_COLOR = "#ffffff"
const SHAKE_COLOR = "#4db8ff"
/** The least a speck at a point of impact is drawn across, in blocks (土蝼, r29c: a burst of 0.1–0.2-block specks was lost in a frame wide enough for the creature and the wall). */
const IMPACT_SEEN = 0.3
/** A wall 3 blocks wide and as high, its face square to the way ahead `forward` blocks out, round where it is met. */
function wallOutline(forward: number, at: Place): Vector[] {
  const point = (left: number, up: number) => abilityPlace(forward, up, at.left + left)
  return [point(-1.5, 0), point(1.5, 0), point(1.5, 3), point(-1.5, 3), point(-1.5, 0)]
}
/** A ring on the ground `radius` blocks round `at`. */
const groundRing = (at: Place, radius: number): Vector[] => Array.from({ length: 49 }, (_, step) => ((angle) => abilityPlace(at.forward + Math.cos(angle) * radius, 0.05, at.left + Math.sin(angle) * radius))((step / 48) * Math.PI * 2))
/** A small zigzag just over `point`: the sign that screens shake there. */
const shakeMark = (point: Vector): Vector[] => Array.from({ length: 7 }, (_, step): Vector => [point[0] + (step - 3) * 4, point[1] + 10 + (step % 2 ? 4 : -4), point[2]])

/**
 * Engineer G2: a creature's abilities on its model. For every hit moment of every ability a frame AT that
 * moment from the side, from above and from a quarter, with where the hit lands drawn see-through over it,
 * and what was measured there (`hitLines`) under the last one and in the notes. One sheet an ability.
 */
function abilityLook(document: Extract<ModuleDocument, { kind: "entity" }>, wears: Model | null, options: LookOptions = {}, effects: EffectLookup | null = null, most: number = MAKING_LIMITS.sheets): Looked {
  const every = feedbackOwner(document).abilities ?? []
  if (!every.length) throw new MakingRefusal(NOTHING_TO_SEE)
  // H3: `animation` names one ability (by its id, or by the motion it plays) when only that one is wanted; or one combo, by its id.
  const allCombos = document.combos ?? []
  const abilities = options.animation === undefined ? every : every.filter((ability) => ability.id === options.animation || ability.clip === options.animation)
  const combos = options.animation === undefined ? allCombos : allCombos.filter((combo) => combo.id === options.animation)
  if (!abilities.length && !combos.length) throw new MakingRefusal(`这只生物没有叫「${options.animation}」的招式${allCombos.length ? "或连招" : ""}。它有：${names([...every.map((ability) => ability.id), ...allCombos.map((combo) => combo.id)])}。`)
  if (!wears) throw new MakingRefusal("这只生物还没有模型，招式的判定范围没有东西可以画上去。先让它依赖做好的模型。")
  const design = designOf(wears)
  const bounds = modelBounds(design)
  // Boss 能力 7: an ability's lightning is drawn as the hit it lands as (`struckAbility`): its column at every place, and its warning.
  const made = abilities.map((ability) => ({ ability, hits: abilityHitShapes(struckAbility(ability), design) }))
  const room = Math.max(...[0, 1, 2].map((axis) => bounds.max[axis]! - bounds.min[axis]!))
  // J2: how tall the creature stands, in blocks: how much higher the target is put to see whether what aims at it and what is shown still agree.
  const tall = creatureTall(design)
  // H3: the creature alone is scene 0; every moment drawn with effects adds the scenes it needs.
  const scenes: LookScene[] = [scene(design)]
  const effectFacts = effects ? new Map(abilities.map((ability) => [ability.id, abilityEffectFacts(ability, effects, tall, diveFrame(ability, design))])) : null
  const dropped: LookFinding[] = []
  // r29c: the game's own box of the creature (blocks): what a dive brings to its target, what meets a wall or the one it fights.
  const core = hitboxBoxes(document.hitbox, design)[0]!
  const body = { width: (core.max[0] - core.min[0]) / 16, height: (core.max[1] - core.min[1]) / 16 }
  const travels = new Map(abilities.map((ability) => [ability.id, abilityTravel(ability, { design, flight: document.flight, abilities: every, height: body.height })] as const))
  // r29c: the moments each runs into something (`impactMoments`), placed where its travel takes it.
  const impacts = new Map(abilities.map((ability) => [ability.id, impactMoments(ability, travels.get(ability.id) ?? null, { stagger: document.stagger, ...body })] as const))
  const pictures = ({ ability, hits }: (typeof made)[number]): LookSheet[] => {
    if (!hits) return []
    // r29c: where the ability carries the creature (`abilityTravel`, the generated Java's sums): every moment is drawn with it there, its way as a dashed yellow line and a yellow box where it is at the first hit.
    const travel = travels.get(ability.id) ?? null
    const shiftOf = (place: Place): Vector => abilityPlace(place.forward, place.up, place.left)
    const offsetAt = (time: number): Vector | null => travelShift(travel, time)
    // A hit round the creature is counted where the creature is on its tick (`travelFaces`).
    const placed = (hit: (typeof hits)[number]): Vector[][] => travelFaces(hit, travel)
    // With the one it fights where every picture puts them, as a white box: what it is going for.
    const drawnTravel = travel ? [...travelTrails(travel, body), { points: boxOutline(abilityPlace(assumedTarget(ability), 0, 0), { width: 0.6, height: AIM_TARGET.tall }), color: TARGET_COLOR }] : []
    const route = drawnTravel.flatMap((trail) => trail.points)
    const moved = (time: number) => ((by) => (by ? { offset: by } : {}))(offsetAt(time))
    const withParticles = (sheets: LookSheet[]): LookSheet[] => {
      if (!ability.events.some(e => e.type === "particle") && !ability.hits.some(h => h.type === "projectile" && h.trail)) return sheets
      const frames = new Map<number, ReturnType<typeof particlePreview>>()
      const carried = travel ? (tick: number) => travel.places[Math.max(0, Math.min(travel.places.length - 1, tick))]! : undefined
      return sheets.map(s => ({ ...s, cells: s.cells.map((cell, index): LookCell => {
        if ((cell.kind !== "hit" && cell.kind !== "view") || !cell.camera || !cell.animation || cell.time === undefined) return cell
        const sampled = frames.get(cell.time) ?? particlePreview(ability, design, cell.time, document.particles, effects?.particle, carried)
        frames.set(cell.time, sampled)
        if (!sampled.groups.length) return cell
        const last = !s.cells.slice(index + 1).some(other => (other.kind === "hit" || other.kind === "view") && other.time === cell.time)
        const captions = last ? sampled.captions : []
        return cell.kind === "view" ? { ...cell, particles: sampled.groups, caption: captions } : { ...cell, particles: sampled.groups, caption: [...cell.caption, ...captions] }
      }) }))
    }
    // r29c: an asked `angle` is the side each moment is shown from.
    const side = options.angle === undefined ? vantage(design, design.animations.find((motion) => motion.name === ability.clip)!)[1] : askedView(options.angle)
    const clip = design.animations.find((motion) => motion.name === ability.clip)!
    // Round 10: the end of the wind-up is a moment the motion is read by, like each hit. When no hit is counted right then, it gets a frame of its own.
    const lead = ability.windup > 0 && !hits.some((hit) => Math.abs(hit.at - ability.windup) < 0.001) ? [Math.min(ability.windup, clip.length)] : []
    // Moments asked for (a reviewer's `need` with `times`, or a look with `times`): kept inside the clip, a moment within a tick of an earlier one only once.
    const asked = options.times?.length ? distinct(options.times.map((time) => Math.min(Math.max(time, 0), clip.length))) : null
    if (asked && options.times!.some((time) => time > clip.length)) dropped.push({ rule: "look_clip_time", refs: [abilityRef(ability), clipRef(ability.clip)], text: `招式「${ability.name}」播的动作 ${ability.clip} 只有 ${seconds(clip.length)}，要的时刻超出的按最后一刻画。`, fix: "" })
    // The hit a moment is drawn with: the one nearest to it in time (the earlier of two equally near), whose shape is where that hit lands. A moment between hits shows the shape of the closest one, said in its label.
    const nearest = (time: number) => hits.reduce((best, hit) => (Math.abs(hit.at - time) < Math.abs(best.at - time) ? hit : best), hits[0]!)
    // Every moment is drawn from a quarter and, while the sheet has room, from the side the motion is read from: the sheet holds `SHEET_CELLS` cells (6), so up to 3 moments get both, more get the quarter alone.
    const wanted: LookView[] = asked && asked.length * 2 <= SHEET_CELLS ? ["quarter", side] : ["quarter"]
    const hitName = (hit: (typeof hits)[number]) => (hit.lightning ? "落雷" : hit.shot ? "出手" : "判定")
    const momentLabel = (view: LookView, time: number) => ((hit) => `${VIEW_LABELS[view]} · ${seconds(time)}${Math.abs(hit.at - time) < 1 / TICKS ? `（${hitName(hit)}）` : `（最近一次${hitName(hit)}在 ${seconds(hit.at)}）`}`)(nearest(time))
    // Three views of one hit; with more hits than two, the side and the quarter of each. Round 10: when the wind-up's own frame leaves
    // one cell too few, the later hits give up a view each (the one given up last is the one that shows most: the whole range from above for a
    // few hits, the pose from the side for many), so every hit and the end of the wind-up are all on the sheet.
    const order: LookView[] = hits.length > 2 ? ["quarter", side, "top"] : ["quarter", "top", side]
    const most = hits.length > 2 ? 2 : 3
    // Boss 能力 3: what is drawn of a hit: its own shape at every place it lands on (the same faces the hit is measured with) and, for one at the feet of the one it fights, a box a player's size where
    // they are taken to stand. How long before it the warning shows, said in its label; and for each warned hit (two at most) a cell from above at the moment the warning appears, before the hits take the rest.
    // Boss 能力 2: a thrown thing is drawn as its whole flight (`projectileSketch`, the formulas the game flies it by): each way out dashed in red, each way back dashed in blue, a ring
    // where it lands as wide as what it strikes, and the target as a box where the pictures put them; the cell frames all of it, and says when it lands, how long it sticks and when it is back.
    const flights = new Map(hits.map((hit) => [hit.index, projectileSketch(ability, hit.index, design)] as const))
    const flightOf = (hit: (typeof hits)[number]) => flights.get(hit.index) ?? null
    const flightRings = (hit: (typeof hits)[number]) => {
      const sketch = flightOf(hit)
      const thrown = ability.hits[hit.index]
      if (!sketch || thrown?.type !== "projectile") return []
      const target = shapeFaces({ type: "box", forward: sketch.target, up: 0.9, left: 0, width: 0.6, height: 1.8, depth: 0.6 })
      return [...sketch.flights.flatMap((flight) => (flight.land ? landingRing(flight.land.place, Math.max(0.5, thrown.radius)) : [])), ...(sketch.sky ? [] : target)]
    }
    // 落地炸开: where a thrown thing bursts is drawn as a star at every landing, with what it leaves on the ground there (`impactLines`).
    const bursts = (hit: (typeof hits)[number]) => ((sketch) => (sketch ? impactLines(ability, sketch) : []))(flightOf(hit))
    const flightTrails = (hit: (typeof hits)[number]) => [
      ...(flightOf(hit)?.flights ?? []).flatMap((flight) => [{ points: flight.out, color: "#ff5533", dashed: true }, ...(flight.back.length > 1 ? [{ points: flight.back, color: "#33aaff", dashed: true }] : [])]),
      ...bursts(hit),
    ]
    const flightPoints = (hit: (typeof hits)[number]) => [...(flightOf(hit)?.flights ?? []).flatMap((flight) => [...flight.out, ...flight.back]), ...bursts(hit).flatMap((line) => line.points)]
    // (A volley from the sky leaves from nowhere on the creature: the small ball of where a thing leaves from is left out.)
    const hitFaces = (hit: (typeof hits)[number]) => [...(flightOf(hit)?.sky ? [] : hit.dummy ? [...placed(hit), ...hit.dummy] : placed(hit)), ...flightRings(hit)]
    // Boss 能力 4: a hit that goes with a dash says how far it goes, one that leaves a force how long it carries them (「（冲刺 20 格）」「（推 3 秒）」); the arrows are in its faces.
    const warnLead = (hit: (typeof hits)[number]) => `${hit.warn ? `（预警提前 ${seconds(hit.tick / TICKS - hit.warn.start)}）` : ""}${dashForceLabel(ability, hit.index)}`
    const warned = hits.filter((hit) => hit.warn).slice(0, 2)
    // Boss 能力 11: each trail (two at most) is a cell of its own: the pose at the moment it ends, from the side the motion is read from, with the curve the far end of its part swept from
    // its start to its end drawn in its colour (`trailPath`: the corner the game follows, at every tick between). An ability without one is drawn as it always was.
    const drawnTrails = trailEvents(ability).slice(0, 2).flatMap(({ index }) => ((path) => (path ? [path] : []))(trailPath(ability, index, design)))
    // r29c: the moments it runs into something (`impactMoments`): those the picture can place get a cell of their own (two at most), the rest are said in the notes.
    const moments = impacts.get(ability.id) ?? []
    const impactRoom = Math.max(0, Math.min(2, 6 - lead.length - warned.length - drawnTrails.length - 1))
    const drawnImpacts = moments.filter((moment) => moment.tick !== null).slice(0, impactRoom)
    const cellsFor = 6 - lead.length - warned.length - drawnTrails.length - drawnImpacts.length
    const shownHits = hits.slice(0, cellsFor)
    // How many views each hit gets: one each, then one more each from the first hit on, as far as the sheet holds.
    const share = shownHits.map((_, index) => Math.min(most, 1 + Math.floor((cellsFor - shownHits.length) / shownHits.length) + (index < (cellsFor - shownHits.length) % shownHits.length ? 1 : 0)))
    // The creature's own box at a moment, where it stands then.
    const standing = (time: number) => ((by) => ({ min: bounds.min.map((value, axis) => value + (by?.[axis] ?? 0)) as Vector, max: bounds.max.map((value, axis) => value + (by?.[axis] ?? 0)) as Vector }))(offsetAt(time))
    // From above the whole shape, to see how far it reaches; from the sides the model with as much of the shape as lies within its own size around it, so the pose can still be read.
    // r29c: round where the creature is at that moment; from above (and for a moment with nothing to frame but the creature) its whole way and the box of its first hit too.
    const reaching = (faces: Vector[][], near: boolean, time = 0) => {
      const own = standing(time)
      const points = [own.min, own.max, ...faces.flat(), ...(near ? [] : route)]
      return {
        min: [0, 1, 2].map((axis) => Math.max(near ? own.min[axis]! - room : Number.NEGATIVE_INFINITY, Math.min(...points.map((point) => point[axis]!)))) as Vector,
        max: [0, 1, 2].map((axis) => Math.min(near ? own.max[axis]! + room : Number.POSITIVE_INFINITY, Math.max(...points.map((point) => point[axis]!)))) as Vector,
      }
    }
    // Every cell of an ability that carries the creature: it stands where it is then, with its way and the box of its first hit drawn over.
    const carry = (cell: LookCell): LookCell => (travel && cell.kind === "hit" ? { ...moved(cell.time), ...cell, trails: [...drawnTravel, ...(cell.trails ?? [])] } : cell)
    // r29c: a moment of impact: the creature where it is then, the wall it is taken to meet (grey) or the one it fights (white box), what the game sends there as it is born,
    // and the shake as a blue mark at the point with a dashed blue ring as far as it reaches on the ground.
    const impactCell = (moment: ImpactMoment, index: number): LookCell => {
      const time = moment.tick! / TICKS
      const at = moment.at!
      const point = shiftOf(at)
      const burst = (fx: ImpactFx, where: Place, seed: number) => impactParticles(fx, where, seed, IMPACT_FX, document.particles, effects?.particle)
      const born = [burst(moment.fx, at, 4099 + index * 7919), ...moment.dazes.map((daze, which) => burst(daze.fx, daze.at, 6151 + index * 7919 + which))].flatMap((group) => (group ? [group] : []))
      // A burst at a point is a handful of specks a fifth of a block across, lost in a frame wide enough for the creature and the wall: drawn at least IMPACT_SEEN across, and said so.
      const groups = born.map((group) => (group.size < IMPACT_SEEN ? { ...group, size: IMPACT_SEEN } : group))
      const enlarged = born.filter((group) => group.size < IMPACT_SEEN).map((group) => `「${group.name}」一颗约 ${Number(group.size.toFixed(2))} 格`)
      const shakes = [moment.fx.shake, ...moment.dazes.map((daze) => daze.fx.shake)].flatMap((shake, which) => (shake ? [{ shake, where: which ? moment.dazes[which - 1]!.at : at }] : []))
      const wall = moment.wall ? wallOutline(moment.wall.forward, at) : []
      const target = moment.wall ? [] : boxOutline(shiftOf({ forward: assumedTarget(ability), up: 0, left: 0 }), { width: 0.6, height: AIM_TARGET.tall })
      const marks = shakes.flatMap(({ shake, where }) => [{ points: shakeMark(shiftOf(where)), color: SHAKE_COLOR }, { points: groundRing(where, shake.radius), color: SHAKE_COLOR, dashed: true }])
      const what = moment.words.replace(/^招式「[^」]*」/, "").replace(/时$/, "")
      return {
        kind: "hit",
        label: `${VIEW_LABELS.quarter} · ${what}那一刻 ${seconds(time)}${moment.wall ? "（灰框是假设的墙）" : "（白框是目标）"}`,
        scene: 0,
        view: "quarter",
        animation: ability.clip,
        time,
        // Where it is the moment it meets it: after the move of that tick.
        offset: shiftOf(moment.feet!),
        camera: lookCamera(reaching([wall, target, [point], ...groups.map((group) => group.points), boxOutline(shiftOf(moment.feet!), body)], true, time), "quarter", TILE[0] / TILE[1]),
        faces: [],
        caption: [...impactMomentWords(moment, (fx) => impactFxWords(fx, (id) => effects?.particle?.(id)?.title ?? null)), ...(enlarged.length ? [`撞点的粒子放大到 ${IMPACT_SEEN} 格画，好看清；游戏里${enlarged.join("，")}。`] : [])],
        // The wall is a dashed outline, so what bursts at its face is not hidden behind it.
        trails: [...(wall.length ? [{ points: wall, color: WALL_COLOR, dashed: true }] : []), ...(target.length ? [{ points: target, color: TARGET_COLOR }] : []), ...marks],
        ...(groups.length ? { particles: groups } : {}),
      }
    }
    const trailCells = drawnTrails.map((path): LookCell => {
      const points = [bounds.min as Vector, bounds.max as Vector, ...path.points]
      const box = { min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!))) as Vector, max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!))) as Vector }
      const end = Math.min(path.event.until, clip.length)
      return { kind: "hit", label: `${VIEW_LABELS[side]} · 拖尾「${path.event.bone}」${seconds(path.event.at)}–${seconds(path.event.until)}（${path.event.color}）`, scene: 0, view: side, animation: ability.clip, time: end, camera: lookCamera(box, side, TILE[0] / TILE[1]), faces: [], caption: [`末端扫过 ${Number(path.travel.toFixed(2))} 格`], trails: [{ points: path.points, color: path.event.color }] }
    })
    // r29: a warning is drawn the way the game paints it. The game's own coloured dust (no `paint`, or "dust", and no effect of the project's) is a scatter of dots along the
    // range's edges, not a surface: drawn as such dots, so a dust warning and a mesh one (a filled surface) are told apart on the picture.
    const dusted = (hit: (typeof hits)[number]) => Boolean(hit.warn && hit.warn.paint !== "mesh" && !("effect" in hit.warn && hit.warn.effect))
    const dust = (hit: (typeof hits)[number]): ParticleGroup => {
      const points = hitFaces(hit).flatMap((face) => face.flatMap((from, index) => {
        const to = face[(index + 1) % face.length]!
        const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / 4))
        return Array.from({ length: steps }, (_, step) => [0, 1, 2].map((axis) => from[axis]! + ((to[axis]! - from[axis]!) * step) / steps) as Vector)
      }))
      const every = Math.max(1, Math.ceil(points.length / 600))
      return { points: points.filter((_, index) => index % every === 0), frame: null, rgb: [...WARN_COLORS[hit.warn!.color ?? "red"].rgb], opacity: 1, size: 0.15, turn: 0, name: "预警彩尘" }
    }
    const warnCells = warned.map((hit): LookCell => ({ kind: "hit", label: `${VIEW_LABELS.top} · 预警出现 ${seconds(hit.warn!.start)}（${seconds(hit.tick / TICKS - hit.warn!.start)}后在这里${hit.lightning ? "落雷" : "判定"}）${dusted(hit) ? "（原版彩尘）" : hit.warn!.paint === "mesh" ? "（网格面）" : ""}`, scene: 0, view: "top", animation: ability.clip, time: hit.warn!.start, camera: lookCamera(reaching(hitFaces(hit), false, hit.warn!.start), "top", TILE[0] / TILE[1]), faces: dusted(hit) ? [] : hitFaces(hit), ...(dusted(hit) ? { particles: [dust(hit)] } : {}), caption: dusted(hit) ? ["预警用原版彩尘画：游戏里是沿着范围边上一颗颗的彩色尘点，不是一整块面；要整块的面，warn.paint 写 mesh。"] : [] }))
    const struck = shownHits.flatMap((hit, which) => {
      const views = [side, "top", "quarter"].filter((view): view is LookView => order.slice(0, share[which]!).includes(view as LookView))
      // A hit that lands away from the creature is framed whole from every side: where it lands is what there is to see. So is a thrown thing's whole flight.
      const sketch = flightOf(hit)
      const box = (near: boolean) => reaching([...hitFaces(hit), ...(sketch ? [flightPoints(hit)] : [])], near && !hit.remote && !sketch, hit.at)
      // r29c: the first hit of an ability that carries the creature is where the yellow box is.
      const here = travel?.first && hit.tick === travel.first.tick ? "（黄框：这一刻它在这里）" : ""
      return views.map((view, index): LookCell => ({ kind: "hit", label: `${VIEW_LABELS[view]} · ${hitName(hit)} ${seconds(hit.at)}${view === "top" ? "（整个范围）" : ""}${here}${warnLead(hit)}`, scene: 0, view, animation: ability.clip, time: hit.at, camera: lookCamera(box(view !== "top"), view, TILE[0] / TILE[1]), faces: hitFaces(hit), caption: index === views.length - 1 ? [...hitLines(ability, hit), ...(sketch ? projectileLines(ability, sketch) : [])] : [], ...(sketch ? { trails: flightTrails(hit) } : {}) }))
    })
    // What room is left shows the motion around those moments, without the shape: where the wind-up ends, then the moments that differ most from each other.
    const told = [...lead, ...hits.map((hit) => hit.at)]
    const between = [...lead, ...measured(design, clip, "quarter").moments.filter((time) => !told.some((other) => Math.abs(other - time) < 1 / TICKS))].slice(0, 6 - struck.length - warnCells.length - trailCells.length - drawnImpacts.length).sort((a, b) => a - b)
    // They stand back by a fifth of the model's own size, so a limb raised or thrust past the pose it is built in is still in the picture and the pose still fills it.
    const wide = lookCamera({ min: bounds.min.map((value, axis) => (axis === 1 ? value : value - room / 5)) as Vector, max: bounds.max.map((value) => value + room / 5) as Vector }, "quarter", TILE[0] / TILE[1])
    // r29c: with a travel such a moment is the creature where it is then, framed with its whole way, so the picture shows where it has come from and where it is going.
    const plainCell = (time: number): LookCell => {
      const label = `${VIEW_LABELS.quarter} · ${lead.includes(time) ? "蓄力结束 " : ""}${seconds(time)}`
      return travel ? { kind: "hit", label, scene: 0, view: "quarter", animation: ability.clip, time, camera: lookCamera(reaching([], false, time), "quarter", TILE[0] / TILE[1]), faces: [], caption: [] } : { kind: "view", label, scene: 0, view: "quarter", animation: ability.clip, time, camera: wide }
    }
    const impactCells = drawnImpacts.map(impactCell)
    const cells = [...struck, ...warnCells, ...trailCells, ...impactCells, ...between.map(plainCell)].map(carry)
    // 第 4 步: its ground hazards, cracks, shockwaves and beams, a sheet of their own (six at most): each from above at its moment, with its lines in its colour (`groundFxPictures`).
    const grounds = groundFxPictures(ability, design, id => effects?.particle?.(id)?.title ?? null, document.particles, effects?.blockColor)
    if (grounds.length > SHEET_CELLS) dropped.push({ rule: "look_ground_limit", refs: [abilityRef(ability)], text: `招式「${ability.name}」有 ${grounds.length} 个地面效果和光束，一张图只放得下 ${SHEET_CELLS} 个，其余的没有画。`, fix: "" })
    const groundSheet: LookSheet[] = grounds.length
      ? [
          {
            label: `招式「${ability.name}」· 地面效果和光束（按各自的颜色画，从上往下看）`,
            columns: 3,
            cell: TILE,
            cells: grounds.slice(0, SHEET_CELLS).map((picture): LookCell => {
              const points = [bounds.min as Vector, bounds.max as Vector, ...picture.lines.flatMap((line) => line.points as Vector[])]
              const box = { min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!))) as Vector, max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!))) as Vector }
              const view = picture.event.type === "terrain_rise" || picture.event.type === "break" ? "quarter" as const : "top" as const
              return { kind: "hit", label: `${VIEW_LABELS[view]} · ${picture.label}`, scene: 0, view, animation: ability.clip, time: picture.time, camera: lookCamera(box, view, TILE[0] / TILE[1]), faces: [], caption: picture.caption, trails: picture.lines.map((line) => ({ points: line.points as Vector[], color: line.color, ...(line.dashed ? { dashed: true } : {}) })) }
            }),
          },
        ]
      : []
    const alone: LookSheet = { label: `招式「${ability.name}」· ${hits.length > 1 ? `${hits.length} 次出手` : "出手的那一刻"}（红色是${hits.every((hit) => hit.shot) ? "东西射出去的位置" : "判定范围"}）`, columns: 3, cell: TILE, cells }
    // Without effects the moments asked for are the creature with where the nearest hit lands, nothing more to draw.
    if (!effects || !effectEvents(ability).length)
      return withParticles([
        asked
          ? { label: `招式「${ability.name}」· 要看的 ${asked.length} 个时刻（红色是${hits.every((hit) => hit.shot) ? "东西射出去的位置" : "判定范围"}）`, columns: 3, cell: TILE, cells: asked.flatMap((time) => wanted.map((view, index): LookCell => carry({ kind: "hit", label: momentLabel(view, time), scene: 0, view, animation: ability.clip, time, camera: lookCamera(reaching(hitFaces(nearest(time)), view !== "top" && !nearest(time).remote, time), view, TILE[0] / TILE[1]), faces: hitFaces(nearest(time)), caption: index === wanted.length - 1 && Math.abs(nearest(time).at - time) < 1 / TICKS ? hitLines(ability, nearest(time)) : [] }))) }
          : alone,
        ...groundSheet,
      ])
    // H3: the same moments with the effects standing where the ability puts them, then each effect at its fullest; the creature alone comes after, because effects can hide a weak pose.
    // A dive that brings a bone to the target (`diveFrame`) is drawn where it strikes; r29c: any ability that carries the creature is drawn where it is at every moment (`moved`, `placed`).
    const dive = diveFrame(ability, design)
    const facts = effectFacts!.get(ability.id)!
    const plans = abilityEffectPlan(ability, effects)
    const drawn = new Map<string, { extra: LookPart[]; over: { scene: number; alpha: number; extra: LookPart[] }[] }>()
    // Each effect is a model of its own (`stagedEffect`), drawn at its place by offset, so it never has to fit inside the creature's document: not its 16 blocks, not its tier, not its atlas.
    // What does not depend on the pose is made once per effect: its faces and its texture. One pose of one effect is one scene, however many cells show it.
    const bases = new Map<string, LookScene>()
    const poses = new Map<string, number>()
    const partOf = (value: ReturnType<typeof effectsShown>[number]): LookPart => {
      const own = stagedEffect(value)
      const key = `${value.event} ${value.age} ${value.place.turn} ${value.place.pitch} ${value.place.spin}`
      const made = bases.get(String(value.event)) ?? bases.set(String(value.event), scene(effectModel(value.document))).get(String(value.event))!
      const known = poses.get(key) ?? poses.set(key, scenes.push({ design: { ...own.design, texture_size: made.design.texture_size }, preview: made.preview ? { geometry: made.preview.geometry, textureDataUrl: made.preview.textureDataUrl } : null }) - 1).get(key)!
      return { scene: known, offset: own.offset }
    }
    // J2: `stand` puts the target somewhere other than level, so what is laid out along an aim is drawn tilted with it.
    const staged = (time: number, stand: Stand | null = null) => {
      const known = drawn.get(`${time} ${stand?.height ?? "level"}`)
      if (known) return known
      const shown = effectsShown(ability, effects, time, stand, dive)
      const solid = shown.filter((value) => value.document.play.opacity >= 1)
      const parts = (list: typeof shown) => list.map(partOf)
      // The solid ones are part of the picture; each see-through group is laid over it at its own opacity, the most solid first.
      const made = {
        extra: parts(solid),
        over: [...new Set(shown.map((value) => value.document.play.opacity).filter((value) => value < 1))].sort((a, b) => b - a).map((alpha) => ({ scene: 0, alpha, extra: parts([...solid, ...shown.filter((value) => value.document.play.opacity < 1 && value.document.play.opacity >= alpha)]) })),
      }
      drawn.set(`${time} ${stand?.height ?? "level"}`, made)
      return made
    }
    // `whole`: the picture holds the creature and every effect there is at that moment, however far out; otherwise it stays close to the creature, as the picture of the creature alone does.
    // `everything`: the picture holds the creature, the hit shape and every effect there is at that moment, however far out (a moment someone asked to see: nothing that is drawn may lie outside the picture).
    const framed = (view: LookView, time: number, label: string, faces: Vector[][], caption: string[], whole = false, everything = false): LookCell => {
      const there = effectsShown(ability, effects, time, null, dive).flatMap((value) => effectCorners(value.document, value.place, value.age) as Vector[])
      const own = standing(time)
      const points = [own.min, own.max, ...(whole && there.length ? [] : faces.flat()), ...there]
      const near = view !== "top" && !whole && !everything
      const box = {
        min: [0, 1, 2].map((axis) => Math.max(near ? own.min[axis]! - room : Number.NEGATIVE_INFINITY, Math.min(...points.map((point) => point[axis]!)))) as Vector,
        max: [0, 1, 2].map((axis) => Math.min(near ? own.max[axis]! + room : Number.POSITIVE_INFINITY, Math.max(...points.map((point) => point[axis]!)))) as Vector,
      }
      const layers = staged(time)
      return carry({ kind: "hit", label, scene: 0, view, animation: ability.clip, time, camera: lookCamera(box, view, TILE[0] / TILE[1]), faces, caption: once(caption), ...moved(time), ...(layers.extra.length ? { extra: layers.extra } : {}), ...(layers.over.length ? { over: layers.over } : {}) })
    }
    // The moments asked for, with the effects standing where the ability puts them then and where the nearest hit lands: this sheet is all there is of it.
    if (asked)
      return [
        {
          label: `招式「${ability.name}」· 和效果一起，要看的 ${asked.length} 个时刻（红色是判定范围）`,
          columns: 3,
          cell: TILE,
          cells: asked.flatMap((time) =>
            wanted.map((view, index) => ((hit) => framed(view, time, momentLabel(view, time), hitFaces(hit), index === wanted.length - 1 ? facts.events.filter((event) => plans.find((plan) => plan.index === event.index)!.hit.index === hit.index).map((event) => event.when) : [], false, true))(nearest(time))),
          ),
        },
      ]
    const shown = hits.slice(0, hits.length === 1 ? 1 : 2)
    const angles: LookView[] = hits.length === 1 ? [side, "top", "quarter"] : ["quarter"]
    const together = shown.flatMap((hit) => angles.map((view, index) => framed(view, hit.at, `${VIEW_LABELS[view]} · ${hit.shot ? "出手" : "判定"} ${seconds(hit.at)}${warnLead(hit)}`, hitFaces(hit), index === angles.length - 1 ? facts.events.filter((event) => plans.find((plan) => plan.index === event.index)!.hit.index === hit.index).map((event) => event.when) : [])))
    const known = plans.flatMap((plan) => {
      const found = effects(plan.effect)
      const measured = found ? effectMeasure(found.document) : null
      return found && measured ? [{ plan, title: found.title, time: Number(((plan.tick + measured.peak.tick) / TICKS).toFixed(2)) }] : []
    })
    // J2: one picture with the target NOT level with what aims at it: the hit tilted as it would be, the effects where the ability then puts them,
    // and a box the size of a player where the target stands. Of the places measured (`aimStands`) the one where the two lie furthest apart; when
    // they agree everywhere, the higher one. From the side, at the moment the effect that belongs to that hit is at its fullest.
    // Not for a dive: it brings the hit onto the target itself, so how high the target stands moves where the creature is, not how the hit is tilted against the effects (nothing is said of it either: `abilityEffectFacts`).
    const apart = dive ? [] : known.flatMap((value) => ((gap) => (gap ? [{ ...value, gap }] : []))(effectAimGap(ability, ability.events[value.plan.index] as EffectEvent, value.plan.hit.index, effects(value.plan.effect), tall)))
    const worst = apart.length ? apart.reduce((best, value) => (value.gap.worst.gap > best.gap.worst.gap ? value : best)) : null
    const stood = worst
      ? ((stand, hit) => {
          // A hit that counts from a bone is tilted about where that bone is: its shape is drawn there, the target's box where the target stands.
          const origin = hit.anchor ? abilityPlace(hit.anchor.forward, hit.anchor.up, hit.anchor.left) : null
          const tilted = shapeFaces(hit.shape, aimPitch((hit.shape.type === "line" || hit.shape.type === "cone" ? hit.shape.up : 0) + (hit.anchor?.up ?? 0), hit.anchor?.forward ?? 0, stand))
          const outline = [...(origin ? tilted.map((face) => face.map((point) => [point[0] + origin[0], point[1] + origin[1], point[2] + origin[2]] as typeof point)) : tilted), ...shapeFaces({ type: "box", forward: stand.distance, up: stand.height + 0.9, left: 0, width: 0.6, height: 1.8, depth: 0.6 })] as Vector[][]
          const points = [bounds.min as Vector, bounds.max as Vector, ...outline.flat(), ...effectsShown(ability, effects, worst.time, stand).flatMap((value) => effectCorners(value.document, value.place, value.age) as Vector[])]
          const layers = staged(worst.time, stand)
          const cell: LookCell = {
            kind: "hit",
            label: `${VIEW_LABELS[side]} · 目标${stand.words}（小方框是目标）${seconds(worst.time)}`,
            scene: 0,
            view: side,
            animation: ability.clip,
            time: worst.time,
            camera: lookCamera({ min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!))) as Vector, max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!))) as Vector }, side, TILE[0] / TILE[1]),
            faces: outline,
            caption: once(facts.events.filter((event) => plans.find((plan) => plan.index === event.index)!.hit.index === worst.gap.hit).flatMap((event) => (event.aim ? [event.aim] : []))),
            ...(layers.extra.length ? { extra: layers.extra } : {}),
            ...(layers.over.length ? { over: layers.over } : {}),
          }
          return [cell]
        })(worst.gap.worst, hits[worst.gap.hit]!)
      : []
    // What room is left goes to the effects at their fullest, each from as many sides as fit: these pictures hold all of an effect, so a row or a circle of them is seen whole.
    const free = 6 - together.length - stood.length
    const sides: LookView[] = free >= known.length * 3 ? [side, "top", "quarter"] : free >= known.length * 2 ? ["top", "quarter"] : ["quarter"]
    const fits = Math.floor(free / sides.length)
    const fullest = known.slice(0, fits).flatMap((value) =>
      sides.map((view, index) =>
        framed(view, value.time, `${VIEW_LABELS[view]} · 效果「${value.title}」最完整的时候 ${seconds(value.time)}`, ((hit) => (hit ? placed(hit) : []))(hits[value.plan.hit.index]), index === sides.length - 1 ? facts.events.filter((event) => event.index === value.plan.index).flatMap((event) => (event.where ? [event.where] : [])) : [], true),
      ),
    )
    if (known.length > fits) dropped.push({ rule: "look_effect_limit", refs: [abilityRef(ability)], text: `招式「${ability.name}」有 ${known.length} 处效果，一张图上只放得下 ${fits} 处最完整的样子，其余的没有画。`, fix: "" })
    return withParticles([
      { label: `招式「${ability.name}」· 和效果一起（红色是判定范围）`, columns: 3, cell: TILE, cells: [...together, ...stood, ...fullest] },
      { ...alone, label: `招式「${ability.name}」· 只看生物的动作（红色是${hits.every((hit) => hit.shot) ? "东西射出去的位置" : "判定范围"}）` },
      ...groundSheet,
    ])
  }
  const sheets = made.flatMap(entry => {
    const picturesForAbility = pictures(entry)
    const { ability } = entry
    if (!design.animations.some(clip => clip.weights && (clip.name === ability.clip || ability.stages?.some(stage => stage.clip === clip.name)))) return picturesForAbility
    const samples = Array.from({length: 129}, (_, i) => abilityClipAt(ability, design, ability.length * i / 128))
    const rows = LAYERS.map(layer => samples.map(at => weightAt(at?.clip.weights?.[layer], at?.time ?? 0)))
    return picturesForAbility.map(sheet => ({...sheet, weightTimeline: {seconds: ability.length, windup: ability.windup, rows}}))
  })
  // 2026-11-14: a combo (连招) is one sheet, its steps' hits one after another on the combo's own clock (`comboPlan`), each drawn with its own step's motion at that moment,
  // so the sequence reads left to right, top to bottom. The first hit of every step is always drawn; the room left goes to the other hits, earliest first.
  const shapesOf = new Map(every.map((ability) => [ability.id, abilityHitShapes(ability, design)] as const))
  const comboSheets = combos.flatMap((combo): LookSheet[] => {
    const plan = comboPlan(combo, every)
    plan.steps.forEach((step) => !shapesOf.get(step.ability.id) && dropped.push({ rule: "ability_clip", refs: [comboRef(combo), abilityRef(step.ability), clipRef(step.ability.clip)], text: `连招「${combo.name}」里的「${step.ability.name}」要播的动作 ${step.ability.clip} 模型里没有，这一招画不出来。`, fix: "" }))
    const moments = plan.steps.flatMap((step, place) => (shapesOf.get(step.ability.id) ?? []).map((hit) => ({ step, place, hit, at: (step.start + hit.tick) / TICKS })))
    if (!moments.length) return []
    const firsts = plan.steps.flatMap((_, place) => moments.filter((moment) => moment.place === place).slice(0, 1))
    const chosen = [...firsts, ...moments.filter((moment) => !firsts.includes(moment))].slice(0, SHEET_CELLS).sort((a, b) => a.at - b.at)
    if (moments.length > chosen.length) dropped.push({ rule: "look_combo_limit", refs: [comboRef(combo)], text: `连招「${combo.name}」一共 ${moments.length} 次出手，一张图只放得下 ${chosen.length} 次：每一招的第一次都画了，其余的没有画。`, fix: "" })
    const cells = chosen.map(({ step, place, hit, at }): LookCell => {
      const points = [bounds.min as Vector, bounds.max as Vector, ...hit.faces.flat()]
      const box = {
        min: [0, 1, 2].map((axis) => Math.max(bounds.min[axis]! - room, Math.min(...points.map((point) => point[axis]!)))) as Vector,
        max: [0, 1, 2].map((axis) => Math.min(bounds.max[axis]! + room, Math.max(...points.map((point) => point[axis]!)))) as Vector,
      }
      return {
        kind: "hit",
        label: `第 ${place + 1} 步「${step.ability.name}」· 连招第 ${seconds(at)}（这一招的 ${seconds(hit.at)}${hit.shot ? "出手" : "判定"}）`,
        scene: 0,
        view: "quarter",
        animation: step.ability.clip,
        time: hit.at,
        camera: lookCamera(box, "quarter", TILE[0] / TILE[1]),
        faces: hit.faces,
        caption: [],
      }
    })
    return [{ label: `连招「${combo.name}」· 依次出${comboWords.steps(combo, every)}，按出手先后排（时间从连招开始算，红色是判定范围或东西射出去的位置）`, columns: 3, cell: TILE, cells }]
  })
  // Boss 能力 14: an ability started by a blow gets one more sheet, its time line from the blow on (`parryTimeline`, the numbers the game runs on): the blow, the parry getting ready,
  // the counter's hits, its wait, and the attacker's disarm. What the colours are is in its label, the numbers and how much of a player's melee still lands in the notes.
  const combatCells = combatStrips(abilities, document.stagger, document.builtin, document.stances).map(row => ({kind: "flat" as const, label:row.label, url:dataUrl(row.png)}))
  const combatSheets: LookSheet[] = combatCells.length ? [{label:"破绽、打断与硬直时间", columns:1, cell:TILE, cells:combatCells}] : []
  const scaleRows = combatScaleTable({...document, abilities})
  const parrySheets = abilities.flatMap((ability): LookSheet[] => {
    const line = parryTimeline(ability)
    const words = parryTimelineWords(ability)
    return line && words ? [{ label: `招式「${ability.name}」· 被打中以后：触发 → 架住 → 反击${line.disarm !== null ? "，以及缴械的时间" : ""}`, columns: 2, cell: TILE, cells: [{ kind: "flat", label: words.label, url: dataUrl(parryTimelinePicture(line).png) }] }] : []
  })

  // The abilities first, as they always were; the time lines of those a blow starts, then the combos after them.
  const kept = [...combatSheets, ...sheets, ...parrySheets, ...comboSheets].slice(0, Math.max(1, most))
  if (!kept.length) {
    // Only a motion the model really lacks is said to be missing (the UI run of 2026-11-15 was told its model lacked earth_slam and stone_sweep while listing both).
    const lacking = abilities.filter((ability) => !design.animations.some((motion) => motion.name === ability.clip)).map((ability) => ability.clip)
    throw new MakingRefusal(lacking.length ? `模型里没有这些招式要播的动作：${names(lacking)}。它有：${names(design.animations.map((motion) => motion.name))}。` : `这些招式这次一张都没画出来（${names(abilities.map((ability) => ability.id))}）。用 animation 写一个招式的 id，单独看它一次。`)
  }
  const comboFindings = comboIssues({ name: document.name, abilities: every, combos })
  const boneFindings = boneIssues({ name: document.name, abilities }, design)
  const trailFindings = trailIssues({ name: document.name, abilities }, design)
  const flightFindings = diveIssues({ name: document.name, behavior: document.behavior, flight: document.flight, abilities })
  const particleFindings = abilities.flatMap((ability) => ability.events.flatMap((event) =>
    event.type === "particle" ? scatterFindings(event, document.particles, effects?.particle).map((issue) => ({ ...issue, refs: [abilityRef(ability), ...issue.refs] })) : [],
  ))
  const missingClips = made.flatMap(({ ability, hits }): LookFinding[] => hits ? [] : [{
    rule: "ability_clip", refs: [abilityRef(ability), clipRef(ability.clip)], text: `招式「${ability.name}」要播的动作 ${ability.clip} 模型里没有，画不出来。`, fix: "",
  }])
  const effectFindings = effects && effectFacts ? abilities.flatMap((ability) => abilityEffectFindings(ability, effects, effectFacts.get(ability.id)!)) : []
  return {
    findingDetails: [...comboFindings, ...boneFindings, ...trailFindings, ...flightFindings, ...particleFindings, ...effectFindings, ...missingClips, ...dropped],
    job: { scenes, sheets: kept },
    // What the cells say is said in these notes in full (the cells are cut to a share of their height); a sentence said more than once is said once.
    notes: once([
      HIT_PICTURE_WORDS,
      ...(scaleRows.length ? [`阶段 | ${document.stances ? "姿态 | " : ""}招式 | 服务端刻 [起,止) | 命中部位 | 倍率来源 | 倍率 | 正面（符合格挡种类） | 背面`, ...scaleRows.map(r => `${r.phase} | ${r.stanceName ? r.stanceName + " | " : ""}${r.ability} | [${r.from},${r.to}) | ${r.part} | ${r.source} | ${r.scale} | ${r.front} | ${r.back}`)] : []),
      ...((all) => (all.length > kept.length ? [`一次最多 ${most} 张图，这次没有画：${all.slice(kept.length).map((value) => value.label).join("、")}。${(effects && every.length > 1) || comboSheets.length ? (options.animation === undefined ? `只看一个招式${comboSheets.length ? "或连招" : ""}的话，animation 写那个招式${comboSheets.length ? "或连招" : ""}的 id 再看一次。` : "") : ""}`] : []))([...combatSheets, ...sheets, ...parrySheets, ...comboSheets]),
      ...dropped.map(({ text }) => text),
      // Boss 能力 14: the time line of each ability a blow starts, in numbers, and how much of one player's melee still lands.
      ...abilities.flatMap((ability) => parryTimelineWords(ability)?.lines ?? []),
      // Combos: what each does in words, when each step starts and lands on the combo's own clock, and what was measured of it (`comboIssues`).
      ...combos.flatMap((combo) => [`连招「${combo.name}」：${comboWords.summary(combo, every, "；", false, document.stagger)}。`, `连招「${combo.name}」的时间轴：${comboWords.timeline(combo, every)}。`]),
      ...comboFindings.map((issue) => `${issue.text}${issue.fix}`),
      // A part the model lacks is said before anything drawn from it, as a fault to answer: the pictures of that hit are drawn from the feet, which is not what the document says.
      ...boneFindings.map((issue) => `${BONE_FAULT_MARK}${issue.text}${issue.fix}`),
      ...made.flatMap(({ ability, hits }) => (hits ? [`招式「${ability.name}」：${abilityWords.summary(ability, "；", undefined, undefined, document.stagger)}。`, ...abilityWords.terrain(ability), ...hits.flatMap((hit) => hitLines(ability, hit, document.justified))] : [`招式「${ability.name}」要播的动作 ${ability.clip} 模型里没有，画不出来。`])),
      // r29c: where it carries itself, and when and where it runs into something, as the pictures draw them; a moment the pictures cannot place is said with why.
      ...(made.some(({ ability, hits }) => hits && (travels.get(ability.id) || impacts.get(ability.id)?.length)) ? [TRAVEL_PICTURE_WORDS] : []),
      ...made.flatMap(({ ability, hits }) => ((travel) => (hits && travel ? travelWords(ability, travel) : []))(travels.get(ability.id) ?? null)),
      ...made.flatMap(({ ability, hits }) => (hits ? (impacts.get(ability.id) ?? []).flatMap((moment) => impactMomentWords(moment, (fx) => impactFxWords(fx, (id) => effects?.particle?.(id)?.title ?? null))) : [])),
      // Boss 能力 11: each trail, the corner it follows and how far that swept; a trail too short to see or behind a part that does not move then.
      ...abilities.flatMap((ability) => trailEvents(ability).map(({ index }) => trailLine(ability, index, design))),
      ...particleFindings.map(({ text }) => text),
      ...trailFindings.map((issue) => `${issue.text}${issue.fix}`),
      // Flight: a dive that cannot get to its target between the end of its wind-up and its first hit would be seen to miss, whatever the hit shapes show.
      ...flightFindings.map((issue) => `${issue.text}${issue.fix}`),
      // H3: when each effect appears and where it lies against the hit; a target is drawn where it is taken to stand.
      ...(effects
        ? abilities.flatMap((ability) => [
            ...((facts) => [
              ...facts.events.flatMap((event) => [event.when, ...(event.where ? [event.where] : []), ...(event.aim ? [event.aim] : [])]),
              ...(facts.alive ? [facts.alive] : []),
              // J2: every other picture draws what aims at the target as level.
              ...(facts.events.some((event) => event.aim?.includes("朝目标瞄")) ? [`招式「${ability.name}」的图上，朝目标瞄的判定都画成水平的；只有标着「目标站在…」的那一格把目标放在别的高度，判定和效果按那时候的样子画。`] : []),
            ])(effectFacts!.get(ability.id)!),
            // A dive is drawn where it strikes.
            ...((dive) => (dive && effectEvents(ability).length ? [`招式「${ability.name}」是俯冲：游戏里它会冲到目标身上，第一次出手（第 ${Number((dive.arrives / TICKS).toFixed(2))} 秒）的时候「${hitBone(ability.hits.reduce((first, hit) => (hit.at < first.at ? hit : first)))}」已经在目标那里，所以「和效果一起」那张图里，从第一次出手起生物画在目标那里，判定范围（红色）一直画在打到的地方，效果和判定范围也是在这个位置上量的；蓄力的时候它还在出发的地方，冲过去的那一路是黄色虚线；身体的倾斜图上没有画。`] : []))(diveFrame(ability, design)),
            ...(effectEvents(ability).some((found) => found.event.where === "target" || effects(found.event.effect)?.document.play.facing === "target") ? [`招式「${ability.name}」的图上，目标画在正前方 ${assumedTarget(ability)} 格（它能出这一招的距离的中间）。`] : []),
            ...(effectEvents(ability).some((found) => effects(found.event.effect)?.document.play.facing === "camera") ? [`招式「${ability.name}」里有一直对着玩家的效果：图上按面朝前画。`] : []),
          ])
        : []),
    ]),
    cover: coverOf({ ...kept[0]!.cells.at(-1)!, caption: [] } as LookCell),
    ...MOTIONLESS,
  }
}

/** K1: the name of the picture of a creature's collision boxes. */
export const HITBOX_SHEET = "碰撞箱（蓝色是身体的箱子，橙色是另外加的部位）"
/** 任务二: the name of the picture of the boxes of parts that follow a bone, at three moments of each of the motions it is most often in. */
export const HITBOX_FOLLOW_SHEET = "碰撞箱跟着骨骼（待机、走路和最常出的一招，各三个时刻）"

/**
 * K1: a creature's collision boxes on its model: from above, from its side, from the front and from a quarter as it
 * is built, and from above and from a quarter at the moment of standing or walking at which most of it is outside
 * them. The model keeps its own colours; what was measured (`hitboxFit`) is written under the pictures and said in the notes.
 */
function hitboxLook(document: Extract<ModuleDocument, { kind: "entity" }>, design: ModelDesign): { sheets: LookSheet[]; notes: string[]; findingDetails: LookFinding[] } {
  const fit = hitboxFit(document.hitbox, design, document.flight)
  // 任务二: the parts that follow a bone, where the game moves them, at three moments of standing, walking and the ability chosen most (only a creature that fights has abilities).
  const frames = followKeyFrames(document.hitbox, design, document.behavior === "hostile" ? (document.abilities ?? []) : []).flatMap((motion) => motion.times.map((time) => ({ clip: motion.clip, time })))
  const posed = frames.map((frame) => hitboxBoxesAt(document.hitbox, design, design.animations.find((animation) => animation.name === frame.clip) ?? null, frame.time))
  const bounds = modelBounds(design)
  const boxes = fit.boxes.map((box) => ({ faces: boxFaces(box) as Vector[][], core: box.core, ...(box.solid ? { solid: box.solid } : {}), ...(box.damageScale === undefined ? {} : { damageScale: box.damageScale }) }))
  const every = [...fit.boxes, ...posed.flat()]
  const frame = { min: [0, 1, 2].map((axis) => Math.min(bounds.min[axis]!, ...every.map((box) => box.min[axis]!))) as Vector, max: [0, 1, 2].map((axis) => Math.max(bounds.max[axis]!, ...every.map((box) => box.max[axis]!))) as Vector }
  const captions = hitboxCaptions(fit)
  const colours = [
    fit.boxes.some((box) => box.damageScale !== undefined) ? "蓝色是身体，橙色是普通部位，红色是弱点，灰蓝色是硬甲（含完全格挡）；按初始阶段画" : "",
    fit.boxes.some((box) => box.solid) ? "青绿色边线是能站上去的实心部位" : "",
  ].filter(Boolean).join("；")
  // The camera frames the boxes and the model exactly (a tenth of margin, `lookCamera`): the lines written under a picture no longer lie over them, because the page draws a captioned cell's picture
  // above the band (`pictureSize`); standing a third further back so the lines lay on ground is not needed, and the boxes fill their picture as every other picture of a look does.
  const cell = (view: LookView, caption: string[], moment: { clip: string; time: number } | null = null): LookCell => ({
    kind: "boxes",
    label: `${VIEW_LABELS[view]} · ${moment ? `${motionLabel(moment.clip)} ${seconds(moment.time)}（动起来最差的一刻）` : "站着不动"}`,
    scene: 0,
    view,
    ...(moment ? { animation: moment.clip, time: moment.time } : {}),
    camera: lookCamera(frame, view, TILE[0] / TILE[1]),
    boxes,
    caption,
  })
  // One picture a moment, from a quarter, the model posed as the motion holds it and the boxes where the game puts them then.
  const followed: LookCell[] = frames.map((moment, index) => ({
    kind: "boxes",
    label: `${motionLabel(moment.clip)} ${seconds(moment.time)}`,
    scene: 0,
    view: "quarter",
    animation: moment.clip,
    time: moment.time,
    camera: lookCamera(frame, "quarter", TILE[0] / TILE[1]),
    boxes: posed[index]!.map((box) => ({ faces: boxFaces(box) as Vector[][], core: box.core, ...(box.solid ? { solid: box.solid } : {}), ...(box.damageScale === undefined ? {} : { damageScale: box.damageScale }) })),
    caption: [],
  }))
  const { notes, findings } = hitboxReport(fit)
  return {
    findingDetails: findings,
    sheets: [
      { label: colours ? `碰撞箱（${colours}）` : HITBOX_SHEET, columns: 3, cell: TILE, cells: [cell("top", captions.shares), cell("plus_x", captions.verdict), cell("quarter", []), ...(fit.moving ? [cell("top", captions.moving, fit.moving), cell("quarter", [], fit.moving)] : [cell("front", [])])] },
      ...(followed.length ? [{ label: `${HITBOX_FOLLOW_SHEET}${colours ? `（${colours}）` : ""}`, columns: 3, cell: TILE, cells: followed }] : []),
    ],
    // A part that names a bone the model lacks is a finding of the boxes' own (`hitboxLines`), said once.
    notes: [HITBOX_PICTURE_WORDS, ...(colours ? [`碰撞箱颜色：${colours}；阶段变化的倍率列在各部位说明里。`] : []), ...notes],
  }
}

/** Boss 能力 10: the name of the picture of a boss's model in each stage of its fight. */
export const BOSS_STAGE_SHEET = "Boss 每个阶段的样子（同一姿势对照显隐、贴图和发光）"
/** Boss 能力 8: the name of the picture of each ability's shake. */
export const SHAKE_SHEET = "震屏：每招够得到的范围（俯视，红圈）和强度随时间（白线是叠加后的强度，红线是上限）"

/**
 * Boss 能力 8 and 10: the boss's model in each stage of its fight, drawn as the game shows it then (the bones its phases hide and the parts its phases have dropped turned off,
 * its own glowing parts at the brightness the stage ends at), and each ability's shake (where it reaches, from above; its strength at the centre over time, against the cap).
 * Scenes are appended from `first`. Nothing for a creature with neither.
 */
function bossLookSheets(document: Extract<ModuleDocument, { kind: "entity" }>, design: ModelDesign, first: number, effects?: EffectLookup | null, selectedPhase?: number): { findingDetails: LookFinding[]; scenes: LookScene[]; sheets: LookSheet[]; notes: string[] } {
  const boss = document.behavior === "hostile" ? document.boss : null
  const abilities = document.behavior === "hostile" ? (document.abilities ?? []) : []
  const plan = boss ? bossLookPlan(boss, abilities) : null
  const scenes: LookScene[] = []
  const sheets: LookSheet[] = []
  const notes: string[] = []
  const compiled = (() => {
    try {
      return fitModelAtlas(design, "look")
    } catch {
      return null
    }
  })()
  if (plan && boss?.phases.some((phase) => phase.model) && compiled) {
    const textures = new Map<string, Uint8Array | null>()
    const painted = (id: string | null | undefined) => {
      if (!id) return null
      if (textures.has(id)) return textures.get(id)!
      const asset = effects?.texture?.(id)
      const size = compiled.design.texture_size
      const png = asset && asset.document.width === size && asset.document.height === size ? compileWorkspaceTexture(asset.document) : null
      textures.set(id, png)
      return png
    }
    const textureName = (id?: string | null) => id ? effects?.texture?.(id)?.title ?? "所选贴图" : "模型贴图"
    const glowName = (slot: (typeof plan.slots)[number]) => slot === "emissive" ? "自身发光" : textureName(slot.asset)
    const glowSlot = plan.slots.findIndex((slot) => slot === "emissive")
    const stages = plan.hidden.length
    const views: LookView[] = selectedPhase === undefined ? ["quarter"] : ["quarter", "front"]
    const appearances = Array.from({ length: stages }, (_, stage) => {
      const dropped = boss.phases.slice(0, stage).flatMap((phase) => (phase.model?.drop ?? []).map((drop) => drop.bone))
      const hidden = [...stageHidden(plan, stage), ...dropped]
      const worn = plan.texture[stage]! ? plan.textures[plan.texture[stage]! - 1] : document.runtime?.texture_asset_id
      return { hidden, invisible: bonesBelow(design, hidden), worn }
    })
    const cells = appearances.flatMap(({ hidden, invisible, worn }, stage): LookCell[] => {
      if (selectedPhase !== undefined && selectedPhase !== stage) return []
      const before = appearances[stage - 1]
      const name = stage === 0 ? "第一阶段（满血）" : `第 ${stage + 1} 阶段（血量 ${Math.round(boss.phases[stage - 1]!.below * 100)}% 以下）`
      const glow = plan.glow[stage]!
      const level = glowSlot >= 0 ? glow[glowSlot]!.to : 1
      const base = painted(worn) ?? compiled.png
      let texture = glowingTexture(base, document.runtime?.texture_asset_id ? null : compiled.glow, level)
      for (const [index, slot] of plan.slots.entries())
        if (slot !== "emissive") texture = glowingTexture(texture, painted(slot.asset), glow[index]!.to)

      const index = first + scenes.push({ design: compiled.design, preview: { geometry: hiddenGeometry(compiled.geometry, design, hidden), textureDataUrl: dataUrl(texture), animation: compiled.animation } }) - 1
      const shown = before ? [...before.invisible].filter((bone) => !invisible.has(bone)) : []
      const gone = before ? [...invisible].filter((bone) => !before.invisible.has(bone)) : [...invisible]
      const changes = [
        shown.length ? `显出 ${shown.join("、")}` : "",
        gone.length ? `藏起 ${gone.join("、")}` : "",
        before && before.worn !== worn ? `换上${textureName(worn)}` : "",
        ...plan.slots.flatMap((slot, index) => {
          const value = glow[index]!.to
          return before && value === plan.glow[stage - 1]![index]!.to ? [] : [`${glowName(slot)} ${Math.round(value * 100)}%`]
        }),
      ].filter(Boolean)
      const said = changes.join(" · ") || (before ? "外观延续上一阶段" : "开场样子")
      return views.map((view): LookCell => ({ kind: "view", label: `${name} · ${VIEW_LABELS[view]} · ${said}`, scene: index, view }))
    })
    const columns = selectedPhase === undefined ? stages : views.length
    if (cells.length) sheets.push({ label: BOSS_STAGE_SHEET, columns, cell: [Math.min(TILE[0], Math.floor(MAKING_LIMITS.sheet[0] / columns)), TILE[1]], cells })
    notes.push(
      ...boss.phases.flatMap((phase, index) => (phase.model ? [`第 ${index + 2} 阶段（血量 ${Math.round(phase.below * 100)}% 以下）${phaseLookWords(phase.model, glowName)}。`] : [])),
      ...(!effects?.texture && (plan.textures.length || plan.slots.some((slot) => slot !== "emissive")) ? ["这次没有读到工程的贴图资产。图里只画模型本身和找得到的发光层。"] : []),
      ...(plan.abilityDrops.length ? [`招式里的掉落（${plan.abilityDrops.map((drop) => `「${abilities[drop.ability]!.name}」掉「${drop.drop.bone}」`).join("、")}）要看那一招什么时候出，阶段图里没有算进去。`] : []),
    )
  }
  if (selectedPhase !== undefined) return { scenes, sheets, notes: [], findingDetails: [] }
  // Each ability's shakes: from above, the rings they reach; their strength over time. Three abilities at most, two cells each.
  const cap = shakeCap(shakesOf(abilities))
  const shaken = abilities.filter((ability) => ability.events.some((event) => event.type === "shake")).slice(0, 3)
  if (shaken.length && compiled) {
    const bounds = modelBounds(design)
    const cells = shaken.flatMap((ability): LookCell[] => {
      const timed = abilityShakes(ability)
      const curve = shakeCurve(timed, cap)!
      const faces = timed.flatMap((shake) => ringFaces(shake.event.radius))
      const widest = Math.max(...timed.map((shake) => shake.event.radius)) * 16
      const box = { min: [Math.min(bounds.min[0]!, -widest), bounds.min[1]!, Math.min(bounds.min[2]!, -widest)] as Vector, max: [Math.max(bounds.max[0]!, widest), bounds.max[1]!, Math.max(bounds.max[2]!, widest)] as Vector }
      const picture = shakeCurvePicture(curve)
      const first = timed[0]!
      return [
        { kind: "hit", label: `俯视 · 「${ability.name}」震屏 ${seconds(first.tick / TICKS)}`, scene: 0, view: "top", animation: ability.clip, time: Math.min(first.tick / TICKS, ability.length), camera: lookCamera(box, "top", TILE[0] / TILE[1]), faces, caption: timed.map((shake) => `半径 ${shake.event.radius} 格（${shake.event.falloff === "none" ? "范围内一样强" : "越远越轻"}）`) },
        { kind: "flat", label: `「${ability.name}」强度随时间：横轴 0–${picture.seconds} 秒，竖轴 0–${picture.top}，最强 ${Number(curve.peak.sum.toFixed(2))}（第 ${seconds(curve.peak.tick / TICKS)}）`, url: dataUrl(picture.png) },
      ]
    })
    sheets.push({ label: SHAKE_SHEET, columns: 2, cell: TILE, cells })
    notes.push(...shaken.flatMap((ability) => abilityShakes(ability).map((shake) => `招式「${ability.name}」：${bossWords.shake(shake.event)}。`)), `同时在跑的晃屏加起来最多 ${cap}${cap < SHAKE_LIMITS.cap ? `（这个模组的晃屏都是原来的写法，上限还是 ${cap}）` : ""}。`)
  }
  // Boss 能力 12、13: its arena from above, its leaves and hits over the arena with their time, and how it is seen in its fog (arena-look.ts).
  const arenaLook = arenaLookSheets({ document, compiled, first: first + scenes.length, tile: TILE, dataUrl })
  scenes.push(...arenaLook.scenes)
  sheets.push(...(arenaLook.sheets as LookSheet[]))
  notes.push(...arenaLook.notes)
  const bossFindings = bossLookIssues(document, design, (id) =>
    effects?.texture ? effects.texture(id)?.document ?? null : { width: design.texture_size, height: design.texture_size },
  )
  notes.push(...bossFindings.map((issue) => `${issue.text}${issue.fix}`))
  // Boss 能力 15: its wake-up's and its death's steps, after its stages and shakes (their scenes after these).
  const shown = bossShowSheets(document, design, first + scenes.length, compiled, effects)
  const ritual = boss?.summon
  const summon = ritual ? `${bossWords.summon(ritual)}。` : null
  const firstSheet = sheets.length ? sheets : shown.sheets
  if (boss?.music) {
    const start = boss.music.starts === "fight" && boss.intro ? boss.intro.seconds : 0
    const label = `战斗音乐 · 第 ${start} 秒开始 · 脱战 ${boss.music.fade_seconds} 秒淡出`
    notes.push(label)
    if (firstSheet.length) firstSheet[0] = { ...firstSheet[0]!, label: firstSheet[0]!.label + " · " + label }
    else {
      sheets.push({ label: "战斗音乐起点", columns: 1, cell: TILE, cells: [{ kind: "view", label, scene: first + scenes.length, view: "quarter" }] })
      scenes.push(scene(design))
    }
  }
  if (summon && firstSheet.length) firstSheet[0] = { ...firstSheet[0]!, label: `${firstSheet[0]!.label} · ${summon}` }
  if (summon && !firstSheet.length) {
    sheets.push({ label: "Boss 召唤方式", columns: 1, cell: TILE, cells: [{ kind: "view", label: summon, scene: first + scenes.length + shown.scenes.length, view: "quarter" }] })
    shown.scenes.push(scene(design))
  }
  return { findingDetails: [...bossFindings, ...shown.findingDetails, ...(arenaLook.findingDetails ?? [])], scenes: [...scenes, ...shown.scenes], sheets: [...sheets, ...shown.sheets], notes: [...notes, ...(summon ? [summon] : []), ...shown.notes] }
}

/** Boss 能力 15: the name of a show's sheet: its timeline and the model at its key moments. */
export const BOSS_SHOW_SHEET = (name: string) => `Boss ${name}演出：时间轴（每行一种步骤，每个色块是一步）和关键时刻的模型（藏起、显出、掉落、发光和动作都已经按那一刻画上）`

/**
 * Boss 能力 15: per show the boss has steps in (its wake-up, its death), one sheet: the timeline strip (each step at its moment, a row per kind), then the model at the
 * show's key moments as the game shows it then — the bones its steps hide turned off, the parts dropped gone, its own glowing parts at the brightness the show says, posed by
 * the motion it plays at that moment (a clip step's, else the wake-up's own or the death motion). Scenes are appended from `first`. Nothing for a boss without steps.
 */
function bossShowSheets(document: Extract<ModuleDocument, { kind: "entity" }>, design: ModelDesign, first: number, compiled: ReturnType<typeof fitModelAtlas> | null, effects?: EffectLookup | null, selected?: {show:string;at:number}): { findingDetails: LookFinding[]; scenes: LookScene[]; sheets: LookSheet[]; notes: string[] } {
  const boss = document.behavior === "hostile" ? document.boss : null
  const plan = boss ? bossShowPlan(boss) : null
  if (!boss || !plan) return { scenes: [], sheets: [], notes: [], findingDetails: [] }
  const scenes: LookScene[] = []
  const sheets: LookSheet[] = []
  const clips = new Set(design.animations.map((clip) => clip.name))
  const glowSlot = plan.slots.findIndex((slot) => slot === "emissive")
  const names = { aliases: document.particles, title: (id: string) => effects?.particle?.(id)?.title ?? null }
  for (const show of bossShowTimeline(boss, names)) {
    if(selected && (selected.show!==show.show || !show.steps.some(s=>s.at===selected.at)))continue
    const strip = selected ? null : showTimelinePicture(show)
    const cells: LookCell[] = strip ? [{ kind: "flat", label: `${show.name}演出时间轴（${strip.scale}；${strip.legend}）`, url: dataUrl(strip.png) }] : []
    if (compiled)
      for (const moment of selected ? [selected] : show.moments.slice(0, SHEET_CELLS - 1)) {
        const hidden = bossShowHiddenAt(plan, show.show, moment.at)
        const level = glowSlot >= 0 ? bossShowGlowAt(plan, show.show, moment.at)[glowSlot]! : 0
        const texture = glowSlot >= 0 ? glowingTexture(compiled.png, compiled.glow, level) : compiled.png
        const index = first + scenes.push({ design: compiled.design, preview: { geometry: hiddenGeometry(compiled.geometry, design, hidden), textureDataUrl: dataUrl(texture), animation: compiled.animation } }) - 1
        const own = bossShowClipAt(plan, show.show, moment.at) ?? (show.show === "intro" ? (boss.intro?.clip ? { clip: boss.intro.clip, time: moment.at } : null) : { clip: "death", time: moment.at })
        const playing = own && clips.has(own.clip) ? own : null
        const said = [hidden.length ? `藏着 ${hidden.join("、")}` : "", glowSlot >= 0 ? `自身发光 ${Math.round(level * 100)}%` : "", playing ? `动作「${playing.clip}」${seconds(playing.time)}` : ""].filter(Boolean).join(" · ")
        cells.push({ kind: "view", label: `${show.name}第 ${seconds(moment.at)}${!selected && said ? ` · ${said}` : ""}`, scene: index, view: "quarter", ...(playing ? { animation: playing.clip, time: Math.min(playing.time, design.animations.find((clip) => clip.name === playing.clip)?.length ?? playing.time) } : {}) })
      }
    sheets.push({ label: BOSS_SHOW_SHEET(show.name), columns: 3, cell: TILE, cells })
  }
  const findingDetails = bossShowIssues(document, design, { texture: () => ({ width: design.texture_size, height: design.texture_size }) })
  const notes = [
    ...[bossShowSentence("intro", boss.intro?.steps, names), bossShowSentence("death", boss.death.steps, names)].filter(Boolean).map((line) => `${line.replace(/^；/, "")}。`),
    ...(plan.slots.some((slot) => slot !== "emissive") ? ["演出图里只叠上了模型自己发光的部分；发光贴图（asset）在游戏里叠在模型上，图里没有画。"] : []),
    ...findingDetails.map((issue) => `${issue.text}${issue.fix}`),
  ]
  return { scenes, sheets, notes, findingDetails }
}

/**
 * K1: everything a creature's version has to look at: its collision boxes when it states them or the one box it
 * would get does not fit, then its abilities. Asked for one ability by name, only that ability is drawn.
 * Boss 能力 8 and 10: then, asked for nothing in particular, a boss's model in each stage and its abilities' shakes.
 */
export function creatureTabLook(document:Extract<ModuleDocument,{kind:"entity"}>, model:Model, part:"move"|"phases"|"show"|"arena", key?:string, effects?: EffectLookup): LookJob {
  if (part==="move") return abilityLook({...document,abilities:document.abilities?.filter(a=>a.id===key),combos:[]},model,{},effects).job
  const design=designOf(model)
  const compiled=fitModelAtlas(design,"look")
  if (part==="arena") return arenaLookSheets({document,compiled,first:0,tile:TILE,dataUrl}) as LookJob
  if (part==="show") {
    const [show, at] = (key ?? "").split("/")
    return bossShowSheets(document,design,0,compiled,effects,{show:show ?? "",at:Number(at)})
  }
  return bossLookSheets(document,design,0,effects,Number(key ?? 0))
}
/** r29c: the name of the picture of how a creature dies and what is left where its body goes. */
export const DEATH_SHEET = "死亡：倒下的动作和身体消失时的那一团"

/**
 * r29c: `animation: "death"` on a creature (no ability of that name): its death motion at three moments, then the moment its body goes (`deathTicks`: its death motion played to
 * its end, `fabric/entity.ts`; the game's own second without one) with what the game shows there (`poofParticles`): the game's own white puff of 20, what
 * `builtin.death_poof.particle` swaps it for, or nothing when it is turned off (said so in the picture).
 */
function deathSheet(document: Extract<ModuleDocument, { kind: "entity" }>, design: ModelDesign, effects: EffectLookup | null): { sheet: LookSheet; notes: string[] } {
  const clip = design.animations.find((motion) => motion.name === "death") ?? null
  const end = (clip ? deathTicks(clip.length) : 20) / TICKS
  const core = hitboxBoxes(document.hitbox, design)[0]!
  const box = { width: (core.max[0] - core.min[0]) / 16, height: (core.max[1] - core.min[1]) / 16 }
  const swapped = document.builtin?.death_poof?.particle
  const off = swapped === "none"
  const puff = off ? null : poofParticles(box, swapped ?? null, document.particles, effects?.particle)
  const bounds = modelBounds(design)
  const room = Math.max(...[0, 1, 2].map((axis) => bounds.max[axis]! - bounds.min[axis]!))
  const framing = {
    min: [0, 1, 2].map((axis) => Math.min(bounds.min[axis]!, ...(puff?.points.map((point) => point[axis]!) ?? [])) - (axis === 1 ? 0 : room / 5)) as Vector,
    max: [0, 1, 2].map((axis) => Math.max(bounds.max[axis]!, ...(puff?.points.map((point) => point[axis]!) ?? [])) + room / 5) as Vector,
  }
  const what = off
    ? "原版白烟已关（builtin.death_poof.particle 写了 none）：身体消失时什么都不冒"
    : swapped
      ? `身体消失时冒 20 颗「${puff!.name}」（builtin.death_poof 换掉了原版白烟），散在它身体的宽度两边、身高以内`
      : "身体消失时冒 20 颗原版白烟（游戏自己的，每只生物都有），散在它身体的宽度两边、身高以内；要关掉或换掉写 builtin.death_poof.particle"
  const motionWords = clip ? `倒下的动作 death 长 ${seconds(clip.length)}，第 ${seconds(end)} 身体消失` : `模型里没有 death 动作：游戏照原版倒下，第 ${seconds(end)} 身体消失`
  const last = clip ? Math.min(clip.length, end) : 0
  const times = clip ? [...new Set([0, clip.length / 2, last].map((time) => Number(time.toFixed(2))))] : []
  const poofCell = (view: LookView): LookCell => ({
    kind: "hit",
    label: `${VIEW_LABELS[view]} · 身体消失的那一刻 ${seconds(end)}${off ? "（原版白烟已关）" : ""}`,
    scene: 0,
    view,
    animation: clip?.name ?? "",
    time: last,
    camera: lookCamera(framing, view, TILE[0] / TILE[1]),
    faces: [],
    caption: view === "quarter" ? [`${what}。`] : [],
    ...(puff ? { particles: [puff] } : {}),
  })
  return {
    sheet: { label: DEATH_SHEET, columns: 3, cell: TILE, cells: [...times.map((time): LookCell => ({ kind: "view", label: `${VIEW_LABELS.quarter} · 倒下 ${seconds(time)}`, scene: 0, view: "quarter", animation: clip!.name, time })), poofCell("quarter"), poofCell("top")] },
    notes: [`死亡：${motionWords}；${what}。`],
  }
}

function creatureLook(document: Extract<ModuleDocument, { kind: "entity" }>, wears: Model | null, options: LookOptions = {}, effects: EffectLookup | null = null, most: number = MAKING_LIMITS.sheets): Looked {
  // r29c: `animation: "death"` when no ability or combo is called that: how it dies and what is left where its body goes.
  const named = [...(document.abilities ?? []).flatMap((ability) => [ability.id, ability.clip]), ...(document.combos ?? []).map((combo) => combo.id)]
  if (options.animation === "death" && !named.includes("death")) {
    if (!wears) throw new MakingRefusal("这只生物还没有模型，倒下的样子没有东西可以画。先让它依赖做好的模型。")
    const design = designOf(wears)
    const death = deathSheet(document, design, effects)
    return { job: { scenes: [scene(design)], sheets: [death.sheet] }, notes: death.notes, cover: coverOf(death.sheet.cells.at(-2)!), ...MOTIONLESS }
  }
  if (!wears || options.times?.length) return creatureBaseLook(document,wears,options,effects,most)
  const design=designOf(wears)
  const particles=creatureParticleSheets(document,design,effects?.particle,most,options.animation)
  if (!particles.sheets.length) return creatureBaseLook(document,wears,options,effects,most)
  const samples=particles.sheets.flatMap(s=>s.cells)
  // Keep the existing combat and combo sheets when these are ordinary game particles.
  // Their measured views can share the move's sheet, including when a combo uses the last sheet.
  if (!document.emitters?.length && !document.boss?.intro?.steps?.some(s=>s.type==="particle") && !document.boss?.death.steps?.some(s=>s.type==="particle") && !document.boss?.phases.some(p=>p.finish?.some(s=>s.type==="particle")) && samples.every(c=>c.kind==="hit" && c.particles?.every(g=>!g.frame))) {
    const base=creatureBaseLook(document,wears,options,effects,most)
    const remaining=new Set(samples)
    const sheets=base.job.sheets.map(sheet=>{
      const move=document.abilities?.find(a=>sheet.label.startsWith("招式「"+a.name+"」"))
      const add=move ? [...remaining].filter(c=>c.label.startsWith(move.name+" · ")) : []
      add.forEach(c=>remaining.delete(c))
      return add.length ? {...sheet,cells:[...sheet.cells,...add]} : sheet
    })
    if(remaining.size) {
      const page=sheets.find(s=>s.label.startsWith("招式「"))
      if(page) {
        const at=sheets.indexOf(page)
        sheets[at]={...page,cells:[...page.cells,...remaining]}
        remaining.clear()
      }
    }
    if(!remaining.size)return {...base,job:{...base.job,sheets},notes:[...base.notes,...particles.notes]}
  }
  // r29: the hitbox and the abilities' reach come before the particles (they were drawn first and took every sheet but the last): the creature's own pictures get all
  // but one sheet, the particles what is left after them, and at least that one.
  const rest=Math.max(1,most-1)
  const base=(document.abilities?.length || hitboxLooked(document,design) || bossLookSheets(document,design,0,effects)?.sheets.length) && most>1
    ? creatureBaseLook(document,wears,options,effects,rest)
    : {job:{scenes:[scene(design)],sheets:[]},notes:[],cover:coverOf({kind:"view",label:VIEW_LABELS.quarter,scene:0,view:"quarter"}),...MOTIONLESS}
  const own=base.job.sheets.slice(0,rest)
  const shown=particles.sheets.slice(0,Math.max(0,most-own.length))
  return {...base,job:{scenes:base.job.scenes,sheets:[...own,...shown]},notes:[...particles.notes,...base.notes,...[...base.job.sheets.slice(rest),...particles.sheets.slice(shown.length)].map(s=>"图里没有画："+s.label)]}
}

function creatureBaseLook(document: Extract<ModuleDocument, { kind: "entity" }>, wears: Model | null, options: LookOptions = {}, effects: EffectLookup | null = null, most: number = MAKING_LIMITS.sheets): Looked {
  const boxesOnly = wears && options.animation === undefined && hitboxLooked(document, designOf(wears)) ? hitboxLook(document, designOf(wears)) : null
  const bossy = wears && options.animation === undefined && options.times === undefined ? bossLookSheets(document, designOf(wears), 0, effects) : null
  const plan = wears && document.steady && options.animation === undefined && options.times === undefined ? resolveSteady(document.steady, document.hitbox?.core.height ?? modelBounds(designOf(wears)).height) : null
  const picture = plan ? steadyPicture(plan, document.tactics?.between?.stand_distance) : null
  const steadySheet: LookSheet[] = picture ? [{ label: "稳重俯视图", columns: 1, cell: TILE, cells: [{ kind: "flat", label: picture.label, url: dataUrl(picture.png) }] }] : []
  const boxed = picture ? { sheets: [...steadySheet, ...(boxesOnly?.sheets ?? [])], findingDetails: boxesOnly?.findingDetails ?? [], notes: [picture.label, ...(boxesOnly?.notes ?? [])] } : boxesOnly
  const extra = bossy?.sheets.length ?? 0
  if (!boxed) {
    if (document.hitbox && !wears) throw new MakingRefusal("这只生物还没有模型，碰撞箱没有东西可以对着量。先让它依赖做好的模型。")
    if (!bossy || !extra) return abilityLook(document, wears, options, effects, most)
  }
  // The abilities always get a sheet, and the boss one when it has any: the boxes take what is left (several boxes once took every sheet, and the abilities, given none,
  // were said to play motions the model lacked: the UI run of 2026-11-15). What does not fit is said, as everywhere else.
  const bossRoom = Math.min(extra, 1)
  const abilityRoom = document.abilities?.length ? Math.max(1, most - (boxed?.sheets.length ?? 0) - bossRoom) : 0
  const boxes = boxed ? boxed.sheets.slice(0, Math.max(0, most - abilityRoom - bossRoom)) : []
  const fought = document.abilities?.length ? abilityLook(document, wears, options, effects, abilityRoom) : null
  // The boss's pictures come after the boxes and the abilities, their scenes after the abilities' (so every scene index of theirs moves on by that many).
  const scenes = fought?.job.scenes ?? [scene(designOf(wears!))]
  const own = bossy && extra ? bossLookSheets(document, designOf(wears!), scenes.length, effects) : null
  const room = Math.max(1, most - boxes.length - (fought?.job.sheets.length ?? 0))
  const unboxed = boxed ? boxed.sheets.slice(boxes.length) : []
  return {
    // The creature alone is the abilities' first scene too, so the boxes and the shakes are drawn on it.
    findingDetails: [...(boxed?.findingDetails ?? []), ...(fought?.findingDetails ?? []), ...(own?.findingDetails ?? [])],
    job: { scenes: [...scenes, ...(own?.scenes ?? [])], sheets: [...boxes, ...(fought?.job.sheets ?? []), ...(own?.sheets.slice(0, room) ?? [])] },
    notes: [...(boxed?.notes ?? []), ...(fought?.notes ?? []), ...(own?.notes ?? []), ...((left) => (left.length ? [`一次最多 ${most} 张图，这次没有画：${left.map((value) => value.label).join("、")}。`] : []))([...unboxed, ...(own ? own.sheets.slice(room) : [])])],
    cover: fought?.cover ?? coverOf({ kind: "view", label: VIEW_LABELS.quarter, scene: 0, view: "quarter" }),
    ...MOTIONLESS,
  }
}

/** Round 10: a model's counts against its tier, with the smallest texture its faces fit on: what a texture's size is for. */
function budgetOf(document: Model): BudgetNote {
  const needed = (() => {
    try {
      return fitModelAtlas({ ...designOf(document), texture_size: TEXTURE_SIZES[0] }, "look").design.texture_size
    } catch {
      return null
    }
  })()
  return { ...budgetNote(document), ...(needed ? { texture_needed: needed } : {}) }
}
/** What every look of a model says of its budget: the tier and how much of it is used, and what its motions come to once exported. */
const budgetFacts = (document: Model, budget: BudgetNote, sheet: Still) => [budgetLine(budget, sheet), ...((line) => (line ? [line] : []))(bakedLine(bakedCounts(document.animations))), ...paintFacts(document), structureWords(document)]
/** 第 1 步: how flat the model's own texture is (`paintFlatness`), said with every look so the maker and the reviewer see it; nothing when its faces do not fit its texture. */
const paintFacts = (document: Model) => {
  try {
    const design = designOf(document)
    return [paintFlatnessLine(design, paintFlatness(design))]
  } catch {
    return []
  }
}

/** Round 10: a look at abilities with the sentences that have to be answered picked out of what it says. */
const answered = (made: Looked): Looked => ({ ...made, measured: made.notes.filter(abilityFault) })

// ---- H3: an effect alone ----

type Effect = Extract<ModuleDocument, { kind: "effect" }>

/** An effect as a model that can be drawn, with the motion its life shows and every motion it has. */
function effectStage(document: Effect) {
  const life = effectClip(document)
  if (!life) throw new MakingRefusal(`这个效果要播的动作「${document.play.clip}」它自己没有。它有：${names(document.animations.map((value) => value.name))}。`)
  // Everything it reaches over its life and in the pose it is built in: an effect grows and moves past its built pose as a matter of course.
  const room: Room = effectRoom(document)
  return { design: effectModel(document), life, own: document.animations as MotionClip[], room }
}

/** What every look at an effect says: what was measured on its life, how much its motion moves, and what the pictures do not show of how the game draws it. */
function effectFacts(document: Effect, stage: ReturnType<typeof effectStage>, sheet: Still) {
  const motion = [noted(measured(stage.design, stage.life, vantage(stage.design, stage.life)[0], stage.room))]
  const play = document.play
  return {
    motion,
    facts: [
      ...effectLines(document),
      ...motion.map((note) => motionLine(note, stillReason(sheet, note.name))),
      ...(play.bright || play.opacity < 1 ? [`这些图按实心、按普通光照画。游戏里它${[...(play.opacity < 1 ? [`整个是半透明的（不透明度 ${play.opacity}）`] : []), ...(play.bright ? ["不受周围明暗影响、一直最亮"] : [])].join("，")}；它被招式用到以后，看那只生物的招式时会按半透明画。`] : []),
    ],
  }
}

/**
 * An effect by itself: every side of the model as it is built, and its life frame by frame with the two
 * moments that differ most laid over each other. Asked for by name, another of its motions, a part close
 * up, the bare shape or the part names come as with a model.
 */
function effectLook(document: Effect, options: LookOptions, sheet: Still): Looked {
  const stage = effectStage(document)
  const motion = options.animation === undefined ? stage.life : (stage.own.find((value) => value.name === options.animation) ?? null)
  if (!motion) throw new MakingRefusal(`这个效果里没有叫「${options.animation}」的动作。它有：${names(stage.own.map((value) => value.name))}。`)
  if (options.close_up !== undefined && !stage.design.bones.some((bone) => bone.name === options.close_up))
    throw new MakingRefusal(`这个效果里没有叫「${options.close_up}」的部件。它有：${names(stage.design.bones.map((bone) => bone.name))}。`)
  const extras: LookSheet[] = [
    strip(0, stage.design, motion, vantage(stage.design, motion)[0], options.times, motion === stage.life ? stage.room : null),
    ...(options.close_up ? [closeUp(0, options.close_up)] : []),
    ...(options.shape_only ? [around(SHAPE_ONLY, 1)] : []),
    ...(options.names
      ? [{ label: "部件名字", columns: 2, cell: [MAKING_LIMITS.sheet[0] / 2, MAKING_LIMITS.sheet[0] / 2] as [number, number], cells: (["quarter", "quarter_back"] as const).map((view) => ({ kind: "view" as const, label: VIEW_LABELS[view], scene: 0, view, names: true })) }]
      : []),
  ]
  const kept = extras.slice(0, MAKING_LIMITS.sheets - 1)
  const told = effectFacts(document, stage, sheet)
  const unplayed = effectUnplayedLine(document)
  // What the build would refuse of it, in the build's words (the save asks the very same function and holds the version back with them): the pictures below are then its plain face colours, not the texture it would wear.
  const unbuilt = effectBuildFault(document)
  return {
    job: { scenes: [scene(stage.design), bare(stage.design)], sheets: [around("六个角度（它做好的样子）", 0), ...kept] },
    notes: [...(unbuilt ? [`照这一版造不出这个效果：${unbuilt}图里画的是只有面的颜色、没有贴图的样子。`] : []), ...(extras.length > kept.length ? [`一次最多 ${MAKING_LIMITS.sheets} 张图，这次没有画：${extras.slice(kept.length).map((value) => value.label).join("、")}。需要的话再看一次。`] : []), ...told.facts],
    // The cover is a frame of the same material as the strips: its fullest moment, in the room everything it reaches fits (`effectShot`; the card draws the same shot).
    cover: coverOf({ kind: "view", label: VIEW_LABELS.quarter, scene: 0, view: "quarter", animation: stage.life.name, time: effectShot(document).time, camera: effectShot(document).camera }),
    ...told,
    // Round 17: motions nothing plays are answered by taking them out; the version is kept all the same.
    ...(unplayed ? { measured: [unplayed] } : {}),
  }
}

// ---- Boss 能力 12: an arena fixture ----

type Fixture = Extract<ModuleDocument, { kind: "fixture" }>

/**
 * A fixture by itself: every side of its model as built, its lit motion and its dark one frame by frame (each from the side that hides least), and what was measured on it. A part
 * close up, the bare shape or the part names come as with a model; another of its motions by name.
 */
function fixtureLook(document: Fixture, options: LookOptions): Looked {
  const design = fixtureModel(document)
  const own = document.animations as MotionClip[]
  const asked = options.animation === undefined ? null : (own.find((value) => value.name === options.animation) ?? null)
  if (options.animation !== undefined && !asked) throw new MakingRefusal(`这个场地物件里没有叫「${options.animation}」的动作。它有：${names(own.map((value) => value.name))}。`)
  if (options.close_up !== undefined && !design.bones.some((bone) => bone.name === options.close_up)) throw new MakingRefusal(`这个场地物件里没有叫「${options.close_up}」的部件。它有：${names(design.bones.map((bone) => bone.name))}。`)
  const motions = asked ? [asked] : [document.play.lit, document.play.unlit, ...(document.play.ember ? [document.play.ember] : [])].filter((name, index, all) => all.indexOf(name) === index).flatMap((name) => own.filter((value) => value.name === name))
  const extras: LookSheet[] = [
    ...motions.map((motion) => ({ ...strip(0, design, motion, vantage(design, motion)[0], options.times), label: `${motion.name === document.play.lit ? "点亮以后" : motion.name === document.play.unlit ? "没点亮时" : motion.name === document.play.ember ? "余烬时" : "动作"}「${motion.name}」` })),
    ...(options.close_up ? [closeUp(0, options.close_up)] : []),
    ...(options.shape_only ? [around(SHAPE_ONLY, 1)] : []),
  ]
  const kept = extras.slice(0, MAKING_LIMITS.sheets - 1)
  return {
    job: { scenes: [scene(design), bare(design)], sheets: [around("六个角度（它做好的样子）", 0), ...kept] },
    notes: [...(extras.length > kept.length ? [`一次最多 ${MAKING_LIMITS.sheets} 张图，这次没有画：${extras.slice(kept.length).map((value) => value.label).join("、")}。需要的话再看一次。`] : []), ...fixtureLines(document)],
    cover: coverOf({ kind: "view", label: VIEW_LABELS.quarter, scene: 0, view: "quarter" }),
    ...MOTIONLESS,
  }
}

// ---- Boss 能力 6: a boss bar ----

type Bar = Extract<ModuleDocument, { kind: "bossbar" }>

/** The name of the sheet every look and review of a bar is. */
export const BOSS_BAR_SHEET = "血条：满血、刚过第一条线正在碎锁、残血"

/**
 * A boss bar at the three moments (`bossBarMoments`), drawn by the function the game's HUD is written from (`drawBossBar`), enlarged with every pixel crisp; then the same full bar at
 * the size the game shows it at interface scale 2, the lock's frames side by side and the background alone. Its stages' lines are spread evenly: the moments are the same for any lines,
 * only the share of life said under them differs (a boss that uses the bar is shown its own lines in its own findings).
 */
function bossBarLook(document: Bar): Looked {
  const layout = (() => {
    try {
      return bossBarLayout(document)
    } catch {
      throw new MakingRefusal('血条里有读不出来的图，画不出来。background、fill、lock.frames、icons[].image 都要是完整的 PNG（data URL），或者写 "bronze" 和 null 让 Studio 画。')
    }
  })()
  const lines = evenLines(layout.segments.length)
  const url = (picture: BarPicture) => dataUrl(encodePng(picture.pixels, picture.width, picture.height))
  // Boss 能力 12: a bar with a row of dots shows them lit one by one (four fixtures for the picture; a boss lights as many as its arena puts down).
  const lighted = (index: number) => (layout.dots && index > 0 ? { count: 4, lit: index === 1 ? 0b0011 : 0b0111 } : null)
  const moments = bossBarMoments(layout, lines).map((moment, index): LookCell => ((dots) => ({ kind: "tiles", label: dots ? `${moment.label} · 场地物件亮过 ${dots.lit === 0b0011 ? 2 : 3}/4（示意）` : moment.label, textures: [url(drawBossBar(layout, lines, dots ? { ...moment.state, dots } : moment.state))], layout: [[0]] }))(lighted(index)))
  const frames = layout.lock.frames.map(url)
  const cells: LookCell[] = [
    ...moments,
    { kind: "tiles", label: "满血 · 游戏里的实际大小（界面缩放 2）", textures: [url(drawBossBar(layout, lines, { phase: 0, health: 1, lit: 0, broke: -1 }))], layout: [[0]], pixel: 2 },
    { kind: "tiles", label: `锁碎开的 ${frames.length} 帧（第 1 帧是完整的锁，每帧 ${layout.lock.ticks} tick）`, textures: frames, layout: [frames.map((_, index) => index)], lines: true },
    { kind: "tiles", label: `底图原样（${layout.background.width}×${layout.background.height}）`, textures: [url(layout.background)], layout: [[0]] },
  ]
  const named = (ids: readonly string[]) => ids.join("、")
  const notes = [
    `血条 ${layout.background.width}×${layout.background.height}${document.background === "bronze" ? "（自带的青铜牌）" : ""}，${layout.segments.length} 个阶段：${layout.names.map((name, stage) => `${stage + 1}.「${name.zh}」（${name.en}）`).join(" ")}；段从${layout.drain === "left" ? "右往左" : "左往右"}掉。`,
    layout.icons.length ? `${layout.icons.length} 个图标，那一招在出的时候点亮，别的时候按 ${layout.dim} 倍的亮度画：${layout.icons.map((icon, index) => `第 ${index + 1} 个（${named(icon.abilities)}）`).join("，")}。` : "没有图标。",
    `三张图的阶段线按平均分算（${lines.slice(1).map((line) => `${Math.round(line * 100)}%`).join("、") || "没有线"}）；用在 Boss 上时按它自己的 below，满血、碎锁和残血的样子不变，只是掉到哪里的百分比不同。`,
    "这些图和游戏里画血条的代码按同一份布局、同样的规则画（字是游戏里的字体，图里写在下面）。",
  ]
  return { job: { scenes: [], sheets: [{ label: BOSS_BAR_SHEET, columns: 3, cell: TILE, cells }] }, notes, cover: coverOf(moments[1]!), ...MOTIONLESS }
}

/** One side, large, with the bare shape beside it: what a reviewer asks for with `need`, and a maker with a look's `angle`. Scene 0 is the thing, scene 1 its bare shape. Refuses a side that has no such name. */
/** The view an asked side names, or a refusal in plain words. */
function askedView(name: string): LookView {
  const view = ASKED_VIEWS[name] ?? null
  if (!view) throw new MakingRefusal(`没有叫「${name}」的角度。可以要：front、back、left、right、top、quarter、quarter_back（left 和 right 是它自己的左侧和右侧）。`)
  return view
}

function sideSheet(name: string): LookSheet {
  const view = askedView(name)
  const big: [number, number] = [MAKING_LIMITS.sheet[0] / 2, MAKING_LIMITS.sheet[0] / 2]
  return { label: `${VIEW_LABELS[view]}（大图）`, columns: 2, cell: big, cells: [{ kind: "view", label: VIEW_LABELS[view], scene: 0, view }, { kind: "view", label: `${VIEW_LABELS[view]} · ${SHAPE_ONLY}`, scene: 1, view }] }
}

/**
 * The pictures one look is made of. `wears` is the model a texture dresses or an animation moves, when
 * the project knows one. Throws a refusal in plain words when what was asked for does not exist in the
 * document (a part or a motion by a name it does not have).
 */
// ---- Boss 能力 11: a particle alone ----

/** The side of a picture of a particle at one moment of its life, in screen pixels, and how much of it the largest the particle ever gets fills. */
const PARTICLE_PICTURE = 192
const PARTICLE_FILL = 0.8

/**
 * One moment of a particle's life as a picture: its picture at that moment (`particleAt`, the generated class's own arithmetic) tinted, made see-through and turned
 * as it is then, on dark for one that glows and on the sky's grey-blue for one that does not, at a scale where the largest it ever gets fills most of the picture
 * (so how it grows or shrinks is seen; the real size is in the label).
 */
function particleMoment(document: ParticleDocument, frames: { width: number; pixels: Uint8Array }[], age: number) {
  const now = particleAt(document, age)
  const frame = frames[Math.min(frames.length - 1, now.frame)]!
  const largest = Math.max(document.size.start, document.size.end,...(document.size.mid??[]).map(p=>p.value))
  const stretch=document.face==="motion" ? document.stretch??1 : 1
  const side = (now.size / largest) * PARTICLE_PICTURE * PARTICLE_FILL / stretch
  const back = document.emissive ? [24, 24, 30] : [143, 183, 232]
  const pixels = new Uint8Array(PARTICLE_PICTURE * PARTICLE_PICTURE * 4)
  const turn = ((document.face==="motion"?-25:now.turn) * Math.PI) / 180
  for (let y = 0; y < PARTICLE_PICTURE; y++)
    for (let x = 0; x < PARTICLE_PICTURE; x++) {
      const at = (y * PARTICLE_PICTURE + x) * 4
      pixels.set([...back, 255], at)
      // Back from the picture's square to the particle's own picture: undo the turn, then the scale.
      const dx = x + 0.5 - PARTICLE_PICTURE / 2
      const dy = y + 0.5 - PARTICLE_PICTURE / 2
      const u = (dx * Math.cos(turn) + dy * Math.sin(turn)) / (side*stretch) + 0.5
      const v = (-dx * Math.sin(turn) + dy * Math.cos(turn)) / side + 0.5
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
      const source = (Math.floor(v * frame.width) * frame.width + Math.floor(u * frame.width)) * 4
      const alpha = (frame.pixels[source + 3]! / 255) * now.opacity
      for (let channel = 0; channel < 3; channel++) pixels[at + channel] = Math.round(back[channel]! + ((frame.pixels[source + channel]! * now.color[channel]!) - back[channel]!) * alpha)
    }
  return dataUrl(encodePng(pixels, PARTICLE_PICTURE, PARTICLE_PICTURE))
}

/** A particle by itself: every picture enlarged pixel for pixel, then six moments of its life drawn by the numbers of its document, and every parameter said. */
function particleLook(document: ParticleDocument, emission?:LookOptions["particle_emit"], examples:SceneExample[]=typicalParticles): Looked {
  const frames = document.frames.map(frame=>appearancePixels(frame,document.edge))
  const ticks = particleTicks(document)
  const ages = [...new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((part) => Math.min(ticks - 1, Math.round(part * ticks))))]
  const pictures: LookCell[] = document.frames.map((url, index) => ({ kind: "tiles", label: `第 ${index + 1} 张图（${frames[index]!.width}×${frames[index]!.width}，放大）`, textures: [typeof url === "string" && !document.edge ? url : dataUrl(encodePng(frames[index]!.pixels, frames[index]!.width, frames[index]!.height))], layout: [[0]], lines: true }))
  const scene=particleScene(document,emission)
  const cells:LookCell[]=[false,true].flatMap(night=>[0,.33,.66,1].map(t=>{const age=Math.round(t*(ticks-1));const frame=scene(age,night);return {kind:"flat" as const,label:`${night?"夜晚":"白天"} · 第 ${age} 刻`,url:dataUrl(encodePng(frame.pixels,frame.width,frame.height))}}))
  for(const example of [...examples,layeredParticles]) {
    const draw=particleScene(document,example.emission,example)
    const lights = [false,true,...(example.dark?["dark" as const]:[]),...(example.fog?["fog" as const]:[])]
    for (const light of lights) {
      const frame=draw(Math.round((ticks-1)*0.55),light)
      cells.push({kind:"flat",label:example.label+" · "+(light==="fog"?"起雾":light==="dark"?"压暗":light?"夜晚":"白天"),url:dataUrl(encodePng(frame.pixels,frame.width,frame.height))})
    }
  }
  const life: LookCell[] = ages.map((age) => {
    const now = particleAt(document, age)
    return { kind: "flat", label: `第 ${age} 刻（${seconds(age / TICKS)}）· ${Number(now.size.toFixed(2))} 格见方 · 不透明 ${Number(now.opacity.toFixed(2))}${document.frames.length > 1 && document.frames_by === "age" ? ` · 第 ${now.frame + 1} 张图` : ""}`, url: particleMoment(document, frames, age) }
  })
  return {
    job: {
      scenes: [],
      sheets: [
        { label: `粒子「${document.name}」的 ${document.frames.length} 张图`, columns: Math.min(4, document.frames.length), cell: NARROW, cells: pictures },
        { label: `粒子「${document.name}」一生中的 ${life.length} 个时刻（按文档的数算出来的大小、颜色、透明度和转角；最大时占满八成画面，${document.emissive ? "黑底：它自己发光" : "天蓝底：它不发光"}）`, columns: 3, cell: TILE, cells: life },
        { label:`${document.name} · 标准场景（人高 1.8 格，${emission?.count??12} 颗）`,columns:4,cell:TILE,cells },
      ],
    },
    notes: [...particleLines(document),...particleWarnings(document), ...(document.frames.length > 1 && document.frames_by === "random" ? ["每个粒子出现时随机挑一张图一直用，图里一生的几个时刻都画第 1 张。"] : [])],
    cover: coverOf(life[0]!),
    ...MOTIONLESS,
  }
}

function gazeSheet(design: ModelDesign) {
  const look = lookPlan(design)
  if (!look) return null
  const yaw = look.bones.reduce((sum, link) => sum + link.yaw, 0)
  const pitch = look.bones.reduce((sum, link) => sum + link.pitch, 0)
  const poses: Gaze[] = [[90, 60], [0, 0], [-90, -60]]
  const measured: string[] = []
  const head = look.bones.at(-1)!.index
  const localForward = apply(transposed(placeOf(rigOf(design, null), head).r), [0, 0, -1])
  const scenes = poses.map(gaze => {
    const rig = rigOf(design, null)
    lookSolve(rig, look, gaze, 1)
    const [x, y, z] = apply(placeOf(rig, head).r, localForward)
    const degrees = (rad: number) => Math.round(rad * 180 / Math.PI)
    measured.push(`${degrees(Math.atan2(-x, -z))}° / ${degrees(Math.atan2(y, Math.hypot(x, z)))}°`)
    return scene({ ...design, bones: design.bones.map((bone, i) => {
      const turn = trackTurn(design, rig, i)
      return { ...bone, rotation: bone.rotation.map((v, axis) => v + turn[axis]!) as [number, number, number] }
    }) })
  })
  const sheet: LookSheet = { label: "看向三张", columns: 3, cell: TILE, cells: ["左上", "正前", "右下"].map((label, i) => ({
    kind: "view", view: "front", scene: 2 + i, label,
  })) }
  return { sheet, scenes, note: `看向：各节左右限角合计 ${yaw}°，上下 ${pitch}°。三张图量得的左右 / 上下转角依次为 ${measured.join("、")}。` }
}

export function lookJob(document: ModuleDocument, wears: Model | null, options: LookOptions = {}, sheet: Still = null, world: LookWorld = null, speed: number | null = null, effects: EffectLookup | null = null, key: AbilityMoments = {}, itemOnly = false): Looked {
  if (document.kind === "block" || document.kind === "item") return flatLook(document, world, sheet)
  if (document.kind === "effect") return effectLook(document, options, sheet)
  if (document.kind === "particle") return particleLook(document,options.particle_emit,effects?.examples?.(document))
  if (document.kind === "bossbar") return bossBarLook(document)
  if (document.kind === "fixture") return fixtureLook(document, options)
  if (document.kind === "model") {
    const design = designOf(document)
    // 第 2 步: `animations` asks for more motions in the same look, a sheet each after `animation`'s.
    const asked = itemOnly ? [] : [...new Set([...(options.animation === undefined ? [] : [options.animation]), ...(options.animations ?? [])])]
    const missing = asked.find((name) => !design.animations.some((value) => value.name === name))
    if (missing !== undefined) throw new MakingRefusal(`这个模型里没有叫「${missing}」的动作。它有：${names(design.animations.map((value) => value.name))}。`)
    if (options.close_up !== undefined && !design.bones.some((bone) => bone.name === options.close_up))
      throw new MakingRefusal(`这个模型里没有叫「${options.close_up}」的部件。它有：${names(design.bones.map((bone) => bone.name))}。`)
    // r29c: `angle` with a motion shoots the motion from that side too (it used to keep to the side the motion is read best from, and the large side sheet was the one left out).
    const facing = options.angle === undefined ? null : askedView(options.angle)
    const plans = asked.map((name) => design.animations.find((value) => value.name === name)!).map((motion) => planOf(design, swayed(design, motion), [facing ?? vantage(design, motion)[0]], MAKING_LIMITS.frames, options.times, null, () => key[motion.name] ?? []))
    const gaze = itemOnly ? null : gazeSheet(design)
    const extras: LookSheet[] = [
      ...(gaze ? [gaze.sheet] : []),
      ...plans.slice(0, 1).map((plan) => stripOf(0, design, plan)),
      ...(options.angle === undefined ? [] : [sideSheet(options.angle)]),
      ...(options.close_up ? [closeUp(0, options.close_up)] : []),
      ...(options.shape_only ? [around(SHAPE_ONLY, 1)] : []),
      ...(options.names
        ? [{ label: "部件名字", columns: 2, cell: [MAKING_LIMITS.sheet[0] / 2, MAKING_LIMITS.sheet[0] / 2] as [number, number], cells: (["quarter", "quarter_back"] as const).map((view) => ({ kind: "view" as const, label: VIEW_LABELS[view], scene: 0, view, names: true })) }]
        : []),
      ...plans.slice(1).map((plan) => stripOf(0, design, plan)),
    ]
    // 第 2 步: an epic model's look hands back more pictures (`makingLimits`).
    const most = makingLimits(design.budget).sheets
    const kept = extras.slice(0, most - 1)
    // A tier above the default is asked for in the sheet, with a reason the person reads. Where there is no sheet (a plain preview) nothing is asked.
    const undeclared = sheet ? budgetDeclared(document, sheet) : null
    if (undeclared) throw new MakingRefusal(undeclared)
    // Every look of a model says how much each of its motions moves, whether or not a motion was asked to be drawn.
    const { epic, ...moved } = itemOnly ? UNMEASURED : motionFacts(design, design.animations, sheet, speed, new Map(plans.map((plan) => [plan.motion.name, plan])), Object.keys(key))
    const budget = budgetOf(document)
    return {
      job: { scenes: [scene(design), bare(design), ...(gaze?.scenes ?? [])], sheets: [around("六个角度", 0), ...kept] },
      notes: [...(extras.length > kept.length ? [`一次最多 ${most} 张图，这次没有画：${extras.slice(kept.length).map((value) => value.label).join("、")}。需要的话再看一次。`] : []), ...(gaze ? [gaze.note] : []), ...moved.facts],
      cover: coverOf({ kind: "view", label: VIEW_LABELS.quarter, scene: 0, view: "quarter" }),
      ...moved,
      // 第 2 步: an epic creature's attack motions held to the phrasing the guide asks for, as faults to answer.
      ...(epic.length ? { measured: epic } : {}),
      budget,
      budget_facts: budgetFacts(document, budget, sheet),
    }
  }
  if (document.kind === "texture") {
    const made = dressed(document, wears)
    if (!made.worn) return { job: { scenes: [], sheets: [{ label: "贴图", columns: 1, cell: TILE, cells: [made.flat] }] }, notes: ["这张贴图没有挂在任何模型上，只能平铺着看。"], cover: coverOf(made.flat), ...MOTIONLESS }
    return {
      job: {
        scenes: [made.worn],
        sheets: [{ label: made.fits ? "贴图：平铺，和穿在模型上" : "贴图平铺，和它要穿的模型（尺寸对不上，没有穿上）", columns: 3, cell: TILE, cells: [made.flat, ...around("", 0, ["quarter", "front", "back", "plus_x", "top"]).cells] }],
      },
      notes: made.fits ? [] : [`贴图是 ${document.width}×${document.height}，模型的贴图空间是 ${made.worn.design.texture_size}×${made.worn.design.texture_size}，对不上，所以图里的模型穿的还是它自己的表面。`],
      cover: coverOf(made.fits ? { kind: "view", label: VIEW_LABELS.quarter, scene: 0, view: "quarter" } : made.flat),
      ...MOTIONLESS,
    }
  }
  if (document.kind === "animation") {
    const made = posed(document, wears)
    // Both directions are shot in one room, and the facts are those of the first.
    // r29c: `angle` shoots it from that side alone.
    const plan = planOf(made.design, made.motion, options.angle === undefined ? vantage(made.design, made.motion) : [askedView(options.angle)], MAKING_LIMITS.frames, options.times, null, () => key[made.motion.name] ?? [])
    const { epic: _epic, ...moved } = motionFacts(made.design, [made.motion], sheet, speed, new Map([[made.motion.name, plan]]))
    return {
      job: { scenes: [scene(made.design)], sheets: plan.shots.map((_, row) => stripOf(0, made.design, plan, row)) },
      notes: moved.facts,
      cover: coverOf({ kind: "view", label: motionLabel(made.motion.name), scene: 0, view: "quarter", animation: made.motion.name, time: made.motion.length / 2 }),
      ...moved,
    }
  }
  if (document.kind === "gesture") {
    const seen = gesturePlayerPreview(document, { loop: false })
    const own = gestureFirstPersonPreview(document, { loop: false })
    const times = moments(seen.length, false, options.times)
    const part = (time: number) => seen.phases.find((phase) => time >= phase.start && time <= phase.end)?.label ?? ""
    return {
      job: {
        scenes: [seen, own].map((made) => ({ design: made.design as ModelDesign, preview: { geometry: made.geometry, textureDataUrl: made.textureDataUrl, animation: made.animation } })),
        sheets: [
          { label: "别人看到的（第三人称）", columns: 3, cell: TILE, cells: times.map((time) => ({ kind: "view", label: `${part(time)} · ${seconds(time)}`, scene: 0, view: "quarter", animation: "gesture", time })) },
          { label: "自己看到的（第一人称）", columns: 3, cell: [TILE[0], Math.round((TILE[0] * 9) / 16)], cells: times.map((time) => ({ kind: "view", label: `${part(time)} · ${seconds(time)}`, scene: 1, view: "front", animation: "gesture", time, camera: own.camera })) },
        ],
      },
      notes: [],
      cover: coverOf({ kind: "view", label: part(seen.length / 2) || "施法", scene: 0, view: "quarter", animation: "gesture", time: seen.length / 2 }),
      ...MOTIONLESS,
    }
  }
  // r29: a creature's look hands back as many pictures as its tier's (`makingLimits`: the epic tier six), the tier being the one its sheet or the model it wears is held to.
  if (document.kind === "entity") return answered(creatureLook(document, wears, options, effects, makingLimits(sheet?.budget?.tier ?? (wears ? designOf(wears).budget : null)).sheets))
  throw new MakingRefusal(NOTHING_TO_SEE)
}

/**
 * Everything a reviewer is given of the final version, drawn afresh so nobody has to assemble it: for a
 * model every side, the bare shape, and every motion it has frame by frame from the two directions that
 * hide least. At most `MAKING_LIMITS.review_sheets` pictures: with more motions than fit at two pictures
 * each, a motion gets one picture of three moments from both directions; with more motions than pictures,
 * motions share pictures (`packedPlans`), each at its most telling moments, so every motion is looked at and `notes` says it was
 * thinned; only when there are more motions than cells are the rest named
 * in `notes` and can be asked for. The other kinds are already whole in one look.
 */
export function reviewJob(document: ModuleDocument, wears: Model | null, sheet: Still = null, world: LookWorld = null, speed: number | null = null, effects: EffectLookup | null = null, key: AbilityMoments = {}, itemOnly = false): Omit<Looked, "cover"> {
  // H3: an effect is whole in every side, its bare shape, and its life from the two directions that hide least.
  if (document.kind === "effect") {
    const stage = effectStage(document)
    const told = effectFacts(document, stage, sheet)
    return { job: { scenes: [scene(stage.design), bare(stage.design)], sheets: [around("六个角度（它做好的样子）", 0), around(SHAPE_ONLY, 1), ...vantage(stage.design, stage.life).map((view) => strip(0, stage.design, stage.life, view, null, stage.room))] }, notes: told.facts, ...told }
  }
  // Round 10: a creature with abilities is whole in every ability's hit moments (with its effects and alone); as many as a review holds.
  // r29c: and, when its builtin table changes what is left where its body goes, how it dies (`deathSheet`), as room allows.
  // Its scene 0 is the creature alone, which is what the death sheet is drawn on.
  if (document.kind === "entity") return answered(((made) => (wears && document.builtin?.death_poof && made.job.sheets.length < MAKING_LIMITS.review_sheets ? ((death) => ({ ...made, job: { ...made.job, sheets: [...made.job.sheets, death.sheet] }, notes: [...made.notes, ...death.notes] }))(deathSheet(document, designOf(wears), effects)) : made))(creatureLook(document, wears, {}, effects, MAKING_LIMITS.review_sheets)))
  if (document.kind !== "model") return lookJob(document, wears, {}, sheet, world, speed, effects, key)
  const design = designOf(document)
  // Two of the sheets are the six angles and the bare shape; the rest are for motions.
  const room = MAKING_LIMITS.review_sheets - 2
  const motions = itemOnly ? [] : design.animations as MotionClip[]
  const layout = motions.length * 2 <= room ? "whole" : motions.length <= room ? "pair" : "packed"
  // Whole: two sheets of frames for a motion. Pair: one sheet, both directions. Packed: several motions to a sheet, each at its most telling moments.
  const made = layout === "packed" ? packedPlans(design, motions, key, room * SHEET_CELLS) : null
  const plans = made?.plans ?? motions.map((motion) => planOf(design, motion, vantage(design, motion), layout === "whole" ? MAKING_LIMITS.frames : 3, null, null, shared(key[motion.name] ?? [])))
  const { epic: _epic, ...moved } = itemOnly ? UNMEASURED : motionFacts(design, motions, sheet, speed, new Map(plans.map((plan) => [plan.motion.name, plan])))
  const budget = budgetOf(document)
  const motionSheets = made ? made.sheets(design) : plans.flatMap((plan) => (layout === "whole" ? plan.shots.map((_, row) => stripOf(0, design, plan, row)) : [pairOf(0, design, plan)]))
  return {
    job: { scenes: [scene(design), bare(design)], sheets: [around("六个角度", 0), around(SHAPE_ONLY, 1), ...motionSheets] },
    notes: [...(made?.notes ?? []), ...moved.facts],
    ...moved,
    budget,
    budget_facts: budgetFacts(document, budget, sheet),
  }
}

/** Cells one sheet holds: the sheet (`MAKING_LIMITS.sheet`) cut into tiles of `TILE`, three across and two down. */
const SHEET_CELLS = (MAKING_LIMITS.sheet[0] / TILE[0]) * (MAKING_LIMITS.sheet[1] / TILE[1])

/** Times with any that are within a thousandth of a second of an earlier one left out. */
const distinct = (times: readonly number[]) => times.reduce<number[]>((kept, time) => (kept.some((other) => Math.abs(other - time) < 0.001) ? kept : [...kept, time]), [])

/**
 * The moments of a motion in the order they tell it, the one that tells most first: the ones an ability is read by (a
 * wind-up's end, a hit), then the two that differ most from each other, the one further from the built pose first (it is the
 * moment that shows what the motion does; the other end is often the built pose again), then the rest in the order they differ
 * (`measureMotion`). A motion that moves nothing has only its first moment.
 */
function telling(design: ModelDesign, motion: MotionClip, found: MotionMeasure, must: readonly number[]): number[] {
  const rest = posedCorners(design, null)
  const departure = (time: number) => posedCorners(design, motion, time).reduce((far, point, corner) => Math.max(far, Math.hypot(point[0] - rest[corner]![0], point[1] - rest[corner]![1], point[2] - rest[corner]![2])), 0)
  const [first, second, ...others] = found.moments
  const ends = first !== undefined && second !== undefined && departure(second) > departure(first) ? [second, first] : [first, second]
  return distinct([...must.map((time) => Math.min(Math.max(time, 0), motion.length)), ...ends.filter((time): time is number => time !== undefined), ...others, 0])
}

/**
 * More motions than the review has sheets for: motions share sheets, each shown at its most telling moments, so
 * that every motion is looked at. `capacity` cells are shared out by information, not by order: every motion has
 * one cell first (the moment `telling` puts first), then the rest go round the motions, one more cell each time
 * round, to those that have a further telling moment (a still motion has none and keeps its one), the ones an
 * ability is read by first and then the ones that move most. Each motion is shot in one room that holds every pose
 * drawn of it. Only when there are more motions than cells are the least telling ones left out, and named in the notes.
 */
function packedPlans(design: ModelDesign, motions: MotionClip[], key: AbilityMoments, capacity: number) {
  const views = motions.map((motion) => vantage(design, motion)[0])
  const found = motions.map((motion, index) => measured(design, motion, views[index]!))
  const order = motions.map((motion, index) => telling(design, motion, found[index]!, key[motion.name] ?? []))
  // The least that can be said of a motion's moments: at most as many as a strip has frames.
  const wanted = order.map((times) => Math.min(times.length, MAKING_LIMITS.frames))
  const ranked = motions.map((_, index) => index).sort((a, b) => Number((key[motions[b]!.name]?.length ?? 0) > 0) - Number((key[motions[a]!.name]?.length ?? 0) > 0) || found[b]!.travel - found[a]!.travel || a - b)
  const counts = motions.map(() => 0)
  ranked.slice(0, capacity).forEach((index) => (counts[index] = 1))
  let spare = capacity - Math.min(capacity, motions.length)
  for (let round = 2; round <= MAKING_LIMITS.frames && spare > 0; round++)
    for (const index of ranked) if (spare > 0 && counts[index]! > 0 && wanted[index]! >= round) (counts[index]!++, spare--)
  const plans = motions.flatMap((motion, index): Plan[] => {
    if (!counts[index]) return []
    const times = order[index]!.slice(0, counts[index]).sort((a, b) => a - b)
    // `cells` as many as moments: no cell is left over for the compare cell.
    const shot: Shot = { view: views[index]!, found: found[index]!, times, between: found[index]!.mover ? found[index]!.between : [0, Number((motion.length / 2).toFixed(3))], cells: times.length, must: key[motion.name] ?? [] }
    return [{ motion, shots: [shot], room: framing(design, motion, times, [views[index]!]) }]
  })
  const left = motions.filter((_, index) => !counts[index])
  const thin = motions.filter((_, index) => counts[index] === 1 && wanted[index]! > 1)
  return {
    plans,
    sheets: (model: ModelDesign): LookSheet[] => {
      const cells = plans.flatMap((plan) => rowCells(0, model, plan, plan.shots[0]!).map((cell) => ({ ...cell, label: `${motionLabel(plan.motion.name)} · ${cell.label}` })))
      const count = Math.ceil(cells.length / SHEET_CELLS)
      return Array.from({ length: count }, (_, index): LookSheet => {
        const held = cells.slice(index * SHEET_CELLS, (index + 1) * SHEET_CELLS)
        return { label: `动作合辑 ${index + 1}/${count}：${names([...new Set(held.map((cell) => (cell.kind === "view" ? cell.animation : undefined)).filter((name): name is string => name !== undefined))].map(motionLabel))}`, columns: 3, cell: TILE, cells: held }
      })
    },
    notes: [
      `动作有 ${motions.length} 个，一次放不下每个动作的整段逐帧图。这一套把动作拼在几张「动作合辑」里，每个动作只给最能看出它在做什么的几个时刻（图上每格写着动作名和时刻），没有从两个方向看。${thin.length ? `只给了一个时刻的有：${names(thin.map((motion) => motionLabel(motion.name)))}。` : ""}要看整段逐帧或换个方向，另外要。`,
      ...(left.length ? [`动作太多，连每个动作一格也放不下，这几个没有画：${names(left.map((motion) => motionLabel(motion.name)))}。评审需要可以另外要。`] : []),
    ],
  }
}

/** The same sheet with its scenes numbered anew: `to` says which number each of its scenes has in the job it moves to. */
function renumbered(sheet: LookSheet, to: (scene: number) => number): LookSheet {
  const part = (value: LookPart): LookPart => ({ ...value, scene: to(value.scene) })
  return {
    ...sheet,
    cells: sheet.cells.map((cell): LookCell => {
      if (cell.kind === "hit") return { ...cell, scene: to(cell.scene), ...(cell.extra ? { extra: cell.extra.map(part) } : {}), ...(cell.over ? { over: cell.over.map((layer) => ({ ...layer, scene: to(layer.scene), ...(layer.extra ? { extra: layer.extra.map(part) } : {}) })) } : {}) }
      if (cell.kind === "view") return { ...cell, scene: to(cell.scene), ...(cell.extra ? { extra: cell.extra.map(part) } : {}) }
      if (cell.kind === "compare" || cell.kind === "boxes") return { ...cell, scene: to(cell.scene) }
      return cell
    }),
  }
}

/**
 * What a reviewer asked to be shown because the set did not show it: one picture for each thing asked.
 * A side comes large, with the bare shape beside it; a part comes close; a motion comes from the two
 * directions the set did not use. Throws a refusal in plain words when the document has no such thing.
 *
 * A motion asked for at moments (`times`) that a creature's ability plays (the need names the motion the ability plays, or the ability's id) is not a bare motion
 * strip: an ability is judged by where its hit lands and what its effects do, and a bare strip shows neither. The picture is the ability's own look at exactly those moments
 * (`abilityLook` with `times`): the creature, the hit shape of the hit nearest to each moment and the effects standing then. A motion no ability plays, or one asked for without moments, is
 * shown as a motion as always. `effects` is how the project's effects are found; without it an ability's moments come with the hit shapes alone.
 */
export function needJob(document: ModuleDocument, wears: Model | null, needs: ReviewNeed[], effects: EffectLookup | null = null, itemOnly = false): { job: LookJob; notes: string[] } {
  if (document.kind === "gesture") {
    const times = needs.find((need) => need.what === "motion")?.times
    if (!times?.length) throw new MakingRefusal("施法动作只能按时刻再看：what 写 motion，用 times 写要看的那几个时刻（秒）。")
    return lookJob(document, wears, { times })
  }
  const stage =
    document.kind === "model"
      ? { design: designOf(document), scenes: [scene(designOf(document)), bare(designOf(document))], motions: itemOnly ? [] : designOf(document).animations as MotionClip[] }
      : document.kind === "fixture"
        ? ((design) => ({ design, scenes: [scene(design), bare(design)], motions: document.animations as MotionClip[] }))(fixtureModel(document))
      : document.kind === "effect"
        ? (({ design, own }) => ({ design, scenes: [scene(design), bare(design)], motions: own }))(effectStage(document))
        : document.kind === "animation"
        ? (({ design, motion }) => ({ design, scenes: [scene(design), bare(design)], motions: [motion] }))(posed(document, wears))
        : document.kind === "texture"
          ? (({ worn }) => (worn ? { design: worn.design, scenes: [worn, bare(worn.design)], motions: [] } : null))(dressed(document, wears))
          : // Round 10: a creature is looked at on its model: a side, a part or a motion asked for is the model's.
            document.kind === "entity" && wears
            ? { design: designOf(wears), scenes: [scene(designOf(wears)), bare(designOf(wears))], motions: designOf(wears).animations as MotionClip[] }
            : null
  if (!stage) throw new MakingRefusal(document.kind === "block" || document.kind === "item" ? "方块和物品的贴图已经把能画的都画出来了，没有别的角度可以补拍：就着已经给出的图下结论。" : "这一样东西没有立体的样子可以补拍，只能看已经给出的图。")
  const creature = document.kind === "entity" && wears ? document : null
  // The ability looks bring effect scenes of their own: they follow the scenes of the thing and its bare shape, and the cells of those looks are numbered to match.
  const scenes = [...stage.scenes]
  const notes: string[] = []
  const sheets = needs.flatMap((need): LookSheet[] => {
    if (need.what === "angle") return [sideSheet(need.name ?? "")]
    if (need.what === "close_up") {
      if (!stage.design.bones.some((bone) => bone.name === need.name)) throw new MakingRefusal(`没有叫「${need.name ?? ""}」的部件。它有：${names(stage.design.bones.map((bone) => bone.name))}。`)
      return [closeUp(0, need.name!)]
    }
    // A creature's ability may be asked for by its id as well as by the motion it plays.
    const abilities = creature ? (creature.abilities ?? []).filter((ability) => ability.clip === need.name || ability.id === need.name) : []
    const motion = stage.motions.find((value) => value.name === need.name) ?? stage.motions.find((value) => value.name === abilities[0]?.clip) ?? (stage.motions.length === 1 && !need.name ? stage.motions[0] : undefined)
    if (!motion) throw new MakingRefusal(stage.motions.length ? `没有叫「${need.name ?? ""}」的动作。它有：${names(stage.motions.map((value) => value.name))}。` : "这一样东西没有动作可以看。")
    // An ability's moments: the abilities that play this motion (all of them when asked by the motion's name, as many as a look has sheets), each drawn at the moments asked for.
    const played = need.times?.length ? abilities.filter((ability) => ability.clip === motion.name).slice(0, MAKING_LIMITS.sheets) : []
    if (creature && played.length) {
      return played.flatMap((ability) => {
        const made = abilityLook(creature, wears, { animation: ability.id, times: need.times! }, effects, 1)
        const base = scenes.length
        scenes.push(...made.job.scenes.slice(1))
        notes.push(...made.notes)
        return made.job.sheets.map((sheet) => renumbered(sheet, (index) => (index === 0 ? 0 : base + index - 1)))
      })
    }
    const others = vantage(stage.design, motion).map((view) => OTHER[view]!)
    // A motion one of the creature's abilities plays is shown at the moments that ability is read by, unless moments were asked for.
    const must = document.kind === "entity" ? (abilityMoments([document])[motion.name] ?? []) : []
    // Three moments fit from both directions; more than three are shown from the other quarter alone.
    return [(need.times?.length ?? 0) > 3 ? strip(0, stage.design, motion, others[0]!, need.times) : pair(0, stage.design, motion, others, need.times, must)]
  })
  return { job: { scenes, sheets }, notes: once(notes) }
}

/**
 * Looks drawn one after another, each with a time limit. A look that fails or runs out of time answers
 * in plain words and `giveUp` is told, so whatever was drawing can be thrown away before the next one.
 */
export function lookQueue(draw: LookRenderer, options: { timeoutMs: number; giveUp: () => void; schedule?: (ms: number, expire: () => void) => () => void }): LookRenderer {
  const state = { tail: Promise.resolve<unknown>(undefined) }
  const schedule = options.schedule ?? ((ms: number, expire: () => void) => {
    const timer = setTimeout(expire, ms)
    return () => clearTimeout(timer)
  })
  const limited = (job: LookJob, progress?: LookProgress, signal?: AbortSignal) => {
    const canceled: LookPictures = { ok: false, reason: "已经取消这次预览。" }
    if (signal?.aborted) return Promise.resolve(canceled)
    const stopped = Promise.withResolvers<LookPictures>()
    const stop = () => stopped.resolve(canceled)
    signal?.addEventListener("abort", stop, { once: true })
    const timer: { cancel?: () => void } = {}
    // Engineer H2: the limit was set for a model of the default geometry tier; one with more boxes is given as much more time as it has more boxes.
    const allowed = Math.round(options.timeoutMs * Math.max(1, ...job.scenes.map((scene) => scene.design.bones.reduce((sum, bone) => sum + bone.cubes.length, 0) / GEOMETRY_TIERS[DEFAULT_TIER].cubes)))
    return Promise.race([
      Promise.resolve().then(() => draw(job, progress, signal)),
      stopped.promise,
      new Promise<LookPictures>((resolve) => {
        timer.cancel = schedule(allowed, () => resolve({ ok: false, reason: `预览图画了 ${Math.round(allowed / 1000)} 秒还没有画完，已经放弃这一次。` }))
      }),
    ])
      .catch((): LookPictures => ({ ok: false, reason: "预览图没有画出来。" }))
      .then((result) => {
        timer.cancel?.()
        signal?.removeEventListener("abort", stop)
        if (!result.ok) options.giveUp()
        return result
      })
  }
  return (job, progress, signal) => {
    const work = state.tail.then(() => limited(job, progress, signal))
    state.tail = work
    return work
  }
}
