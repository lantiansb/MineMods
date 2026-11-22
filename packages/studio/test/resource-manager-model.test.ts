import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { TARGETS } from "@minemods/mod-core/targets"
import type { GameTarget } from "../src/api"
import { buildableLine, cleanupNotice, neededLine, size, sourceName, targetName } from "../src/renderer/features/resource-manager-model"

test("存储页说清楚每样东西从哪来、哪个版本要用", () => {
  expect(targetName("forge-1.20.1")).toBe("Forge 1.20.1")
  expect(targetName("neoforge-1.21.1")).toBe("NeoForge 1.21.1")
  expect(targetName("fabric-1.21.1")).toBe("Fabric 1.21.1")
  expect(targetName("custom")).toBe("custom")
  expect(targetName("toString-1.0")).toBe("toString-1.0")
  expect(neededLine(["forge-1.20.1"])).toBe("Forge 1.20.1 要用")
  expect(neededLine(["forge-1.20.1", "fabric-1.21.1"])).toBe("Forge 1.20.1、Fabric 1.21.1 要用")
  expect(neededLine([])).toBeNull()
  expect(sourceName("bmclapi")).toBe("BMCLAPI 镜像")
  expect(sourceName("tuna")).toBe("清华大学镜像")
  expect(sourceName("tencent")).toBe("腾讯云镜像")
  expect(sourceName("official")).toBe("官方地址")
  expect(sourceName("registered")).toBe("升级前已有")
  expect(sourceName("kept")).toBe("本地已有")
  expect(sourceName("somewhere")).toBe("somewhere")
})

test("「清理没用的」做完说清了几项、腾出多少；没有可清的就直说", () => {
  expect(cleanupNotice({ removed: ["loader:a", "instance:b"], kept: [], freedBytes: 3 * 1024 ** 2 })).toBe(`清理了 2 项，腾出 ${size(3 * 1024 ** 2)}`)
  expect(cleanupNotice({ removed: ["loader:a"], kept: [], freedBytes: 1536 })).toBe("清理了 1 项，腾出 1.5 KiB")
  expect(cleanupNotice({ removed: [], kept: [{ id: "loader:a", users: ["target:forge-1.20.1"] }], freedBytes: 0 })).toBe("没有可以清理的")
})

test("「现在能打包的」跟着目标清单走，不再写死", () => {
  // Every loader Studio reads can be packed now, so nothing is said to be only for looking at.
  expect(buildableLine(TARGETS)).toBe("现在能打包的：Minecraft 1.21.1 · Fabric 0.17.2 · Java 21；Minecraft 1.21.1 · NeoForge 21.1.266 · Java 21；Minecraft 1.20.1 · Forge 47.4.28 · Java 17。")
  const target = (more: Partial<GameTarget>): GameTarget => ({ id: "x", minecraft: "1.20.1", loader: "forge", loaderVersion: "47.4.0", java: 17, ready: true, why: null, ...more })
  expect(buildableLine([target({}), target({ loader: "fabric", minecraft: "1.21.1", loaderVersion: "0.17.2", java: 21 })])).toBe(
    "现在能打包的：Minecraft 1.20.1 · Forge 47.4.0 · Java 17；Minecraft 1.21.1 · Fabric 0.17.2 · Java 21。NeoForge 的包可以打开来看，还不能打包。",
  )
  expect(buildableLine([target({ ready: false })])).toBeNull()
  const page = readFileSync(path.join(import.meta.dir, "../src/renderer/features/resource-manager.tsx"), "utf8")
  expect(page).not.toContain("现在能打包的：Minecraft 1.21.1")
  expect(page).toContain("window.studio.cleanUnusedEnvironment()")
  expect(page).toContain("清理没用的")
})
