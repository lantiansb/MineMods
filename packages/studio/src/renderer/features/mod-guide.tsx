import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import type { ModGuideView } from "../../api"
import type { FindingTarget } from "@minemods/mod-core/reconcile"
import { Button } from "../ui"
import { FindingGo } from "./finding-go"
import { plainFix } from "@minemods/mod-core/play-words"
import { PlayText } from "./play-text"
import "./mod-guide.css"

/**
 * 模组说明书 and 机器对账, for the project as it is saved now. Everything shown is written by rule from the
 * project's own data (`getModGuide`): nothing here is an AI's opinion, and nothing was tried in the game.
 * Mount it anywhere with the project's id and revision; it reads again when the revision changes.
 */
export function ModGuide(props: { projectId: string; revision: number; advanced?: boolean; onState?: (state: "ok" | "warn" | "stop" | null) => void; onGo?: (target: FindingTarget) => void }) {
  const [view, setView] = createSignal<ModGuideView | null>(null)
  const [failed, setFailed] = createSignal(false)
  // What the last button press came to, shown beside that button: `at` is a creature's id, or null for the header.
  const [said, setSaid] = createSignal<{ at: string | null; text: string } | null>(null)
  // broad7 w2: a details element inside the multi-column list drew Chromium's own style for it as text between the cards, so the cards fold
  // with a button of their own (the same reason the shared Fold, `../fold`, is a button). The first three start open; what the person opens or closes is kept by the section's title.
  const [folds, setFolds] = createSignal<Record<string, boolean>>({})
  const isOpen = (title: string, index: number) => folds()[title] ?? index < 3
  const toggle = (title: string, index: number) => setFolds((now) => ({ ...now, [title]: !isOpen(title, index) }))
  createEffect(
    on(
      createMemo(() => `${props.projectId}:${props.revision}`),
      () => void window.studio.getModGuide({ projectId: props.projectId }).then((value) => (setView(value), setFailed(false)), () => setFailed(true)),
    ),
  )
  const stops = () => view()?.findings.filter((finding) => finding.stops) ?? []
  const warns = () => view()?.findings.filter((finding) => !finding.stops) ?? []
  const state = () => (stops().length ? "stop" : warns().length ? "warn" : "ok")
  createEffect(() => props.onState?.(view() ? state() : null))
  const copy = () => void navigator.clipboard.writeText(view()?.markdown ?? "").then(() => setSaid({ at: null, text: "已经复制，可以贴到任何地方。" }), () => setSaid({ at: null, text: "没有复制成功。" }))
  const save = (creature: string) =>
    void window.studio.exportBlockbench({ projectId: props.projectId, assetId: creature }).then(
      (result) => setSaid({ at: creature, text: `模型存好了：${result.path}` }),
      (error: unknown) => setSaid(error instanceof Error && error.message.includes("已取消") ? null : { at: creature, text: "模型没有存成功。" }),
    )
  return (
    <section class="mg-panel">
      <header class="mg-head">
        <h3>模组说明书</h3>
        <p>按工程现在保存的东西写的，每一句都来自工程里的数据。打包时会在模组文件旁边放一份「模组说明.md」。</p>
        <Button onClick={copy} disabled={!view()}>
          复制全文
        </Button>
      </header>
      <Show when={said()?.at === null && said()}>{(message) => <p class="mg-said">{message().text}</p>}</Show>
      <Show when={failed()}>
        <p class="mg-said">说明书现在读不出来，工程没有被改动。</p>
      </Show>
      <Show when={view()}>
        {(guide) => (
          <>
            <div class="mg-check" data-state={state()}>
              <strong>
                <i aria-hidden="true" />
                检查
              </strong>
              <span>
                {state() === "ok"
                  ? "按规则检查过，没有发现会让模组坏掉、或者和工程写的不一样的地方。"
                  : `${stops().length ? `有 ${stops().length} 处会让模组打包失败` : ""}${stops().length && warns().length ? "，另外" : ""}${warns().length ? `有 ${warns().length} 处提醒（不拦着打包）` : ""}。`}
              </span>
              <small>这是 Studio 自己按规则查出来的，没有用 AI，也没有打开游戏。</small>
              <Show when={guide().findings.length}>
                <ul>
                  <For each={[...stops(), ...warns()]}>
                    {(finding) => (
                      <li data-stops={finding.stops}>
                        <em>{finding.stops ? "要先改" : "提醒"}</em>
                        <span>{props.advanced ? finding.text : plainFix(finding.text)}</span>
                        <small>{props.advanced ? finding.fix : plainFix(finding.fix)}</small>
                        <FindingGo finding={finding} onGo={props.onGo} />
                        <Show when={props.advanced && finding.detail}>
                          <code>{finding.detail}</code>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
            <div class="mg-sections">
            <For each={guide().sections.filter((section) => section.title !== "机器对账发现的问题")}>
              {(section, index) => (
                <section class="mg-section" data-open={isOpen(section.title, index()) ? "yes" : undefined} data-creature={section.creature ? "yes" : undefined}>
                  <button type="button" class="mg-head" aria-expanded={isOpen(section.title, index())} onClick={() => toggle(section.title, index())}>
                    <span>{section.title}</span>
                    <em>{section.lines.length} 条</em>
                  </button>
                  <Show when={isOpen(section.title, index())}>
                  <ul>
                    <For each={section.lines}>{(line) => <li title={props.advanced ? line.from.join("  ") : undefined}><PlayText text={line.text} /></li>}</For>
                  </ul>
                  <Show when={section.creature}>
                    {(creature) => (
                      <p class="mg-export">
                        <Button onClick={() => save(creature())}>导出它的模型（.bbmodel）</Button>
                        <span>用免费的 Blockbench 就能打开，不用装插件，里面带着贴图和所有动作。</span>
                        <Show when={said()?.at === creature() && said()}>{(message) => <strong class="mg-said">{message().text}</strong>}</Show>
                      </p>
                    )}
                  </Show>
                  </Show>
                </section>
              )}
            </For>
            </div>
          </>
        )}
      </Show>
    </section>
  )
}
