import { Fold } from "../fold"
import { Index, Show } from "solid-js"
import type { Ability } from "@minemods/mod-core/entity-runtime"
export function BeamSweepFields(props:{abilities:Ability[];phases:number;edit:(key:string,value:unknown)=>void;disabled:boolean}){
  const rows=()=>props.abilities.flatMap((a,i)=>a.events.flatMap((v,j)=>v.type==="beam" && v.aim==="target"?[{v,key:`abilities.${i}.events.${j}`,name:a.name}]:[]))
  return <Show when={rows().length}><Fold class="ae-section mc-window" summary="光束追踪速度">
    <Index each={rows()}>{r=><fieldset disabled={props.disabled}><legend>{r().name} · 第 {r().v.at} 秒的光束</legend>
      <label>怎么追 <select value={r().v.sweep?"distance":"angle"} onChange={e=>{const {sweep,turn,...rest}=r().v;props.edit(r().key,e.currentTarget.value==="distance"?{...rest,sweep:{blocks_per_second:5}}:{...rest,turn:3})}}><option value="angle">每刻转几度</option><option value="distance">光斑每秒走几格</option></select></label>
      <Show when={r().v.sweep} fallback={<label>每刻转几度 <input type="number" min="0" max="30" value={r().v.turn} onChange={e=>props.edit(r().key+".turn",e.currentTarget.valueAsNumber)}/></label>}>
        <label>每秒几格 <input type="number" min="0.01" max="128" step="0.01" value={r().v.sweep?.blocks_per_second} onChange={e=>props.edit(r().key+".sweep.blocks_per_second",e.currentTarget.valueAsNumber)}/></label>
        <p>玩家走路约 4.3 格每秒，疾跑约 5.6 格每秒。</p>
        <Show when={props.phases>0}><Index each={Array.from({length:props.phases+1})}>{(_,i)=><label>{i===0?"初始阶段":"第 "+i+" 次变身"}倍率 <input type="number" min="0" max="16" step="0.1" value={r().v.sweep?.phase_scales?.[i]??1} onChange={e=>{const scales=Array.from({length:props.phases+1},(_,j)=>r().v.sweep?.phase_scales?.[j]??1);scales[i]=e.currentTarget.valueAsNumber;props.edit(r().key+".sweep.phase_scales",scales)}}/></label>}</Index></Show>
      </Show></fieldset>}</Index>
  </Fold></Show>
}