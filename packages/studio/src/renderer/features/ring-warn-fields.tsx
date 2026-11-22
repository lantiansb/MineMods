import { For, Index, Show } from "solid-js"
import type { Ability } from "@minemods/mod-core/entity-runtime"
import { WARN_COLORS, WARN_COLOR_IDS, WARN_LIMITS, WARN_LOOKS, WARN_LOOK_IDS } from "@minemods/mod-core/ability-words"

type RingEvent = Extract<Ability["events"][number], { type: "shockwave" }>
export function RingWarnFields(props: {
  abilities: readonly Ability[]
  effects: readonly { id: string; title: string }[]
  edit: (path: string, value: unknown) => void
  disabled: boolean
}) {
  const rings = () => props.abilities.flatMap((ability, a) => ability.events.flatMap((event, i) =>
    event.type === "shockwave" ? [{ name: ability.name, key: `abilities.${a}.events.${i}.warn`, event }] : []))
  return <Show when={rings().length}><section class="ae-section mc-window"><h3>冲击波环的预警</h3>
    <Index each={rings()}>{row => {
      const warn = () => row().event.warn
      const change = (field: keyof NonNullable<RingEvent["warn"]>, value: unknown) => props.edit(row().key + "." + field, value)
      return <fieldset disabled={props.disabled}><legend>{row().name} · 第 {row().event.at} 秒的环</legend>
        <label><input type="checkbox" checked={!!warn()} disabled={row().event.at < WARN_LIMITS.seconds.min}
          onChange={e => props.edit(row().key, e.currentTarget.checked ? { seconds: Math.min(0.6, row().event.at), look: "ring", color: "orange" } : undefined)} />提前画圈</label>
        <Show when={row().event.at < WARN_LIMITS.seconds.min}><p>把环放在第 {WARN_LIMITS.seconds.min} 秒或以后，就有时间提前画圈。</p></Show>
        <Show when={warn()}>
          <label>提前几秒 <input type="number" min={WARN_LIMITS.seconds.min} max={Math.min(WARN_LIMITS.seconds.max,row().event.at)} step="0.05" value={warn()?.seconds} onChange={e=>change("seconds",e.currentTarget.valueAsNumber)} /></label>
          <label>样子 <select value={warn()?.look} onChange={e=>change("look",e.currentTarget.value)}><For each={WARN_LOOK_IDS}>{k=><option value={k}>{WARN_LOOKS[k]}</option>}</For></select></label>
          <label>颜色 <select value={warn()?.color} onChange={e=>change("color",e.currentTarget.value)}><For each={WARN_COLOR_IDS}>{k=><option value={k}>{WARN_COLORS[k].name}</option>}</For></select></label>
          <label><input type="checkbox" checked={warn()?.extent === "max"} onChange={e=>change("extent",e.currentTarget.checked ? "max" : undefined)} />用虚线标出最远外缘</label>
          <label>跟随 <select value={warn()?.follow ?? ""} onChange={e=>{
            const {follow,lock_before,...rest} = warn()!
            props.edit(row().key,e.currentTarget.value ? {...rest,follow:e.currentTarget.value,lock_before} : rest)
          }}><option value="">固定在原处</option><option value="caster">施法者</option><option value="target">目标</option></select></label>
          <Show when={warn()?.follow}><label>提前几秒定住 <input type="number" min="0" max={warn()?.seconds} step="0.05" value={warn()?.lock_before ?? 0} onChange={e=>change("lock_before",e.currentTarget.valueAsNumber)} /></label></Show>
          <label>淡出秒数 <input type="number" min="0" max="3" step="0.05" value={warn()?.fade_seconds ?? 0} onChange={e=>change("fade_seconds",e.currentTarget.valueAsNumber)} /></label>
          <label>地面效果 <select value={warn()?.effect ?? ""} onChange={e=>change("effect",e.currentTarget.value || undefined)}><option value="">只画预警圈</option><For each={props.effects}>{effect=><option value={effect.id}>{effect.title}</option>}</For></select></label>
        </Show>
      </fieldset>
    }}</Index></section></Show>
}
