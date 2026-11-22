import { z } from "zod"
import { MakingRefusal } from "@minemods/mod-core/making"
import type { WorkspaceAsset } from "@minemods/mod-core/workspace"
import { FollowSchema } from "@minemods/studio-ai/contracts"

const vector = z.tuple([z.number(), z.number(), z.number()])
const patchSchema = z.strictObject({
  kind: z.literal("model_bone_patch"),
  revision: z.number().int().positive(),
  bones: z.array(z.strictObject({ name: z.string().min(1), parent: z.string().nullable().optional(), pivot: vector.optional(), rotation: vector.optional() })).max(128).optional(),
  follow: FollowSchema,
})

export const PATCH_GUIDE = '只改已有模型的一小处：在 plan_run 的 model 任务中用 target_id 指定模型。look 和 commit_task 的 document 可以都传同一份 {kind:"model_bone_patch",revision:资产版本,bones:[{name:"arm",pivot:[0,8,0]}]}。每根骨骼只写要改的 parent、pivot 或 rotation，follow 可选，填写时替换整个跟随列表。Studio 读取现有模型，补丁展开后照常看图、自评、审查和提交。'

export async function expandBonePatch(document: unknown, read: () => Promise<WorkspaceAsset | undefined>) {
  if (!document || typeof document !== "object" || !("kind" in document) || document.kind !== "model_bone_patch") return document
  const patch = patchSchema.parse(document)
  const asset = await read()
  if (asset?.document.kind !== "model") throw new MakingRefusal("骨骼修改需要指向这个任务要改的现有模型。")
  if (asset.revision !== patch.revision) throw new MakingRefusal("模型版本已经变化，请读最新资产版本，再核对要改的骨骼。")
  const changes = new Map((patch.bones ?? []).map(({ name, ...change }) => [name, change]))
  if (changes.size !== (patch.bones?.length ?? 0)) throw new MakingRefusal("一根骨骼只能在修改清单里出现一次。")
  if (!changes.size && patch.follow === undefined) throw new MakingRefusal("请写下要改的骨骼或跟随列表。")
  const bones = asset.document.bones.map((bone) => {
    const change = changes.get(bone.name)
    changes.delete(bone.name)
    return change ? { ...bone, ...change } : bone
  })
  if (changes.size) throw new MakingRefusal("模型里找不到这些骨骼：" + [...changes.keys()].join("、"))
  return { ...asset.document, bones, ...(patch.follow !== undefined ? { follow: patch.follow } : {}) }
}
