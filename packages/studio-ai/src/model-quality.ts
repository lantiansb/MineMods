import type { ModelDesign } from "./contracts"
import { z } from "zod"
import { answerCraft, criterion, holdFor, judge, justifyTail, outlineOf, standardBrief, unreadable, type AssetReview, type Finding, type KindStandard, type ReviewContext, type Rule } from "./acceptance"
import { MOTION_MEASURES, measureLook, type LookMetrics, type LookTexture } from "./model-look"
import { FAULT_SLACK, SLACK_WORDS, STANDING_ABOVE } from "./model-motion"
import { TEXTURE_SPACE_ERROR, modelAtlas } from "./model-paint"
import { CONTINUITY_TOLD } from "./motion-continuity"
import { ANIMATION_GUIDE, CLIP_PLAY_GUIDE, channelTracks } from "./animation"
import { EPIC_MOTION_GUIDE } from "./motion-phrasing"
import { ORIENTATION_GUIDE } from "./orientation"
import { STRUCTURE_GUIDE } from "./structure-guide"
import { textureSizes } from "./budget"

export const ModelComplexitySchema = z.enum(["low", "medium", "high"])
export type ModelComplexity = z.infer<typeof ModelComplexitySchema>

// The tier sets how much detail to aim for. Only `minUniqueCubes` is ever enforced, and it is deliberately
// low: a model is accepted for how it looks, never for how many cubes it has, so nothing rewards padding.
export const MODEL_COMPLEXITY_PRESETS = {
  low: {
    label: "低",
    minUniqueCubes: 3,
    minSizeClasses: 1,
    targetMinCubes: 4,
    targetMaxCubes: 12,
  },
  medium: {
    label: "中",
    minUniqueCubes: 4,
    minSizeClasses: 1,
    targetMinCubes: 8,
    targetMaxCubes: 28,
  },
  high: {
    label: "高",
    minUniqueCubes: 5,
    minSizeClasses: 1,
    targetMinCubes: 16,
    targetMaxCubes: 64,
  },
} as const satisfies Record<ModelComplexity, {
  label: string
  minUniqueCubes: number
  minSizeClasses: number
  targetMinCubes: number
  targetMaxCubes: number
}>

export function modelComplexityInstructions(level: ModelComplexity): string {
  const complexity = ModelComplexitySchema.parse(level)
  const preset = MODEL_COMPLEXITY_PRESETS[complexity]
  return `复杂度档位：${preset.label}（${complexity}）。这一档通常用 ${preset.targetMinCubes}–${preset.targetMaxCubes} 个体块${complexity === "high" ? "（这是普通生物的范围；Boss 和史诗档的模型不按它，按任务里「Boss 和史诗档的模型」那一段的量级）" : ""}，这只是参考范围，不是指标：验收看的是做出来像不像一只能进游戏的生物，不数方块。少而准的体块比堆出来的数量好；“${criterion("earns_place").name}”那一条照样检查（${MODEL_STANDARD.rules.filter((rule) => rule.criterion === "earns_place").map((rule) => rule.asks).join("；")}）。最低只要求至少 ${preset.minUniqueCubes} 个看得见的体块，并且 idle、walk、hurt 里有作用于实际几何的真实角度变化。`
}

/**
 * The two ways to put a surface on a model, neither the default: paint it face by face, or name a material
 * and features and let Studio paint. Whoever makes it looks at the render either way. Ends with a syntax example.
 */
export const MODEL_PAINT_GUIDE =
  "表面有两种画法，哪一种都可以，也可以混着用，没有默认的那一种；不管怎么画，都要看渲染图确认画出来的是你部件说明里写的样子。" +
  "第一种是自己画：faces 给每个面定底色，surface_details 在面上画一个个像素矩形，五官、纹样、明暗、磨损都可以这样一块一块画出来。" +
  "第二种是让 Studio 代画：给骨骼或方块写 paint，Studio 会按材质画出两三个深浅成块的像素质感，并自动做顶面亮、侧面中、底面暗的明暗和接缝处的深色边；同一个方块名每次画出来都一样。" +
  "paint = { material, base, secondary }。material 只能是 skin（皮肤）、fur（毛）、feather（羽毛）、scales（鳞）、shell（甲壳）、stone（石头）、crystal（晶体）、metal（金属）、wood（木头）、cloth（布）、bone（骨、角、牙、喙）、slime（凝胶）、leaf（叶子）、leather（皮革）之一；base 是底色，secondary 是可选的第二种颜色（会成块地混在里面），不要就写 null；wear 是 0–1 的磨损程度（只在 shading 写 \"rich\" 时起作用，不写是 0.35：金属的划痕和锈、石头的缺口和污垢、布的脏边、皮革的磨白、骨头两头发黄），不要就写 null。" +
  "写在骨骼上的 paint 会传给这根骨骼和它下面所有骨骼的方块，方块自己写了 paint 就用自己的；所以通常只在身体骨骼上写一次主材质，再给角、爪、晶体、衣服这些不同材质的方块单独写。写了 paint 的方块，faces 六个面仍要填（都填成 base 即可），它只在旧工具里当后备。" +
  // 第 1 步: rich shading and a face's own pixels, what a hand-painted boss has.
  "整个模型可以写 shading: \"rich\"（不写或 null 是原来的画法）：每个面按朝向分明暗，侧面从上到下由亮到暗，上沿和左沿亮、下沿和右沿暗（像倒了角），贴着别的部件的地方压暗一道（接缝），再加上材质自己的纹理和磨损；没写 paint 的方块也按它 faces 的底色这样画。Boss 和史诗档的模型都应当写上它。" +
  "「最精细」「史诗」档还可以给方块的面写 pixels，一个像素一个像素地手画：pixels = { north: { palette: [\"#RRGGBB\", …最多 256 种], data: [调色板编号, …] } }，data 按这个面从左到右、从上到下排（和 surface_details 的 x、y 一样），个数正好是面的宽×高（texel_size 大于 1 时按贴图像素算）；写了 pixels 的面就画成这样，不再按 paint 代画；整个模型的 pixels 加起来最多 400000 个。脸、纹章、符文、伤疤这些要紧的面用它画，其余交给 paint 和 rich。" +
  "features 写在方块上，按意思摆放而不是按像素：type 可以是 eyes（眼睛）、brows（眉）、mouth（嘴）、nose（鼻）、belly（肚皮或浅色斑块）、stripes（条纹）、spots（斑点）、cracks（裂纹）、veins（发光纹路）、band（腰带、镶边、环）、claws（爪尖）、gem（宝石）。" +
  "每个 feature 的字段：face（画在哪个面：north 是正面，west 是它自己的左侧，east 是它自己的右侧，up 是顶，down 是底，sides 是四周，all 是全部；不写就用这种 feature 的常用面，例如 eyes 画在 north，belly 画在 down，stripes 绕着背和两侧）；shape（eyes: dot/wide/tall/square/slit；mouth: line/smile/frown/open/fangs/teeth；nose: dot/snout；brows: flat/angry/sad；stripes: bands/long；band: ring/frame；gem: diamond/square）；color 主色，color2 副色（眼睛的瞳孔、嘴里的牙）；x、y 是 0–1 的位置（y 从上到下；成对的眼睛 x 是离中线多远，0 贴着中线、1 贴着边；其它是从左到右或从前到后）；size 是像素大小或粗细；count 是数量；glow 让眼睛或纹路发亮（游戏里发亮的格子按它们自己的颜色全亮显示，不带光晕，所以 glow 的 color 要选明亮鲜艳的颜色；深色的格子发亮后和不发亮差不多）；mirror 是否左右成对（眼睛和眉默认成对）。用不到的字段写 null。" +
  "眼睛一定要和周围对比明显：浅色的眼白配深色瞳孔，或者深色皮肤上用发亮的眼睛。眉毛和眼睛用同样的 x、y、size，它会自动画在眼睛上沿。features 表达不了、或者画出来不是你要的样子时，就用 surface_details 自己画。" +
  // The tail is a syntax skeleton and nothing else (OnlyLLM, 10-14): neutral placeholder names and colours, no subject. An example with a real subject
  // in it (which parts, which shapes, which colours) is a template the maker copies; what the thing is, is in the part sheet and the pictures.
  'paint 和 features 的字段写法（只示范 JSON 的形状：尖括号里的是占位，换成你自己部件说明里写的；名字、数量、形状、颜色全部由你的部件说明决定）：{"name":"<bone>","parent":"<parent bone>","pivot":[0,0,0],"rotation":[0,0,0],"paint":{"material":"<material>","base":"<#RRGGBB>","secondary":null},"cubes":[' +
  '{"name":"part_a","origin":[0,0,0],"size":[1,1,1],"faces":{"north":"<#RRGGBB>","east":"<#RRGGBB>","south":"<#RRGGBB>","west":"<#RRGGBB>","up":"<#RRGGBB>","down":"<#RRGGBB>"},"surface_details":[],"paint":null,"features":[' +
  '{"type":"<feature>","face":null,"shape":null,"color":"<#RRGGBB>","color2":null,"x":null,"y":null,"size":null,"count":null,"glow":null,"mirror":null}]},' +
  '{"name":"part_b","origin":[0,0,0],"size":[1,1,1],"faces":{"north":"<#RRGGBB>","east":"<#RRGGBB>","south":"<#RRGGBB>","west":"<#RRGGBB>","up":"<#RRGGBB>","down":"<#RRGGBB>"},"surface_details":[],"paint":{"material":"<material>","base":"<#RRGGBB>","secondary":null},"features":null}]}。'

