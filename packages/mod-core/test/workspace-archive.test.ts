import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { exportProjectArchive, importProjectArchive } from "../src/container"
import { createProject, writeRecord } from "../src/project"
import { ProjectRunSchema } from "../src/workspace-runs"

test("project transfer includes validated module execution history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-run-transfer-"))
  const source = path.join(root, "source")
  await mkdir(source)
  try {
    const project = await createProject({ directory: source, name: "家人的工程" })
    const run = ProjectRunSchema.parse({ id: crypto.randomUUID(), project_id: project.id, prompt: "做一块月石", state: "completed", summary: "已完成", questions: [], tasks: [], events: [{ id: 0, task_id: null, time: new Date().toISOString(), message: "执行完成" }], error: null, model_complexity: "high", created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const { model_complexity: _legacyComplexity, ...legacyRun } = { ...run, id: crypto.randomUUID() }
    await writeRecord(source, [".minemods", "runs", `${run.id}.json`], run)
    await writeRecord(source, [".minemods", "runs", `${legacyRun.id}.json`], legacyRun)
    const archive = path.join(root, "family.minemods")
    await exportProjectArchive({ directory: source, destination: archive })
    const imported = await importProjectArchive({ archive, destination: path.join(root, "received") })
    expect(JSON.parse(await readFile(path.join(imported.directory, ".minemods", "runs", `${run.id}.json`), "utf8"))).toEqual(run)
    expect(JSON.parse(await readFile(path.join(imported.directory, ".minemods", "runs", `${legacyRun.id}.json`), "utf8"))).toEqual(legacyRun)
    await writeRecord(source, [".minemods", "runs", `${run.id}.json`], { ...run, project_id: crypto.randomUUID() })
    await expect(exportProjectArchive({ directory: source, destination: path.join(root, "invalid.minemods") })).rejects.toThrow("身份")
  } finally {
    if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(root, { recursive: true, force: true })
  }
})
