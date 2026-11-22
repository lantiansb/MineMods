export type RecipeItem = { id: string; name: string }

const namespacedId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/

export function resolveRecipeItem(value: string, items: RecipeItem[]) {
  const input = value.trim()
  if (!input) return { value: null as string | null }
  if (namespacedId.test(input)) return { value: input }
  const matches = items.filter(item => item.name === input)
  if (matches.length === 1) return { value: matches[0]!.id }
  if (matches.length > 1) return { error: `“${input}”有多个来源，请填写完整 ID（如 namespace:item）。` }
  return { error: `找不到“${input}”，请选择已有名称或填写物品 ID（如 minecraft:stone）。` }
}
