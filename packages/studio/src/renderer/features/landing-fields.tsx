import { fixtureCanCheckWalls } from "@minemods/mod-core/fixture-events"
import { Fold } from "../fold"
import { For, Show } from "solid-js"
import type { Ability } from "@minemods/mod-core/entity-runtime"

export function LandingFields(props:{abilities:Ability[]; disabled:boolean; edit:(key:string,value:unknown)=>void}) {
  const rows = () => props.abilities.flatMap((a,i)=>a.events.flatMap((event,j)=>{
    if (!["effect","debris","break","hazard","crack","shockwave","particle","sound","shake"].includes(event.type)) return []
    return [{event, path:`abilities.${i}.events.${j}`, ability:a}]
  }))
  const leaps = () => props.abilities.flatMap((a,i)=>a.moves.flatMap((m,j)=> "type" in m && m.type === "leap" ? [{a,m,path:`abilities.${i}.moves.${j}`}] : []))
  const forces = () => props.abilities.flatMap((a,i)=>a.hits.flatMap((hit,j)=>
    hit.type === "area" && hit.force && hit.force.kind !== "side" && (hit.shape.type === "sphere" || hit.shape.type === "box")
      ? [{name:a.name,index:j,force:hit.force,path:`abilities.${i}.hits.${j}.force.toward`}] : []))
  const fixtures = () => props.abilities.flatMap((a,i)=>a.events.flatMap((event,j)=>{
    if (event.type !== "fixture" || typeof event.which !== "object" || !("in_hit" in event.which)) return []
    const index = event.which.in_hit, hit = a.hits[index]
    return [{a,event,index,wallChoice:fixtureCanCheckWalls(hit),
      fixtureWalls:hit?.type==="area" && hit.fixture_walls,
      hitPath:`abilities.${i}.hits.${index}`,path:`abilities.${i}.events.${j}.which.in_hit`}]
  }))
  return <Show when={rows().length || leaps().length || forces().length || fixtures().length}><Fold class="ae-section mc-window" summary="跟随哪次出手的落点">
    <For each={fixtures()}>{row=><fieldset disabled={props.disabled}><legend>{row.a.name}</legend><label>哪次出手选中物件（默认方块不挡）
      <select disabled={props.disabled} value={row.index} onChange={e=>props.edit(row.path,Number(e.currentTarget.value))}>
        <For each={row.a.hits.flatMap((hit,i)=>hit.type==="area" && hit.at<=row.event.at ? [i] : [])}>{i=><option value={i}>第 {i+1} 次出手</option>}</For>
      </select></label>
      <Show when={row.wallChoice}>
        <label><input type="checkbox" checked={!!row.fixtureWalls} onChange={e=>props.edit(row.hitPath+".fixture_walls",e.currentTarget.checked || undefined)}/>这次出手也让方块挡住物件</label>
      </Show></fieldset>}</For>
    <For each={forces()}>{row=><label>{row.name} · 第 {row.index+1} 次出手的推拉中心
      <select disabled={props.disabled} value={row.force.toward ?? "shape"} onChange={e=>props.edit(row.path,e.currentTarget.value === "origin" ? "origin" : undefined)}>
        <option value="shape">球心或盒子中心</option><option value="origin">这次出手的原点</option>
      </select></label>}</For>
    <For each={leaps()}>{row=><fieldset disabled={props.disabled}><legend>{row.a.name} · 跳扑落点</legend>
      <label><input type="checkbox" checked={!!row.m.lock_at} onChange={e=>props.edit(row.path+".lock_at",e.currentTarget.checked?"cast_start":undefined)}/>蓄力开始就定下落点</label>
      <label>落地出手<select value={row.m.landing_hit ?? ""} onChange={e=>props.edit(row.path+".landing_hit",e.currentTarget.value===""?undefined:Number(e.currentTarget.value))}>
      <option value="">按招式各自的位置</option><For each={row.a.hits.map((h,i)=>({h,i})).filter(v=>v.h.type==="area" && v.h.place==="target" && Math.round(v.h.at*20)===Math.round(row.m.land*20))}>{v=><option value={v.i}>第 {v.i+1} 次出手</option>}</For></select></label>
    </fieldset>}</For>
    <For each={rows()}>{row=><label>{row.ability.name} · {row.event.at} 秒 · {row.event.type}
      <select disabled={props.disabled} value={"where" in row.event && row.event.where === "hit" && "hit" in row.event ? String(row.event.hit) : "where" in row.event && row.event.where === "target" ? "target" : "self"}
        onChange={e=>{
          const selected=e.currentTarget.value
          const hit=Number(selected)
          const optional=["particle","sound","shake"].includes(row.event.type)
          props.edit(row.path,{...row.event,where:Number.isInteger(hit)?"hit":selected,hit:Number.isInteger(hit)?hit:optional?undefined:null})
        }}>
        <option value="self">自身</option><option value="target">当前目标</option>
        <For each={row.ability.hits.map((hit,i)=>({hit,i})).filter(v=>v.hit.type==="area")}>{v=><option value={v.i}>第 {v.i+1} 次出手 · {v.hit.at} 秒</option>}</For>
      </select></label>}</For>
  </Fold></Show>
}
