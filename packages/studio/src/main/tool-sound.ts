import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ActivityInput } from "@minemods/mod-core/activity"
import type { Project } from "@minemods/mod-core/project"
import { SOUND_LIMITS, SoundDocumentSchema, soundFileFacts } from "@minemods/mod-core/sound"
import type { ToolManifest } from "@minemods/mod-core/tools/manifest"
import { WorkspaceAssetSchema, applyWorkspaceAsset, type WorkspaceAsset } from "@minemods/mod-core/workspace"
import { savedStatus } from "@minemods/mod-core/workspace-modules"
import { ToolRunError, type ToolProduct } from "./tool-runner"

/**
 * 工具资产: what becomes of a sound a tool made, or a file the person brought in: turned into the game's sound (mono Ogg Vorbis at 44.1 kHz, cut to
 * `SOUND_LIMITS.seconds`, made smaller until it fits `SOUND_LIMITS.bytes`) with ffmpeg, checked as every sound is (`soundFileFacts`), and saved as a sound asset of
 * the project — a new one, or a further file of one already named so.
 */

const QUALITIES = [4, 2, 0] as const

function ffmpegRun(program: string, args: string[], signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) =>
    execFile(program, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, signal, shell: false }, (error, _stdout, stderr) =>
      error ? reject(new ToolRunError(`FFMPEG_FAILED: ${String(stderr).slice(-600)}`, `ffmpeg 转换声音失败：${String(stderr).trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 200) || error.message}`)) : resolve(),
    ),
  )
}

/** Any audio as the game's sound: a data URL of mono Ogg Vorbis and its measured length. */
export async function toGameSound(ffmpeg: string, product: ToolProduct, signal?: AbortSignal): Promise<{ data: string; duration: number }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "minemods-sound-"))
  try {
    const input = path.join(work, "in")
    await writeFile(input, product.bytes)
    for (const quality of QUALITIES) {
      const output = path.join(work, `out-${quality}.ogg`)
      await ffmpegRun(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "44100", "-t", String(SOUND_LIMITS.seconds), "-c:a", "libvorbis", "-q:a", String(quality), output], signal)
      const data = `data:audio/ogg;base64,${(await readFile(output)).toString("base64")}`
      const facts = soundFileFacts(data)
      if (facts.bytes <= SOUND_LIMITS.bytes) return { data, duration: Number(facts.seconds.toFixed(3)) }
    }
    throw new ToolRunError("SOUND_TOO_BIG", `转成游戏用的声音以后还是超过 ${SOUND_LIMITS.bytes / 1_000_000} MB，换一段更短的声音。`)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** A name a sound asset may have: the tool's `name` parameter, else one made from the tool's id. */
const soundName = (given: unknown, fallback: string) => (typeof given === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(given) ? given : fallback.replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "s_").slice(0, 40))

/**
 * The project with the sound in it: a new sound asset named `name`, or — when the project already has a sound of that name — the file added to it (the game then picks
 * one of its files at random), up to `SOUND_LIMITS.files`. Who made it is kept (`provenance.model`: the tool).
 */
export function saveToolSound(project: Project, input: { name: unknown; title?: unknown; subtitleZh?: unknown; subtitleEn?: unknown; sound: { data: string; duration: number; measurements?: import("@minemods/mod-core/sound").SoundMeasurements | undefined }; manifest: Pick<ToolManifest, "id" | "title">; at: string; id?: string }): { next: Project; asset: WorkspaceAsset; added: boolean } {
  const name = soundName(input.name, input.manifest.id)
  const title = typeof input.title === "string" ? input.title.trim() : ""
  const zh = typeof input.subtitleZh === "string" ? input.subtitleZh.trim() : ""
  const en = typeof input.subtitleEn === "string" ? input.subtitleEn.trim() : ""
  if (Boolean(zh) !== Boolean(en)) throw new ToolRunError("SOUND_SUBTITLE", "请同时填写中文字幕和英文字幕。")
  const subtitle = zh && en ? { zh, en } : null
  const file = { data: input.sound.data, duration: input.sound.duration, ...(input.sound.measurements ? { measurements: input.sound.measurements } : {}) }
  const existing = project.workspace.assets.find((asset) => asset.document.kind === "sound" && asset.document.name === name)
  if (existing && existing.document.kind === "sound") {
    if (existing.document.files.length >= SOUND_LIMITS.files) throw new ToolRunError("SOUND_FULL", `声音「${name}」已经有 ${SOUND_LIMITS.files} 个文件了，换一个名字存成新的声音。`)
    const document = SoundDocumentSchema.parse({ ...existing.document, files: [...existing.document.files, file], subtitle: subtitle ?? existing.document.subtitle })
    const asset = WorkspaceAssetSchema.parse({ ...existing, title: title || existing.title, document, revision: existing.revision + 1, updated_at: input.at })
    return { next: applyWorkspaceAsset(project, asset), asset, added: true }
  }
  const document = SoundDocumentSchema.parse({ kind: "sound", name, files: [file], subtitle, category: null, volume: 1, pitch: 1 })
  const asset = WorkspaceAssetSchema.parse({ id: input.id ?? randomUUID(), module: "sound", title: title || (input.manifest.id === "import" ? name : `${input.manifest.title} ${1 + project.workspace.assets.filter((asset) => asset.module === "sound").length}`.slice(0, 120)), revision: 1, created_at: input.at, updated_at: input.at, prompt: input.manifest.id === "import" ? "你导入的文件" : `工具「${input.manifest.title}」生成`, dependencies: [], document, provenance: { model: (input.manifest.id === "import" ? "你导入的文件" : `工具：${input.manifest.title}`).slice(0, 120), request_id: null }, status: savedStatus("sound", project.target) })
  return { next: applyWorkspaceAsset(project, asset), asset, added: false }
}

/** The activity line for a sound a tool made. */
export const toolSoundNote = (asset: Pick<WorkspaceAsset, "id" | "title">, manifest: Pick<ToolManifest, "title">, added: boolean): ActivityInput => ({ kind: "tool", mark: "ok", item: asset.id, title: asset.title, text: `用工具「${manifest.title}」${added ? "给它多做了一个文件" : "做了这段声音"}。` })
