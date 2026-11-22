import { soundMoments } from "@minemods/mod-core/sound-moments"
import { thingName } from "../src/renderer/words"
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WorkspaceAssetSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import type { Project } from "@minemods/mod-core/project"
import type { SoundDocument } from "@minemods/mod-core/sound"
import { handShape } from "../src/main/content-service"
import { describeAsset } from "../src/renderer/features/asset-words"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"
import { oggDataUrl, oggVorbis } from "../../mod-core/test/ogg-sample"

/** 任务二 §9: what Studio says of a sound asset, and of a creature that plays one. */

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

const roarId = "a1b2c3d4-0000-4000-8000-000000000001"
const roar: SoundDocument = { kind: "sound", name: "chiyou_roar", files: [{ data: oggDataUrl(oggVorbis({ samples: 66150 })), duration: 1.5 }, { data: oggDataUrl(oggVorbis({ rate: 48000, samples: 96000 })), duration: 2, weight: 3 }], subtitle: { zh: "蚩尤怒吼", en: "Chiyou roars" }, category: "hostile", volume: 0.9, pitch: 1 }

async function voiced(): Promise<Project> {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-sound-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const now = new Date().toISOString()
  const sound = WorkspaceAssetSchema.parse({ id: roarId, module: "sound", title: "蚩尤怒吼", revision: 1, created_at: now, updated_at: now, prompt: "测试", dependencies: [], document: roar, provenance: { model: "example", request_id: null }, status: "ready" })
  const assets = project.workspace.assets.map((asset) => {
    if (asset.document.kind !== "entity") return asset
    const document = asset.document as Extract<ModuleDocument, { kind: "entity" }>
    const abilities = (document.abilities ?? []).map((ability, index) => (index === 0 ? { ...ability, events: [...ability.events, { type: "sound" as const, at: 0.1, sound: { asset: roarId }, volume: 1, pitch: 1 }] } : ability))
    return { ...asset, dependencies: [...asset.dependencies, roarId], document: { ...document, sounds: { ...document.sounds!, hurt: { asset: roarId } }, abilities } }
  })
  return { ...project, workspace: { assets: [sound, ...assets] } }
}

test("a sound is described by what was measured of each file, what the game shows, and who plays it", async () => {
  const project = await voiced()
  const words = describeAsset(project, { id: roarId, asset_id: roarId, kind: "sound", preview: { source: "asset" } }, (reference) => reference,true)
  const row = (label: string) => words.rows.find((value) => value.label === label)?.text
  expect(row("注册名")).toBe(`${project.mod_id}:chiyou_roar`)
  expect(row("第 1 个文件")).toMatch(/^1\.5 秒，单声道，44100 Hz，\d+ KB$/)
  expect(row("第 2 个文件")).toMatch(/^2 秒，单声道，48000 Hz/)
  expect(row("怎么放")).toBe("每次从 2 个文件里随机挑一个")
  expect(row("字幕")).toBe("蚩尤怒吼 / Chiyou roars")
  expect(row("音量")).toContain("敌对生物")
  expect(row("谁在用它")).toBe(`「晶石傀儡」受伤时、招式「重锤」第 0.1 秒`)
}, 60000)

test("a creature that plays a sound of its own lists which moment and which ability event plays which sound", async () => {
  const project = await voiced()
  const creature = project.workspace.assets.find((asset) => asset.document.kind === "entity")!
  const words = describeAsset(project, { id: creature.id, asset_id: creature.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  expect(words.rows.find((value) => value.label === "声音")?.text).toContain("受伤时放自己的声音「蚩尤怒吼」")
  const uses = words.rows.find((value) => value.label === "哪一刻放哪个声音")!.text.split("\n")
  expect(uses).toContain("受伤时：「蚩尤怒吼」（自己的声音，2 个文件随机，最长 2 秒）")
  expect(uses).toContain("招式「重锤」第 0.1 秒：「蚩尤怒吼」（自己的声音，2 个文件随机，最长 2 秒）")
  // A creature without sounds of its own has no such row: its card reads as it always did.
  const plain = await createDataGameplaySample(path.join(directories[0]!, "plain"), { life: true, abilities: true })
  const golem = plain.workspace.assets.find((asset) => asset.document.kind === "entity")!
  expect(describeAsset(plain, { id: golem.id, asset_id: golem.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference).rows.some((value) => value.label === "哪一刻放哪个声音")).toBe(false)
}, 60000)

test("the hand-edit form still offers a moment's vanilla sounds as a choice", () => {
  const sounds = handShape("entity").fields.sounds
  expect(sounds?.type).toBe("object")
  const hurt = sounds?.type === "object" ? sounds.fields.hurt : undefined
  expect(hurt?.type).toBe("choice")
  expect(hurt?.type === "choice" && hurt.options).toContain("entity.iron_golem.hurt")
})

test("声音按出手时间排列，同秒保留写下的顺序，换声音仍能定位原文件", async () => {
  const project = await voiced()
  const creature = project.workspace.assets.find(a => a.document.kind === "entity")!
  const doc = creature.document
  if (doc.kind !== "entity" || !doc.abilities?.length) throw new Error("缺少测试招式")
  const move = doc.abilities[0]!
  const sound = (at: number) => ({ type: "sound" as const, at, sound: { asset: roarId }, volume: 1, pitch: 1 })
  const original = [sound(1.3), sound(0.05), sound(1.3)]
  move.events = original
  const rows = soundMoments(project, doc.model_asset_id).filter(row => row.path[0] === "abilities" && row.path[1] === 0)
  expect(rows.map(row => row.path[3])).toEqual([1, 0, 2])
  expect(rows.map(row => row.key)).toEqual([1, 0, 2].map(i =>
    creature.id + "/abilities/0/events/" + i + "/sound/招式「" + move.name + "」第 " + original[i]!.at + " 秒"))
  expect(move.events.map(event => event.at)).toEqual([1.3, 0.05, 1.3])
}, 60000)

test("工程标题优先，声音用字幕补足注册名，创作者输入的文字原样保留", () => {
  const document = { ...roar, subtitle: { zh: "山谷回声", en: "Valley echo" } }
  expect(thingName({ title: "洞口的回声", document })).toBe("洞口的回声")
  expect(thingName({ title: "valley_echo", document })).toBe("山谷回声")
  expect(thingName({ title: "valley_echo", document: { ...document, subtitle: null } })).toBe("valley_echo")
  expect(thingName({ title: "动画-我的版本", document })).toBe("动画-我的版本")
})
