import { For, createMemo, createSignal } from "solid-js"
import { arenaPlan, type Arena } from "@minemods/mod-core/arena"
import { fixtureConditionWords, type FixturesLit } from "@minemods/mod-core/combat"
import { feasibleArc, litInArc } from "@minemods/mod-core/fixture-conditions"

import { fixtureLabels } from "./fixture-names"

const names = ["没点亮", "亮着", "余烬"] as const
const colors = ["#85949c", "#ffd768", "#d9794d"] as const
export function FixtureMap(props: { arena: Arena; rules: FixturesLit[]; title: (id: string) => string | undefined; advanced: boolean }) {
  const slots = createMemo(() => arenaPlan(props.arena).fixtures)
  const labels = createMemo(() => fixtureLabels(slots(), props.title))
  const [yaw, setYaw] = createSignal(0)
  const [states, setStates] = createSignal<Record<string, number>>({})
  const state = (id: string) => states()[id] ?? 0
  const radius = () => Math.max(5, ...slots().map((s) => Math.hypot(s.left, s.forward))) * 1.25
  const distinct = createMemo(() =>
    props.rules.filter(
      (rule, i, rules) =>
        rules.findIndex(
          (other) => other.count === rule.count && (other.within_arc ?? 360) === (rule.within_arc ?? 360),
        ) === i,
    ),
  )
  const arcs = createMemo(() =>
    [...new Set(distinct().map((rule) => rule.within_arc ?? 360))].filter((arc) => arc < 360).sort((a, b) => b - a),
  )
  const sector = (arc: number) => {
    const half = (arc * Math.PI) / 360,
      x = 94 * Math.sin(half),
      y = -94 * Math.cos(half)
    return `M 0 0 L ${-x} ${y} A 94 94 0 ${arc > 180 ? 1 : 0} 1 ${x} ${y} Z`
  }
  const sets = () => slots().filter((slot) => state(slot.id) === 1)
  return (
    <section class="fixture-map" aria-label="场地物件俯视预览">
      <h3>场地物件</h3>
      <svg
        role="img"
        aria-label="家、身体朝向和物件状态"
        width="260"
        height="220"
        viewBox="-110 -110 220 220"
        style={{ width: "min(100%, 280px)", height: "auto", background: "#17252b", "border-radius": "6px" }}
      >
        <g transform={`rotate(${yaw()})`}>
          <For each={arcs()}>
            {(arc) => <path d={sector(arc)} fill="#304955" stroke="#6c8893" stroke-width="0.8" />}
          </For>
        </g>
        <circle r="94" fill="none" stroke="#52646c" />
        <path
          transform={`rotate(${yaw()})`}
          d="M 0,-34 L 6,-16 L 2,-18 L 2,3 L -2,3 L -2,-18 L -6,-16 Z"
          fill="#e9eff1"
        />
        <For each={slots()}>
          {(slot) => (
            <g transform={`translate(${(-100 * slot.left) / radius()} ${(-100 * slot.forward) / radius()})`}>
              <circle r="7" fill={colors[state(slot.id)]} />
              <text y="17" fill="white" font-size="7" text-anchor="middle">
                {labels().get(slot.id)}
              </text>
            </g>
          )}
        </For>
      </svg>
      <div class="fixture-map-controls">
        <label>
          身体朝向 {yaw()}°{" "}
          <input
            type="range"
            aria-label="身体朝向"
            min="-180"
            max="180"
            step="0.1"
            value={yaw()}
            onInput={(e) => setYaw(e.currentTarget.valueAsNumber)}
          />
        </label>
        <div class="fixture-map-buttons" aria-label="点击物件切换状态">
          <For each={slots()}>
            {(slot) => (
              <button
                type="button"
                onClick={() => setStates((old) => ({ ...old, [slot.id]: (state(slot.id) + 1) % 3 }))}
              >
                {labels().get(slot.id)} · {names[state(slot.id)]}{props.advanced && <small>（{slot.id}）</small>}
              </button>
            )}
          </For>
        </div>
        <For each={distinct()}>
          {(rule) => {
            const possible = () => feasibleArc(slots(), rule)
            return (
              <p>
                {fixtureConditionWords(rule)}。当前 {litInArc(sets(), yaw(), rule.within_arc ?? 360)} 座，
                {litInArc(sets(), yaw(), rule.within_arc ?? 360) >= rule.count ? "条件成立" : "条件未成立"}。
                {possible().max < rule.count
                  ? "从家朝任何方向都凑不够。"
                  : possible().narrow
                    ? "只有物件恰好压在角度边缘时才够。"
                    : ""}
              </p>
            )
          }}
        </For>
      </div>
    </section>
  )
}
