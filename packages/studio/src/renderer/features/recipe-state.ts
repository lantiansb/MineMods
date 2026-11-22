export type RecipeDraft = {
  id?: string
  name: string
  pattern: (string | null)[]
  result: string
  count: number
}

export type Stack = { id: string; count: number }
export type RecipeState = { stencil: (string | null)[]; inventory: (Stack | null)[]; cursor: Stack | null }
export type SlotArea = "inventory" | "stencil"

const MAX_STACK = 64
const emptyInventory = () => Array<Stack | null>(36).fill(null)
const clean = (stack: Stack | null) => (stack && stack.count > 0 ? stack : null)

export function initialRecipeState(draft?: Partial<RecipeDraft>): RecipeState {
  return {
    stencil: Array.from({ length: 9 }, (_, index) => draft?.pattern?.[index] ?? null),
    inventory: emptyInventory(),
    cursor: null,
  }
}

function slot(state: RecipeState, area: SlotArea, index: number) {
  if (area === "stencil") return state.stencil[index] ? { id: state.stencil[index]!, count: 1 } : null
  return state.inventory[index] ?? null
}

function put(state: RecipeState, area: SlotArea, index: number, value: Stack | null) {
  if (area === "stencil") state.stencil[index] = value?.id ?? null
  else state.inventory[index] = clean(value)
}

export function leftClick(state: RecipeState, area: SlotArea, index: number): RecipeState {
  const next = structuredClone(state)
  const target = slot(next, area, index)
  if (!next.cursor && target) {
    next.cursor = target
    put(next, area, index, null)
    return next
  }
  if (!next.cursor) return next
  if (!target) {
    put(next, area, index, next.cursor)
    next.cursor = null
    return next
  }
  if (target.id === next.cursor.id) {
    const amount = Math.min(MAX_STACK - target.count, next.cursor.count)
    put(next, area, index, { id: target.id, count: target.count + amount })
    next.cursor = clean({ id: next.cursor.id, count: next.cursor.count - amount })
    return next
  }
  put(next, area, index, next.cursor)
  next.cursor = target
  return next
}

export function rightClick(state: RecipeState, area: SlotArea, index: number): RecipeState {
  const next = structuredClone(state)
  const target = slot(next, area, index)
  if (!next.cursor && target) {
    const amount = Math.floor(target.count / 2)
    next.cursor = { id: target.id, count: target.count - amount }
    put(next, area, index, { id: target.id, count: amount })
    return next
  }
  if (!next.cursor) return next
  if (target && target.id !== next.cursor.id) return next
  if (target && target.count >= MAX_STACK) return next
  put(next, area, index, { id: next.cursor.id, count: (target?.count ?? 0) + 1 })
  next.cursor = clean({ id: next.cursor.id, count: next.cursor.count - 1 })
  return next
}

export function dragOneEach(state: RecipeState, area: SlotArea, indices: number[]): RecipeState {
  return [...new Set(indices)].reduce((current, index) => current.cursor ? rightClick(current, area, index) : current, state)
}

export function dragEven(state: RecipeState, area: SlotArea, indices: number[]): RecipeState {
  const next = structuredClone(state)
  if (!next.cursor || indices.length === 0) return next
  const valid = [...new Set(indices)].filter((index) => {
    const target = slot(next, area, index)
    return !target || target.id === next.cursor?.id
  })
  const each = Math.floor(next.cursor.count / valid.length)
  valid.forEach((index) => {
    if (!next.cursor) return
    const target = slot(next, area, index)
    const amount = each
    const room = MAX_STACK - (target?.count ?? 0)
    const placed = Math.min(amount, room)
    put(next, area, index, { id: next.cursor!.id, count: (target?.count ?? 0) + placed })
    next.cursor = clean({ id: next.cursor!.id, count: next.cursor!.count - placed })
  })
  return next
}

export function shiftTransfer(state: RecipeState, area: SlotArea, index: number): RecipeState {
  if (area !== "inventory") return state
  const next = structuredClone(state)
  const source = next.inventory[index]
  if (!source) return next
  const start = index < 27 ? 27 : 0
  const end = index < 27 ? 36 : 27
  next.inventory.forEach((value, position) => {
    if (position < start || position >= end || value?.id !== source.id || value.count >= MAX_STACK || source.count <= 0) return
    const amount = Math.min(MAX_STACK - value.count, source.count)
    value.count += amount
    source.count -= amount
  })
  const empty = next.inventory.findIndex((value, position) => position >= start && position < end && !value)
  if (source.count > 0 && empty >= 0) {
    next.inventory[empty] = source
    next.inventory[index] = null
    return next
  }
  next.inventory[index] = clean(source)
  return next
}

export function hotbarSwap(state: RecipeState, number: number, sourceIndex = 0) {
  const next = structuredClone(state)
  const index = Math.max(0, Math.min(8, number - 1)) + 27
  ;[next.inventory[sourceIndex], next.inventory[index]] = [next.inventory[index], next.inventory[sourceIndex]]
  return next
}

export function collectMatching(state: RecipeState, area: SlotArea, index: number): RecipeState {
  const next = structuredClone(state)
  if (area !== "inventory") return next
  const source = next.inventory[index]
  const id = next.cursor?.id ?? source?.id
  if (!id) return next
  next.cursor ??= { id, count: 0 }
  next.inventory = next.inventory.map((stack) => {
    if (!stack || stack.id !== id || next.cursor!.count >= MAX_STACK) return stack
    const amount = Math.min(stack.count, MAX_STACK - next.cursor!.count)
    next.cursor!.count += amount
    return clean({ id: stack.id, count: stack.count - amount })
  })
  return next
}

function required(stencil: (string | null)[]) {
  return stencil.filter((id): id is string => !!id).reduce<Record<string, number>>((counts, id) => ({ ...counts, [id]: (counts[id] ?? 0) + 1 }), {})
}

function available(state: RecipeState) {
  return state.inventory.reduce<Record<string, number>>((counts, stack) => stack ? { ...counts, [stack.id]: (counts[stack.id] ?? 0) + stack.count } : counts, {})
}

export function canCraft(state: RecipeState, result: string, outputCount = 1) {
  return craft(state, result, outputCount) !== state
}

export function craft(state: RecipeState, result: string, outputCount = 1): RecipeState {
  if (!Number.isInteger(outputCount) || outputCount < 1) return state
  if (!result || state.stencil.every(id => !id)) return state
  const supply = available(state)
  if (!Object.entries(required(state.stencil)).every(([id, count]) => (supply[id] ?? 0) >= count)) return state
  const next = structuredClone(state)
  Object.entries(required(next.stencil)).forEach(([id, count]) => {
    next.inventory = next.inventory.map((stack) => {
      if (!stack || stack.id !== id || count <= 0) return stack
      const used = Math.min(stack.count, count)
      count -= used
      return clean({ id, count: stack.count - used })
    })
  })
  const capacity = next.inventory.reduce((sum, stack) => sum + (stack?.id === result ? MAX_STACK - stack.count : !stack ? MAX_STACK : 0), 0)
  if (capacity < outputCount) return state
  let remaining = outputCount
  next.inventory = next.inventory.map((stack) => {
    if (remaining <= 0) return stack
    if (stack?.id === result) {
      const amount = Math.min(remaining, MAX_STACK - stack.count)
      remaining -= amount
      return { id: result, count: stack.count + amount }
    }
    if (!stack) {
      const amount = Math.min(remaining, MAX_STACK)
      remaining -= amount
      return { id: result, count: amount }
    }
    return stack
  })
  return next
}
