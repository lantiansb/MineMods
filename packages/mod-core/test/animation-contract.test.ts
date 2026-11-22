import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ANIMATION_TRACKS, BAKE_TOLERANCE, channelTracks, clipCursor, sampleBone, sampleTrack, usesContract2, type AnimationTrack } from "@minemods/studio-ai/animation"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import { checkBbmodel, exportBbmodel } from "../src/bbmodel"
import { blockbenchToDesign, designToBlockbench } from "../src/blockbench"
import { compileSavedModel } from "../src/editable-model"
import { compileModel } from "../src/model"
import { ModuleDocumentSchema } from "../src/workspace"

const parseWorkspaceDocument = (_kind: "animation", document: unknown) => ModuleDocumentSchema.parse(document)
import { CONTRACT_TIMES, contractHash, contractMachine } from "./fixtures/animation-contract/machine"

/**
 * The animation contract is one thing at every end. A fixture is sampled at fixed moments through
 * (a) the shared sampler (studio-ai/animation.ts, as the viewport, the look pictures and the motion measure
 *     use it),
 * (b) an evaluator of the EXPORTED geometry and animation files written here from how GeckoLib 4.8.3 plays
 *     them, sharing no code with (a), and
 * (c) what GeckoLib 4.8.3's own classes made of the same two files (geckolib-4.8.3.json, produced by
 *     fixtures/animation-contract/GeckoProbe.java run against the real jar; see regenerate.ts),
 * and the three must put every cube corner in the same place. (b) = (c) shows the evaluator is GeckoLib;
 * (a) = (b) shows the export means what the document means, the X mirror and the rotation signs included.
 */

type Vec = [number, number, number]
type Value = number[] | { pre: number[]; post: number[] }
type Affine = { r: number[]; t: Vec }
type GeoBone = { name: string; parent?: string; pivot: number[]; rotation: number[]; cubes: { origin: number[]; size: number[] }[] }

const machine = contractMachine()
const compiled = compileModel(machine, "contract_machine")
const geometry = compiled.geometry["minecraft:geometry"][0]!.bones as GeoBone[]
const files = compiled.animation.animations as unknown as Record<string, { loop: boolean; animation_length: number; bones: Record<string, Partial<Record<AnimationTrack, Record<string, Value>>>> }>
type Played = Record<string, Record<string, { tracks: Record<string, Partial<Record<AnimationTrack, number[]>>>; corners: Record<string, number[][][]> }>>
const played = JSON.parse(readFileSync(path.join(import.meta.dir, "fixtures/animation-contract/geckolib-4.8.3.json"), "utf8")) as { made_from: string; times: number[]; played: Played }
const golden = played.played
const clipOf = (name: string) => machine.animations.find((clip) => clip.name === name)!
const fileOf = (name: string) => files[`animation.contract_machine.${name}`]!

/* ---- (b) GeckoLib 4.8.3 as read from the jar, on the exported files only ---- */

/**
 * BakedAnimationsAdapter: keys in the order written; a {pre, post} key is two keys, `pre` 0.001 s earlier
 * (not before 0); each key becomes a keyframe that runs from the key before it to itself over the ticks
 * between them (20 a second); a rotation is turned into radians with X and Y negated.
 */
function geckoFrames(track: Record<string, Value>, rotation: boolean) {
  const turned = (value: number[]) => (rotation ? [(-value[0]! * Math.PI) / 180, (-value[1]! * Math.PI) / 180, (value[2]! * Math.PI) / 180] : value)
  const keys = Object.entries(track).flatMap(([stamp, value]) => {
    const time = Number.parseFloat(stamp)
    return Array.isArray(value) ? [{ time, value: turned(value) }] : [{ time: time === 0 ? time : time - 0.001, value: turned(value.pre) }, { time, value: turned(value.post) }]
  })
  return keys.map((key, index) => ({ length: (key.time - (keys[index - 1]?.time ?? 0)) * 20, start: (keys[index - 1] ?? key).value, end: key.value }))
}

