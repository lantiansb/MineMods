// Older build receipts and the external AI share these sentences. Translate only the fixed
// ending of a known build failure so an asset title keeps exactly what its creator wrote.
const receiptEndings = [
  ["的技能用到一个特效，它已经不在工程里了，所以没有打包。打开它，换一个特效或者去掉那个技能，再打包。",
   "的招式用到一个效果，它已经不在工程里了，所以没有打包。打开这个生物，换一个效果或者去掉那一招，再打包。"],
  ["的技能用到一个自己做的粒子，它已经不在工程里了，所以没有打包。打开它，换一个粒子或者去掉那个技能，再打包。",
   "的招式用到一个自己做的粒子，它已经不在工程里了，所以没有打包。打开这个生物，换一个粒子或者去掉那一招，再打包。"],
  ["的巢穴地面用的方块，在这个模组里已经找不到了（可能被删掉了），所以没有打包。打开它，改掉或者去掉那一项，再打包。",
   "的巢用到一个已经找不到的地面方块，所以没有打包。打开这个生物，换一个方块或者去掉那一项，再打包。"],
] as const

export function buildFailureWords(text: string) {
  for (const [original, display] of receiptEndings) {
    if (!text.endsWith(original)) continue
    const name = text.slice(0, -original.length)
    if (name === "有一个生物" || (name.startsWith("「") && name.endsWith("」"))) return name + display
  }
  return text
}
