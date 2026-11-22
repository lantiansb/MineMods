import { abilityRef, assetRef, phaseRef } from "./finding-refs"
import { z } from "zod"
import type { StandardOutline } from "@minemods/studio-ai/acceptance"
import type { Builtin } from "./builtin"
import { builtinUses } from "./builtin-names"
import type { Ability, CreatureSounds } from "./entity-runtime"
import { impactSlots } from "./impact-slots"
import type { ImpactFx } from "./impact-fx"

/**
 * A sound (声音, 任务二 §9): the project's own audio, one or several OGG Vorbis files the game picks from at random,
 * registered as `<mod id>:<name>` and written into `sounds.json`. A creature's `sounds` and an ability's `sound`
 * events name either a vanilla sound id, as before, or `{ asset: <uuid of a sound asset> }`.
 * This file is the document, its limits, what is measured on a file (read straight from its Ogg pages), how a
 * creature uses its sounds and what is wrong with that, and the data files a build writes. Loader-neutral and no
 * Node APIs: the app's window reads it too. The one loader-specific piece, registering the sound event, is
 * `fabric/sound.ts`.
 */

/**
 * - seconds: the longest one file may play. A creature's call or an ability's roar is a few seconds; ten is room for a boss's.
 * - bytes: the largest one file may be. Ten seconds of mono Vorbis at a high quality is about 200 KB.
 * - files: the most files one sound picks from.
 * - total_bytes: all the files of one sound together. The document travels whole, base64, through a call that takes 4 MB
 *   (`BRIDGE_BODY.document`): 2.5 MB is 3.4 MB as text, with room for the rest.
 * - duration_tolerance: how far the `duration` written may be from the one measured (seconds).
 */
export const SOUND_LIMITS = { seconds: 10, bytes: 1_000_000, files: 8, total_bytes: 2_500_000, duration_tolerance: 0.05, subtitle: 40, weight: 10 } as const

/** Which slider of the game's sound options a sound an ability plays is under, by the game's own `SoundSource`. */
export const SOUND_CATEGORIES = {
  hostile: { name: "敌对生物", java: "HOSTILE" },
  neutral: { name: "友好生物", java: "NEUTRAL" },
  ambient: { name: "环境", java: "AMBIENT" },
  block: { name: "方块", java: "BLOCKS" },
  player: { name: "玩家", java: "PLAYERS" },
  weather: { name: "天气", java: "WEATHER" },
  voice: { name: "语音/旁白", java: "VOICE" },
} as const
export type SoundCategory = keyof typeof SOUND_CATEGORIES
const SOUND_CATEGORY_IDS = Object.keys(SOUND_CATEGORIES) as [SoundCategory, ...SoundCategory[]]

/**
 * How often a creature's moments play at most, as the game plays them (seconds), for the warning on a long sound: a step
 * sounds at every step; the game lets a mob call at most every 4 seconds (`Mob.getAmbientSoundInterval`, 80 ticks); a
 * creature in a fight is hurt every half second at most (its 10 ticks of invulnerability) and is seldom hurt slower
 * than every 2 seconds. Dying happens once.
 */
export const SOUND_FREQUENT = { step: 1, hurt: 2, ambient: 4 } as const

// ---- reading an Ogg Vorbis file ----

/** What is measured on one file. */
export type SoundFileFacts = { channels: number; sample_rate: number; seconds: number; bytes: number }

/** A file that is not one the game can play, said in plain words. */
export class SoundFileProblem extends Error {}

const OGG_CRC = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index << 24
    for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1
    table[index] = value >>> 0
  }
  return table
})()
/** The checksum of an Ogg page (its own field read as zero): polynomial 0x04c11db7, no reflection, as libogg computes it. */
export function oggChecksum(page: Uint8Array) {
  let crc = 0
  for (let index = 0; index < page.length; index++) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ (index >= 22 && index < 26 ? 0 : page[index]!)) & 0xff]!) >>> 0
  return crc >>> 0
}