/** The numbers behind a look review, rounded for display. */
export type LookSummary = {
  plan: LookMetrics["plan"]
  visibleCubes: number
  buriedShare: number
  /** The part of it that is buried deep (`deepBuriedShare`); the rule reads this one. */
  deepBuriedShare: number
  tinyCubes: number
  floating: number
  tones: number
  flatShare: number
  sameFillShare: number
  speckShare: number
  shadedShare: number
  eyes: boolean
}

// Thresholds of the model and texture rules, as data beside what they are compared with. Each sits between
// the accepted specimens and the rejected ones; the measured margin is written with it ("good" = the accepted
// specimen nearest the limit, "bad" = the rejected one nearest it) and the look-gate test fails if either side
// drifts across. Specimens are the files under test/fixtures/look and the spoiled ones in test/specimens.ts.
export const LOOK_LIMITS = {
  /**
   * Share of all cube volume inside other cubes that are in them beyond a joint (`deepBuriedShare`): pairs that would have to move further than
   * `FAULT_SLACK.joint` (2.5 pixels, more for a large model) to get clear of each other. Before 10-14 every overlap counted: good ≤ 0.087
   * (crystal-guardian), bad 0.246 (padded-pile), limit 0.2, which stopped a round on a wing root a pixel into the body. Now good ≤ 0.061
   * (crystal-guardian: its shoulders on its trunk, 3 pixels), bad 0.214 (padded-pile; it is also stopped by its mostly covered cubes, 9 of 37,
   * which are not joints either), the limit unchanged at 0.2 so that nothing that was a pile is let through, and the joints (lanjing-guard's
   * 0.132, dawn-owl's, bog-goblin's, dune-viper's 0.02–0.03: all of it joints) are left out. A cube lying whole in another (0.17 of the
   * guardian) and a cube covering most of the trunk (0.31) are measured in the model-quality test.
   */
  buriedShare: 0.2,
  /** Share of cubes mostly buried, counted once there are three. good 0, bad 9 of 37 = 0.24 (padded-pile). */
  buriedCubes: 0.2,
  /** One- and two-pixel cubes: more than this many and more than `tinyShare` of all cubes. good 0, bad 6 of 32 (lanjing-guard), 10 of 37 (padded-pile). */
  tinyCubes: 4,
  tinyShare: 0.15,
  /**
   * Pixels the lowest point may sit above y=0 where the model is built: `STANDING_ABOVE` (one pixel), the same number the clip measure uses to
   * decide that a model hovers (`hovering` in `motion-continuity.ts`) and the same that decides which unnamed parts are legs. good 0, bad 5
   * (lifted-guardian). Kept at one pixel, not widened with the rest of `FAULT_SLACK` (10-14): a model built clear of the ground by more than this
   * is taken to hover and is not asked to step (the `glide` gate), so every pixel allowed here is a pixel in which a walker can be built off
   * the ground and escape that gate. That is why there is one number: before 10-14 (audit) the clip measure used `CONTINUITY.touch`, a third of a
   * pixel, so a walker built 0.4 to 1 pixel up was standing to this rule and hovering to the gate. How far under y=0 it may sit is
   * `look.slack.ground` (2.5 or more), which has no such effect.
   */
  groundSlack: STANDING_ABOVE,
  /** Share of volume with no mirror image across x=0. good ≤ 0.01 (a serpent's coil, 0.35, is exempt), bad 0.33 (one-sided): the narrowest margin here. */
  lopsidedShare: 0.3,
  /** Head volume as a share of the whole, for creatures on legs. good 0.20–0.54, bad 0.018 (pin-head); no specimen above the upper end. */
  headShare: [0.03, 0.7],
  /** Leg height as a share of body height, for creatures on legs. good 0.26–0.38, bad 0.06 (stub-legs); no specimen above the upper end. */
  limbShare: [0.12, 0.8],
  /** Pixels a joint may sit away from the part it turns, and how far down a leg its joint may sit (0 top, 1 bottom). good 0 and ≤ 0.13, bad 23.4 away (loose-joint); a leg jointed at its foot is spoiled in the unit test. */
  jointGap: 3,
  limbJointDepth: 0.5,
  /** Distinct tones one can see. good ≥ 15 (sprout-slime), bad 3 (faceless-flat), 2 and 4 (the lanjing-guard and one-pattern textures). */
  tones: 5,
  /** Share of larger faces that are one flat colour. good ≤ 0.16 (bog-goblin), bad 0.93 (lanjing-guard), 1 (faceless-flat). */
  flatShare: 0.6,
  /** How far every face carries the model's overall mix of tones. good ≤ 0.49 (sprout-slime), bad 0.83 (one-pattern), 0.86 (noise-texture), 0.97 (lanjing-guard's texture). */
  sameFillShare: 0.7,
  /**
   * Share of texels that match none of their neighbours. good ≤ 0.054 (dune-viper), bad 0.158 (lanjing-guard's texture), 0.23 (speckled-guardian), 0.41 (noise-texture).
   * Two limits, because a texel that differs from all its neighbours is noise in a screenful and a deliberate point (a stud, a glint, a gem) in a few: up to `speckShare`
   * nothing is said; from there to `speckNoise` it is advice, since no number can tell a sparkled surface from a noisy one; beyond `speckNoise` the dots cannot be
   * accents any more (a point a person places is one of a few; 15 in every 100 texels is a pattern with no pattern). `speckNoise` sits just under the lowest rejected
   * specimen (0.158) and three times the highest accepted (0.054); a deliberately studded model in the tests (0.1–0.14) lies between and is only advised.
   */
  speckShare: 0.09,
  speckNoise: 0.15,
  /** Share of cubes whose top and sides differ in tone. good ≥ 0.8 (sprout-slime), bad 0 (faceless-flat, lanjing-guard's texture). */
  shadedShare: 0.4,
  /** Share of cubes carrying the very same hand-written detail. good 0, bad 0.81 (lanjing-guard). A cube made twice has no limit: one is too many (good 0, bad 1 in twin-horn). */
  copiedDetails: 0.6,
  /** Share of hand-written details nobody can see. good 0 (lanjing-guard's 0.16 is accepted on this count), bad 1 (covered-marks). */
  hiddenDetailShare: 0.4,
  /** Degrees a leg must swing in walk: what the measurement calls a stride. good ≥ 44 (dawn-owl), bad 0 (still-legs). */
  walkSwing: MOTION_MEASURES.swing,
  /** Degrees some part of a legless creature must move in walk. good ≥ 22.8 (sprout-slime), bad 0 (still-slider). */
  walkMove: MOTION_MEASURES.mover,
  /** Correlation of a left and a right leg: -1 opposite, +1 together. good -1, bad +1 (stiff-walker, hopping-pair). */
  walkPhase: -0.3,
  /** Degrees the busiest idle track spans. good 6–16, bad 0 (stiff-walker, frozen-idle) and 60 (thrashing-idle). */
  idleSpan: [0.5, 40],
  /** Seconds, and where in hurt its largest move falls (0 start, 1 end). good ≤ 0.5 s at 0.2, bad 2.5 s at 0.8 (stiff-walker), 3 s at 0.5 (slow-hurt). */
  hurtLength: 1,
  hurtPeakAt: 0.5,
  /** Degrees of the largest move in hurt. good ≥ 14 (crystal-guardian), bad 1 (numb-hurt). */
  hurtTurn: 3,
} as const

