import { test, expect, _electron } from "@playwright/test"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { zip } from "../fixtures/zip"

type BridgeDescriptor = { url: string; token: string }
type JsonResponse<T> = { ok: boolean; value?: T; error?: string }

test("external MCP fixture reviews, applies, exports and restores an import modification", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "import-modification-e2e-"))
  const runtime = path.join(directory, "runtime")
  const source = path.join(directory, "ability-pack.zip")
  const modifiedArchive = path.join(directory, "ability-pack-modified.zip")
  const projectBundle = path.join(directory, "ability-pack.modwork")
  const fixture = zip({
    "manifest.json": JSON.stringify({
      minecraft: { version: "1.21.1", modLoaders: [{ id: "fabric-0.17.2", primary: true }] },
      files: [],
    }),
    "kubejs/server_scripts/skills.js": "ServerEvents.recipes(event => { /* fixture */ })\n",
    "config/abilities.json": '{"cooldown":20}\n',
  })
  await writeFile(source, fixture)
  const sourceHash = createHash("sha256").update(fixture).digest("hex")
  const app = await _electron.launch({
    args: [path.resolve("."), `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
      MINEMODS_STUDIO_RUNTIME: runtime,
      MINEMODS_STUDIO_JAVA_HOME: "",
      JAVA_HOME: "",
    },
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const openPaths = [source, projectBundle]
  const savePaths = [modifiedArchive, projectBundle]
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.open.shift()!] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.save.shift()! })
    },
    { open: openPaths, save: savePaths },
  )

  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const previous = await window.studio.getConnection()
      const { hasApiKey: _hasApiKey, source: _source, ...settings } = previous
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
    })
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await expect(page.getByRole("heading", { name: "模组图鉴", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect(page.getByRole("heading", { name: "ability-pack", exact: true })).toBeVisible()
    const projectTabs = page.getByRole("tablist", { name: "模组里的东西" })
    // The backpack unpacks this small pack on open; wait for it to settle before looking at the files.
    const backpack = page.locator('section[aria-label="模组背包"]')
    await expect(backpack.getByRole("status")).toHaveCount(0, { timeout: 30000 })
    // 高级 shows the raw files here and, later, the .modwork export.
    await page.getByRole("button", { name: "高级", exact: true }).click()
    await projectTabs.getByRole("tab", { name: "文件" }).click()
    const workbench = page.locator('section[aria-label="文件工作台"]')
    const extract = workbench.getByRole("button", { name: "拆解所选内容", exact: true })
    await expect(workbench.locator(".iaw-layout").or(extract)).toBeVisible()
    if (await extract.isVisible()) {
      await workbench.locator(".iaw-group-card").filter({ hasText: "kubejs" }).getByRole("checkbox").check()
      await extract.click()
    }
    await expect(workbench.locator(".iaw-asset").filter({ hasText: "skills.js" })).toBeVisible()

    // The first read-through starts by itself; in MCP mode it waits for the external model.
    await projectTabs.getByRole("tab", { name: "玩法" }).click()
    const gameplay = page.locator('section[aria-label="玩法"]')
    await expect(gameplay.getByText("已经交给外部 AI", { exact: true })).toBeVisible()
    await expect(gameplay.locator(".import-analysis-status")).toContainText("玩法介绍")
    await expect(gameplay.locator(".import-analysis-status")).toContainText("等外部 AI 接手")

    await gameplay.getByLabel("想改点什么？", { exact: true }).fill("为技能脚本增加一次性的 fixture 注释变更。")
    await gameplay.getByRole("button", { name: "让 AI 出个方案", exact: true }).click()
    await expect(gameplay.locator(".import-analysis-status")).toContainText("修改方案")
    await expect(gameplay.locator(".import-analysis-status")).toContainText("等外部 AI 接手")
    await expect(gameplay.getByText("已经交给外部 AI", { exact: true })).toBeVisible()

    const descriptor = JSON.parse(await readFile(path.join(runtime, "mcp-connection.json"), "utf8")) as BridgeDescriptor
    const call = async <T>(method: string, input: unknown) => {
      const response = await fetch(descriptor.url, {
        method: "POST",
        headers: { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" },
        body: JSON.stringify({ method, input }),
      })
      const result = (await response.json()) as JsonResponse<T>
      expect(response.ok, `${method}: ${result.error ?? response.status}`).toBe(true)
      expect(result.ok, `${method}: ${result.error ?? "bridge returned an error"}`).toBe(true)
      return result.value as T
    }
    const discovery = await call<{
      projects: Array<{ manifest: { id: string }; runs: Array<{ id: string; state: string; kind: string }> }>
    }>("listImports", {})
    const project = discovery.projects.find((item) =>
      item.runs.some((run) => run.state === "awaiting_model" && run.kind === "modify"),
    )!
    const run = project.runs.find((item) => item.state === "awaiting_model" && item.kind === "modify")!
    expect(project.manifest.id).toBeTruthy()
    const task = await call<{
      run: { id: string }
      context: {
        projectId: string
        sourceSha256: string
        evidence: Array<{ id: string; path: string; sha256: string; content: string }>
      }
    }>("getImportTask", { id: project.manifest.id, runId: run.id })
    expect(task.context.projectId).toBe(project.manifest.id)
    expect(task.context.sourceSha256).toBe(sourceHash)
    const evidence = task.context.evidence.find((item) => item.path === "kubejs/server_scripts/skills.js")!
    expect(evidence).toBeTruthy()
    const fixturePlan = {
      schema_version: 1,
      analysis: {
        schema_version: 1,
        summary: "E2E 固定 fixture 方案；未调用真实 LLM。",
        gameplay: [
          {
            title: "技能脚本证据",
            description: "扫描上下文提供了技能脚本路径，可在该脚本中审阅文本修改。",
            evidence_ids: [evidence.id],
          },
        ],
        extension_points: [
          { path: evidence.path, description: "本 E2E fixture 的脚本变更位置。", evidence_ids: [evidence.id] },
        ],
        unknowns: [],
        needed_paths: [],
        requirements: [],
      },
      changeset: {
        schema_version: 1,
        id: randomUUID(),
        project_id: project.manifest.id,
        source_sha256: sourceHash,
        summary: "在技能脚本末尾加入 E2E fixture 注释",
        changes: [
          {
            path: evidence.path,
            operation: "write",
            expected_sha256: evidence.sha256,
            content: `${evidence.content.trimEnd()}\n// MineMods import modification E2E fixture\n`,
          },
        ],
        warnings: ["这是预定义 E2E fixture 内容，用于验证工作流，不代表真实模型输出。"],
      },
      evidence_map: [{ path: evidence.path, evidence_ids: [evidence.id], rationale: "脚本内容由扫描上下文直接提供。" }],
      validation_plan: [
        {
          step: "在目标游戏环境中检查技能脚本",
          expected: "脚本无语法错误并符合整合包加载器要求。",
          evidence_ids: [evidence.id],
        },
      ],
      limitations: ["本 E2E 只验证文本方案的审阅、应用和导出；不执行游戏，也不编译 Java 模组。"],
    }
    const submitted = await call<{ state: string }>("submitImportTask", {
      id: project.manifest.id,
      runId: run.id,
      result: fixturePlan,
    })
    expect(submitted.state).toBe("review")
    await expect(gameplay.locator(".import-analysis-status")).toContainText("等你确认")
    // The plan is open for review already; only the new file content is folded away.
    await expect(gameplay.getByText(/AI 打算改 1 处/)).toBeVisible()
    await gameplay.getByText("看看改成了什么", { exact: true }).click()
    await expect(gameplay.getByText("MineMods import modification E2E fixture", { exact: false })).toBeVisible()
    await page.screenshot({
      path: path.join(artifacts, "import-modification.png"),
      fullPage: true,
      animations: "disabled",
    })

    await gameplay.getByRole("button", { name: "就这么改", exact: true }).click()
    await expect(gameplay.locator(".import-analysis-status")).toContainText("修改方案")
    await expect(gameplay.locator(".import-analysis-status")).toContainText("已改好")
    await gameplay.getByRole("button", { name: "导出修改后的包", exact: true }).click()
    await expect(gameplay.getByRole("status").filter({ hasText: "已导出：" })).toBeVisible()
    await gameplay.getByRole("button", { name: "导出 .modwork 工程", exact: true }).click()
    await expect(gameplay.getByRole("status").filter({ hasText: "已导出：" })).toBeVisible()
    expect(await readFile(source)).toEqual(fixture)
    expect(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(sourceHash)
    expect((await readFile(modifiedArchive)).toString("binary").includes("PK")).toBe(true)
    expect((await readFile(projectBundle)).toString("binary").includes("PK")).toBe(true)

    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect
      .poll(async () =>
        page.evaluate(async (originalId) => {
          const tasks = await window.studio.listLibraryTasks()
          const projects = await window.studio.listImportedProjects()
          return tasks[0]?.state === "completed" && projects.some((item) => item.manifest.id !== originalId)
        }, project.manifest.id),
      )
      .toBe(true)
    const restored = await page.evaluate(
      async (originalId) =>
        (await window.studio.listImportedProjects()).find((item) => item.manifest.id !== originalId)!,
      project.manifest.id,
    )
    expect(restored.manifest.source.sha256).toBe(sourceHash)
    const restoredRuns = await page.evaluate(
      async (id) => window.studio.listImportAnalysisRuns({ id }),
      restored.manifest.id,
    )
    expect(restoredRuns.some((item) => item.state === "applied")).toBe(true)
    // The restored project opens as a fresh workspace with only the applied run; 高级 is app-wide and stays on.
    await expect(page.getByRole("button", { name: "高级", exact: true })).toHaveAttribute("aria-pressed", "true")
    await projectTabs.getByRole("tab", { name: "工程信息" }).click()
    await expect(page.locator("#workbench-pane-info .resource-path").first()).toHaveText(restored.directory)
    await projectTabs.getByRole("tab", { name: "玩法" }).click()
    await expect(gameplay.locator(".import-analysis-status")).toContainText("修改方案")
    await expect(gameplay.locator(".import-analysis-status")).toContainText("已改好")
    await page.screenshot({
      path: path.join(artifacts, "imported-project-restored.png"),
      fullPage: true,
      animations: "disabled",
    })
    expect(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(sourceHash)
    expect(errors).toEqual([])
  } catch (error) {
    console.log(
      `Import modification page state:\n${await page
        .locator("body")
        .innerText()
        .catch(() => "<unavailable>")}`,
    )
    await page
      .screenshot({ path: path.join(artifacts, "import-modification-failure.png"), fullPage: true })
      .catch(() => undefined)
    throw error
  } finally {
    await app.close()
    if (path.dirname(path.resolve(directory)) !== artifacts) throw new Error("Unexpected test cleanup path")
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})
