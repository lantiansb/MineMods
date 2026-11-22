import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { setTimeout as sleep } from "node:timers/promises"
/** Run the bundled harness with Electron's Node runtime on Windows. Pass an empty project directory. */
import { randomUUID } from "node:crypto"
import { open, readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { createProject, openProject, saveProject, writeRecord } from "../src/project"

async function main(directory: string) {
  const initial = await createProject({ directory, name: "并发保存验证" })
  const seeded = await saveProject(directory, { ...initial, blocks: Array.from({ length: 240 }, (_, i) => ({
    id: randomUUID(), name: "测试方块 " + i, identifier: "test_" + i, hardness: 1, luminance: 0,
    tool: "pickaxe" as const, drop: "self" as const, color: "#668877", texture: "x".repeat(1740),
  })) }, initial.revision)
  console.log({ node: process.versions.node, uv: process.versions.uv, bytes: (await stat(path.join(directory, "minemods.project.json"))).size })
  const result = { read: 0, saved: 0, errors: [] as string[] }
  let done = false
  const readers = Promise.all(Array.from({ length: 16 }, async () => {
    while (!done) {
      await openProject(directory)
      result.read++
    }
  }))
  try {
    let project = seeded
    for (let i = 0; i < 12; i++) {
      try {
        project = await saveProject(directory, { ...project, description: "write " + i }, project.revision)
        result.saved++
      } catch (error) {
        result.errors.push(String(error))
      }
    }
    const final = await openProject(directory)
    if (final.revision !== seeded.revision + result.saved) throw new Error("Unexpected on-disk revision")
  } finally {
    done = true
    await readers
  }
  console.log(JSON.stringify(result))
  if (result.errors.length) process.exitCode = 1
}

void (process.argv[3] === "holders" ? holders(process.argv[2]!) : main(process.argv[2]!)).catch(error => {
  console.error(error)
  process.exitCode = 1
})

async function holders(directory: string) {
  const initial = await createProject({ directory, name: "占用来源验证" })
  const name = "minemods.project.json"
  const target = path.join(directory, name)
  const original = await readFile(target)
  const check = async (holder: "studio" | "external") => {
    await assert.rejects(writeRecord(directory, [name], initial), {
      name: "ProjectRecordBusyError",
      holder,
    })
    assert.deepEqual(await readFile(target), original)
    assert(!(await readdir(directory)).some(file => file.endsWith(".tmp")))
    console.log(holder, "classified; original bytes intact; no temporary file")
  }
  const own = await open(target, "r")
  try {
    await check("studio")
  } finally {
    await own.close()
  }
  const child = spawn(process.execPath, ["-e", [
    'require("node:fs/promises").open(process.argv[1], "r").then(async file => {',
    '  process.stdout.write("ready");',
    '  for await (const _ of process.stdin) break;',
    '  await file.close();',
    '});',
  ].join(" "), target], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true })
  const exited = once(child, "exit")
  try {
    await Promise.race([
      once(child.stdout, "data"),
      exited.then(() => { throw new Error("External reader exited before it opened the file") }),
    ])
    await check("external")
    const closing = sleep(1200).then(() => child.stdin.end())
    try {
      const saved = await saveProject(directory, { ...initial, description: "重试后写入" }, initial.revision)
      assert.equal(saved.revision, initial.revision + 1)
      console.log("external reader held for 1200 ms; save succeeded after release")
    } finally {
      await closing
    }
  } finally {
    child.stdin.end()
    await exited
  }
}