/** AnimationController.getCurrentKeyFrameLocation + linear EasingType: the first keyframe whose end lies after the tick; past the last one its end is held. */
function geckoValue(frames: ReturnType<typeof geckoFrames>, tick: number): number[] {
  const ends = frames.map((_, index) => frames.slice(0, index + 1).reduce((sum, frame) => sum + frame.length, 0))
  const at = ends.findIndex((end) => end > tick)
  if (at === -1) return frames[frames.length - 1]!.end
  const frame = frames[at]!
  return frame.start.map((value, axis) => value + ((frame.end[axis]! - value) * (tick - (ends[at]! - frame.length))) / frame.length)
}

/** What GeckoLib hands each bone at `time`: only the tracks the file has for it. */
function geckoTracks(name: string, time: number) {
  return Object.fromEntries(
    Object.entries(fileOf(name).bones).map(([bone, tracks]) => [bone, Object.fromEntries(ANIMATION_TRACKS.flatMap((track) => (tracks[track] ? [[track, geckoValue(geckoFrames(tracks[track], track === "rotation"), time * 20)]] : [])))]),
  ) as Record<string, Partial<Record<AnimationTrack, number[]>>>
}

const identity: Affine = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }
const multiply = (a: number[], b: number[]) => Array.from({ length: 9 }, (_, index) => [0, 1, 2].reduce((sum, k) => sum + a[Math.floor(index / 3) * 3 + k]! * b[k * 3 + (index % 3)]!, 0))
const apply = (a: Affine, p: Vec): Vec => [0, 1, 2].map((row) => a.r[row * 3]! * p[0] + a.r[row * 3 + 1]! * p[1] + a.r[row * 3 + 2]! * p[2] + a.t[row]!) as Vec
const then = (a: Affine, b: Affine): Affine => ({ r: multiply(a.r, b.r), t: apply(a, b.t) })
const moved = (t: Vec): Affine => ({ r: identity.r, t })

/**
 * BakedModelFactory + RenderUtil.prepMatrixForBone, for every bone from the root down: X of pivots and
 * corners mirrored, the built angles negated on X and Y, and per bone
 * translate(-posX, posY, posZ) · translate(pivot) · Rz · Ry · Rx · scale · translate(-pivot).
 * Gives each cube's eight corners in model pixels, in the order `posedCorners` lists them.
 */
function geckoCorners(name: string, time: number): Vec[] {
  const tracks = geckoTracks(name, time)
  const matrix = (bone: GeoBone): Affine => {
    const given = tracks[bone.name] ?? {}
    const [x, y, z] = [0, 1, 2].map((axis) => ((bone.rotation[axis]! * Math.PI) / 180) * (axis === 2 ? 1 : -1) + (given.rotation?.[axis] ?? 0))
    const position = given.position ?? [0, 0, 0]
    const scale = given.scale ?? [1, 1, 1]
    const pivot: Vec = [-bone.pivot[0]!, bone.pivot[1]!, bone.pivot[2]!]
    const turn = multiply([Math.cos(z!), -Math.sin(z!), 0, Math.sin(z!), Math.cos(z!), 0, 0, 0, 1], multiply([Math.cos(y!), 0, Math.sin(y!), 0, 1, 0, -Math.sin(y!), 0, Math.cos(y!)], [1, 0, 0, 0, Math.cos(x!), -Math.sin(x!), 0, Math.sin(x!), Math.cos(x!)]))
    const own = [moved([-position[0]!, position[1]!, position[2]!]), moved(pivot), { r: turn, t: [0, 0, 0] as Vec }, { r: [scale[0]!, 0, 0, 0, scale[1]!, 0, 0, 0, scale[2]!], t: [0, 0, 0] as Vec }, moved([-pivot[0], -pivot[1], -pivot[2]])].reduce(then)
    const parent = geometry.find((value) => value.name === bone.parent)
    return parent ? then(matrix(parent), own) : own
  }
  return geometry.flatMap((bone) =>
    bone.cubes.flatMap((cube) => Array.from({ length: 8 }, (_, corner) => apply(matrix(bone), [-(cube.origin[0]! + (corner & 1 ? cube.size[0]! : 0)), cube.origin[1]! + (corner & 2 ? cube.size[1]! : 0), cube.origin[2]! + (corner & 4 ? cube.size[2]! : 0)]))),
  )
}

const apart = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]!))
/** Moments of a clip the probe's plain ticks mean the same as the clip's own clock: a loop starts over at its length. */
const timesOf = (name: string) => CONTRACT_TIMES.filter((time) => (clipOf(name).loop ? time < clipOf(name).length : time <= clipOf(name).length))
const cubeOwners = geometry.flatMap((bone) => bone.cubes.map((_, index) => ({ bone: bone.name, index })))

