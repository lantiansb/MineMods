import path from "node:path"
import { putModelAsset } from "@minemods/mod-core/assets"
import { randomUUID } from "node:crypto"
import { openProject, saveProject } from "@minemods/mod-core/project"

const directory = path.resolve(process.argv[2]!)
const project = await openProject(directory)
const assets = project.workspace.assets
const model = assets.find((a) => a.document.kind === "model")!
const rules = assets.find((a) => a.document.kind === "entity")!
if (rules.document.kind !== "entity" || model.document.kind !== "model") throw Error("缺少守卫")
const passiveId = randomUUID()
const gentle = {
  ...rules.document,
  model_asset_id: passiveId,
  behavior: "passive" as const,
  name: "溪边石羊",
  sounds: null,
  abilities: [],
  combos: [],
  boss: null,
}
assets.push(
  { ...model, id: passiveId, title: "石羊外观" },
  { ...rules, id: randomUUID(), title: gentle.name, dependencies: [passiveId], document: gentle },
)
project.entities.push({
  ...project.entities[0]!,
  id: passiveId,
  model_asset_id: null,
  behavior: "passive",
  name: gentle.name,
  abilities: [],
  combos: [],
  boss: null,
})
const unused = { ...model.document.animations[0]!, name: "old_wave", display_name: "旧挥手" }
model.document.animations.push(unused)
const fixture = assets.find((a) => a.module === "fixture")!
rules.dependencies.push(fixture.id)
for (const creature of [rules.document, project.entities[0]!]) {
  const boss = creature.boss!
  boss.arena = {
    fixtures: [
      {
        id: "compass",
        look: { asset: fixture.id },
        place: { ring: { count: 2, radius: 8 } },
        use: { seconds: 1, cooldown: 5 },
        clear: { radius: 3, seconds: 5 },
      },
    ],
    fog: null,
  }
  boss.lair = {
    biomes: ["minecraft:stony_peaks"],
    spacing: 40,
    radius: 10,
    floor: ["minecraft:stone"],
    rim: "minecraft:andesite",
    clearance: 8,
  }
  if (boss.intro) boss.intro.steps = [...(boss.intro.steps ?? []), { type: "clip", clip: "roar", at: 0.4 }]
  boss.death.steps = [{ type: "clip", clip: "wave", at: 0 }]
  creature.combos![0]!.branches = [{ after: 0, min_distance: 5, to: 2 }]
}
if (process.argv.includes("--large")) {
  const sound = assets.find((a) => a.module === "sound")!
  for (const title of ["山谷风声", "石门回响", "钟声", "细雨声"])
    if (sound.document.kind === "sound")
      assets.push({ ...sound, id: randomUUID(), title, document: { ...sound.document, name: "echo_" + assets.length } })
}
const saved = await saveProject(directory, project, project.revision)
const { kind, ...design } = model.document
const updated = await putModelAsset(directory, {
  entity_id: model.id,
  origin: "example",
  expectedRevision: saved.revision,
  data: { design },
})
await putModelAsset(directory, {
  entity_id: passiveId,
  origin: "example",
  expectedRevision: updated.project.revision,
  data: { design },
})
console.log(assets.length)
