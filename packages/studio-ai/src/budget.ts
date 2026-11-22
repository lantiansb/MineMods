/**
 * How much geometry one model may carry, as named tiers. A hard ceiling shapes what can be made without
 * anyone having chosen it, so the ceiling is a choice: whoever makes a thing proposes a tier with a reason
 * (how large it is on the screen, how near it is seen, how many of it the game shows at once), the person
 * sees the tier and the reason, and a model that goes over its tier is refused in words that name the
 * limit and by how much. Nothing is ever cut down to fit.
 *
 * A tier is not a target. A model is accepted for how it looks, never for how many parts it has; a tier
 * only says how far it may go. No imports: the modelling service, the script sandbox and the app read it.
 *
 * Where the numbers come from (round 9):
 * - `standard` is exactly what every document was held to before tiers existed (256 cubes, 64 bones, 64
 *   cubes a bone, a 256 texture, 16 motions, 60 keys a track). A document that names no tier is `standard`.
 * - The higher tiers are what Studio's own pipeline was measured to carry, in the sandbox it is developed
 *   in, on a model made for the measuring (boxes of 1 to 6 pixels a side, every bone moving in three
 *   motions). At 512 cubes on 128 bones, and at 1024 cubes on 192 bones: a script runs in under half a
 *   second inside 8 MB; the document is 0.25 and 0.42 MB; its faces pack into a 512 texture (which holds
 *   about 1200 boxes of 4 pixels a side, 430 of 8) in a quarter and half a second; the standard takes
 *   about 1 and 5 seconds; measuring its three motions 2 and 5.5; the review's whole set of pictures is
 *   prepared in about 4.5 and 10 seconds and drawn (in software, with no graphics card) in 1.5 and 2.3
 *   times what the default tier's takes. What stood in the way before was found and moved: a texture
 *   never grew past 256, so a model of more than about 290 such boxes could not be drawn at all, and
 *   three measures did work for every box against every other that most pairs never needed.
 * - `total_keys`: a document of 34,000 keys is 1.3 MB and a script hands it back in well under a second;
 *   one of 180,000 (what the default tier's limits multiply out to) is 6.7 MB and takes three, past what
 *   a script may take or hand back. The higher tiers say a number that passes; the default tier keeps
 *   having none, as before.
 * - They are not what the game was measured to carry: nobody has measured frame cost in the game, and
 *   `copies` (how many of a thing of this tier are meant to be on the screen at once) is a rule of
 *   proportion, more parts for fewer of them, not a measurement.
 * - `bone_cubes` is each tier's `cubes` (broad3). The 64 a bone was inherited with the rest of the standard and no
 *   step of the pipeline, the review or the game costs anything per bone: every cost measured above grows with the
 *   cubes of the whole model, which the tier still holds. What the 64 did do was force a round part made at the
 *   model's own pixel (an ellipsoid of 9 by 5 by 10 pixels is 79 boxes, a head of 9 by 8 by 8 is 107) to be sampled
 *   two or three pixels a cell, and a part that coarse reads as square: both round models of broad3 w4 were made
 *   that way and the blind player gave both 2 of 5 for round.
 * - `texture` follows from `cubes`: every face has its own place on the texture, one texel to a model
 *   pixel, so more boxes need a larger texture whatever is painted on them. 1024 was not offered while every
 *   script had two seconds (a canvas of 512 takes about one); 第 1 步 gives the epic tier 1024 and its scripts
 *   `script_seconds`, and a script's own canvas stays at most 512 (`SCRIPT_LIMITS.canvas`).
 */

export type GeometryBudget = {
  /** The person's word for the tier. */
  name: string
  /** What it is for, in a few plain words. */
  use: string
  cubes: number
  bones: number
  /** Cubes on one bone. */
  bone_cubes: number
  /** The largest texture, in pixels a side. */
  texture: number
  /** Motions one model carries. */
  animations: number
  /** Keys on one track of one bone in one motion. */
  keys: number
  /**
   * Keys in the whole model: every motion, every bone, every track. Null: not counted, as before tiers (64 bones ×
   * 3 tracks × 60 keys × 16 motions is 184,320 keys, a document of 6.7 MB that a script cannot hand back; the
   * script's own output limit refuses it in words). The higher tiers say the number that was measured to pass.
   */
  total_keys: number | null
  /** How many of a thing of this tier are meant to be on the screen at once; null: as many as the game spawns. Not measured. */
  copies: number | null
  /**
   * 第 1 步: whether a cube face may carry its own pixels (`pixels` of a cube; a script's `draw` canvas is kept pixel for pixel instead of being
   * cut into at most 64 rectangles). The two highest tiers allow hand-painted faces.
   */
  face_pixels: boolean
  /**
   * 第 1 步: seconds a model script of this tier may run in the sandbox. A 1024 atlas painted pixel by pixel does not finish in the 2 seconds a
   * standard script has; the memory limit stays the same for every tier, so a longer clock costs time and nothing else.
   */
  script_seconds: number
}