const ascii = (bytes: Uint8Array, from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length))
const startsWith = (bytes: Uint8Array, text: string, from = 0) => bytes.length >= from + text.length && ascii(bytes, from, text.length) === text

/** What a file that is not Ogg Vorbis most likely is, for the message. */
function otherFormat(bytes: Uint8Array) {
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WAVE", 8)) return "WAV"
  if (startsWith(bytes, "ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "MP3"
  if (startsWith(bytes, "fLaC")) return "FLAC"
  if (startsWith(bytes, "ftyp", 4)) return "M4A/AAC"
  return null
}

/** How to turn another file into one this takes, said once for every message and the instructions. */
export const SOUND_CONVERT_WORDS = "WAV、MP3 可放进工程收件箱，以文件名导入（或者请用户在 Studio 的声音页导入），Studio 会用它管理的 ffmpeg 转成游戏格式；也可以提交已转好的单声道 OGG Vorbis 声音文档"

/**
 * One Ogg Vorbis file, read page by page: every page's checksum, one stream from its first page to its last, the
 * three Vorbis headers, and the length from the last page's sample position. Throws `SoundFileProblem` for anything
 * the game would not play, or would play otherwise than meant (two channels are not placed in the world: they
 * sound as loud everywhere).
 */
export function oggVorbisFacts(bytes: Uint8Array): SoundFileFacts {
  if (!startsWith(bytes, "OggS")) {
    const other = otherFormat(bytes)
    throw new SoundFileProblem(other ? `这是 ${other} 文件，游戏只放 OGG Vorbis。${SOUND_CONVERT_WORDS}。` : `这不是一个 OGG 文件（开头不是 OggS）。${SOUND_CONVERT_WORDS}。`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const packets: Uint8Array[] = []
  let partial: Uint8Array[] = []
  let offset = 0
  let serial: number | null = null
  let last = -1
  let pages = 0
  let ended = false
  while (offset < bytes.length) {
    if (ended) throw new SoundFileProblem("文件在流结束以后还有别的内容（几段接在一起的 OGG）。只收一段声音的文件。")
    if (offset + 27 > bytes.length || !startsWith(bytes, "OggS", offset)) throw new SoundFileProblem(`OGG 文件在第 ${offset} 字节处断了或者坏了。`)
    if (bytes[offset + 4] !== 0) throw new SoundFileProblem("OGG 文件的版本不对。")
    const flags = bytes[offset + 5]!
    const segments = bytes[offset + 26]!
    const tableEnd = offset + 27 + segments
    if (tableEnd > bytes.length) throw new SoundFileProblem("OGG 文件不完整（最后一页断了）。")
    const lacing = bytes.subarray(offset + 27, tableEnd)
    const size = lacing.reduce((sum, value) => sum + value, 0)
    const end = tableEnd + size
    if (end > bytes.length) throw new SoundFileProblem("OGG 文件不完整（最后一页断了）。")
    const page = bytes.subarray(offset, end)
    if (oggChecksum(page) !== view.getUint32(offset + 22, true)) throw new SoundFileProblem(`OGG 文件第 ${pages + 1} 页的校验和对不上：文件坏了。`)
    const pageSerial = view.getUint32(offset + 14, true)
    if (serial === null) {
      if (!(flags & 0x02)) throw new SoundFileProblem("OGG 文件的第一页没有标成流的开头。")
      serial = pageSerial
    } else if (pageSerial !== serial) throw new SoundFileProblem("OGG 文件里不止一条流（比如带了视频或者第二段声音）。只收一段声音的文件。")
    const granule = Number(view.getBigInt64(offset + 6, true))
    if (granule >= 0) last = granule
    // The first three packets are the Vorbis headers; the rest is sound, which is not read.
    let at = tableEnd
    lacing.forEach((value) => {
      if (packets.length < 3) partial.push(bytes.subarray(at, at + value))
      at += value
      if (value < 255 && packets.length < 3) {
        const length = partial.reduce((sum, part) => sum + part.length, 0)
        const packet = new Uint8Array(length)
        partial.reduce((into, part) => (packet.set(part, into), into + part.length), 0)
        packets.push(packet)
        partial = []
      }
    })
    ended = Boolean(flags & 0x04)
    pages++
    offset = end
  }
  if (!ended) throw new SoundFileProblem("OGG 文件没有正常结束（最后一页没有标成流的结尾），可能只传了一半。")
  const head = packets[0] ?? new Uint8Array()
  if (startsWith(head, "OpusHead")) throw new SoundFileProblem(`这是 OGG Opus，游戏只放 OGG Vorbis。${SOUND_CONVERT_WORDS}。`)
  if (startsWith(head, "\x7fFLAC")) throw new SoundFileProblem(`这是装在 OGG 里的 FLAC，游戏只放 OGG Vorbis。${SOUND_CONVERT_WORDS}。`)
  if (head.length < 30 || head[0] !== 1 || !startsWith(head, "vorbis", 1)) throw new SoundFileProblem(`这个 OGG 文件里装的不是 Vorbis 声音。${SOUND_CONVERT_WORDS}。`)
  if (packets.length < 3 || packets[1]![0] !== 3 || !startsWith(packets[1]!, "vorbis", 1) || packets[2]![0] !== 5 || !startsWith(packets[2]!, "vorbis", 1)) throw new SoundFileProblem("OGG Vorbis 文件缺少开头的说明（注释头或编码表），游戏读不了。")
  const head32 = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const channels = head[11]!
  const sampleRate = head32.getUint32(12, true)
  if (head32.getUint32(7, true) !== 0 || channels === 0 || sampleRate === 0) throw new SoundFileProblem("OGG Vorbis 文件开头的说明不对（版本、声道数或采样率）。")
  if (last < 0) throw new SoundFileProblem("OGG 文件里没有一个声音的样本：量不出它多长。")
  return { channels, sample_rate: sampleRate, seconds: last / sampleRate, bytes: bytes.length }
}

const DATA_URL = /^data:audio\/ogg;base64,([A-Za-z0-9+/]+={0,2})$/

/** The bytes of a file as a document holds it (`data:audio/ogg;base64,…`). */
export function decodeSoundDataUrl(value: string): Uint8Array {
  const match = DATA_URL.exec(value)
  if (!match) throw new SoundFileProblem("data 要写成 data:audio/ogg;base64,… （OGG Vorbis 文件的 base64）。")
  return Uint8Array.from(atob(match[1]!), (character) => character.charCodeAt(0))
}

/** One file of a document, measured and held to the limits. */
export function soundFileFacts(data: string): SoundFileFacts {
  const bytes = decodeSoundDataUrl(data)
  if (bytes.length > SOUND_LIMITS.bytes) throw new SoundFileProblem(`文件有 ${(bytes.length / 1_000_000).toFixed(2)} MB，一个文件最大 ${SOUND_LIMITS.bytes / 1_000_000} MB。`)
  const facts = oggVorbisFacts(bytes)
  if (facts.channels !== 1) throw new SoundFileProblem(`文件是 ${facts.channels} 个声道的。游戏只把单声道的声音放在世界里的某个位置、离远了变小；多声道的在哪里都一样响。转成单声道（ffmpeg 的 -ac 1）再交。`)
  if (facts.seconds > SOUND_LIMITS.seconds + 1e-9) throw new SoundFileProblem(`文件长 ${num(facts.seconds)} 秒，一个文件最长 ${SOUND_LIMITS.seconds} 秒。`)
  return facts
}

const num = (value: number, digits = 2) => Number(value.toFixed(digits)) || 0

// ---- the document ----

/** The name it is registered by (`<mod id>:<name>`) and its files are named after; one Java field each, so no dots. */
export const SoundNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "声音的 name 用小写字母开头，只含小写字母、数字和下划线，最长 48 个字")

const SoundMeasurementsSchema = z.strictObject({
  seconds: z.number().positive().max(SOUND_LIMITS.seconds),
  peak: z.number().min(0),
  rms: z.number().min(0),
  clipped: z.boolean(),
  dominant_band: z.enum(["low", "mid", "high"]).nullable(),
})
export type SoundMeasurements = z.infer<typeof SoundMeasurementsSchema>

export const SoundFileSchema = z.strictObject({
  measurements: SoundMeasurementsSchema.optional(),
  /** The file: `data:audio/ogg;base64,…`, mono Ogg Vorbis. */
  data: z.string().max(4 * Math.ceil(SOUND_LIMITS.bytes / 3) + 32),
  /** Its length in seconds, as measured from the file (checked). */
  duration: z.number().finite().positive().max(SOUND_LIMITS.seconds),
  /** How often it is picked against the others (sounds.json `weight`); left out: 1. */
  weight: z.number().int().min(1).max(SOUND_LIMITS.weight).optional(),
})

export const SoundDocumentSchema = z
  .strictObject({
    kind: z.literal("sound"),
    name: SoundNameSchema,
    /** One or more files; the game picks one at random every time the sound plays. */
    files: z.array(SoundFileSchema).min(1).max(SOUND_LIMITS.files),
    /** What the game's subtitles say when it plays (zh_cn, en_us); null: no subtitle. */
    subtitle: z.strictObject({ zh: z.string().trim().min(1).max(SOUND_LIMITS.subtitle), en: z.string().trim().min(1).max(SOUND_LIMITS.subtitle) }).nullable(),
    /** The slider an ability that plays it is under; null: the creature's own. A creature's own moments are always the creature's. */
    category: z.enum(SOUND_CATEGORY_IDS).nullable(),
    /** Of the files themselves (sounds.json); multiplied by the volume and pitch of whoever plays it. */
    volume: z.number().finite().min(0.1).max(1),
    pitch: z.number().finite().min(0.5).max(2),
  })
  .superRefine((document, context) => {
    let total = 0
    document.files.forEach((file, index) => {
      try {
        const facts = soundFileFacts(file.data)
        total += facts.bytes
        if (Math.abs(facts.seconds - file.duration) > SOUND_LIMITS.duration_tolerance) context.addIssue({ code: "custom", path: ["files", index, "duration"], message: `第 ${index + 1} 个文件量出来长 ${num(facts.seconds, 3)} 秒，duration 写的是 ${file.duration}：改成 ${num(facts.seconds, 3)}。` })
      } catch (cause) {
        context.addIssue({ code: "custom", path: ["files", index, "data"], message: `第 ${index + 1} 个文件：${cause instanceof Error ? cause.message : String(cause)}` })
      }
    })
    if (total > SOUND_LIMITS.total_bytes) context.addIssue({ code: "custom", path: ["files"], message: `几个文件合计 ${(total / 1_000_000).toFixed(2)} MB，一个声音的所有文件合计最大 ${SOUND_LIMITS.total_bytes / 1_000_000} MB。` })
  })
export type SoundDocument = z.infer<typeof SoundDocumentSchema>

/** The longest of its files: what a creature playing it may have to wait out. */
export const soundMeasurementsWords = (facts: SoundMeasurements) =>
  `合成波形 ${facts.seconds} 秒，峰值 ${facts.peak}，RMS ${facts.rms}，${facts.clipped ? "有削波" : "无削波"}，${facts.dominant_band ? `主要能量在${{ low: "低频（250 Hz 以下）", mid: "中频（250–2000 Hz）", high: "高频（2000 Hz 以上）" }[facts.dominant_band]}` : "未量到可辨认的频段"}。`

export const soundSeconds = (document: Pick<SoundDocument, "files">) => Math.max(...document.files.map((file) => file.duration))

// ---- a reference to one ----

/** `{ asset }` in the place of a vanilla sound id: the sound asset with that id, which the creature also depends on. */
const toneRange = "音高请填 0.5 到 2，例如 0.8 是低音，1.4 是高音。"
export const ToneSchema = z.number({ error: toneRange }).min(0.5, toneRange).max(2, toneRange)
const pitchRange = "音高浮动请填 0 到 0.5 之间的比例，例如 0.1 表示上下浮动 10%。"
export const PitchVariationSchema = z.number({ error: pitchRange }).min(0, pitchRange).max(0.5, pitchRange)

/** Emit exactly the old literal when the event has no variation. */
export function variedPitch(base: string, variation: number | undefined, random: string) {
  return variation ? `(${base} * (1.0f + (${random}.nextFloat() * 2.0f - 1.0f) * ${variation}f))` : base
}

export const SoundAssetRefSchema = z.strictObject({ asset: z.uuid() })
export type SoundAssetRef = z.infer<typeof SoundAssetRefSchema>
/** A vanilla sound id or a sound asset. */
export type SoundRef = string | SoundAssetRef
export const isSoundAsset = (ref: SoundRef | null | undefined): ref is SoundAssetRef => typeof ref === "object" && ref !== null

/** A sound asset as a reader needs it: null when the project has no sound with that id. */
export type SoundLookup = (id: string) => { title: string; document: SoundDocument } | null
type Assets = { workspace: { assets: readonly { id: string; title: string; document: { kind: string } }[] } }
/** The sound assets of a project, by asset id. */
export const soundLookup =
  (project: Assets): SoundLookup =>
  (id) =>
    project.workspace.assets.flatMap((asset) => (asset.id === id && asset.document.kind === "sound" ? [{ title: asset.title, document: asset.document as SoundDocument }] : []))[0] ?? null

/** The four moments a creature makes a sound, in the order they are shown (as `SOUND_MOMENTS` in data-words, kept here so this file stands alone). */
const MOMENTS = { ambient: "平时", hurt: "受伤时", death: "死的时候", step: "走路时" } as const
type Moment = keyof typeof MOMENTS
type Voiced = { name: string; builtin?: Builtin; boss?: { phases: readonly { sound?: SoundRef | undefined }[] } | null | undefined; sounds?: Pick<CreatureSounds, Moment> | null; abilities?: readonly Pick<Ability, "id" | "name" | "length" | "start" | "events">[] | null
  /** r29: a stagger may show something the moment it begins (`enter`). */
  stagger?: { id?: string | undefined; enter?: ImpactFx | undefined } | readonly { id?: string | undefined; enter?: ImpactFx | undefined }[] | undefined }

/** Every place a creature plays a sound, in order: its four moments, then each ability's sound events. */
export function soundUses(creature: Voiced) {
  return [
    ...(Object.keys(MOMENTS) as Moment[]).flatMap((moment) => {
      const sound = creature.sounds?.[moment]
      return sound ? [{ where: { moment } as const, sound, words: MOMENTS[moment], every: moment === "death" ? null : SOUND_FREQUENT[moment] }] : []
    }),
    ...(creature.boss?.phases ?? []).flatMap((phase, index) => phase.sound ? [{ where: { phase: index } as const, sound: phase.sound, words: `第${index + 1}次变身开始时`, every: null }] : []),
    ...(creature.abilities ?? []).flatMap((ability) =>
      ability.events.flatMap((event, index) =>
        event.type === "lightning" && event.look?.sound ? [{where:{ability:ability.id, event:index} as const, sound:event.look.sound, words:`招式「${ability.name}」的落雷`, every:num(ability.length - event.at + ability.start.cooldown)}] : (event.type === "sound" || event.type === "hit_fx") && event.sound ? [{ where: { ability: ability.id, event: index } as const, sound: event.sound, words: `招式「${ability.name}」第 ${num(event.at)} 秒`, every: num(ability.length - event.at + ability.start.cooldown) }] : [],
      ),
    ),
    // r29: the moments it runs into something: no second of the ability, so none is said to come back at a fixed rate.
    ...impactSlots(creature.abilities ?? [], creature.stagger === undefined ? [] : Array.isArray(creature.stagger) ? creature.stagger : [creature.stagger as { id?: string; enter?: ImpactFx }]).flatMap((slot) =>
      slot.fx.sound === undefined ? [] : [{ where: (slot.ability === null ? { impact: slot.key } : { ability: creature.abilities![slot.ability]!.id, impact: slot.key }) as { impact: string } | { ability: string; impact: string }, sound: slot.fx.sound, words: slot.words, every: null }],
    ),
  ]
}

/** Every sound asset a creature plays, each once. */
export const creatureSoundIds = (creature: Voiced) => [...new Set([...soundUses(creature).flatMap(use => isSoundAsset(use.sound) ? [use.sound.asset] : []), ...builtinUses(creature.builtin).flatMap(use => isSoundAsset(use.sound) ? [use.sound.asset] : [])])]

/** 「「蚩尤怒吼」（自己的声音，3 个文件随机，最长 1.8 秒）」, or the vanilla name. */
export function soundWords(ref: SoundRef, lookup: SoundLookup, vanilla: Readonly<Record<string, string>>) {
  if (!isSoundAsset(ref)) return `「${vanilla[ref] ?? ref}」`
  const found = lookup(ref.asset)
  if (!found) return "自己的声音（工程里找不到）"
  const files = found.document.files.length
  return `「${found.title}」（自己的声音${files > 1 ? `，${files} 个文件随机` : ""}，${files > 1 ? "最长 " : ""}${num(soundSeconds(found.document))} 秒）`
}

/** 「受伤时：「蚩尤怒吼」（自己的声音，1.8 秒）」 for every use, the line a review card or a preview lists. */
export const soundUseLines = (creature: Voiced, lookup: SoundLookup, vanilla: Readonly<Record<string, string>>) => soundUses(creature).map((use) => `${use.words}：${soundWords(use.sound, lookup, vanilla)}`)

export type SoundIssue = { refs: import("@minemods/studio-ai/acceptance").FindingRef[]; ability: string | null; rule: "sound_missing" | "sound_long"; stops: boolean; text: string; fix: string; detail: string }

/**
 * What is wrong with the sounds a creature plays: a sound asset that is gone (the build would name a sound that is not
 * registered: it stops), and a long sound on a moment that comes often, so one play is cut off or heard over the next.
 */
export function creatureSoundIssues(creature: Voiced, lookup: SoundLookup): SoundIssue[] {
  return soundUses(creature).flatMap((use): SoundIssue[] => {
    if (!isSoundAsset(use.sound)) return []
    const ability = "ability" in use.where ? use.where.ability : null
    const found = lookup(use.sound.asset)
    const move = ability && creature.abilities?.find((entry) => entry.id === ability)
    const refs = [...(move ? [abilityRef(move)] : []), ...("phase" in use.where && typeof use.where.phase === "number" ? [phaseRef(use.where.phase + 1)] : []), assetRef(use.sound.asset, found?.title)]
    if (!found)
      return [{ ability, refs, rule: "sound_missing", stops: true, text: `「${creature.name}」${use.words}放的自己的声音在工程里找不到（${use.sound.asset}）。`, fix: "先在这个工程做好声音，复制正确的 UUID 写在声音引用里，或者换成原版声音。", detail: `sound ${use.sound.asset} missing` }]
    const seconds = soundSeconds(found.document)
    const every = use.every
    if (every === null || seconds <= every + 1e-9) return []
    return [
      {
        ability,
        refs,
        rule: "sound_long",
        stops: false,
        text: `「${creature.name}」${use.words}放的「${found.title}」长 ${num(seconds)} 秒，可这一刻最快每 ${every} 秒就来一次：上一声还没放完，下一声就叠上去了。`,
        fix: "换短一些的文件（或者把长的那段剪短），或者把这个声音放到不那么频繁的时刻。",
        detail: `sound ${use.sound.asset}: ${num(seconds)} s at a moment that recurs every ${every} s`,
      },
    ]
  })
}

// ---- the data a build writes (every loader the same) ----

/** The name of one file under `assets/<mod>/sounds/`: the first is the sound's name, the others `-2`, `-3`… (no sound name has a hyphen). */
export const soundFileName = (name: string, index: number) => (index ? `${name}-${index + 1}` : name)

/**
 * `assets/<mod>/sounds.json`, the files under `assets/<mod>/sounds/`, and the subtitles for the language files, for
 * every sound asset of a project. Written as the game's own `sounds.json` is: one event per sound, its files with
 * their volume, pitch and weight.
 */
export function compileSoundData(modId: string, sounds: readonly SoundDocument[]) {
  const resources = `src/main/resources/assets/${modId}`
  const files: Record<string, string | Uint8Array> = {}
  const events = Object.fromEntries(
    sounds.map((sound) => [
      sound.name,
      {
        ...(sound.subtitle ? { subtitle: `subtitles.${modId}.${sound.name}` } : {}),
        sounds: sound.files.map((file, index) => ({ name: `${modId}:${soundFileName(sound.name, index)}`, ...(sound.volume !== 1 ? { volume: sound.volume } : {}), ...(sound.pitch !== 1 ? { pitch: sound.pitch } : {}), ...(file.weight && file.weight !== 1 ? { weight: file.weight } : {}) })),
      },
    ]),
  )
  files[`${resources}/sounds.json`] = JSON.stringify(events, null, 2)
  sounds.forEach((sound) => sound.files.forEach((file, index) => (files[`${resources}/sounds/${soundFileName(sound.name, index)}.ogg`] = decodeSoundDataUrl(file.data))))
  const language = (locale: "zh" | "en") => Object.fromEntries(sounds.flatMap((sound) => (sound.subtitle ? [[`subtitles.${modId}.${sound.name}`, sound.subtitle[locale]]] : [])))
  return { files, language: { zh_cn: language("zh"), en_us: language("en") } }
}

// ---- what an AI is told ----

/**
 * A sound against the acceptance standard: nothing about it is refused by a measurement beyond the document's own
 * limits; whether it sounds right is heard, by whoever makes it and by the person, with the play button.
 */
export const SOUND_STANDARD: StandardOutline = {
  kind: "sound",
  label: "声音",
  rules: [],
  unmeasured: {
    earns_place: "一个声音该有多少内容量不了；长度、声道和大小是保存时量出来的事实",
    not_mechanical: "听起来机不机械量不了，要人自己听",
    reads: "它像不像要表现的东西量不了，由人自己听",
    hierarchy: "声音没有画面上的主次",
    sound: "声音没有站不站得住的问题",
    fits: "它和用它的生物、招式对不对得上（太长、太频繁），在看那只生物时说",
  },
  told: {
    earns_place: "每个文件的长度、声道数、采样率和大小",
  },
}

/** What an AI is told about making a sound and using one. One text: the registry, the hand-off and the capability list read it. */
export const SOUND_INSTRUCTIONS =
  "交声音时，请给它一个人看得懂的工程标题和字幕。" +
  `声音是这个工程自己的音效：一个或几个 OGG Vorbis 文件，构建时注册成「<模组 id>:<name>」并写进 sounds.json，每次放的时候游戏从几个文件里随机挑一个。生物的 sounds 和招式的 sound 事件除了原版声音的 id，也可以写 {"asset":"<这个声音资产的 UUID>"} 用它。保存生物任务时 Studio 会记录对已有声音的依赖。现成录音走声音页导入；要新做音效，先读 list_tools，使用用户已启用且可用的声音工具，工具产物会经 Studio 转码存成资产。` +
  " WAV、MP3 等音频可放进工程收件箱按文件名导入，或者请用户在 Studio 的声音页导入，由 Studio 转换。长背景音乐请做成音乐资产，并在 Boss 的 boss.music.asset 填入资产编号。" +
  ` 文档：{kind:"sound", name, files:[{data, duration, weight}], subtitle:{zh, en} 或 null, category, volume, pitch}。` +
  ` name 是注册名：小写字母开头，只含小写字母、数字和下划线，最长 48 个字；同一个工程里不能有两个同名的声音。` +
  ` files 是 1 到 ${SOUND_LIMITS.files} 个文件；文件里的 measurements 是 Studio 合成工具写的波形测量，直接提交时省略。文件不止一个时每次随机挑一个放（同一声吼叫录几遍，听起来就不会一模一样）；weight 是这个文件被挑中的相对次数（1 到 ${SOUND_LIMITS.weight}，不写就是 1）。` +
  ` data 写成 data:audio/ogg;base64,…：只收 OGG Vorbis、单声道（多声道的声音在游戏里不放在某个位置上，离多远都一样响）；每个文件最长 ${SOUND_LIMITS.seconds} 秒、最大 ${SOUND_LIMITS.bytes / 1_000_000} MB，一个声音所有文件合计最大 ${SOUND_LIMITS.total_bytes / 1_000_000} MB。直接交文档时，WAV、MP3、FLAC、OGG Opus 要先转码：${SOUND_CONVERT_WORDS}。采样率用 44100 或 48000。` +
  ` duration 写这个文件的秒数：Studio 会从文件里量，差 ${SOUND_LIMITS.duration_tolerance} 秒以上会被退回，并告诉你量到的值。` +
  ` subtitle 是玩家打开字幕时屏幕右下角显示的字（中文和英文各一句，最长 ${SOUND_LIMITS.subtitle} 个字，写它是什么声音，比如「蚩尤怒吼」/「Chiyou roars」）；写 null 就不显示字幕。` +
  ` category 是招式放这个声音时归游戏声音设置里的哪一条音量：${Object.entries(SOUND_CATEGORIES).map(([id, value]) => `${id}（${value.name}）`).join("、")}；写 null 就跟着放它的生物（敌对的生物就是敌对生物）。生物平时、受伤、死、走路时的声音总是跟着生物自己。` +
  ` volume（0.1 到 1）和 pitch（0.5 到 2）是这几个文件本身的音量和音调，写进 sounds.json；放的时候生物 sounds 里的 volume、pitch，或者招式事件里的 volume、pitch 还会再乘上去（事件的 volume 大于 1 时能传得更远）。` +
  ` 用在哪里要合适：走路的声音每一步都放、平时的叫声最快每 ${SOUND_FREQUENT.ambient} 秒一次、受伤的声音在打架时一两秒就一次，太长的文件会一声叠一声，检查会提醒（走路超过 ${SOUND_FREQUENT.step} 秒、受伤超过 ${SOUND_FREQUENT.hurt} 秒、平时超过 ${SOUND_FREQUENT.ambient} 秒；招式里的声音比这个招式从那一刻到下次能再出的时间还长）。引用的声音资产不存在会被退回。` +
  ` 构建出 assets/<模组 id>/sounds.json 和 assets/<模组 id>/sounds/<name>.ogg（第二个文件起是 <name>-2.ogg、<name>-3.ogg……）。现在只能给生物和招式用，不能当方块的声音或唱片。Boss 背景音乐使用音乐资产。`

export const SOUND_SUMMARY = `工程自己的音效：1 到 ${SOUND_LIMITS.files} 个单声道 OGG Vorbis 文件（每个最长 ${SOUND_LIMITS.seconds} 秒、最大 ${SOUND_LIMITS.bytes / 1_000_000} MB；直接提交须先转好；声音页导入或启用的 Studio 声音工具可转码），注册成「<模组 id>:<name>」，带字幕、音量和音调。生物的 sounds 和招式的 sound 事件写 {"asset":"<UUID>"} 用它。`
