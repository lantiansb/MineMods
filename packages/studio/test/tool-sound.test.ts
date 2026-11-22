import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject } from "@minemods/mod-core/project"
import { SoundDocumentSchema, soundFileFacts } from "@minemods/mod-core/sound"
import { BUILTIN_MANIFESTS } from "@minemods/mod-core/tools/builtin"
import { PROGRAMS, installProgram, programCandidates, programPath, programStates, releaseAsset, useOwnProgram } from "@minemods/mod-core/tools/programs"
import { readSynthRecipe, renderSynth, wavFile } from "@minemods/mod-core/tools/synth"
import { saveToolSound, toGameSound } from "../src/main/tool-sound"

/**
 * 工具资产: a sound a tool made becomes the game's sound (mono Ogg Vorbis, at most 10 seconds and 1 MB) with ffmpeg, and a sound asset of the project; ffmpeg itself
 * is a program Studio downloads (held to its release's sha256) or the person's own copy.
 *
 * MINEMODS_FFMPEG: an ffmpeg with libvorbis; MINEMODS_FFMPEG_ZIP: its release archive (`PROGRAMS.ffmpeg.release.asset`). Without them the tests that need them are skipped.
 */

const FFMPEG = process.env.MINEMODS_FFMPEG ?? ""
const ZIP = process.env.MINEMODS_FFMPEG_ZIP ?? ""
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tool-sound-"))
  roots.push(root)
  return root
}
const roar = wavFile(renderSynth(readSynthRecipe(JSON.stringify({ seconds: 1.5, layers: [{ wave: "saw", from_hz: 90, to_hz: 50, length: 1.5, gain: 0.8, lowpass_hz: 900, release: 0.4 }] }))))

test.skipIf(!FFMPEG)("a made sound becomes the game's sound: mono Ogg Vorbis, measured, within the limits; a long stereo one is cut to 10 seconds", async () => {
  const sound = await toGameSound(FFMPEG, { bytes: roar, mime: "audio/wav" })
  const facts = soundFileFacts(sound.data)
  expect(facts.channels).toBe(1)
  expect(Math.abs(sound.duration - 1.5)).toBeLessThan(0.05)
  const root = await temporary()
  const stereo = path.join(root, "long.wav")
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=14", "-ac", "2", stereo])
  const cut = await toGameSound(FFMPEG, { bytes: await readFile(stereo), mime: "audio/wav" })
  expect(soundFileFacts(cut.data).channels).toBe(1)
  expect(cut.duration).toBeLessThanOrEqual(10.01)
}, 60000)

test.skipIf(!FFMPEG)("it is saved as a sound asset of the project; the same name again adds a file the game picks among", async () => {
  const root = await temporary()
  const project = await createProject({ directory: path.join(root, "p"), name: "吼声", description: "", mod_id: "roars" })
  const sound = await toGameSound(FFMPEG, { bytes: roar, mime: "audio/wav" })
  const first = saveToolSound(project, { name: "chiyou_roar", title: "石洞回响", subtitleZh: "石洞回响", subtitleEn: "Cave echoes", sound, manifest: BUILTIN_MANIFESTS["sound-synth"], at: new Date().toISOString() })
  expect(first.asset.title).toBe("石洞回响")
  expect(SoundDocumentSchema.parse(first.asset.document).subtitle).toEqual({ zh: "石洞回响", en: "Cave echoes" })
  expect(first.added).toBe(false)
  expect(first.asset.module).toBe("sound")
  expect(first.asset.provenance?.model).toBe("工具：合成音效")
  expect(SoundDocumentSchema.parse(first.asset.document).files).toHaveLength(1)
  const second = saveToolSound(first.next, { name: "chiyou_roar", sound, manifest: BUILTIN_MANIFESTS["sound-synth"], at: new Date().toISOString() })
  expect(second.added).toBe(true)
  expect(second.asset.id).toBe(first.asset.id)
  expect(SoundDocumentSchema.parse(second.asset.document).files).toHaveLength(2)
  // The card still has a display name when none was supplied.
  expect(saveToolSound(project, { name: "Bad Name", sound, manifest: BUILTIN_MANIFESTS["delegate-sound"], at: new Date().toISOString() }).asset.title).toBe("由连接的 AI 生成声音 1")
}, 60000)

test("a release that states no sha256 is not downloaded", async () => {
  const asset = PROGRAMS.ffmpeg.release.asset
  await expect(releaseAsset("ffmpeg", async () => ({ assets: [{ name: asset, size: 10, digest: null, browser_download_url: "https://example.com/x.zip" }] }))).rejects.toThrow("没有给出")
  await expect(releaseAsset("ffmpeg", async () => ({ assets: [] }))).rejects.toThrow("发布页上没有")
  expect(await releaseAsset("ffmpeg", async () => ({ assets: [{ name: asset, size: 10, digest: `sha256:${"a".repeat(64)}`, browser_download_url: "https://example.com/x.zip" }] }))).toEqual({ url: "https://example.com/x.zip", size: 10, sha256: "a".repeat(64) })
})

