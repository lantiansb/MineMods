import type { CreatureTierLevel } from "./creature-tier"
import type { ModuleDocument } from "./workspace"

export function defaultWarningPaint(document: ModuleDocument, tier?: CreatureTierLevel): ModuleDocument {
  if (tier !== "boss" && tier !== "epic") return document
  const choose = <T extends {type:string; warn?:{paint?:"dust"|"mesh"}}>(event:T):T =>
    !event.warn || event.warn.paint ? event : {...event,warn:{...event.warn,paint:"mesh"}}
  if (document.kind === "ability") return {...document,hits:document.hits.map(choose)}
  if (document.kind === "entity" && document.abilities) return {...document,abilities:document.abilities.map(a=>({...a,hits:a.hits.map(choose),events:a.events.map(choose)}))}
  return document
}
