import { STALE_EDIT } from "@minemods/mod-core/stale-edit"
import { Button } from "../ui"
import "./stale-edit.css"

/**
 * What a form that edits stored content says when the stored content changed under it (see `stale-edit` in mod-core): the one sentence, and
 * the way to put the new content into the form. The person's own words in the form stay where they are until they choose to load.
 */
export function StaleNotice(props: { onLoad: () => void }) {
  return (
    <div class="se-notice" role="alert">
      <p>{STALE_EDIT.says}</p>
      <Button onClick={props.onLoad}>{STALE_EDIT.load}</Button>
    </div>
  )
}