test.skipIf(!ZIP)("ffmpeg is installed from its release archive, held to its stated sha256: only the program and its license are kept", async () => {
  const root = await temporary()
  const sha256 = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-FileHash -Algorithm SHA256 '${ZIP}').Hash.ToLower()`], { encoding: "utf8" }).trim()
  const fetchJson = async () => ({ assets: [{ name: PROGRAMS.ffmpeg.release.asset, size: 1, digest: `sha256:${sha256}`, browser_download_url: "https://github.com/x.zip" }] })
  const asked: unknown[] = []
  const installed = await installProgram(root, "ffmpeg", {
    fetchJson,
    // The download stands in for the network: the file is the release archive on disk; the hash asked for is the release's own.
    fetch: (async (input: { file: { sha256?: string }; destination: string }) => {
      asked.push(input.file.sha256)
      await mkdir(path.dirname(input.destination), { recursive: true })
      await copyFile(ZIP, input.destination)
      return { path: input.destination, source: "official", bytes: 0 }
    }) as never,
  })
  expect(asked).toEqual([sha256])
  expect(installed.endsWith(path.join("bin", "ffmpeg.exe"))).toBe(true)
  expect(await programPath(root, "ffmpeg")).toBe(installed)
  expect(execFileSync(installed, ["-hide_banner", "-encoders"], { encoding: "utf8" })).toContain("libvorbis")
  expect((await programStates(root))[0]).toMatchObject({ id: "ffmpeg", path: installed, own: false })
}, 180000)

test("the person may point at a copy of their own; a path that is not there is refused", async () => {
  const root = await temporary()
  await expect(useOwnProgram(root, "ffmpeg", path.join(root, "nope.exe"))).rejects.toThrow("找不到这个程序")
  const own = path.join(root, "my-ffmpeg.exe")
  await Bun.write(own, "x")
  await useOwnProgram(root, "ffmpeg", own)
  expect(await programPath(root, "ffmpeg")).toBe(own)
  expect((await programStates(root))[0]).toMatchObject({ own: true, path: own })
})

// 主工程第 14 条：存储空间里没指定时，去 PATH、WinGet、scoop 的常见位置找 ffmpeg；找到的要带 libvorbis；存储空间页说「自动找到」。
test("没指定 ffmpeg 时去 PATH、WinGet、scoop 找，只认带 libvorbis 的；指定了的优先；可以用环境变量关掉", async () => {
  const root = await temporary()
  const home = path.join(root, "home")
  const local = path.join(home, "AppData", "Local")
  const lame = path.join(root, "bin")
  const gyan = path.join(local, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe", "ffmpeg-8.1.1-full_build", "bin")
  await mkdir(lame, { recursive: true })
  await mkdir(gyan, { recursive: true })
  await Bun.write(path.join(lame, "ffmpeg.exe"), "no vorbis")
  await Bun.write(path.join(gyan, "ffmpeg.exe"), "with vorbis")
  const search = { env: { PATH: lame, LOCALAPPDATA: local, USERPROFILE: home }, platform: "win32" as const, encoders: async (file: string) => (file.startsWith(gyan) ? " A..... libvorbis            libvorbis" : " A..... aac") }
  const candidates = await programCandidates("ffmpeg", search)
  expect(candidates).toEqual([path.join(lame, "ffmpeg.exe"), path.join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe"), path.join(gyan, "ffmpeg.exe"), path.join(home, "scoop", "shims", "ffmpeg.exe"), path.join(home, "scoop", "apps", "ffmpeg", "current", "bin", "ffmpeg.exe")])
  // The one on PATH lacks libvorbis and is passed over; WinGet's package has it.
  expect(await programPath(root, "ffmpeg", search)).toBe(path.join(gyan, "ffmpeg.exe"))
  expect((await programStates(root, search))[0]).toMatchObject({ path: path.join(gyan, "ffmpeg.exe"), own: false, auto: true })
  process.env.MINEMODS_PROGRAM_SEARCH = "off"
  expect(await programPath(root, "ffmpeg", search)).toBeNull()
  delete process.env.MINEMODS_PROGRAM_SEARCH
  // Chosen on the storage page: that one, not a found one.
  const own = path.join(root, "my-ffmpeg.exe")
  await Bun.write(own, "x")
  await useOwnProgram(root, "ffmpeg", own)
  expect(await programPath(root, "ffmpeg", search)).toBe(own)
  expect((await programStates(root, search))[0]).toMatchObject({ own: true, auto: false })
})
