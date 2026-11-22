/**
 * What the build list says goes into the mod, as counts: creatures, blocks, items, recipes, gameplay and books. Every count is said, a zero
 * too (broad8 w3): with none, the gameplay count was left off, and testers twice read the missing item as unclear rather than as none.
 * Books are named as well (r28 复验: a book went into the jar and the list did not say so).
 */
export function buildCounts(project: { entities: readonly { model_asset_id: string | null }[]; blocks: readonly unknown[]; items: readonly unknown[]; recipes: readonly unknown[]; workspace: { assets: readonly { document: { kind: string } }[] } }) {
  const books = project.workspace.assets.flatMap((asset) => (asset.document.kind === "book" && "name" in asset.document && typeof asset.document.name === "string" ? [asset.document.name] : []))
  return `${project.entities.filter((entity) => entity.model_asset_id !== null).length} 个生物、${project.blocks.length} 个方块、${project.items.length} 个物品、${project.recipes.length} 个配方、${project.workspace.assets.filter((asset) => asset.document.kind === "gameplay").length} 个玩法、${books.length} 本书${books.length ? `（${books.map((name) => `「${name}」`).join("")}）` : ""}`
}

/**
 * 补字 (E19) in the build list: the characters of the names and books the game's fonts cannot draw, and what a pack made now does with them (the
 * build panel's `glyphs`). Filled ones go in as the mod's own pixel glyphs and are said as going in; the rest stay empty boxes in the game and are
 * said as a warning, with why. Null when there are none.
 */
export function glyphLines(glyphs: { filled: readonly { char: string; family: string }[]; missing: readonly string[]; off: boolean } | undefined) {
  if (!glyphs) return null
  const chars = (list: readonly string[]) => list.map((char) => `「${char}」`).join("")
  const families = [...new Set(glyphs.filled.map((entry) => entry.family))].join("、")
  return {
    filled: glyphs.filled.length ? { text: `补 ${glyphs.filled.length} 个游戏字体里没有的字：${chars(glyphs.filled.map((entry) => entry.char))}`, note: `照这台电脑上的 ${families} 画成像素字，随模组带上` } : null,
    missing: glyphs.missing.length
      ? { text: `${glyphs.missing.length} 个字游戏里会显示成方框：${chars(glyphs.missing)}`, note: glyphs.off ? "「模组信息」里设成了只提醒，不补" : "这台电脑上的开源字体里也没有，补不上" }
      : null,
  }
}