describe("animation contract conformance", () => {
  test("the fixture uses every part of the contract", () => {
    const keys = machine.animations.flatMap((clip) => clip.channels.flatMap((channel) => ANIMATION_TRACKS.flatMap((track) => channelTracks(channel)[track].map((key) => ({ track, mode: key.interpolation ?? "linear" })))))
    expect(new Set(keys.map((key) => `${key.track}/${key.mode}`))).toEqual(new Set(["rotation/linear", "rotation/smooth", "position/linear", "position/smooth", "position/step", "scale/linear", "scale/smooth", "scale/step"]))
    expect(usesContract2(clipOf("work"))).toBe(true)
    expect(usesContract2(clipOf("work_plain"))).toBe(false)
    // A bone turned as built with a moving bone under it, and a channel that only moves.
    expect(machine.bones.find((bone) => bone.name === "arm")!.rotation).not.toEqual([0, 0, 0])
    expect(clipOf("hurt").channels.find((channel) => channel.bone === "block")!.keyframes).toEqual([])
  })

  test("the golden file was played from the files this build exports", () => {
    // Fails when the export of the fixture changes: run test/fixtures/animation-contract/regenerate.ts against the real jar and look at what changed.
    expect(contractHash(compiled)).toBe(played.made_from)
    expect(played.times).toEqual([...CONTRACT_TIMES])
  })

  test("(b) = (c): the evaluator written here plays the exported files as GeckoLib 4.8.3's own classes do", () => {
    const worst = { track: 0, corner: 0 }
    machine.animations.forEach((clip) =>
      timesOf(clip.name).forEach((time) => {
        const jar = golden[`animation.contract_machine.${clip.name}`]![String(time)]!
        const own = geckoTracks(clip.name, time)
        expect(Object.keys(own).sort()).toEqual(Object.keys(jar.tracks).sort())
        Object.entries(jar.tracks).forEach(([bone, tracks]) => {
          expect(Object.keys(own[bone]!).sort()).toEqual(Object.keys(tracks).sort())
          Object.entries(tracks).forEach(([track, value]) => (worst.track = Math.max(worst.track, ...value.map((part, axis) => Math.abs(part - own[bone]![track as AnimationTrack]![axis]!)))))
        })
        const corners = geckoCorners(clip.name, time)
        cubeOwners.forEach((owner, cube) => {
          const drawn = jar.corners[owner.bone]![owner.index]!
          expect(drawn.length).toBe(8)
          // The probe lists a cube's corners sorted; here they are in building order: each must have its partner.
          worst.corner = Math.max(worst.corner, ...drawn.map((point) => Math.min(...corners.slice(cube * 8, cube * 8 + 8).map((mine) => apart(mine, point)))), ...corners.slice(cube * 8, cube * 8 + 8).map((mine) => Math.min(...drawn.map((point) => apart(mine, point)))))
        })
      }),
    )
    // GeckoLib computes in single precision and the file keeps four decimals of a pixel.
    expect(worst.track).toBeLessThan(2e-5)
    expect(worst.corner).toBeLessThan(2e-3)
  })

  test("(a) = (b): the shared sampler and the exported files put every corner in the same place", () => {
    const worst = { straight: 0, curved: 0 }
    machine.animations.forEach((clip) => {
      const curved = clip.channels.some((channel) => ANIMATION_TRACKS.some((track) => channelTracks(channel)[track].some((key) => key.interpolation === "smooth")))
      CONTRACT_TIMES.forEach((time) => {
        const cursor = clipCursor(clip, time)
        const sampled = posedCorners(machine, clip, cursor)
        const exported = geckoCorners(clip.name, cursor)
        expect(sampled.length).toBe(exported.length)
        const gap = Math.max(...sampled.map((point, index) => apart(point, exported[index]!)))
        if (curved) worst.curved = Math.max(worst.curved, gap)
        else worst.straight = Math.max(worst.straight, gap)
      })
    })
    // Straight lines and jumps are the same numbers in both; a curve is cut into straight pieces that stay
    // within BAKE_TOLERANCE of it per track, which through this fixture's longest chain is under a tenth of a pixel.
    expect(worst.straight).toBeLessThan(1e-9)
    expect(worst.curved).toBeLessThan(0.1)
    expect(worst.curved).toBeGreaterThan(0)
  })

  test("each track of each bone: sampler and exported file agree within the stated tolerance, signs included", () => {
    machine.animations.forEach((clip) =>
      CONTRACT_TIMES.forEach((time) => {
        const cursor = clipCursor(clip, time)
        const exported = geckoTracks(clip.name, cursor)
        clip.channels.forEach((channel) => {
          const sampled = sampleBone(clip, channel.bone, cursor)!
          ANIMATION_TRACKS.forEach((track) => {
            const own = exported[channel.bone]![track]
            if (!channelTracks(channel)[track].length) return expect(own).toBeUndefined()
            // Back from GeckoLib's radians, X and Y negated, to the document's degrees.
            const said = track === "rotation" ? [(-own![0]! * 180) / Math.PI, (-own![1]! * 180) / Math.PI, (own![2]! * 180) / Math.PI] : own!
            sampled[track].forEach((value, axis) => expect(Math.abs(value - said[axis]!)).toBeLessThanOrEqual(BAKE_TOLERANCE[track] + 1e-4))
          })
        })
      }),
    )
  })

  test("the X mirror: a move towards the document's +X (its own left) is drawn towards -X, +Y and -Z as written", () => {
    const pushed = { ...machine, animations: machine.animations.map((clip) => (clip.name === "idle" ? { ...clip, channels: [{ bone: "light", keyframes: [], position: [{ time: 0, position: [3, 2, -1] as Vec }] }] } : clip)) }
    const still = posedCorners(pushed, null)
    const shown = posedCorners(pushed, pushed.animations.find((clip) => clip.name === "idle")!, 0)
    const first = machine.bones.slice(0, machine.bones.findIndex((bone) => bone.name === "light")).reduce((sum, bone) => sum + bone.cubes.length * 8, 0)
    expect(shown[first]!.map((value, axis) => Number((value - still[first]![axis]!).toFixed(6)))).toEqual([-3, 2, -1])
    // And the exported file says the document's numbers, unflipped: the file's axes are the document's.
    expect(compileModel(pushed, "pushed").animation.animations["animation.pushed.idle"]!.bones.light).toEqual({ position: { "0.0": [3, 2, -1] } })
  })

  test("a position follows the axes of the bone above, turned as it is at that moment", () => {
    // The rod hangs from the arm, which is built turned 10 degrees about Z and swings in `work`.
    const clip = clipOf("work")
    const rod = clip.channels.find((channel) => channel.bone === "rod")!
    const without = { ...clip, channels: clip.channels.map((channel) => (channel === rod ? { ...channel, position: null } : channel)) }
    const first = machine.bones.slice(0, machine.bones.findIndex((bone) => bone.name === "rod")).reduce((sum, bone) => sum + bone.cubes.length * 8, 0)
    const time = 1
    const shift = posedCorners(machine, clip, time)[first]!.map((value, axis) => value - posedCorners(machine, without, time)[first]![axis]!)
    const arm = ((machine.bones.find((bone) => bone.name === "arm")!.rotation[2] + sampleBone(clip, "arm", time)!.rotation[2]) * Math.PI) / 180
    // [0, -3, 0] along the arm's axes: in the mirrored space the picture is drawn in, the arm's up is (-sin, cos).
    expect(shift[0]).toBeCloseTo(3 * Math.sin(arm), 6)
    expect(shift[1]).toBeCloseTo(-3 * Math.cos(arm), 6)
    expect(shift[2]).toBeCloseTo(0, 6)
  })
})

