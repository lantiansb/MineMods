import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { createTargetBossShowSample, fourEyedDesign } from "../../../mod-core/script/target-boss-show-sample"
import { sweep, thrust } from "../../../mod-core/script/target-tactics-sample"
import { saveProject } from "../../../mod-core/src/project"
import { getModuleSchema, WorkspaceAssetSchema } from "../../../mod-core/src/workspace"
const directory = process.argv[2]
if (!directory) throw new Error("Usage: bun test/e2e/hand-moves.seed.ts <empty fixture directory>")
const root = path.join(directory, "source/projects")
await mkdir(root, { recursive: true })
await writeFile(path.join(root, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
const keys = new Set(Object.keys(getModuleSchema("entity").shape))
for (const [name, title, target] of [
  ["潮汐灯塔", "巡潮蟹", "fabric-1.21.1"],
  ["霜杉林径", "霜针兽", "forge-1.20.1"],
  ["星沙观测站", "星沙巡卫", "neoforge-1.21.1"],
] as const) {
  const projectDirectory = path.join(root, name)
  const project = await createTargetBossShowSample(projectDirectory, target)
  const rules = { ...project.entities[0]!, name: title, name_en: "Sentinel", description: "", abilities: [{ ...sweep, name: "扫击" }, { ...thrust, name: "突刺" }] }
  const stamp = new Date().toISOString()
  const held = { revision: 1, created_at: stamp, updated_at: stamp, prompt: title, provenance: { model: null, request_id: null }, status: "ready" }
  const model = WorkspaceAssetSchema.parse({ ...held, id: rules.id, title: "守卫外观", module: "model", dependencies: [], document: { kind: "model", ...fourEyedDesign } })
  const document = { ...Object.fromEntries(Object.entries(rules).filter(([key]) => keys.has(key))), kind: "entity", model_asset_id: rules.id }
  const asset = WorkspaceAssetSchema.parse({ ...held, id: randomUUID(), module: "entity", title, dependencies: [rules.id, ...project.workspace.assets.map(asset => asset.id)], document })
  await saveProject(projectDirectory, { ...project, name, entities: [rules], workspace: { assets: [...project.workspace.assets, model, asset] } }, project.revision)
}