/** A channel that changes anything over its clip: turns, moves or scales. */
function channelChanges(channel: ModelDesign["animations"][number]["channels"][number]) {
  return Object.values(channelTracks(channel)).some((keys) => keys.slice(1).some((key) => key.value.some((value, axis) => value !== keys[0]!.value[axis])))
}

function transformSignature(boneName: string, bones: Map<string, ModelDesign["bones"][number]>) {
  const transforms: string[] = []
  let bone = bones.get(boneName)
  while (bone) {
    if (bone.rotation.some((value) => value !== 0))
      transforms.push(`${bone.pivot.join(",")}|${bone.rotation.join(",")}`)
    bone = bone.parent ? bones.get(bone.parent) : undefined
  }
  return transforms.reverse().join(";")
}

function geometryBones(design: ModelDesign) {
  const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
  const result = new Set(design.bones.filter((bone) => bone.cubes.length > 0).map((bone) => bone.name))
  design.bones.forEach((bone) => {
    let parent = bone.parent ? bones.get(bone.parent) : undefined
    while (parent) {
      if (result.has(bone.name)) result.add(parent.name)
      parent = parent.parent ? bones.get(parent.parent) : undefined
    }
  })
  return result
}

const some = (names: string[]) => `${names.slice(0, 4).join("、")}${names.length > 4 ? ` 等 ${names.length} 个` : ""}`
const round = (value: number) => Number(value.toFixed(3))
const percent = (value: number) => Math.round(value * 100)
const summary = (look: LookMetrics): LookSummary => ({
  plan: look.plan,
  visibleCubes: look.visibleCubes,
  buriedShare: round(look.buriedShare),
  deepBuriedShare: round(look.deepBuriedShare),
  tinyCubes: look.tinyCubes.length,
  floating: look.floating.length,
  tones: look.tones,
  flatShare: round(look.flatShare),
  sameFillShare: round(look.sameFillShare),
  speckShare: round(look.speckShare),
  shadedShare: round(look.shadedShare),
  eyes: look.eyes,
})

/** The atlas the model needs, or null when its faces fit no supported size. */
function fitted(design: ModelDesign) {
  // Up to the largest texture the model's own geometry tier allows (`budget.ts`): 256 for a model that names none, as before.
  const size = textureSizes(design.budget).filter((value) => value >= design.texture_size).find((value) => {
    try {
      modelAtlas({ ...design, texture_size: value })
      return true
    } catch {
      return false
    }
  })
  return size ? { ...design, texture_size: size } : null
}

/** What the rules read: the look of the model (or of the texture on it), what the tier asks for, and whether anything real is animated. */
type Measured = LookMetrics & { minCubes: number; animatedBones: number }
const L = LOOK_LIMITS
const legged = (look: Measured) => look.plan === "biped" || look.plan === "quadruped"
const badJoints = (look: Measured) => look.pivots.filter((pivot) => pivot.gap > L.jointGap || (pivot.limb && pivot.depth > L.limbJointDepth)).map((pivot) => pivot.bone)

/** Rules about the painted surface. They hold for a model's own paint (`own`) and for a standalone texture on a model alike. */
const surfaceRules = (own: boolean): Rule<Measured>[] => [
  {
    id: "same_fill",
    criterion: "not_mechanical",
    severity: "defect",
    asks: "不同部位用不同的颜色或材质，不能每个面都是同一种填法",
    find: (look) =>
      look.sameFillShare > L.sameFillShare
        ? { message: "几乎每个面都是同一种填法，身体、头、腿、角看起来全一样。", fix: `按部位区分：不同部位用不同的颜色或材质，顶面、侧面、底面的深浅也要不同；${own ? "给方块写 paint（材质 + 底色）和 features，让 Studio 来画" : "按部位重新画"}。` }
        : null,
    read: (look) => `和别处同一种填法的面占 ${percent(look.sameFillShare)}（超过 ${percent(L.sameFillShare)} 不合格）`,
  },
  {
    id: "noisy_texture",
    criterion: "not_mechanical",
    severity: "defect",
    asks: "同一种颜色成块出现，不能是噪点、逐像素交替或满屏斜线",
    find: (look) =>
      look.speckShare > L.speckNoise
        ? { message: `贴图上到处是孤立的杂点或细线（每 100 个像素里约 ${percent(look.speckShare)} 个和四周都不一样），贴到模型上像噪点。`, fix: "改成成块的深浅：同一种颜色至少连着两三个像素，不要逐像素交替，也不要满屏斜线。" }
        : look.speckShare > L.speckShare
          ? { advice: true, message: `贴图上有不少孤立的点（每 100 个像素里约 ${percent(look.speckShare)} 个和四周都不一样）。如果是有意点上去的高光、钉子、宝石就没问题；如果只是画碎了，把它们并成两三个像素的小块会更干净。`, fix: "看一眼贴到模型上的样子，决定留不留。" }
          : null,
    read: (look) => `孤立的杂点和细线占 ${percent(look.speckShare)}（超过 ${percent(L.speckNoise)} 不合格，超过 ${percent(L.speckShare)} 列为建议）`,
  },
  {
    id: "few_tones",
    criterion: "hierarchy",
    severity: "craft",
    asks: `至少看得出 ${L.tones} 种颜色：每种材质两三个深浅，加上眼睛、爪、角自己的颜色`,
    find: (look) => (look.tones < L.tones ? { message: `整个模型只看得出 ${look.tones} 种颜色，太单调。`, fix: `至少要有 ${L.tones} 种：每种材质用两三个深浅，再加上眼睛、爪、角这些部位自己的颜色。` } : null),
    read: (look) => `看得出 ${look.tones} 种颜色（至少 ${L.tones} 种）`,
  },
  {
    id: "flat_surfaces",
    criterion: "hierarchy",
    severity: "craft",
    asks: "表面有成块的深浅变化，不能大部分面是一整块纯色",
    find: (look) =>
      look.flatShare > L.flatShare
        ? { message: `大部分面是一整块纯色（约 ${percent(look.flatShare)}%），像没上色的积木。`, fix: own ? "给方块写 paint，选一种材质，让表面有成块的深浅变化。" : "给每个面画出两三个成块的深浅。" }
        : null,
    read: (look) => `一整块纯色的面占 ${percent(look.flatShare)}（超过 ${percent(L.flatShare)} 不合格）`,
  },
  {
    id: "unshaded",
    criterion: "hierarchy",
    severity: "craft",
    asks: "顶面比侧面亮一点、底面更暗，看得出光从上面照下来",
    find: (look) =>
      look.shadedShare < L.shadedShare ? { message: "方块的顶面和侧面颜色完全一样，看不出光是从上面照下来的。", fix: `让顶面比侧面亮一点、底面更暗${own ? "（写了 paint 就会自动这样画）" : ""}。` } : null,
    read: (look) => `顶面比侧面亮的方块占 ${percent(look.shadedShare)}（至少 ${percent(L.shadedShare)}）`,
  },
  {
    id: "accents_blend_in",
    criterion: "hierarchy",
    severity: "craft",
    asks: "角、爪、牙、晶体、眼睛要和身体颜色分得开",
    find: (look) =>
      look.accents > 0 && look.blendedAccents.length * 2 >= look.accents
        ? { message: `这些部位和身体颜色分不开：${some(look.blendedAccents)}。`, fix: "角、爪、牙、晶体、眼睛要用和身体明显不同的颜色或材质。", evidence: look.blendedAccents }
        : null,
    read: (look) => (look.accents > 0 ? `角、爪、牙这类部位 ${look.accents} 个，和身体颜色分不开的 ${look.blendedAccents.length} 个（过半不合格）` : "没有找到角、爪、牙、晶体、眼睛这类部位"),
  },
  {
    id: "no_head",
    criterion: "reads",
    severity: "defect",
    asks: "有腿、有翅膀的生物要有一个认得出的头",
    excuse: "faceless",
    find: (look) =>
      look.plan !== "blob" && look.plan !== "serpent" && !look.head ? { message: "找不到头。", fix: "把头部做成一根名字里带 head 的骨骼，头上的方块（头骨、鼻吻、角、耳朵）都放在它下面。" } : null,
    read: (look) => (look.plan === "blob" || look.plan === "serpent" ? "这种体形不要求有头" : look.head ? `头是「${look.head}」` : "没有找到头"),
  },
  {
    id: "no_face",
    criterion: "reads",
    severity: "defect",
    asks: "头上要有画出来的脸：眼睛这类和周围对比明显的记号，不能是光秃秃的一整块颜色",
    excuse: "faceless",
    find: (look) =>
      !look.hasFaceSurface || look.eyes
        ? null
        : look.blankHead
          ? {
              // A refusal only for a head with nothing on it whatever (`blankHead`): no mark, no colour, no cube of another colour, on any face a face could be on. That does not depend
              // on what the thing is or where its eyes sit. 10-14 (audit) had this refuse every head whose eyes the pair-finder does not look at (it reads the front and the two sides, and
              // drops patches that stand in air: eyes on stalks, on top, very small — a crab, a snail, a frog), and the sheet's `justified` was the only way out. Now such a head is
              // advice (below); a head with nothing on it can still be answered in `justified` (`no_face` is among `ANSWERABLE_DEFECTS`), judged by the reviewer against the pictures.
              message: `头上什么记号都没有：${look.head ? "头" : "身体"}的正面、两侧和顶上都是同一种颜色，没有眼睛，也没有别的东西能当脸。`,
              fix: `在头上画出脸：眼睛的颜色要和周围对比明显，而且这种颜色不能在头上到处都是。${own ? "在头部的方块上加 features: eyes（浅色眼白配深色瞳孔，或深色皮肤上用 glow 发亮的眼睛）。" : "在头上左右对称的位置各画一只：浅色眼白配深色瞳孔，或深色皮肤上用很亮的颜色。"}东西本来就没有脸的，在 justified 里写明为什么。`,
            }
          : {
              advice: true,
              message: `没有在${look.head ? "头" : "身体"}的正面或两侧找到一对看得清的眼睛。机器只在正面和两侧找成对的小记号，长在柄上、在头顶或很小的眼睛它认不出来；眼睛如果其实在，不用管，没有的话请补上。`,
              fix: "看一眼图上头的样子，确认认得出脸。",
            },
    read: (look) => (look.hasFaceSurface ? (look.eyes ? "头的正面或两侧找到了一对眼睛" : look.blankHead ? "头上什么记号都没有" : "正面和两侧没有找到一对眼睛（头上有别的记号，不当作没有脸）") : "没有可以看脸的面，这一条没有查"),
  },
]