/* ---- Blockbench, as its own source plays a project's keyframes ---- */

type BbKey = { channel: string; time: number; interpolation?: string; data_points: { x: number; y: number; z: number }[] }

/**
 * BoneAnimator.interpolate and Keyframe.getCatmullromLerp of Blockbench 5.1.6 (vendor/blockbench/source,
 * js/animations/timeline_animators.js 423–560 and keyframe.js 224–236), numeric keys with one data point,
 * a format without loop wrapping of the keys themselves (Bedrock Entity). THREE.SplineCurve.getPoint is the
 * uniform Catmull-Rom below with the end points repeated.
 */
function blockbenchValue(keys: BbKey[], time: number, loop: boolean): number[] | undefined {
  const value = (key: BbKey) => [key.data_points[0]!.x, key.data_points[0]!.y, key.data_points[0]!.z]
  const before = keys.filter((key) => key.time < time).sort((a, b) => b.time - a.time)[0]
  const after = keys.filter((key) => key.time >= time).sort((a, b) => a.time - b.time)[0]
  const epsilon = 1 / 1200
  if (before && Math.abs(before.time - time) < epsilon) return value(before)
  if (after && Math.abs(after.time - time) < epsilon) return value(after)
  if (before && before.interpolation === "step") return value(before)
  if (before && !after) return value(before)
  if (after && !before) return value(after)
  if (!before || !after) return undefined
  const alpha = (time - before.time) / (after.time - before.time)
  if (before.interpolation === "linear" && (after.interpolation === "linear" || after.interpolation === "step")) return value(before).map((part, axis) => part + (value(after)[axis]! - part) * alpha)
  const sorted = keys.slice().sort((a, b) => a.time - b.time)
  const index = sorted.indexOf(before)
  const wrap = loop && sorted.length >= 3
  const beforePlus = sorted[index - 1] ?? (wrap ? sorted.at(-2) : undefined)
  const afterPlus = sorted[index + 2] ?? (wrap ? sorted[1] : undefined)
  const points = [...(beforePlus ? [beforePlus] : []), before, after, ...(afterPlus ? [afterPlus] : [])].map(value)
  const p = (points.length - 1) * ((alpha + (beforePlus ? 1 : 0)) / (points.length - 1))
  const whole = Math.floor(p)
  const weight = p - whole
  const picked = [points[whole === 0 ? whole : whole - 1]!, points[whole]!, points[whole > points.length - 2 ? points.length - 1 : whole + 1]!, points[whole > points.length - 3 ? points.length - 1 : whole + 2]!]
  return [0, 1, 2].map((axis) => {
    const [p0, p1, p2, p3] = picked.map((point) => point[axis]!)
    const v0 = (p2! - p0!) * 0.5
    const v1 = (p3! - p1!) * 0.5
    return (2 * p1! - 2 * p2! + v0 + v1) * weight ** 3 + (-3 * p1! + 3 * p2! - 2 * v0 - v1) * weight ** 2 + v0 * weight + p1!
  })
}

