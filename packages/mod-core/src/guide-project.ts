import { buildProjectOverview } from "./asset-overview"
import { assetRef } from "./finding-refs"
import { contentName } from "./asset-name"
import { z } from "zod"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { loadModelAsset } from "./assets"
import { bbmodelNames, bbmodelText } from "./bbmodel"
import { latestSuccessfulBuild } from "./build-record"
import { compileSavedModel } from "./editable-model"
import { creatureName } from "./gameplay"
import { readGameplay } from "./gameplay-loop"
import { guidePose, modGuide } from "./guide"
import { fingerprint } from "./making"
import { compileModel } from "./model"
import { openProject, type Project } from "./project"
import { reconcile, type Finding } from "./reconcile"
import { compileWorkspaceTexture } from "./workspace"

// The guide, the reconciliation and the Blockbench export for a project as it is saved now, without a build.
// They read the same records a build reads and compile a creature's look the same way.

/** One creature's look as a build would put it in the jar, or null while it has no saved model. */
export async function creatureLook(directory: string, project: Project, entity: Project["entities"][number]) {
  if (!entity.model_asset_id) return null
  const asset = await loadModelAsset(directory, entity.model_asset_id)
  const compiled = compileSavedModel(z.object({ design: ModelDesignSchema, blockbench: z.unknown().optional() }).parse(asset.data), creatureName(entity))
  const texture = project.workspace.assets.find((candidate) => candidate.id === entity.runtime?.texture_asset_id && candidate.document.kind === "texture")
  return { name: entity.name, geometry: compiled.geometry, animation: compiled.animation, png: texture ? compileWorkspaceTexture(texture) : compiled.png, glow: Boolean(compiled.glow && !texture), glowPng: texture ? null : compiled.glow, pose: guidePose(compiled.design), design: compiled.design, cubes: compiled.design.bones.map((bone) => bone.cubes.map((cube) => cube.name)), clips: compiled.design.animations }
}

/**
 * The mod guide and what machine reconciliation finds, for the project as saved. The rules that compare
 * with generated files (names in both languages, spawn eggs) only run in a build; everything else is here.
 */
export async function projectGuide(directory: string, external = false) {
  const project = await openProject(directory)
  const looks = await Promise.all(project.entities.map(async (entity) => ({ entity, look: await creatureLook(directory, project, entity).catch(() => null) })))
  const animations = Object.fromEntries(looks.flatMap((entry) => (entry.look ? [[entry.entity.id, Object.keys(entry.look.animation.animations).map((name) => name.split(".").at(-1)!)]] : [])))
  const gameplay = await Promise.all(
    project.workspace.assets.flatMap((asset) => {
      const document = asset.document
      if (document.kind !== "gameplay") return []
      return [
        readGameplay(directory, asset.id)
          .catch(() => null)
          .then((record) => ({ id: asset.id, title: contentName(asset), checked: record?.saved?.fingerprint === fingerprint(document) && Boolean(record.saved.check.compile?.ok) })),
      ]
    }),
  )
  const models = Object.fromEntries(looks.flatMap((entry) => entry.look ? [[entry.entity.id, entry.look.design]] : []))
  const findings = reconcile(project, { animations, gameplay, models })
  const poses = Object.fromEntries(looks.flatMap((entry) => entry.look ? [[entry.entity.id, entry.look.pose]] : []))
  // Round 18: asked for after a build finished, this guide still said the mod was never packaged while the copy beside the jar said it was.
  // The project's own job records say which revision was last built; only that very revision is called built, since its jar is what the words are about.
  const build = await latestSuccessfulBuild(directory).catch(() => null)
  const built = build?.revision === project.revision
  const unused: Finding[] = external ? unusedFindings(project) : []
  return { revision: project.revision, findings: external ? [...findings, ...unused] : findings.map(({ refs: _refs, ...finding }) => finding), guide: modGuide(project, { findings, animations, poses, glowing: looks.flatMap((entry) => (entry.look?.glow ? [entry.entity.id] : [])), built, changed: Boolean(build) && !built }) }
}

function unusedFindings(project: Project): Finding[] {
  const overview = buildProjectOverview({ project, build: null, verification: null, runs: [], production: null, producing: false })
  const items = new Map(overview.items.map((item) => [item.id, item]))
  return overview.problems.flatMap((problem): Finding[] => {
    if (problem.kind !== "unused") return []
    const item = items.get(problem.item)
    if (!item?.asset_id) return []
    return [{ rule: "asset_unused", stops: false, about: null, text: problem.message, fix: "让需要它的内容引用这项资产，或者移除用不上的资产。", refs: [assetRef(item.asset_id, item.title)] }]
  })
}

/**
 * One model as a .bbmodel file. `assetId` is a creature (its id, its model's, or its rules' asset), or a
 * model in the workspace that no creature uses yet.
 */
export async function projectBbmodel(directory: string, assetId: string) {
  const project = await openProject(directory)
  const rules = project.workspace.assets.find((asset) => asset.id === assetId && asset.document.kind === "entity")
  const entity = project.entities.find((candidate) => candidate.id === assetId || candidate.model_asset_id === assetId || (rules?.document.kind === "entity" && rules.document.model_asset_id === candidate.id))
  const look = entity ? await creatureLook(directory, project, entity) : null
  if (look) return { file: bbmodelNames([look.name])[0]!, text: bbmodelText(look) }
  const model = project.workspace.assets.find((asset) => asset.id === assetId && asset.document.kind === "model")
  if (!model || model.document.kind !== "model") throw new Error("BBMODEL_NO_MODEL")
  const { kind: _kind, ...design } = model.document
  const compiled = compileModel(design, "model")
  return { file: bbmodelNames([model.title])[0]!, text: bbmodelText({ name: model.title, geometry: compiled.geometry, animation: compiled.animation, png: compiled.png, cubes: compiled.design.bones.map((bone) => bone.cubes.map((cube) => cube.name)), clips: compiled.design.animations }) }
}