const shapeRules: Rule<Measured>[] = [
  {
    id: "too_few_parts",
    criterion: "reads",
    severity: "defect",
    asks: "看得见的体块要撑得起轮廓：躯干、头、四肢或其它能改变轮廓的部位",
    find: (look) =>
      look.visibleCubes < look.minCubes ? { message: `模型只有 ${look.visibleCubes} 个看得见的体块，撑不起一只生物的轮廓。`, fix: `至少要 ${look.minCubes} 个（躯干、头、四肢或其它能改变轮廓的部位）。` } : null,
    read: (look) => `看得见的体块 ${look.visibleCubes} 个（至少 ${look.minCubes} 个）`,
  },
  {
    id: "hidden_parts",
    criterion: "earns_place",
    severity: "defect",
    asks: "每个方块都看得见，不能整个埋在别的方块里",
    find: (look) => (look.hiddenCubes.length > 0 ? { message: `这些方块完全埋在别的方块里，谁也看不见：${some(look.hiddenCubes)}。`, fix: "删掉它们，或者挪到看得见的位置。", evidence: look.hiddenCubes } : null),
    read: (look) => `完全埋在别的方块里的 ${look.hiddenCubes.length} 个`,
  },
  {
    id: "buried_volume",
    criterion: "earns_place",
    severity: "craft",
    asks: `方块贴在别的方块表面上、真正改变外形，不要大面积互相重叠（连接处互相插进去 ${FAULT_SLACK.joint} 个像素以内——翅根插进身体、腿根插进躯干、膜插在骨上——是正常的，不算）`,
    find: (look) =>
      look.deepBuriedShare > L.buriedShare || (look.buriedCubes.length >= 3 && look.buriedCubes.length > look.cubes * L.buriedCubes)
        ? { message: `方块互相重叠得太多（约 ${percent(look.deepBuriedShare)}% 的体积埋在别的方块里，连接处 ${round(look.slack.joint)} 个像素以内的穿插没有算${look.buriedCubes.length > 0 ? `；大半被埋住的有 ${some(look.buriedCubes)}` : ""}）。`, fix: "删掉埋在里面的方块，让每个方块都贴在别的方块表面上、真正改变外形；连接处插进去一两个像素不用改。", evidence: look.buriedCubes }
        : null,
    read: (look) => `约 ${percent(look.deepBuriedShare)} 的体积埋在别的方块里（超过 ${percent(L.buriedShare)} 不合格）`,
  },
  {
    id: "tiny_fragments",
    criterion: "earns_place",
    severity: "craft",
    asks: "爪尖、斑点这类细节画在表面，不要用一两格大的碎块堆（贴在头上、看得出是一对眼睛的单色小方块不算碎块）",
    find: (look) =>
      look.tinyCubes.length > L.tinyCubes && look.tinyCubes.length > look.cubes * L.tinyShare
        ? { message: `一两格大的碎块太多（${look.tinyCubes.length} 个：${some(look.tinyCubes)}）。`, fix: "爪尖、斑点这类细节请画在表面（features），不要做成小方块；眼睛画在表面或者做成贴在头上的一对单色小方块都可以。", evidence: look.tinyCubes }
        : null,
    read: (look) => `一两格大的碎块 ${look.tinyCubes.length} 个，一共 ${look.cubes} 个方块`,
  },
  {
    id: "floating_parts",
    criterion: "sound",
    severity: "defect",
    asks: "部件之间要连着，不能悬在空中（连接处可以互相插进去，但不能留缝：1 个像素的缝背景也透得出来）",
    excuse: "floating",
    find: (look) => (look.floating.length > 0 ? { message: `这些部件悬在空中，没有和身体连上：${some(look.floating)}。`, fix: "把它们挪到贴着相邻部件的位置（不能留缝；插进去一两个像素没关系）。", evidence: look.floating } : null),
    read: (look) => `悬在空中的部件 ${look.floating.length} 个`,
  },
  {
    id: "off_ground",
    criterion: "sound",
    severity: "defect",
    asks: `脚底（或身体底部）落在地面 y=0 上（高出 ${L.groundSlack} 个像素以内、陷进去 ${FAULT_SLACK.ground} 个像素以内——高大的生物按身高的 ${percent(FAULT_SLACK.groundShare)}%——都算落在地面上）`,
    excuse: "airborne",
    find: (look) => {
      if (look.ground >= -look.slack.ground && look.ground <= L.groundSlack) return null
      return look.ground > 0
        ? { message: `模型最低处在 y=${round(look.ground)}，整只悬在地面上方。`, fix: "整体下移，让脚底（或身体底部）落在 y=0。" }
        : { message: `模型最低处在 y=${round(look.ground)}，陷进了地面（超过 ${round(look.slack.ground)} 个像素玩家才看得出）。`, fix: "整体上移，让脚底落在 y=0。" }
    },
    read: (look) => `模型最低处在 y=${round(look.ground)}（落在 ${-round(look.slack.ground)} 到 ${L.groundSlack} 之间算落地）`,
  },
  {
    id: "hanging_limbs",
    criterion: "sound",
    severity: "defect",
    asks: `每条腿都踩到地面（离地不超过 ${FAULT_SLACK.ground} 个像素算踩到）`,
    find: (look) => (look.hangingLimbs.length > 0 ? { message: `这些腿没有踩到地面（离地超过 ${round(look.slack.ground)} 个像素）：${some(look.hangingLimbs)}。`, fix: "把腿加长或下移到 y=0。", evidence: look.hangingLimbs } : null),
    read: (look) => `没踩到地面的腿 ${look.hangingLimbs.length} 条`,
  },
  {
    id: "lopsided",
    criterion: "sound",
    severity: "craft",
    asks: "以 x=0 为中线左右对称",
    excuse: "lopsided",
    find: (look) =>
      look.lopsidedShare > L.lopsidedShare && look.plan !== "serpent"
        ? { message: `模型左右差得太多（约 ${percent(look.lopsidedShare)}% 的体积在另一侧没有对应）。`, fix: "以 x=0 为中线，把左右两边做成对称的。" }
        : null,
    read: (look) => (look.plan === "serpent" ? "这种体形不要求左右对称" : `左右没有对应的体积占 ${percent(look.lopsidedShare)}（超过 ${percent(L.lopsidedShare)} 不合格）`),
  },
  {
    id: "head_out_of_scale",
    criterion: "hierarchy",
    severity: "craft",
    asks: "头和身体大小分得出主次：头不能小到看不见，也不能占掉大半只",
    find: (look) => {
      if (!legged(look) || !look.head || (look.headShare >= L.headShare[0] && look.headShare <= L.headShare[1])) return null
      return look.headShare < L.headShare[0] ? { message: "头相对身体太小了，几乎看不见。", fix: "把头放大。" } : { message: "头占了整只生物的大半，身体和腿显得撑不住。", fix: "把头缩小，或把身体和腿加大。" }
    },
    read: (look) => (legged(look) && look.head ? `头占整只的 ${percent(look.headShare)}（该在 ${percent(L.headShare[0])} 到 ${percent(L.headShare[1])} 之间）` : "没有腿或没找到头，这一条没有查"),
  },
  {
    id: "legs_out_of_scale",
    criterion: "hierarchy",
    severity: "craft",
    asks: "腿和躯干高矮分得出主次：腿至少占身高的八分之一，也不能几乎占满",
    find: (look) => {
      if (!legged(look) || (look.limbShare >= L.limbShare[0] && look.limbShare <= L.limbShare[1])) return null
      return look.limbShare < L.limbShare[0] ? { message: "腿太短，几乎看不出来。", fix: "把腿加长到至少占身高的八分之一。" } : { message: "腿几乎占了全部身高，没有身体。", fix: "把腿缩短，或把躯干加高。" }
    },
    read: (look) => (legged(look) ? `腿占身高的 ${percent(look.limbShare)}（该在 ${percent(L.limbShare[0])} 到 ${percent(L.limbShare[1])} 之间）` : "没有腿，这一条没有查"),
  },
  {
    id: "misplaced_joint",
    criterion: "sound",
    severity: "craft",
    asks: "关节放在部件和身体相连的地方：腿的在腿根，头的在脖子，尾巴的在尾根",
    find: (look) =>
      badJoints(look).length > 0
        ? { message: `这些骨骼的关节位置不对，一动就会甩出去：${some(badJoints(look))}。`, fix: "关节（pivot）要放在部件和身体相连的地方——腿的在腿根，头的在脖子，尾巴的在尾根。", evidence: badJoints(look) }
        : null,
    read: (look) => `关节放错地方的骨骼 ${badJoints(look).length} 根`,
  },
]

