import { For, Show } from "solid-js"
import { abilityUsers } from "@minemods/mod-core/ability-usage"
import { abilityWords } from "@minemods/mod-core/creature-abilities"
import { sharedAbilityInline, type AbilityAssetDocument } from "@minemods/mod-core/ability-asset"
import { scaleWords } from "@minemods/mod-core/ability-scale"
import type { Project } from "@minemods/mod-core/project"
import { creatureInside } from "./creature-inside-model"
import { CreaturePicture } from "./creature-inside-page"

export function AbilityUsers(props: { project: Project; assetId: string; document: AbilityAssetDocument; go?: (id: string) => void }) {
  const users = () => abilityUsers(props.project, props.assetId, props.document)
  const unboundTimeline = () => users().some(user => user.kind === "entity") ? null : sharedAbilityInline({
    id: "preview", asset: props.assetId, clip: "preview", facing: "lock", stopped_by_hurt: false,
    start: { min_distance: 0, max_distance: props.document.reach, line_of_sight: false, cooldown: 0, weight: 1 },
  }, props.document).ability
  return <><Show when={unboundTimeline()}>{move => <section aria-label="出手顺序">
    <For each={move().hits}>{hit => <p>{abilityWords.hit(hit)}</p>}</For>
    <p>{abilityWords.events(move())}</p>
  </section>}</Show><section aria-label="谁在用它">
    <h3>谁在用它</h3>
    <Show when={users().length} fallback={<p>还没有生物、物品、方块或动作用这一招。</p>}>
      <For each={users()}>{user => {
        const doc = props.project.workspace.assets.find(a => a.id === user.id)?.document
        const inside = doc?.kind === "entity" ? creatureInside(props.project, doc) : null
        return <article>
          <button disabled={!props.go || !doc} onClick={() => props.go?.(user.id)}>{user.title}</button>
          <Show when={inside}>{data =>
            <For each={data().moves.filter(move => data().doc.shared_abilities?.some(use => use.asset === props.assetId && use.id === move.id))}>{move =>
              <><p>{scaleWords(data().doc.shared_abilities?.find(use => use.asset === props.assetId && use.id === move.id)?.scale) || "原大小（没有缩放）"}</p>
                <p>{abilityWords.summary(move, "，", undefined, data().motion, data().doc.stagger, data().names)}</p>
                <p>{abilityWords.events(move, data().names)}</p>
                <CreaturePicture data={data()} part="move" value={move.id} label="看招式图" busy={false} /></>
            }</For>
          }</Show>
        </article>
      }}</For>
    </Show>
  </section></>
}
