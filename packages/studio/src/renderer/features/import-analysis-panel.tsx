import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { ImportAnalysisRun } from "../../main/import-analysis-service"
import { Button, Icon } from "../ui"
import "./import-analysis-workbench.css"
import { Fold } from "../fold"

const stateNames: Record<ImportAnalysisRun["state"], string> = {
  awaiting_model: "等外部 AI 接手",
  running: "AI 正在读",
  review: "等你确认",
  applied: "已改好",
  failed: "没成功",
  canceled: "已取消",
}
const stateName = (run: ImportAnalysisRun) =>
  run.kind === "analyze" && run.state === "review" ? "已读完" : stateNames[run.state]

const isActive = (run: ImportAnalysisRun) => run.state === "awaiting_model" || run.state === "running"

/**
 * How the imported mod plays, written by the AI. The first analysis starts by itself when a mod
 * has none yet, so players never have to ask for it.
 */
export function ImportAnalysisPanel(props: {
  id: string
  name: string
  /** Show file-level evidence, hashes and extension points. */
  advanced: boolean
  onState?: (state: "working" | "ready" | "attention" | undefined) => void
}) {
  const [runs, setRuns] = createSignal<ImportAnalysisRun[]>([])
  const [selectedRunId, setSelectedRunId] = createSignal<string>()
  const [prompt, setPrompt] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const current = createMemo(() => runs().find((run) => run.id === selectedRunId()))
  createEffect(() => {
    const latest = runs()[0]
    props.onState?.(
      !latest
        ? undefined
        : isActive(latest)
          ? "working"
          : latest.state === "failed" || (latest.kind !== "analyze" && latest.state === "review")
            ? "attention"
            : "ready",
    )
  })
  const refresh = async (disposed: () => boolean = () => false) => {
    const result = await window.studio.listImportAnalysisRuns({ id: props.id })
    if (disposed()) return
    setRuns(result)
    if (!selectedRunId() && result[0]) setSelectedRunId(result[0].id)
    if (selectedRunId() && !result.some((run) => run.id === selectedRunId())) setSelectedRunId(result[0]?.id)
  }
  const withBusy = async (operation: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const start = (request?: string) =>
    void withBusy(async () => {
      const run = await window.studio.startImportAnalysis({
        id: props.id,
        ...(request?.trim() ? { prompt: request.trim() } : {}),
      })
      setSelectedRunId(run.id)
      setRuns((previous) => [run, ...previous.filter((item) => item.id !== run.id)])
      if (request) setPrompt("")
      await refresh()
    })
  const cancel = (run: ImportAnalysisRun) =>
    void withBusy(async () => {
      const result = await window.studio.cancelImportAnalysis({ id: props.id, runId: run.id })
      setRuns((previous) => previous.map((item) => (item.id === result.id ? result : item)))
      setNotice("已取消。")
    })
  const apply = (run: ImportAnalysisRun) =>
    void withBusy(async () => {
      const result = await window.studio.applyImportedPlan({ id: props.id, runId: run.id })
      setRuns((previous) => previous.map((item) => (item.id === result.id ? result : item)))
      setNotice("改好了，可以导出修改后的包。")
    })
  const exportResult = (run: ImportAnalysisRun, kind: "archive" | "project") =>
    void withBusy(async () => {
      const result = await window.studio.exportModifiedImport({ id: props.id, runId: run.id, kind })
      if (result) setNotice(`已导出：${result.path}`)
    })

  onMount(() => {
    let disposed = false
    let polling = false
    void refresh(() => disposed)
      .then(async () => {
        if (disposed || runs().length) return
        // The first read starts by itself. Without a connected AI it cannot, and the empty state says so.
        setBusy(true)
        try {
          const run = await window.studio.startImportAnalysis({ id: props.id })
          if (disposed) return
          setSelectedRunId(run.id)
          setRuns([run])
        } catch {
          // Stay on the empty state; pressing the button there reports the reason.
        } finally {
          if (!disposed) setBusy(false)
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    const timer = setInterval(() => {
      if (disposed || polling || !runs().some(isActive)) return
      polling = true
      void refresh(() => disposed)
        .catch((cause) => {
          if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
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

  return (
    <section class="import-analysis" aria-label="玩法">
      <header class="import-analysis-toolbar">
        <div class="import-analysis-toolbar-title">
          <strong>玩法</strong>
          <span class="muted">AI 读完这个模组后写的介绍</span>
        </div>
        <div class="import-analysis-toolbar-actions">
          <Show when={runs().length > 1}>
            <label class="import-analysis-history-select">
              <span>记录</span>
              <select value={selectedRunId() ?? ""} onChange={(event) => setSelectedRunId(event.currentTarget.value)}>
                <For each={runs()}>
                  {(run) => (
                    <option value={run.id}>
                      {run.kind === "analyze" ? "玩法介绍" : "修改方案"} · {stateName(run)} ·{" "}
                      {new Date(run.createdAt).toLocaleString("zh-CN")}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
          <Button disabled={busy() || runs().some(isActive)} onClick={() => start()}>
            <Icon name="undo" />
            重新读一遍
          </Button>
        </div>
      </header>

      <Show when={error()}>
        <p class="resource-message error import-analysis-message" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={notice()}>
        <p class="resource-message import-analysis-message" role="status">
          {notice()}
        </p>
      </Show>

      <div class="import-analysis-scroll">
        <Show
          when={current()}
          fallback={
            <div class="import-analysis-empty">
              <span class="import-analysis-empty-icon">
                <Icon name="document" />
              </span>
              <strong>{busy() ? "AI 正在准备…" : "还没有玩法介绍"}</strong>
              <p>AI 会读一遍这个模组，告诉你它加了什么、怎么玩。还没连接 AI 的话，先点右上角连接。</p>
              <Button primary disabled={busy()} onClick={() => start()}>
                让 AI 读一遍
              </Button>
            </div>
          }
        >
          {(run) => (
            <div class="import-analysis-result">
              <div class={`import-analysis-status ${run().state}`}>
                <span class="import-analysis-status-dot" />
                <strong>{run().kind === "analyze" ? "玩法介绍" : "修改方案"}</strong>
                <span>{stateName(run())}</span>
                <Show when={isActive(run())}>
                  <Button disabled={busy()} onClick={() => cancel(run())}>
                    取消
                  </Button>
                </Show>
              </div>

              <Show when={run().state === "awaiting_model"}>
                <div class="import-analysis-callout">
                  <div>
                    <strong>已经交给外部 AI</strong>
                    <p>在你连接的 AI 应用里说一句「继续 MineMods 里 {props.name} 的分析」，这里会自动更新。</p>
                  </div>
                  <Show when={props.advanced}>
                    <Fold summary="连接与领取方式">
                      <p>
                        无需在 MineMods 设置 API Key。连接外部模型后，先调用 <code>list_imports</code>{" "}
                        查看工程与任务，再用 <code>get_import_task</code> 读取内嵌上下文、instructions 和输出
                        schema，完成后通过 <code>submit_import_task</code> 提交结构化结果。
                      </p>
                    </Fold>
                  </Show>
                </div>
              </Show>
              <Show when={run().state === "running"}>
                <div class="import-analysis-progress" role="status">
                  <span class="import-analysis-progress-mark" />
                  <span>AI 正在读这个模组，一般一两分钟…</span>
                </div>
              </Show>
              <Show when={run().state === "failed" && run().error}>
                <p class="resource-message error">{run().error}</p>
              </Show>

              <Show when={run().analysis}>
                {(analysis) => (
                  <>
                    <section class="import-analysis-summary">
                      <span class="import-analysis-card-icon">
                        <Icon name="logic" />
                      </span>
                      <div>
                        <small>一句话介绍</small>
                        <p>{analysis().summary}</p>
                      </div>
                    </section>
                    <section class="import-analysis-section">
                      <header>
                        <h4>可以这样玩</h4>
                        <span>{analysis().gameplay.length} 项</span>
                      </header>
                      <Show
                        when={analysis().gameplay.length}
                        fallback={
                          <div class="import-analysis-no-findings">
                            <Icon name="search" />
                            <span>AI 没有在这个模组里找到明确的玩法</span>
                          </div>
                        }
                      >
                        <div class="import-analysis-card-grid">
                          <For each={analysis().gameplay}>
                            {(item, index) => (
                              <article class="import-analysis-card import-analysis-gameplay-card">
                                <div class="import-analysis-card-topline">
                                  <span class="import-analysis-card-icon">
                                    <Icon name="logic" />
                                  </span>
                                  <small>玩法 {index() + 1}</small>
                                </div>
                                <strong>{item.title}</strong>
                                <p>{item.description}</p>
                                <Show when={props.advanced}>
                                  <small>证据：{item.evidence_ids.join("、")}</small>
                                </Show>
                              </article>
                            )}
                          </For>
                        </div>
                      </Show>
                    </section>
                    <Show when={props.advanced}>
                      <section class="import-analysis-section">
                        <header>
                          <h4>可扩展文件</h4>
                          <span>{analysis().extension_points.length} 项</span>
                        </header>
                        <Show
                          when={analysis().extension_points.length}
                          fallback={
                            <div class="import-analysis-no-findings">
                              <Icon name="folder" />
                              <span>没有找到可确认的扩展文件</span>
                            </div>
                          }
                        >
                          <div class="import-analysis-card-grid import-analysis-file-grid">
                            <For each={analysis().extension_points}>
                              {(item) => (
                                <article class="import-analysis-card import-analysis-file-card">
                                  <span class="import-analysis-card-icon">
                                    <Icon name="document" />
                                  </span>
                                  <div class="import-analysis-file-card-body">
                                    <strong title={item.path}>{item.path.split("/").at(-1)}</strong>
                                    <small class="import-analysis-file-path" title={item.path}>
                                      {item.path}
                                    </small>
                                    <p>{item.description}</p>
                                    <small>证据：{item.evidence_ids.join("、")}</small>
                                  </div>
                                </article>
                              )}
                            </For>
                          </div>
                        </Show>
                      </section>
                    </Show>
                    <Show when={analysis().requirements.length || analysis().unknowns.length}>
                      <Fold
                        class="import-analysis-more"
                        summary={
                          <>
                            需要注意和还不确定的地方{" "}
                            <span>{analysis().requirements.length + analysis().unknowns.length}</span>
                          </>
                        }
                      >
                        <For each={analysis().requirements}>
                          {(item) => (
                            <p>
                              {item.requirement}
                              <Show when={props.advanced}>
                                {" "}
                                <small>证据：{item.evidence_ids.join("、")}</small>
                              </Show>
                            </p>
                          )}
                        </For>
                        <For each={analysis().unknowns}>{(item) => <p>{item}</p>}</For>
                        <Show when={props.advanced && analysis().needed_paths.length}>
                          <p>
                            建议补读：<span class="resource-path">{analysis().needed_paths.join("、")}</span>
                          </p>
                        </Show>
                      </Fold>
                    </Show>
                  </>
                )}
              </Show>

              <Show when={run().plan}>
                {(plan) => (
                  <>
                    <Fold class="import-analysis-changes" open={true} summary={<>AI 打算改 {plan().changeset.changes.length} 处 · {plan().changeset.summary}</>}>
                      <For each={plan().changeset.changes}>
                        {(change) => (
                          <article>
                            <strong>
                              <code>{change.path}</code>
                            </strong>
                            <small>
                              {change.operation === "write" ? (change.expected_sha256 ? "修改" : "新增") : "删除"}
                              <Show when={props.advanced && change.expected_sha256}>
                                {" "}
                                · 原文件 SHA-256：{change.expected_sha256}
                              </Show>
                            </small>
                            <Show when={change.content !== null}>
                              <Fold summary="看看改成了什么">
                                <pre>{change.content}</pre>
                              </Fold>
                            </Show>
                          </article>
                        )}
                      </For>
                      <Show when={plan().changeset.warnings.length}>
                        <h4>要留意</h4>
                        <For each={plan().changeset.warnings}>{(item) => <p class="resource-warning">{item}</p>}</For>
                      </Show>
                      <Show when={plan().limitations.length}>
                        <h4>做不到的部分</h4>
                        <For each={plan().limitations}>{(item) => <p>{item}</p>}</For>
                      </Show>
                      <h4>改完后建议进游戏这样检查</h4>
                      <For each={plan().validation_plan}>
                        {(item) => (
                          <article>
                            <strong>{item.step}</strong>
                            <p>{item.expected}</p>
                            <Show when={props.advanced}>
                              <small>依据：{item.evidence_ids.join("、")}</small>
                            </Show>
                          </article>
                        )}
                      </For>
                    </Fold>
                    <Show when={run().state === "review"}>
                      <Button
                        primary
                        disabled={busy() || !plan().changeset.changes.length}
                        onClick={() => apply(run())}
                      >
                        就这么改
                      </Button>
                    </Show>
                  </>
                )}
              </Show>

              <Show when={run().state === "applied"}>
                <div class="import-analysis-export-warning">
                  <strong>导出前先确认版权与授权</strong>
                  <p>
                    导出包可能包含原作者及第三方的代码、脚本和素材。修改与公开分发前，请先看清相应的许可证并取得必要授权；此警示本身不构成授权。导出成功不代表游戏内效果已验证。
                  </p>
                </div>
                <div class="import-analysis-export-actions">
                  <Button disabled={busy()} onClick={() => exportResult(run(), "archive")}>
                    导出修改后的包
                  </Button>
                  <Show when={props.advanced}>
                    <Button disabled={busy()} onClick={() => exportResult(run(), "project")}>
                      导出 .modwork 工程
                    </Button>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>

      <form
        class="import-analysis-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (prompt().trim()) start(prompt())
        }}
      >
        <label for="import-analysis-prompt">想改点什么？</label>
        <textarea
          id="import-analysis-prompt"
          value={prompt()}
          maxLength={20000}
          rows={2}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          placeholder="比如：让这个生物多掉点东西、把合成配方改简单一点…"
        />
        <div>
          <small>{prompt().length} / 20000</small>
          <Button disabled={busy() || !prompt().trim()} type="submit">
            让 AI 出个方案
          </Button>
        </div>
      </form>
    </section>
  )
}
