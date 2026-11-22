import { createProject, saveProject } from "../src/project"
import { WorkspaceAssetSchema } from "../src/workspace"
import { ParticleDocumentSchema } from "../src/particle"
import type { TargetId } from "../src/target/ids"

export const samples = [
  {
    kind: "particle",
    name: "slag_ember",
    frames: [
      { shape: "ember", seed: 1 },
      { shape: "ember", seed: 2 },
      { shape: "spark", seed: 5 },
    ],
    frames_by: "random",
    lifetime: 1.1,
    gravity: 0.5,
    drag: 0.92,
    size: { start: 0.16, mid: [{ at: 0.15, value: 0.22 }], end: 0.04 },
    color: {
      start: "#fff1b0",
      mid: [
        { at: 0.3, value: "#ff9a2e" },
        { at: 0.75, value: "#c8321a" },
      ],
      end: "#3a0d08",
    },
    opacity: { start: 1, mid: [{ at: 0.8, value: 0.9 }], end: 0 },
    emissive: true,
    spin: 0,
  },
  {
    kind: "particle",
    name: "bog_bubble",
    frames: [
      { shape: "drop", hollow: true, seed: 1 },
      { shape: "drop", hollow: true, seed: 2 },
    ],
    frames_by: "random",
    lifetime: 1.6,
    gravity: -0.15,
    size: { start: 0.05, mid: [{ at: 0.8, value: 0.3 }], end: 0.34 },
    color: { start: "#9be36a", end: "#4f8f2a" },
    opacity: {
      start: 0,
      mid: [
        { at: 0.1, value: 0.85 },
        { at: 0.9, value: 0.85 },
      ],
      end: 0,
    },
    emissive: false,
    spin: 0,
  },
  {
    kind: "particle",
    name: "steel_spark",
    frames: [
      { shape: "streak", seed: 1 },
      { shape: "streak", seed: 2 },
      { shape: "shard", seed: 4 },
    ],
    frames_by: "random",
    lifetime: 0.5,
    gravity: 1,
    drag: 0.9,
    face: "motion",
    stretch: 3,
    size: { start: 0.12, end: 0.06 },
    color: { start: "#ffffff", mid: [{ at: 0.3, value: "#ffe9a8" }], end: "#b0782c" },
    opacity: { start: 1, end: 0 },
    emissive: true,
    spin: 0,
  },
].map((value) => ParticleDocumentSchema.parse(value))

export async function createTargetParticleSample(directory: string, target: TargetId) {
  const project = await createProject({
    directory,
    target,
    name: "炉火、沼泽与铁屑",
    description: "余烬、气泡和金属火花。",
    mod_id: "particle_studies",
  })
  const now = new Date().toISOString()
  const assets = samples.map((document, i) =>
    WorkspaceAssetSchema.parse({
      id: `33333333-cccc-4777-8777-00000000000${i}`,
      module: "particle",
      title: ["炉火余烬", "毒沼气泡", "金属火花"][i],
      document,
      revision: 1,
      created_at: now,
      updated_at: now,
      prompt: document.name,
      dependencies: [],
      provenance: { model: "example", request_id: null },
      status: "ready",
    }),
  )
  return saveProject(directory, { ...project, workspace: { ...project.workspace, assets } }, project.revision)
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: target-particle-sample.ts <directory> [target]")
  await createTargetParticleSample(directory, target as TargetId)
}
