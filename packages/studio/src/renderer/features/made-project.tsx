import { Show } from "solid-js"
import { Button } from "../ui"
import { MADE_WORDS } from "../made-project"
import "./made-project.css"

/**
 * Said over any page when an outside AI made a project the window did not open by itself (the person is in the middle of something).
 * The press is the window's own `openMade`, which asks first when something is unsaved.
 */
export function MadeProjectBar(props: { made: { id: string; name: string } | null; onOpen: (id: string) => void; onDismiss: () => void }) {
  return (
    <Show when={props.made}>
      {(made) => (
        <div class="made-bar" role="status">
          <strong>{MADE_WORDS.said(made().name)}</strong>
          <Button primary onClick={() => props.onOpen(made().id)}>
            {MADE_WORDS.open}
          </Button>
          <button type="button" class="made-close" aria-label={MADE_WORDS.dismiss} title={MADE_WORDS.dismiss} onClick={props.onDismiss}>
            ×
          </button>
        </div>
      )}
    </Show>
  )
}
