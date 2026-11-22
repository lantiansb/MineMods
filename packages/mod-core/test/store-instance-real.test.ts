import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readCatalog } from "../src/store/catalog"
import { ensureLoaderInstance } from "../src/store/instance"
import { clientLaunchCommand, serverLaunchCommand, type LaunchCommand } from "../src/store/launch"
import { ensureVanilla } from "../src/store/minecraft"
import { targetManifest } from "../src/target/manifests"

/*
 * The real thing, with the network: installs a loader into a fresh runtime folder whose path has Chinese and a space,
 * and starts the game. Opt-in, as it downloads hundreds of megabytes:
 *   MINEMODS_REAL_INSTALL=1                 NeoForge 1.21.1 server: install, start until "Done (", stop.
 *   MINEMODS_REAL_INSTALL=1 MINEMODS_REAL_CLIENT=1   also Forge 1.20.1 client: install, start until the title screen, close.
 * MINEMODS_JDK17 / MINEMODS_JDK21 name JDK folders to use instead of downloading Studio's own; MINEMODS_REAL_KEEP=1 keeps the folder.
 */
const real = process.env.MINEMODS_REAL_INSTALL === "1"
const client = real && process.env.MINEMODS_REAL_CLIENT === "1"

const runtimeFolder = () => mkdtemp(path.join(os.tmpdir(), "minemods 实例 真装-"))
const cleanup = async (folder: string) => {
  if (process.env.MINEMODS_REAL_KEEP === "1") console.log(`kept: ${folder}`)
  else await rm(folder, { recursive: true, force: true }).catch(() => undefined)
}
const seconds = (since: number) => Math.round((Date.now() - since) / 100) / 10

/** Starts a command and resolves when a line matches `ready` (or the time is up); `then` runs before it is ended. */
function runUntil(command: LaunchCommand, ready: RegExp, limitMs: number, then: (write: (line: string) => void) => Promise<void>, end: "wait" | "kill") {
  return new Promise<{ reached: boolean; seconds: number; lines: string[]; exit: number | null }>((resolve) => {
    const started = Date.now()
    const child = spawn(command.java, command.args, { cwd: command.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    const lines: string[] = []
    let reached = false
    let at = 0
    let pending = ""
    const read = (chunk: Buffer) => {
      pending += chunk.toString("utf8")
      const parts = pending.split(/\r?\n/)
      pending = parts.pop() ?? ""
      for (const line of parts) {
        lines.push(line)
        if (!reached && ready.test(line)) {
          reached = true
          at = seconds(started)
          clearTimeout(timer)
          void then((text) => child.stdin.write(`${text}\n`)).finally(() => setTimeout(() => child.kill(), 120_000).unref())
        }
      }
    }
    child.stdout.on("data", read)
    child.stderr.on("data", read)
    const timer = setTimeout(() => child.kill(), limitMs)
    child.once("close", (code) => resolve({ reached, seconds: at, lines, exit: code }))
  })
}

test.skipIf(!real)(
  "真装：NeoForge 1.21.1 服务端装进中文带空格的目录，启动到 Done，再停下",
  async () => {
    const runtime = await runtimeFolder()
    try {
      const manifest = targetManifest("neoforge-1.21.1")
      const projectId = randomUUID()
      const began = Date.now()
      const installed = await ensureLoaderInstance(runtime, manifest, {
        side: "server",
        projectId,
        javaHome: process.env.MINEMODS_JDK21,
        onProgress: (text) => {
          if (/^(Getting|Running|Minecraft)/.test(text)) process.stdout.write(`  ${text}`)
        },
      })
      const installSeconds = seconds(began)
      console.log(`neoforge server installed: via=${installed.installed} seconds=${installSeconds} dir=${installed.directory}`)
      expect(installed.installed).not.toBe("already")

      const again = Date.now()
      expect((await ensureLoaderInstance(runtime, manifest, { side: "server", projectId, javaHome: process.env.MINEMODS_JDK21 })).installed).toBe("already")
      console.log(`second call: already installed, ${seconds(again)}s`)

      const command = await serverLaunchCommand(runtime, manifest, { projectId, javaHome: process.env.MINEMODS_JDK21 })
      const run = await runUntil(command, /Done \(/, 600_000, async (write) => {
        write("say MMSCENE 1")
        await new Promise((resolve) => setTimeout(resolve, 2000))
        write("stop")
      }, "wait")
      const loud = run.lines.filter((line) => /\/(ERROR|FATAL)\]|Exception/.test(line))
      console.log(`neoforge server: done=${run.reached} startup=${run.seconds}s exit=${run.exit} port=${command.port} lines=${run.lines.length} errors=${loud.length}`)
      for (const line of loud.slice(0, 5)) console.log(`   ${line.slice(0, 200)}`)
      expect(run.reached).toBe(true)

      const items = (await readCatalog(runtime)).items
      console.log(`catalog: ${items.map((item) => `${item.id} (${Math.round(item.bytes / 1e6)} MB, ${item.source}, ${item.users.join(" ")})`).join("; ")}`)
      expect(items.find((item) => item.id === `instance:${projectId}.neoforge-1.21.1`)?.users).toEqual([`project:${projectId}`, "target:neoforge-1.21.1"])
      expect(items.map((item) => item.id)).toEqual(expect.arrayContaining(["loader:neoforge-1.21.1-21.1.266", "minecraft:1.21.1"]))
    } finally {
      await cleanup(runtime)
    }
  },
  40 * 60_000,
)

test.skipIf(!client)(
  "真装：Forge 1.20.1 客户端装好、补齐资源，启动到主菜单再关掉",
  async () => {
    const runtime = await runtimeFolder()
    try {
      const manifest = targetManifest("forge-1.20.1")
      const projectId = randomUUID()
      const began = Date.now()
      let lastStage = ""
      const vanilla = await ensureVanilla(runtime, manifest, {
        onProgress: (progress) => {
          if (progress.files === progress.totalFiles && progress.stage !== lastStage) {
            lastStage = progress.stage
            console.log(`  ${progress.stage}: ${progress.files} files, ${Math.round(progress.bytes / 1e6)} MB, ${seconds(began)}s`)
          }
        },
      })
      console.log(`vanilla 1.20.1: fetched ${vanilla.fetched.files} files / ${Math.round(vanilla.fetched.bytes / 1e6)} MB in ${seconds(began)}s`)
      const installStart = Date.now()
      const installed = await ensureLoaderInstance(runtime, manifest, { side: "client", projectId, javaHome: process.env.MINEMODS_JDK17 })
      console.log(`forge client installed: via=${installed.installed} seconds=${seconds(installStart)}`)
      const command = await clientLaunchCommand(runtime, manifest, { projectId, javaHome: process.env.MINEMODS_JDK17 })
      console.log(`client command: ${command.args.length} args, ${command.classpath.length} class path entries`)
      const run = await runUntil(command, /Sound engine started|Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks/, 300_000, async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }, "kill")
      const loud = run.lines.filter((line) => /\/(ERROR|FATAL)\]|Exception/.test(line))
      console.log(`forge client: title_screen=${run.reached} seconds=${run.seconds} lines=${run.lines.length} errors=${loud.length}`)
      for (const line of loud.slice(0, 5)) console.log(`   ${line.slice(0, 200)}`)
      expect(run.reached).toBe(true)
    } finally {
      await cleanup(runtime)
    }
  },
  60 * 60_000,
)
