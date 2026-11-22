import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { StudioApi } from "../../api"
import { Button } from "../ui"
import { Icon } from "../ui"
import "./reverse-workbench.css"
import { Fold } from "../fold"

type ReverseState = Awaited<ReturnType<StudioApi["getReverseState"]>>
type ReverseModule = NonNullable<ReverseState["project"]>["modules"][number]
type ReverseFile = Awaited<ReturnType<StudioApi["listReverseFiles"]>>[number]
type ReverseRead = Awaited<ReturnType<StudioApi["readReverseFile"]>>
type ReverseRun = ReverseState["runs"][number]
type ReverseChange = Parameters<StudioApi["editReverseFiles"]>[0]["changes"][number]

const operationNames = { prepare: "还原源码与资源", build: "模块编译" } as const
const operationStateNames = { running: "进行中", completed: "做好了", failed: "失败", canceled: "已取消" } as const
const runStateNames = {
  awaiting_model: "等待外部模型",
  running: "分析中",
  review: "等你查看",
  applied: "已应用",
  failed: "失败",
  canceled: "已取消",
} as const
const isActiveRun = (run: ReverseRun) => run.state === "awaiting_model" || run.state === "running"

function ModuleCard(props: {
  module: ReverseModule
  disabled: boolean
  onBuild: (module: ReverseModule, addDependencies: boolean) => void
}) {
  return (
    <article class="reverse-module-card">
      <div class="reverse-module-card-top">
        <Icon name="cube" />
        <span class={`reverse-status ${props.module.build.status}`}>
          {props.module.build.status === "success"
            ? "编译成功"
            : props.module.build.status === "failed"
              ? "编译失败"
              : "未编译"}
        </span>
      </div>
      <strong title={props.module.name || props.module.id}>{props.module.name || props.module.id}</strong>
      <span class="reverse-module-count">
        {props.module.sourceCount} 源码 · {props.module.classCount} class
      </span>
      <Fold class="reverse-module-status" summary="详情与诊断">
        <p class="resource-path">模块 ID：{props.module.id}</p>
        <p>源码还原状态：{props.module.status}</p>
        <p>
          反编译退出码：{props.module.decompile.exitCode ?? "未运行"} · 超时：
          {props.module.decompile.timedOut ? "是" : "否"}
        </p>
        <Show when={props.module.decompile.warning}>
          <p class="resource-warning">{props.module.decompile.warning}</p>
        </Show>
        <Show when={props.module.decompile.stderr}>
          <pre>{props.module.decompile.stderr}</pre>
        </Show>
        <Fold summary={<>真实编译诊断 · {props.module.build.status}</>}>
          <Show when={props.module.build.attemptedAt} fallback={<p class="muted">尚未编译此模块。</p>}>
            <p>
              时间：{props.module.build.attemptedAt} · 退出码：{props.module.build.exitCode ?? "无"} · 超时：
              {props.module.build.timedOut ? "是" : "否"}
            </p>
            <Show when={props.module.build.outputJarPath}>
              <p class="resource-path">输出 JAR：{props.module.build.outputJarPath}</p>
            </Show>
            <Show when={props.module.build.diagnostics.length}>
              <pre>{props.module.build.diagnostics.join("\n")}</pre>
            </Show>
            <Show when={props.module.build.stderr}>
              <Fold summary="完整 stderr">
                <pre>{props.module.build.stderr}</pre>
              </Fold>
            </Show>
            <Show when={props.module.build.stdout}>
              <Fold summary="完整 stdout">
                <pre>{props.module.build.stdout}</pre>
              </Fold>
            </Show>
          </Show>
        </Fold>
        <Show when={props.module.dependencies.length}>
          <Fold class="reverse-module-status" summary={<>依赖与元数据线索 · {props.module.dependencies.length}</>}>
            <For each={props.module.dependencies}>
              {(dependency) => (
                <p>
                  <code>{dependency.id}</code> · {dependency.version ?? "版本未知"} · {dependency.evidence}
                </p>
              )}
            </For>
          </Fold>
        </Show>
        <Show when={props.module.dependencyFiles.length}>
          <Fold class="reverse-module-status" summary={<>已托管编译依赖 · {props.module.dependencyFiles.length}</>}>
            <For each={props.module.dependencyFiles}>
              {(dependency) => (
                <p>
                  <code>{dependency.filename}</code> · {dependency.size.toLocaleString()} 字节 · SHA-256{" "}
                  <code>{dependency.sha256}</code>
                </p>
              )}
            </For>
          </Fold>
        </Show>
        <p>
          原包：<code>{props.module.archivePath}</code>
        </p>
        <p>
          源码：<code>{props.module.sourceRoot || "未识别"}</code>
        </p>
        <p>
          资源：<code>{props.module.resourceRoot || "未识别"}</code>
        </p>
      </Fold>
      <div class="reverse-actions reverse-module-buttons">
        <Button disabled={props.disabled} onClick={() => props.onBuild(props.module, false)}>
          编译此模块
        </Button>
        <Button disabled={props.disabled} onClick={() => props.onBuild(props.module, true)}>
          添加依赖 JAR 并编译
        </Button>
      </div>
    </article>
  )
}

