import { createEffect, createSignal, For, Show } from "solid-js"
import type { ImportedProject } from "../../library"
import { Button, Icon } from "../ui"
import { advanced } from "../advanced"
import { ImportBackpack } from "./import-backpack"
import { ImportAnalysisPanel } from "./import-analysis-panel"
import { ReverseProjectPanel } from "./reverse-project-panel"
import { ImportAssetsWorkbench } from "./import-assets-workbench"
import { Fold } from "../fold"

type TabId = "backpack" | "gameplay" | "files" | "edit" | "info"
const tabs: { id: TabId; name: string; icon: "cube" | "logic" | "folder" | "tool" | "document"; advanced?: boolean }[] =
  [
    { id: "backpack", name: "背包", icon: "cube" },
    { id: "gameplay", name: "玩法", icon: "logic" },
    { id: "files", name: "文件", icon: "folder", advanced: true },
    { id: "edit", name: "改包", icon: "tool", advanced: true },
    { id: "info", name: "工程信息", icon: "document", advanced: true },
  ]

/**
 * One imported mod or modpack. Players see two things: what is inside (背包) and how it plays (玩法).
 * Raw files, repacking and scan details stay behind the 高级 switch.
 */
export function ImportProjectWorkspace(props: {
  project: ImportedProject
  busy: boolean
  onExport: () => void
  onClear: () => void
  onDelete: () => void
}) {
  const [tab, setTab] = createSignal<TabId>("backpack")
  const [fileAssetId, setFileAssetId] = createSignal<string>()
  const [gameplay, setGameplay] = createSignal<"working" | "ready" | "attention">()
  const report = () => props.project.report
  /** A single mod is shown under its own name instead of its file name. */
  const title = () =>
    (report().mods.length === 1 ? report().mods[0]!.name?.trim() : undefined) || props.project.manifest.name
  /** "[1.20.1,)" is a version range from the mod's metadata; players only need the number. */
  const versions = () =>
    [...new Set(report().metadata.minecraft_versions.map((value) => value.replace(/[[\]()\s]/g, "").split(",")[0]!))]
      .filter(Boolean)
      .join(" / ")
  // 高级 is switched in the title bar: a tab that only it shows cannot stay open once it is off.
  createEffect(() => {
    if (!advanced() && tabs.find((item) => item.id === tab())?.advanced) setTab("backpack")
  })
  return (
    <section class="import-project-workspace" aria-label="当前模组">
      <header class="workbench-project-heading">
        <span class="workbench-project-icon mc-slot">
          <Icon name="cube" />
        </span>
        <div>
          <h2 title={props.project.manifest.name}>{title()}</h2>
          <div class="workbench-project-tags">
            <Show when={versions()}>
              <span>Minecraft {versions()}</span>
            </Show>
            <Show when={report().metadata.loaders.length}>
              <span class="workbench-project-loader">{report().metadata.loaders.join(" / ")}</span>
            </Show>
            <Show when={report().mods.length > 1}>
              <span>{report().mods.length} 个模组</span>
            </Show>
          </div>
        </div>
        <div class="workbench-project-actions">
          <Button disabled={props.busy} onClick={props.onDelete}>
            移除
          </Button>
        </div>
      </header>
      <div class="workbench-project-tabs" role="tablist" aria-label="模组里的东西">
        <For each={tabs.filter((item) => !item.advanced || advanced())}>
          {(item) => (
            <button
              role="tab"
              id={`workbench-tab-${item.id}`}
              aria-controls={`workbench-pane-${item.id}`}
              aria-selected={tab() === item.id}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} />
              {item.name}
              <Show when={item.id === "gameplay" && gameplay()}>
                <i class={`workbench-tab-mark ${gameplay()}`} aria-hidden="true" />
              </Show>
            </button>
          )}
        </For>
      </div>
      <div
        class="workbench-pane workbench-backpack-pane"
        role="tabpanel"
        id="workbench-pane-backpack"
        aria-labelledby="workbench-tab-backpack"
        hidden={tab() !== "backpack"}
      >
        <ImportBackpack
          project={props.project}
          active={tab() === "backpack"}
          advanced={advanced()}
          onOpenFile={(assetId) => {
            setFileAssetId(assetId)
            setTab("files")
          }}
        />
      </div>
      <div
        class="workbench-pane"
        role="tabpanel"
        id="workbench-pane-gameplay"
        aria-labelledby="workbench-tab-gameplay"
        hidden={tab() !== "gameplay"}
      >
        <ImportAnalysisPanel
          id={props.project.manifest.id}
          name={props.project.manifest.name}
          advanced={advanced()}
          onState={setGameplay}
        />
      </div>
      <Show when={advanced()}>
        <div
          class="workbench-pane workbench-assets-pane"
          role="tabpanel"
          id="workbench-pane-files"
          aria-labelledby="workbench-tab-files"
          hidden={tab() !== "files"}
        >
          <ImportAssetsWorkbench id={props.project.manifest.id} active={tab() === "files"} openAssetId={fileAssetId()} />
        </div>
        <div
          class="workbench-pane"
          role="tabpanel"
          id="workbench-pane-edit"
          aria-labelledby="workbench-tab-edit"
          hidden={tab() !== "edit"}
        >
          <ReverseProjectPanel id={props.project.manifest.id} name={props.project.manifest.name} />
        </div>
        <div
          class="workbench-pane"
          role="tabpanel"
          id="workbench-pane-info"
          aria-labelledby="workbench-tab-info"
          hidden={tab() !== "info"}
        >
          <div class="workbench-info-grid">
            <section class="workbench-card">
              <header>
                <Icon name="document" />
                <h3>来源与存储</h3>
              </header>
              <dl>
                <dt>原始文件</dt>
                <dd>{props.project.manifest.source.filename}</dd>
                <dt>工程目录</dt>
                <dd class="resource-path">{props.project.directory}</dd>
                <dt>工程 ID</dt>
                <dd>{props.project.manifest.id}</dd>
                <dt>SHA-256</dt>
                <dd class="resource-path">{report().source.sha256}</dd>
              </dl>
              <Button disabled={props.busy} onClick={props.onExport}>
                导出扫描报告
              </Button>
              <small class="muted">报告包含结构化清单，不含原始包或第三方素材。</small>
            </section>
            <section class="workbench-card">
              <header>
                <Icon name="search" />
                <h3>扫描范围</h3>
              </header>
              <div class="workbench-info-metrics">
                <span>
                  <strong>{report().scan.archive_entries.toLocaleString()}</strong>目录项
                </span>
                <span>
                  <strong>{report().mods.length}</strong>已识别模组
                </span>
                <span>
                  <strong>{report().metadata.dependency_files.length}</strong>外部引用
                </span>
              </div>
              <p>{report().scan.status === "partial" ? "部分扫描" : "扫描完成"}</p>
              <For each={report().scan.scope}>{(scope) => <p>{scope}</p>}</For>
              <Show when={report().scan.warnings.length}>
                <Fold summary={<>扫描提示 · {report().scan.warnings.length}</>}>
                  <For each={report().scan.warnings}>{(warning) => <p class="resource-warning">{warning}</p>}</For>
                </Fold>
              </Show>
            </section>
            <section class="workbench-card">
              <header>
                <Icon name="settings" />
                <h3>工程维护</h3>
              </header>
              <p class="muted">临时资料、原始包副本和分析结果都归属当前工程。</p>
              <div class="workbench-info-actions">
                <Button disabled={props.busy} onClick={props.onClear}>
                  清理临时资料
                </Button>
              </div>
            </section>
            <section class="workbench-card">
              <header>
                <Icon name="link" />
                <h3>外部依赖</h3>
              </header>
              <p class="muted">清单引用不代表文件已下载，打包前要先检查依赖。</p>
              <Fold summary={<>查看引用 · {report().metadata.dependency_files.length}</>}>
                <pre>{report().metadata.dependency_files.join("\n") || "没有外部文件引用"}</pre>
              </Fold>
            </section>
          </div>
        </div>
      </Show>
    </section>
  )
}
