import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { BuildResultSchema } from "@minemods/mod-core/build"
import { buildWarnings, buildWarningSeverity, type BuildWarning } from "@minemods/mod-core/build-warnings"
import { scatterFindings } from "@minemods/mod-core/particle-preview"
import type { Finding } from "@minemods/mod-core/reconcile"
import { abilityRef, assetRef, comboRef } from "@minemods/mod-core/finding-refs"
import { samples } from "../../mod-core/script/target-particle-sample"
import { groupBuildWarnings } from "../src/renderer/features/build-warning-groups"
import { MCP_TOOLS } from "../src/main/mcp-handoff"

test("particle warning severity comes from the rule branch, not the wording", () => {
  const asset = randomUUID()
  const document = { ...samples[0]!, face: "motion" as const, stretch: 3, size: { start: 1.2, end: 1.2 }, emissive: false, color: { start: "#171019", end: "#0f101c" } }
  const base = { count: 48, at: 0, particle: { asset } }
  const lookup = () => ({ title: "熔炉暗砂", document })
  const findings = [
    ...scatterFindings(base, undefined, lookup, true),
    ...scatterFindings({ ...base, particle: "crit", tint: "#ff3333" }),
    ...scatterFindings({ ...base, motion: { type: "converge" }, velocity: { forward: 1 } }, undefined, lookup),
  ]
  const severity = new Map(buildWarnings(findings.map(issue => ({ ...issue, stops: false, about: null, text: "同一句文字" }))).map(issue => [issue.emission, issue.severity]))
  expect([...severity]).toEqual([
    ["dark", "advice"], ["missing_velocity", "advice"], ["area", "advice"],
    ["vanilla_options", "defect"], ["ignored_velocity", "defect"],
  ])
})

test("every build warning and reference survives the receipt and the grouped view", () => {
  const name = "共同招名"
  const ability = abilityRef({ id: "slam", name })
  const owner = { kind: "entity" as const, id: randomUUID(), name: "共同生物名" }
  const base: Finding = { rule: "particle_emission", stops: false, about: owner, text: "一处提醒", fix: "", refs: [ability, assetRef(randomUUID(), "粒子")], emission: "area" }
  const otherOwner: Finding = { ...base, about: { ...owner, id: randomUUID() } }
  const otherMove: Finding = { ...base, refs: [abilityRef({ id: "second", name })] }
  const combo: Finding = { ...base, rule: "combo_window", refs: [ability, comboRef({ id: "first_combo", name: "连招" })] }
  const ordinary: Finding = { ...base, rule: "ability_reach", emission: undefined }
  const area = Array.from({ length: 210 }, () => base)
  const findings: Finding[] = [
    ...area, { ...base, emission: "dark" }, { ...base, emission: "vanilla_options" }, ordinary,
    otherOwner, otherMove, combo, { ...combo }, { ...base, refs: [base.refs![1]!] },
    { ...base, rule: "model_missing", stops: true },
  ]
  const warnings = buildWarnings(findings)
  const output = BuildResultSchema.parse({
    id: randomUUID(), revision: 1, sha256: "0".repeat(64), warnings,
    jarPath: path.resolve("sample.jar"), projectDirectory: path.resolve("project"), sourceDirectory: path.resolve("source"),
  })
  const preserved = output.warnings!
  expect(preserved.length).toBe(218)
  expect(preserved.map(({ rule, text, fix, refs }) => ({ rule, text, fix, refs })))
    .toEqual(findings.filter(finding => !finding.stops).map(({ rule, text, fix, refs }) => ({ rule, text, fix, refs })))
  const groups = groupBuildWarnings(preserved)
  expect(groups.advice.rows.map(row => row.warnings.length)).toEqual([211, 1, 1, 1])
  expect(groups.defect.rows.map(row => row.warnings.length)).toEqual([1, 1, 1, 1])
  const expanded = [...groups.defect.rows, ...groups.advice.rows].flatMap(row => row.warnings)
  expect(expanded.map(warning => preserved.indexOf(warning)).sort((left, right) => left - right)).toEqual(preserved.map((_, index) => index))

  const legacy: BuildWarning = { rule: "ability_reach", about: name, text: "旧回执", fix: "" }
  expect(buildWarningSeverity(legacy)).toBe("defect")
  expect(groupBuildWarnings([legacy, legacy]).defect.rows).toHaveLength(2)
  const description = MCP_TOOLS.find(([tool]) => tool === "get_build")?.[1]
  expect(description).toContain("defect（要改，已确定的表现或功能问题）或 advice（可以看看，估算或风格建议）")
})
