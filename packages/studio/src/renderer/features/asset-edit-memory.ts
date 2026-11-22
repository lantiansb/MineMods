/**
 * What the hand form remembers of a switch while it is off (broad19: turning 自然生成 off, saving, and turning it on again gave back the default
 * biomes, light, weight and cap instead of what the person had set).
 *
 * Where it lives, and why there. Not in the saved document: a switch that is off means the mod does not have that thing, and a document that
 * carried a dormant `runtime.spawn` would be read as live by everything that reads documents (the Java generator, the checks, the play guide,
 * an outside AI reading the project), so the settings of something switched off must not be part of what is saved. Not in the form's draft
 * either: a save replaces the draft with the stored document, and that is exactly the moment the settings were lost. So it is kept beside the
 * form, per thing, for as long as the app is open: it survives a save, giving up the changes, leaving the card and coming back, and it is a
 * convenience of the person's editing, never a fact about the mod. Pure, so it can be checked without a screen.
 */
export type SwitchMemory = {
  /** The value a switch had when it was turned off (a copy). `null` and `undefined` are not remembered: they are what off looks like. */
  keep: (key: string, value: unknown) => void
  /** What the switch held when it was last turned off (a copy), or undefined when it was never on in this session. */
  recall: (key: string) => unknown
}

export function switchMemory(): SwitchMemory {
  const held = new Map<string, unknown>()
  return {
    keep: (key, value) => {
      if (value !== null && value !== undefined) held.set(key, structuredClone(value))
    },
    recall: (key) => (held.has(key) ? structuredClone(held.get(key)) : undefined),
  }
}

// One memory per saved thing, for the life of the window. Bounded, so a long session over many things does not keep them all.
const KEPT = 40
const memories = new Map<string, SwitchMemory>()

/** The memory of a thing; a new thing that has no id yet gets one of its own, which `adopt` files under its id once it is saved. */
export function memoryOf(assetId: string | null): SwitchMemory {
  if (assetId === null) return switchMemory()
  const known = memories.get(assetId)
  if (known) return known
  return adopt(assetId, switchMemory())
}

/** File a memory under a thing's id (a new thing was just saved and now has one). */
export function adopt(assetId: string, memory: SwitchMemory): SwitchMemory {
  memories.set(assetId, memory)
  if (memories.size > KEPT) memories.delete(memories.keys().next().value!)
  return memory
}

/**
 * Turning a switch on: the settings it had when it was last turned off, else the form's starting settings (`fresh`). `restored` says which, so
 * the form can tell the person their settings came back.
 */
export function switchedOn(memory: SwitchMemory, key: string, fresh: (() => unknown) | undefined): { value: unknown; restored: boolean } {
  const back = memory.recall(key)
  return back === undefined ? { value: fresh?.(), restored: false } : { value: back, restored: true }
}
