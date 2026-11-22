import { Show } from "solid-js"
import type { McpConnectionStatus } from "../../mcp-status"
import { Button } from "../ui"
import { CardShell } from "./project-assets"

export function ConnectionPresence(props: {
  status?: McpConnectionStatus; text: string; review: boolean; external: boolean; configured: boolean
  onClose: () => void; onCheck: () => void; onCopy: () => void; onSettings: () => void
}) {
  const seconds = (at?: number | null) => at == null ? "还没有报到" : `${Math.max(0, Math.floor((Date.now() - at) / 1000))} 秒`
  return <CardShell title="连接 AI" manageFocus onClose={props.onClose}>
    <div class="connection-presence">
      <p role="status">当前状态：{props.text}</p>
      <Show when={props.external} fallback={<p>{props.configured ? "使用个人设置里连接的 AI 服务" : "还没有连接 AI。点「连接 AI」选一种方式。"}</p>}>
        <dl>
          <dt>最后一次报到</dt><dd>{seconds(props.status?.lastHeartbeat)}{props.status?.lastHeartbeat != null ? "前" : ""}</dd>
          <dt>在做哪一样</dt><dd>{props.status?.task ?? "还没有领取任务"}</dd>
          <dt>连了多久</dt><dd>{seconds(props.status?.connectedAt)}</dd>
          <dt>工具数</dt><dd>{props.status?.tools ?? 0}</dd>
        </dl>
      </Show>
      <Show when={props.review && props.external}><p>审查员：在外部 AI 的审查窗口中协作</p></Show>
      {/* The sentence for an outside AI works only once Studio takes one: before that, copying it leads the AI into a refusal. */}
      <div class="connection-presence-actions"><Button onClick={props.onCheck}>重新检测</Button><Show when={props.external}><Button onClick={props.onCopy}>复制起步说明</Button></Show><Button onClick={props.onSettings}>连接 AI</Button></div>
    </div>
  </CardShell>
}
