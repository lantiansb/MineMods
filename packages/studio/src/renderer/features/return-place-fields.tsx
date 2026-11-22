import { For, Show } from "solid-js"
import type { Ability } from "@minemods/mod-core/entity-runtime"
import { Fold } from "../fold"

export function ReturnPlaceFields(props: { abilities: Ability[]; edit: (path: string, value: unknown) => void; disabled: boolean }) {
  const rows = () => props.abilities.flatMap((ability, i) => ability.moves.flatMap((move, j) =>
    "type" in move && move.type === "leave" ? [{ name: ability.name, place: move.back.place, path: `abilities.${i}.moves.${j}.back.place` }] : []))
  return <Show when={rows().length}><Fold class="ae-section mc-window" summary="离场后落在哪里">
    <For each={rows()}>{row => <fieldset disabled={props.disabled}><legend>{row.name}</legend>
      <label>回来时落在<select value={typeof row.place === "string" ? row.place : "offset"} onChange={e => props.edit(row.path,
        e.currentTarget.value === "offset" ? { forward: [2, 3], left: [0, 0] } : e.currentTarget.value)}>
        <option value="home">家</option><option value="center">场地正中</option><option value="near_target">目标身边</option><option value="offset">按目标朝向设距离</option>
      </select></label>
      <Show when={typeof row.place === "object" && row.place}>{offset => <>
        <For each={["forward", "left"] as const}>{axis => <For each={[0, 1] as const}>{i =>
          <label>{axis === "forward" ? "向前" : "向左"}{i === 0 ? "从" : "到"}几格
            <input type="number" min="-32" max="32" step="any" value={offset()[axis][i]}
              onChange={e => { if (Number.isFinite(e.currentTarget.valueAsNumber)) props.edit(row.path + "." + axis + "." + i, e.currentTarget.valueAsNumber) }}/>
          </label>}</For>}</For>
        <small>负数表示向后或向右。范围里没有能站下的位置时回家。</small>
      </>}</Show>
    </fieldset>}</For>
  </Fold></Show>
}
