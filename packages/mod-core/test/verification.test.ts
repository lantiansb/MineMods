import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject } from "../src/project"
import { readVerification, recordVerification, VerificationCaseSchema } from "../src/verification"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-verification-"))
  roots.push(root)
  await createProject({ directory: root, name: "验证记录" })
  const buildId = crypto.randomUUID()
  await mkdir(path.join(root, ".minemods", "builds"), { recursive: true })
  await writeFile(path.join(root, ".minemods", "builds", `${buildId}.json`), JSON.stringify({ id: buildId, revision: 1, jarPath: path.join(root, "mod.jar"), sha256: "a".repeat(64) }))
  await mkdir(path.join(root, "generated", `build-${buildId}`), { recursive: true })
  await writeFile(path.join(root, "generated", `build-${buildId}`, "minemods-build.json"), JSON.stringify({ workspace_assets: [{ id: assetId, module: "block", revision: 1 }] }))
  return { root, buildId }
}
const assetId = crypto.randomUUID()
const gametest = { id: "block.mystery_box.opens", asset_ids: [assetId], kind: "gametest" as const, passed: true, detail: "打开后掉出奖励" }

test("cases are bounded and a screenshot can only be a path inside the project", () => {
  expect(VerificationCaseSchema.safeParse(gametest).success).toBe(true)
  expect(VerificationCaseSchema.safeParse({ ...gametest, screenshot: "screenshots/build/box.png" }).success).toBe(true)
  ;["/etc/passwd", "../outside.png", "a/../../b.png", "C:\\shot.png", "a\\b.png"].forEach((screenshot) =>
    expect(VerificationCaseSchema.safeParse({ ...gametest, screenshot }).success).toBe(false),
  )
  expect(VerificationCaseSchema.safeParse({ ...gametest, kind: "manual" }).success).toBe(false)
  expect(VerificationCaseSchema.safeParse({ ...gametest, asset_ids: [] }).success).toBe(false)
  expect(VerificationCaseSchema.safeParse({ ...gametest, verified: true }).success).toBe(false)
  expect(VerificationCaseSchema.safeParse({ ...gametest, detail: "x".repeat(4001) }).success).toBe(false)
})

test("results are stored per build and later checks add to earlier ones", async () => {
  const { root, buildId } = await project()
  expect(await readVerification(root, buildId)).toBeNull()
  await recordVerification(root, { build_id: buildId, cases: [gametest] })
  const client = { id: "block.mystery_box.visible", asset_ids: [assetId], kind: "client" as const, passed: false, detail: "贴图是紫黑格", screenshot: "screenshots/box.png" }
  await recordVerification(root, { build_id: buildId, cases: [client] })
  const record = await recordVerification(root, { build_id: buildId, cases: [{ ...client, passed: true, detail: "换图后正常" }] })
  expect(record.cases).toEqual([gametest, { ...client, passed: true, detail: "换图后正常" }])
  expect(await readVerification(root, buildId)).toEqual(record)
  expect(JSON.parse(await readFile(path.join(root, ".minemods", "verifications", `${buildId}.json`), "utf8"))).toEqual(record)
})

test("only a recorded build can be verified, and a record cannot be read under another build's name", async () => {
  const { root, buildId } = await project()
  const other = crypto.randomUUID()
  await expect(recordVerification(root, { build_id: other, cases: [gametest] })).rejects.toThrow("recorded successful build")
  await expect(recordVerification(root, { build_id: "../escape", cases: [gametest] })).rejects.toThrow()
  await recordVerification(root, { build_id: buildId, cases: [gametest] })
  await writeFile(path.join(root, ".minemods", "verifications", `${other}.json`), await readFile(path.join(root, ".minemods", "verifications", `${buildId}.json`)))
  await expect(readVerification(root, other)).rejects.toThrow("does not belong")
})

test("a file that is not a finished build, a build that lists nothing, and an asset outside the build are all refused", async () => {
  const { root, buildId } = await project()
  const stranger = { ...gametest, asset_ids: [crypto.randomUUID()] }
  await expect(recordVerification(root, { build_id: buildId, cases: [stranger] })).rejects.toThrow("not part of this build")
  expect(await readVerification(root, buildId)).toBeNull()
  const empty = crypto.randomUUID()
  await writeFile(path.join(root, ".minemods", "builds", `${empty}.json`), "{}\n")
  await expect(recordVerification(root, { build_id: empty, cases: [gametest] })).rejects.toThrow("recorded successful build")
  const old = crypto.randomUUID()
  await writeFile(path.join(root, ".minemods", "builds", `${old}.json`), JSON.stringify({ id: old, revision: 1, jarPath: "x.jar", sha256: "b".repeat(64) }))
  await expect(recordVerification(root, { build_id: old, cases: [gametest] })).rejects.toThrow("does not list")
})
