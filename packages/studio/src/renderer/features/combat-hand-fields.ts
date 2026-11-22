import { WORDS } from "../words"
import { ABILITY_PARTICLES, ABILITY_SOUNDS } from "@minemods/mod-core/ability-words"
import { BOSS_SHOW_KINDS } from "@minemods/mod-core/boss-show"
import type { WorkspaceAsset } from "@minemods/mod-core/workspace"
import type { CreatureInside } from "./creature-inside-model"
import { at, type Loose } from "./asset-edit-words"

export type CombatEdit =
  | { tab: "moves"; id: string; skill?: true }
  | { tab: "phases"; phase: number }
  | { tab: "shows"; show: "intro" | "death" }

type Choice = { label: string; value: unknown }
export type CombatField = { path: string; label: string; choices?: Choice[]; many?: true; scale?: number; fallback?: number; text?: true }
type Group = { title: string; fields: CombatField[] }
const number = (path: string, label: string, fallback?: number): CombatField => ({ path, label, fallback })
const names = (words: Readonly<Record<string, string>>) => Object.entries(words).map(([value, label]) => ({ value, label }))
const choice = (path: string, label: string, choices: Choice[]): CombatField => ({ path, label, choices })
const group = (title: string, ...fields: CombatField[]): Group => ({ title, fields })
const seconds = (path: string, label: string) => number(path, label + "（秒）")
const row = (value: unknown): Loose => value && typeof value === "object" ? value as Loose : {}
const rows = (value: unknown): Loose[] => Array.isArray(value) ? value.map(row) : []

export function combatAsset(data: CreatureInside, edit: CombatEdit): WorkspaceAsset | undefined {
  if (edit.tab === "moves" && edit.skill) {
    const id = data.doc.shared_abilities?.find(use => use.id === edit.id)?.asset
    return data.project.workspace.assets.find(asset => asset.id === id && asset.document.kind === "ability")
  }
  return data.project.workspace.assets.find(asset => asset.document.kind === "entity" && asset.document.model_asset_id === data.doc.model_asset_id)
}

const shapeLabels = {
  reach: "伸多远（格）", angle: "张开角度（度）", low: "下沿高度（格）", high: "上沿高度（格）",
  inner: "内圈半径（格）", width: "宽度（格）", height: "高度（格）", depth: "深度（格）",
  radius: "半径（格）", length: "长度（格）", forward: "前后偏移（格）", up: "上下偏移（格）", left: "左右偏移（格）",
}
const eventLabels: Record<string, string> = { ...BOSS_SHOW_KINDS, effect: WORDS.effect, hit_fx: "命中反馈", camera: "镜头", sky_tint: "天空颜色", trail: "拖尾", ground: "地面效果" }

function audioParticleFields(data: CreatureInside, document: Loose) {
  const assets = (kind: "particle" | "sound") => data.project.workspace.assets.filter(asset => asset.document.kind === kind)
    .map(asset => ({ label: "工程里 · " + asset.title, value: { asset: asset.id } }))
  const sounds = [...assets("sound"), ...names(ABILITY_SOUNDS)]
  const particles: Choice[] = [...assets("particle"), ...names(ABILITY_PARTICLES)]
  for (const [index, [alias, value]] of Object.entries(row(document.particles)).entries()) {
    const referenced = particles.find(option => JSON.stringify(option.value) === JSON.stringify(value))
    particles.push({ label: "别名 " + (index + 1) + " · " + (referenced?.label ?? "找不到粒子"), value: { alias } })
  }
  return { sounds, particles }
}

function momentFields(value: Loose, path: string, media: ReturnType<typeof audioParticleFields>, motions: Choice[]) {
  const numeric = { at: "开始时间（秒）", until: "结束时间（秒）", seconds: "延续时间（秒）", volume: "音量",
    pitch: "音高", range_blocks: "多远能听到（格）", count: "数量", spread: "散开距离（格）", radius: "半径（格）", strength: "震动强度" }
  return [
    ...Object.entries(numeric).flatMap(([key, label]) => typeof value[key] === "number" ? [number(path + "." + key, label)] : []),
    ...("sound" in value ? [choice(path + ".sound", "声音", media.sounds)] : []),
    ...("particle" in value ? [choice(path + ".particle", "粒子", media.particles)] : []),
    ...("clip" in value ? [choice(path + ".clip", "动作", motions)] : []),
  ]
}

function timeline(move: Loose, prefix: string, media: ReturnType<typeof audioParticleFields>, motions: Choice[]) {
  return [
    ...rows(move.hits).map((hit, i) => {
      const path = prefix + "hits." + i
      const shape = row(hit.shape)
      return group("出手 " + (i + 1), seconds(path + ".at", "出手时间"),
        ...(hit.damage === null || hit.damage === undefined ? [] : [number(path + (typeof hit.damage === "object" ? ".damage.base" : ".damage"), "基本伤害")]),
        ...Object.entries(shapeLabels).flatMap(([key, label]) => key in shape ? [number(path + ".shape." + key, label)] : []))
    }),
    ...rows(move.events).map((event, i) => group("第 " + (i + 1) + " 项 · " + (eventLabels[String(event.type)] ?? "招式里的安排"),
      ...momentFields(event, prefix + "events." + i, media, motions))),
  ]
}

