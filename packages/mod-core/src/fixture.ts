import { z } from "zod"
import { ModelShapeSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import type { StandardOutline } from "@minemods/studio-ai/acceptance"
import { EFFECT_TEXTURE_REFUSAL, EFFECT_TEXTURE_SIZES, EFFECT_TIER } from "./effect"
import { tierOf } from "@minemods/studio-ai/budget"
import { modelBounds } from "./model-bounds"
import { FIXTURE_GLOWS } from "./arena"

/**
 * A fixture (场地物件, Boss 能力 12): a small model that stands on the ground of a boss's arena while its fight is on — a compass cart, a brazier, a shrine — with a motion
 * for when it is dark and one for when a player has lit it, and optionally glowing parts (its surface's glow features) that stay visible through the arena's fog.
 * Its model is written as an effect's is (`effect.ts`: the same bones, cubes, surface and motions, the effect's texture tier). Where it stands, how long it is held to be
 * lit and what it clears is the boss's (`boss.arena.fixtures`). No Node APIs: the app's window reads it too.
 */

/** How much a fixture may be: there are a handful in a fight, each a little larger than an effect may be. `clips`: its two motions and a spare. */
export const FIXTURE_LIMITS = { bones: 32, cubes: 96, clips: 4, size: { min: 0.5, max: 4 }, height: { min: 0.5, max: 6 } } as const

const Name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/)
const BLOCK = 16

export const FixturePlaySchema = z.strictObject({
  /** The motion it plays while it is dark (looped or held). */
  unlit: Name,
  ember: Name.optional(),
  /** The motion it plays from the moment it is lit until it goes dark (looped or held). */
  lit: Name,
  /** When its glowing parts are drawn at full brightness, through the fog too: only while lit, always, or never. */
  glow: z.enum(Object.keys(FIXTURE_GLOWS) as [keyof typeof FIXTURE_GLOWS, ...(keyof typeof FIXTURE_GLOWS)[]]),
})
export type FixturePlay = z.infer<typeof FixturePlaySchema>

export const FixtureDocumentSchema = z
  .strictObject({
    kind: z.literal("fixture"),
    name: ModelShapeSchema.shape.name,
    texture_size: z.union(EFFECT_TEXTURE_SIZES.map((size) => z.literal(size)), { error: EFFECT_TEXTURE_REFUSAL.replace("效果", "场地物件") }),
    texel_size: ModelShapeSchema.shape.texel_size,
    bones: ModelShapeSchema.shape.bones,
    animations: z.array(ModelShapeSchema.shape.animations.element).min(1).max(FIXTURE_LIMITS.clips),
    play: FixturePlaySchema,
  })
  .superRefine((document, context) => {
    const cubes = document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)
    if (document.bones.length > FIXTURE_LIMITS.bones) context.addIssue({ code: "custom", path: ["bones"], message: `一个场地物件最多 ${FIXTURE_LIMITS.bones} 根骨骼，这里有 ${document.bones.length} 根` })
    if (cubes > FIXTURE_LIMITS.cubes) context.addIssue({ code: "custom", path: ["bones"], message: `一个场地物件最多 ${FIXTURE_LIMITS.cubes} 个方块，这里有 ${cubes} 个` })
    for (const which of ["unlit", "lit", "ember"] as const)
      if (document.play[which] !== undefined && !document.animations.some((animation) => animation.name === document.play[which]))
        context.addIssue({ code: "custom", path: ["play", which], message: `play.${which} 写的是 ${document.play[which]}，可是这个物件自己的动作里没有它（有：${document.animations.map((animation) => animation.name).join("、")}）` })
    const parsed = ModelShapeSchema.safeParse(fixtureModel(document))
    if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue({ ...issue, path: ["design", ...issue.path] }))
  })
export type FixtureDocument = z.infer<typeof FixtureDocumentSchema>
type Shaped = Pick<FixtureDocument, "name" | "texture_size" | "texel_size" | "bones" | "animations">

/** A fixture's model in a model document's shape, for everything that draws or compiles one: its own bones and motions, nothing added. */
export function fixtureModel(document: Shaped): ModelDesign {
  return { name: document.name, texture_size: document.texture_size, ...(document.texel_size == null ? {} : { texel_size: document.texel_size }), bones: document.bones, animations: document.animations }
}

/** The name a fixture has in the generated mod's files and tables: its asset id without the dashes. */
export const fixtureName = (id: string) => `fixture_${id.replaceAll("-", "")}`

/**
 * The box a player's crosshair finds it by, in blocks: as wide as the model is across (the wider of its two sides) and as tall as it stands above the ground (its base plane),
 * within `FIXTURE_LIMITS`. The generated fixture's size is this.
 */
export function fixtureBox(document: Shaped) {
  const bounds = modelBounds(fixtureModel(document))
  const width = Math.max(bounds.max[0]! - bounds.min[0]!, bounds.max[2]! - bounds.min[2]!) / BLOCK
  const height = Math.max(0, bounds.max[1]!) / BLOCK
  const clamp = (value: number, range: { min: number; max: number }) => Number(Math.min(range.max, Math.max(range.min, value)).toFixed(3))
  return { width: clamp(width, FIXTURE_LIMITS.size), height: clamp(height, FIXTURE_LIMITS.height) }
}

/** The motions of a fixture nothing plays (the game plays only `play.unlit` and `play.lit`). */
export const fixtureUnplayed = (document: Pick<FixtureDocument, "animations" | "play">) => document.animations.filter((animation) => animation.name !== document.play.unlit && animation.name !== document.play.lit && animation.name !== document.play.ember).map((animation) => animation.name)

