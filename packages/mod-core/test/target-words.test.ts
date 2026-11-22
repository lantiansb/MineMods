import { expect, test } from "bun:test"
import { listed, readyTargetIds, targetWords, targetsWords } from "../src/target/words"

test("a target's facts in plain words come from its manifest", () => {
  expect(targetWords("fabric-1.21.1")).toMatchObject({
    minecraft: "1.21.1",
    loader: "Fabric",
    loaderVersion: "0.17.2",
    loaderFull: "Fabric Loader 0.17.2",
    api: "Fabric API",
    java: 21,
    javas: [21],
    naming: { kind: "official", scheme: "Mojang 官方命名", names: "Mojang 官方名称", other: "Yarn 名称" },
    geckolib: "4.8.3",
    folders: "singular",
    line: "Minecraft 1.21.1 · Fabric 0.17.2 · Java 21",
    template: "Minecraft 1.21.1、Fabric Loader 0.17.2、Java 21",
    ready: true,
  })
  expect(targetWords("forge-1.20.1")).toMatchObject({
    minecraft: "1.20.1",
    loader: "Forge",
    loaderFull: "Forge 47.4.28",
    api: "Forge",
    java: 17,
    javas: [17, 21],
    naming: { scheme: "Mojang 官方命名", names: "Mojang 官方名称", other: "Yarn 名称" },
    geckolib: "4.8.4",
    folders: "plural",
    line: "Minecraft 1.20.1 · Forge 47.4.28 · Java 17",
    ready: true,
  })
  expect(targetWords("neoforge-1.21.1")).toMatchObject({ loaderFull: "NeoForge 21.1.266", java: 21, geckolib: "4.9.3", naming: { scheme: "Mojang 官方命名" }, folders: "singular" })
  // Left out, the default target.
  expect(targetWords().id).toBe("fabric-1.21.1")
})

test("with no project at hand a text is about the ready targets", () => {
  expect(readyTargetIds()).toEqual(["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"])
  expect(targetsWords().map((words) => words.id)).toEqual(["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"])
  expect(targetsWords(["forge-1.20.1", "fabric-1.21.1", "forge-1.20.1"]).map((words) => words.id)).toEqual(["forge-1.20.1", "fabric-1.21.1"])
  expect(listed([21, 17, 21])).toBe("21、17")
})
