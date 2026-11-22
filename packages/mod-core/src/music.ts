import { oggVorbisFacts } from "./sound"
import { z } from "zod"

export const MUSIC_LIMITS = { intro: 30, loop: 300, outro: 30, bytes: 24 * 1024 * 1024 } as const
export const MUSIC_PARTS = ["intro", "loop", "outro"] as const
export type MusicPart = (typeof MUSIC_PARTS)[number]
export const MUSIC_LABELS = { intro: "前奏", loop: "循环段", outro: "结尾" } as const
export const MUSIC_SUMMARY = "音乐可在 Studio 试听。Boss 通过 boss.music.asset 引用后，战斗时会为血条上的玩家播放。"
export const MUSIC_INSTRUCTIONS =
  MUSIC_SUMMARY +
  "把音频文件放进工程的收件箱，用 list_audio_inbox 查看，再用 import_audio_inbox 提交文件名。先交循环段，再加可选的前奏和结尾。前奏和结尾最长 30 秒，循环段最长 5 分钟，支持单声道和立体声。前奏接循环最多相隔一刻（0.05 秒），制作前奏时可以留一点尾音。游戏里的「音乐」音量控制战斗音乐，调到 0 就听不到。"
const part = (seconds: number, message?: string) =>
  z.strictObject({
    media_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    seconds: z.number().positive().max(seconds),
    channels: z.union([z.literal(1), z.literal(2)]),
  }, message)
export const MusicDocumentSchema = z.strictObject({
  kind: z.literal("music"),
  name: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  intro: part(MUSIC_LIMITS.intro).nullable(),
  loop: part(MUSIC_LIMITS.loop, "请先导入音乐的循环段，再保存这首音乐。"),
  outro: part(MUSIC_LIMITS.outro).nullable(),
})
export type MusicDocument = z.infer<typeof MusicDocumentSchema>
export function checkMusicBytes(part: MusicDocument["loop"], bytes: Uint8Array) {
  const facts = oggVorbisFacts(bytes)
  if (bytes.length > MUSIC_LIMITS.bytes || facts.channels !== part.channels || Math.abs(facts.seconds - part.seconds) > 0.001)
    throw new Error("音乐片段与保存的时长、声道或大小不符。")
}

/** Shared by the resource pack and the registered playback events. */
export function musicEvents(document: MusicDocument) {
  return MUSIC_PARTS.flatMap((key) => {
    const audio = document[key]
    return audio ? [{ part: key, event: `music_${document.name}_${key}`, ...audio }] : []
  })
}
