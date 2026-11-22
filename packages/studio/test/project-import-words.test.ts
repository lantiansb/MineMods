import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { previewProjectImport } from "@minemods/mod-core/project-import"
import { createImportBossSample } from "../../mod-core/script/import-boss-sample"
import { importKindName } from "../src/renderer/features/project-import-words"

/**
 * r29c 乙 第 7 件: in the import's list a creature and its setting (the entity document beside it) were both called 「生物」, and read as the same creature listed twice.
 * Measured on a real list: the creature and its setting are there under one name, and their kinds now read apart.
 */
test("导入清单里生物和它的设定分得清", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "studio-import-words-"))
  try {
    const frost = await createImportBossSample(path.join(base, "霜原"), "frost")
    await createImportBossSample(path.join(base, "火山口"), "lava")
    const { importableThings } = await import("@minemods/mod-core/project-import")
    const creature = importableThings(frost).find((thing) => thing.kind === "creature")!
    const plan = await previewProjectImport(path.join(base, "霜原"), path.join(base, "火山口"), { picks: [creature.id] })
    const named = plan.items.filter((item) => item.title === "霜甲巨像").map((item) => importKindName(item.kind))
    expect(named).toContain("生物")
    expect(named).toContain("生物的设定")
    expect(new Set(named).size).toBe(named.length)
    expect(new Set(plan.items.map((item) => `${item.title}/${importKindName(item.kind)}`)).size).toBe(plan.items.length)
    // Every other kind reads as it did.
    expect(importKindName("particle")).not.toBe(importKindName("entity"))
    expect(importKindName("item")).toBe("物品")
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}, 120000)
