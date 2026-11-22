import { Fold } from "../fold"
import { Index, Show } from "solid-js"
import type { Project } from "@minemods/mod-core/project"

type Creature = Project["entities"][number]
type Row = {label:string; path:string; range?:number; volumePath:string; volume?:number}
export function SoundRangeFields(props:{creature:Creature;edit:(path:string,value:unknown)=>void;disabled:boolean}) {
  const rows=()=>{
    const e=props.creature
    const list:Row[]=[]
    for (const [key,label] of [["ambient","平时"],["hurt","受伤"],["death","死亡"],["step","走路"]] as const) {
      if(e.sounds?.[key]) list.push({label,path:"sounds.ranges."+key,range:e.sounds.ranges?.[key],volumePath:"sounds.volume",volume:e.sounds.volume})
    }
    function add(label:string,path:string,sound:{range_blocks?:number;volume?:number}) {
      list.push({label,path:path+".range_blocks",range:sound.range_blocks,volumePath:path+".volume",volume:sound.volume})
    }
    e.abilities?.forEach((a,i)=>a.events.forEach((v,j)=>{if(v.type==="sound")add(`${a.name} · 第 ${v.at} 秒`,`abilities.${i}.events.${j}`,v)}))
    if(e.boss?.intro?.sound)add("登场吼声","boss.intro",e.boss.intro)
    e.boss?.phases.forEach((p,i)=>{if(p.sound)add("第 "+(i+1)+" 次变身",`boss.phases.${i}`,p)})
    for(const key of ["intro","death"] as const)e.boss?.[key]?.steps?.forEach((s,i)=>{if(s.type==="sound")add((key==="intro"?"登场":"死亡")+"演出第 "+s.at+" 秒",`boss.${key}.steps.${i}`,s)})
    return list
  }
  return <Show when={rows().length}><Fold class="ae-section mc-window" summary="每一声的响度和距离"><p>距离可填 8 到 128 格。留空时沿用原来的传播距离。平时、受伤、死亡、走路共用一个音量。</p>
    <Index each={rows()}>{r=><fieldset disabled={props.disabled}><legend>{r().label}</legend>
      <label>可闻距离（格）<input type="number" min="8" max="128" step="1" value={r().range ?? ""} onChange={e=>props.edit(r().path,e.currentTarget.value===""?undefined:e.currentTarget.valueAsNumber)} /></label>
      <label>音量<input type="number" min="0.2" max="4" step="0.1" value={r().volume ?? ""} onChange={e=>{
        const v=e.currentTarget.valueAsNumber
        if(Number.isFinite(v))props.edit(r().volumePath,v)
      }} /></label></fieldset>}</Index>
  </Fold></Show>
}
