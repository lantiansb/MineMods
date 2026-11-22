/** Earliest game tick at which the server has a final placement, including following warnings that freeze before impact. */
export function landingTick(hit: {at:number;warn?:{seconds:number;follow?:string;lock_before?:number}}) {
  const at=Math.round(hit.at*20)
  if(!hit.warn)return at
  return at-Math.round(20*(hit.warn.follow ? hit.warn.lock_before ?? 0 : hit.warn.seconds))
}
export const earlyLanding = (slot:number,tick:number) => `第 ${slot} 次出手的实际落点还没有定下，引用它的事件最早能放在第 ${tick/20} 秒。`
