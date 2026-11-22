import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { AbilityAssetDocumentSchema, sharedAbilityIssues } from "../src/ability-asset"
import { createTargetStancesSample } from "../script/target-stances-sample"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { assembleBuildSource } from "../src/build-source"
import { extractAbility } from "../src/extract-ability"
import { openProject, saveProject } from "../src/project"

const template = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
async function java(directory: string, output: string) {
  await assembleBuildSource(directory, output, template)
  const files = (await readdir(output, { recursive: true })).filter(name => name.endsWith(".java")).sort()
  return Object.fromEntries(await Promise.all(files.map(async name => [name, createHash("sha256").update(await readFile(path.join(output, name))).digest("hex")])))
}

test("提取第一招，保存后所有生成的 Java 文件逐字节一致", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "extract-ability-"))
  try {
    const directory = path.join(root, "工程")
    await createDataGameplaySample(directory, { life: true, abilities: true, effects: true })
    const original = await openProject(directory)
    const owner = original.workspace.assets.find(a => a.document.kind === "entity")!
    if (owner.document.kind !== "entity") throw new Error("缺少生物")
    const move = owner.document.abilities![0]!
    const before = await java(directory, path.join(root, "before"))
    expect(Object.keys(before).length).toBeGreaterThan(5)
    const next = extractAbility(original, owner.id, move.id)
    const saved = await saveProject(directory, next.project, original.revision)
    expect(saved.revision).toBe(original.revision + 1)
    expect(saved.workspace.assets.find(a => a.id === owner.id)?.dependencies).toContain(next.assetId)
    expect(await java(directory, path.join(root, "after"))).toEqual(before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120000)

test("把切姿态的招提取成共用技能，起手条件、选招和生成的 Java 都一致", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "extract-stance-ability-"))
  try {
    const directory = path.join(root, "工程")
    const original = await createTargetStancesSample(directory, "fabric-1.21.1")
    const owner = original.workspace.assets.find(a => a.document.kind === "entity" && a.document.stances?.start === "raised")!
    const before = await java(directory, path.join(root, "before"))
    const lower = extractAbility(original, owner.id, "lower")
    const heave = extractAbility(lower.project, owner.id, "heave")
    const skill = heave.project.workspace.assets.find(a => a.id === lower.assetId)!.document
    if (skill.kind !== "ability") throw new Error("缺少共用技能")
    for (const binding of [
      { type: "item", item: "shield", use: "click" },
      { type: "block", block: "switch" },
      { type: "gesture", gesture: "ab111111-0000-4000-8000-0000000000ff" },
    ]) {
      expect(AbilityAssetDocumentSchema.safeParse({ ...skill, bindings: [binding] }).error?.issues[0]?.message).toContain("切换姿态")
    }
    const invalid = (events: unknown[]) => ({ ...heave.project, workspace: { ...heave.project.workspace,
      assets: heave.project.workspace.assets.map(a => a.id === lower.assetId
        ? { ...a, document: AbilityAssetDocumentSchema.parse({ ...skill, events }) }
        : a),
    } })
    expect(sharedAbilityIssues(invalid([]))[0]?.text).toContain("请选择一招带有切姿态的步骤")
    expect(sharedAbilityIssues(invalid([{ type: "stance", at: 0.65, to: "missing" }]))[0]).toMatchObject({
      stops: true, refs: [{ kind: "ability", id: "lower" }, { kind: "asset", id: lower.assetId }],
    })
    expect(sharedAbilityIssues(heave.project)).toEqual([])
    await saveProject(directory, heave.project, original.revision)
    expect(await java(directory, path.join(root, "after"))).toEqual(before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120000)
