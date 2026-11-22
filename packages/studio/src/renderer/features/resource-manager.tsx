import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { EnvironmentStorage, ImportedProject, ImportedProjectList, LibraryTask } from "../../library"
import { Button, Icon } from "../ui"
import { ImportProjectWorkspace } from "./import-project-workspace"
import { JavaCard } from "./java-card"
import { ToolsPanel } from "./tools-panel"
import { loadTargets } from "./target-card"
import type { Project } from "@minemods/mod-core/project"
import { javaMajors } from "../../project-status"
import { defaultTarget } from "./project-setup-model"
import "./resource-manager.css"
import "./resource-workbench.css"
import { Fold } from "../fold"
import { buildableLine, cleanupNotice, neededLine, size, sourceName } from "./resource-manager-model"

const active = (task: LibraryTask) => task.state === "running" || task.state === "canceling"
const environmentNames: Record<string, string> = {
  jdk: "Java 开发环境",
  "gradle-cache": "Gradle 与打包要用的文件",
  "temporary-download": "未完成的下载",
  "external-jdk": "本机外部 Java",
  "reverse-tools": "反编译工具与下载缓存",
}
const statusNames: Record<string, string> = {
  unsafe: "路径需要检查",
  incomplete: "下载未完成",
  present: "已存储",
  configured: "由本机管理",
  unavailable: "路径不可用",
}
type StorageItem = EnvironmentStorage["items"][number]
// What the asset catalogue lists carries its own name; the folders Studio scans are named by their kind.
const itemName = (item: StorageItem) => (item.type === "store" ? item.title : (environmentNames[item.type] ?? item.type))
const neededBy = (item: StorageItem) => (item.type === "store" ? item.neededBy : [])

export const RESOURCE_LABELS = { imports: "模组图鉴", storage: "存储空间", tools: "工具" } as const
export type ResourceTab = keyof typeof RESOURCE_LABELS

