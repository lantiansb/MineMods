import { expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { samples } from "../script/target-particle-sample"
import { particleAt, particleTicks, ParticleDocumentSchema } from "../src/particle"
import { particleCurveJava } from "../src/common/particle-curves"
import { hasTargetJavac, targetJdkTool } from "./target-javac"

import { particleFlight } from "../src/particle-scene"

test("an event with no velocity starts at rest and a specified velocity uses blocks per second", () => {
  const doc = { ...samples[2]!, gravity: 0, drag: 1 }
  const still = particleFlight(doc, { count: 1, spread: 0 })[0]!
  expect(still.every(point => Math.hypot(point.x, point.y, point.z) === 0)).toBe(true)
  const moving = particleFlight(doc, { count: 1, spread: 0, velocity: { forward: 5 } })[0]!
  expect(moving[4]).toEqual({ x: 0, y: 0, z: 1 })
})

test("curve knots have an order and a particle may fade in from zero", () => {
  const doc = samples[1]!
  expect(doc.opacity.start + doc.opacity.end).toBe(0)
  expect(
    ParticleDocumentSchema.safeParse({ ...doc, opacity: { ...doc.opacity, mid: doc.opacity.mid!.toReversed() } })
      .success,
  ).toBe(false)
})
test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))(
  "generated Java matches TypeScript at every quarter tick",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "particle-curves-"))
    try {
      const file = path.join(dir, "Check.java")
      const source =
        particleCurveJava("check", samples) +
        `class Check {
      public static void main(String[] args) {
        int[] ticks={${samples.map(particleTicks).join(",")}};
        for(int s=0;s<ticks.length;s++) for(int a=0;a<=4*ticks[s];a++)
          for(int c=0;c<5;c++) System.out.println(StudioParticleCurves.at(s,c,(double)a/(4*ticks[s])));
      }
    }`
      await writeFile(file, source)
      const compile = Bun.spawnSync([targetJdkTool("fabric-1.21.1-official", "javac"), "-d", dir, file])
      expect(compile.stderr.toString()).toBe("")
      const run = Bun.spawnSync([targetJdkTool("fabric-1.21.1-official", "java"), "-cp", dir, "check.Check"])
      expect(run.exitCode).toBe(0)
      const actual = run.stdout.toString().trim().split(/\s+/).map(Number)
      const expected = samples.flatMap((doc) =>
        Array.from({ length: 4 * particleTicks(doc) + 1 }, (_, i) => {
          const at = particleAt(doc, i / 4)
          return [at.size, at.opacity, ...at.color]
        }).flat(),
      )
      expect(actual.length).toBe(expected.length)
      expect(Math.max(...expected.map((v, i) => Math.abs(v - actual[i]!)))).toBeLessThan(1e-7)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
