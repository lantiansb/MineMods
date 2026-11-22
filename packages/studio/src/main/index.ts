import { reviewEnabled } from "../connection"
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, safeStorage, session, shell, utilityProcess } from "electron"
import { MCP_PRESENCE } from "../mcp-presence"
import { systemProxy } from "./system-proxy"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ConnectionStoreRequestSchema, LookCancelSchema, LookRequestSchema, MOD_PICK, StudioRequestSchema, type WorkerRequest } from "./protocol"
import { createLookWindow } from "./look-window"
import type { LookJob, LookProgress } from "./look-job"
import { shutdownWithin } from "./lifecycle"
import { createConnectionStore } from "./connection-store"
import { createExternalMcpBridge } from "./external-mcp"
import { PublicConnectionSchema } from "../connection"
import { SettingsSchema } from "../settings"
import { THEME } from "../renderer/themes"
import { buildMcpHandoff, buildMcpReviewHandoff, carryRequest, configurationParts } from "./mcp-handoff"
import { connectClient, detectClients, realProbe } from "./ai-client-config"
import { AI_CLIENT_DOWNLOAD } from "../ai-clients"
import { PROVIDER_KEY_PAGE } from "../ai-providers"
import { ProjectSchema } from "@minemods/mod-core/project"
import { ImportProjectManifestSchema, ImportProjectReportSchema } from "@minemods/mod-core/import-project"
import { readToolSecrets, saveToolSecret } from "./tool-secrets"

app.setName("MineMods Studio")
if (process.platform === "win32") app.setAppUserModelId("com.minemods.studio")
const mainDirectory = path.join(app.getAppPath(), "dist", "main")

const state: {
  window?: BrowserWindow
  worker?: ReturnType<typeof utilityProcess.fork>
  shutdown?: () => Promise<void>
  stopBridge?: () => Promise<void>
  closeLooks?: () => void
  // Held on to: one nobody holds can be collected while it waits in the notification center, and a press on it then does nothing.
  notice?: Notification
  closing: boolean
  quitAllowed: boolean
} = { closing: false, quitAllowed: false }
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
const WorkerResponseSchema = z.union([
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({ type: z.literal("startup-error"), error: z.string() }),
  z.strictObject({ id: z.uuid(), ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ id: z.uuid(), ok: z.literal(false), error: z.string() }),
])

// Sent by the worker when the background preparation (提前准备) changed what the window shows of it.
const AheadChangedSchema = z.strictObject({ type: z.literal("ahead-changed") })
// Sent by the worker when a step of a making is on disk: 制作现场 reads it at once, not at its next turn.
const TraceChangedSchema = z.strictObject({ type: z.literal("trace-changed") })

if (!app.requestSingleInstanceLock()) app.quit()

app.on("second-instance", () => {
  if (process.env.MINEMODS_STUDIO_TEST === "1") return
  if (state.window?.isMinimized()) state.window.restore()
  state.window?.show()
  state.window?.focus()
})