export function combatFields(data: CreatureInside, edit: CombatEdit, document: Loose): Group[] {
  const media = audioParticleFields(data, document)
  const clips = (data.model?.animations ?? []).map(clip => ({ value: clip.name, label: data.motion(clip.name) }))
  const motions = clips.map((clip, index) => clips.some((other, i) => i !== index && other.label === clip.label)
    ? { ...clip, label: clip.label + " " + (index + 1) } : clip)
  const actions = data.actions.map(move => ({ label: move.name, value: move.id }))
  if (edit.tab === "moves" && document.kind === "ability") {
    const cast = row(document.cast)
    return [
      group("共用出手", ...(cast.type === "instant" ? [] : [seconds("cast.seconds", "施放时间")]),
        number(typeof cast.cooldown === "object" ? "cast.cooldown.base" : "cast.cooldown", "基本间隔（秒）"),
        number("reach", "寻找目标的距离（格）"), ...("length" in document ? [seconds("length", "全程")] : [])),
      ...timeline(document, "", media, motions),
    ]
  }

  if (edit.tab === "moves") {
    const local = rows(document.abilities).findIndex(move => move.id === edit.id)
    const shared = rows(document.shared_abilities).findIndex(move => move.id === edit.id)
    if (local < 0 && shared < 0) return []
    const own = local >= 0
    const prefix = own ? "abilities." + local + "." : "shared_abilities." + shared + "."
    const move = row(at(document, prefix.slice(0, -1)))
    const expanded = data.moves.find(move => move.id === edit.id)
    return [
      group("时机和距离",
        ...(own ? [{ path: prefix + "name", label: "招式名字", text: true as const }, seconds(prefix + "length", "全程")] : []),
        choice(prefix + "clip", "动作", motions),
        number(prefix + "windup", "蓄力（秒）", expanded?.windup),
        number(prefix + (own ? "start.cooldown" : "cooldown"), "用完歇多久（秒）", expanded?.start.cooldown),
        number(prefix + "start.min_distance", "最近距离（格）"),
        number(prefix + "start.max_distance", "最远距离（格）"),
        ...(own ? [] : [number(prefix + "damage_scale", "伤害倍率", 1)])),
      // r29c: the size this creature plays the shared ability at; one number when it is written as one, else the three apart.
      ...(own ? [] : [typeof move.scale === "number"
        ? group("按比例缩放", number(prefix + "scale", "整体缩放（倍）", 1))
        : group("按比例缩放",
            number(prefix + "scale.size", "范围和位置（倍）", 1),
            number(prefix + "scale.reach", "冲刺和跳跃的距离（倍）", 1),
            number(prefix + "scale.speed", "冲刺速度（倍）", typeof row(move.scale).reach === "number" ? row(move.scale).reach as number : 1))]),
      ...(own ? timeline(move, prefix, media, motions) : []),
    ]
  }

  if (edit.tab === "phases") {
    const base = "boss.phases." + edit.phase
    const phase = row(at(document, base))
    const lists = Object.hasOwn(phase, "abilities")
      ? [{ ...choice(base + ".abilities", "这阶段能用的招式", actions), many: true as const }]
      : [
          { ...choice(base + ".add", "从这阶段起加上的招式", actions), many: true as const },
          { ...choice(base + ".remove", "从这阶段起去掉的招式", actions), many: true as const },
        ]
    return [
      group("切换阶段",
        { ...number(base + ".below", "血量低于（%）"), scale: 100 },
        seconds(base + ".seconds", "切换用时"),
        number(base + ".speed", "速度倍率"), number(base + ".damage", "伤害倍率"),
        choice(base + ".clip", "切换动作", [{ label: "无动作", value: null }, ...motions]),
        choice(base + ".sound", "切换声音", [{ label: "无声音", value: undefined }, ...media.sounds]), ...lists),
      ...rows(phase.finish).map((event, i) => group("阶段收尾 " + (i + 1) + " · " + (eventLabels[String(event.type)] ?? "效果"),
        ...momentFields(event, base + ".finish." + i, media, motions))).filter(item => item.fields.length),
    ]
  }

  const base = "boss." + edit.show
  const show = row(at(document, base))
  return [
    group("演出设置", seconds(base + ".seconds", "全程"),
      ...(edit.show === "intro" ? [
        number(base + ".wake_distance", "多远会醒来（格）"),
        choice(base + ".opening", "登场后先用", [{ label: "按平时的方式选招", value: show.opening === undefined ? undefined : null }, ...actions]),
        ...(Array.isArray(show.steps) && show.steps.length ? [] : [
          choice(base + ".clip", "登场动作", [{ label: "无动作", value: null }, ...motions]),
          choice(base + ".sound", "登场声音", [{ label: "无声音", value: null }, ...names(ABILITY_SOUNDS)]),
        ]),
      ] : [number(base + ".xp_bursts", "分几次掉经验")])),
    ...rows(show.steps).map((step, i) => group("第 " + (i + 1) + " 步 · " + (eventLabels[String(step.type)] ?? "演出里的安排"),
      ...momentFields(step, base + ".steps." + i, media, motions))),
  ]
}

export function combatTitle(data: CreatureInside, edit: CombatEdit) {
  if (edit.tab === "moves") return (edit.skill ? "编辑共用出手 · " : "编辑招式 · ") + (data.moves.find(move => move.id === edit.id)?.name ?? "")
  if (edit.tab === "phases") return "编辑第 " + (edit.phase + 2) + " 阶段"
  return edit.show === "intro" ? "编辑登场演出" : "编辑死亡演出"
}
