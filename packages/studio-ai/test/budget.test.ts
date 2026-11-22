import { expect, test } from "bun:test"
import { BUDGET_GUIDE, BUDGET_REFUSALS, budgetDeclared, budgetFaults, budgetLine, budgetNote, budgetPlain, DEFAULT_TIER, GEOMETRY_TIERS, overBudget, textureSizes, TIER_CEILING, TIER_UNUSED, tierBelow, tierFindings, tierUnanswered, tierUse } from "../src/budget"
import { ModelDesignSchema, type ModelDesign } from "../src/contracts"
import { SCRIPT_GUIDE, SCRIPT_LIMITS } from "../src/script"
import { SHEET_INSTRUCTIONS } from "../src/making"
import { designFixture } from "./fixture"

// Boxes in rows on as many bones as it takes, nothing in particular.
const many = (cubes: number, budget?: ModelDesign["budget"], per = 32): ModelDesign => {
  const base = designFixture()
  const cube = base.bones[0]!.cubes[0]!
  return {
    ...base,
    ...(budget === undefined ? {} : { budget }),
    bones: [...base.bones, ...Array.from({ length: Math.ceil((cubes - 1) / per) }, (_, bone) => ({ name: `part_${bone}`, parent: "root", pivot: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: Array.from({ length: Math.min(per, cubes - 1 - bone * per) }, (_, index) => ({ ...cube, name: `c${index}`, origin: [bone, index, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number] })) }))],
  }
}
const refused = (design: ModelDesign) => ModelDesignSchema.safeParse(design).error?.issues.map((issue) => issue.message) ?? []

test("不写档位就是原来的上限（只有一根骨骼的方块数放开到整个模型的数，broad3）；写出来的文档也和原来一样", () => {
  expect(DEFAULT_TIER).toBe("standard")
  expect(GEOMETRY_TIERS.standard).toMatchObject({ cubes: 256, bones: 64, bone_cubes: 256, texture: 256, animations: 16, keys: 60, total_keys: null })
  expect(SCRIPT_LIMITS).toMatchObject({ cubes: 256, bones: 64, bone_cubes: 256, texture: 256, animations: 16, channels: 64, keys: 60 })
  expect(textureSizes(undefined)).toEqual([64, 128, 256])
  // 第 1 步: the epic tier's texture is 1024.
  expect(TIER_CEILING).toMatchObject({ cubes: 1024, bones: 192, texture: 1024 })
  // An old document parses to itself: no tier appears in it.
  expect(ModelDesignSchema.parse(designFixture())).toEqual(designFixture())
  expect(ModelDesignSchema.parse(designFixture())).not.toHaveProperty("budget")
  expect(refused(many(256))).toEqual([])
  expect(refused({ ...many(4), budget: null })).toEqual([])
})

