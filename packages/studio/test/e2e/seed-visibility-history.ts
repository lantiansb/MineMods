// Isolated records for UI coverage of measured feedback and the verified file reveal.
import { createHash, randomUUID } from "node:crypto"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"
const { zipSync, strToU8 } = createRequire(new URL("../../../mod-core/package.json", import.meta.url))("fflate")
import { openProject, writeRecord } from "@minemods/mod-core/project"
import { startJob, updateJob } from "@minemods/mod-core/jobs"
import { jarName } from "@minemods/mod-core/release"

const root = await realpath(process.argv[2]!)
const project = await openProject(root)
if (process.argv[3] === "round") {
  const { begin, looked, writeMakingUnlocked } = await import("@minemods/mod-core/making")
  const asset = project.workspace.assets.find((asset) => asset.module === "model")!
  const record = begin(null, {
    asset_id: asset.id,
    task_id: randomUUID(),
    kind: "model",
    entry: null,
    request: "制作晶石傀儡",
    brief: "走路时脚底贴地。",
    remark: null,
    sheetless: true,
  })
  const round = looked(record, {
    fingerprint: createHash("sha256").update(JSON.stringify(asset.document)).digest("hex"),
    pictures: [],
    findings: ["行走时右腿陷进地面 0.25 格，连续 4 帧。"],
  })
  await writeMakingUnlocked(root, round)
  process.exit(0)
}
const build = randomUUID()
const sourceDirectory = path.join(root, "generated", "build-" + build)
const libs = path.join(sourceDirectory, "build", "libs")
await mkdir(libs, { recursive: true })
const jarPath = path.join(libs, jarName(project))
const bytes = zipSync({ "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0\r\n\r\n") })
await writeFile(jarPath, bytes)
const output = {
  id: build,
  revision: project.revision,
  projectDirectory: root,
  sourceDirectory,
  jarPath,
  sha256: createHash("sha256").update(bytes).digest("hex"),
}
await writeRecord(root, [".minemods", "builds", build + ".json"], output)
const queued = await startJob(root, { kind: "build", expectedRevision: project.revision })
const running = await updateJob(root, queued.id, { state: "running", expectedRevision: queued.revision })
await updateJob(root, queued.id, { state: "completed", expectedRevision: running.revision, output })
console.log(JSON.stringify({ jobId: queued.id, jarPath }))
