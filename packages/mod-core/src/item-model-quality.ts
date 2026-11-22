import { judge, justifyTail, outlineOf, unreadable, type AssetReview, type ReviewContext } from "@minemods/studio-ai/acceptance"
import { measureLook } from "@minemods/studio-ai/model-look"
import { answerModelCraft, MODEL_STANDARD } from "@minemods/studio-ai/model-quality"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { Project } from "./project"
import { compileItemModel } from "./item-model"

/** The saved project's actual uses decide the gate. A model shared with a creature retains creature checks. */
export function isItemOnlyModel(project: Pick<Project, "items" | "entities" | "workspace">, assetId: string) {
  return project.items.some(item => item.model_asset_id === assetId)
    && !project.entities.some(entity => entity.id === assetId)
    && !project.workspace.assets.some(asset => asset.document.kind === "entity" && asset.document.model_asset_id === assetId)
}

/** Shape connectivity, visible geometry and surface noise apply to a static item too; anatomy and gait do not. */
const standard: typeof MODEL_STANDARD = {
  kind: "model",
  label: "静态物品模型",
  rules: [...MODEL_STANDARD.rules.filter(rule => ["hidden_parts", "floating_parts", "noisy_texture", "invisible_details"].includes(rule.id)).map(rule => rule.id === "floating_parts" ? {
    ...rule,
    asks: "物品部件应与相邻部件连接，不能无意悬空",
    find: (measured: Parameters<typeof rule.find>[0]) => measured.floating.length ? { message: `这些物品部件没有连接：${measured.floating.join("、")}。`, fix: `让部件与相邻部件相接；${justifyTail(rule.id)}`, evidence: measured.floating } : null,
  } : rule), {
    id: "duplicate_geometry", criterion: "earns_place", severity: "defect", asks: "相同位置和大小的物品立方体只保留一个",
    find: measured => measured.twinCubes.length ? { message: `存在完全重叠的重复立方体：${measured.twinCubes.join("、")}。`, fix: "删除重复立方体，保留实际轮廓。", evidence: measured.twinCubes } : null,
  }],
  unmeasured: {
    reads: "物品轮廓、用途特征和部件比例由独立评审对照部件说明与六视图检查。",
    hierarchy: "物品材质、颜色层次和视觉主次由独立评审对照真实纹理与参考图检查。",
    fits: "静态几何、纹理空间和预算必须通过 schema 及 Java 物品导出检查。",
  },
}
export const STATIC_ITEM_MODEL_STANDARD = outlineOf(standard)

export function reviewStaticItemModel(design: ModelDesign, context: ReviewContext = {}): AssetReview {
  try {
    // Includes the actual atlas packing, geometry budget, coordinate limits and identity-animation contract.
    compileItemModel(design)
  } catch (cause) {
    return unreadable(standard, cause instanceof Error ? cause.message : "静态物品模型无法导出。", "修正模型数据，使它可以原样导出为 Java 物品模型。")
  }
  const look = measureLook(design)
  return answerModelCraft(judge(standard, { ...look, minCubes: 0, animatedBones: 0 }, context, { level: "full", spared: false }, {
    cubes: look.cubes,
    bones: design.bones.length,
    hiddenCubes: look.hiddenCubes.length,
    floatingParts: look.floating.length,
    textureNoise: look.speckShare,
    staticItem: true,
  }), context.justified)
}
