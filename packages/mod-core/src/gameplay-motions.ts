import type { Project } from "./project"
import { contentName } from "./asset-name"
import { GAMEPLAY_API, type GameplayDocument } from "./gameplay"
import { creatureNameOf } from "./registry-name"
import { argumentText, callArgumentSpans, stripJava } from "./gameplay-scan"

/**
 * broad2: gameplay code may start a motion itself. This reads what the project's gameplay sources say, never guesses:
 * - a clip whose full name is written (`"animation.<creature>.<clip>"`, see fabric/entity.ts) is played, if the creature is this one;
 * - a motion name written out (a string, or a constant of the same file) in the name place of a play call is played, by the creature the code is about:
 *   the accessor's own `ProjectContent.playMotion(mob, "eat")`, or GeckoLib's (`triggerAnim("ctrl", "eat")`, `triggerableAnim("eat", …)`, `thenPlay("eat")`);
 * - a name that is not written out there (a variable, a sum of strings) may be any motion: `dynamic` says that gameplay code which is
 *   about this creature (or about no creature in particular) may play motions this reading cannot name.
 */
const PLAY_CALLS = new RegExp(
  `(?<![\\w])(triggerAnim|triggerableAnim|thenPlay|thenLoop|thenPlayAndHold|${GAMEPLAY_API.motionMethod})\\s*\\(`,
  "g",
)
/** Which argument of a play call names the motion: the first, or (the call also names a controller or a creature first) the last. */
const FIRST_ARGUMENT = new Set(["triggerableAnim", "thenPlay", "thenLoop", "thenPlayAndHold"])

type Held = Partial<Pick<Project, "entities" | "workspace">>
/** Every id by which gameplay code or its `uses` can point at a creature: the creature itself and the asset that wears its model. */
const idsOf = (project: Held, id: string) => [
  id,
  ...(project.workspace?.assets ?? []).flatMap((asset) =>
    asset.document.kind === "entity" && asset.document.model_asset_id === id ? [asset.id] : [],
  ),
]
/** True when a gameplay's `uses` or its code points at the creature, by any of its ids. */
const pointsAt = (project: Held, document: Pick<GameplayDocument, "sources" | "uses">, id: string) =>
  idsOf(project, id).some(
    (value) => document.uses?.includes(value) || document.sources.some((file) => file.content.includes(value)),
  )
/** The gameplay of the project that points at a creature (`pointsAt`): the ones whose code can show what the creature's model has. */
export const gameplaysAbout = (project: Held, entityId: string) =>
  (project.workspace?.assets ?? []).flatMap((asset) =>
    asset.document.kind === "gameplay" &&
    pointsAt(project, asset.document as unknown as Pick<GameplayDocument, "sources" | "uses">, entityId)
      ? [{ id: asset.id, name: contentName(asset) }]
      : [],
  )

export const codedMotions = (project: Held, entityId: string) => {
  const creature = creatureNameOf({ entities: project.entities ?? [] }, entityId)
  const assets = project.workspace?.assets ?? []
  const named: string[] = []
  // The same names, with the gameplay whose code writes each of them out.
  const players: { clip: string; gameplay: string }[] = []
  let dynamic = false
  for (const asset of assets) {
    if (asset.document.kind !== "gameplay") continue
    const document = asset.document as unknown as Pick<GameplayDocument, "sources" | "uses">
    const points = (id: string) => pointsAt(project, document, id)
    // A bare motion name, or one that is not written out, is this creature's only if the code is about it, or about no creature in particular.
    const mine = points(entityId) || !(project.entities ?? []).some((other) => points(other.id))
    for (const file of document.sources) {
      const before = named.length
      named.push(
        ...[...file.content.matchAll(/"animation\.([A-Za-z0-9_]+)\.([A-Za-z0-9_.]+)"/g)].flatMap((found) =>
          found[1] === creature ? [found[2]!] : [],
        ),
      )
      players.push(...named.slice(before).map((clip) => ({ clip, gameplay: contentName(asset) })))
      if (!mine) continue
      const scanned = stripJava(file.content)
      for (const call of scanned.code.matchAll(PLAY_CALLS)) {
        const args = callArgumentSpans(scanned.code, call.index + call[0].length - 1)
        const span = FIRST_ARGUMENT.has(call[1]!) ? args[0]! : args.at(-1)!
        if (scanned.code.slice(span.start, span.end).trim() === "") continue
        const literal = argumentText(scanned, span)
        const full = literal === undefined ? null : /^animation\.([A-Za-z0-9_]+)\.([A-Za-z0-9_.]+)$/.exec(literal)
        if (literal === undefined) dynamic = true
        else if (!full) {
          named.push(literal)
          players.push({ clip: literal, gameplay: contentName(asset) })
        }
      }
    }
  }
  return { named, dynamic, players }
}

/** The gameplays whose code writes out the motion it plays on this creature, as `{ name: the gameplay's title, clip, by: "gameplay" }`: what a page names the motion by when nothing better is known (`motionWords`). Never guessed: a motion whose name the code does not write out has none. */
export const gameplayPlays = (project: Held, entityId: string) =>
  codedMotions(project, entityId).players.map((play) => ({
    name: play.gameplay,
    clip: play.clip,
    by: "gameplay" as const,
  }))

/** True when the project's gameplay code plays a motion of this creature by a name the reconciliation cannot read: any of its motions may be played there. */
export const mayBePlayedByGameplay = (project: Partial<Pick<Project, "entities" | "workspace">>, entityId: string) =>
  codedMotions(project, entityId).dynamic
