import { expect, test } from "bun:test"
import { resolveProfile } from "../src/fabric/profile"
import { findTargetManifest } from "../src/target/manifests"
import { DEFAULT_TARGET, TARGETS, targetById } from "../src/targets"

test("游戏目标目录：id 唯一，能做的是在真实游戏里验证过的三个（Fabric 1.21.1 是默认），它的加载器版本来自生成模板的配置", () => {
  expect(new Set(TARGETS.map((target) => target.id)).size).toBe(TARGETS.length)
  TARGETS.forEach((target) => expect(target.id).toBe(`${target.loader}-${target.minecraft}`))
  expect(TARGETS.filter((target) => target.ready).map((target) => target.id)).toEqual([DEFAULT_TARGET, "neoforge-1.21.1", "forge-1.20.1"])
  const profile = resolveProfile("fabric-1.21.1")
  expect(targetById(DEFAULT_TARGET)).toEqual({
    id: "fabric-1.21.1",
    minecraft: "1.21.1",
    loader: "fabric",
    loaderVersion: profile.loader,
    java: profile.java.major,
    ready: true,
    why: null,
  })
  expect(targetById("fabric-9.9")).toBeUndefined()
})

test("还不能做的组合都灰着并说清为什么，加载器版本不编造", () => {
  const waiting = TARGETS.filter((target) => !target.ready)
  expect(waiting.length).toBeGreaterThan(0)
  // Every combination still waiting has no manifest: nothing is pinned for it yet.
  waiting.forEach((target) => {
    expect(findTargetManifest(target.id)).toBeUndefined()
    expect(target.loaderVersion).toBeNull()
    expect(target.why).toBe("这个组合 Studio 还生成不了代码：还没有为它写好并在游戏里验证过生成模板。")
  })
  // The two with a manifest besides Fabric are ready, with the checked versions and no reason against them.
  expect(targetById("forge-1.20.1")).toMatchObject({ ready: true, why: null, loaderVersion: "47.4.28", java: 17 })
  expect(targetById("neoforge-1.21.1")).toMatchObject({ ready: true, why: null, loaderVersion: "21.1.266", java: 21 })
})

test("每个游戏版本要的 Java 和真实的加载器组合", () => {
  const java = Object.fromEntries(TARGETS.map((target) => [target.minecraft, target.java]))
  expect(java).toEqual({
    "1.21.1": 21,
    "1.21.4": 21,
    "1.20.6": 21,
    "1.20.4": 17,
    "1.20.1": 17,
    "1.19.2": 17,
    "1.18.2": 17,
    "1.16.5": 8,
    "1.12.2": 8,
  })
  expect(targetById("fabric-1.12.2")).toBeUndefined()
  expect(targetById("forge-1.12.2")).toBeDefined()
  expect(targetById("fabric-1.16.5")).toBeDefined()
  expect(targetById("neoforge-1.20.1")).toBeDefined()
  expect(TARGETS.filter((target) => target.loader === "neoforge").map((target) => target.minecraft)).toEqual([
    "1.21.1",
    "1.21.4",
    "1.20.6",
    "1.20.4",
    "1.20.1",
  ])
  expect(TARGETS.filter((target) => target.loader === "quilt").map((target) => target.minecraft)).not.toContain("1.16.5")
  expect(targetById("quilt-1.18.2")).toBeDefined()
  expect(TARGETS.filter((target) => target.loader === "forge")).toHaveLength(9)
})
