import { describe, expect, test } from "bun:test"
import { ANIMATION_TRACKS, BAKE_TOLERANCE, channelTracks } from "@minemods/studio-ai/animation"
import { compileModel } from "@minemods/mod-core/model"
import { CONTRACT_TIMES, contractMachine } from "../../mod-core/test/fixtures/animation-contract/machine"
import { explodeVector, sampleAnimation, sampleBone } from "../src/renderer/model-core"
import { previewBonePosition, sampleCompiledTrack, type CompiledTrack } from "../src/renderer/model-core/pose"

describe("model canvas core", () => {
  test("spreads exploded parts deterministically and keeps the requested amount", () => {
    expect(explodeVector(0, 4, 2).map((value) => Math.round(value * 100) / 100)).toEqual([2, -0.7, 0])
    expect(explodeVector(1, 4, 2).map((value) => Math.round(value * 100) / 100)).toEqual([0, 0, 2])
  })

  test("interpolates and loops animation keyframes", () => {
    const animation = { length: 2, loop: true, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 2, rotation: [20, 0, 0] }] }] } as never
    expect(sampleAnimation(animation, "root", 1)).toEqual([10, 0, 0])
    expect(sampleAnimation(animation, "root", 2.5)).toEqual([5, 0, 0])
    expect(sampleAnimation(animation, "missing", 1)).toBeUndefined()
  })

  test("the viewport plays a compiled animation file and the document's own clip to the same pose", () => {
    // The viewport reads a track from the compiled file when the preview has one and from the document otherwise: the two must agree for every track.
    const machine = contractMachine()
    const files = compileModel(machine, "machine").animation.animations as unknown as Record<string, { bones: Record<string, Partial<Record<(typeof ANIMATION_TRACKS)[number], CompiledTrack>>> }>
    const gaps = machine.animations.flatMap((clip) =>
      clip.channels.flatMap((channel) =>
        ANIMATION_TRACKS.filter((track) => channelTracks(channel)[track].length).flatMap((track) =>
          // The file ends a held value 0.001 s before the key that follows it; the moments compared stay clear of that.
          CONTRACT_TIMES.filter((time) => time < clip.length).map((time) => {
            const compiled = sampleCompiledTrack(files[`animation.machine.${clip.name}`]!.bones[channel.bone]![track], time)!
            return Math.max(...sampleBone(clip, channel.bone, time)![track].map((value, axis) => Math.abs(value - compiled[axis]!))) / BAKE_TOLERANCE[track]
          }),
        ),
      ),
    )
    expect(gaps.length).toBeGreaterThan(300)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1.01)
  })

  test("a position is drawn mirrored in X, like the geometry it moves", () => {
    expect(previewBonePosition([1, 2, 3], [0, 0, 0], [5, 6, 7])).toEqual([-4, 8, 10])
    const clip = { length: 1, loop: false, channels: [{ bone: "root", keyframes: [], position: [{ time: 0, position: [0, 0, 0] }, { time: 1, position: [4, 2, -2] }], scale: [{ time: 0, scale: [1, 1, 1], interpolation: "step" }, { time: 0.5, scale: [2, 2, 2] }] }] } as never
    expect(sampleBone(clip, "root", 0.5)).toEqual({ rotation: [0, 0, 0], position: [2, 1, -1], scale: [2, 2, 2] })
    expect(sampleBone(clip, "root", 0.25)!.scale).toEqual([1, 1, 1])
    expect(sampleAnimation(clip, "root", 0.5)).toEqual([0, 0, 0])
  })
})
