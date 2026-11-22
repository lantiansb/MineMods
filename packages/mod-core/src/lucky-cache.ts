import { z } from "zod"

const RewardItemSchema = z.strictObject({
  item: z.enum([
    "minecraft:apple", "minecraft:bread", "minecraft:emerald", "minecraft:oak_sapling", "minecraft:diamond",
    "minecraft:golden_apple", "minecraft:coal", "minecraft:torch", "minecraft:iron_ingot", "minecraft:copper_ingot",
    "minecraft:gold_ingot", "minecraft:cooked_salmon", "minecraft:slime_ball", "minecraft:clay_ball",
    "minecraft:prismarine_shard", "minecraft:heart_of_the_sea",
  ]),
  min: z.number().int().min(1).max(64),
  max: z.number().int().min(1).max(64),
}).superRefine((item, context) => {
  if (item.min > item.max) context.addIssue({ code: "custom", path: ["max"], message: "Reward item min must not exceed max" })
})

const RewardEffectSchema = z.strictObject({
  effect: z.enum(["slowness", "blindness", "poison", "weakness"]),
  duration_ticks: z.number().int().min(1).max(2400),
  amplifier: z.number().int().min(0).max(4),
})

const OutcomeSchema = z.strictObject({
  weight: z.number().int().min(1).max(100),
  items: z.array(RewardItemSchema).max(8),
  effects: z.array(RewardEffectSchema).max(4),
}).superRefine((outcome, context) => {
  if (outcome.items.length === 0 && outcome.effects.length === 0)
    context.addIssue({ code: "custom", message: "Lucky outcome must contain an item or effect" })
  const effects = outcome.effects.map((effect) => effect.effect)
  if (new Set(effects).size !== effects.length)
    context.addIssue({ code: "custom", path: ["effects"], message: "Lucky outcome effects must be unique" })
})

export const LuckyCacheSchema = z.strictObject({
  max_stack: z.number().int().min(1).max(64),
  outcomes: z.array(OutcomeSchema).min(1).max(32),
}).superRefine((lucky, context) => {
  if (lucky.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0) !== 100)
    context.addIssue({ code: "custom", path: ["outcomes"], message: "Lucky outcome weights must total 100" })
})

export type LuckyCache = z.infer<typeof LuckyCacheSchema>

export const DeathDropSchema = z.strictObject({
  block_identifier: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/),
  chance: z.number().finite().min(0).max(1),
})

export type DeathDrop = z.infer<typeof DeathDropSchema>