const detailRules: Rule<Measured>[] = [
  {
    id: "duplicates",
    criterion: "earns_place",
    severity: "defect",
    asks: "同一样东西只做一次：不能有位置和大小都一样的方块，也不能给大多数方块贴同一条一模一样的细节",
    find: (look) => {
      if (look.twinCubes.length > 0) return { message: `这些方块和别的方块位置、大小完全一样，是重复的：${some(look.twinCubes)}。`, fix: "每样只留一个，把重复的删掉。", evidence: look.twinCubes }
      return look.copiedDetails >= L.copiedDetails ? { message: "大多数方块上贴着同一条一模一样的手写细节，这是凑数，不是细节。", fix: "把这些 surface_details 全部删掉，改用 features 画真正属于这个部位的细节（眼睛、条纹、裂纹、镶边…）。" } : null
    },
    read: (look) => `位置大小完全一样的方块 ${look.twinCubes.length} 个；贴着同一条手写细节的方块 ${look.copiedDetails} 个（${L.copiedDetails} 个起算凑数）`,
  },
  {
    id: "invisible_details",
    criterion: "earns_place",
    severity: "craft",
    asks: "画上去的细节要看得出来：颜色和底色有区别，不画在被挡住的面上",
    find: (look) => (look.hiddenDetailShare >= L.hiddenDetailShare ? { message: "很多手写细节根本看不见：颜色和所在的面几乎一样，或者画在被别的方块挡住的面上。", fix: "删掉这些 surface_details，或换成看得出来的颜色和位置。" } : null),
    read: (look) => `看不见的手写细节占 ${percent(look.hiddenDetailShare)}（${percent(L.hiddenDetailShare)} 起算不合格）`,
  },
]

