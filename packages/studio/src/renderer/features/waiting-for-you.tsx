import { For, Show } from "solid-js"
import { Button, Icon } from "../ui"
import type { Waiting, WaitingKind } from "./waiting-for-you-model"
import "./waiting-for-you.css"

/**
 * What waits for the person, each with its button, on the page that says it waits (see `waitingForYou`). The blueprint's button does the thing here;
 * the others lead to the page where it is done. `hint` is a sentence under the row of the blueprint (the same one 模组总览 shows under its button).
 */
export function WaitingForYou(props: {
  waits: Waiting[]
  pending: boolean
  error: string
  hint?: string
  onDo: (kind: WaitingKind) => void
  onGo: (kind: WaitingKind) => void
}) {
  return (
    <Show when={props.waits.length}>
      <ul class="wfy" aria-label="等你做的事">
        <For each={props.waits}>
          {(wait) => (
            <li class="wfy-row" data-kind={wait.kind}>
              <span class="wfy-text">
                <Icon name="clock" />
                {wait.text}
                <Show when={wait.blocked}>
                  <small>{wait.blocked}</small>
                </Show>
                <Show when={wait.kind === "blueprint" && props.hint}>
                  <small>{props.hint}</small>
                </Show>
              </span>
              <Button primary disabled={!!wait.blocked || props.pending} onClick={() => (wait.how === "do" ? props.onDo(wait.kind) : props.onGo(wait.kind))}>
                {wait.label}
              </Button>
            </li>
          )}
        </For>
        <Show when={props.error}>
          <li class="wfy-error" role="alert">
            {props.error}
          </li>
        </Show>
      </ul>
    </Show>
  )
}

