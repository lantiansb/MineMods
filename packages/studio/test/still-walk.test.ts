import { expect, test } from "bun:test"
import { continuityFindings, unseenMotions } from "@minemods/mod-core/making"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { walkingSpeed } from "@minemods/studio-ai/motion-continuity"
import { reviewJob } from "../src/main/look-job"

/**
 * A machine that never walks is made before the creature that says so: its model has the walk clip every creature needs, its feet touch the
 * ground and never push back, and the part sheet declares the walk still. At that stage the speed is not known, so the walk is not measured for
 * planted feet; once the speed is known it is (and a stationary creature's is 0).
 */
const faces = { north: "#778899", east: "#778899", south: "#778899", west: "#778899", up: "#99aabb", down: "#556677" }
const cube = (name: string, origin: number[], size: number[]) => ({ name, origin, size, faces, surface_details: [] })
const turning = (name: string) => ({ name, length: 1.6, loop: true, channels: [{ bone: "body", keyframes: [0, 0.8, 1.6].map((time, key) => ({ time, rotation: [0, 3 * (key === 1 ? -1 : 1), 0] })) }] })
const turret = {
  kind: "model" as const,
  ...ModelDesignSchema.parse({
    name: "炮台",
    texture_size: 128,
    bones: [
      { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
      { name: "body", parent: "root", pivot: [0, 26, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-16, 21, -8], [32, 29, 19])] },
      { name: "leg_left", parent: "root", pivot: [6, 24, 0], rotation: [0, 0, 0], cubes: [cube("leg", [1, 0, -2], [10, 20, 4])] },
      { name: "leg_right", parent: "root", pivot: [-6, 24, 0], rotation: [0, 0, 0], cubes: [cube("leg", [-11, 0, -2], [10, 20, 4])] },
    ],
    animations: ["idle", "walk", "hurt"].map(turning),
  }),
}
const sheet = (still: { motion: string; reason: string }[]) => ({ still, differs: [], justified: [] })
const walkFaults = (made: ReturnType<typeof reviewJob>) => made.motion.find((note) => note.name === "walk")!.continuity!.faults

test("a walk the sheet declares still is not measured for planted feet while the speed is unknown, and is once it is known", () => {
  const declared = sheet([{ motion: "walk", reason: "炮台固定在塔顶，从不走动" }])
  // Nothing declared: the gate fires, as ever.
  expect(walkFaults(reviewJob(turret as ModuleDocument, null, sheet([])))).toEqual(["glide"])
  // Declared still, speed not known: no glide, no slide, and the walk is not told as a fact of planted feet either.
  const stationary = reviewJob(turret as ModuleDocument, null, declared)
  expect(walkFaults(stationary)).toEqual([])
  expect(stationary.motion.find((note) => note.name === "walk")!.continuity!.walk).toBeNull()
  expect(continuityFindings(declared, stationary.motion)).toEqual([])
  // The declaration also silences the unseen-motion finding, by either name of the motion (the maker may write the label as the findings print it).
  expect(unseenMotions(declared, stationary.motion)).toEqual([])
  expect(unseenMotions(sheet([{ motion: "走路（walk）", reason: "炮台不走" }]), stationary.motion)).toEqual([])
  // The speed is known and above 0 (the creature walks, whatever the sheet says): measured again.
  expect(walkFaults(reviewJob(turret as ModuleDocument, null, declared, null, walkingSpeed(0.25)))).toEqual(["glide"])
  // The speed is known and 0 (a stationary creature, see the project runner): nothing is measured, declared or not.
  expect(walkFaults(reviewJob(turret as ModuleDocument, null, declared, null, 0))).toEqual([])
  expect(walkFaults(reviewJob(turret as ModuleDocument, null, sheet([]), null, 0))).toEqual([])
})