describe("animation contract in Blockbench files", () => {
  const model = exportBbmodel({ name: machine.name, geometry: compiled.geometry, animation: compiled.animation, png: compiled.png, clips: machine.animations })
  const animatorsOf = (name: string) => Object.values(model.animations.find((animation) => animation.name === `animation.contract_machine.${name}`)!.animators)

  test("the .bbmodel carries every track with its own keys and interpolation, and is a sound file", () => {
    expect(checkBbmodel(JSON.parse(JSON.stringify(model)))).toEqual([])
    const clip = clipOf("work")
    clip.channels.forEach((channel) => {
      const written = animatorsOf("work").find((animator) => animator.name === channel.bone)!.keyframes
      ANIMATION_TRACKS.forEach((track) => {
        const keys = channelTracks(channel)[track]
        expect(written.filter((key) => key.channel === track).map((key) => ({ time: key.time, value: [key.data_points[0]!.x, key.data_points[0]!.y, key.data_points[0]!.z], interpolation: key.interpolation }))).toEqual(
          keys.map((key) => ({ time: key.time, value: [...key.value], interpolation: ({ linear: "linear", step: "step", smooth: "catmullrom", bezier: "bezier" } as const)[key.interpolation ?? "linear"] })),
        )
      })
    })
  })

  test("Blockbench's own interpolation plays those keys as the shared sampler does", () => {
    const worst = machine.animations.flatMap((clip) =>
      clip.channels.flatMap((channel) => {
        const written = animatorsOf(clip.name).find((animator) => animator.name === channel.bone)!.keyframes as BbKey[]
        return ANIMATION_TRACKS.flatMap((track) => {
          const keys = channelTracks(channel)[track]
          if (!keys.length || !usesContract2(clip)) return []
          // Blockbench shows the next key's value from 1/1200 s before it; nothing else differs.
          return CONTRACT_TIMES.filter((time) => time <= clip.length && !keys.some((key) => key.time > time && key.time - time < 1 / 1200)).map((time) => {
            const theirs = blockbenchValue(written.filter((key) => key.channel === track), time, clip.loop)!
            return Math.max(...sampleTrack(keys, time, clip.loop)!.map((value, axis) => Math.abs(value - theirs[axis]!)))
          })
        })
      }),
    )
    expect(worst.length).toBeGreaterThan(100)
    expect(Math.max(...worst)).toBeLessThan(1e-9)
  })

  test("a version 1 clip is written to the .bbmodel exactly as before, with or without the clips handed over", () => {
    const plain = { ...machine, animations: machine.animations.filter((clip) => !usesContract2(clip) || ["idle", "walk", "hurt"].includes(clip.name)).map((clip) => (usesContract2(clip) ? { ...clip, channels: [{ bone: "base", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: 0.5, rotation: [0, 5, 0] as Vec }] }] } : clip)) }
    const built = compileModel(plain, "plain")
    const given = { name: plain.name, geometry: built.geometry, animation: built.animation, png: built.png }
    expect(JSON.stringify(exportBbmodel({ ...given, clips: plain.animations }))).toBe(JSON.stringify(exportBbmodel(given)))
  })

  test("the embedded editor's project keeps every track and interpolation both ways", () => {
    const back = blockbenchToDesign(designToBlockbench(machine))
    machine.animations.forEach((clip) => {
      const returned = back.animations.find((value) => value.name === clip.name)!
      clip.channels.forEach((channel) => {
        const other = returned.channels.find((value) => value.bone === channel.bone)!
        ANIMATION_TRACKS.forEach((track) => expect(channelTracks(other)[track].map((key) => ({ ...key, interpolation: key.interpolation ?? "linear" }))).toEqual(channelTracks(channel)[track].map((key) => ({ ...key, interpolation: key.interpolation ?? "linear" }))))
      })
    })
  })
  test("a model saved from the embedded editor compiles its curved and held keys to the same animation file", () => {
    // That path reads Blockbench's own keyframes (catmullrom, step); they are the contract's, so the file is the one the document gives.
    const saved = compileSavedModel({ design: machine, blockbench: designToBlockbench(machine) }, "contract_machine")
    expect(JSON.stringify(saved.animation)).toBe(JSON.stringify(compiled.animation))
  })
})

