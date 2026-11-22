import yauzl from "yauzl"

/**
 * Moving gameplay code an AI wrote from Yarn names to Mojang's names (the names every target now uses). The rename
 * itself is Loom's `migrateMappings`, which knows each name by its owner; it cannot rename what a wildcard import
 * hides (`import net.minecraft.entity.*;`), so those are first spelled out, one import per class the file uses that the
 * Yarn-named game has in that package. The rule for new code is the same: no wildcard imports of the game.
 */

/** Top-level classes of a jar by package (`net.minecraft.entity` → {Entity, …}). */
export async function jarClassIndex(jar: string): Promise<Map<string, Set<string>>> {
  const index = new Map<string, Set<string>>()
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(jar, { lazyEntries: true, autoClose: true }, (error, file) => (error || !file ? reject(error ?? new Error("JAR_UNREADABLE")) : resolve(file))),
  )
  await new Promise<void>((resolve, reject) => {
    zip.on("entry", (entry: yauzl.Entry) => {
      const name = entry.fileName
      if (name.endsWith(".class") && !name.includes("$")) {
        const slash = name.lastIndexOf("/")
        const pkg = name.slice(0, Math.max(0, slash)).replaceAll("/", ".")
        const simple = name.slice(slash + 1, -".class".length)
        if (!index.has(pkg)) index.set(pkg, new Set())
        index.get(pkg)!.add(simple)
      }
      zip.readEntry()
    })
    zip.on("end", () => resolve())
    zip.on("error", reject)
    zip.readEntry()
  })
  return index
}

const DROPPED = "@@minemods-dropped-import@@"
const WILDCARD = /^import\s+(net\.minecraft(?:\.\w+)+)\.\*;[ \t]*$/gm

/** Wildcard imports of the game in a file, as package names. */
export function gameWildcards(content: string) {
  return [...content.matchAll(WILDCARD)].map((match) => match[1]!)
}

/**
 * Replaces each `import net.minecraft.<pkg>.*;` with explicit imports of the classes of that package the file names.
 * A package the game does not have is left as it is and reported, never guessed.
 */
export function expandGameWildcards(content: string, index: Map<string, Set<string>>) {
  // The words a file can name a class by: capitalised identifiers outside strings, comments and its own imports.
  const body = content
    .replace(/^\s*(package|import)\s.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
  const words = new Set(body.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [])
  const unknown: string[] = []
  let expanded = 0
  const result = content.replace(WILDCARD, (line, pkg: string) => {
    const classes = index.get(pkg)
    if (!classes) {
      unknown.push(pkg)
      return line
    }
    const used = [...classes].filter((name) => words.has(name)).sort()
    expanded += used.length
    // A wildcard the file used nothing from is dropped with its line: it imported nothing.
    return used.length ? used.map((name) => `import ${pkg}.${name};`).join("\n") : DROPPED
  })
  return { content: result.replaceAll(new RegExp(`${DROPPED}\\r?\\n?`, "g"), ""), expanded, unknown }
}
