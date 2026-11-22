import { tomlString } from "../toolchain/mdg"

/**
 * What a project's release adds to a Forge or NeoForge mod's `mods.toml` / `neoforge.mods.toml` (the toolchain's
 * template writes the rest), the way Fabric's scaffold adds it to `fabric.mod.json`: the icon the mod list shows
 * (`logoFile`, a path inside the jar), the mod's page (`displayURL`) and where to report problems (`issueTrackerURL`,
 * which both loaders read at the top of the file). Nothing given: the text as it was.
 */
export function modTomlExtras(text: string, extras: { icon?: string; homepage?: string; issues?: string }) {
  const lines = text.split("\n")
  const mods = lines.findIndex((line) => line.trim() === "[[mods]]")
  const end = lines.findIndex((line, index) => index > mods && line.trim().startsWith("["))
  if (mods < 0) throw new Error("MOD_TOML_WITHOUT_MODS")
  const inMods = [
    ...(extras.icon ? [`logoFile = "${tomlString(extras.icon)}"`] : []),
    ...(extras.homepage ? [`displayURL = "${tomlString(extras.homepage)}"`] : []),
  ]
  // The last key of the [[mods]] table, so the new keys stay in it (a blank line may stand before the next table).
  let last = end < 0 ? lines.length - 1 : end - 1
  while (last > mods && !lines[last]!.trim()) last--
  lines.splice(last + 1, 0, ...inMods)
  if (extras.issues) lines.splice(mods, 0, `issueTrackerURL = "${tomlString(extras.issues)}"`, "")
  return lines.join("\n")
}
