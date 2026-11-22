import { assetRef } from "./finding-refs"
import { answerCraft, holdFor, judge, justifyTail, outlineOf, rejudged, unmeasured, unreadable, type AssetReview, type Finding, type KindStandard, type Level, type ReviewContext, type Rule, type StandardOutline } from "@minemods/studio-ai/acceptance"
import { assetDesignNotes } from "./combat-particles"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { MOTION_MEASURES, colorDistance, motion } from "@minemods/studio-ai/model-look"
import { shiftsOrScales } from "@minemods/studio-ai/animation"
import { TEXTURE_SEEN } from "@minemods/studio-ai/texture-facts"
import { CONTINUITY_TOLD, glidingWalk, walkingSpeed } from "@minemods/studio-ai/motion-continuity"
import { CONTINUITY_WORDS, FAULT_FIX, motionLabel } from "@minemods/studio-ai/making"
import { MODEL_STANDARD, SURFACE_RULES, TEXTURE_STANDARD, reviewModelQuality, reviewTextureQuality, type ModelComplexity } from "@minemods/studio-ai/model-quality"
import { decodeTextureDataUrl } from "./content-texture"
import { boneIssues } from "./creature-abilities"
import { hitboxCombatIssues } from "./hitbox-combat"
import { creatureVanillaGaps, targetMinecraft } from "./version-lacks"
import { DEFAULT_TARGET } from "./target/ids"
import { flightWalks } from "./creature-flight"
import { reviewGesture } from "./gesture"
import { staticChecks, type GameplayCheck } from "./gameplay-check"
import { findingLine, type GameplayFinding } from "./gameplay"
import { plainFindings } from "./gameplay-plain"
import { GESTURE_GATE, GESTURE_STANDARD } from "./gesture-gate"
import { EFFECT_STANDARD } from "./effect"
import { SOUND_STANDARD } from "./sound"
import { PARTICLE_STANDARD, particleWarnings } from "./particle"
import { BOSS_BAR_STANDARD } from "./boss-bar"
import { FIXTURE_STANDARD } from "./fixture"
import { BOOK_STANDARD } from "./book"
import { ABILITY_ASSET_STANDARD, abilityAssetLines, expandedMoves } from "./ability-asset"
import { decodeRgbaPng } from "./png-decode"
import type { Project } from "./project"
import type { ModuleDocument, WorkspaceAsset } from "./workspace"
import type { ModuleKind } from "./workspace-modules"
import { isItemOnlyModel, reviewStaticItemModel } from "./item-model-quality"

export * from "@minemods/studio-ai/acceptance"

/**
 * The acceptance standard applied to every asset kind. The criteria, the verdict and the wording are the
 * shared ones (re-exported above); this file is the registry: for each kind, the rules that read its
 * measurements and the criteria it honestly cannot measure yet, and `reviewAsset`, the one function the
 * app's own AI, the outside-AI hand-in and the acceptance card all call. No Node APIs: it runs in the
 * app's window too.
 */

type Document<Kind extends ModuleKind> = Extract<ModuleDocument, { kind: Kind }>
const defect = <Measured>(id: string, criterion: Rule<Measured>["criterion"], asks: string, find: Rule<Measured>["find"], read?: Rule<Measured>["read"]): Rule<Measured> => ({ id, criterion, severity: "defect", asks, find, ...(read ? { read } : {}) })
const craft = <Measured>(id: string, criterion: Rule<Measured>["criterion"], asks: string, find: Rule<Measured>["find"], read?: Rule<Measured>["read"]): Rule<Measured> => ({ id, criterion, severity: "craft", asks, find, ...(read ? { read } : {}) })
const pct = (share: number) => `${Math.round(share * 100)}%`
const list = (names: string[]) => `${names.slice(0, 4).join("、")}${names.length > 4 ? ` 等 ${names.length} 个` : ""}`
const round = (value: number) => Number(value.toFixed(3))

/**
 * Limits of the small-picture rules (an item's icon, a block's face), as data. Margins measured on
 * test/fixtures/acceptance: "good" is the accepted picture nearest the limit, "bad" the rejected one nearest it.
 */
export const SPRITE_LIMITS = {
  /**
   * Share of pixels that match none of their neighbours. good ≤ 0.016 (ore-block), bad 0.355 (noise-block), 0.375 (static-item). Up to this nothing is said. A lone pixel is noise in a
   * screenful and a deliberate point (a gem, a rivet, a glint on a blade) in a few, and no number tells one from the other; so above it the finding is advice, and only a picture
   * that is beyond doubt is refused: more than `speckNoise` of the pixels that have neighbours AND at least `speckDots` lone pixels for every 100 cells of the picture. A thin icon has few
   * pixels with neighbours (the wand: 71 of 256), so a handful of accents is a large share of them; the count is what keeps those from being static. Measured on the wand specimen with
   * accents added one by one (white, red, gold, ice-blue dots on its pixels): 8 accents 0.113, 10 accents 0.183 and 5.1 per 100 cells, none of which is static.
   */
  speckShare: 0.12,
  /** Share beyond which the dots cannot be accents any more: above the 10-accent wand (0.183), below the lowest static (0.355). */
  speckNoise: 0.25,
  /** Lone pixels per 100 cells of the picture: 20 dots on a 16×16 icon. Twice the 10-accent wand (5.1), half the lowest static (16.4 for static-item, 35.5 for noise-block). */
  speckDots: 8,
  /** Distinct tones one can see. good ≥ 4 (gem-item), bad 1 (flat-block, flat-item). */
  tones: 3,
  /** Share of an item's picture that is filled in. good 0.28–0.44 (wand-item, gem-item), bad 1 (brick-item) and 0.016 (speck-item). */
  opaque: [0.06, 0.97],
} as const