app
  .whenReady()
  .then(async () => {
    const runtimeDirectory = process.env.MINEMODS_STUDIO_RUNTIME || path.join(app.getPath("userData"), "runtime")
    const connectionStore = createConnectionStore(path.join(runtimeDirectory, "connection.json"), {
      encrypt: (value) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("系统密钥保护暂不可用，请重启后再保存连接。")
        return safeStorage.encryptString(value).toString("base64")
      },
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    })
    // Downloads and Gradle read the proxy from HTTPS_PROXY. Set none, they use the one the computer itself is set to use.
    const proxy =
      process.env.HTTPS_PROXY || process.env.HTTP_PROXY
        ? null
        : systemProxy(await session.defaultSession.resolveProxy("https://piston-data.mojang.com/").catch(() => "DIRECT"))
    const worker = utilityProcess.fork(path.join(mainDirectory, "worker.js"), [], {
      serviceName: "MineMods Studio project service",
      env: {
        ...process.env,
        ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}),
        MINEMODS_STUDIO_WORKSPACE:
          process.env.MINEMODS_STUDIO_WORKSPACE || path.join(app.getPath("userData"), "projects"),
        MINEMODS_LOOK_PLAN_WORKER: path.join(mainDirectory, "look-plan-worker.js"),
        MINEMODS_STUDIO_RUNTIME: process.env.MINEMODS_STUDIO_RUNTIME || path.join(app.getPath("userData"), "runtime"),
        ...(developmentJava() ? { MINEMODS_STUDIO_JAVA_HOME: developmentJava() } : {}),
        MINEMODS_STUDIO_TEMPLATES:
          process.env.MINEMODS_STUDIO_TEMPLATES ||
          (app.isPackaged
            ? path.join(process.resourcesPath, "templates", "fabric-1.21")
            : path.resolve(app.getAppPath(), "../..", "templates", "fabric-1.21")),
      },
    })
    state.worker = worker
    // Pictures for the making loop are drawn here, in a window nobody sees; the worker only asks for them.
    const looks = createLookWindow(path.join(mainDirectory, "../renderer/look.html"))
    state.closeLooks = looks.close
    const lookRequests = new Map<string, AbortController>()
    const health: { error?: Error } = {}
    const readiness = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        health.error = new Error("后台服务启动超时，请重启应用。")
        reject(health.error)
      }, 30000)
      worker.on("message", (input: unknown) => {
        const storage = ConnectionStoreRequestSchema.safeParse(input)
        if (storage.success) {
          const message = storage.data
          void (
            message.type === "connection-load"
              ? connectionStore.load()
              : connectionStore.save(message.value).then(() => null)
          )
            .then((value) => worker.postMessage({ type: "connection-result", id: message.id, ok: true, value }))
            .catch(() =>
              worker.postMessage({
                type: "connection-result",
                id: message.id,
                ok: false,
                error: "无法读取或保存受保护的连接设置，请检查此设备的账户权限。",
              }),
            )
          return
        }
        // The background preparation changed: the window reads the build panel and the Java line again now, instead of at its next turn.
        if (AheadChangedSchema.safeParse(input).success) {
          if (state.window && !state.window.isDestroyed()) state.window.webContents.send("studio:command", "prepared")
          return
        }
        // 工具资产: the worker asks for the tools' keys (decrypted here, where the system's key store is), and says the tools changed (the window reads them again).
        const toolMessage = input as { type?: unknown; id?: unknown } | null
        if (toolMessage?.type === "tool-secrets-load" && typeof toolMessage.id === "string") {
          const id = toolMessage.id
          void readToolSecrets(runtimeDirectory, (value) => safeStorage.decryptString(Buffer.from(value, "base64")))
            .catch(() => ({}))
            .then((value) => worker.postMessage({ type: "tool-secrets-result", id, value }))
          return
        }
        if (toolMessage?.type === "tools-changed") {
          if (state.window && !state.window.isDestroyed()) state.window.webContents.send("studio:command", "tools")
          return
        }
        if (TraceChangedSchema.safeParse(input).success) {
          if (state.window && !state.window.isDestroyed()) state.window.webContents.send("studio:command", "trace")
          return
        }
        const canceledLook = LookCancelSchema.safeParse(input)
        if (canceledLook.success) {
          lookRequests.get(canceledLook.data.id)?.abort()
          lookRequests.delete(canceledLook.data.id)
          return
        }
        const look = LookRequestSchema.safeParse(input)
        if (look.success) {
          const progress: LookProgress | undefined = look.data.progress ? (done, total) => worker.postMessage({ type: "look-progress", id: look.data.id, done, total }) : undefined
          const { id, job } = look.data
          const controller = new AbortController()
          lookRequests.set(id, controller)
          void looks.render(job as LookJob, progress, controller.signal).then((result) => {
            lookRequests.delete(id)
            if (!controller.signal.aborted) worker.postMessage({ type: "look-result", id, result })
          })
          return
        }
        const parsed = WorkerResponseSchema.safeParse(input)
        if (!parsed.success) return
        const message = parsed.data
        if ("type" in message) {
          clearTimeout(timer)
          if (message.type === "ready") resolve()
          if (message.type === "startup-error") {
            health.error = new Error(message.error)
            reject(health.error)
          }
          return
        }
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        if (message.ok) request.resolve(message.value)
        if (!message.ok) request.reject(new Error(message.error))
      })
      worker.on("exit", () => {
        clearTimeout(timer)
        const error = new Error("后台服务已停止，请重启应用后重新打开项目。")
        health.error = error
        reject(error)
        pending.forEach((request) => request.reject(error))
        pending.clear()
      })
    })
    // A rejected startup remains available to each IPC caller without an unhandled rejection.
    readiness.catch(() => undefined)
    state.shutdown = () =>
      new Promise<void>((resolve, reject) => {
        if (health.error) return reject(health.error)
        const id = randomUUID()
        pending.set(id, { resolve: () => resolve(), reject })
        worker.postMessage({ id, control: "shutdown" })
      })

    async function request(input: WorkerRequest) {
      if (state.closing) throw new Error("应用正在关闭，无法接受新任务。")
      await readiness
      if (state.closing) throw new Error("应用正在关闭，无法接受新任务。")
      if (health.error) throw health.error
      return new Promise<unknown>((resolve, reject) => {
        const id = randomUUID()
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, request: input })
      })
    }

    await readiness
    const bridge = createExternalMcpBridge({
      token: randomBytes(32).toString("hex"),
      call: (method, input) => request({ method: "externalCall", input: { method, input } }),
      // The window polls for runs; after a step that changes one it is told to look now instead of at its next turn.
      onChanged: () => {
        if (state.window && !state.window.isDestroyed()) state.window.webContents.send("studio:command", "changed")
      },
    })
    const descriptor = await bridge.start()
    state.stopBridge = () => bridge.stop()
    const descriptorPath = path.join(runtimeDirectory, "mcp-connection.json")
    await mkdir(runtimeDirectory, { recursive: true })
    await writeFile(`${descriptorPath}.tmp`, JSON.stringify(descriptor), { encoding: "utf8", mode: 0o600 })
    await rename(`${descriptorPath}.tmp`, descriptorPath)
    const configuration = JSON.stringify(
      {
        mcpServers: {
          "minemods-studio": {
            command: process.execPath,
            args: [path.join(mainDirectory, "mcp-stdio.js"), "--mcp-stdio", "--connection", descriptorPath],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          },
        },
      },
      null,
      2,
    )
    const window = new BrowserWindow({
      title: "MineMods Studio",
      width: 1480,
      height: 980,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: THEME.background,
      titleBarStyle: "hidden",
      titleBarOverlay: { color: THEME.titlebar, symbolColor: THEME.titlebarText, height: 48 },
      show: process.env.MINEMODS_STUDIO_TEST !== "1",
      autoHideMenuBar: true,
      webPreferences: {
        backgroundThrottling: process.env.MINEMODS_STUDIO_TEST !== "1",
        offscreen: process.env.MINEMODS_STUDIO_TEST === "1",
        preload: path.join(mainDirectory, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    })
    state.window = window
    // Watch in the host, including while minimized. The transition itself deduplicates notifications.
    let presenceBefore = bridge.status().state
    let externalMode = false
    const presenceWatch = setInterval(() => {
      const status = bridge.status()
      if (status.state === presenceBefore) return
      presenceBefore = status.state
      window.webContents.send("studio:command", "presence")
      if (!externalMode || status.state !== "disconnected" || (window.isFocused() && !window.isMinimized()) || !Notification.isSupported()) return
      const notification = new Notification({ title: "MineMods · 断开了", body: `${status.task ? `「${status.task}」已交来的内容` : "工程的修改"}已经存好。回到窗口重新检测连接。` })
      notification.on("click", () => {
        if (window.isMinimized()) window.restore()
        window.show()
        // Windows lets a process in the background raise its window but not take the focus. On top for a moment is what brings it in front of what the person was in.
        window.setAlwaysOnTop(true)
        window.moveTop()
        app.focus({ steal: true })
        window.focus()
        window.setAlwaysOnTop(false)
      })
      state.notice = notification
      notification.show()
    }, MCP_PRESENCE.watch)
    window.once("closed", () => clearInterval(presenceWatch))
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "工程",
          submenu: [
            {
              label: "新建工程",
              accelerator: "CmdOrCtrl+N",
              click: () => window.webContents.send("studio:command", "new"),
            },
            {
              label: "打开工程…",
              accelerator: "CmdOrCtrl+O",
              click: () => window.webContents.send("studio:command", "open"),
            },
            { label: "所有工程", click: () => window.webContents.send("studio:command", "home") },
            { type: "separator" },
            {
              label: "导出工程…",
              accelerator: "CmdOrCtrl+Shift+E",
              click: () => window.webContents.send("studio:command", "export"),
            },
            { type: "separator" },
            { role: "quit", label: "退出" },
          ],
        },
        {
          label: "编辑",
          submenu: [
            { role: "undo", label: "撤销" },
            { role: "redo", label: "重做" },
            { type: "separator" },
            { role: "cut", label: "剪切" },
            { role: "copy", label: "复制" },
            { role: "paste", label: "粘贴" },
            { role: "selectAll", label: "全选" },
          ],
        },
        {
          label: "视图",
          submenu: [
            { role: "resetZoom", label: "实际大小" },
            { role: "zoomIn", label: "放大" },
            { role: "zoomOut", label: "缩小" },
            { type: "separator" },
            { role: "togglefullscreen", label: "全屏" },
          ],
        },
        {
          label: "设置",
          submenu: [
            {
              label: "工作室设置",
              accelerator: "CmdOrCtrl+,",
              click: () => window.webContents.send("studio:command", "settings"),
            },
          ],
        },
      ]),
    )
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event) => event.preventDefault())
    window.webContents.on("will-attach-webview", (event) => event.preventDefault())
    window.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(window, {
        type: "warning",
        title: "还有未保存修改",
        message: "还有未保存修改",
        detail: "退出会丢失尚未保存的模型或玩法修改。选择取消可返回继续编辑和保存。",
        buttons: ["取消", "放弃并退出"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (choice === 1) event.preventDefault()
    })
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(
        contents === window.webContents &&
          permission === "media" &&
          "mediaTypes" in details &&
          details.mediaTypes?.length === 1 &&
          details.mediaTypes[0] === "audio",
      ),
    )
    window.webContents.session.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        contents === window.webContents && permission === "media" && details.mediaType === "audio",
    )
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel: details.webContentsId === window.webContents.id && !/^(file|data|blob|devtools):/.test(details.url),
      })
    })

    ipcMain.handle("studio:invoke", async (event, input: unknown) => {
      if (state.closing) throw new Error("应用正在关闭，无法接受新任务。")
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw new Error("此请求来源不受信任。")
      const parsed = StudioRequestSchema.safeParse(input)
      if (!parsed.success) throw new Error("请求参数无效，请刷新窗口后重试。")
      const message = parsed.data
      if (message.method === "getMcpStatus") {
        const connection = PublicConnectionSchema.parse(await request({ method: "getConnection" }))
        externalMode = connection.mode === "mcp"
        const status = bridge.status()
        return {
          ...status,
          enabled: connection.mode === "mcp",
          connected: connection.mode === "mcp" && status.connected,
          clients: status.clients,
          lastActivity: status.lastActivity ? new Date(status.lastActivity).toISOString() : null,
          madeProject: status.madeProject ? { ...status.madeProject, at: new Date(status.madeProject.at).toISOString() } : null,
          configuration,
          codexConfiguration: configurationParts(configuration).toml,
        }
      }
      if (message.method === "copyText") {
        clipboard.writeText(message.input.text)
        return
      }
      if (message.method === "copyMcpConfig") {
        clipboard.writeText(configuration)
        return
      }
      // 一键接上: only reads, until the person presses the button for one assistant; the settings of any other program are never touched otherwise.
      if (message.method === "detectAiClients") return detectClients(realProbe(), configurationParts(configuration))
      if (message.method === "connectAiClient") return connectClient(message.input.client, realProbe(), configurationParts(configuration))
      if (message.method === "openAiClientDownload") {
        await shell.openExternal(AI_CLIENT_DOWNLOAD[message.input.client])
        return
      }
      if (message.method === "openProviderKeyPage") {
        await shell.openExternal(PROVIDER_KEY_PAGE[message.input.provider])
        return
      }
      if (message.method === "getMcpHandoff" || message.method === "copyMcpHandoff") {
        const view = message.input.projectId
          ? z
              .object({ project: ProjectSchema })
              .parse(await request({ method: "openProject", input: message.input.projectId }))
          : undefined
        const project = view ? { id: view.project.id, name: view.project.name, revision: view.project.revision } : undefined
        // 「审查」: on unless the person turned it off. On, the maker's hand-off sends reviews to the other window, and there is a second hand-off for that window.
        const review = reviewEnabled(PublicConnectionSchema.parse(await request({ method: "getConnection" })))
        // 个人设置: the maker's hand-off carries the person's standing wishes; the reviewer's, how to address them at most.
        const person = SettingsSchema.parse(await request({ method: "getSettings" }))
        const handoff =
          message.input.role === "reviewer"
            ? buildMcpReviewHandoff({ configuration, project, person })
            : buildMcpHandoff({ configuration, complexity: person.modelComplexity, project, review, person })
        if (message.method === "getMcpHandoff") return handoff
        clipboard.writeText(carryRequest(handoff, { role: message.input.role, request: message.input.request, ifNoPlan: message.input.ifNoPlan, planned: !!view?.project.blueprint }))
        return
      }
      // r29c: a project folder anywhere on disk to bring things from, read where it is (`projectImportSourceAt`).
      if (message.method === "chooseProjectImportFolder") {
        const choice = await dialog.showOpenDialog(window, { title: "选要从里面带东西的工程文件夹", properties: ["openDirectory"] })
        if (choice.canceled || !choice.filePaths[0]) return null
        return request({ method: "projectImportSourceAt", input: { projectId: message.input.projectId, sourcePath: choice.filePaths[0] } })
      }
      if (message.method === "chooseExistingProject") {
        const choice = await dialog.showOpenDialog(window, { title: "打开工程目录", properties: ["openDirectory"] })
        if (choice.canceled || !choice.filePaths[0]) return null
        return request({ method: "openProjectDirectory", input: { directory: choice.filePaths[0] } })
      }
      if (message.method === "getBlockbenchRuntime") throw new Error("模型构建已改为本地核心视窗。")
      if (message.method === "chooseProjectLocation") {
        const choice = await dialog.showOpenDialog(window, {
          title: "工程保存位置",
          properties: ["openDirectory", "createDirectory"],
        })
        if (choice.canceled || !choice.filePaths[0]) return null
        return request({ method: "registerLocation", input: { token: randomUUID(), directory: choice.filePaths[0] } })
      }
      // 运行环境 (2026-10-08): where Studio's own JDK goes is a folder the person picks here, never a path the window types.
      if (message.method === "chooseJavaDirectory") {
        const choice = await dialog.showOpenDialog(window, {
          title: "选择 Java 的安装位置",
          properties: ["openDirectory", "createDirectory"],
        })
        if (choice.canceled || !choice.filePaths[0]) return null
        return request({ method: "registerJavaDirectory", input: { major: message.input.major, directory: choice.filePaths[0] } })
      }
      // 预装模组: the jars the person picks; the window only ever holds a token for each.
      if (message.method === "chooseModFiles") {
        const choice = await dialog.showOpenDialog(window, {
          title: "选择要装进测试场的模组",
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "Minecraft 模组", extensions: ["jar"] }],
        })
        if (choice.canceled || !choice.filePaths.length) return []
        if (choice.filePaths.length > MOD_PICK.limit) throw new Error(MOD_PICK.words)
        return request({ method: "registerModFiles", input: { files: choice.filePaths.map((filename) => ({ token: randomUUID(), filename })) } })
      }
      // 工具资产: a tool's key is encrypted here, where the system's key store is, and never goes back to the window.
      if (message.method === "saveToolSecret") {
        await saveToolSecret(runtimeDirectory, message.input.name, message.input.value, (value) => {
          if (!safeStorage.isEncryptionAvailable()) throw new Error("系统密钥保护暂不可用，请重启后再保存密钥。")
          return safeStorage.encryptString(value).toString("base64")
        })
        await request({ method: "toolSecretsChanged" })
        return
      }
      // The person's own copy of a program Studio looks after: a file they pick here, never a path the window types.
      if (message.method === "chooseOwnProgram") {
        const choice = await dialog.showOpenDialog(window, { title: "选择你自己的 ffmpeg", properties: ["openFile"], filters: [{ name: "ffmpeg", extensions: process.platform === "win32" ? ["exe"] : ["*"] }] })
        if (choice.canceled || !choice.filePaths[0]) return null
        return request({ method: "useOwnProgram", input: { id: message.input.id, path: choice.filePaths[0] } })
      }
      if (message.method === "chooseImport") {
        const choice = await dialog.showOpenDialog(window, {
          title: "打开 MineMods 工程",
          properties: ["openFile"],
          filters: [{ name: "MineMods 工程", extensions: ["minemods"] }],
        })
        if (choice.canceled || !choice.filePaths[0]) return null
        return request({ method: "inspectArchive", input: { token: randomUUID(), filename: choice.filePaths[0] } })
      }
      if (message.method === "chooseImportSource") {
        const choice = await dialog.showOpenDialog(window, {
          title: "导入整合包、模组或修改工程",
          properties: ["openFile"],
          filters: [
            { name: "整合包、模组与 MineMods 修改工程", extensions: ["jar", "zip", "mrpack", "modwork", "modreverse"] },
          ],
        })
        if (choice.canceled || !choice.filePaths[0]) return null
        return request({ method: "startImportSource", input: { filename: choice.filePaths[0] } })
      }
      if (message.method === "chooseReverseDependencies") {
        const choice = await dialog.showOpenDialog(window, {
          title: "添加编译依赖 JAR",
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "Java 依赖", extensions: ["jar"] }],
        })
        if (choice.canceled || !choice.filePaths.length) return null
        return request({
          method: "buildReverseModuleWithDependencies",
          input: { ...message.input, dependencyPaths: choice.filePaths },
        })
      }
      if (message.method === "exportImportedAssets") {
        const choice = await dialog.showSaveDialog(window, {
          title: "导出已分类资产工程",
          defaultPath: `MineMods-assets-${message.input.id.slice(0, 8)}.zip`,
          filters: [{ name: "MineMods 资产工程", extensions: ["zip"] }],
        })
        if (choice.canceled || !choice.filePath) return null
        return request({ method: "exportImportedAssetsTo", input: { ...message.input, destination: choice.filePath } })
      }
      if (message.method === "exportReverseProject") {
        const imported = z
          .object({ manifest: ImportProjectManifestSchema })
          .parse(await request({ method: "getImportedProject", input: { id: message.input.id } }))
        const extension =
          message.input.kind === "project"
            ? "modreverse"
            : path.extname(imported.manifest.source.filename).slice(1).toLowerCase()
        const choice = await dialog.showSaveDialog(window, {
          title: message.input.kind === "project" ? "导出通用逆向工程" : "导出完整修改包",
          defaultPath: `MineMods-reverse-${message.input.id.slice(0, 8)}.${extension}`,
          filters: [
            { name: message.input.kind === "project" ? "MineMods 逆向工程" : "原包格式", extensions: [extension] },
          ],
        })
        if (choice.canceled || !choice.filePath) return null
        return request({ method: "exportReverseProjectTo", input: { ...message.input, destination: choice.filePath } })
      }
      if (message.method === "exportImportedReport") {
        const choice = await dialog.showSaveDialog(window, {
          title: "导出扫描报告",
          defaultPath: `MineMods-analysis-${message.input.id.slice(0, 8)}.modscan`,
          filters: [{ name: "扫描报告", extensions: ["modscan"] }],
        })
        if (choice.canceled || !choice.filePath) return null
        return request({
          method: "exportImportedReportTo",
          input: { id: message.input.id, destination: choice.filePath },
        })
      }
      if (message.method === "exportModifiedImport") {
        const imported = z
          .strictObject({
            directory: z.string(),
            manifest: ImportProjectManifestSchema,
            report: ImportProjectReportSchema,
          })
          .parse(await request({ method: "getImportedProject", input: { id: message.input.id } }))
        const sourceName = imported.manifest.source.filename
        if (path.basename(sourceName) !== sourceName) throw new Error("导入工程的原始文件名无效，无法导出。")
        const sourceExtension = path.extname(sourceName).slice(1).toLowerCase()
        const extension = message.input.kind === "project" ? "modwork" : sourceExtension
        const choice = await dialog.showSaveDialog(window, {
          title: message.input.kind === "project" ? "导出修改后的 .modwork 工程" : "导出完整修改包",
          defaultPath: `MineMods-modified-${message.input.id.slice(0, 8)}.${extension}`,
          filters: [
            { name: message.input.kind === "project" ? "MineMods 修改工程" : "原始包格式", extensions: [extension] },
          ],
        })
        if (choice.canceled || !choice.filePath) return null
        return request({
          method: "exportModifiedImportTo",
          input: { ...message.input, destination: choice.filePath },
        })
      }
      if (message.method === "exportProject") {
        const choice = await dialog.showSaveDialog(window, {
          title: "导出工程",
          defaultPath: `MineMods-${new Date().toISOString().slice(0, 10)}.minemods`,
          filters: [{ name: "MineMods 工程", extensions: ["minemods"] }],
        })
        if (choice.canceled || !choice.filePath) return null
        return request({
          method: "exportProjectTo",
          input: { projectId: message.input.projectId, destination: choice.filePath },
        })
      }
      if (message.method === "exportSource") {
        const selected = await dialog.showOpenDialog(window, {
          title: "选择源码导出目录",
          properties: ["openDirectory", "createDirectory"],
        })
        if (selected.canceled || !selected.filePaths[0]) throw new Error("已取消源码导出。")
        return request({
          method: "exportSourceTo",
          input: {
            projectId: message.input.projectId,
            destination: path.join(selected.filePaths[0], `MineMods-source-${randomUUID().slice(0, 8)}`),
          },
        })
      }
      if (message.method === "revealRecordedJar") {
        shell.showItemInFolder(z.string().parse(await request(message)))
        return
      }
      if (message.method === "revealBuildJar") {
        const jar = await request({ method: "jarHandoff", input: { ...message.input, reveal: true } })
        shell.showItemInFolder(z.string().parse(jar))
        return
      }
      if (message.method === "exportJar") {
        const selected = await dialog.showSaveDialog(window, {
          title: "导出 Mod JAR",
          defaultPath: z.string().parse(await request({ method: "jarHandoff", input: { ...message.input, reveal: false } })),
          filters: [{ name: "Minecraft Mod", extensions: ["jar"] }],
        })
        if (selected.canceled || !selected.filePath) throw new Error("已取消 JAR 导出。")
        return request({ method: "exportJarTo", input: { ...message.input, destination: selected.filePath } })
      }
      // Data-only gameplay (Engineer C): the person picks where the Blockbench file goes.
      if (message.method === "exportBlockbench") {
        const selected = await dialog.showSaveDialog(window, {
          title: "导出 Blockbench 模型",
          defaultPath: "model.bbmodel",
          filters: [{ name: "Blockbench 模型", extensions: ["bbmodel"] }],
        })
        if (selected.canceled || !selected.filePath) throw new Error("已取消模型导出。")
        return request({ method: "exportBlockbenchTo", input: { ...message.input, destination: selected.filePath } })
      }
      return request(message)
    })

    window.on("closed", () => {
      state.window = undefined
      state.closeLooks?.()
      app.quit()
    })
    await window.loadFile(path.join(mainDirectory, "../renderer/index.html"))
  })
  .catch(async (error: unknown) => {
    // Round 20: the owner met this box and nothing said why — the error itself was dropped here. It is written to a file in
    // Studio's own data folder with where Studio was started from, and the box says where that file is.
    const report = path.join(app.getPath("userData"), "startup-error.txt")
    const text = `${new Date().toISOString()}\n${app.getAppPath()}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    const written = await mkdir(path.dirname(report), { recursive: true }).then(() => writeFile(report, text)).then(() => true, () => false)
    if (process.env.MINEMODS_STUDIO_TEST === "1") {
      process.stderr.write(`MineMods Studio 无法启动，请检查安装文件和工程目录权限。\n${text}`)
      app.exit(1)
      return
    }
    dialog.showErrorBox("MineMods Studio 无法启动", `没能启动。${written ? `原因记在这个文件里，把它发给开发者就能查：\n${report}` : "原因也没能写进文件。"}\n\n可以先检查：安装是否完整、工程文件夹能不能读写、有没有另一个 MineMods Studio 已经开着。`)
    app.quit()
  })

app.on("window-all-closed", () => app.quit())
app.on("before-quit", (event) => {
  if (state.quitAllowed || !state.worker) return
  event.preventDefault()
  if (state.closing) return
  // Let the renderer's beforeunload confirmation finish before touching the backend.
  // A canceled window close must leave IPC, active work and future edits available.
  if (state.window && !state.window.isDestroyed()) {
    state.window.close()
    return
  }
  state.closing = true
  void shutdownWithin(
    async () => {
      await state.stopBridge?.()
      await state.shutdown?.()
    },
    () => {
      state.worker?.kill()
    },
  ).finally(() => {
    state.quitAllowed = true
    app.quit()
  })
})

/**
 * Source runs reuse the repository's pinned JDK 21 (.artifacts/toolchains/temurin21) when nothing
 * explicit is configured, instead of depending on whatever JAVA_HOME the shell happens to have.
 */
function developmentJava() {
  if (process.env.MINEMODS_STUDIO_JAVA_HOME || app.isPackaged) return undefined
  const root = path.resolve(app.getAppPath(), "../..", ".artifacts", "toolchains", "temurin21")
  const executable = process.platform === "win32" ? "java.exe" : "java"
  try {
    const found = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("jdk-21"))
      .map((entry) => path.join(root, entry.name))
      .find((directory) => existsSync(path.join(directory, "bin", executable)))
    return found
  } catch {
    return undefined
  }
}
