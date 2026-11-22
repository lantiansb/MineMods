import { expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

/**
 * r29f 合包: a template's processResources that filters a resource (the version into mods.toml / neoforge.mods.toml / fabric.mod.json) must say the text is
 * UTF-8. Without it Gradle reads and writes in the platform charset: on a Chinese Windows (GBK) the mod's Chinese name and description came out of the jar
 * with ? in them (the 山海残卷 mod list showed � in its description).
 */
test("every template that filters a resource reads and writes it as UTF-8", async () => {
  const root = path.resolve(import.meta.dir, "../../../templates")
  const folders = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  const filtering: string[] = []
  for (const folder of folders) {
    const gradle = await readFile(path.join(root, folder, "build.gradle"), "utf8").catch(() => null)
    if (!gradle || !/filesMatching\([^)]*\)\s*\{[\s\S]*?filter\s*\{/.test(gradle)) continue
    filtering.push(folder)
    const block = gradle.slice(gradle.indexOf("processResources"), gradle.indexOf("processResources") + 600)
    expect({ folder, utf8: /filteringCharset\s*=\s*["']UTF-8["']/.test(block) }).toEqual({ folder, utf8: true })
  }
  expect(filtering.sort()).toEqual(["fabric-1.21", "fabric-1.21-yarn", "forge-1.20.1", "neoforge-1.21.1"])
})
