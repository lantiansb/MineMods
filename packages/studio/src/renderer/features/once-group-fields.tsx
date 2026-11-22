import { Fold } from "../fold"
import { Index, Show } from "solid-js"
import type { Ability } from "@minemods/mod-core/entity-runtime"
export function OnceGroupFields(props: { abilities: Ability[]; disabled: boolean; edit: (key:string,value:unknown)=>void }) {
  const rows = () => props.abilities.flatMap((a,i) => [
    ...a.hits.flatMap((h,j)=>h.type==="area" || h.type==="projectile" || h.type==="shot" ? [{member:h,path:`abilities.${i}.hits.${j}`,label:`${a.name} · 第 ${j+1} 次出手`}] : []),
    ...a.events.flatMap((e,j)=>e.type==="hazard" || e.type==="shockwave" ? [{member:e,path:`abilities.${i}.events.${j}`,label:`${a.name} · 第 ${e.at} 秒的${e.type==="hazard"?"危险区":"环"}`}] : []),
  ])
  return <Show when={rows().length}><Fold class="ae-section mc-window" summary="同一招每人只挨一次">
    <p>需要共用命中记录的出手填同一个组名。每个目标单独计数。</p>
    <Index each={rows()}>{row=><fieldset disabled={props.disabled}><legend>{row().label}</legend>
      <label>组名 <input value={row().member.once_group ?? ""} onChange={e=>{
        const {once_group,once_skip_effects,once_across_steps,...rest}=row().member
        const name=e.currentTarget.value.trim()
        props.edit(row().path,name ? {...row().member,once_group:name} : rest)
      }} /></label>
      <Show when={row().member.once_group}><label><input type="checkbox" checked={row().member.once_skip_effects !== false} onChange={e=>props.edit(row().path+".once_skip_effects",e.currentTarget.checked)} />重复命中时也跳过击退和状态</label>
      <label><input type="checkbox" checked={!!row().member.once_across_steps} onChange={e=>props.edit(row().path+".once_across_steps",e.currentTarget.checked || undefined)} />共用整套连招的记录</label></Show>
    </fieldset>}</Index>
  </Fold></Show>
}