/** What one can see on a small picture: how much of it is filled in, how many tones it has and how much of it is noise. */
export function measureSprite(image: { width: number; height: number; pixels: Uint8Array }) {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < image.width && y < image.height && image.pixels[(y * image.width + x) * 4 + 3]! >= 128 ? [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)] : null)
  const cells = Array.from({ length: image.width * image.height }, (_, index) => ({ x: index % image.width, y: Math.floor(index / image.width), color: at(index % image.width, Math.floor(index / image.width)) }))
  const shown = cells.flatMap((cell) => (cell.color ? [{ ...cell, color: cell.color }] : []))
  const tones = shown.reduce<{ color: number[]; count: number }[]>((made, cell) => {
    const match = made.find((tone) => colorDistance(tone.color, cell.color) < 0.03)
    if (match) match.count += 1
    return match ? made : [...made, { color: cell.color, count: 1 }]
  }, [])
  // All eight neighbours: a one-pixel diagonal line (a wand, a blade) and a dither have like-coloured pixels at their corners; static has none.
  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  const beside = (cell: (typeof shown)[number]) => STEPS.flatMap((step) => ((other) => (other ? [other] : []))(at(cell.x + step[0]!, cell.y + step[1]!)))
  const inner = shown.filter((cell) => beside(cell).length >= 3)
  const lone = inner.filter((cell) => beside(cell).every((other) => colorDistance(cell.color, other) >= 0.1))
  return {
    width: image.width,
    height: image.height,
    /** Share of the picture that is filled in (not transparent). */
    opaqueShare: round(shown.length / Math.max(1, cells.length)),
    /** Distinct tones, counting only those on at least two pixels and one pixel in a hundred. */
    tones: tones.filter((tone) => tone.count >= Math.max(2, shown.length * 0.01)).length,
    /** Share of pixels that match none of their neighbours: lone specks and static. */
    speckShare: round(lone.length / Math.max(1, inner.length)),
    /** How many pixels that is, for every 100 cells of the picture, empty ones included. */
    speckDensity: round((lone.length * 100) / Math.max(1, cells.length)),
  }
}
type Sprite = ReturnType<typeof measureSprite>

/**
 * The rules of a block's or an item's picture that the maker's part sheet answers with a reason (`justified`, `what` the rule's id; `reviewAsset` sets them aside with `answerCraft`).
 * Owner's rule: a legitimate subject must always have a legal way out, and a gate stops only on what a player would obviously see as an error. Whether the measured thing is a fault depends
 * on WHAT THE THING IS, which a number cannot know and the reviewer can judge against the pictures, with the reason shown to the person.
 * - `few_tones` (craft): white concrete, glass, a smooth plaster are one or two tones on purpose.
 * - `noisy_texture` (defect, kept a defect): gravel, ore, a starry sky are speckled on purpose. Not re-graded to craft: its limit (`SPRITE_LIMITS.speckShare`) lies between the accepted ore (0.016) and
 *   television static (0.355) of our own specimens, and no specimen of the game's own gravel or dirt exists to measure it against (every picture in the specimens is drawn here), so nothing shows
 *   that the limit is a matter of craft; what is shown is that a speckled subject exists, hence a way out by a reason and not by a grade.
 * - `icon_fills_square` (defect, kept a defect): a card, a painting, a tile is the whole square on purpose; the same way out as a model's `no_face`.
 * Every other rule of these two kinds (an icon too faint to see, a hole in a solid block) is a fault whatever the thing is, and is only changed.
 */
export const SPRITE_ANSWERS: readonly string[] = ["few_tones", "noisy_texture", "icon_fills_square"]

/** The rules of `SPRITE_ANSWERS` end their fix the way a model's craft finding does: change it, or answer it with a reason in the part sheet's `justified`. */
const answering = <M extends object>(rules: Rule<M>[]): Rule<M>[] =>
  rules.map((rule) => (SPRITE_ANSWERS.includes(rule.id) ? { ...rule, find: (look: M) => { const found = rule.find(look); return found && (found.advice ? found : { ...found, fix: `${found.fix.replace(/[。.]$/, "")}，再看一版；${justifyTail(rule.id)}` }) } } : rule))

const spriteRules = (subject: string): Rule<Sprite>[] => [
  defect("noisy_texture", "not_mechanical", "同一种颜色成块出现，不能是一片互不相连的杂点", (sprite) =>
    sprite.speckShare > SPRITE_LIMITS.speckNoise && sprite.speckDensity >= SPRITE_LIMITS.speckDots
      ? { message: `${subject}的图上到处是孤立的杂点（每 100 个像素里约 ${Math.round(sprite.speckShare * 100)} 个和四周都不一样），缩到背包格子那么小就是一片噪点。`, fix: "改成成块的深浅：同一种颜色至少连着两三个像素。" }
      : sprite.speckShare > SPRITE_LIMITS.speckShare
        ? { advice: true, message: `${subject}的图上有几个孤立的点（每 100 个像素里约 ${Math.round(sprite.speckShare * 100)} 个和四周都不一样）。如果是有意点上去的高光、宝石、铆钉就没问题；如果只是画碎了，把它们并成两三个像素的小块会更清楚。`, fix: "放到背包格子那么大看一眼，决定留不留。" }
        : null,
    (sprite) => `孤立的杂点占 ${pct(sprite.speckShare)}（超过 ${pct(SPRITE_LIMITS.speckNoise)} 且成片才不合格，超过 ${pct(SPRITE_LIMITS.speckShare)} 列为建议）`,
  ),
  craft("few_tones", "hierarchy", `至少看得出 ${SPRITE_LIMITS.tones} 种深浅：亮面、本色、暗面`, (sprite) =>
    sprite.tones < SPRITE_LIMITS.tones ? { message: `${subject}的图只看得出 ${sprite.tones} 种颜色，没有明暗。`, fix: `至少画出 ${SPRITE_LIMITS.tones} 种深浅：亮面、本色、暗面，让它看起来有体积。` } : null,
    (sprite) => `看得出 ${sprite.tones} 种颜色（至少 ${SPRITE_LIMITS.tones} 种）`,
  ),
]

/**
 * What is counted on a block's or an item's picture and said with every look (`texture-facts.ts`), under the
 * criterion it bears on. Facts for whoever looks, never a refusal: the rules above stay the only hard faults.
 */
const FLAT_TOLD = {
  block: {
    reads: `它按游戏里的实际大小画出来是什么样（离它 ${TEXTURE_SEEN.distance} 格远，一格约 ${TEXTURE_SEEN.block} 个屏幕像素）`,
    hierarchy: "用了几种颜色、最大的一整块纯色占多少、最暗到最亮相差多少",
    not_mechanical: "相邻的像素有多少颜色不一样（大块平涂还是细碎）；一张挨一张铺开时，接缝两边的差别是图里面的几倍",
    fits: "这台电脑上装了游戏本体时，同样几项数在周围的原版方块上是多少；它长在哪种石头里，有多少像素和那种石头颜色相近",
  },
  item: {
    reads: `它在背包格子里按实际大小画出来是什么样（图标 ${TEXTURE_SEEN.icon}×${TEXTURE_SEEN.icon} 个屏幕像素，小一号时 ${TEXTURE_SEEN.small}×${TEXTURE_SEEN.small}），填了格子的多少`,
    hierarchy: "用了几种颜色、最大的一整块纯色占多少、最暗到最亮相差多少",
    not_mechanical: "相邻的像素有多少颜色不一样（大块平涂还是细碎）",
    fits: "这台电脑上装了游戏本体时，同样几项数在原版物品上是多少",
  },
} as const