const motionRules: Rule<Measured>[] = [
  {
    id: "nothing_moves",
    criterion: "earns_place",
    severity: "defect",
    asks: "动作要真的带动看得见的部件，不能只有名字",
    find: (look) => (look.animatedBones === 0 ? { message: "idle、walk、hurt 三个动作里没有任何一个部件真的在动。", fix: "至少让一根带方块的骨骼（或它的父骨骼）有角度变化。" } : null),
    read: (look) => `idle、walk、hurt 里真的在动的骨骼 ${look.animatedBones} 根`,
  },
  {
    id: "walk_legs_still",
    criterion: "reads",
    severity: "defect",
    asks: `走路要像走路：每条腿都来回摆（至少 ${L.walkSwing} 度），没有腿的也要有明显的移动动作`,
    find: (look) => {
      if (look.limbs.length >= 2 && look.walkLimbs < look.limbs.length) return { message: `走路时有 ${look.stillLegs.length} 条腿没怎么动：${look.stillLegs.map((name) => `「${name}」`).join("、")}。`, fix: `walk 里每条腿都要来回摆动，前后至少差 ${L.walkSwing} 度。` }
      if (look.limbs.length < 2 && look.walkMovers < 1) return { message: "走路的动作里看不出在移动。", fix: `没有腿的生物也要有明显的动作：身体起伏、扭动或摆尾，来回至少 ${L.walkMove} 度。`  }
      return null
    },
    read: (look) => (look.limbs.length >= 2 ? `走路时来回摆的腿 ${look.walkLimbs} / ${look.limbs.length} 条（至少摆 ${L.walkSwing} 度）` : `没有成对的腿，走路时明显移动的部位 ${look.walkMovers} 个`),
  },
  {
    id: "walk_same_phase",
    criterion: "reads",
    severity: "defect",
    asks: "成对的左腿和右腿一前一后，不能一起往同一个方向摆",
    find: (look) => (look.walkPhase !== null && look.walkPhase > L.walkPhase ? { message: "走路时左右两条腿是一起往同一个方向摆的，像在蹦。", fix: "让成对的左腿和右腿相位相反：一条往前时另一条往后。" } : null),
    read: (look) => (look.walkPhase === null ? "没有成对的左右腿，这一条没有查" : "成对的左右腿是一前一后摆的"),
  },
  {
    id: "constant_speed",
    criterion: "not_mechanical",
    severity: "craft",
    asks: "腿摆到头要慢下来、经过中间最快，不能匀速来回",
    find: (look) =>
      look.walkStiff.length > 0 && look.walkStiff.length * 2 >= look.limbs.length
        ? { message: `走路时腿是匀速来回摆的，像机器人：${some(look.walkStiff)}。`, fix: "在摆到最前和最后的位置附近各加一个关键帧，让腿到头时慢下来、经过中间时最快。", evidence: look.walkStiff }
        : null,
    read: (look) => `走路时匀速来回摆的腿 ${look.walkStiff.length} / ${look.limbs.length} 条（过半不合格）`,
  },
  {
    id: "walk_body_frozen",
    criterion: "hierarchy",
    severity: "craft",
    asks: "走路时身体、头或尾巴要跟着腿动",
    find: (look) => (look.limbs.length >= 2 && look.walkOthers === 0 ? { message: "走路时只有腿在动，身体、头和尾巴都僵着。", fix: "给身体加一点起伏或摇晃，让头或尾巴跟着动。" } : null),
    read: (look) => (look.limbs.length >= 2 ? `走路时身体、头、尾巴一起动的部位 ${look.walkOthers} 个` : "没有成对的腿，这一条没有查"),
  },
  {
    id: "idle_still",
    criterion: "reads",
    severity: "defect",
    asks: "待机要看得出是活的：有轻微的动作",
    find: (look) => (look.animatedBones > 0 && look.idleSpan < L.idleSpan[0] && !look.idleShifts ? { message: "待机时完全不动。", fix: "给 idle 加一点看得见的轻微动作；动没动得够，以看图时量出来的移动量为准，不是以角度为准。" } : null),
    read: (look) => `待机时来回动了 ${Math.round(look.idleSpan)} 度（至少 ${L.idleSpan[0]} 度）`,
  },
  {
    id: "idle_wild",
    criterion: "reads",
    severity: "craft",
    asks: `待机要轻，来回不超过 ${L.idleSpan[1]} 度`,
    find: (look) => (look.idleSpan > L.idleSpan[1] ? { message: `待机动作太大了（来回 ${Math.round(look.idleSpan)} 度），像在抽搐。`, fix: `idle 应该很轻，控制在 ${L.idleSpan[1]} 度以内。` } : null),
    read: (look) => `待机时来回动了 ${Math.round(look.idleSpan)} 度（不超过 ${L.idleSpan[1]} 度）`,
  },
  {
    id: "hurt_still",
    criterion: "reads",
    severity: "defect",
    asks: `受伤要像挨了一下：身体或头猛地一缩（转至少 ${L.hurtTurn} 度，或者用位移、缩放做出看得见的一下）再弹回来`,
    find: (look) => (look.animatedBones > 0 && look.hurtTurn < L.hurtTurn && !look.hurtShifts ? { message: "受伤时几乎没有反应。", fix: `让 hurt 里身体或头猛地一缩（至少 ${L.hurtTurn} 度），再弹回来。` } : null),
    read: (look) => `受伤时猛地转了 ${Math.round(look.hurtTurn)} 度（至少 ${L.hurtTurn} 度）`,
  },
  {
    id: "hurt_slow",
    criterion: "reads",
    severity: "craft",
    asks: `受伤要又快又短：${L.hurtLength} 秒以内，最大的动作在前半段`,
    find: (look) =>
      look.hurtLength > L.hurtLength || (look.hurtTurn >= L.hurtTurn && look.hurtPeakAt > L.hurtPeakAt)
        ? { message: "受伤动作太慢，不像挨了一下。", fix: `hurt 要在 ${L.hurtLength} 秒以内，而且最大的动作要出现在前半段：先猛地一缩，再慢慢回来。` }
        : null,
    read: (look) => `受伤动作长 ${round(look.hurtLength)} 秒（不超过 ${L.hurtLength} 秒）`,
  },
]

/**
 * The rules about how a motion moves, by the motion they read. broad15: a ballista turret that never walks declared its walk `still` in the part
 * sheet, and the measured unseen-motion finding listened, but "the legs must swing" (walk_legs_still) did not: the only way on was to animate a walk
 * the game never plays. A motion the sheet declares still (with its reason, shown to the reviewer and the person) is not held to how it moves. What
 * keeps this from excusing a creature that does walk: a creature that is not `stationary` and whose worn model's walk glides is refused at the
 * creature stage (`walk_glides` in mod-core's entity standard), and an idle or hurt declared still is judged by the reviewer against the pictures.
 * The project runner turns each `still` entry into `justified` answers for these rules (`stillAnswers`); nothing else answers them.
 */
export const STILL_RULES: Readonly<Record<string, string>> = { walk_legs_still: "walk", walk_same_phase: "walk", constant_speed: "walk", walk_body_frozen: "walk", idle_still: "idle", hurt_still: "hurt" }

/**
 * Rules answered only when the sheet declares every one of these motions still, not one: a thing none of whose three creature clips moves anything
 * (`nothing_moves`) is a thing that is meant to be inert, which is what declaring all three says. One clip declared still does not answer it: the
 * other two still have to move something. (Audit: a statue that declared idle, walk and hurt all still was still refused for having no motion.)
 */
export const STILL_ALL: Readonly<Record<string, readonly string[]>> = { nothing_moves: ["idle", "walk", "hurt"] }

/** The `justified` answers a sheet's `still` entries give the rules of `STILL_RULES` and `STILL_ALL`: `motions` maps each motion the sheet declares still to its reason. */
export const stillAnswers = (motions: Readonly<Record<string, string>>) => [
  ...Object.entries(STILL_RULES).flatMap(([rule, motion]) => (motions[motion] ? [{ what: rule, reason: `部件说明声明这个动作（${motion}）本来就不动：${motions[motion]}` }] : [])),
  ...Object.entries(STILL_ALL).flatMap(([rule, needed]) =>
    needed.every((motion) => motions[motion]) ? [{ what: rule, reason: `部件说明声明 ${needed.join("、")} 这几个动作都本来就不动：${[...new Set(needed.map((motion) => motions[motion]!))].join("；")}` }] : [],
  ),
]

/** A motion rule's finding says the other way out: the motion declared still in the sheet. */
const stillable = <M extends object>(rule: Rule<M>): Rule<M> =>
  STILL_RULES[rule.id]
    ? { ...rule, find: (look) => { const found = rule.find(look); return found && { ...found, fix: `${found.fix.replace(/[。.]$/, "")}；如果 ${STILL_RULES[rule.id]} 本来就不该动（比如从来不走路的固定机械），在部件说明的 still 里写上这个动作和理由（会走动的生物到生物那一步还会再查走路）。` } } }
    : STILL_ALL[rule.id]
      ? { ...rule, find: (look) => { const found = rule.find(look); return found && { ...found, fix: `${found.fix.replace(/[。.]$/, "")}；如果它本来就是一动不动的东西，在部件说明的 still 里把 ${STILL_ALL[rule.id]!.join("、")} 都写上，每个写上理由（少一个都不行：没写的那个动作还是要动）。` } } }
      : rule