describe("animation contract, version 1 unchanged", () => {
  const old = {
    name: "idle",
    length: 1.5,
    loop: true,
    channels: [{ bone: "base", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: 0.75, rotation: [10, -20, 30] as Vec }, { time: 1.5, rotation: [0, 0, 0] as Vec }] }],
  }

  test("a document without the new fields exports the file it always did", () => {
    const design = { ...machine, animations: [old, ...machine.animations.filter((clip) => clip.name === "walk" || clip.name === "hurt").map((clip) => ({ ...clip, channels: [{ bone: "base", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }] }] }))] }
    expect(JSON.stringify(compileModel(design, "old").animation.animations["animation.old.idle"])).toBe(
      JSON.stringify({ loop: true, animation_length: 1.5, bones: { base: { rotation: { "0.0": [0, 0, 0], "0.75": [10, -20, 30], "1.5": [0, 0, 0] } } } }),
    )
  })

  test("an animation document takes the same channels as a model's clip, and an old one parses to itself", () => {
    const document = { kind: "animation" as const, ...old }
    expect(parseWorkspaceDocument("animation", document)).toEqual(document)
    const full = { kind: "animation" as const, ...clipOf("work") }
    expect(parseWorkspaceDocument("animation", full)).toEqual(full)
    expect(() => parseWorkspaceDocument("animation", { ...document, channels: [{ bone: "base", keyframes: [] }] })).toThrow()
    expect(() => parseWorkspaceDocument("animation", { ...document, channels: [{ bone: "base", keyframes: [], position: [{ time: 0, position: [0, 200, 0] }] }] })).toThrow()
    expect(() => parseWorkspaceDocument("animation", { ...document, channels: [{ bone: "base", keyframes: [], scale: [{ time: 0.5, scale: [1, 1, 1] }, { time: 0.5, scale: [2, 1, 1] }] }] })).toThrow()
  })
})
