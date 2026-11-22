import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { listTargetManifests } from "@minemods/mod-core/target/manifests"
import { toolchainFor } from "@minemods/mod-core/toolchain/toolchain"

const STUDIO = path.resolve(import.meta.dir, "..")
const REPO = path.resolve(STUDIO, "../..")

// Found in the packaged app (三端验收, 2026-11-14): only Fabric's template was shipped, so a Forge or NeoForge project
// could not be built from the installed Studio although every run from the source tree worked.
test("the installed Studio ships the template of every target a person can choose", () => {
  const builder = readFileSync(path.join(STUDIO, "electron-builder.yml"), "utf8")
  const shipped = [...builder.matchAll(/^\s*- from: \.\.\/\.\.\/templates\/([\w.-]+)\s*\n\s*to: templates\/([\w.-]+)\s*$/gm)].map((match) => {
    expect(match[2]).toBe(match[1]!)
    return match[1]!
  })
  for (const manifest of listTargetManifests().filter((entry) => entry.ready)) {
    const template = toolchainFor(manifest).template
    expect(shipped).toContain(template)
    expect(existsSync(path.join(REPO, "templates", template))).toBe(true)
  }
})