/**
 * The defects a part sheet may also answer with a reason, and for each the plain name the maker and the reviewer read it by and why a reason can
 * hold for it. What they have in common (owner, 10-14: a legitimate subject must always have a legal way out; a gate stops only on what a player
 * would obviously see as an error): whether the measured thing is a fault depends on WHAT THE THING IS, which a number cannot know and the
 * reviewer can judge against the pictures, with the reason shown to the person. Before this the way out of `off_ground` and `floating_parts` was a
 * brief that happened to say 飘 or 悬浮, so a bat, a jellyfish, a ghost, a bee or an angel's halo, whose brief said none of it, was pushed onto
 * y=0 or told to attach its halo; `too_few_parts` refused a one-block creature that is meant to be one block, against "少而准，不数方块";
 * `walk_same_phase` refused every hopper, whose paired legs move together. The brief-word excuses stay as they were (they still work when the brief says it).
 *
 * Every other defect (a block buried whole in another, a block made twice, a leg that does not reach the floor, a clip that glides) is an
 * error whatever the thing is, and is only changed. `nothing_moves` is answered by declaring every clip still, not by a reason (`STILL_ALL`).
 */
export const DEFECT_REASONS: Readonly<Record<string, { name: string; why: string }>> = {
  no_head: { name: "找不到头", why: "有没有头是关于它是什么的事实" },
  no_face: { name: "看不出脸", why: "有没有脸、眼睛在哪里（长在柄上、在头顶、小到认不出）是关于它是什么的事实" },
  off_ground: { name: "整只悬在地面上方（或陷进地面）", why: "它是不是真的悬着、飘着、飞着、泡在水里，是关于它是什么的事实" },
  floating_parts: { name: "部件悬在空中", why: "它有没有和身体分开的部件（头顶的光环、绕着它转的东西）是关于它是什么的事实" },
  too_few_parts: { name: "看得见的体块太少", why: "几个体块够不够撑起它的轮廓，要看图上这个轮廓立不立得住" },
  walk_same_phase: { name: "走路时左右腿一起摆", why: "蹦着走的东西成对的腿本来就一起动，这是它怎么移动的事实" },
}

/** The ids of the defects of `DEFECT_REASONS`: the only defects a part sheet's `justified` answers (and a missing head or face is among them). */
export const ANSWERABLE_DEFECTS: readonly string[] = Object.keys(DEFECT_REASONS)

/**
 * A craft rule's finding (and one of `ANSWERABLE_DEFECTS`) ends the way a measured motion fault's does: change it, or answer it with a reason in
 * the part sheet's `justified` (`what` is the rule's id). Any other defect's does not: it is only changed.
 */
const answerable = <M extends object>(rule: Rule<M>): Rule<M> =>
  rule.severity === "craft" || ANSWERABLE_DEFECTS.includes(rule.id)
    ? { ...rule, find: (look) => { const found = rule.find(look); return found && (found.advice ? found : { ...found, fix: `${found.fix.replace(/[。.]$/, "")}，再看一版；${justifyTail(rule.id)}` }) } }
    : rule

/** A creature model with its own paint and its idle, walk and hurt. Every criterion is read except whether its parts fit other assets. */
export const MODEL_STANDARD: KindStandard<Measured> = {
  kind: "model",
  label: "模型",
  rules: [...shapeRules, ...surfaceRules(true), ...detailRules, ...motionRules].map(answerable).map(stillable),
  unmeasured: { fits: "模型自己就是一整样东西；它和贴图、生物规则对不对得上，在贴图和生物那边检查" },
  told: CONTINUITY_TOLD,
}

/** A texture drawn pixel by pixel, judged on the model it dresses: what is seen is the pair. */
export const TEXTURE_STANDARD: KindStandard<Measured & { size: number }> = {
  kind: "texture",
  label: "贴图",
  rules: [
    {
      id: "wrong_size",
      criterion: "fits",
      severity: "defect",
      asks: "贴图和它穿的模型的贴图空间一样大，并按每个面的 UV 区域来画",
      find: (look) => (look.fits ? null : { message: "贴图和模型的贴图空间不一样大，贴不上去。", fix: `贴图必须是 ${look.size}×${look.size}，并按 model_context 给出的每个面的 UV 区域来画。` }),
      read: (look) => (look.fits ? `贴图是 ${look.size}×${look.size}，和模型的贴图空间一样大` : `贴图是 ${look.size}×${look.size}，和模型的贴图空间不一样大`),
    },
    // A texture that does not fit shows nothing that can be judged.
    ...surfaceRules(false)
      .map(answerable)
      .map((rule) => ({ ...rule, find: (look: Measured) => (look.fits ? rule.find(look) : null), read: (look: Measured) => (look.fits ? (rule.read?.(look) ?? null) : "贴图对不上模型，没法看，这一条没有查") })),
  ],
  unmeasured: {
    earns_place: "贴图里哪些像素是多余的，还量不了",
    sound: "贴图没有结构可言；模型站不站得住在模型那边检查",
  },
}

/**
 * Surface rules: on a creature that wears a texture of its own, the texture's findings replace the model's for
 * these. Finding the head and making the same thing twice are about the document itself, whatever it wears.
 */
export const SURFACE_RULES: readonly string[] = [...surfaceRules(true), ...detailRules].filter((rule) => rule.id !== "no_head" && rule.id !== "duplicates").map((rule) => rule.id)

/** The rules a part sheet may answer with a reason: every craft rule of the model standard (the texture's surface rules are the same ones), and the defects of `ANSWERABLE_DEFECTS`. No other defect is among them. */
export const ANSWERABLE_RULES: readonly string[] = MODEL_STANDARD.rules.filter((rule) => rule.severity === "craft" || ANSWERABLE_DEFECTS.includes(rule.id)).map((rule) => rule.id)

/** Every rule a part sheet answers in some way: by a reason in `justified` (`ANSWERABLE_RULES`), or by declaring motions still (`STILL_RULES`, `STILL_ALL`). */
export const sheetAnswers = (rule: string) => ANSWERABLE_RULES.includes(rule) || Object.hasOwn(STILL_RULES, rule) || Object.hasOwn(STILL_ALL, rule)

/** A model's or texture's review with the findings that `justified` answers set aside (`answerCraft`): the craft ones, the defects of `ANSWERABLE_DEFECTS` and the motion rules a declared-still motion answers. */
export const answerModelCraft = (review: AssetReview, justified: ReviewContext["justified"]) => answerCraft(review, justified, (finding: Finding) => sheetAnswers(finding.rule))

export type ModelReviewContext = ReviewContext & {
  /** The tier chosen for the run. Choosing one asks for the full standard. */
  complexity?: ModelComplexity
  /** A person's own version (or, in the modelling service, the design being revised) that this one replaces. */
  previous?: ModelDesign | null
}

/** Review an AI-made model for whether it looks like a finished creature, not for how much geometry it has. */
export function reviewModelQuality(design: ModelDesign, context: ModelReviewContext = {}): AssetReview {
  const preset = MODEL_COMPLEXITY_PRESETS[ModelComplexitySchema.parse(context.complexity ?? "medium")]
  const cubes = design.bones.flatMap((bone) => bone.cubes)
  const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
  const moved = geometryBones(design)
  const animatedBones = new Set(
    design.animations
      .filter((animation) => ["idle", "walk", "hurt"].includes(animation.name))
      .flatMap((animation) => animation.channels.filter((channel) => channelChanges(channel) && moved.has(channel.bone)).map((channel) => channel.bone)),
  ).size
  const fit = fitted(design)
  if (!fit) return unreadable(MODEL_STANDARD, "模型的面太多太大，最大的贴图空间也放不下。", TEXTURE_SPACE_ERROR)
  const look = measureLook(fit)
  const previous = context.previous
  const held = { ...context, insisted: context.insisted ?? context.complexity !== undefined }
  return answerModelCraft(
    judge(MODEL_STANDARD, { ...look, minCubes: preset.minUniqueCubes, animatedBones }, held, holdFor(held, previous ? () => reviewModelQuality(previous).passed : null), {
      ...summary(look),
      bones: design.bones.length,
      cubes: cubes.length,
      uniqueCubes: new Set(design.bones.flatMap((bone) => bone.cubes.map((cube) => `${cube.origin.join(",")}|${cube.size.join(",")}|${transformSignature(bone.name, bones)}`))).size,
      surfaceDetails: look.surfaceDetails,
      animatedBones,
    }),
    context.justified,
  )
}