test("超出档位的文档原样退回：说清是哪一项、有多少、上限多少、多了多少，和往上一档怎么写", () => {
  expect(refused(many(300))).toEqual([overBudget("cubes", 300, undefined)])
  expect(overBudget("cubes", 300, undefined)).toBe(
    '方块超出了「普通」档的上限：有 300 个，这一档最多 256 个，多了 44 个。要么减到 256 个以内，要么改用「精细」档（budget 写 "fine"，方块最多 512 个），并在部件说明的 budget 里写明为什么需要这一档。多出来的不会被悄悄删掉：这份文档原样退回。',
  )
  expect(refused(many(300, "fine"))).toEqual([])
  expect(refused(many(765, "fine"))[0]).toContain('改用「最精细」档（budget 写 "finest"，方块最多 1024 个）')
  expect(refused(many(765, "finest"))).toEqual([])
  expect(refused(many(1100, "finest", 60))[0]).toContain("这已经是最高的一档，只能减到 1024 个以内。")
  // Bones, and a texture larger than the tier's, each by its own name.
  expect(refused(many(130, undefined, 1)).join()).toContain("骨骼超出了「普通」档的上限：有 130 根，这一档最多 64 根，多了 66 根")
  expect(refused({ ...designFixture(), texture_size: 512 }).join()).toContain("贴图超出了「普通」档的上限：有 512 像素见方")
  expect(refused({ ...designFixture(), texture_size: 512, budget: "fine" })).toEqual([])
  expect(budgetFaults(many(300)).map((fault) => [fault.limit, fault.count, fault.cap, fault.over])).toEqual([["cubes", 300, 256, 44]])
  // Every key of a higher tier is counted; the default tier counts none, as before.
  const full = (key: number) => ({ time: key / 2 })
  const keyed = (bones: number, budget?: ModelDesign["budget"]): ModelDesign => ({
    ...many(bones, budget, 1),
    animations: designFixture().animations.map((motion) => ({
      ...motion,
      length: 30,
      channels: Array.from({ length: bones - 1 }, (_, bone) => ({
        bone: `part_${bone}`,
        keyframes: Array.from({ length: 60 }, (_, key) => ({ ...full(key), rotation: [0, key, 0] as [number, number, number] })),
        position: Array.from({ length: 60 }, (_, key) => ({ ...full(key), position: [0, key, 0] as [number, number, number] })),
        scale: Array.from({ length: 60 }, (_, key) => ({ ...full(key), scale: [1, 1, 1] as [number, number, number] })),
      })),
    })),
  })
  const motions = designFixture().animations.length
  expect(budgetNote(keyed(61)).total_keys).toBe(motions * 60 * 180)
  expect(refused(keyed(61))).toEqual([])
  expect(motions * 99 * 180).toBeGreaterThan(GEOMETRY_TIERS.fine.total_keys)
  expect(refused(keyed(100, "fine"))).toEqual([overBudget("total_keys", motions * 99 * 180, "fine", "所有动作加起来")])
})

test("高一档要在部件说明里有理由；每次看图都说它有多少、这一档容多少、同屏估几个，并且明说游戏里没量过", () => {
  expect(budgetDeclared(many(4), null)).toBeNull()
  expect(budgetDeclared(many(4, "fine"), { budget: null })).toBe(BUDGET_REFUSALS.undeclared("fine"))
  expect(budgetDeclared(many(4, "finest"), { budget: { tier: "fine", reason: "很大", at_once: 1 } })).toBe(BUDGET_REFUSALS.mismatch("finest", "fine"))
  expect(budgetDeclared(many(4, "fine"), { budget: { tier: "fine", reason: "很大", at_once: 1 } })).toBeNull()
  // A sheet that asks for more than the model uses is no fault.
  expect(budgetDeclared(many(4), { budget: { tier: "finest", reason: "很大", at_once: 1 } })).toBeNull()
  const line = budgetLine(budgetNote(many(300, "fine")), { budget: { tier: "fine", reason: "它有三格高，玩家会绕着它打", at_once: 20 } })
  expect(line).toStartWith("几何预算：「精细」档（同屏只有几个、会被走近了看的东西）。这个模型有 300 个方块（上限 512）")
  expect(line).toContain("部件说明里选这一档的理由：它有三格高，玩家会绕着它打。")
  expect(line).toContain("同时会出现约 20 个，同屏一共约 6000 个方块——「精细」档是按同屏最多约 8 个来定的")
  expect(line).toEndWith("游戏里的帧数没有量过，要在游戏里看。")
  expect(budgetLine(budgetNote(many(4)))).toContain("部件说明里没有估")
  expect(budgetPlain(budgetNote(many(300, "fine")), { budget: { tier: "fine", reason: "很大", at_once: 2 } })).toBe("精细程度是「精细」档：300 个方块、11 根骨骼（这一档最多 512 个方块、128 根骨骼）；预计游戏里同时出现约 2 个。AI 选这一档的理由：很大。游戏里卡不卡没有量过，要进游戏看。")
  // Said wherever a maker is told how to make a model, and never as a target.
  for (const told of [SCRIPT_GUIDE, SHEET_INSTRUCTIONS]) expect(told).toContain(BUDGET_GUIDE)
  expect(BUDGET_GUIDE).toContain("档位不是指标")
})

