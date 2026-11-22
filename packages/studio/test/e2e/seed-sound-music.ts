import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { ProjectSchema, saveProject } from "@minemods/mod-core/project"
import { compassFixture } from "../../../mod-core/script/target-arena-sample"
import { putAudio } from "../../src/main/audio-import"
const dir = process.argv[2]!
const file = path.join(dir, "minemods.project.json")
const p = ProjectSchema.parse(JSON.parse(await readFile(file, "utf8")))
const sound = p.workspace.assets.find((a) => a.module === "sound")!
const entity = p.workspace.assets.find((a) => a.document.kind === "entity")!
const samples = path.join(import.meta.dir)
const tone = await readFile(path.join(samples, "stone-tone.ogg"))
const loop = await readFile(path.join(samples, "stone-loop.ogg"))
sound.title = "石像低鸣"
if (sound.document.kind === "sound") sound.document.files = [{ data: "data:audio/ogg;base64," + tone.toString("base64"), duration: 2.4 }]
for (const e of [p.entities[0]!, entity.document]) {
  if (!("boss" in e)) continue
  e.name = "石像守卫"
  e.sounds = { ambient: "entity.cow.ambient", hurt: { asset: sound.id }, death: null, step: null, pitch: 1, volume: 1 }
  if (e.boss?.intro) e.boss.intro.steps = [{ type: "sound", at: 0.2, sound: { asset: sound.id }, volume: 1, pitch: 1 }]
}
entity.title = "石像守卫"
p.workspace.assets.push({ ...sound, module: "fixture", document: compassFixture, id: randomUUID(), dependencies: [], title: "守卫的罗盘" })
const base = { projectId: p.id, expectedRevision: p.revision }
let next = (await putAudio(dir, p, { ...base, kind: "sound", title: "空谷回声" }, tone, null)).next
const music = await putAudio(dir, next, { ...base, kind: "music", title: "洞底回响" }, loop, null)
next = music.next
for (const part of ["intro", "outro"] as const)
  next = (await putAudio(dir, next, { ...base, assetId: music.id, kind: "music", part }, tone, null)).next
next = (await putAudio(dir, next, { ...base, kind: "music", title: "山口夜曲" }, loop, null)).next
const inbox = path.join(dir, "收件箱")
await mkdir(inbox, { recursive: true })
await writeFile(path.join(inbox, "守卫脚步.ogg"), tone)
await saveProject(dir, next, p.revision)
