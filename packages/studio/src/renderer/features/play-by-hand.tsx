import { createMemo, For, Show } from "solid-js"
import { byHandLines } from "@minemods/mod-core/play-by-hand"
import type { Project } from "@minemods/mod-core/project"
import { PlayText } from "./play-text"
import "./play-by-hand.css"

/**
 * 「进游戏以后，怎么看到你做的东西」: for a game opened on its main menu with no test world set out (the licence was not agreed). Written from the
 * project by `byHandLines`: make a creative world, find what can be held in the inventory, find a creature's egg, find what turns up by itself.
 * Under the licence stop it is said before the person chooses, and it stays while the game is open and after, because that is when it is needed.
 */
export function ByHand(props: { project: Project }) {
  const lines = createMemo(() => byHandLines(props.project))
  return (
    <Show when={lines().length}>
      <section class="play-by-hand" aria-label="进游戏以后怎么看到你做的东西">
        <h4>进游戏以后，怎么看到你做的东西</h4>
        <ol>
          <For each={lines()}>
            {(line) => (
              <li>
                <PlayText text={line.text} />
              </li>
            )}
          </For>
        </ol>
      </section>
    </Show>
  )
}
