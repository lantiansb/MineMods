import { createMemo, For, Show } from "solid-js"
import { bossPhaseIds } from "@minemods/mod-core/boss-words"
import { combatScaleTable } from "@minemods/mod-core/combat"
import { currentStance, stanceChoices, stanceWords } from "@minemods/mod-core/stances"
import type { InsideActions } from "./creature-inside-page"

export function CreatureStances(props: InsideActions) {
  const config = () => props.data.doc.stances!
  const selected = () => currentStance(config(), props.stance)
  const phase = () => props.phase
  const ids = () => props.data.actions.map(move => move.id)
  const phaseList = createMemo(() => bossPhaseIds(props.data.boss?.phases ?? [], ids(), true))
  const choices = (id: string, tactic?: readonly string[]) =>
    stanceChoices(currentStance(config(), id), ids(), phaseList()[phase()], tactic)
  const label = (id: string) => props.data.actions.find(move => move.id === id)?.name ?? id
  const list = (rows: readonly string[]) => rows.length ? rows.map(label).join("、") : "几份名单没有共同能用的招，它会等着。"
  const scales = createMemo(() => {
    const allowed = new Set(choices(selected().id))
    const names = new Set(props.data.moves.filter(move => allowed.has(move.id)).map(move => move.name))
    return combatScaleTable({ ...props.data.doc, abilities: props.data.moves }).filter(row =>
      row.phase === phase() && row.stance === selected().id && names.has(row.ability))
  })
  return (
    <section class="creature-stances" aria-label="姿态">
      <h2>姿态</h2>
      <Show when={props.data.phases.length > 1}>
        <label>查看哪个阶段
          <select aria-label="查看哪个阶段" value={String(phase())} onChange={event => props.previewPhase(Number(event.currentTarget.value))}>
            <For each={props.data.phases}>{(_, index) => <option value={index()}>第 {index() + 1} 阶段</option>}</For>
          </select>
        </label>
      </Show>
      <For each={config().list}>
        {row => (
          <article class="inside-card" id={`creature-stance-${row.id}`}>
            <h3>{row.name}</h3>
            <button type="button" aria-pressed={selected().id === row.id} onClick={() => props.selectStance(row.id)}>看{row.name}</button>
            <For each={stanceWords(row, config(), props.data.actions)}>{line => <p>{line}</p>}</For>
            <p>{props.data.boss ? "这个阶段" : "这时"}能出 {list(choices(row.id))}</p>
            <Show when={props.data.doc.tactics?.hugged?.use}>
              {use => <p>被贴身时能出 {list(choices(row.id, use()))}</p>}
            </Show>
            <Show when={props.data.doc.tactics?.kited?.use}>
              {use => <p>被引着跑时能出 {list(choices(row.id, use()))}</p>}
            </Show>
            <Show when={row.model?.hide?.length}><p>藏起 {row.model!.hide!.map(props.data.names.bone).join("、")}</p></Show>
            <Show when={row.model?.show?.length}><p>露出 {row.model!.show!.map(props.data.names.bone).join("、")}</p></Show>
          </article>
        )}
      </For>
      <Show when={scales().length}>
        <article class="inside-card">
          <h3>「{selected().name}」的伤害倍率</h3>
          <table class="stance-scales">
            <thead><tr><th>招式</th><th>第几刻</th><th>部位</th><th>按哪一层算</th><th>倍率</th><th>挡住时</th></tr></thead>
            <tbody>
              <For each={scales()}>{row => (
                <tr><td>{row.ability}</td><td>{row.from}–{row.to - 1}</td><td>{row.part}</td><td>{row.source}</td><td>{row.scale}×</td><td>{row.front}×</td></tr>
              )}</For>
            </tbody>
          </table>
        </article>
      </Show>
    </section>
  )
}