export function ReverseProjectPanel(props: { id: string; name: string; view?: "modules" | "files" | "ai" | "runs" }) {
  const [state, setState] = createSignal<ReverseState>()
  const [boundProjectId, setBoundProjectId] = createSignal(props.id)
  const [files, setFiles] = createSignal<ReverseFile[]>([])
  const [moduleSearch, setModuleSearch] = createSignal("")
  const [moduleLimit, setModuleLimit] = createSignal(50)
  const [tab, setTab] = createSignal("modules")
  const [fileSearch, setFileSearch] = createSignal("")
  const [fileLimit, setFileLimit] = createSignal(150)
  createEffect(() => {
    files()
    fileSearch()
    setFileLimit(150)
  })
  const [prefix, setPrefix] = createSignal("")
  const [selectedPath, setSelectedPath] = createSignal("")
  const [file, setFile] = createSignal<ReverseRead>()
  const [draft, setDraft] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [selectedRunId, setSelectedRunId] = createSignal("")
  const [busyProjectIds, setBusyProjectIds] = createSignal<string[]>([])
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [exportWarnings, setExportWarnings] = createSignal<string[]>([])
  let latestStateRequest = 0
  let latestFilesRequest = 0
  let latestFileRead = 0
  const currentRun = createMemo(() => state()?.runs.find((run) => run.id === selectedRunId()))
  const selectedEntry = createMemo(() => files().find((entry) => entry.path === selectedPath()))
  const filteredFiles = createMemo(() =>
    files().filter(
      (entry) => !fileSearch().trim() || entry.path.toLowerCase().includes(fileSearch().trim().toLowerCase()),
    ),
  )
  const modules = createMemo(() => state()?.project?.modules ?? [])
  const filteredModules = createMemo(() => {
    const query = moduleSearch().trim().toLowerCase()
    return modules().filter(
      (module) =>
        !query ||
        [module.id, module.name, module.archivePath, module.sourceRoot, module.resourceRoot].some((value) =>
          value.toLowerCase().includes(query),
        ),
    )
  })
  const currentOperation = createMemo(() => state()?.operations.find((operation) => operation.state === "running"))
  const busy = createMemo(() => busyProjectIds().includes(props.id))
  const editable = createMemo(() => {
    const path = selectedPath().toLowerCase()
    return (
      file()?.encoding === "utf8" &&
      !file()?.truncated &&
      ((selectedEntry()?.kind === "source" && path.endsWith(".java")) || selectedEntry()?.kind === "resource") &&
      !/\.(?:class|jar|zip|mrpack)$/.test(path) &&
      !path.endsWith("/original.jar") &&
      !path.includes("!/") &&
      !path.includes("#method=")
    )
  })

  createEffect(() => {
    if (props.view) setTab(props.view === "runs" ? "history" : props.view)
  })

  const reloadSelectedFile = async (id = props.id) => {
    const path = selectedPath()
    if (!path) return
    const before = draft()
    const dirty = file()?.encoding === "utf8" && before !== file()?.content
    const requestId = ++latestFileRead
    const result = await window.studio.readReverseFile({ id, path })
    if (id !== props.id || path !== selectedPath() || requestId !== latestFileRead) return
    setFile(result)
    if (!dirty && draft() === before) setDraft(result.encoding === "utf8" ? result.content : "")
  }
  const refresh = async (id = props.id, disposed: () => boolean = () => false) => {
    const requestId = ++latestStateRequest
    const previous = state()?.operations
    const result = await window.studio.getReverseState({ id })
    if (disposed() || id !== props.id || requestId !== latestStateRequest) return undefined
    setState(result)
    if (!selectedRunId() && result.runs[0]) setSelectedRunId(result.runs[0].id)
    if (selectedRunId() && !result.runs.some((run) => run.id === selectedRunId()))
      setSelectedRunId(result.runs[0]?.id ?? "")
    const operationFinished = result.operations.some(
      (operation) =>
        operation.state !== "running" && previous?.some((item) => item.id === operation.id && item.state === "running"),
    )
    if (result.project && (!files().length || operationFinished)) {
      await loadFiles(prefix(), id)
      await reloadSelectedFile(id)
    }
    return result
  }
  const loadFiles = async (searchPrefix = prefix(), id = props.id) => {
    const requestId = ++latestFilesRequest
    const result = await window.studio.listReverseFiles({
      id,
      ...(searchPrefix.trim() ? { prefix: searchPrefix.trim() } : {}),
    })
    if (id !== props.id || requestId !== latestFilesRequest) return
    setFiles(result)
    if (!result.some((entry) => entry.path === selectedPath())) {
      setSelectedPath("")
      setFile(undefined)
      setDraft("")
    }
  }
  const selectFile = async (entry: ReverseFile, id: string) => {
    if (selectedPath() !== entry.path) {
      setFile(undefined)
      setDraft("")
    }
    setSelectedPath(entry.path)
    const before = draft()
    const dirty = file()?.encoding === "utf8" && before !== file()?.content
    const requestId = ++latestFileRead
    const result = await window.studio.readReverseFile({ id, path: entry.path })
    if (id !== props.id || selectedPath() !== entry.path || requestId !== latestFileRead) return
    setFile(result)
    if (!dirty && draft() === before) setDraft(result.encoding === "utf8" ? result.content : "")
  }
  const runAction = async (operation: (id: string) => Promise<void>) => {
    const id = props.id
    if (busyProjectIds().includes(id)) return
    setBusyProjectIds((current) => [...current, id])
    if (id === props.id) {
      setError("")
      setNotice("")
      setExportWarnings([])
    }
    try {
      await operation(id)
    } catch (cause) {
      if (id === props.id) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyProjectIds((current) => current.filter((item) => item !== id))
    }
  }
  const prepare = () =>
    void runAction(async (id) => {
      const operation = await window.studio.prepareReverseProject({ id })
      if (id !== props.id) return
      setNotice(`${operationNames[operation.kind]}任务已启动。`)
      await refresh(id)
    })
  const cancelOperation = () =>
    void runAction(async (id) => {
      const operation = currentOperation()
      if (!operation) return
      await window.studio.cancelReverseOperation({ id, operationId: operation.id })
      if (id !== props.id) return
      await refresh(id)
      setNotice("逆向任务已取消。")
    })
  const build = (module: ReverseModule, addDependencies: boolean) =>
    void runAction(async (id) => {
      const operation = addDependencies
        ? await window.studio.chooseReverseDependencies({ id, moduleId: module.id })
        : await window.studio.buildReverseModule({ id, moduleId: module.id })
      if (!operation || id !== props.id) return
      setNotice(`已启动「${module.name || module.id}」模块编译。`)
      await refresh(id)
    })
  const saveFile = () =>
    void runAction(async (id) => {
      const selectedFile = file()
      if (!selectedFile || !editable()) return
      const change: ReverseChange = {
        path: selectedFile.path,
        operation: "write",
        expectedSha256: selectedFile.sha256,
        encoding: "utf8",
        content: draft(),
      }
      await window.studio.editReverseFiles({ id, changes: [change] })
      if (id !== props.id || selectedPath() !== selectedFile.path) return
      setNotice("文件修改已保存。")
      const requestId = ++latestFileRead
      const saved = await window.studio.readReverseFile({ id, path: selectedFile.path })
      if (id !== props.id || selectedPath() !== selectedFile.path || requestId !== latestFileRead) return
      setFile(saved)
      if (draft() === change.content) setDraft(saved.content)
    })
  const startModel = (request?: string) =>
    void runAction(async (id) => {
      const run = await window.studio.startReverseAnalysis({
        id,
        ...(request?.trim() ? { prompt: request.trim() } : {}),
      })
      if (id !== props.id) return
      setSelectedRunId(run.id)
      if (request) setPrompt("")
      setNotice("逆向分析任务已创建。")
      await refresh(id)
    })
  const cancelRun = () =>
    void runAction(async (id) => {
      const run = currentRun()
      if (!run) return
      await window.studio.cancelReverseOperation({ id, operationId: run.id })
      if (id === props.id) await refresh(id)
    })
  const applyRun = () =>
    void runAction(async (id) => {
      const run = currentRun()
      if (!run) return
      await window.studio.applyReversePlan({ id, runId: run.id })
      if (id !== props.id) return
      await refresh(id)
      await loadFiles(prefix(), id)
      await reloadSelectedFile(id)
      if (id !== props.id) return
      setNotice("修改方案已应用到逆向工程。")
    })
  const exportProject = (kind: "archive" | "project") =>
    void runAction(async (id) => {
      const result = await window.studio.exportReverseProject({ id, kind })
      if (!result || id !== props.id) return
      setNotice(`已导出：${result.path}`)
      setExportWarnings(result.warnings)
    })
  const copyValue = (label: string, value: string) =>
    void runAction(async (id) => {
      await navigator.clipboard.writeText(value)
      if (id !== props.id) return
      setNotice(`${label}已复制。`)
    })

  createEffect(() => {
    const id = props.id
    if (id === boundProjectId()) return
    setBoundProjectId(id)
    latestStateRequest++
    latestFilesRequest++
    latestFileRead++
    setState(undefined)
    setFiles([])
    setSelectedPath("")
    setFile(undefined)
    setDraft("")
    setSelectedRunId("")
    setExportWarnings([])
    setModuleSearch("")
    setModuleLimit(50)
    setTab("modules")
    setFileSearch("")
    setPrefix("")
    setError("")
    setNotice("")
    void refresh(id).catch((cause) => {
      if (id === props.id) setError(cause instanceof Error ? cause.message : String(cause))
    })
  })

  onMount(() => {
    let disposed = false
    let polling = false
    void refresh(props.id, () => disposed).catch((cause) => {
      if (!disposed && props.id === boundProjectId()) setError(cause instanceof Error ? cause.message : String(cause))
    })
    const timer = setInterval(() => {
      if (disposed || polling || (!currentOperation() && !state()?.runs.some(isActiveRun))) return
      polling = true
      const id = props.id
      void refresh(id, () => disposed)
        .catch((cause) => {
          if (!disposed && id === props.id) setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          polling = false
        })
    }, 1200)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
    })
  })

  const imageMime = createMemo(() => {
    if (file()?.encoding !== "base64" || file()?.truncated) return ""
    const path = selectedPath().toLowerCase()
    const bytes = atob(file()!.content.slice(0, 64))
    if (path.endsWith(".png") && bytes.startsWith("\x89PNG\r\n\x1a\n")) return "image/png"
    if ((path.endsWith(".jpg") || path.endsWith(".jpeg")) && bytes.startsWith("\xff\xd8\xff")) return "image/jpeg"
    if (path.endsWith(".webp") && bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP") return "image/webp"
    return ""
  })

  return (
    <section class="reverse-project" aria-label="通用逆向工程">
      <header class="reverse-toolbar">
        <div class="reverse-toolbar-title">
          <Icon name="cube" />
          <strong>{props.name}</strong>
          <Show when={currentOperation()}>
            <span class="reverse-status running">{operationNames[currentOperation()!.kind]}进行中</span>
          </Show>
        </div>
        <div class="reverse-actions">
          <Button primary disabled={busy() || Boolean(currentOperation())} onClick={prepare}>
            一键还原源码与资源
          </Button>
          <Show when={currentOperation()}>
            <Button disabled={busy()} onClick={cancelOperation}>
              取消任务
            </Button>
          </Show>
          <Button disabled={busy() || Boolean(currentOperation())} onClick={() => exportProject("archive")}>
            导出完整包
          </Button>
          <Button disabled={busy() || Boolean(currentOperation())} onClick={() => exportProject("project")}>
            导出逆向工程 .modreverse
          </Button>
        </div>
      </header>
      <p class="reverse-license">原包和导出内容可能包含第三方代码与素材，公开分发前请核对许可并取得必要授权。</p>
      <Show when={error()}>
        <p class="resource-message error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={notice()}>
        <p class="resource-message" role="status">
          {notice()}
        </p>
      </Show>
      <Show when={exportWarnings().length}>
        <ul class="reverse-export-warning-list" aria-label="导出告警">
          <For each={exportWarnings()}>{(warning) => <li>{warning}</li>}</For>
        </ul>
      </Show>
      <nav class="reverse-tabs" aria-label="逆向工程工作区">
        <button class={tab() === "modules" ? "active" : ""} onClick={() => setTab("modules")}>
          模块 <span>{modules().length}</span>
        </button>
        <button class={tab() === "files" ? "active" : ""} onClick={() => setTab("files")}>
          文件 <span>{files().length}</span>
        </button>
        <button class={tab() === "ai" ? "active" : ""} onClick={() => setTab("ai")}>
          AI修改 <span>{state()?.runs.length ?? 0}</span>
        </button>
        <button class={tab() === "history" ? "active" : ""} onClick={() => setTab("history")}>
          任务记录 <span>{state()?.operations.length ?? 0}</span>
        </button>
      </nav>
      <Show
        when={state()?.project}
        fallback={
          <div class="reverse-empty">
            <p>先启动「一键还原源码与资源」，完成后会在这里列出模块和文件。</p>
          </div>
        }
      >
        <div class="reverse-workbench-content">
          <Show when={tab() === "modules"}>
            <div class="reverse-panel-head">
              <div>
                <strong>模块</strong>
                <small>
                  {modules().length} 个模块 · 原包 {state()?.project?.source.filename}
                </small>
              </div>
              <input
                aria-label="查找模块"
                value={moduleSearch()}
                onInput={(event) => {
                  setModuleSearch(event.currentTarget.value)
                  setModuleLimit(50)
                }}
                placeholder="搜索模块"
              />
            </div>
            <Show when={state()?.project?.warnings.length}>
              <Fold class="reverse-inline-details" summary={<>工程告警 · {state()?.project?.warnings.length} 项</>}>
                <ul>
                  <For each={state()?.project?.warnings.slice(0, 100) ?? []}>{(warning) => <li>{warning}</li>}</For>
                </ul>
              </Fold>
            </Show>
            <div class="reverse-module-grid">
              <For each={filteredModules().slice(0, moduleLimit())}>
                {(module) => (
                  <ModuleCard module={module} disabled={busy() || Boolean(currentOperation())} onBuild={build} />
                )}
              </For>
            </div>
            <Show when={moduleLimit() < filteredModules().length}>
              <Button class="reverse-more" onClick={() => setModuleLimit(moduleLimit() + 50)}>
                继续显示模块
              </Button>
            </Show>
          </Show>
          <Show when={tab() === "files"}>
            <div class="reverse-panel-head">
              <div>
                <strong>源码与资源文件</strong>
                <small>最多列出 10,000 条；可用路径前缀分段查看。</small>
              </div>
              <div class="reverse-file-controls">
                <input
                  aria-label="筛选文件"
                  value={fileSearch()}
                  onInput={(event) => setFileSearch(event.currentTarget.value)}
                  placeholder="筛选当前列表"
                />
                <input
                  aria-label="文件路径前缀"
                  value={prefix()}
                  onInput={(event) => setPrefix(event.currentTarget.value)}
                  placeholder="模块名或目录前缀"
                />
                <Button disabled={busy()} onClick={() => void runAction((id) => loadFiles(prefix(), id))}>
                  浏览路径
                </Button>
              </div>
            </div>
            <div class="reverse-browser">
              <div class="reverse-file-list">
                <Show when={filteredFiles().length} fallback={<p class="muted">目录暂无文件或筛选无匹配项。</p>}>
                  <For each={filteredFiles().slice(0, fileLimit())}>
                    {(entry) => (
                      <button
                        class={entry.path === selectedPath() ? "selected" : ""}
                        onClick={() => void runAction((id) => selectFile(entry, id))}
                      >
                        <Icon name={entry.kind === "source" ? "logic" : "document"} />
                        <span class="reverse-file-name" title={entry.path}>
                          {entry.path.split("/").at(-1)}
                        </span>
                        <small title={entry.path}>{entry.path.split("/").slice(0, -1).join("/")}</small>
                      </button>
                    )}
                  </For>
                  <Show when={filteredFiles().length > fileLimit()}>
                    <Button onClick={() => setFileLimit(fileLimit() + 150)}>
                      显示更多文件（{filteredFiles().length - fileLimit()}）
                    </Button>
                  </Show>
                </Show>
              </div>
              <div class="reverse-editor">
                <Show when={file()} fallback={<p class="muted">选文件以查看内容。</p>}>
                  {(currentFile) => (
                    <>
                      <div class="reverse-file-meta">
                        <strong title={currentFile().path}>{currentFile().path}</strong>
                        <small>SHA-256：{currentFile().sha256}</small>
                        <Show when={currentFile().truncated}>
                          <small class="resource-warning">文件过大，内容不完整，不能保存。</small>
                        </Show>
                      </div>
                      <Show when={imageMime()}>
                        {(mime) => (
                          <div class="reverse-image-preview">
                            <img src={`data:${mime()};base64,${currentFile().content}`} alt={currentFile().path} />
                          </div>
                        )}
                      </Show>
                      <Show when={!imageMime()}>
                        <Show
                          when={editable()}
                          fallback={
                            <pre class="reverse-preview">
                              {currentFile().encoding === "base64"
                                ? `二进制文件（${currentFile().content.length.toLocaleString()} 个 base64 字符），不提供文本编辑。`
                                : currentFile().content}
                            </pre>
                          }
                        >
                          <textarea
                            aria-label="文件内容"
                            value={draft()}
                            onInput={(event) => setDraft(event.currentTarget.value)}
                            spellcheck={false}
                          />
                          <Button primary disabled={busy() || draft() === currentFile().content} onClick={saveFile}>
                            保存文本修改
                          </Button>
                        </Show>
                      </Show>
                    </>
                  )}
                </Show>
              </div>
            </div>
            <p class="reverse-license">原始包、清单、日志、打包出的文件和二进制文件保持只读。</p>
          </Show>
          <Show when={tab() === "ai"}>
            <div class="reverse-ai-compose">
              <div class="reverse-panel-head">
                <div>
                  <strong>AI 分析与修改</strong>
                  <small>依据模块、文件证据与真实编译诊断生成结构化方案。</small>
                </div>
                <Button primary disabled={busy()} onClick={() => startModel()}>
                  分析逆向工程
                </Button>
              </div>
              <label class="field">
                <span>修改需求</span>
                <textarea
                  rows={3}
                  maxLength={20000}
                  value={prompt()}
                  onInput={(event) => setPrompt(event.currentTarget.value)}
                  placeholder="描述希望调整的功能、行为或资源。"
                />
              </label>
              <div class="reverse-actions">
                <small>{prompt().length} / 20000</small>
                <Button disabled={busy() || !prompt().trim()} onClick={() => startModel(prompt())}>
                  生成源码/资源修改方案
                </Button>
              </div>
            </div>
            <div class="reverse-history">
              <For each={state()?.runs ?? []}>
                {(run) => (
                  <button class={run.id === selectedRunId() ? "selected" : ""} onClick={() => setSelectedRunId(run.id)}>
                    <span>{runStateNames[run.state]}</span>
                    <small>{new Date(run.createdAt).toLocaleString("zh-CN")}</small>
                  </button>
                )}
              </For>
            </div>
            <Show when={currentRun()}>
              {(run) => (
                <article class="reverse-run-card">
                  <div class="reverse-run-head">
                    <strong>{runStateNames[run().state]}</strong>
                    <small>{new Date(run().createdAt).toLocaleString("zh-CN")}</small>
                    <Show when={isActiveRun(run())}>
                      <Button disabled={busy()} onClick={cancelRun}>
                        取消分析
                      </Button>
                    </Show>
                  </div>
                  <Show when={run().state === "awaiting_model"}>
                    <Fold class="reverse-inline-details" summary="正在等你的 AI · 查看连接信息">
                      <p>
                        调用 <code>get_reverse_task</code> 读取工程上下文，再用 <code>submit_reverse_task</code>{" "}
                        提交。传 <code>prefix</code> 切换目录索引，传 <code>paths</code> 补读指定文件。
                      </p>
                      <p>
                        工程 ID：<code>{props.id}</code>{" "}
                        <Button onClick={() => copyValue("工程 ID", props.id)}>复制工程 ID</Button>
                      </p>
                      <p>
                        任务 ID：<code>{run().id}</code>{" "}
                        <Button onClick={() => copyValue("任务 ID", run().id)}>复制任务 ID</Button>
                      </p>
                    </Fold>
                  </Show>
                  <Show when={run().error}>
                    <p class="resource-message error">{run().error}</p>
                  </Show>
                  <Show when={run().result}>
                    {(result) => (
                      <>
                        <div class="reverse-summary-card">
                          <small>摘要</small>
                          <p>{result().summary}</p>
                        </div>
                        <Show when={result().findings.length}>
                          <section class="reverse-result-group">
                            <h4>分析发现 · {result().findings.length}</h4>
                            <div class="reverse-result-grid">
                              <For each={result().findings}>
                                {(finding) => (
                                  <article>
                                    <p>{finding.text}</p>
                                    <small>证据：{finding.evidencePaths.join("、") || "未引用文件"}</small>
                                  </article>
                                )}
                              </For>
                            </div>
                          </section>
                        </Show>
                        <Show when={result().neededPaths.length}>
                          <Fold class="reverse-inline-details" summary={<>待补读路径 · {result().neededPaths.length}</>}>
                            <For each={result().neededPaths}>{(path) => <p class="resource-path">{path}</p>}</For>
                          </Fold>
                        </Show>
                        <Fold class="reverse-inline-details" summary={<>修改方案 · {result().changes.length} 项</>}>
                          <For each={result().changes}>
                            {(change) => (
                              <article class="reverse-change-card">
                                <strong>
                                  <code>{change.path}</code>
                                </strong>
                                <small>
                                  {change.operation === "write" ? "写入或替换" : "删除"} ·{" "}
                                  {change.expectedSha256 ?? "新建文件"}
                                </small>
                                <Show when={change.content !== null}>
                                  <pre>{change.content}</pre>
                                </Show>
                              </article>
                            )}
                          </For>
                        </Fold>
                        <Show when={result().limitations.length}>
                          <Fold class="reverse-inline-details" summary={<>限制与未确认项 · {result().limitations.length}</>}>
                            <For each={result().limitations}>{(item) => <p>{item}</p>}</For>
                          </Fold>
                        </Show>
                        <Fold class="reverse-inline-details" summary="验证计划（尚未执行）">
                          <For each={result().validationPlan}>{(item) => <p>{item}</p>}</For>
                        </Fold>
                        <Show when={run().state === "review"}>
                          <Button primary disabled={busy() || !result().changes.length} onClick={applyRun}>
                            看过以后应用修改
                          </Button>
                        </Show>
                        <Show when={run().state === "applied"}>
                          <p class="muted">修改方案已应用。</p>
                        </Show>
                      </>
                    )}
                  </Show>
                </article>
              )}
            </Show>
            <Show when={!state()?.runs.length}>
              <p class="muted">尚无逆向分析记录。</p>
            </Show>
          </Show>
          <Show when={tab() === "history"}>
            <div class="reverse-panel-head">
              <div>
                <strong>还原与编译任务</strong>
                <small>最近的真实任务结果与诊断</small>
              </div>
            </div>
            <div class="reverse-operation-list">
              <For each={state()?.operations ?? []}>
                {(operation) => (
                  <article class={`reverse-operation ${operation.state}`}>
                    <div>
                      <strong>
                        {operationNames[operation.kind]} · {operationStateNames[operation.state]}
                      </strong>
                      <small>{new Date(operation.startedAt).toLocaleString("zh-CN")}</small>
                    </div>
                    <p>{operation.detail}</p>
                    <Show when={operation.error}>
                      <Fold summary="错误详情">
                        <pre>{operation.error}</pre>
                      </Fold>
                    </Show>
                  </article>
                )}
              </For>
            </div>
            <Show when={!state()?.operations.length}>
              <p class="muted">暂无任务记录。</p>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  )
}
