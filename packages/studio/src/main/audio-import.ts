import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { MUSIC_LIMITS, MusicDocumentSchema, type MusicPart } from "@minemods/mod-core/music"
import { oggVorbisFacts, SOUND_LIMITS, SoundDocumentSchema } from "@minemods/mod-core/sound"
import { storeMedia } from "@minemods/mod-core/media"
import { type Project } from "@minemods/mod-core/project"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { savedStatus } from "@minemods/mod-core/workspace-modules"
import type { AudioTargetInput, SoundSettingsInput } from "../audio-requests"
import { AUDIO_INPUT_BYTES } from "./audio-inbox"

const run = promisify(execFile)
const dataUrl = (bytes: Uint8Array) => "data:audio/ogg;base64," + Buffer.from(bytes).toString("base64")
export async function prepareAudio(input: Uint8Array, kind: "sound" | "music", part: MusicPart, ffmpeg: string | null) {
  if (!input.length || input.length > AUDIO_INPUT_BYTES) throw new Error("音频文件必须大于零且不超过 64 MB。")
  const limit = kind === "sound" ? SOUND_LIMITS.seconds : MUSIC_LIMITS[part]
  const max = kind === "sound" ? SOUND_LIMITS.bytes : MUSIC_LIMITS.bytes
  const facts = (() => {
    try {
      return oggVorbisFacts(input)
    } catch {
      return null
    }
  })()
  if (facts && facts.seconds <= limit && input.length <= max && (facts.channels === 1 || (kind === "music" && facts.channels === 2)))
    return { bytes: input, facts, cut: false }
  if (!ffmpeg) throw new Error("这份文件需要转换。请先到「个人设置 → 工具」安装转换工具，再放一次。")
  const folder = await mkdtemp(path.join(os.tmpdir(), "studio-audio-"))
  const source = path.join(folder, "input")
  const output = path.join(folder, "clip.ogg")
  const convert = async (duration: number) => {
    // Only the selected local audio is an input. Playlists must not fetch other media.
    await run(
      ffmpeg,
      [
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "ogg,wav,mp3,flac,mov,aac,aiff,asf",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-t",
        String(duration),
        "-ac",
        kind === "music" ? "2" : "1",
        "-ar",
        "44100",
        "-c:a",
        "libvorbis",
        "-q:a",
        "4",
        output,
      ],
      { windowsHide: true, timeout: 120000 },
    ).catch(() => {
      throw new Error("读不出这份音频，请换一个音频文件。")
    })
    const bytes = await readFile(output)
    return { bytes, facts: oggVorbisFacts(bytes) }
  }
  try {
    await writeFile(source, input)
    const measured = await convert(limit + 0.25)
    const cut = measured.facts.seconds > limit
    if (cut && kind === "music") throw new Error(`这一段音乐最多 ${limit} 秒，请先剪短。`)
    const audio = cut ? await convert(limit) : measured
    if (audio.bytes.length > max) throw new Error("音频文件太大，请缩短后再试。")
    return { ...audio, cut }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

export async function putAudio(directory: string, project: Project, target: AudioTargetInput, bytes: Uint8Array, converter: string | null) {
  const was = project.workspace.assets.find((asset) => asset.id === target.assetId)
  if (target.assetId && was?.module !== target.kind) throw new Error("没有找到要修改的声音或音乐。")
  const id = was?.id ?? randomUUID()
  const part = target.part ?? "loop"
  if (!was && (!target.title || (target.kind === "music" && part !== "loop"))) throw new Error("请先填写名字，音乐从循环段开始。")
  const audio = await prepareAudio(bytes, target.kind, part, converter)
  const title = was?.title ?? target.title!
  const now = new Date().toISOString()
  const name = (target.kind === "music" ? "music_" : "sound_") + id.replaceAll("-", "")
  const document = await (async () => {
    if (target.kind === "music") {
      const sha = await storeMedia(directory, audio.bytes)
      return MusicDocumentSchema.parse({
        ...(was?.document ?? { kind: "music", name, intro: null, outro: null }),
        [part]: { media_sha256: sha, seconds: audio.facts.seconds, channels: audio.facts.channels },
      })
    }
    const original =
      was?.document.kind === "sound" ? was.document : { kind: "sound" as const, name, subtitle: null, category: null, volume: 1, pitch: 1, files: [] }
    const files = [...original.files]
    const index = target.index ?? files.length
    if (target.index !== undefined && index >= files.length) throw new Error("要换的声音已经不存在了。")
    files[index] = { data: dataUrl(audio.bytes), duration: audio.facts.seconds }
    return SoundDocumentSchema.parse({ ...original, files })
  })()
  const asset = WorkspaceAssetSchema.parse({
    ...was,
    id,
    title,
    module: target.kind,
    document,
    revision: (was?.revision ?? 0) + 1,
    created_at: was?.created_at ?? now,
    updated_at: now,
    dependencies: was?.dependencies ?? [],
    prompt: was?.prompt ?? "你导入的音频",
    provenance: { model: null, request_id: null },
    status: was?.status ?? savedStatus(target.kind, project.target),
  })
  return { next: applyWorkspaceAsset(project, asset), id, seconds: audio.facts.seconds, cut: audio.cut }
}

export function updateSoundSettings(project: Project, input: SoundSettingsInput) {
  const asset = project.workspace.assets.find((value) => value.id === input.assetId)
  if (!asset || asset.document.kind !== "sound") throw new Error("没有找到要修改的声音。")
  return applyWorkspaceAsset(project, WorkspaceAssetSchema.parse({
    ...asset,
    document: { ...asset.document, subtitle: input.subtitle, volume: input.volume },
    revision: asset.revision + 1,
    updated_at: new Date().toISOString(),
    provenance: { model: null, request_id: null },
  }))
}

export function dropAudio(project: Project, target: AudioTargetInput) {
  const asset = project.workspace.assets.find((a) => a.id === target.assetId && a.module === target.kind)
  if (!asset) throw new Error("找不到这份资产。")
  const doc = asset.document
  const document = (() => {
    if (doc.kind === "sound" && target.index !== undefined && doc.files[target.index] && doc.files.length > 1)
      return { ...doc, files: doc.files.filter((_, i) => i !== target.index) }
    if (doc.kind === "music" && target.part && target.part !== "loop" && doc[target.part]) return { ...doc, [target.part]: null }
    throw new Error("声音至少要留一个文件，音乐必须保留循环段。")
  })()
  return applyWorkspaceAsset(
    project,
    WorkspaceAssetSchema.parse({
      ...asset,
      document,
      revision: asset.revision + 1,
      updated_at: new Date().toISOString(),
      provenance: { model: null, request_id: null },
    }),
  )
}