/** An item's own picture. An item without one is drawn as a plain square of its colour and has nothing to measure. */
export const ITEM_STANDARD: KindStandard<Sprite> = {
  kind: "item",
  label: "物品",
  rules: answering<Sprite>([
    defect("icon_fills_square", "reads", "图标有自己的轮廓：四周留出透明，不能把整个格子填满", (sprite) =>
      sprite.opaqueShare > SPRITE_LIMITS.opaque[1] ? { message: "物品图标把整个格子填满了，看起来是一块方砖，不像一件物品。", fix: "画出物品自己的轮廓，四周留出透明的边。" } : null,
      (sprite) => `图标占了格子的 ${pct(sprite.opaqueShare)}（超过 ${pct(SPRITE_LIMITS.opaque[1])} 不合格）`,
    ),
    defect("icon_too_faint", "reads", "图标在背包格子里看得清：不能只有零星几个像素", (sprite) =>
      sprite.opaqueShare < SPRITE_LIMITS.opaque[0] ? { message: `物品图标只画了零星几个像素（不到整张图的 ${Math.round(SPRITE_LIMITS.opaque[0] * 100)}%），在背包格子里几乎看不见。`, fix: "把物品画大，占到格子的四分之一以上。" } : null,
      (sprite) => `图标占了格子的 ${pct(sprite.opaqueShare)}（不到 ${pct(SPRITE_LIMITS.opaque[0])} 不合格）`,
    ),
    ...spriteRules("物品图标"),
  ]),
  unmeasured: {
    earns_place: "图标上哪些像素是多余的，还量不了",
    sound: "物品没有结构可言",
    fits: "图标像不像它的名字、和原版物品放在一起协不协调，工具下不了结论：由看图的 AI、没有参与制作的评审和人自己看",
  },
  told: FLAT_TOLD.item,
}

/** A block's own face picture. A block without one is a plain cube of its colour and has nothing to measure. */
export const BLOCK_STANDARD: KindStandard<Sprite & { shaped?: boolean }> = {
  kind: "block",
  label: "方块",
  rules: answering<Sprite & { shaped?: boolean }>([
    ...spriteRules("方块贴图"),
    // A block that is boxes put together is drawn on a sheet that is empty wherever no face is, and cut out in the game: the holes are the design.
    defect("block_has_holes", "sound", "方块贴图要铺满：不能有透明的像素（有外形的方块除外：它的 sheet 本来就有空白）", (sprite) =>
      !sprite.shaped && sprite.opaqueShare < 1 ? { message: "方块贴图上有透明的像素。实心方块不透光，这些地方在游戏里会变成黑洞。", fix: "把透明的像素都填上颜色。" } : null,
      (sprite) => (sprite.shaped ? "这个方块有自己的外形，空白本来就是设计，没有查透明的像素" : `透明的像素占 ${pct(1 - sprite.opaqueShare)}（实心方块要是 0%）`),
    ),
  ]),
  unmeasured: {
    earns_place: "贴图上哪些像素是多余的，还量不了",
    reads: "方块像不像它的名字，工具下不了结论：由看图的 AI、没有参与制作的评审和人自己看",
    fits: "方块贴图和周围的世界协不协调、和掉落、工具对不对得上，工具下不了结论：由看图的 AI、评审和人自己看",
  },
  told: FLAT_TOLD.block,
}

/** Limits of the standalone-animation rules. Margins measured on test/fixtures/acceptance. */
export const ANIMATION_LIMITS = {
  /** Degrees a track must span to count as moving at all. good ≥ 12 (tail-sway), bad 0 (frozen-animation). */
  moving: 0.5,
  /** Degrees from which a swing is big enough that constant speed shows: the stride of a creature's own walk. good 48 and eased (tail-sway), bad 60 at constant speed (robot-swing). */
  swing: MOTION_MEASURES.swing,
  /** Degrees per game tick (0.05 s) a part may turn: the cast action's limit. good ≤ 3.4 (tail-sway), bad 180 (snap-animation). */
  turn: GESTURE_GATE.turn,
} as const

type AnimationMeasured = { tracks: number; still: string[]; swinging: string[]; stiff: string[]; fastest: number; unknown: string[]; skeleton: boolean }

/** A single animation's tracks, and — when the model it is for is known — whether its bones exist there. */
export function measureAnimation(animation: Document<"animation">, model: Document<"model"> | null): AnimationMeasured {
  const tracks = animation.channels.map((channel) => ({
    bone: channel.bone,
    ...motion(channel.keyframes),
    // A part that moves or scales is not standing still, whatever it turns.
    shifts: shiftsOrScales(channel),
    fastest: Math.max(0, ...channel.keyframes.slice(1).map((frame, index) => (Math.max(...frame.rotation.map((value, axis) => Math.abs(value - channel.keyframes[index]!.rotation[axis]!))) / (frame.time - channel.keyframes[index]!.time)) * 0.05)),
  }))
  return {
    tracks: tracks.length,
    still: tracks.filter((track) => track.span < ANIMATION_LIMITS.moving && !track.shifts).map((track) => track.bone),
    swinging: tracks.filter((track) => track.span >= ANIMATION_LIMITS.swing).map((track) => track.bone),
    stiff: tracks.filter((track) => track.span >= ANIMATION_LIMITS.swing && !track.eased).map((track) => track.bone),
    /** The most any part turns in one game tick, in degrees. */
    fastest: round(Math.max(0, ...tracks.map((track) => track.fastest))),
    unknown: model ? animation.channels.map((channel) => channel.bone).filter((bone) => !model.bones.some((value) => value.name === bone)) : [],
    skeleton: model !== null,
  }
}

