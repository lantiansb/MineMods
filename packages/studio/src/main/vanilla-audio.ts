import { access, readFile, readdir } from "node:fs/promises"
import path from "node:path"
type Variant = string | { name: string; type?: string }
/** Resolve event aliases through the index for the project's installed game version. */
export async function vanillaAudio(runtime: string, version: string, event: string, probe = false) {
  const root = path.join(runtime, "gradle-home", "caches", "fabric-loom", "assets")
  const indexes = path.join(root, "indexes")
  const files = await readdir(indexes).catch(() => [] as string[])
  for (const index of files
    .filter((f) => f.startsWith(version + "-") && f.endsWith(".json"))
    .sort()
    .reverse()) {
    const { objects } = JSON.parse(await readFile(path.join(indexes, index), "utf8")) as { objects: Record<string, { hash: string }> }
    const object = (key: string) => {
      const h = objects[key]?.hash
      return h && /^[a-f0-9]{40}$/.test(h) ? path.join(root, "objects", h.slice(0, 2), h) : null
    }
    const catalog = object("minecraft/sounds.json")
    if (!catalog) continue
    const events = JSON.parse(await readFile(catalog, "utf8")) as Record<string, { sounds?: Variant[] }>
    const seen = new Set<string>()
    const resolve = (key: string): string | null => {
      if (seen.has(key)) return null
      seen.add(key)
      for (const v of events[key]?.sounds ?? []) {
        const name = (typeof v === "string" ? v : v.name).replace(/^minecraft:/, "")
        const f = typeof v !== "string" && v.type === "event" ? resolve(name) : object("minecraft/sounds/" + name + ".ogg")
        if (f) return f
      }
      return null
    }
    const file = resolve(event)
    if (
      file &&
      (await access(file).then(
        () => true,
        () => false,
      ))
    )
      return probe ? "ready" : "data:audio/ogg;base64," + (await readFile(file)).toString("base64")
  }
  return null
}
