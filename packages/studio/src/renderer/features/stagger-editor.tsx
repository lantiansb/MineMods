import { Index, Show } from "solid-js"
import { fixtureConditionWords, type Stagger } from "@minemods/mod-core/combat"
import { impactFxWords } from "@minemods/mod-core/impact-fx"

type Kind = Extract<Stagger, unknown[]>[number] | Exclude<Stagger, unknown[]>
const fresh = () => ({ seconds: 2, damage_scale: 1.5, on_interrupt: true })

export function StaggerEditor(props: { value: unknown; disabled: boolean; edit: (value: unknown) => void }) {
  const value = () => props.value as Stagger | undefined
  const rows = (): Kind[] => { const v = value(); return !v ? [] : Array.isArray(v) ? v : [v] }
  const update = (i: number, patch: Partial<Kind>) => {
    const next = rows().map((row, index) => index === i ? { ...row, ...patch } : row)
    props.edit(Array.isArray(value()) ? next : next[0])
  }
  const editCondition = (i: number, j: number, change: (c: NonNullable<Kind["when"]>[number]) => NonNullable<Kind["when"]>[number]) => {
    update(i,{when:rows()[i]?.when?.map((c,n)=>n===j ? change(c) : c)})
  }
  const add = () => {
    if (!rows().length) return props.edit(fresh())
    const ids = new Set(rows().map(row => row.id))
    const next = Array.from({ length: 10 }, (_,i) => "stagger_" + (i+1)).find(id => !ids.has(id))!
    props.edit([...rows().map(row => ({...row, id:row.id ?? "default"})), {seconds:2,damage_scale:1,id:next,at_health:[0.5]}])
  }
  return <fieldset disabled={props.disabled}>
    <Index each={rows()}>{(row,i) => <fieldset>
      <legend>{row().id ?? "默认硬直"}</legend>
      <Show when={Array.isArray(value()) || row().id}><label>硬直名 <input value={row().id ?? ""} onChange={e=>update(i,{id:e.currentTarget.value})}/></label></Show>
      <label>持续秒数 <input type="number" min="0.5" max="10" step="0.05" value={row().seconds} onChange={e=>update(i,{seconds:e.currentTarget.valueAsNumber})}/></label>
      <label>受伤倍率 <input type="number" min="1" max="4" step="0.05" value={row().damage_scale} onChange={e=>update(i,{damage_scale:e.currentTarget.valueAsNumber})}/></label>
      <label>结束后歇几秒 <input type="number" min="0" max="3600" step="0.05" value={row().cooldown ?? ""} placeholder="不额外等待" onChange={e=>update(i,{cooldown:e.currentTarget.value === "" ? undefined : e.currentTarget.valueAsNumber})}/></label>
      <label>每场最多几次 <input type="number" min="1" max="65535" value={row().max_times ?? ""} placeholder="不限次数" onChange={e=>update(i,{max_times:e.currentTarget.value === "" ? undefined : e.currentTarget.valueAsNumber})}/></label>
      <label>硬直时吃几成击退 <input type="number" min="0" max="10" step="0.5" value={row().knockback_scale === undefined ? "" : row().knockback_scale! * 10} placeholder="沿用平时" onChange={e=>update(i,{knockback_scale:e.currentTarget.value === "" ? undefined : e.currentTarget.valueAsNumber / 10})}/></label>
      <label>硬直动作 <input value={row().clip ?? ""} placeholder="留空或填写模型的动作名" onChange={e=>update(i,{clip:e.currentTarget.value || null})}/>
        <small>没有专门的硬直动作时，可填 hurt 使用模型的受击动作。</small>
      </label>
      <label><input type="checkbox" checked={row().on_interrupt ?? false} onChange={e=>update(i,{on_interrupt:e.currentTarget.checked})}/>招式被打断时触发</label>
      <Show when={row().enter}>{enter => <p>进入时{impactFxWords(enter())}。声音可以在「它的声音」里换；粒子和晃屏原样保留，可让 AI 修改。<button type="button" onClick={()=>update(i,{enter:undefined})}>去掉进入时的声光</button></p>}</Show>
      <Show when={!row().when} fallback={<Index each={row().when}>{(condition,j)=>{
        const lights = () => {const rule=condition(); return rule.if==="fixtures_lit" ? rule : undefined}
        return <Show when={lights()} fallback={<fieldset><legend>{condition().if==="health_point" ? "血量点" : "累计来击"}</legend>
        <Show when={condition().if==="health_point"} fallback={<>
          <label>累计阈值 <input type="number" step="any" value={Object.values((condition() as Extract<NonNullable<Kind["when"]>[number],{if:"damage_taken"}>).amount)[0]} onChange={e=>editCondition(i,j,c=>c.if==="damage_taken" ? {...c,amount:"points" in c.amount ? {points:e.currentTarget.valueAsNumber} : {share:e.currentTarget.valueAsNumber}} : c)}/></label>
          <label>累计清零秒数 <input type="number" value={(condition() as {reset_seconds:number}).reset_seconds} onChange={e=>editCondition(i,j,c=>c.if==="damage_taken" ? {...c,reset_seconds:e.currentTarget.valueAsNumber} : c)}/></label>
          <label>硬直后免疫秒数 <input type="number" value={(condition() as {immune_seconds:number}).immune_seconds} onChange={e=>editCondition(i,j,c=>c.if==="damage_taken" ? {...c,immune_seconds:e.currentTarget.valueAsNumber} : c)}/></label>
        </>}><label>满血比例 <input type="number" step="0.01" value={(condition() as {share:number}).share} onChange={e=>editCondition(i,j,c=>c.if==="health_point" ? {...c,share:e.currentTarget.valueAsNumber} : c)}/></label></Show>
      </fieldset>}>{rule => <p>{fixtureConditionWords(rule())}时触发硬直。此条件原样保留，可让 AI 修改。</p>}</Show>
      }}</Index>}>
        <label>血量点（比例，从高到低，用逗号分隔） <input value={row().at_health?.join(", ") ?? ""} onChange={e=>update(i,{at_health:e.currentTarget.value.trim() ? e.currentTarget.value.split(/[,，]/).map(Number) : undefined})}/></label>
        <label><input type="checkbox" checked={Boolean(row().poise)} onChange={e=>update(i,{poise:e.currentTarget.checked ? {amount:{points:12},reset_seconds:4,immune_seconds:2} : undefined})}/>累计来击破防</label>
        <Show when={row().poise}>{poise => <>
          <label>按什么累计 <select value={"points" in poise().amount ? "points" : "share"} onChange={e=>update(i,{poise:{...poise(),amount:e.currentTarget.value === "points" ? {points:12} : {share:0.2}}})}><option value="points">伤害点数</option><option value="share">满血比例</option></select></label>
          <label>累计阈值 <input type="number" step="any" value={Object.values(poise().amount)[0]} onChange={e=>update(i,{poise:{...poise(),amount:"points" in poise().amount ? {points:e.currentTarget.valueAsNumber} : {share:e.currentTarget.valueAsNumber}}})}/></label>
          <label>未挨打多久清零（秒） <input type="number" min="1" max="30" value={poise().reset_seconds} onChange={e=>update(i,{poise:{...poise(),reset_seconds:e.currentTarget.valueAsNumber}})}/></label>
          <label>硬直后多久免疫（秒） <input type="number" min="0" max="60" value={poise().immune_seconds} onChange={e=>update(i,{poise:{...poise(),immune_seconds:e.currentTarget.valueAsNumber}})}/></label>
        </>}</Show>
      </Show>
      <button type="button" onClick={()=>props.edit(rows().length === 1 ? undefined : rows().filter((_,n)=>n!==i))}>移除这项硬直</button>
    </fieldset>}</Index>
    <button type="button" disabled={rows().length >= 8} onClick={add}>添加硬直</button>
  </fieldset>
}