export const ANIMATION_STANDARD: KindStandard<AnimationMeasured> = {
  kind: "animation",
  label: "动画",
  rules: [
    defect("nothing_moves", "earns_place", "动作要真的让部件动起来，不能每条轨道都从头到尾不变", (measured) =>
      measured.still.length === measured.tracks ? { message: "这个动作里每一条轨道从头到尾都没有变化，播出来什么都不动。", fix: "至少让一根骨骼的角度随时间变化。" } : null,
      (measured) => `${measured.tracks - measured.still.length} / ${measured.tracks} 条轨道在动`,
    ),
    craft("constant_speed", "not_mechanical", "大幅度的摆动到头要慢下来，不能匀速来回", (measured) =>
      measured.stiff.length > 0 && measured.stiff.length * 2 >= measured.swinging.length
        ? { message: `这些骨骼是匀速来回摆的，像机器人：${list(measured.stiff)}。`, fix: "在摆到两头的位置附近各加一个关键帧，让它到头时慢下来、经过中间时最快。", evidence: measured.stiff }
        : null,
      (measured) => (measured.swinging.length ? `大幅摆动的 ${measured.swinging.length} 根骨骼里，匀速的有 ${measured.stiff.length} 根（过半不合格）` : "没有大幅摆动的轨道，用不着查匀速"),
    ),
    defect("teleport", "sound", "一刻（0.05 秒）之内不能转过 90 度，不能像瞬移", (measured) =>
      measured.fastest > ANIMATION_LIMITS.turn ? { message: `有一处转得太快，像瞬移（0.05 秒里转了约 ${Math.round(measured.fastest)} 度）。`, fix: `0.05 秒里最多转 ${ANIMATION_LIMITS.turn} 度：把这两个关键帧的时间拉开，或者减小角度。` } : null,
      (measured) => `转得最快的一处，0.05 秒里转了 ${Math.round(measured.fastest)} 度（超过 ${ANIMATION_LIMITS.turn} 度不合格）`,
    ),
    defect("unknown_bones", "fits", "只用它依赖的模型里真的有的骨骼", (measured) =>
      measured.unknown.length > 0 ? { message: `动画用到了模型里没有的骨骼：${list(measured.unknown)}。`, fix: "只用依赖模型里已有的骨骼名字。", evidence: measured.unknown } : null,
      (measured) => (measured.skeleton ? `动画用到的骨骼里，模型里没有的有 ${measured.unknown.length} 根` : "没有可以对照的模型，这一条没有查"),
    ),
  ],
  unmeasured: {
    reads: "一个单独的动作像不像它的名字，量不了，由人自己看",
    hierarchy: "不知道这个动作里谁是主要部位，量不了主次",
  },
  told: CONTINUITY_TOLD,
}

type EntityMeasured = { partCombatIssues?: { message: string }[]; behavior: Document<"entity">["behavior"]; speed: number; /** It stays where it is on purpose (`stationary`, with its reason): a speed of 0 is what it means, not a defect. */ stationary: boolean; attack: number; explodes: boolean; /** broad5: it has abilities whose hits do damage, which hurt the player as well as a melee attack. */ abilities: boolean; /** The moving clip of the model it wears that carries the body over the ground with no foot stepping, at its own walking speed; null when it does not (or is not known). */ glide: { clip: string; supports: number; speed: number } | null; /** Every part of its model that an ability of it names and the model lacks, as the sentence for it (`boneIssues`); empty when none, or when the model is not known. */ missingBones: { text: string; fix: string }[]; /** Every vanilla particle and sound its abilities and its boss's show name that the game version of the project's target lacks (`creatureVanillaGaps`); empty when none. */ versionGaps: { text: string; fix: string }[] }
/** The rules of a creature that its own `justified` answers: only how it walks (`walk_glides`); an ability's measured faults are answered where they are measured (`hitLines`). */
export const ENTITY_ANSWERS: readonly string[] = ["walk_glides"]
export const ENTITY_STANDARD: KindStandard<EntityMeasured> = {
  kind: "entity",
  label: "生物",
  rules: [
    // Why this is the creature's own rule and cannot be answered with `justified`: the build refuses an ability that counts from a part its model lacks (it could not be played as written), so a creature that
    // names one would be accepted here and then stop the whole project's build. The same function (`boneIssues`) words it at the look, the draft, this commit and the build.
    defect<EntityMeasured>("ability_bone_missing", "fits", "招式写到的出手部位（bone），模型里要真的有这个部件", (entity) =>
      entity.missingBones.length ? { message: entity.missingBones.map((issue) => issue.text).join(""), fix: entity.missingBones[0]!.fix, evidence: entity.missingBones.map((issue) => issue.text) } : null,
      (entity) => `招式用到的部位里，模型里缺的有 ${entity.missingBones.length} 个`,
    ),
    // Like a missing part: the build of the project's target refuses a particle or sound its game lacks (`version-lacks.ts`), so it is refused here, when it is handed in, in
    // the same words, and not when the whole project is built (the UI run of 2026-11-15: a Forge 1.20.1 golem with `dust_plume` passed every review and stopped its build).
    defect<EntityMeasured>("target_lacks_vanilla", "fits", "招式和 Boss 演出用到的原版粒子、声音，这个工程的游戏版本里要有", (entity) =>
      entity.versionGaps.length ? { message: entity.versionGaps.map((gap) => gap.text).join(""), fix: entity.versionGaps[0]!.fix, evidence: entity.versionGaps.map((gap) => gap.text) } : null,
      (entity) => (entity.versionGaps.length ? `用到了这个版本没有的原版粒子或声音 ${entity.versionGaps.length} 个` : "用到的原版粒子和声音，这个版本都有"),
    ),
    defect<EntityMeasured>("hitbox_combat_invalid", "fits", "部位倍率按实际阶段生效；弱点有暴击反馈、零倍率有格挡反馈；接触伤害只在已有招式的有效时间窗内生效，同一招对同一玩家只打一次", (entity) =>
      entity.partCombatIssues?.length ? { message: entity.partCombatIssues.map((issue) => issue.message).join("；"), fix: "改对部位倍率的阶段编号、接触伤害的招式 id 和时间窗；阶段 0 是初始阶段，时间窗不能超出招式长度。" } : null,
      (entity) => entity.partCombatIssues?.length ? `部位战斗设置有 ${entity.partCombatIssues.length} 处不能执行` : "部位倍率、阶段编号和接触伤害时间窗有效；反馈与每招一次由生成的运行时执行",
    ),
    defect<EntityMeasured>("hostile_but_harmless", "fits", "敌对的生物要伤得到人：有攻击力、有会伤人的招式，或者会爆炸", (entity) =>
      entity.behavior === "hostile" && entity.attack === 0 && !entity.explodes && !entity.abilities ? { message: "这只生物是敌对的，但攻击力是 0，没有会伤人的招式，也不会爆炸，追上玩家什么都做不了。", fix: "给它一个大于 0 的攻击力、一个会伤人的招式，或者配上爆炸；不想让它伤人就把行为改成被动或跟随。" } : null,
      (entity) => (entity.behavior === "hostile" ? `攻击力 ${entity.attack}${entity.explodes ? "，会爆炸" : ""}${entity.abilities ? "，有会伤人的招式" : ""}` : "它不是敌对的，用不着查能不能伤人"),
    ),
    defect<EntityMeasured>("chases_but_cannot_move", "fits", "会靠近玩家的生物要走得动：速度大于 0（写了 stationary 和原因、故意守在原地的除外）", (entity) =>
      entity.behavior !== "passive" && entity.speed === 0 && !entity.stationary ? { message: "这只生物会靠近玩家，但移动速度是 0，一步也走不了。", fix: "给它一个大于 0 的速度，或者把行为改成被动；它本来就该守在原地（炮塔、哨兵）的话，写上 stationary 和原因。" } : null,
      (entity) => (entity.behavior === "passive" ? "它是被动的，不会靠近玩家，用不着查速度" : `移动速度 ${entity.speed}${entity.stationary ? "（写明了故意守在原地）" : ""}`),
    ),
    // Why this is a defect of the creature and not only of its model: a model is made before the creature that wears it, so at the model stage the walking speed is unknown and its maker may declare the walk clip still;
    // here the speed is known. A creature that walks plays its walk clip whenever it moves, so a walk with no stepping foot is a body dragged over the ground; flight does not excuse it, a flier lands and walks.
    defect<EntityMeasured>("walk_glides", "fits", "会走动的生物（没有写 stationary），模型里它走路时放的动作要有往后蹬的脚，不能整个在地上平移", (entity) =>
      entity.glide
        ? {
            message: `这只生物会走动（每秒约 ${Number(entity.glide.speed.toFixed(1))} 格），可它的模型里${motionLabel(entity.glide.clip)}这段动作的毛病是：${CONTINUITY_WORDS.glide}（着地的部件有 ${entity.glide.supports} 个，都没有往后蹬）：游戏里它一动就放这段动作，走起来就是摆着姿势被拖着走。`,
            // The creature's maker cannot change the model: say what it can do (stationary with a reason, or answer with `justified`) and what then needs the model redone.
            fix: `这只生物这一步改不了模型。它本来就从不走动（炮塔、哨兵），就给它写上 stationary 和原因；它走起来本来就是这样滑着走的（蜗牛、幽灵、史莱姆），就在这只生物文档的 justified 里写上这一项和理由（{"what":"walk_glides","reason":"……"}），理由会原样给评审和人看；都不是的话，就是模型的走路动作要重做：${FAULT_FIX.glide}，请到「模组总览」里打开它的模型，点「重做」，再回来做这只生物。`,
          }
        : null,
      (entity) => (entity.stationary ? "它写明了从不走动，没有查走路的动作" : entity.glide ? `走路动作里着地的 ${entity.glide.supports} 个部件都没有往后蹬` : "模型走路时有往后蹬的脚，或者模型还没法对照，没有发现平移"),
    ),
  ],
  unmeasured: {
    earns_place: "生物规则是一组数值，没有可以凑数的内容",
    not_mechanical: "生物规则是一组数值，没有花纹和动作",
    reads: "生物长什么样在它的模型那边检查",
    hierarchy: "数值强弱合不合适，量不了，由人自己试玩",
    sound: "生物站不站得住在它的模型那边检查",
  },
}

