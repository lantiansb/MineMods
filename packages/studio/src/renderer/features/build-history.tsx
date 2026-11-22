import { createResource, createSignal, For, Show } from "solid-js"
import { Button } from "../ui"
import { CardShell } from "./project-assets"

const date = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" })

export function BuildHistory(props: { projectId: string; close: () => void }) {
  const [history] = createResource(() => props.projectId, id =>
    window.studio.listBuildJars({ projectId: id }).catch(() => null))
  const [problem, setProblem] = createSignal("")
  const reveal = async (jobId: string) => {
    setProblem("")
    await window.studio.revealRecordedJar({ projectId: props.projectId, jobId })
      .catch(() => setProblem("这次打包的文件暂时打不开，可能已经被移走。"))
  }
  return (
    <CardShell title="打包记录" manageFocus onClose={props.close}>
      <Show when={history.loading}><p role="status">正在读打包记录…</p></Show>
      <Show when={history() === null}><p role="alert">暂时读不了打包记录，请稍后再试。</p></Show>
      <Show when={history()}>{list =>
        <Show when={list().length} fallback={<p>还没有成功打包的模组文件。</p>}>
          <ul class="build-history-list">
            <For each={list()}>{entry => <li>
              <strong>{entry.name}</strong>
              <span><time dateTime={entry.finishedAt}>{date.format(new Date(entry.finishedAt))}</time> · 工程第 {entry.revision} 版</span>
              <Show when={entry.available} fallback={<small>本机找不到这个文件。</small>}>
                <Button onClick={() => void reveal(entry.jobId)}>打开所在文件夹</Button>
              </Show>
            </li>}</For>
          </ul>
        </Show>
      }</Show>
      <Show when={problem()}><p role="alert">{problem()}</p></Show>
    </CardShell>
  )
}
