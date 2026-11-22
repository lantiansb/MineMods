import { readFileSync } from "node:fs"
import path from "node:path"
import type { ModelDesign } from "@minemods/studio-ai/contracts"

/** A painted, articulated positive specimen. Production measurements and gates remain unchanged. */
export function modelFixture(name: string): ModelDesign & { kind: "model" } {
  const design = JSON.parse(readFileSync(path.resolve("test/fixtures/model-quality/forest-creeper.painted.design.json"), "utf8")) as ModelDesign
  design.name = name
  for (const bone of design.bones.filter(bone => bone.name.startsWith("foot_"))) {
    const back = bone.name.includes("back")
    for (const cube of bone.cubes) {
      if (cube.size[2] === 6) {
        cube.size[2] = 3
        if (back) cube.origin[2] += 3
      }
      if (back && cube.size[2] === 2) cube.origin[2] += 5
    }
  }
  for (const animation of design.animations.filter(animation => animation.name === "walk" || animation.name === "hurt")) {
    for (const channel of animation.channels) for (const frame of channel.keyframes) {
      if (frame.rotation) frame.rotation = frame.rotation.map(value => value * 0.5) as [number, number, number]
    }
  }
  return { kind: "model", ...design }
}
