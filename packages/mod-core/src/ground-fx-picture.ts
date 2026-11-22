import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { MotionClip } from "@minemods/studio-ai/model-motion"
import { abilityHitPlaces, bonePlace, placeTarget } from "./creature-abilities"
import { bossWords } from "./creature-boss"
import { hitCentre } from "./effect-abilities"
import type { ParticleAliases } from "./particle-emission"
import { WARN_COLORS } from "./ability-words"
import type { Ability } from "./entity-runtime"
import { isTerrainEvent, terrainWords, terrainLines, type TerrainEvent } from "./terrain"
import { GROUND_FX_NAMES, groundCircle, groundEventPlace, groundFxCaption, groundFxEvents, groundFxLines, type GroundFxEvent } from "./ground-fx"

/**
 * 第 4 步 as the pictures draw it (the app's look, `studio/src/main/look-job.ts`): every ground hazard, crack, shockwave and beam of an ability, where the pictures put the one it fights
 * (`placeTarget` blocks straight ahead), as lines in the pictures' space with their colours, the moment to draw the creature at and what is said under it. No Node APIs.
 */

type Vec = [number, number, number]
type Marked = Extract<Ability["events"][number],{type:"particle"|"sound"|"shake"|"debris"|"break"}>

export type GroundFxPicture = {
  /** Its place in the ability's events. */
  index: number
  event: GroundFxEvent | TerrainEvent | Marked
  /** The moment of the ability the creature is drawn at (inside its motion). */
  time: number
  label: string
  lines: { points: Vec[]; color: string; dashed?: boolean }[]
  caption: string[]
}

/** The ground effects and beams of an ability as pictures, in the order of its events. `title` names a particle asset by its id. */
export function groundFxPictures(ability: Ability, design: Pick<ModelDesign, "bones" | "animations">, title: ((id: string) => string | null) | null = null, aliases?: ParticleAliases, blockColor?: (id: string) => string | undefined): GroundFxPicture[] {
  const clip = design.animations.find((animation) => animation.name === ability.clip) as MotionClip | undefined
  const length = clip?.length ?? ability.length
  const target = placeTarget(ability)
  const centre = (hit: number) => {
    const found = ability.hits[hit]
    return found ? hitCentre(found) : { forward: 0, up: 0, left: 0 }
  }
  const marked = ability.events.flatMap((event,index): {index:number;event:Marked|TerrainEvent}[] => {
    if (isTerrainEvent(event) || event.type === "break") return [{index,event}]
    if ((event.type === "debris" || event.type === "particle" || event.type === "shake" || event.type === "sound") && event.where === "hit" && event.hit != null) return [{index,event}]
    return []
  })
  return [...groundFxEvents(ability), ...marked].sort((a,b)=>a.index-b.index).map(({ index, event }): GroundFxPicture => {
    if (event.type === "break" || event.type === "particle" || event.type === "debris" || event.type === "shake" || event.type === "sound") {
      const label = {break:"打碎方块",particle:"粒子",debris:"碎块",shake:"震屏",sound:"声音"}[event.type]
      const slot=event.where === "hit" ? event.hit : null
      const points=slot == null ? [] : abilityHitPlaces(ability,slot,target)
      const offset=slot == null ? {forward:0,left:0,up:0} : centre(slot)
      const lines=points.map(p=>({points:groundCircle(p.forward+offset.forward+("forward" in event ? event.forward : 0),p.left+offset.left+("left" in event ? event.left : 0),0.25),color:"#ffb45e"}))
      const caption=event.type==="break" ? [bossWords.breaks(event)] : [`第 ${event.at} 秒在第 ${(slot ?? 0)+1} 次出手的落点触发${label}。`]
      return {index,event,time:Math.min(event.at,length),label,lines,caption}
    }
    if (isTerrainEvent(event)) return { index, event, time: Math.min(event.at + (event.type === "terrain_rise" ? event.rise_seconds : 0.05), length), label: event.type === "terrain_rise" ? "升起地形" : "临时换块", lines: terrainLines(event,groundEventPlace(event,target,centre),blockColor), caption: [terrainWords(event)] }
    if (event.type === "beam") {
      const bone = event.bone !== undefined && clip ? bonePlace(design, event.bone, clip, Math.min(event.at, clip.length)) : null
      const start = { forward: (bone?.forward ?? 0) + event.forward, up: (bone?.up ?? 0) + event.up, left: (bone?.left ?? 0) + event.left }
      const time = Math.min((event.at + event.until) / 2, length)
      return { index, event, time, label: `${GROUND_FX_NAMES.beam} ${num(event.at)}–${num(event.until)} 秒`, lines: groundFxLines(event, start, start, target), caption: groundFxCaption(event, title, aliases) }
    }
    const place = groundEventPlace(event, target, centre)
    const centres = event.where === "hit" && event.hit != null && ability.hits[event.hit] ? abilityHitPlaces(ability,event.hit,target).map(p=>({forward:p.forward+place.forward,left:p.left+place.left,up:p.up+place.up})) : [place]
    if (event.type === "shockwave" && event.warn) {
      const radius = event.from_radius, half = event.width / 2
      const outline = (r: number, p: typeof place) => groundCircle(p.forward,p.left,r)
      const color = "#" + WARN_COLORS[event.warn.color].rgb.map(c => Math.round(c*255).toString(16).padStart(2,"0")).join("")
      const lines = centres.flatMap(p=>[Math.max(0,radius-half),radius+half].filter(r=>r>0).map(r=>({points:outline(r,p),color})))
      return { index, event, time: Math.max(0,event.at-event.warn.seconds), label: "环的起始预警", lines: [...lines,...(event.warn.extent==="max" ? centres.map(p=>({points:outline(event.to_radius+half,p),color,dashed:true})) : [])], caption: groundFxCaption(event,title,aliases) }
    }
    // A shockwave is drawn halfway out; the others as they have spread.
    const time = Math.min(event.at + (event.type === "shockwave" ? event.seconds / 2 : 0.05), length)
    return { index, event, time, label: `${GROUND_FX_NAMES[event.type]} ${num(event.at)} 秒`, lines: centres.flatMap(p=>groundFxLines(event,p)), caption: groundFxCaption(event, title, aliases) }
  })
}

const num = (value: number) => Number(value.toFixed(2)) || 0
