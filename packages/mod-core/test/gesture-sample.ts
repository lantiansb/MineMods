import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { GESTURE_EXAMPLE } from "../src/gesture-bases"
import { createProject, openProject, saveProject } from "../src/project"
import { applyWorkspaceAsset, type WorkspaceAsset } from "../src/workspace"

/** A second cast action on H, built from a different base and visibly different in a screenshot: the arm ends pointing at the sky. */
export const SKY_EXAMPLE = {
  kind: "gesture",
  format: 2,
  name: "引雷",
  english_name: "Call Lightning",
  trigger: { type: "key", key: "h" },
  base: "sky_call",
  speed: 1,
  strength: 1.2,
  hand: "right",
  hold_seconds: 0.4,
  aim: false,
  mirror_for_left_handed: true,
  first_person: { arms: true, items: true },
} as const

export function gestureAsset(document: unknown, id: string = randomUUID()) {
  return {
    id,
    module: "gesture",
    title: (document as { name: string }).name,
    revision: 1,
    created_at: "2026-10-05T00:00:00.000Z",
    updated_at: "2026-10-05T00:00:00.000Z",
    prompt: "施法动作冒烟检查样例",
    dependencies: [],
    document,
    provenance: { model: null, request_id: null },
    status: "ready",
  } as WorkspaceAsset
}

/**
 * Creates `<directory>/project` (a Studio project with two cast actions, G and H, and nothing else) and
 * `<directory>/source` (the Gradle project a build of it compiles). Used by the tests, by `javacheck.sh`
 * and by the one in-game smoke check. A test passes its own copy of the template to try other line endings.
 */
export async function createGestureSample(directory: string, templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))) {
  const projectDirectory = path.join(directory, "project")
  const sourceDirectory = path.join(directory, "source")
  const created = await createProject({ directory: projectDirectory, name: "Gesture Smoke", mod_id: "gesture_smoke" })
  // Fixed ids: the sample comes out the same on every machine, with 掌心雷 as action 0 and 引雷 as action 1.
  const project = applyWorkspaceAsset(
    applyWorkspaceAsset(created, gestureAsset(GESTURE_EXAMPLE, "00000000-0000-4000-8000-0000000000a1")),
    gestureAsset(SKY_EXAMPLE, "00000000-0000-4000-8000-0000000000a2"),
  )
  await saveProject(projectDirectory, project, created.revision)
  await mkdir(sourceDirectory)
  await assembleBuildSource(projectDirectory, sourceDirectory, templateDirectory)
  return { projectDirectory, sourceDirectory, project: await openProject(projectDirectory) }
}

if (import.meta.main) {
  if (!process.argv[2]) throw new Error("usage: bun test/gesture-sample.ts <new empty directory>")
  const sample = await createGestureSample(path.resolve(process.argv[2]))
  console.log(`Studio project: ${sample.projectDirectory}\nGradle source:  ${sample.sourceDirectory}`)
}