export function ResourceManager(props: {
  targetProjects?: readonly Pick<Project, "target" | "targets">[]
  initialTab: ResourceTab
  backLabel?: string
  onBack: () => void
  onTab: (tab: ResourceTab) => void
}) {
  const tab = () => props.initialTab
  const [storage, setStorage] = createSignal<EnvironmentStorage>()
  const [projects, setProjects] = createSignal<ImportedProjectList>([])
  const [issues, setIssues] = createSignal<Awaited<ReturnType<typeof window.studio.listImportedProjectIssues>>>([])
  const [selected, setSelected] = createSignal<ImportedProject | null>(null)
  const [tasks, setTasks] = createSignal<LibraryTask[]>([])
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [filter, setFilter] = createSignal("")
  const [catalogue, setCatalogue] = createSignal<Awaited<ReturnType<typeof loadTargets>>>()
  const majors = createMemo(() => {
    const value = catalogue()
    return value ? javaMajors(props.targetProjects ?? [], value.targets, defaultTarget(value.targets, value.chosen)) : []
  })
  // 「现在能打包的」, from the same catalogue; unsaid until it is read.
  const [buildable, setBuildable] = createSignal<string | null>(null)
  let selectionRequest = 0
  let importSelection = 0
  let disposed = false
  onCleanup(() => {
    disposed = true
    selectionRequest++
  })
  const running = createMemo(() => tasks().some(active))
  const managedBytes = createMemo(
    () =>
      storage()
        ?.items.filter((item) => item.type !== "external-jdk")
        .reduce((sum, item) => sum + item.bytes, 0) ?? 0,
  )
  const errorText = (cause: unknown) =>
    cause instanceof Error
      ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
      : String(cause)
  const reload = async () => {
    const results = await Promise.allSettled([
      window.studio.listEnvironmentStorage(),
      window.studio.listImportedProjects(),
      window.studio.listImportedProjectIssues(),
    ])
    if (results[0].status === "fulfilled") setStorage(results[0].value)
    if (results[1].status === "fulfilled") setProjects(results[1].value)
    if (results[2].status === "fulfilled") setIssues(results[2].value)
    results.forEach((result) => {
      if (result.status === "rejected") setError(errorText(result.reason))
    })
  }
  const perform = async (operation: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    setError("")
    setNotice("")
    await operation()
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false))
  }
  const addTask = (task: LibraryTask | null) => {
    if (task) setTasks((values) => [task, ...values.filter((value) => value.id !== task.id)])
  }
  const open = async (id: string) => {
    const request = ++selectionRequest
    const project = await window.studio.getImportedProject({ id })
    if (!disposed && request === selectionRequest) setSelected(project)
  }
  const importSource = () =>
    void perform(async () => {
      const task = await window.studio.chooseImportSource()
      if (task) importSelection = selectionRequest
      addTask(task)
    })
  const refresh = () => void perform(reload)
  onMount(() => {
    let polling = false
    void reload()
    void loadTargets().then(
      (value) => {
        if (disposed) return
        setCatalogue(value)
        setBuildable(buildableLine(value.targets))
      },
      () => undefined,
    )
    void window.studio
      .listLibraryTasks()
      .then((values) => {
        if (!disposed) setTasks(values)
      })
      .catch((cause) => setError(errorText(cause)))
    const timer = setInterval(() => {
      if (disposed || polling || !tasks().some(active)) return
      polling = true
      void Promise.all(
        tasks()
          .filter(active)
          .map((task) => window.studio.getLibraryTask({ id: task.id })),
      )
        .then(async (values) => {
          if (disposed) return
          setTasks((previous) => previous.map((task) => values.find((value) => value.id === task.id) ?? task))
          const finished = values.filter((task) => !active(task))
          if (finished.length) await reload()
          const imported = finished.find((task) => task.state === "completed" && task.resultId)
          if (imported?.resultId && !disposed && importSelection === selectionRequest) await open(imported.resultId)
        })
        .catch((cause) => {
          if (!disposed) setError(errorText(cause))
        })
        .finally(() => {
          polling = false
        })
    }, 800)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
    })
  })

  return (
    <div class="page resource-manager resource-workbench">
      <header class="workbench-toolbar">
        <div class="workbench-toolbar-title">
          <Icon name={tab() === "imports" ? "cube" : "tool"} />
          <h1>{RESOURCE_LABELS[tab()]}</h1>
        </div>
        <div class="page-actions">
          <Button disabled={busy()} onClick={refresh}>
            <Icon name="undo" />
            刷新
          </Button>
          {/* The title screen keeps two ways in: this is where the space Studio takes up is looked at from now. */}
          <For each={(Object.keys(RESOURCE_LABELS) as ResourceTab[]).filter((key) => key !== tab())}>
            {(key) => <Button onClick={() => props.onTab(key)}>{RESOURCE_LABELS[key]}</Button>}
          </For>
          <Button onClick={props.onBack}>{props.backLabel ?? "回工程库"}</Button>
          <Show when={tab() === "storage"}>
            <Button
              disabled={busy() || running()}
              onClick={() =>
                void perform(async () => {
                  const result = await window.studio.cleanUnusedEnvironment()
                  await reload()
                  setNotice(cleanupNotice(result))
                })
              }
            >
              清理没用的
            </Button>
          </Show>
          <Show when={tab() === "imports"}>
            <Button primary disabled={busy() || running()} onClick={importSource}>
              <Icon name="plus" />
              打开模组文件
            </Button>
          </Show>
        </div>
      </header>
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
      <Show when={tasks().some((task) => active(task) || task.state === "failed")}>
        <section class="resource-jobs workbench-jobs" aria-label="正在进行的">
          <For
            each={tasks()
              .filter((task) => active(task) || task.state === "failed")
              .slice(0, 3)}
          >
            {(task) => (
              <div class={`resource-job ${task.state}`}>
                <Icon name="clock" />
                <strong>{task.kind === "scan-import" ? "正在打开模组" : "准备环境"}</strong>
                <p role="status">{task.error ?? task.detail}</p>
                <Show when={task.state === "running"}>
                  <Button
                    onClick={() =>
                      void perform(async () => addTask(await window.studio.cancelLibraryTask({ id: task.id })))
                    }
                  >
                    取消
                  </Button>
                </Show>
                <Show when={task.state === "failed"}>
                  <button
                    aria-label="收起没做成的这一条"
                    onClick={() => setTasks(tasks().filter((item) => item.id !== task.id))}
                  >
                    <Icon name="close" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </section>
      </Show>
      <Show when={tab() === "tools"}><ToolsPanel /></Show>
      <div class="workbench-storage" hidden={tab() !== "storage"}>
        {" "}
        <Show when={tab() === "storage"}>
          <section class="panel resource-summary">
            <div>
              <h2>托管环境占用 {size(managedBytes())}</h2>
              <p>新建与浏览工程无需下载开发环境。打包时会按需准备缺少的组件。</p>
              <Show when={buildable()}>
                <p class="muted">{buildable()}</p>
              </Show>
            </div>
          </section>
          <For each={majors()}>{(major) => <JavaCard major={major} onInstalled={() => void reload()} />}</For>
          <div class="resource-items">
            <For each={storage()?.items}>
              {(item) => (
                <section class="panel resource-item">
                  <header>
                    <h3>{itemName(item)}</h3>
                    <span>
                      {size(item.bytes)} · {item.inUse ? "使用中" : statusNames[item.status]}
                    </span>
                  </header>
                  <p class="resource-path">{item.path}</p>
                  <Show when={item.type === "store" ? item : null}>
                    {(stored) => (
                      <p class="muted">
                        来源：{sourceName(stored().source)}
                        <Show when={neededLine(stored().neededBy)}>{(line) => ` · ${line()}`}</Show>
                      </p>
                    )}
                  </Show>
                  <Show when={item.version}>
                    <p>环境版本：{item.version}</p>
                  </Show>
                  <Show when={!item.version && item.type === "jdk"}>
                    <p class="muted">版本记录未知{item.targetVersion ? `，目标版本为 Java ${item.targetVersion}` : ""}，使用时会检查。</p>
                  </Show>
                  <Show when={item.type === "gradle-cache"}>
                    <p class="muted">目标 Gradle 版本：{item.targetVersion}；目录中可能含多个版本的依赖。</p>
                  </Show>
                  <p class="muted">
                    最近使用：{item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString("zh-CN") : "暂无记录"}
                  </p>
                  <Show when={item.sourceUrl}>
                    <Fold summary="下载来源">
                      <p class="resource-path">{item.sourceUrl}</p>
                    </Fold>
                  </Show>
                  <p class="muted">
                    {item.type === "external-jdk"
                      ? "此安装由系统或其他工具管理。"
                      : item.referencedBy.length
                        ? `关联 ${item.referencedBy.length} 个工程。清理后，下次打包要重新准备。`
                        : neededBy(item).length
                          ? "清理后，下次用到时会重新下载。"
                          : "暂无关联工程，可按需清理。"}
                  </p>
                  <Show when={item.referencedBy.length}>
                    <p class="muted">
                      {item.referencedBy
                        .map((reference) =>
                          typeof reference === "string" ? reference : (reference.projectName ?? reference.projectId),
                        )
                        .join("、")}
                    </p>
                  </Show>
                  <div class="page-actions">
                    <Button
                      disabled={busy() || !item.canDelete}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `清理「${itemName(item)}」的 ${size(item.bytes)}？${item.referencedBy.length ? `关联的 ${item.referencedBy.length} 个工程在下次打包时需要重新准备环境。` : neededBy(item).length ? `${neededLine(neededBy(item))}，下次用到时会重新下载。` : "以后使用时可重新下载。"}`,
                          )
                        )
                          return
                        void perform(async () => {
                          const result = await window.studio.removeEnvironment({ id: item.id, confirmReferenced: true })
                          setNotice(result.deleted ? "已清理托管环境。" : "这一项已经清理过了。")
                          await reload()
                        })
                      }}
                    >
                      清理这一项
                    </Button>
                  </div>
                </section>
              )}
            </For>
            <Show when={storage() && !storage()!.items.length}>
              <div class="panel resource-summary">
                <p>尚未下载托管环境。可以先创建或导入工程，要打包时再准备。</p>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <div class="workbench-layout" hidden={tab() !== "imports"}>
        <aside class="workbench-library" aria-label="我的模组">
          <header>
            <h2>我的模组</h2>
            <span>{projects().length}</span>
          </header>
          <label class="workbench-library-search">
            <Icon name="search" />
            <input
              aria-label="找模组"
              placeholder="找模组"
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
            />
          </label>
          <div class="workbench-project-list">
            <Show when={!projects().length}>
              <p class="muted">还没有打开过模组。</p>
            </Show>
            <For each={issues()}>
              {(issue) => (
                <div class="resource-warning">
                  <p>
                    {issue.name}：{issue.message}
                  </p>
                  <Button
                    disabled={busy()}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `移除打不开的「${issue.name}」？你电脑上原来的文件不会被动。`,
                        )
                      )
                        return
                      void perform(async () => {
                        await window.studio.deleteImportedProject({ id: issue.id })
                        if (selected()?.manifest.id === issue.id) setSelected(null)
                        await reload()
                      })
                    }}
                  >
                    移除
                  </Button>
                </div>
              )}
            </For>

            <For
              each={projects().filter((project) =>
                project.manifest.name.toLowerCase().includes(filter().toLowerCase()),
              )}
            >
              {(project) => (
                <button
                  class={selected()?.manifest.id === project.manifest.id ? "selected" : ""}
                  aria-pressed={selected()?.manifest.id === project.manifest.id}
                  disabled={busy()}
                  onClick={() => void perform(() => open(project.manifest.id))}
                >
                  <span class="workbench-library-icon">
                    <Icon name={project.manifest.source.filename.endsWith(".jar") ? "cube" : "folder"} />
                  </span>
                  <strong title={project.manifest.name}>{project.manifest.name}</strong>
                  <small>{size(project.manifest.source.bytes)}</small>
                </button>
              )}
            </For>
            <Show
              when={
                projects().length > 0 &&
                !projects().some((project) => project.manifest.name.toLowerCase().includes(filter().toLowerCase()))
              }
            >
              <p class="muted">没有叫这个名字的模组。</p>
            </Show>
          </div>
        </aside>
        <Show
          when={selected()?.manifest.id}
          keyed
          fallback={
            <section class="workbench-welcome">
              <Icon name="cube" />
              <h2>打开一个模组，看看里面有什么</h2>
              <p>生物 · 方块 · 物品 · 玩法，像翻背包一样一格一格看</p>
              <Button primary disabled={busy() || running()} onClick={importSource}>
                <Icon name="plus" />
                选择模组或整合包
              </Button>
              <small>支持 .jar、.zip、.mrpack</small>
            </section>
          }
        >
          {(_id) => (
            <ImportProjectWorkspace
              project={selected()!}
              busy={busy()}
              onExport={() =>
                void perform(async () => {
                  const result = await window.studio.exportImportedReport({ id: selected()!.manifest.id })
                  if (result) setNotice(`报告已导出：${result.path}`)
                })
              }
              onClear={() =>
                void perform(async () => {
                  await window.studio.clearImportedCache({ id: selected()!.manifest.id })
                  setNotice("已清理临时资料。")
                })
              }
              onDelete={() => {
                const project = selected()!
                if (
                  !window.confirm(
                    `把「${project.manifest.name}」从图鉴里移除？你电脑上原来的文件不会被动。`,
                  )
                )
                  return
                void perform(async () => {
                  await window.studio.deleteImportedProject({ id: project.manifest.id })
                  setSelected(null)
                  await reload()
                  setNotice("已移除。")
                })
              }}
            />
          )}
        </Show>
      </div>
    </div>
  )
}
