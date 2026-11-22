import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createTargetParticleSample } from "../script/target-particle-sample"
import { assembleBuildSource } from "../src/build-source"
import { compileParticles, particleIndex } from "../src/common/particles"
import { genTarget } from "../src/platform/target"
import { hasTargetJavac, targetJavac } from "./target-javac"

for (const target of ["fabric-1.21.1", "neoforge-1.21.1", "forge-1.20.1"] as const)
  test(
    target + " particle sample and emit interface compile",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "particle-sample-"))
      try {
        const projectDir = path.join(dir, "project"),
          source = path.join(dir, "source")
        const project = await createTargetParticleSample(projectDir, target)
        await mkdir(source)
        await assembleBuildSource(
          projectDir,
          source,
          fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)),
        )
        const particles = project.workspace.assets.flatMap((a) =>
          a.document.kind === "particle" ? [{ id: a.id, document: a.document }] : [],
        )
        expect(particleIndex(particles, "steel_spark")).toBe(2)
        const pkg = "com.minemods.content_" + project.mod_id
        const input = { particles, modId: project.mod_id, packageName: pkg }
        expect(
          Object.keys(compileParticles(input, genTarget(target)).files).some((k) =>
            k.endsWith("StudioParticleEmit.java"),
          ),
        ).toBe(false)
        const emitted = compileParticles({ ...input, emit: true }, genTarget(target))
        for (const [name, file] of Object.entries(emitted.files)) {
          await mkdir(path.dirname(path.join(source, name)), { recursive: true })
          await writeFile(path.join(source, name), file)
        }
        const cp = target === "fabric-1.21.1" ? target + "-official" : target
        if (hasTargetJavac(cp)) {
          const compiled = await targetJavac(cp, path.join(source, "src/main/java"))
          expect(compiled.output.split("\n").filter((s) => s.includes("error"))).toEqual([])
          expect(compiled.code).toBe(0)
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    180000,
  )
