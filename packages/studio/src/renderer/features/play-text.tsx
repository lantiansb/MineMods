import { createSignal, For, Show } from "solid-js"
import { sayPieces, splitForPerson, technicalHidden } from "@minemods/mod-core/play-words"
import { refusalForPerson, withheldWords } from "@minemods/mod-core/refusal-words"
import { advanced } from "../advanced"
import { VANILLA_ITEM_NAMES } from "@minemods/mod-core/fabric/content-vanilla"
import { Button, Icon } from "../ui"
import "./play-text.css"

/**
 * A sentence of the guide or the play instructions, with each command in it (written between backticks, see
 * `mod-core/play-words.ts`) as a line of its own that can be copied: what a person is told to type is never
 * something they must pick out of a sentence by eye. Everything outside the backticks is shown as the words it is,
 * except a piece of code an AI or a tool quoted (a class, a method, an event): that stays in the sentence, set as a code token,
 * so the sentence keeps its meaning (round 18). `events: false` shows the text as written, for 高级.
 */
export function CommandLine(props: { command: string }) {
  const [copied, setCopied] = createSignal(false)
  const copy = () => void window.studio.copyText({ text: props.command }).then(() => setCopied(true), () => setCopied(false))
  return (
    <span class="play-command">
      <Show when={advanced()}><code>{props.command}</code></Show>
      <Button class="play-command-copy" onClick={copy}>
        <Icon name="copy" />
        {copied() ? "已复制" : advanced() ? "复制这一行" : props.command.startsWith("/locate ") ? "复制定位指令" : "复制游戏指令"}
      </Button>
    </span>
  )
}

export function PlayText(props: { text: string; events?: boolean }) {
  return (
    <For each={sayPieces(props.text, props.events !== false)}>
      {(piece) => (
        <Show when={piece.command} fallback={<Show when={piece.code} fallback={<>{piece.text}</>}><Show when={advanced()} fallback={VANILLA_ITEM_NAMES[piece.text.replace(/^minecraft:/, "")] ?? "技术名称（见高级）"}><code class="said-code">{piece.text}</code></Show></Show>}>
          <CommandLine command={piece.text} />
        </Show>
      )}
    </For>
  )
}

/** The same sentence under the name a surface that shows an AI's or a tool's words uses. */
export const Said = PlayText

/**
 * Lines an AI or a tool wrote for a person, each as an element of `as`: plain words with their code set as tokens, and, in the normal view, the lines
 * that are mostly code left out with one sentence saying so (they are shown as written under 高级). Nothing is replaced by a placeholder.
 */
export function SaidLines(props: { lines: readonly string[]; advanced: boolean; as?: "li" | "span" | "p" }) {
  const split = () => (props.advanced ? { shown: [...props.lines], technical: [] as string[] } : splitForPerson(props.lines))
  const element = (children: any, hidden = false) => {
    const kind = props.as ?? "li"
    return kind === "li" ? <li classList={{ "said-hidden": hidden }}>{children}</li> : kind === "p" ? <p classList={{ "said-hidden": hidden }}>{children}</p> : <span classList={{ "said-hidden": hidden }}>{children}</span>
  }
  return (
    <>
      <For each={split().shown}>{(line) => element(<PlayText text={line} events={!props.advanced} />)}</For>
      <Show when={split().technical.length}>{element(technicalHidden(split().technical.length), true)}</Show>
    </>
  )
}

/**
 * Why a task or a run stopped, as the person reads it: the plain sentences of the text, with one line saying that the rest was an instruction written for
 * the AI (a refusal names the calls to make next and the fields to write). Under 高级, or when nothing of it is for the AI, the text is shown as written.
 */
export function RefusalText(props: { text: string; advanced: boolean }) {
  const said = () => refusalForPerson(props.text)
  return (
    <Show when={!props.advanced && said().withheld > 0} fallback={<>{props.text}</>}>
      <For each={said().lines}>{(line) => <>{line} </>}</For>
      <small class="said-hidden">{withheldWords(said().withheld)}</small>
    </Show>
  )
}
