import { readFileSync } from "node:fs"
import path from "node:path"
import { ProjectSchema } from "../../../src/project"

export * from "./documents"

// The project the fixture documents are written for: the old sample project, as saved before gameplay existed.
const legacy = path.join(import.meta.dir, "..", "pre-0a")
export const sampleProject = () => ProjectSchema.parse(JSON.parse(readFileSync(path.join(legacy, "project.json"), "utf8")))
export const LEGACY_FILES = { project: path.join(legacy, "project.json"), model: path.join(legacy, "model-asset.json") }