test("选了高一档却没有用上：每次看图说用了这一档的百分之几；方块、骨骼和需要的贴图全在低一档以内，就要有个交代", () => {
  // What the first boss was: the fine tier for 46 boxes on 11 bones, a 512 texture whose faces fit on 256.
  const boss = { ...budgetNote({ ...many(46, "fine"), texture_size: 512 }), texture_needed: 256 }
  expect(boss).toMatchObject({ tier: "fine", cubes: 46, texture: 512 })
  expect(tierUse(boss)).toEqual({ cubes: 9, bones: Math.round((boss.bones * 100) / 128) })
  expect(tierBelow(boss)).toBe("standard")
  const sheet = { budget: { tier: "fine", reason: "分层的石头表面要 512 的贴图", at_once: 1 } }
  const line = budgetLine(boss, sheet)
  expect(line).toContain(`这一档用了：方块 9%、骨骼 ${tierUse(boss).bones}%，它的面排得下的最小贴图是 256×256。`)
  expect(line).toContain("选了「精细」档（最多 512 个方块、128 根骨骼、贴图 512），可是这个模型只有 46 个方块")
  expect(line).toContain("它所有的面排进 256×256 的贴图就够了（文档写的是 512×512，多出来的地方是空的：贴图再大，一个模型像素还是只对应一个贴图像素，表面不会更细）——全都在低一档「普通」（256 个方块、64 根骨骼、贴图 256）以内，高出来的这一档没有用上。")
  // A finding its maker has to answer, by the mechanics of every measured finding: lower the tier, use it, or say why in the sheet.
  const found = tierFindings(sheet, boss)
  expect(found).toHaveLength(1)
  expect(found[0]).toStartWith("几何预算：选了「精细」档")
  expect(found[0]).toContain(`把文档的 budget 改回 "standard"`)
  expect(found[0]).toContain(`{"what":"${TIER_UNUSED}","reason":"……"}`)
  expect(tierUnanswered(sheet, boss)).toEqual([expect.stringMatching(/^几何预算：选了「精细」档.+没有用上。$/)])
  // Answered in the sheet: no finding, and the reason is said with the fact, to the reviewer and to the person.
  const answered = { ...sheet, justified: [{ what: "Budget : Unused", reason: "下一版要加满身的碎石，先把档位定下" }] }
  expect(tierFindings(answered, boss)).toEqual([])
  expect(budgetLine(boss, answered)).toContain("高出来的这一档没有用上（部件说明里写了为什么留在这一档：下一版要加满身的碎石，先把档位定下）。")
  expect(budgetPlain(boss, answered)).toContain("这一档没有用上：低一档「普通」就放得下它——AI 说明了为什么留在这一档：下一版要加满身的碎石，先把档位定下。")
  // Using any one thing the tier adds is using it: more boxes, more bones, or faces that need the larger texture. No count is a target.
  expect(tierBelow({ ...boss, cubes: 257 })).toBeNull()
  expect(tierBelow({ ...boss, bones: 65 })).toBeNull()
  expect(tierBelow({ ...boss, texture_needed: 512 })).toBeNull()
  expect(tierFindings(null, budgetNote(many(300, "fine")))).toEqual([])
  // The default tier is never asked about, however small the model; the tier under the highest is the fine one.
  expect(tierBelow(budgetNote(many(4)))).toBeNull()
  expect(tierBelow({ ...boss, tier: "finest", cubes: 400, texture_needed: 512 })).toBe("fine")
  expect(tierBelow({ ...boss, tier: "finest", cubes: 513 })).toBeNull()
  expect(BUDGET_GUIDE).toContain("贴图不是越大越细：一个模型像素只对应一个贴图像素")
  expect(BUDGET_GUIDE).not.toMatch(/至少|不少于/)
})