type RecipeMeasured = { selfMade: boolean; count: number; stack: number | null; twin: string | null }
export const RECIPE_STANDARD: KindStandard<RecipeMeasured> = {
  kind: "recipe",
  label: "配方",
  rules: [
    defect<RecipeMeasured>("makes_itself", "fits", "材料和产物对得上：材料里不能有产物自己", (recipe) =>
      recipe.selfMade ? { message: "这个配方的材料里就有它要做的东西，等于拿自己做自己。", fix: "换掉材料里的产物，或者换一个产物。" } : null,
      (recipe) => (recipe.selfMade ? "材料里有产物自己" : "材料里没有产物自己"),
    ),
    defect<RecipeMeasured>("more_than_a_stack", "fits", "一次做出的数量不能超过产物一格放得下的数量", (recipe) =>
      recipe.stack !== null && recipe.count > recipe.stack ? { message: `一次做出 ${recipe.count} 个，但这样东西一格最多只能放 ${recipe.stack} 个。`, fix: `把数量改到 ${recipe.stack} 以内，或者调大产物的堆叠上限。` } : null,
      (recipe) => (recipe.stack === null ? `一次做出 ${recipe.count} 个；不知道产物一格放几个，这一条没有查` : `一次做出 ${recipe.count} 个，产物一格最多放 ${recipe.stack} 个`),
    ),
    defect<RecipeMeasured>("same_grid_as_another", "fits", "同一种摆法只能属于一个配方", (recipe) =>
      recipe.twin ? { message: `这种摆法已经被另一个配方「${recipe.twin}」用了，游戏里只会做出其中一个。`, fix: "换一种摆法，或者改掉另一个配方。", evidence: [recipe.twin] } : null,
      (recipe) => (recipe.twin ? `和配方「${recipe.twin}」的摆法一样` : "没有别的配方和它摆法一样"),
    ),
  ],
  unmeasured: {
    earns_place: "一个配方有没有用，量不了，由人自己试玩",
    not_mechanical: "配方是一张九宫格，没有花纹和动作",
    reads: "配方的摆法像不像产物，量不了，由人自己看",
    hierarchy: "材料贵贱和产物值不值，量不了，由人自己试玩",
    sound: "材料和产物是否存在由保存时的格式检查保证，这里不再重复",
  },
}

type LogicMeasured = { animation: string | null; known: string[] | null }
export const LOGIC_STANDARD: KindStandard<LogicMeasured> = {
  kind: "logic",
  label: "逻辑",
  rules: [
    defect<LogicMeasured>("plays_unknown_animation", "fits", "要播放的动作必须是这只生物的模型里有的", (logic) =>
      logic.animation !== null && logic.known !== null && !logic.known.includes(logic.animation)
        ? { message: `规则要播放动作「${logic.animation}」，但这只生物的模型里没有这个动作（它有：${logic.known.join("、")}）。`, fix: "改成模型里已有的动作名，或者先给模型加上这个动作。", evidence: [logic.animation] }
        : null,
      (logic) => (logic.animation === null ? "这条规则不播放动作" : logic.known === null ? `要播放动作「${logic.animation}」；不知道模型里有哪些动作，这一条没有查` : `要播放动作「${logic.animation}」，模型里有 ${logic.known.length} 个动作`),
    ),
  ],
  unmeasured: {
    earns_place: "一条规则有没有用，量不了，由人自己试玩",
    not_mechanical: "规则没有花纹和动作",
    reads: "规则好不好懂，量不了",
    hierarchy: "规则之间的轻重，量不了",
    sound: "实体和物品是否存在由保存时的格式检查保证，这里不再重复",
  },
}

