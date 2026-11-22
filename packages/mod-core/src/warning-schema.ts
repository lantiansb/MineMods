import { z } from "zod"
import { WARN_COLOR_IDS, WARN_LIMITS, WARN_LOOK_IDS } from "./ability-words"

export const BasicWarnSchema = z.strictObject({
  paint:z.enum(["mesh","dust"]).optional(),
  seconds: z.number().finite().min(WARN_LIMITS.seconds.min).max(WARN_LIMITS.seconds.max),
  look: z.enum(WARN_LOOK_IDS),
  color: z.enum(WARN_COLOR_IDS),
})
export const HitWarnSchema = BasicWarnSchema.extend({
  follow: z.enum(["caster","target"], { error: "跟随对象请选择 caster（施法者）或 target（目标）。" }).optional(),
  lock_before: z.number().min(0, "提前定住的时间不能为负。").max(10, "最多提前 10 秒定住。").optional(),
  fade_seconds: z.number().min(0, "淡出时间不能为负。").max(3, "淡出最多 3 秒。").optional(),
  effect: z.uuid("请填写本工程效果资产的编号。").optional(),
}).superRefine((warn, ctx) => {
  if (warn.lock_before !== undefined && (!warn.follow || warn.lock_before > warn.seconds)) ctx.addIssue({ code: "custom", path: ["lock_before"], message: "提前定住需要指定 follow，时间不能超过预警秒数。" })
})
export const RingWarnSchema = HitWarnSchema.safeExtend({
  extent: z.enum(["start", "max"], { error: "预警范围选 start（起始圈）或 max（加画最大圈）。" }).optional(),
})
