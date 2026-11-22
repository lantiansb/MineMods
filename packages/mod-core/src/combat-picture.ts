import { fixtureWords } from "./fixture-events"
import type { Ability, Stances } from "./entity-runtime"
import { combatBreaks, staggerConditions, staggerList, type Stagger } from "./combat"
import { encodePng } from "./png"

export function combatStrips(abilities: readonly Ability[], stagger?: Stagger, builtin?: import("./builtin").Builtin, stances?: Stances) {
  const strip = (lanes: { from: number; to: number; color: readonly number[] }[], length: number) => {
    const width = 384, height = lanes.length * 18 + 8
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const lane = lanes[Math.floor((y - 4) / 18)]
      const pos = x / (width - 1) * length
      const color = lane && (y-4)%18 < 12 && pos >= lane.from && pos < lane.to ? lane.color : x % 48 === 0 ? [72,82,98] : [28,34,43]
      pixels.set([color[0]!,color[1]!,color[2]!,255], (y*width+x)*4)
    }
    return encodePng(pixels,width,height)
  }
  const title = (id: string) => stances?.list.find(row => row.id === id)?.name ?? id
  const timelines = abilities.flatMap(move => {
    const bands = [...move.events.flatMap(event => event.type === "fixture" ? [{from:event.at,to:event.at+Math.max(0.04,move.length/80),color:event.do==="light" ? [255,213,91] : event.do==="ember" ? [220,113,52] : [130,148,159],name:fixtureWords(event,builtin)}] : event.type === "stance" ? [{ from: Math.min(event.at, move.length - 0.025), to: event.at + Math.max(0.04, move.length / 80), color: [172, 126, 230], name: `切到「${title(event.to)}」姿态` }] : []), ...(move.interrupt ? [{from: move.interrupt.from ?? 0, to: move.interrupt.to ?? move.length, color:[245,175,72], name:"可打断"}] : []),
      ...combatBreaks(move, stagger).flatMap(row => row.windows.map(window => ({...window, color:[245,175,72], name:row.text}))),
      ...(move.openings ?? []).map(w => ({...w, color:[77,191,185], name:(w.part ?? "全身")+"破绽 "+w.damage_scale+"×"}))]
    return bands.length ? [{label:`${move.name}  0–${move.length} 秒，自上而下：${bands.map(b=>b.name+" "+b.from+"–"+b.to+" 秒").join("，")}`, png:strip(bands,move.length)}] : []
  })
  const health = staggerList(stagger).flatMap(row => staggerConditions(row).flatMap(condition => condition.if === "health_point" ? [{from:1-condition.share,to:1-condition.share+0.012,color:[234,104,117],label:(row.id ?? "硬直")+" "+Math.round(condition.share*100)+"%"}] : []))
  if (health.length) timelines.push({label:"血量从满到空，自上而下："+health.map(v=>v.label).join("，"), png:strip(health,1)})
  return timelines
}
