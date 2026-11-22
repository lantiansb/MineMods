import { afterEach, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createProject, saveProject, storagePath } from "../src/project"
import { exportBuiltJar, launchPlaytest, type BuildResult } from "../src/build"

const directories: string[] = []
afterEach(() => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

async function recordedFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-export-"))
  directories.push(directory)
  const project = await createProject({ directory, name: "Export Fixture" })
  const id = randomUUID()
  // This synthetic recorded-build fixture exercises file ownership/export checks only, not build acceptance.
  const bytes = await readFile(
    fileURLToPath(new URL("../../../templates/fabric-1.21/gradle/wrapper/gradle-wrapper.jar", import.meta.url)),
  )
  const jarPath = await storagePath(
    directory,
    ["generated", `build-${id}`, "build", "libs", "export_fixture-0.1.0.jar"],
    true,
  )
  await writeFile(jarPath, bytes)
  const result: BuildResult = {
    id,
    revision: project.revision,
    projectDirectory: directory,
    sourceDirectory: path.join(directory, "generated", `build-${id}`),
    jarPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  await writeFile(await storagePath(directory, [".minemods", "builds", `${id}.json`], true), JSON.stringify(result))
  return { directory, project, result, bytes }
}

test("exports only recorded exact bytes and creates adjacent dependency instructions", async () => {
  const fixture = await recordedFixture()
  const target = path.join(fixture.directory, "export.jar")
  expect(await exportBuiltJar(fixture.directory, fixture.result, target)).toBe(target)
  expect(await readFile(target)).toEqual(fixture.bytes)
  expect(await readFile(`${target}.README.txt`, "utf8")).toContain("GeckoLib 4.8.3")
  await expect(exportBuiltJar(fixture.directory, fixture.result, target)).rejects.toThrow()
  expect(await readFile(target)).toEqual(fixture.bytes)
})

test("rejects stale project revisions before creating an export", async () => {
  const fixture = await recordedFixture()
  await saveProject(
    fixture.directory,
    { ...fixture.project, description: "Changed after build" },
    fixture.project.revision,
  )
  await expect(
    exportBuiltJar(fixture.directory, fixture.result, path.join(fixture.directory, "stale.jar")),
  ).rejects.toThrow("STALE_BUILD_REVISION")
})

test("rejects modified artifacts, foreign projects and tampered build claims", async () => {
  const fixture = await recordedFixture()
  await expect(
    exportBuiltJar(
      fixture.directory,
      { ...fixture.result, sourceDirectory: fixture.directory },
      path.join(fixture.directory, "changed.jar"),
    ),
  ).rejects.toThrow("BUILD_RECORD_MISMATCH")
  await expect(
    exportBuiltJar(
      fixture.directory,
      { ...fixture.result, projectDirectory: path.dirname(fixture.directory) },
      path.join(fixture.directory, "foreign.jar"),
    ),
  ).rejects.toThrow("BUILD_PROJECT_MISMATCH")
  await writeFile(fixture.result.jarPath, "tampered")
  await expect(
    exportBuiltJar(fixture.directory, fixture.result, path.join(fixture.directory, "tampered.jar")),
  ).rejects.toThrow("BUILD_CHECKSUM_MISMATCH")
})

test("pre-cancelled playtest cannot launch a process", async () => {
  const fixture = await recordedFixture()
  const cancellation = new AbortController()
  cancellation.abort()
  await expect(
    launchPlaytest(fixture.result, {
      runtimeDirectory: path.join(fixture.directory, "runtime"),
      signal: cancellation.signal,
    }),
  ).rejects.toThrow("CANCELLED")
})