/**
 * Review a standalone texture on the model it dresses: what is judged is the pair, as the player will see
 * it. `previous` is a person's own texture being revised, if any; like models, such a revision is held
 * only when what it started from passed.
 */
export function reviewTextureQuality(design: ModelDesign, texture: LookTexture, context: ReviewContext & { previous?: LookTexture | null } = {}): AssetReview {
  if (fitted(design)?.texture_size !== design.texture_size) return unreadable(TEXTURE_STANDARD, "这张贴图要穿的模型，自己的贴图空间就放不下它的面，贴图没法贴上去看。", "先把模型改到能放进它的贴图空间，再画贴图。")
  const look = measureLook(design, texture)
  const previous = context.previous
  return answerModelCraft(judge(TEXTURE_STANDARD, { ...look, minCubes: 0, animatedBones: 0, size: design.texture_size }, context, holdFor(context, previous ? () => reviewTextureQuality(design, previous).passed : null), look.fits ? { ...summary(look) } : { fits: false }), context.justified)
}

const MODEL_HOW_TO =
  "做法没有固定的套路，也没有现成的身体模板：它是什么、有哪些部件、各长什么样，照部件说明来。先大形后细节：先把轮廓和各部分的比例立住，再做真正改变轮廓的次级结构，表面的纹样最后画；只是花纹的东西画在表面，不要堆成小方块，一两格的方块只在确实凸出来时才用。命名上只有一个约定：它有头的话头部骨骼叫 head，有腿叫 leg/foot，有翅膀叫 wing，验收标准靠这些名字找到脸和会动的肢体。" +
  "使用 Y-up 像素坐标，前方朝北（-Z），左右以 x=0 为中线，脚底在 y=0。" +
  ORIENTATION_GUIDE +
  "north/south 面是 [size.x,size.y]，east/west 面是 [size.z,size.y]，up/down 面是 [size.x,size.z]。骨骼的 pivot 要放在关节上（腿的 pivot 在腿根，头的 pivot 在脖子），由正确的父骨骼带动。"
// 第 2 步: how clips blend and layer and which bones follow (`CLIP_PLAY_GUIDE`), and what an epic creature's attack motions are held to (`EPIC_MOTION_GUIDE`).
const MODEL_MOTION_HOW_TO = `动作的写法：${ANIMATION_GUIDE}${CLIP_PLAY_GUIDE}${EPIC_MOTION_GUIDE}`

/**
 * 第 1 步: what a cube may say beyond its box (`contracts.ts` CUBE_SHAPE) and how the texture is laid out, for whoever makes a model.
 * Angled plates and mirrored halves that share their texture are supported directly.
 */
export const MODEL_SHAPE_GUIDE =
  "方块不只是正放的盒子：每个方块可以另写 rotation: [x, y, z]（度，-180 到 180，任意角度，和骨骼的 rotation 一样先转 x、再 y、再 z）和 pivot: [x, y, z]（绕哪一点转，模型像素；不写就是方块的中心）。斜插的甲片、翘起的肩甲、獠牙、背上的骨刺、披风的褶，用转过角度的方块拼，不必为每块斜板单开一根骨骼；要跟着动的部件仍然放在自己的骨骼上。" +
  "inflate（-2 到 4 个模型像素）让方块往四周胀一圈、贴图不变（包在外面的一层皮、比下面略大一圈的护甲）。mirror: true 让这个方块的贴图左右翻过来。" +
  "share: \"骨骼名.方块名\" 让这个方块直接穿另一个一样大的方块的贴图，自己不占贴图位置，它自己的 paint、features、surface_details、pixels 都不画：右臂 share 左臂、再写 mirror: true，就是对称的那一边（东西两面也会对调）；一排一样的牙、鳞片、铆钉共用一个。省下来的贴图让巨型的 Boss 也能一个贴图像素对一个模型像素。" +
  "整个模型可以写 atlas: \"packed\"（不写或 null 是原来的按顺序一行行排）：各个面按高矮排进贴图，空着的地方少很多，同样的贴图放得下多得多的方块。史诗档的贴图最大 1024×1024。这些字段不用时写 null 或者不写，旧的模型照旧。"

/**
 * 第 1 步: the magnitudes a boss or an epic model is made to (53–122 bones nested 8–13 deep, 78–132 cubes,
 * most bones carrying a rest angle, textures hand-painted with shading and wear). Said to the maker of a boss's or an epic creature's model in
 * place of the creature-sized range of the 「高」 complexity.
 */
export const EPIC_MODEL_GUIDE =
  "Boss 和史诗档的模型可参考这些数量和层级：骨骼 60–120 根，一层套一层 8–13 层深（身体 → 胸 → 肩 → 上臂 → 前臂 → 手 → 手指，盔甲片、披挂挂在它护着的部位下面），方块 80–200 个；轮廓是转过角度的板拼出来的（可用方块的 rotation 或骨骼的静止 rotation），不是一摞正放的盒子。" +
  "表面要像手绘的：写 shading: \"rich\"，每种材质有自己的明暗、高光、磨损和锈，脸、纹章、符文、伤痕这些要紧的面用 pixels（或脚本的 draw）一个像素一个像素地画；对称的另一半用 share + mirror 省贴图，写 atlas: \"packed\"，贴图不够就用 1024，不要用 texel_size 把细节砍掉。" +
  "每次看图的 budget_facts 里有一句量出来的「平涂占比」：一个面一种颜色的积木是 100%，手绘纹理通常在 40% 以下。复杂度档位那一句里写的体块数是普通生物的参考，不适用于 Boss 和史诗档。"

export const EPIC_SHAPE_GUIDE =
  "大头盔、肩腹等要做出圆轮廓的体块用 solid 的椭球或圆角长方体，粗略轮廓先试 step: 2，再从六个方向检查；脸、关节球等小件或识别处需要细弧时用 step: 1。保留六视图的弧线，别用一个正放方盒替代。" +
  "肢体、角和尾巴由粗到细，用圆锥、圆管，或一节比一节细的链，不要整段一样粗。" +
  "外层甲片用转过角度的薄板错开压在内层上，也可用 inflate 比内层大一圈，留下每层轮廓。" +
  "六视图上明确不对称的地方照图做；只有真正对称的部件才镜像。" +
  "斜板加圆体的六视图以约 600 个方块内可还原为目标：用贴图做平面的铆钉和接缝，简化密集凸点和逐节立体链条。每次看图可对照结构数字（层级、链和斜件），这些是参考事实，不设及格线。"

/** What the standard asks of a model, generated from its rules. The gate enforces every line of it. */
export const MODEL_ART_RULES = standardBrief(outlineOf(MODEL_STANDARD))

/** The whole brief for a model: the standard's rules for this kind, then how to write one. */
export const MODEL_ART_DIRECTION =
  "模型的目标是“像一个真正能玩的模组里的生物”。" +
  MODEL_ART_RULES +
  SLACK_WORDS +
  MODEL_HOW_TO +
  STRUCTURE_GUIDE +
  MODEL_PAINT_GUIDE +
  MODEL_SHAPE_GUIDE +
  MODEL_MOTION_HOW_TO +
  "模型复杂度以任务指令里“复杂度档位”那一句写的档位（low、medium、high 之一，用户在顶部选的；这只生物在蓝图上的档位要求更细时，是已经取了更细的那一档）为准，它只是细节多少的参考，不是数量指标。保留既有资产时保持未要求修改的结构、材质和动画。"

/** For a texture drawn pixel by pixel on a model's atlas, as an asset of its own beside the texture the model carries. */
export const TEXTURE_ART_DIRECTION =
  "模型自己带着贴图；单独的贴图资产是给同一个模型另画的一张，需要它的时候才做。逐像素贴图是贴到模型上去看、去验收的。" +
  standardBrief(outlineOf(TEXTURE_STANDARD)) +
  "做法：先按部位决定颜色，再画细节，不要按面积平铺；每种材质用两三个成块的深浅色；头部正面是 model_context 里 head 骨骼的 north 面。" +
  ORIENTATION_GUIDE