export const GEOMETRY_TIERS = {
  standard: { name: "普通", use: "成群出现的、常见的东西", cubes: 256, bones: 64, bone_cubes: 256, texture: 256, animations: 16, keys: 60, total_keys: null, copies: null, face_pixels: false, script_seconds: 2 },
  fine: { name: "精细", use: "同屏只有几个、会被走近了看的东西", cubes: 512, bones: 128, bone_cubes: 512, texture: 512, animations: 16, keys: 60, total_keys: 40_000, copies: 8, face_pixels: false, script_seconds: 3 },
  finest: { name: "最精细", use: "同屏只有一两个、整场战斗都盯着看的东西", cubes: 1024, bones: 192, bone_cubes: 1024, texture: 512, animations: 16, keys: 60, total_keys: 40_000, copies: 2, face_pixels: true, script_seconds: 4 },
  // 10-12 (epic tier, docs/specs/2026-10-12-epic-tier-flight.md): the 最精细 measures but twice the motions, for a creature that
  // walks, flies, rests, hunts and fights. Measured in the development sandbox: 32 motions on 150 bones, 43,200 keys in all, is a document of
  // 3.0 MB that a script hands back in 107 ms, under the script's 4 MB and 2 seconds; the same with 60,000 keys passes 4 MB and is refused
  // whole, so the keys of the whole model stay as 最精细's.
  // A 1024 texture so a boss nine blocks tall can keep one texel per model pixel, and six
  // seconds for its script to paint it.
  epic: { name: "史诗", use: "整个模组只有一只、超巨型、全程被盯着看、要飞要有习性的终极生物", cubes: 1024, bones: 192, bone_cubes: 1024, texture: 1024, animations: 32, keys: 60, total_keys: 40_000, copies: 1, face_pixels: true, script_seconds: 6 },
} as const satisfies Record<string, GeometryBudget>

export type GeometryTier = keyof typeof GEOMETRY_TIERS
export const GEOMETRY_TIER_IDS = Object.keys(GEOMETRY_TIERS) as [GeometryTier, ...GeometryTier[]]
/** The tier of a document that names none: what every document was held to before there were tiers. */
export const DEFAULT_TIER: GeometryTier = "standard"
export const tierOf = (tier: GeometryTier | null | undefined): GeometryBudget => GEOMETRY_TIERS[tier ?? DEFAULT_TIER]
/** Whether a word is a tier's id. A part sheet writes the tier as a word (a sheet's shape lists no vocabulary of any kind) and it is held to this. */
export const isTier = (value: unknown): value is GeometryTier => GEOMETRY_TIER_IDS.some((id) => id === value)
/** The tier a word names; the default for anything else. */
export const tierNamed = (value: unknown): GeometryTier => (isTier(value) ? value : DEFAULT_TIER)

/** The most any tier allows of each thing: what a schema's own array bounds are set to, so the tier's refusal is the one that speaks. */
export const TIER_CEILING = (Object.keys(GEOMETRY_TIERS.standard) as (keyof GeometryBudget)[])
  .filter((key) => typeof GEOMETRY_TIERS.standard[key] === "number" && key !== "script_seconds")
  .reduce((most, key) => ({ ...most, [key]: Math.max(...Object.values(GEOMETRY_TIERS).map((tier) => (tier[key] as number | null) ?? 0)) }), {} as Record<"cubes" | "bones" | "bone_cubes" | "texture" | "animations" | "keys" | "total_keys", number>)