type GameplayMeasured = { bounds: GameplayFinding[]; references: GameplayFinding[]; compile: GameplayCheck["compile"] }
const some = (findings: GameplayFinding[]) => `${findings.slice(0, 6).map(findingLine).join(" ")}${findings.length > 6 ? `（还有 ${findings.length - 6} 处）` : ""}`
/**
 * Gameplay code against the standard. 站得住 is what a machine can hold it to: in bounds, and compiling
 * (the compiler runs in the making loop; its result is read here when the caller has it). 配得上 is that
 * everything it points at is real. Whether the code does what its description says is the independent
 * reviewer's question, and whether it plays right is the person's own play-test: neither is measured here.
 */
export const GAMEPLAY_STANDARD: KindStandard<GameplayMeasured> = {
  kind: "gameplay",
  label: "玩法",
  rules: [
    defect<GameplayMeasured>("out_of_bounds", "sound", "代码只在游戏里面起作用：不碰电脑上的文件、网络和别的程序，不用反射、类加载、线程和 mixin，只写在自己的包里", (gameplay) =>
      gameplay.bounds.length ? { message: `代码越界了（${gameplay.bounds.length} 处）：${some(gameplay.bounds)}`, fix: "逐条照上面说的改；越界的代码不会保存。", evidence: gameplay.bounds.map((finding) => finding.rule), plain: `代码越界了（${gameplay.bounds.length} 处）：${plainFindings(gameplay.bounds)}` } : null,
      (gameplay) => `越界的地方 ${gameplay.bounds.length} 处`,
    ),
    defect<GameplayMeasured>("does_not_compile", "sound", "代码能和工程生成的代码一起编译通过", (gameplay) =>
      gameplay.compile && !gameplay.compile.ok ? { message: `代码编译不过：${gameplay.compile.findings.length ? some(gameplay.compile.findings) : (gameplay.compile.detail ?? gameplay.compile.note ?? "编译器报了错。")}`, fix: "照编译器指出的文件和行改，再检查一次。", plain: `代码编译不过：${gameplay.compile.findings.length ? plainFindings(gameplay.compile.findings) : (gameplay.compile.note ?? "编译器报了错。")}` } : null,
      (gameplay) => (gameplay.compile ? (gameplay.compile.ok ? "和工程的代码一起编译通过了" : "编译没有通过") : "这一次没有编译，这一条没有查"),
    ),
    defect<GameplayMeasured>("broken_reference", "fits", "它用到的每样东西都在这个工程里，数据文件读得出来，显示的文字两种语言都有", (gameplay) =>
      gameplay.references.length ? { message: `引用对不上（${gameplay.references.length} 处）：${some(gameplay.references)}`, fix: "逐条照上面说的改。", evidence: gameplay.references.map((finding) => finding.rule), plain: `引用对不上（${gameplay.references.length} 处）：${plainFindings(gameplay.references)}` } : null,
      (gameplay) => `对不上的引用 ${gameplay.references.length} 处`,
    ),
  ],
  unmeasured: {
    earns_place: "一个玩法有没有用、好不好玩，量不了，由人自己进游戏试",
    not_mechanical: "玩法是规则和代码，没有花纹和动作",
    reads: "代码做的是不是说明里写的那样，由没有参与编写的评审对照说明和代码核对，最后由人自己进游戏试；工具量不了",
    hierarchy: "数值强弱合不合适，量不了，由人自己进游戏试",
  },
}

const DESIGN_ONLY = "这一类只是设计稿，不进游戏，没有可以量的东西，由人自己看"
const designOnly = (kind: ModuleKind, label: string): StandardOutline => ({ kind, label, rules: [], unmeasured: { earns_place: DESIGN_ONLY, not_mechanical: DESIGN_ONLY, reads: DESIGN_ONLY, hierarchy: DESIGN_ONLY, sound: DESIGN_ONLY, fits: DESIGN_ONLY } })

/** Every asset kind against the standard: what is asked of it and what is honestly not measured yet. */
export const ASSET_STANDARDS: Record<ModuleKind, StandardOutline> = {
  model: outlineOf(MODEL_STANDARD),
  texture: outlineOf(TEXTURE_STANDARD),
  animation: outlineOf(ANIMATION_STANDARD),
  gesture: outlineOf(GESTURE_STANDARD),
  item: outlineOf(ITEM_STANDARD),
  block: outlineOf(BLOCK_STANDARD),
  entity: outlineOf(ENTITY_STANDARD),
  recipe: outlineOf(RECIPE_STANDARD),
  logic: outlineOf(LOGIC_STANDARD),
  worldview: designOnly("worldview", "世界观"),
  biome: designOnly("biome", "群系"),
  dimension: designOnly("dimension", "维度"),
  terrain: designOnly("terrain", "地形"),
  gameplay: outlineOf(GAMEPLAY_STANDARD),
  effect: EFFECT_STANDARD,
  sound: SOUND_STANDARD,
  music: { ...SOUND_STANDARD, kind: "music", label: "音乐", unmeasured: { ...SOUND_STANDARD.unmeasured, fits: "前奏与循环是否衔接自然、是否适合这场战斗，要在游戏中试听。" } },
  particle: PARTICLE_STANDARD,
  bossbar: BOSS_BAR_STANDARD,
  fixture: FIXTURE_STANDARD,
  ability: ABILITY_ASSET_STANDARD,
  book: BOOK_STANDARD,
}

export type AssetReviewContext = ReviewContext & {
  /** The model tier chosen for the run, if any. */
  complexity?: ModelComplexity
  /** A person's own saved version that this AI work replaces. */
  revises?: Pick<WorkspaceAsset, "id" | "module" | "document" | "dependencies"> | null
  /** Assets the work was made against that its own dependency list may not name yet. */
  against?: readonly Pick<WorkspaceAsset, "id" | "document">[]
  /** Not saved yet: judged by itself, not on whatever the saved version is wearing. */
  candidate?: boolean
  /** The saved model resolved by a production task. Null means the task has no ready model. */
  entityModel?: Document<"model"> | null
  /** Gameplay: what the compiler said about this very version, when the caller has it. Left out, compiling is not held here. */
  compiled?: GameplayCheck["compile"]
  taskKey?: string | null
}
type Judged = Pick<WorkspaceAsset, "id" | "module" | "document" | "dependencies">

