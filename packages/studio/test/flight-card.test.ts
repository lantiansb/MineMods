import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { FlightSchema, HabitsSchema } from "@minemods/mod-core/entity-runtime"
import { flightWords, habitsWords } from "@minemods/mod-core/creature-flight"
import { describeAsset } from "../src/renderer/features/asset-words"
import { HAND_KEPT, HAND_KEPT_WORDS } from "../src/renderer/features/asset-edit-words"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

const flight = FlightSchema.parse({ style: "soar", speed: 12, altitude: { min: 10, max: 28 }, turn: 80, climb: 40, bank: 28, air_share: 0.6, takeoff: { clip: "wave", seconds: 1 }, land: { clip: "roar", seconds: 0.8 }, clips: { fly: "burst", glide: "slam", hover: null } })
const habits = HabitsSchema.parse({ active: "day", rest: { clip: "wave" }, home: { radius: 32 }, prey: ["cow"], hunger_seconds: 300, eat: null, alert: { clip: "roar", distance: 20 } })

test("the creature card says how it flies and how it lives in the words a player can check, and lists what plays the motions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-flight-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const asset = project.workspace.assets.find((value) => value.document.kind === "entity")!
  const describe = (document: typeof asset.document) =>
    describeAsset({ ...project, workspace: { assets: project.workspace.assets.map((value) => (value.id === asset.id ? { ...value, document } : value)) } }, { id: asset.id, asset_id: asset.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  const plain = describe(asset.document)
  expect(plain.rows.some((row) => row.label === "飞行" || row.label === "习性")).toBe(false)
  const card = describe({ ...asset.document, flight, habits } as typeof asset.document)
  const row = (label: string) => card.rows.find((value) => value.label === label)!
  expect(row("飞行").text).toBe(flightWords.summary(flight))
  expect(row("飞行").text).toStartWith("它会飞：")
  expect(row("习性").text.split("\n")).toEqual(habitsWords.summary(habits, "\n").split("\n"))
  expect(row("动作去向").detail).toContain("wave ← ")
  expect(row("动作去向").detail).toMatch(/takeoff|flight/)
})

test("the form leaves flight and habits as they are, and says so", () => {
  expect(HAND_KEPT.entity).toEqual(expect.arrayContaining(["flight", "habits"]))
  expect(HAND_KEPT_WORDS.entity).toContain("飞行")
  expect(HAND_KEPT_WORDS.entity).toContain("习性")
})