/** The texture sizes a model may have, smallest first. A model is given the smallest its faces fit, up to its tier's. 1024: the epic tier only (第 1 步). */
export const TEXTURE_SIZES = [64, 128, 256, 512, 1024] as const
/** The largest texture any tier had before 1024 (第 1 步): what a model's `texel_size` is measured against unless the model itself is 1024 (`contracts.ts`), so no saved model stops being valid. */
export const LEGACY_TEXTURE = 512
export type TextureSize = (typeof TEXTURE_SIZES)[number]
export const textureSizes = (tier: GeometryTier | null | undefined) => TEXTURE_SIZES.filter((size) => size <= tierOf(tier).texture)

/**
 * The tier a model script asks for, read from its source before it runs (`budget: "epic"` in its `api.model`): what its clock is set by
 * (`script_seconds`). Only the clock: what the document may hold is still its own `budget`'s, checked after it runs, so naming a tier
 * here buys a script nothing it could not have by asking for that tier.
 */
export function scriptTier(source: string): GeometryTier {
  const named = [...source.matchAll(/budget\s*:\s*["'`](\w+)["'`]/g)].map((match) => match[1]).filter(isTier)
  return named.reduce<GeometryTier>((most, tier) => (GEOMETRY_TIER_IDS.indexOf(tier) > GEOMETRY_TIER_IDS.indexOf(most) ? tier : most), DEFAULT_TIER)
}

/** The part of a model document a budget is counted on. Structural, so nothing here imports a schema. */
type Counted = {
  texture_size?: number
  budget?: GeometryTier | null
  bones: readonly { name: string; cubes: readonly unknown[] }[]
  animations?: readonly { name: string; channels: readonly { bone: string; keyframes: readonly unknown[]; position?: readonly unknown[] | null; scale?: readonly unknown[] | null }[] }[]
}

/** What a tier limits, with the person's word for each and the unit it is counted in. */
export const BUDGET_LIMITS = {
  cubes: { name: "方块", unit: "个" },
  bones: { name: "骨骼", unit: "根" },
  bone_cubes: { name: "一根骨骼上的方块", unit: "个" },
  texture: { name: "贴图", unit: "像素见方" },
  animations: { name: "动作", unit: "个" },
  keys: { name: "一条轨道上的关键帧", unit: "个" },
  total_keys: { name: "整个模型的关键帧", unit: "个" },
} as const
export type BudgetLimit = keyof typeof BUDGET_LIMITS

/** What a model has of each limited thing; for the two that are "the most on any one", which one it is. */
export function budgetCounts(design: Counted) {
  const fullest = design.bones.reduce<{ name: string; count: number }>((most, bone) => (bone.cubes.length > most.count ? { name: bone.name, count: bone.cubes.length } : most), { name: "", count: 0 })
  const longest = (design.animations ?? [])
    .flatMap((motion) => motion.channels.flatMap((channel) => [["rotation", channel.keyframes], ["position", channel.position ?? []], ["scale", channel.scale ?? []]].map(([track, keys]) => ({ where: `动作 ${motion.name} 里骨骼 ${channel.bone} 的 ${track as string} 轨道`, count: (keys as readonly unknown[]).length }))))
    .reduce((most, track) => (track.count > most.count ? track : most), { where: "", count: 0 })
  return {
    cubes: { count: design.bones.reduce((sum, bone) => sum + bone.cubes.length, 0), where: "" },
    bones: { count: design.bones.length, where: "" },
    bone_cubes: { count: fullest.count, where: fullest.name ? `骨骼 ${fullest.name}` : "" },
    texture: { count: design.texture_size ?? 0, where: "" },
    animations: { count: design.animations?.length ?? 0, where: "" },
    keys: { count: longest.count, where: longest.where },
    total_keys: { count: (design.animations ?? []).reduce((sum, motion) => sum + motion.channels.reduce((keys, channel) => keys + channel.keyframes.length + (channel.position?.length ?? 0) + (channel.scale?.length ?? 0), 0), 0), where: "所有动作加起来" },
  } satisfies Record<BudgetLimit, { count: number; where: string }>
}

/** The tiers above one, lowest first. */
const above = (tier: GeometryTier) => GEOMETRY_TIER_IDS.slice(GEOMETRY_TIER_IDS.indexOf(tier) + 1)

/**
 * One limit crossed, in the words its author is given: which limit, what the model has, what the tier
 * allows, by how much it is over, and the two ways on (fewer, or a higher tier with a reason).
 */
export function overBudget(limit: BudgetLimit, count: number, tier: GeometryTier | null | undefined, where = "") {
  const id = tier ?? DEFAULT_TIER
  // A limit a tier does not have (null) is never crossed; this is only called for one that was.
  const cap = GEOMETRY_TIERS[id][limit] ?? Infinity
  const words = BUDGET_LIMITS[limit]
  const allows = (other: GeometryTier) => GEOMETRY_TIERS[other][limit] ?? Infinity
  const enough = above(id).find((other) => allows(other) >= count)
  const higher = above(id).find((other) => allows(other) > cap)
  const more = enough ?? higher
  return (
    `${words.name}超出了「${GEOMETRY_TIERS[id].name}」档的上限：${where ? `${where}有` : "有"} ${count} ${words.unit}，这一档最多 ${cap} ${words.unit}，多了 ${count - cap} ${words.unit}。` +
    (more
      ? `要么减到 ${cap} ${words.unit}以内，要么改用「${GEOMETRY_TIERS[more].name}」档（budget 写 "${more}"，${words.name}最多 ${allows(more)} ${words.unit}${enough ? "" : "，还是不够，仍然要减"}），并在部件说明的 budget 里写明为什么需要这一档。`
      : `这已经是最高的一档，只能减到 ${cap} ${words.unit}以内。`) +
    "多出来的不会被悄悄删掉：这份文档原样退回。"
  )
}

/** Every limit of its tier a model crosses, each as `overBudget` says it. Empty when it is within its tier. */
export function budgetFaults(design: Counted) {
  const counts = budgetCounts(design)
  const tier = tierOf(design.budget)
  return (Object.keys(BUDGET_LIMITS) as BudgetLimit[]).flatMap((limit) => {
    const cap = tier[limit]
    return cap !== null && counts[limit].count > cap ? [{ limit, count: counts[limit].count, cap, over: counts[limit].count - cap, words: overBudget(limit, counts[limit].count, design.budget, counts[limit].where) }] : []
  })
}

/** What a part sheet says of the budget: the tier asked for, why, and how many of the thing the game is expected to show at once. Structural. */
export type SheetBudget = { tier: string; reason: string; at_once: number }

/** Refusals about the tier itself, where the document and the sheet do not say the same thing. */
export const BUDGET_REFUSALS = {
  undeclared: (tier: GeometryTier) =>
    `这个模型按「${GEOMETRY_TIERS[tier].name}」档做的（文档的 budget 是 "${tier}"），可是部件说明里没有写为什么需要这一档。先在部件说明的 budget 里写上 {"tier":"${tier}","reason":"……","at_once":同屏大概会出现几个}：理由会原样给人看，由人决定值不值。不需要这么多的话，把文档的 budget 去掉，按「${GEOMETRY_TIERS[DEFAULT_TIER].name}」档做。`,
  mismatch: (document: GeometryTier, sheet: GeometryTier) =>
    `部件说明里定的是「${GEOMETRY_TIERS[sheet].name}」档，这个模型的文档写的是「${GEOMETRY_TIERS[document].name}」档（budget "${document}"）。两处要一致：改文档的 budget，或者改部件说明里的 budget 和理由。`,
} as const

/** Why a model's tier does not stand as its sheet has it, or null. A model of the default tier needs no word from the sheet. */
export function budgetDeclared(design: Pick<Counted, "budget">, sheet: { budget?: SheetBudget | null } | null | undefined) {
  const tier = design.budget ?? DEFAULT_TIER
  if (GEOMETRY_TIER_IDS.indexOf(tier) <= GEOMETRY_TIER_IDS.indexOf(tierNamed(sheet?.budget?.tier))) return null
  return sheet?.budget ? BUDGET_REFUSALS.mismatch(tier, tierNamed(sheet.budget.tier)) : BUDGET_REFUSALS.undeclared(tier)
}

/**
 * What was counted on one version of a model against its tier: numbers only, kept with the round it was looked at in.
 * `texture_needed` (round 10): the smallest texture its faces fit on, which is all a texture's size decides (one texel
 * to a model pixel). Absent in notes from before it was measured, and when the faces fit on none.
 */
export type BudgetNote = { tier: GeometryTier; cubes: number; bones: number; texture: number; animations: number; keys: number; total_keys: number; texture_needed?: number }
export const budgetNote = (design: Counted): BudgetNote => ((counts) => ({ tier: design.budget ?? DEFAULT_TIER, cubes: counts.cubes.count, bones: counts.bones.count, texture: counts.texture.count, animations: counts.animations.count, keys: counts.keys.count, total_keys: counts.total_keys.count }))(budgetCounts(design))

// ---- round 10: a tier that was asked for and is not used ----

/** The name a sheet's `justified` answers an unused tier by. */
export const TIER_UNUSED = "budget:unused"
const said = (what: string) => what.trim().toLowerCase().replace(/\s+/g, "").replace("：", ":")
type Justifying = { budget?: SheetBudget | null; justified?: readonly { what: string; reason: string }[] | null } | null | undefined
/** Why a sheet says the tier stays although the model does not use it, or null. */
export const tierReason = (sheet: Justifying) => sheet?.justified?.find((value) => said(value.what) === TIER_UNUSED)?.reason ?? null

/** How much of its tier a model uses, as whole percentages of the two things a tier is chosen for. */
export const tierUse = (note: BudgetNote) => ({ cubes: Math.round((note.cubes * 100) / GEOMETRY_TIERS[note.tier].cubes), bones: Math.round((note.bones * 100) / GEOMETRY_TIERS[note.tier].bones) })

/**
 * The tier below the one a model names, when everything a tier is chosen for — its boxes, its bones, the
 * texture its faces need, its keys — would fit there too: the higher tier was asked for and nothing of it is
 * used. Null for the default tier and for a model that goes past the tier below in anything. No count is a
 * target: a model is never asked to have more, only to say the tier it has.
 */
export function tierBelow(note: BudgetNote): GeometryTier | null {
  const below = GEOMETRY_TIER_IDS[GEOMETRY_TIER_IDS.indexOf(note.tier) - 1]
  if (!below) return null
  const lower = GEOMETRY_TIERS[below]
  return note.cubes <= lower.cubes && note.bones <= lower.bones && (note.texture_needed ?? note.texture) <= lower.texture && note.animations <= lower.animations && (lower.total_keys === null || note.total_keys <= lower.total_keys) ? below : null
}

/** That fact in a sentence, numbers and all; empty when the tier is used or is the default. */
export function tierUnusedLine(note: BudgetNote) {
  const below = tierBelow(note)
  if (!below) return ""
  const tier = GEOMETRY_TIERS[note.tier]
  const lower = GEOMETRY_TIERS[below]
  return (
    `选了「${tier.name}」档（最多 ${tier.cubes} 个方块、${tier.bones} 根骨骼、贴图 ${tier.texture}），可是这个模型只有 ${note.cubes} 个方块、${note.bones} 根骨骼` +
    (note.texture_needed ? `，它所有的面排进 ${note.texture_needed}×${note.texture_needed} 的贴图就够了${note.texture > note.texture_needed ? `（文档写的是 ${note.texture}×${note.texture}，多出来的地方是空的：贴图再大，一个模型像素还是只对应一个贴图像素，表面不会更细）` : ""}` : "") +
    `——全都在低一档「${lower.name}」（${lower.cubes} 个方块、${lower.bones} 根骨骼、贴图 ${lower.texture}）以内，高出来的这一档没有用上`
  )
}

/** An unused tier the sheet does not answer, as the sentence the person reads. Empty when there is none. */
export const tierUnanswered = (sheet: Justifying, note: BudgetNote | null | undefined) => (note && tierBelow(note) && tierReason(sheet) === null ? [`几何预算：${tierUnusedLine(note)}。`] : [])

/**
 * The same as a finding for the maker, like every measured finding: lower the tier, make what the tier was
 * asked for, or say in the sheet why it stays. Not one of the standard's hard faults: the version is kept.
 */
export const tierFindings = (sheet: Justifying, note: BudgetNote | null | undefined) =>
  tierUnanswered(sheet, note).map(
    (line) =>
      `${line.slice(0, -1)}。把文档的 budget 改回 "${tierBelow(note!)}"（部件说明里的 budget 跟着改或者去掉），或者把选这一档时写的理由真的做出来，再看一版；如果确实要留在这一档，在部件说明的 justified 里写上这一项和理由（{"what":"${TIER_UNUSED}","reason":"……"}），理由会原样给评审和人看。`,
  )

/**
 * The budget in one sentence, said with every look of a model: what it has against what its tier allows,
 * and how many of it the game is expected to show at once. A fact; what follows from it is for whoever looks.
 */
export function budgetLine(note: BudgetNote, sheet: Justifying = null) {
  const tier = GEOMETRY_TIERS[note.tier]
  const asked = sheet?.budget ?? null
  const many = asked?.at_once ?? null
  const use = tierUse(note)
  const unused = tierUnusedLine(note)
  const kept = tierReason(sheet)
  return (
    `几何预算：「${tier.name}」档（${tier.use}）。这个模型有 ${note.cubes} 个方块（上限 ${tier.cubes}）、${note.bones} 根骨骼（上限 ${tier.bones}）、贴图 ${note.texture}×${note.texture}（上限 ${tier.texture}）、${note.animations} 个动作（上限 ${tier.animations}）、一条轨道最多 ${note.keys} 个关键帧（上限 ${tier.keys}）${tier.total_keys === null ? "" : `、一共 ${note.total_keys} 个关键帧（上限 ${tier.total_keys}）`}。` +
    // Round 10: how much of the chosen tier is used, and when none of what it adds is.
    `这一档用了：方块 ${use.cubes}%、骨骼 ${use.bones}%${note.texture_needed ? `，它的面排得下的最小贴图是 ${note.texture_needed}×${note.texture_needed}` : ""}。` +
    (unused ? `${unused}${kept === null ? "" : `（部件说明里写了为什么留在这一档：${kept}）`}。` : "") +
    (asked ? `部件说明里选这一档的理由：${asked.reason}。` : "") +
    (many === null
      ? "游戏里同时会出现几个，部件说明里没有估（budget 的 at_once）。"
      : `部件说明估计游戏里同时会出现约 ${many} 个，同屏一共约 ${many * note.cubes} 个方块${tier.copies !== null && many > tier.copies ? `——「${tier.name}」档是按同屏最多约 ${tier.copies} 个来定的，现在估的比它多：同屏多的东西用低一档更稳` : ""}。`) +
    "这些上限是 Studio 自己的制作流程量出来能承受的；游戏里的帧数没有量过，要在游戏里看。"
  )
}

/** The same for the person, in a sentence. */
export function budgetPlain(note: BudgetNote, sheet: Justifying = null) {
  const tier = GEOMETRY_TIERS[note.tier]
  const below = tierBelow(note)
  const kept = tierReason(sheet)
  return (
    `精细程度是「${tier.name}」档：${note.cubes} 个方块、${note.bones} 根骨骼（这一档最多 ${tier.cubes} 个方块、${tier.bones} 根骨骼）${sheet?.budget ? `；预计游戏里同时出现约 ${sheet.budget.at_once} 个。AI 选这一档的理由：${sheet.budget.reason}` : ""}。` +
    (below ? `这一档没有用上：低一档「${GEOMETRY_TIERS[below].name}」就放得下它${kept === null ? "" : `——AI 说明了为什么留在这一档：${kept}`}。` : "") +
    "游戏里卡不卡没有量过，要进游戏看。"
  )
}

/** Two sentences for whoever makes a model: what a tier is and how one is asked for. */
export const BUDGET_GUIDE =
  `模型的几何预算分档：${GEOMETRY_TIER_IDS.map((id) => `${id}（「${GEOMETRY_TIERS[id].name}」，${GEOMETRY_TIERS[id].use}：最多 ${GEOMETRY_TIERS[id].cubes} 个方块、${GEOMETRY_TIERS[id].bones} 根骨骼、贴图 ${GEOMETRY_TIERS[id].texture}）`).join("、")}；文档不写 budget 就是 ${DEFAULT_TIER}。档位不是指标：验收看的是做出来的样子，不数方块，够用的最低一档就是对的一档。` +
  `要用高一档，先在部件说明的 budget 里写 {"tier","reason","at_once"}——为什么需要（比如它很大、会被走近了看、整场战斗都盯着它）和游戏里同时大概会出现几个（同屏越多越该用低档），再在文档（或脚本的 api.model）里写同一个 budget；超出档位上限的文档会被原样退回，并说明是哪一项、多了多少，不会被悄悄删减；每次看图返回的 budget_facts 写着它现在有多少、这一档容多少、用了这一档的百分之几、同屏估了几个。` +
  `贴图不是越大越细：一个模型像素只对应一个贴图像素，贴图要多大只看所有的面排不排得下。选了高一档、做出来的方块、骨骼和需要的贴图却全在低一档以内，会作为量出来的事实出现在 findings 里：把档位改回去，或者把选这一档的理由真的做出来，或者在部件说明的 justified 里写明为什么留着（what 写 "${TIER_UNUSED}"），否则不能说做完。`
