import { For, Show } from "solid-js"
import type { Finding, FindingTarget } from "@minemods/mod-core/reconcile"
import { Icon } from "../ui"
import "./finding-go.css"

/** How many buttons one finding shows before the rest are left to each thing's own card (a finding about forty things is not forty buttons). */
export const GO_LIMIT = 6

export const GO_BUTTON_WORDS = {
  more: (count: number) => `另外还有 ${count} 样，到它们各自的卡片里填。`,
} as const

/**
 * The way from a finding to the place its fix is done. Every finding that asks the person to fill something in carries its targets
 * (`Finding.targets`); one button each, which the window turns into "open that thing, show that field, put the cursor in it".
 * Shown the same in every list of findings, so no list can name a place without leading to it.
 */
export function FindingGo(props: { finding: Pick<Finding, "targets">; onGo?: (target: FindingTarget) => void }) {
  return (
    <Show when={props.onGo && props.finding.targets?.length}>
      <span class="fg-row">
        <For each={props.finding.targets!.slice(0, GO_LIMIT)}>
          {(target) => (
            <button type="button" class="fg-go" onClick={() => props.onGo!(target)}>
              {target.label}
              <Icon name="arrow" />
            </button>
          )}
        </For>
        <Show when={props.finding.targets!.length > GO_LIMIT}>
          <small class="fg-more">{GO_BUTTON_WORDS.more(props.finding.targets!.length - GO_LIMIT)}</small>
        </Show>
      </span>
    </Show>
  )
}