const models = (assets: readonly Pick<WorkspaceAsset, "id" | "document">[]) => assets.flatMap((asset) => (asset.document.kind === "model" ? [asset.document] : []))
const sprite = (source: string) => measureSprite(decodeRgbaPng(decodeTextureDataUrl(source)))
const trimmed = (pattern: readonly (string | null)[]) => {
  const cells = pattern.flatMap((value, index) => (value ? [{ row: Math.floor(index / 3), column: index % 3, value }] : []))
  return cells.map((cell) => `${cell.row - Math.min(...cells.map((value) => value.row))},${cell.column - Math.min(...cells.map((value) => value.column))}=${cell.value}`).join("|")
}

/**
 * The acceptance review of one asset in its project: the same function for the app's own AI, an outside
 * AI's hand-in and the card a person reads. It measures what the kind can measure and leaves the verdict
 * to the standard. `asset` may be a document that is not saved yet.
 */
export function reviewAsset(project: Project, asset: Judged, context: AssetReviewContext = {}): AssetReview {
  const document = asset.document
  const assets = project.workspace.assets
  const brief = context.brief
  const revises = context.revises && context.revises.document.kind === document.kind ? context.revises : null
  const hold = (): { level: Level; spared: boolean } => holdFor(context, revises ? () => reviewAsset(project, revises, { candidate: true }).passed : null)
  const linked = [...(context.against ?? []), ...assets.filter((value) => asset.dependencies.includes(value.id))]
  const advisory = (review: AssetReview, model: Pick<ModelDesign, "bones" | "follow"> | null = null) => {
    const { hints } = assetDesignNotes(project, document, model, context.taskKey)
    const title = "name" in document && typeof document.name === "string" ? document.name : assets.find((entry) => entry.id === asset.id)?.title ?? asset.id
    return hints.length ? { ...review, advice: [...(review.advice ?? []), ...hints.map((issue): Finding => ({
      criterion: "reads", severity: "craft", rule: issue.rule, message: issue.text, fix: issue.fix, refs: [...(issue.refs ?? []), assetRef(asset.id, title)],
    }))] } : review
  }
  if (document.kind === "model") {
    if (isItemOnlyModel(project, asset.id)) {
      const { kind: _kind, ...design } = document
      return reviewStaticItemModel(design, context)
    }
    const own = reviewModelQuality(document, { brief, asked: context.asked, insisted: context.insisted, justified: context.justified, complexity: context.complexity, previous: revises?.document.kind === "model" ? revises.document : null })
    // A creature that wears a texture of its own is seen in that texture, so the model's own paint is not what is judged.
    const skin = context.candidate
      ? undefined
      : assets
          .flatMap((value) => (value.document.kind === "entity" && value.document.model_asset_id === asset.id ? [value.document.runtime.texture_asset_id] : []))
          .flatMap((id) => assets.filter((value) => value.id === id))
          .flatMap((value) => (value.document.kind === "texture" && value.document.width === document.texture_size ? [value.document] : []))[0]
    if (!skin || own.unreadable) return advisory(own)
    // The texture's review has answered its own findings (`answerCraft`): the reasons of those it answered travel with the model's, so the person reads them too.
    const dressed = reviewTextureQuality(document, skin, { brief, asked: context.asked, insisted: context.insisted, justified: context.justified })
    const review = rejudged(own, ASSET_STANDARDS.model, [...own.findings.filter((finding) => !SURFACE_RULES.includes(finding.rule)), ...dressed.findings.filter((finding) => SURFACE_RULES.includes(finding.rule))])
    const answered = [...(own.answered ?? []).filter((value) => !SURFACE_RULES.includes(value.rule)), ...(dressed.answered ?? []).filter((value) => SURFACE_RULES.includes(value.rule))]
    // The same for what the measure was unsure of: the texture's advice about the surface stands in for the model's own.
    const advice = [...(own.advice ?? []).filter((value) => !SURFACE_RULES.includes(value.rule)), ...(dressed.advice ?? []).filter((value) => SURFACE_RULES.includes(value.rule))]
    const { answered: _own, advice: _advice, ...plain } = review
    return advisory({ ...plain, ...(answered.length ? { answered } : {}), ...(advice.length ? { advice } : {}) })
  }
  if (document.kind === "texture") {
    // The model it dresses: one it was made against, else the model of a creature that wears it. One of its own size first.
    const wearer = assets.find((value) => value.document.kind === "entity" && value.document.runtime.texture_asset_id === asset.id)?.document
    const worn = models([...linked, ...assets.filter((value) => wearer?.kind === "entity" && wearer.model_asset_id === value.id)])
    const model = worn.find((value) => value.texture_size === document.width && value.texture_size === document.height) ?? worn[0]
    if (!model) return unmeasured(ASSET_STANDARDS.texture, "这张贴图没有挂在任何模型上，没有可以贴上去看的东西")
    return reviewTextureQuality(model, document, { brief, asked: context.asked, insisted: context.insisted, justified: context.justified, previous: revises?.document.kind === "texture" ? revises.document : null })
  }
  if (document.kind === "gesture") return reviewGesture(document, context, hold())
  // Code is held in full whoever asked for what: no brief makes out-of-bounds code acceptable.
  if (document.kind === "gameplay") {
    const checks = staticChecks(project, document, asset.id)
    return judge(GAMEPLAY_STANDARD, { ...checks, compile: context.compiled ?? null }, context, { level: "full", spared: false }, { bounds: checks.bounds.length, references: checks.references.length, compiled: context.compiled ? context.compiled.ok : null })
  }
  if (document.kind === "animation") return judge(ANIMATION_STANDARD, measureAnimation(document, models(linked)[0] ?? null), context, hold())
  if (document.kind === "item" || document.kind === "block") {
    const standard = document.kind === "item" ? ITEM_STANDARD : BLOCK_STANDARD
    // A block with a shape is judged on its sheet, the one picture every face is cut from; its own texture is only the colour of the pieces it breaks into.
    const shaped = document.kind === "block" ? document.shape : null
    if (!shaped && document.texture === null) return unmeasured(standard, `这个${standard.label}没有自己的图，游戏里用一块纯色代替；要不要画一张由人决定`)
    const source = shaped ? shaped.sheet : document.texture!
    // Reading a picture that is not a PNG throws; that is a document nobody can judge, not a crash.
    const read = (() => {
      try {
        return sprite(source)
      } catch {
        return null
      }
    })()
    // The part sheet's reasons answer the rules of `SPRITE_ANSWERS` (a plain, a speckled, a full-square subject), as they answer a model's craft: the reason travels with the review to the reviewer and the person.
    return read ? answerCraft(judge(standard, { ...read, shaped: Boolean(shaped) }, context, hold()), context.justified, (finding: Finding) => SPRITE_ANSWERS.includes(finding.rule)) : (shaped ? unreadable(standard, "方块外形的 sheet 不是一张读得出来的 PNG。", "把 shape.sheet 换成一张完整的 PNG 图片（data URL）。") : unreadable(standard, `${standard.label}的图不是一张读得出来的 PNG。`, "换成一张完整的 PNG 图片（data URL），或者不带图，用纯色。"))
  }
  if (document.kind === "entity") {
    // The model it wears, when the project has it and it can be measured; without one nothing is said (the creature stage never refuses for what it cannot see).
    const worn = context.entityModel !== undefined
      ? context.entityModel
      : [...(context.against ?? []), ...assets].find((value) => value.id === document.model_asset_id)?.document
    const speed = walkingSpeed(document.speed)
    // A flier that is never in the mood for the ground and has nothing to come down for never plays its walk on the ground, whatever its model's walk does (`flightWalks`).
    const glide = !document.stationary && flightWalks(document) && worn?.kind === "model" ? glidingWalk(worn, speed) : null
    const review = judge(ENTITY_STANDARD, { partCombatIssues: hitboxCombatIssues(document), missingBones: worn?.kind === "model" ? boneIssues(document, worn).filter((issue) => issue.stops) : [], versionGaps: creatureVanillaGaps(document, targetMinecraft(project.target ?? DEFAULT_TARGET)), behavior: document.behavior, speed: document.speed, stationary: Boolean(document.stationary), glide: glide ? { ...glide, speed } : null, attack: document.attack_damage, explodes: document.runtime.explosion !== null, abilities: (document.hitbox?.parts ?? []).some((part) => (part.contact ?? []).some((contact) => contact.damage > 0)) || expandedMoves(document, { assets: [...(context.against ?? []), ...assets] }).some((ability) => ability.hits.some((hit) => hit.type !== "area" || hit.damage > 0 || hit.effects.length > 0)) }, context, hold())
    // The creature's own `justified` answers `walk_glides` (a snail, a ghost, a slime really slides): the reason is shown to the reviewer and the person. The creature's maker can change
    // neither its model nor the measuring, so without this a legitimate sliding subject would be refused until its task failed. No other rule of the creature is answered this way.
    return advisory(answerCraft(review, document.justified, (finding: Finding) => ENTITY_ANSWERS.includes(finding.rule)), worn?.kind === "model" ? worn : null)
  }
  if (document.kind === "recipe") {
    const [namespace, name] = document.result.split(":")
    const made = namespace === project.mod_id ? name : null
    const stack = made === null ? null : (project.items.find((item) => item.identifier === made)?.max_stack ?? project.blocks.find((block) => block.identifier === made)?.lucky?.max_stack ?? null)
    const twin = project.recipes.find((other) => other.id !== asset.id && (other.type ?? "shaped") === (document.type ?? "shaped") && trimmed(other.pattern) === trimmed(document.pattern) && other.result !== document.result)
    return judge(RECIPE_STANDARD, { selfMade: document.pattern.includes(document.result), count: document.count, stack, twin: twin?.name ?? null }, context, hold())
  }
  if (document.kind === "logic") {
    // A creature shares its id with its model asset; one made by hand has no workspace model and cannot be checked.
    const creature = assets.find((value) => value.id === document.entity_id)?.document
    return judge(LOGIC_STANDARD, { animation: document.animation, known: creature?.kind === "model" ? creature.animations.map((animation) => animation.name) : null }, context, hold())
  }
  // H3: nothing about an effect is refused by a measurement; it is judged by looking, with its measured facts beside the pictures.
  // 任务二 §9: a sound is held to its document's limits when it is saved; whether it sounds right is heard with the play button, not measured.
  if (document.kind === "sound") return unmeasured(ASSET_STANDARDS.sound, "声音好不好要人自己听：保存时量过格式、声道、长度和大小，这里不退回")
  if (document.kind === "effect") return advisory(unmeasured(ASSET_STANDARDS.effect, "效果好不好由看图决定：每次看图都会说出量到的事实，这里不退回"))
  // Boss 能力 11: a particle the same way: its pictures over its life, with its parameters said beside them.
  if (document.kind === "particle") {
    const review=unmeasured(ASSET_STANDARDS.particle,"查看贴图、一生的变化和标准场景，再对照资产用途自评。")
    const advice=particleWarnings(document).map(message=>({criterion:"reads" as const,rule:"particle_visibility",message,fix:"在标准场景里核对日夜效果。"}))
    return advisory(advice.length ? {...review,advice} : review)
  }
  // Boss 能力 12: a fixture the same way: its sides and its two motions are drawn, its size in the game said beside them.
  if (document.kind === "fixture") return unmeasured(ASSET_STANDARDS.fixture, "场地物件好不好由看图决定：每次看图都会画出没点亮和点亮的样子，并说出它在游戏里占多大，这里不退回")
  // Boss 能力 6: a boss bar reaches the game once a boss shows it; until then it waits as a draft, which is not "design only" (the UI run of 2026-11-15 found it said so).
  if (document.kind === "bossbar") return unmeasured(ASSET_STANDARDS.bossbar, "血条好不好由看图决定：保存时检查过底图、图标和名字，哪只 Boss 用上它，它就跟着做进游戏，这里不退回")
  // 技能资产: its timeline, its numbers at two levels and what it is bound to are said with it; whether it is good is tried in the game. What is wrong with it against the project stops it when it is saved and built.
  if (document.kind === "ability") return advisory(unmeasured(ASSET_STANDARDS.ability, `技能好不好要进游戏试：${abilityAssetLines(document).join("")}这里不退回`))
  // 书: whether a page fits is measured when it is checked and built (`book.ts`); whether it reads well is read in the preview.
  if (document.kind === "book") return unmeasured(ASSET_STANDARDS.book, "书好不好要人自己读：每一页按游戏里的排版量过放不放得下，排不下的在检查里报出来，这里不退回")
  // Only the kinds no build makes (worldview, biome, dimension, terrain) are left: they are drafts, and say so.
  return unmeasured(ASSET_STANDARDS[document.kind], DESIGN_ONLY)
}
