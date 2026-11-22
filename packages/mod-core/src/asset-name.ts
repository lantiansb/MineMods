/**
 * What a saved asset is called as content. An asset's `title` is a working label: the Studio task that made it names it
 * for the person following the work ("巨龙通过版本确认"), and it can differ from the name the content has in the game.
 * Wherever a sentence names a block, an item, a creature, a recipe, a gesture, a gameplay or a place, it is the name
 * the document itself carries; the title is only the fallback for a kind that has no name of its own (a model, an effect).
 * No Node APIs, nothing imported: the guide, the standard and the app's window all read it.
 */
const NAMED_KINDS = ["block", "item", "recipe", "entity", "gesture", "gameplay", "biome", "dimension", "terrain"]

export function contentName(asset: { title: string; document: unknown }): string {
  const document = asset.document as { kind?: unknown; name?: unknown } | null
  return document && typeof document === "object" && typeof document.kind === "string" && NAMED_KINDS.includes(document.kind) && typeof document.name === "string" && document.name.trim() ? document.name : asset.title
}
