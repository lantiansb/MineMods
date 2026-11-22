import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createTargetStancesSample, knight, turtle } from "../script/target-stances-sample"
import { assembleBuildSource } from "../src/build-source"
import { EntitySchema } from "../src/project"
import { stanceChoices } from "../src/stances"
import { hasTargetJavac, targetJavac } from "./target-javac"

test("姿态选择依次交阶段、姿态和当前走位，空交集保留为空", () => {
  const picks = ["roll", "bite", "dash"]
  const row = turtle().stances!.list[0]!
  expect(stanceChoices(row, picks, ["roll", "bite"])).toEqual(["roll"])
  expect(stanceChoices(row, picks, picks, ["bite"])).toEqual([])
  expect(stanceChoices({ ...row, abilities: [] }, picks)).toEqual([])
  expect(stanceChoices({ ...row, abilities: undefined }, picks)).toEqual(picks)
})

test("姿态目标、离开时用的招与预留的感知名字随文档检查", () => {
  const draft = knight()
  const rows = draft.stances!.list
  expect(EntitySchema.safeParse({ ...draft, stances: { start: "missing", list: rows } }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...draft, stances: { start: "raised", list: [{ ...rows[0], senses: {} }, rows[1]] } }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...draft, stances: { start: "raised", list: [{ ...rows[0], leave: { ...rows[0]!.leave, ability: "bash" } }, rows[1]] } }).success).toBe(false)
})

const targets = ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const
const template = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
for (const target of targets) test(`姿态的三只样例走完整生成器并用 ${target} 的 Java 类路径编译`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-stances-"))
  try {
    const project = path.join(root, "project")
    const source = path.join(root, "source")
    await createTargetStancesSample(project, target)
    await mkdir(source)
    await assembleBuildSource(project, source, template)
    const jar = target === "fabric-1.21.1" ? target + "-official" : target
    if (hasTargetJavac(jar)) {
      const compiled = await targetJavac(jar, path.join(source, "src", "main", "java"))
      expect(compiled.code, compiled.output).toBe(0)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120000)
