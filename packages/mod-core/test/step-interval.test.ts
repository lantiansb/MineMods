import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createCombinedSample } from "../script/target-combined-sample"
import { assembleBuildSource } from "../src/build-source"
import { saveProject } from "../src/project"
import { compileTreeFor } from "./java-tree"

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target} 的步声间隔按刻去重并能编译`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "studio-step-"))
    try {
      const directory = path.join(root, "project")
      const project = await createCombinedSample(directory, target)
      const change = { ...project.entities[0]!.sounds!, step_interval: target === "forge-1.20.1" ? 0 : 0.7 }
      await saveProject(
        directory,
        {
          ...project,
          entities: project.entities.map((e) => ({ ...e, sounds: change })),
          workspace: {
            assets: project.workspace.assets.map((a) => (a.document.kind === "entity" ? { ...a, document: { ...a.document, sounds: change } } : a)),
          },
        },
        project.revision,
      )
      const source = path.join(root, "source")
      await mkdir(source)
      await assembleBuildSource(directory, source, fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)), { target })
      const java = await Promise.all([...new Bun.Glob("**/*.java").scanSync({ cwd: source, absolute: true })].map((f) => Bun.file(f).text()))
      expect(java.join("\n")).toContain("if (tickCount < nextStepSoundTick) return;")
      expect(java.join("\n")).toContain(target === "forge-1.20.1" ? "getBbHeight() * 5.0f" : "nextStepSoundTick = tickCount + 14")
      const compiled = await compileTreeFor(target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target, source)
      if (compiled) expect(compiled.output + " " + compiled.code).toMatch(/ 0$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 180000)
}
