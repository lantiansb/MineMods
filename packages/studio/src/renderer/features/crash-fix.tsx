import { createSignal, For, Show } from "solid-js"
import { CRASH_WORDS } from "@minemods/mod-core/game-crash"
import type { FixFindingsResult } from "../../api"
import { FIX_WORDS } from "../../fix-findings"
import { Button, Icon } from "../ui"

/**
 * The one button under a game that crashed (broad18 w2, B18-J-08): hands the crash to the AI through the same path the checks' findings take
 * (`fixFindings`, which reads the crash the last opening of the game left in the scene's record) and says what became of it, in the same words.
 * It does nothing by itself and is pressed by the person.
 */
export function CrashFix(props: { projectId: string; busy: boolean }) {
  const [fixing, setFixing] = createSignal(false)
  const [fixed, setFixed] = createSignal<FixFindingsResult | null>(null)
  const [refused, setRefused] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  const fix = () => {
    if (fixing()) return
    setFixing(true)
    setRefused("")
    void window.studio
      .fixFindings({ projectId: props.projectId })
      .then(setFixed, (cause: unknown) => setRefused(cause instanceof Error && /[一-鿿]/.test(cause.message) ? cause.message : "没能交给 AI，请再试一次。"))
      .finally(() => setFixing(false))
  }
  return (
    <div class="test-scene-fix">
      <Show when={!fixed()}>
        <Button primary disabled={fixing() || props.busy} onClick={fix}>
          <Icon name="tool" />
          {fixing() ? "正在交给 AI…" : CRASH_WORDS.button}
        </Button>
      </Show>
      <Show when={refused()}>
        <p class="test-scene-missing">{refused()}</p>
      </Show>
      <Show when={fixed()}>
        {(result) => (
          <div class="test-scene-fixed" role="status">
            <Show when={result().nothing}>
              <p>{FIX_WORDS.nothing}</p>
            </Show>
            <Show when={result().started.length}>
              <p>{(result().waiting ? FIX_WORDS.recorded : FIX_WORDS.started)(result().started.map((value) => value.title))}</p>
            </Show>
            <Show when={result().waiting}>
              <p>{result().tell ? FIX_WORDS.outside : FIX_WORDS.unconnected}</p>
            </Show>
            <Show when={result().tell}>
              {(tell) => (
                <Button onClick={() => void window.studio.copyText({ text: tell() }).then(() => setCopied(true))}>
                  <Icon name="copy" />
                  {copied() ? "已复制，再复制一次" : "复制这句话给我的 AI"}
                </Button>
              )}
            </Show>
            <Show when={result().left.length}>
              <p>{FIX_WORDS.left}</p>
              <ul>
                <For each={result().left}>{(value) => <li>{value.why.startsWith(`「${value.title}」`) ? value.why : `「${value.title}」：${value.why}`}</li>}</For>
              </ul>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
