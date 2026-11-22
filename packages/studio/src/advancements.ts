import { z } from "zod"

/**
 * 进度: the firsts of a project, each said once and only when it really happened. The words are this tool's own. Kept in the project's `.minemods`, which a project's export does
 * not carry: a shared project starts over with whoever opens it.
 */
export const ADVANCEMENTS = {
  made: { title: "开工大吉", line: "第一样东西做好了" },
  accepted: { title: "验货通过", line: "你点头了第一样东西" },
  packed: { title: "装箱完毕", line: "第一次打包成功" },
  handed: { title: "指点江山", line: "第一次把批注交给 AI" },
  restored: { title: "后悔药", line: "第一次回到旧版，旧版都还在" },
} as const
export type AdvancementId = keyof typeof ADVANCEMENTS
const IDS = Object.keys(ADVANCEMENTS) as [AdvancementId, ...AdvancementId[]]
export const AdvancementIdSchema = z.enum(IDS)
export const AdvancementsSchema = z.strictObject({ schema_version: z.literal(1), earned: z.array(AdvancementIdSchema) })

/** What a project with no record starts from. One that already holds things has had its firsts, unseen: nothing that happens next in it is a first, so none is claimed. */
export const startingEarned = (thingsInProject: number): AdvancementId[] => (thingsInProject > 0 ? [...IDS] : [])

/** Which of these are news, and what is known afterwards. */
export function earn(earned: readonly AdvancementId[], ids: readonly AdvancementId[]) {
  const fresh = [...new Set(ids)].filter((id) => !earned.includes(id))
  return { earned: [...earned, ...fresh], fresh }
}