/** What was measured on one fixture, in sentences: said with every look at it. Never a refusal. */
export function fixtureLines(document: FixtureDocument) {
  const box = fixtureBox(document)
  const cubes = document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)
  const clip = (name: string) => document.animations.find((animation) => animation.name === name)
  const unplayed = fixtureUnplayed(document)
  return [
    `它在游戏里占 ${box.width}×${box.height} 格（宽×高）：玩家可以对准这一块点亮它。它有 ${cubes} 个方块（最多 ${FIXTURE_LIMITS.cubes} 个）。`,
    `没点亮时播「${document.play.unlit}」（${clip(document.play.unlit)?.loop ? "循环" : "播完停在最后"}），点亮时播「${document.play.lit}」（${clip(document.play.lit)?.loop ? "循环" : "播完停在最后"}）。${document.play.unlit === document.play.lit ? "两个写的是同一个动作：点亮前后看起来不会有变化，除非靠发光。" : ""}`,
    ...(document.play.ember ? [`余烬播「${document.play.ember}」，游戏中可见火星。`] : []),
    `发光的部分（表面 features 的 glow）${FIXTURE_GLOWS[document.play.glow]}；发光层有单独的绘制效果，远处能否辨认还取决于距离、大小和遮挡。`,
    ...(unplayed.length ? [`没有任何东西会播的动作：${unplayed.map((name) => `「${name}」`).join("、")}。游戏播放 play 指定的状态动作。`] : []),
  ]
}

export const FIXTURE_STANDARD: StandardOutline = {
  kind: "fixture",
  label: "场地物件",
  rules: [],
  unmeasured: {
    earns_place: "一个物件该有多少东西量不了；点亮前后看不看得出区别由人看图",
    not_mechanical: "它的动作节奏好不好量不了，对着逐帧图自己看",
    reads: "它像不像要表现的东西量不了，由人自己看",
    hierarchy: "不知道一个物件哪里该是重点，量不了主次",
    sound: "它站在 Boss 场地的地面上，站不站得住由摆放时找地面决定",
    fits: "它摆在哪里、清掉多大的雾，在看那只 Boss 的场地图时量，不在这里",
  },
  told: {
    earns_place: "它在游戏里占多大（玩家右键对着的那一块）、有几个方块",
    fits: "没点亮和点亮各播哪个动作，发光的部分什么时候亮",
  },
}

const largest = Math.max(...EFFECT_TEXTURE_SIZES)

/** What an AI is told about making a fixture. One text: the registry, the hand-off and the capability list read it. */
export const FIXTURE_INSTRUCTIONS =
  `场地物件是 Boss 场地上的一样小东西（指南车、火盆、石碑……）：Boss 醒来时摆在它家周围的地上，玩家可按住右键，或按 use.by 的设置用近战和归属玩家的箭点亮（那组不写 use 就点不亮，只跟着招式和演出亮），点亮的那一圈里没有雾；战斗结束就收走。它不是生物：没有血、打不坏、推不动、不存盘。摆在哪里、按多久、清掉多大的雾都写在 Boss 的 boss.arena.fixtures 里，这个文档只管它长什么样。` +
  ` 文档：{kind:"fixture", name, texture_size, texel_size, bones, animations, play}。name、texture_size、texel_size、bones、animations 和效果（effect）的写法完全一样（骨骼、方块、表面的 faces / paint / features，动作的轨道和插值都能用；按「${tierOf(EFFECT_TIER).name}」档算，texture_size 只能是 ${EFFECT_TEXTURE_SIZES.join("、")}，最大 ${largest}）；不需要 idle、walk、hurt。最多 ${FIXTURE_LIMITS.bones} 根骨骼、${FIXTURE_LIMITS.cubes} 个方块。原点 (0,0,0) 是它站的那块地面的中心，正面朝 -Z；模型从 y=0 往上做（低于 0 的部分埋在地里）。它在游戏里的大小（玩家右键对着的那一块）按模型量：宽取前后、左右较宽的一边，高取地面以上的高度，宽 ${FIXTURE_LIMITS.size.min}–${FIXTURE_LIMITS.size.max} 格、高 ${FIXTURE_LIMITS.height.min}–${FIXTURE_LIMITS.height.max} 格。` +
  ` play：{unlit, lit, ember?, glow}，ember 是余烬动作，省略时用 unlit 并显示火星。unlit 是没点亮时播的动作，lit 是点亮以后播的动作（两个都是它自己 animations 里的名字，做成循环的或者播完停住的都行；点亮前后要看得出区别：转起来、亮起来、升起来），glow 是发光的部分（表面 features 里的 glow）什么时候亮：${Object.entries(FIXTURE_GLOWS).map(([key, words]) => `${key}（${words}）`).join("、")}。发光层可弱化场地雾的遮挡，实际可辨距离还取决于距离、大小和遮挡。用目标版本检查玩家能否找到物件。` +
  ` 怎么看：对物件任务调用 look，会画出六个角度、没点亮、点亮和已指定的余烬动作逐帧图，并说出它在游戏里占多大。它被 Boss 用上以后，对那只 Boss 的任务调用 look，会画出场地的俯视图（家、物件、清晰区、战斗范围）。` +
  ` 怎么用：Boss 的 boss.arena.fixtures[].look 写 {"asset": "这个物件的资产 id"}，并让那只生物依赖它。`

export const FIXTURE_SUMMARY = `Boss 场地上的小物件（场地物件）：和效果一样的骨骼、方块、表面和动作（最多 ${FIXTURE_LIMITS.bones} 根骨骼、${FIXTURE_LIMITS.cubes} 个方块），加上 play——没点亮和点亮各播哪个动作、发光的部分什么时候亮。摆在哪里、怎么点亮、清掉多大的雾写在 Boss 的 boss.arena 里；右键或命中点亮，可播余烬动作，打不坏、不存盘。`
