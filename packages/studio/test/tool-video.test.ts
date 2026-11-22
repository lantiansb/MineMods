import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { keepRecording, listRecordings, recordingFile, sceneWindowTitle, videoFrames, videoSeconds } from "../src/main/tool-video"

/**
 * 工具资产: a recording of the test scene is kept with the project as material to check, and cut into evenly spread frames labelled by their moment for whoever looks.
 * Recording itself needs the game window open (only this project's), so it is checked with the game; here, everything around it.
 *
 * MINEMODS_FFMPEG: an ffmpeg (LGPL is enough); without it the tests that need it are skipped.
 */

const FFMPEG = process.env.MINEMODS_FFMPEG ?? ""
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tool-video-"))
  roots.push(root)
  return root
}

test.skipIf(!FFMPEG)("a recording is cut into evenly spread frames, each a picture labelled by its moment", async () => {
  const root = await temporary()
  const id = randomUUID()
  const made = path.join(root, "made.mp4")
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=8:size=320x240:rate=15", "-c:v", "mpeg4", made])
  const kept = await keepRecording(root, id, await readFile(made))
  expect(kept).toBe(recordingFile(root, id))
  expect((await listRecordings(root)).map((recording) => recording.id)).toEqual([id])
  expect(Math.round(await videoSeconds(FFMPEG, kept))).toBe(8)
  const frames = await videoFrames(FFMPEG, kept, 4)
  expect(frames.pictures.map((picture) => picture.label)).toEqual(["第 1.0 秒", "第 3.0 秒", "第 5.0 秒", "第 7.0 秒"])
  for (const picture of frames.pictures) expect(Buffer.from(picture.url.split(",")[1]!, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
  // Asked for more frames than may be cut, it gives the most there may be.
  expect((await videoFrames(FFMPEG, kept, 99)).pictures).toHaveLength(24)
}, 60000)

test("a recording is named by the run that made it; anything else is refused; a file that is no video says so", async () => {
  const refused = (() => {
    try {
      recordingFile("C:/p", "../../etc/passwd")
      return ""
    } catch (error) {
      return (error as { plain?: string }).plain ?? ""
    }
  })()
  expect(refused).toContain("录像编号不对")
  expect(recordingFile("C:/p", "1b2c3d4e-0000-4000-8000-000000000000").replaceAll("\\", "/")).toBe("C:/p/.minemods/recordings/1b2c3d4e-0000-4000-8000-000000000000.mp4")
  if (!FFMPEG) return
  const root = await temporary()
  const bad = path.join(root, "bad.mp4")
  await Bun.write(bad, "not a video")
  await expect(videoSeconds(FFMPEG, bad)).rejects.toMatchObject({ plain: "读不出这段录像有多长，可能不是录像文件。" })
})

test("no game window is found for a project whose test scene is not open", async () => {
  expect(await sceneWindowTitle(randomUUID())).toBeNull()
  expect(await sceneWindowTitle("not-a-project")).toBeNull()
}, 30000)
