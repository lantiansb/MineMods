import { For, Show } from "solid-js"
import { BUILTIN_LABELS } from "@minemods/mod-core/builtin-names"
import { ABILITY_PARTICLES, ABILITY_SOUNDS } from "@minemods/mod-core/ability-words"
import type { Builtin } from "@minemods/mod-core/builtin"
import type { Project } from "@minemods/mod-core/project"
import { particleLabel, type ParticleAliases } from "@minemods/mod-core/particle-emission"
import { thingName } from "../words"

export function BuiltinEditor(props:{value:unknown; project:Project; aliases?:ParticleAliases; advanced:boolean; disabled:boolean; edit:(value:Builtin|undefined)=>void}) {
  const title = (id: string) => thingName(props.project.workspace.assets.find(asset => asset.id === id)) ?? null
  const named = (name: string, id: string) => props.advanced && name !== id ? name + "（" + id + "）" : name
  const aliases = () => Object.keys(props.aliases ?? {})
  const aliasName = (alias: string, index: number) => /[一-龥]/.test(alias) ? alias : particleLabel({ alias }, { aliases: props.aliases, title, displayNames: true }) + " · " + (index + 1)
  const table = () => (props.value ?? {}) as Record<string, Record<string,string|{asset:string}|{alias:string}>>
  const value = (key:string, kind:string) => {
    const effect = table()[key]?.effect
    if (kind === "particle" && typeof effect === "string") return "effect/"+effect
    const ref = table()[key]?.[kind]
    return !ref ? "" : typeof ref === "string" ? ref : "asset" in ref ? "asset/"+ref.asset : "alias/"+ref.alias
  }
  const select = (key:string, kind:string, choice:string) => {
    const next = {...table()}, row = {...next[key]}
    if (kind === "particle") delete row.effect
    if (choice.startsWith("effect/")) { delete row.particle; row.effect = choice.slice(7) }
    else if (choice) row[kind] = choice.startsWith("asset/") ? {asset:choice.slice(6)} : choice.startsWith("alias/") ? {alias:choice.slice(6)} : choice
    else delete row[kind]
    if (Object.keys(row).length) next[key] = row
    else delete next[key]
    props.edit(Object.keys(next).length ? next as Builtin : undefined)
  }
  const supports = (key:string, kind:string) => kind === "sound" ? !["fog_edge","terrain_shatter","death_poof","fixture_lit","fixture_ember"].includes(key) : !["arena_light","fog_lift","summon_success","summon_blocked"].includes(key)
  return <For each={Object.entries(BUILTIN_LABELS)}>{([key,label])=><fieldset><legend>{label}</legend>
    <For each={["particle","sound"] as const}>{kind=><Show when={supports(key,kind)}>
      <label>{kind === "particle" ? "粒子" : "声音"}<select aria-label={label+(kind === "particle" ? "的粒子" : "的声音")} disabled={props.disabled} onChange={e=>select(key,kind,e.currentTarget.value)}>
        <option selected={!value(key,kind)} value="">使用自带表现</option>
        <option selected={value(key,kind)==="none"} value="none">{kind==="sound"?"不响":"不发粒子"}</option>
        <optgroup label="工程素材"><For each={props.project.workspace.assets.filter(a=>a.document.kind === kind)}>{a=><option selected={value(key,kind) === "asset/"+a.id} value={"asset/"+a.id}>{named(thingName(a), a.id)}</option>}</For></optgroup>
        <Show when={kind === "particle" && (key === "fixture_lit" || key === "fixture_ember")}><optgroup label="工程效果"><For each={props.project.workspace.assets.filter(a=>a.document.kind === "effect")}>{a=><option selected={value(key,kind) === "effect/"+a.id} value={"effect/"+a.id}>{named(thingName(a), a.id)}</option>}</For></optgroup></Show>
        <Show when={kind === "particle" && aliases().length}><optgroup label="粒子别名"><For each={aliases()}>{(a, index)=><option selected={value(key,kind) === "alias/"+a} value={"alias/"+a}>{named(aliasName(a, index()), a)}</option>}</For></optgroup></Show>
        <optgroup label="原版"><For each={Object.entries(kind === "particle" ? ABILITY_PARTICLES : ABILITY_SOUNDS)}>{([id,name])=><option selected={value(key,kind) === id} value={id}>{named(name, id)}</option>}</For></optgroup>
      </select></label>
    </Show>}</For></fieldset>}</For>
}
