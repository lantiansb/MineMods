import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ToolRunError, type ToolProduct } from "./tool-runner"

/**
 * 工具资产: recording the test scene's game and cutting a recording into frames for a reviewer (`scene-record`, `video-frames`). Only what the person opened from
 * Studio is recorded — the one game window whose process runs this project's test scene — never the whole screen. Recordings are kept with the project as material
 * to check (`.minemods/recordings/`), not as assets, and never go into the mod.
 */

export const RECORDINGS = ".minemods/recordings"
export const RECORD_LIMITS = { seconds: { min: 2, max: 60 }, frames: { min: 2, max: 24 }, rate: 15, width: 1280 } as const

const run = (program: string, args: string[], signal?: AbortSignal) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
    execFile(program, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, signal, shell: false }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    ),
  )

/**
 * The title of the game window of this project's test scene: the window of the one process whose command line names the project's scene instance. Null when the
 * game is not open (or this is not Windows, where windows are found and recorded by their title).
 */
export async function sceneWindowTitle(projectId: string): Promise<string | null> {
  if (process.platform !== "win32" || !/^[0-9a-f-]{36}$/.test(projectId)) return null
  // The title is handed back as base64 of its UTF-8 bytes: PowerShell writes its output in the console's code page, which garbles a Chinese title
  // (「Minecraft* 1.21.1 - 单人游戏」), and ffmpeg then finds no window by that name.
  const script = `Get-CimInstance Win32_Process -Filter "Name='javaw.exe' OR Name='java.exe'" | Where-Object { $_.CommandLine -like '*${projectId}*' } | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle } | Where-Object { $_ } | Select-Object -First 1 | ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_)) }`
  const answer = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script])
  const encoded = answer.stdout.trim().split(/\r?\n/)[0]?.trim() ?? ""
  if (!/^[A-Za-z0-9+/]+=*$/.test(encoded)) return null
  const title = Buffer.from(encoded, "base64").toString("utf8").trim()
  return title ? title : null
}

/** Records the window titled `title` for `seconds` (at most `RECORD_LIMITS`), scaled down, as an MP4 Studio can cut frames from. */
export async function recordWindow(ffmpeg: string, title: string, seconds: number, signal?: AbortSignal): Promise<ToolProduct> {
  const work = await mkdtemp(path.join(os.tmpdir(), "minemods-record-"))
  try {
    const out = path.join(work, "scene.mp4")
    const length = Math.max(RECORD_LIMITS.seconds.min, Math.min(RECORD_LIMITS.seconds.max, seconds))
    // gdigrab records one window by its exact title; mpeg4 is in every LGPL build. The length is held on the file written too (`-t` and a frame count after
    // the input): the window's own clock once gave a 9.2-second file for 5 asked (GPT's check in the real game, 2026-11-17), and the next run gave 5.
    const frames = Math.round(length * RECORD_LIMITS.rate)
    const done = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "gdigrab", "-framerate", String(RECORD_LIMITS.rate), "-t", String(length), "-i", `title=${title}`, "-vf", `scale='min(${RECORD_LIMITS.width},iw)':-2`, "-r", String(RECORD_LIMITS.rate), "-t", String(length), "-frames:v", String(frames), "-c:v", "mpeg4", "-q:v", "5", out], signal)
    const found = await stat(out).catch(() => null)
    if (done.code !== 0 || !found?.size) throw new ToolRunError(`RECORD_FAILED: ${done.stderr.slice(-400)}`, `录不下测试场的画面：${done.stderr.trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 200) || "ffmpeg 没有录到东西"}。游戏窗口要开着、不能最小化。`)
    return { bytes: await readFile(out), mime: "video/mp4" }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** How long a video is, in seconds, as ffmpeg reads it. */
export async function videoSeconds(ffmpeg: string, file: string) {
  const probe = await run(ffmpeg, ["-hide_banner", "-i", file])
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr)
  if (!match) throw new ToolRunError("VIDEO_UNREADABLE", "读不出这段录像有多长，可能不是录像文件。")
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

/** `count` frames spread evenly over a recording, each a JPEG data URL labelled by its moment. */
export async function videoFrames(ffmpeg: string, file: string, count: number, signal?: AbortSignal) {
  const seconds = await videoSeconds(ffmpeg, file)
  const frames = Math.max(RECORD_LIMITS.frames.min, Math.min(RECORD_LIMITS.frames.max, Math.round(count)))
  const work = await mkdtemp(path.join(os.tmpdir(), "minemods-frames-"))
  try {
    const pictures: { label: string; url: string }[] = []
    for (let index = 0; index < frames; index++) {
      const at = (seconds * (index + 0.5)) / frames
      const out = path.join(work, `f${index}.jpg`)
      await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", at.toFixed(2), "-i", file, "-frames:v", "1", "-q:v", "4", out], signal)
      const bytes = await readFile(out).catch(() => null)
      if (bytes) pictures.push({ label: `第 ${at.toFixed(1)} 秒`, url: `data:image/jpeg;base64,${bytes.toString("base64")}` })
    }
    if (!pictures.length) throw new ToolRunError("VIDEO_NO_FRAMES", "这段录像抽不出画面。")
    return { seconds: Number(seconds.toFixed(2)), pictures }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Where a project's recordings are kept, and the file of one by its id (the run that recorded it). */
export const recordingFile = (directory: string, id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ToolRunError("RECORDING_UNKNOWN", "录像编号不对：写 scene-record 那次运行的编号。")
  return path.join(directory, RECORDINGS, `${id}.mp4`)
}

/** The recordings a project has, newest first. */
export async function listRecordings(directory: string) {
  const folder = path.join(directory, RECORDINGS)
  const names = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".mp4"))
  const found = await Promise.all(names.map(async (name) => ({ id: name.slice(0, -4), bytes: (await stat(path.join(folder, name))).size, at: (await stat(path.join(folder, name))).mtime.toISOString() })))
  return found.sort((a, b) => b.at.localeCompare(a.at))
}

/** Keeps a recording with the project. */
export async function keepRecording(directory: string, id: string, bytes: Uint8Array) {
  const file = recordingFile(directory, id)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, bytes)
  return file
}
