import { createMemo, createSignal, Show } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { OverviewItem } from "../../api"
import { Fold } from "../fold"
import { ModelStage } from "./asset-preview"
import { playableMotions } from "./motion-play-model"

/**
 * 「播放动作」: where the pictures of a thing in the making (the card's 制作过程, the 制作现场) are put beside the model itself, so its motions can be played there, one by one,
 * each named as a player knows it, with the ability that plays it. It is the same view the finished thing's card shows; nothing here draws a second kind. The view is made when
 * the entry is opened and put away when it is closed, so a page of many things holds none until asked. A thing with no motion of a model that is saved has no entry.
 */
export function MotionPlay(props: { projectId: string; project: Project; item: OverviewItem | null | undefined }) {
  const motions = createMemo(() => (props.item ? playableMotions(props.project, props.item.preview) : []), [], { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) })
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={props.item && motions().length ? props.item : null}>
      {(item) => (
        <Fold
          class="mk-play"
          summary={
            <>
              播放动作<small>{motions().length} 个</small>
            </>
          }
          onToggle={setOpen}
        >
          <Show when={open()}>
            <ModelStage projectId={props.projectId} project={props.project} source={item().preview} />
          </Show>
        </Fold>
      )}
    </Show>
  )
}
