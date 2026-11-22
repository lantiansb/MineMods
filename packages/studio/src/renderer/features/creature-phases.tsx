import { Fold } from "../fold"
import { For, Show } from "solid-js"
import { bossShowStepWords } from "@minemods/mod-core/boss-show"
import { groundImpactWords } from "@minemods/mod-core/ground-fx"
import { combatGuide, combatScaleTable } from "@minemods/mod-core/combat"
import { arenaLines, fixtureCount } from "@minemods/mod-core/arena"
import { CreaturePicture, type InsideActions } from "./creature-inside-page"
export function CreaturePhases(p: InsideActions) {
  const phase = () => p.data.phases[p.phase] ?? p.data.phases[0]!
  const name = (id: string) => p.data.actions.find((a) => a.id === id)?.name ?? "指定招式"
  return (
    <>
      <h2>阶段</h2>
      <div class="phase-health" aria-hidden="true">
        <For each={p.data.phases}>{(s) => <i style={{ left: 100 - s.percent + "%" }} />}</For>
      </div>
      <div class="phase-line">
        <For each={p.data.phases}>
          {(s, i) => (
            <button aria-pressed={p.phase === i()} onClick={() => p.selectPhase(i())}>
              <strong>{s.percent}%</strong>
              <span>第 {i() + 1} 阶段</span>
              <Show when={s.added.length}>
                <small>加上 {s.added.map(name).join("、")}</small>
              </Show>
              <Show when={s.removed.length}>
                <small>去掉 {s.removed.map(name).join("、")}</small>
              </Show>
            </button>
          )}
        </For>
        <b>0%</b>
      </div>
      <article class="inside-card">
        <h3>第 {p.phase + 1} 阶段</h3>
        <Show when={p.phase > 0}>
          <button disabled={p.busy} onClick={() => p.edit({ tab: "phases", phase: p.phase - 1 })}>编辑这阶段</button>
        </Show>
        <p>{phase().text}</p>
        <h4>能用的招式</h4>
        <For each={phase().ids}>{(id) => <button onClick={() => p.selectMove(id)}>{name(id)}</button>}</For>
        <For each={p.data.boss?.phases[p.phase - 1]?.finish}>
          {(event) => (
            <p>
              阶段收尾 ·{" "}
              {event.type === "ground"
                ? groundImpactWords(event.ground, p.data.title, p.data.names.aliases)
                : bossShowStepWords({ ...event, at: 0 }, p.data.names)}
            </p>
          )}
        </For>
        <CreaturePicture data={p.data} part="phases" value={String(p.phase)} label="看这一阶段的样子" busy={p.busy} />
      </article>
    </>
  )
}
export function CreatureArena(p: InsideActions) {
  return (
    <Show when={p.data.boss?.arena}>
      {(a) => (
        <article class="inside-card">
          <h3>战斗场地</h3>
          <For each={arenaLines(a(), (f) => p.data.title(f.look.asset) ?? "场地物件").flatMap((line) => line.split(/；(?=「)/))}>{(line) => <p>{line}</p>}</For>
          <For each={a().fixtures}>
            {(f) => (
              <button onClick={() => p.go(f.look.asset)}>
                {p.data.title(f.look.asset)} · {fixtureCount(f.place)} 座
              </button>
            )}
          </For>
          <CreaturePicture data={p.data} part="arena" label="看场地俯视图" busy={p.busy} />
        </article>
      )}
    </Show>
  )
}
export function CreatureCombat(p: InsideActions) {
  return (
    <>
      <For each={combatGuide(p.data.doc, p.data.names.bone, (id) => (/[一-龥]/.test(id) ? id : "破防"))}>
        {(s) => <p>{s}</p>}
      </For>
      <Show when={combatScaleTable({ ...p.data.doc, abilities: p.data.moves }).filter((r) => r.phase === p.phase)}>
        {(rows) => (
          <Show when={rows().length}>
            <Fold summary="阶段、窗口与部位的伤害倍率">
              <table>
                <thead>
                  <tr>
                    <th>招式</th>
                    <th>时间（秒）</th>
                    <th>部位</th>
                    <th>正面 / 背面</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows()}>
                    {(r) => (
                      <tr>
                        <td>{r.ability}</td>
                        <td>
                          {r.from / 20}–{r.to / 20}
                        </td>
                        <td>{p.data.names.bone(r.part)}</td>
                        <td>
                          {r.front} / {r.back}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Fold>
          </Show>
        )}
      </Show>
    </>
  )
}
