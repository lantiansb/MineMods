import { writeFile } from "node:fs/promises"
import { creatureLook } from "./guide-project"
import { compileModel } from "./model"
import { openProject, storagePath } from "./project"
import { creatureName } from "./registry-name"
import { assetKind } from "./workspace-modules"
import { MODEL_EXPORT } from "./model-export-words"
export { MODEL_EXPORT, MODEL_EXPORT_WORDS } from "./model-export-words"

/** What `exportProjectModel` refuses, in the words to show. */
export class ModelExportRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ModelExportRefusal"
  }
}

/** The folder, as segments inside the project; refused when it would leave the project or write into Studio's own folders. */
export function modelExportFolder(folder: string = MODEL_EXPORT.folder) {
  const segments = folder.trim().replaceAll("\\", "/").split("/").filter((segment) => segment !== "")
  const bad = !segments.length || /^[a-zA-Z]:/.test(folder.trim()) || folder.trim().startsWith("/") || folder.trim().startsWith("\\")
    || segments.some((segment) => segment === "." || segment === ".." || /[:*?"<>|]/.test(segment) || segment.length > 80)
    || (MODEL_EXPORT.own as readonly string[]).includes(segments[0]!.toLowerCase())
  if (bad) throw new ModelExportRefusal(`folder 要写工程文件夹里的一个子文件夹，用 / 分隔，比如 ${MODEL_EXPORT.folder}；不能有 .. 、盘符或开头的 /，也不能写进 ${MODEL_EXPORT.own.join(" 或 ")}（Studio 自己的文件夹）。`)
  return segments
}

/**
 * Writes one model's files into `folder` of the project and says which, by their paths inside the project. `assetId` is a creature (its id, its model's, or its
 * setting's) or a model asset. A creature without a saved model, a model not made yet and anything that is no model are refused in plain words.
 */
export async function exportProjectModel(directory: string, assetId: string, folder?: string) {
  const segments = modelExportFolder(folder)
  const project = await openProject(directory)
  const asset = project.workspace.assets.find((value) => value.id === assetId)
  const setting = asset?.document.kind === "entity" ? asset.document.model_asset_id : null
  const entity = project.entities.find((value) => value.id === assetId || value.model_asset_id === assetId || value.id === setting)
  const made = await (async () => {
    if (entity) {
      if (!entity.model_asset_id) throw new ModelExportRefusal(`「${entity.name}」还没有模型，没有可以导出的。先给它做好模型再导出。`)
      const look = (await creatureLook(directory, project, entity))!
      return { name: creatureName(entity), title: entity.name, geometry: look.geometry, animation: look.animation, png: look.png, glow: look.glowPng }
    }
    if (!asset) throw new ModelExportRefusal(`这个工程里没有编号是 ${assetId} 的东西。assetId 写生物或模型资产的编号（工程概览里列出的那些）。`)
    if (asset.document.kind !== "model") throw new ModelExportRefusal(`「${asset.title}」是${assetKind(asset.module).label}，不是模型。export_model 只导出模型，或者有模型的生物。`)
    if (asset.status !== "ready") throw new ModelExportRefusal(`模型「${asset.title}」还没做好（还没通过检查存成正式的），现在导出的不会是游戏里的样子。等它做好再导出。`)
    const { kind: _kind, ...design } = asset.document
    const name = `model_${asset.id.replaceAll("-", "")}`
    const compiled = compileModel(design, name)
    return { name, title: asset.title, geometry: compiled.geometry, animation: compiled.animation, png: compiled.png, glow: compiled.glow }
  })()
  const files: [string, string | Uint8Array][] = [
    [`${made.name}.geo.json`, JSON.stringify(made.geometry, null, 2)],
    [`${made.name}.animation.json`, JSON.stringify(made.animation, null, 2)],
    [`${made.name}.png`, made.png],
    ...(made.glow ? [[`${made.name}_glowmask.png`, made.glow] as [string, Uint8Array]] : []),
  ]
  for (const [file, data] of files) await writeFile(await storagePath(directory, [...segments, file], true), data)
  return { name: made.name, title: made.title, folder: segments.join("/"), files: files.map(([file]) => [...segments, file].join("/")) }
}
