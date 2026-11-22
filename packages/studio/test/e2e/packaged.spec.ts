import { test, expect, _electron } from "@playwright/test"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { BuildResult } from "@minemods/mod-core/build"

// Optional release acceptance. Run only against a freshly produced package:
// STUDIO_E2E_PACKAGED=1, MINEMODS_STUDIO_JAVA_HOME=<Java 21>,
// MINEMODS_STUDIO_RUNTIME=<shared runtime/cache>, and an HTTP(S)_PROXY if required.
// STUDIO_PACKAGED_EXECUTABLE may select a relocated package; the repository renderer/worker are never launched.
// Only finished job records: a record being rewritten sits beside it for a moment as <id>.json.<uuid>.tmp (writeRecord),
// and taking that name for a job id made getJob reject it ("请求参数无效") on a busy disk.
const jobFiles = async (directory: string) =>
  (await readdir(directory).catch(() => [] as string[])).filter((file) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(file))

test("packaged app builds, exports, initializes and cancels playtest, then restores its completed build", async () => {
  test.skip(process.env.STUDIO_E2E_PACKAGED !== "1", "Enable explicitly after producing the final packaged application")
  test.setTimeout(600000)
  const javaHome = process.env.MINEMODS_STUDIO_JAVA_HOME || process.env.JAVA_HOME
  const runtimeDirectory = process.env.MINEMODS_STUDIO_RUNTIME
  if (!javaHome || !runtimeDirectory)
    throw new Error("Packaged acceptance requires explicit Java 21 and runtime/cache environment paths")
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "packaged-e2e-"))
  console.log(`PACKAGED_ACCEPTANCE_ARTIFACTS=${directory}`)
  const awayFromRepository = await mkdtemp(path.join(os.tmpdir(), "minemods-packaged-cwd-"))
  const sourceParent = path.join(directory, "source exports")
  await mkdir(sourceParent)
  const jarPath = path.join(directory, "packaged-example.jar")
  const restoredJarPath = path.join(directory, "restored-example.jar")
  const executablePath = path.resolve(
    process.env.STUDIO_PACKAGED_EXECUTABLE || "release/win-unpacked/MineMods Studio.exe",
  )
  const options = {
    executablePath,
    cwd: awayFromRepository,
    args: [`--user-data-dir=${path.join(directory, "electron-user-data")}`],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "ELECTRON_RUN_AS_NODE")),
      OPENAI_API_KEY: "",
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "作品 projects"),
      MINEMODS_STUDIO_RUNTIME: runtimeDirectory,
      MINEMODS_STUDIO_JAVA_HOME: javaHome,
      // An inherited development template override must never make this packaged test pass.
      MINEMODS_STUDIO_TEMPLATES: "",
    },
  }
  const errors: string[] = []
  const app = await _electron.launch(options)
  const page = await app.firstWindow()
  await page.waitForURL("**/index.html")
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  const identity = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
  }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  const completed = await (async () => {
    try {
      expect(identity.packaged).toBe(true)
      expect(path.resolve(identity.executablePath)).toBe(executablePath)
      expect(identity.appPath).toBe(path.join(path.dirname(executablePath), "resources", "app.asar"))
      expect(identity.cwd).toBe(awayFromRepository)
      expect(page.url()).toContain("app.asar/dist/renderer/index.html")
      await page.waitForURL("**/index.html")
      await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
      const environment = await page.evaluate(() => window.studio.environment())
      expect(environment.aiConfigured).toBe(false)
      expect(environment.javaConfigured).toBe(true)
      expect(environment.model).toBe("gpt-6-astra")
      expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined")
      await page.getByRole("button", { name: "开始做", exact: true }).first().click()
      await page.getByLabel("工程名称", { exact: true }).fill("Packaged Example Cow")
      await page.getByRole("button", { name: "创建工程", exact: true }).click()
      await expect.poll(async () => (await page.evaluate(() => window.studio.listProjects())).length).toBe(1)
      const saved = await page.evaluate(async () => (await window.studio.listProjects())[0])
      const unavailable = await page.evaluate(async (project) => window.studio
        .generateModel({ projectId: project.id, expectedRevision: project.revision, prompt: "A gentle mushroom cow" })
        .then(() => ({ rejected: false, error: "" })).catch((error: unknown) => ({ rejected: true, error: String(error) })), saved.project)
      expect(unavailable.rejected).toBe(true)
      expect(unavailable.error).toContain("尚未连接模型。请打开个人设置，选择厂商并完成密钥配置。")
      const withEntity = await page.evaluate(project => window.studio.addEntity({ projectId: project.id, expectedRevision: project.revision, name: "示例蘑菇牛" }), saved.project)
      let example = await page.evaluate(project => window.studio.useExample({ projectId: project.id, expectedRevision: project.revision }), withEntity.project)
      // Real combo specimen: deterministic authored model/rules, real packaged worker and Gradle below.
      const comboFixture = JSON.parse(await readFile(path.join(process.cwd(), "test/e2e/combo-fixture.json"), "utf8"))
      example = await page.evaluate(input => window.studio.saveModel(input), {projectId: example.project.id, expectedRevision: example.project.revision, model: comboFixture.model})
      example.project.entities[0]!.behavior = "hostile"
      example.project.entities[0]!.abilities = comboFixture.abilities
      example.project.entities[0]!.combos = [{id:"double", name:"二连击",steps:comboFixture.abilities.map((a: {id:string})=>a.id),gap_ticks:2,damage_scale:1.2,start:{min_distance:0,max_distance:16,line_of_sight:true,cooldown:8,weight:1}}]
      await writeFile(path.join(example.directory,"minemods.project.json"),JSON.stringify(example.project))
      example = await page.evaluate(id=>window.studio.openProject(id), example.project.id)
      expect(example.model_origin).toBe("manual")
      expect(example.project.assets.some(asset => asset.origin === "manual")).toBe(true)
      await page.reload()
      await page.locator(".project-card").filter({ hasText: "Packaged Example Cow" }).click()
      await page.getByRole("button", { name: "高级", exact: true }).click()
      await page.screenshot({ path: path.join(directory, "packaged-example.png") })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.webContents.send("studio:command", "export"))
      await page.getByRole("button", { name: "打包，不打开游戏", exact: true }).click()
      const jobsDirectory = path.join(saved.directory, ".minemods", "jobs")
      await expect.poll(async () => (await jobFiles(jobsDirectory)).length).toBe(1)
      const jobId = (await jobFiles(jobsDirectory))[0]!.replace(/\.json$/, "")
      // The deleted per-cube panel and split gameplay page cannot be used as lock probes.
      // Keep the current build action locked while the real worker is active.
      await expect(page.getByRole("button", { name: "打包，不打开游戏", exact: true })).toBeDisabled()
      const locked = await page.evaluate(async (view) => {
        const entity = view.project.entities[0]!
        return window.studio.saveEntity({ projectId: view.project.id, expectedRevision: view.project.revision, entityId: entity.id,
          name: entity.name, description: entity.description, health: entity.health + 1, speed: entity.speed,
          attack_damage: entity.attack_damage, behavior: entity.behavior })
          .then(() => ({ rejected: false, error: "" })).catch((error: unknown) => ({ rejected: true, error: String(error) }))
      }, example)
      expect(locked.rejected, "A real active build must prevent gameplay edits").toBe(true)
      expect((await page.evaluate(id => window.studio.openProject(id), saved.project.id)).project.revision).toBe(example.project.revision)
      await expect
        .poll(
          async () => {
            const current = await page.evaluate((input) => window.studio.getJob(input), {
              projectId: saved.project.id,
              jobId,
            })
            return ["completed", "failed", "canceled", "interrupted"].includes(current.state)
          },
          { timeout: 300000, intervals: [1000] },
        )
        .toBe(true)
      const job = await page.evaluate((input) => window.studio.getJob(input), { projectId: saved.project.id, jobId })
      await writeFile(path.join(directory, "packaged-build-job.json"), JSON.stringify(job, null, 2))
      expect(job.state, job.error ?? "The packaged worker must complete a real build").toBe("completed")
      expect(job.kind).toBe("build")
      const build = job.output as BuildResult
      expect(build.sha256).toMatch(/^[a-f0-9]{64}$/)
      const bytes = await readFile(build.jarPath)
      expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304")
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(build.sha256)
      const jarEntries = await promisify(execFile)(path.join(javaHome, "bin", "jar.exe"), ["tf", build.jarPath], {
        windowsHide: true,
        timeout: 15000,
      })
      expect(jarEntries.stdout).not.toContain("com/minemods/studio/dev/")
      await writeFile(path.join(directory, "packaged-jar-entries.txt"), jarEntries.stdout)
      expect(
        JSON.parse(await readFile(path.join(saved.directory, ".minemods", "builds", `${build.id}.json`), "utf8")),
      ).toEqual(build)
      await expect(page.getByRole("button", { name: "打包，不打开游戏", exact: true })).toBeEnabled()
      // OS boundary substitute only: select deterministic native dialog destinations.
      // Renderer buttons, IPC authentication, utilityProcess worker, real Gradle and exporters are untouched.
      await app.evaluate(
        ({ dialog }, destinations) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destinations.sourceParent] })
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: destinations.jarPath })
        },
        { sourceParent, jarPath },
      )
      await page.getByRole("button", { name: /^源代码/ }).click()
      await expect(page.getByText(/^源码已导出：/)).toBeVisible()
      const sourceEntries = await readdir(sourceParent)
      expect(sourceEntries).toHaveLength(1)
      const sourceDirectory = path.join(sourceParent, sourceEntries[0])
      const sourceMetadata = JSON.parse(
        await readFile(path.join(sourceDirectory, "src/main/resources/fabric.mod.json"), "utf8"),
      )
      expect(sourceMetadata.entrypoints.main).toEqual(["com.minemods.content_packaged_example_cow.StudioContent"])
      expect(sourceMetadata.depends.minecraft).toBe("1.21.1")
      expect(sourceMetadata.depends.geckolib).toBe(">=4.8.3 <5.0.0")
      expect(await readFile(path.join(sourceDirectory, "gradle/wrapper/gradle-wrapper.jar"))).toEqual(
        await readFile(path.join(identity.resourcesPath, "templates/fabric-1.21/gradle/wrapper/gradle-wrapper.jar")),
      )
      const bootstrapSource = "src/studioDev/java/com/minemods/studio/dev/ClasspathBootstrap.java"
      expect(await readFile(path.join(sourceDirectory, bootstrapSource))).toEqual(
        await readFile(path.join(identity.resourcesPath, "templates/fabric-1.21", bootstrapSource)),
      )
      const backup = JSON.parse(
        await readFile(path.join(sourceDirectory, "project-backup/minemods.project.json"), "utf8"),
      )
      expect(backup).toEqual(example.project)
      await Promise.all(
        example.project.assets.map(async (asset) => {
          const file = path.join(".minemods", "assets", asset.id, `${asset.revision}.json`)
          expect(await readFile(path.join(sourceDirectory, "project-backup", file))).toEqual(
            await readFile(path.join(saved.directory, file)),
          )
        }),
      )
      await page.getByRole("button", { name: /模组文件 .jar/ }).click()
      await expect(page.getByText(`已导出：${jarPath}`, { exact: true })).toBeVisible()
      expect(await readFile(jarPath)).toEqual(bytes)
      expect(await readFile(`${jarPath}.README.txt`, "utf8")).toContain("GeckoLib 4.8.3")
      await page.screenshot({ path: path.join(directory, "packaged-build-export.png") })
      expect((await page.evaluate((id) => window.studio.openProject(id), saved.project.id)).latest_build_job_id).toBe(
        jobId,
      )
      await page.getByRole("button", { name: "打开开发环境的游戏", exact: true }).click()
      await expect.poll(async () => (await jobFiles(jobsDirectory)).length).toBe(2)
      const playtestJobId = (await jobFiles(jobsDirectory))
        .find((file) => file !== `${jobId}.json`)!
        .replace(/\.json$/, "")
      const clientLog = path.join(build.sourceDirectory, "run", "logs", "latest.log")
      await expect
        .poll(
          async () => {
            const current = await page.evaluate((input) => window.studio.getJob(input), {
              projectId: saved.project.id,
              jobId: playtestJobId,
            })
            if (["failed", "canceled", "interrupted", "completed"].includes(current.state)) {
              await writeFile(path.join(directory, "packaged-playtest-job.json"), JSON.stringify(current, null, 2))
              throw new Error(`Playtest ended before client initialization: ${current.state}: ${current.error ?? ""}`)
            }
            const log = await readFile(clientLog, "utf8").catch(() => "")
            return log.includes("OpenAL initialized") && /Created:.*textures\/atlas\/blocks\.png-atlas/.test(log)
          },
          { timeout: 360000, intervals: [1000] },
        )
        .toBe(true)
      await writeFile(path.join(directory, "client-initialized.log"), await readFile(clientLog))
      const processQuery = path.join(directory, "owned-processes.ps1")
      await writeFile(
        processQuery,
        [
          "param([int]$RootPid)",
          '$ErrorActionPreference = "Stop"',
          "$studioProcesses = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,Name)",
          "$studioPids = [System.Collections.Generic.List[uint32]]::new()",
          "$studioPids.Add([uint32]$RootPid)",
          "for ($studioIndex = 0; $studioIndex -lt $studioPids.Count; $studioIndex++) {",
          "  foreach ($studioChild in $studioProcesses) {",
          "    if ($studioChild.ParentProcessId -eq $studioPids[$studioIndex] -and -not $studioPids.Contains([uint32]$studioChild.ProcessId)) { $studioPids.Add([uint32]$studioChild.ProcessId) }",
          "  }",
          "}",
          "$studioOwned = @($studioProcesses | Where-Object { $studioPids.Contains([uint32]$_.ProcessId) -and $_.ProcessId -ne $RootPid } | Select-Object ProcessId,ParentProcessId,Name)",
          "ConvertTo-Json -InputObject $studioOwned -Compress",
        ].join("\n"),
        { flag: "wx" },
      )
      const processOutput = await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          processQuery,
          "-RootPid",
          String(app.process().pid),
        ],
        { windowsHide: true, timeout: 15000 },
      )
      const descendants = JSON.parse(processOutput.stdout) as {
        ProcessId: number
        ParentProcessId: number
        Name: string
      }[]
      const javaPids = descendants
        .filter((process) => /^javaw?\.exe$/i.test(process.Name))
        .map((process) => process.ProcessId)
      expect(javaPids.length, "The initialized client must belong to the packaged app process tree").toBeGreaterThan(0)
      await writeFile(path.join(directory, "playtest-owned-processes.json"), JSON.stringify(descendants, null, 2))
      await page.getByRole("button", { name: "取消", exact: true }).click()
      await expect
        .poll(
          async () =>
            (
              await page.evaluate((input) => window.studio.getJob(input), {
                projectId: saved.project.id,
                jobId: playtestJobId,
              })
            ).state,
        )
        .toBe("canceled")
      await expect
        .poll(
          async () =>
            (
              await Promise.all(
                javaPids.map((pid) =>
                  Promise.resolve()
                    .then(() => {
                      process.kill(pid, 0)
                      return true
                    })
                    .catch((error: unknown) => {
                      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
                      throw error
                    }),
                ),
              )
            ).filter(Boolean).length,
          { timeout: 30000, intervals: [500] },
        )
        .toBe(0)
      await writeFile(
        path.join(directory, "packaged-playtest-job.json"),
        JSON.stringify(
          await page.evaluate((input) => window.studio.getJob(input), {
            projectId: saved.project.id,
            jobId: playtestJobId,
          }),
          null,
          2,
        ),
      )
      await page.screenshot({ path: path.join(directory, "packaged-playtest-canceled.png") })
      expect(errors).toEqual([])
      return {
        projectId: saved.project.id,
        jobId,
        build,
        sourceDirectory,
        playtestJobId,
        playtestJavaPids: javaPids,
        clientInitialized: true,
        playtestProcessesExited: true,
      }
    } finally {
      await writeFile(path.join(directory, "first-renderer-errors.json"), JSON.stringify(errors, null, 2))
      await page
        .screenshot({ path: path.join(directory, "first-last-state.png"), timeout: 3000 })
        .catch(() => undefined)
      await app.close()
    }
  })()

  const reopened = await _electron.launch(options)
  const restored = await reopened.firstWindow()
  restored.on("pageerror", (error) => errors.push(error.message))
  try {
    await reopened.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    await restored.waitForURL("**/index.html")
    await restored.locator(".project-card").filter({ hasText: "Packaged Example Cow" }).click()
    expect((await restored.evaluate((id) => window.studio.openProject(id), completed.projectId)).model_origin).toBe("manual")
    const view = await restored.evaluate((id) => window.studio.openProject(id), completed.projectId)
    expect(view.latest_build_job_id).toBe(completed.jobId)
    await reopened.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.webContents.send("studio:command", "export"))
    await expect(restored.getByRole("button", { name: "打包，不打开游戏", exact: true })).toBeEnabled()
    await reopened.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
    }, restoredJarPath)
    await restored.getByRole("button", { name: /模组文件 .jar/ }).click()
    await expect(restored.getByText(`已导出：${restoredJarPath}`, { exact: true })).toBeVisible()
    expect(
      createHash("sha256")
        .update(await readFile(restoredJarPath))
        .digest("hex"),
    ).toBe(completed.build.sha256)
    await restored.screenshot({ path: path.join(directory, "packaged-reopened-export.png") })
    expect(errors).toEqual([])
    await writeFile(
      path.join(directory, "packaged-acceptance.json"),
      JSON.stringify(
        {
          success: true,
          identity,
          archive_sha256: createHash("sha256")
            .update(await readFile(identity.appPath))
            .digest("hex"),
          ...completed,
          jarPath,
          restoredJarPath,
          ai_configured: false,
          origin: "example",
          native_dialog_substitution:
            "Only OS file/directory picker results were substituted; real renderer buttons, IPC, packaged worker, Gradle and exporters executed.",
          restored_latest_build_job_id: view.latest_build_job_id,
        },
        null,
        2,
      ),
    )
  } finally {
    await writeFile(path.join(directory, "renderer-errors.json"), JSON.stringify(errors, null, 2))
    await restored
      .screenshot({ path: path.join(directory, "reopened-last-state.png"), timeout: 3000 })
      .catch(() => undefined)
    await reopened.close()
  }
})
