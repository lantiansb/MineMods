import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readCatalog, recordItem, releaseUser, removeItems, useItem } from "../src/store/catalog"
import { registerEarlierThings, storeIds, storeLayout } from "../src/store/layout"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
const runtime = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-仓库-"))
  directories.push(directory)
  return directory
}
const item = (id: string, relative: string, users: string[] = []) => ({
  id,
  kind: "jdk" as const,
  title: id,
  path: relative,
  bytes: 10,
  source: "bmclapi",
  sha256: null,
  installed_at: "2026-11-14T00:00:00.000Z",
  users,
})

test("登记、被谁用、最近使用时间；同一样东西再登记不丢使用者", async () => {
  const root = await runtime()
  await recordItem(root, item("jdk:17", storeLayout.jdk({ major: 17, version: "17.0.21+9", distribution: "temurin" }), ["target:forge-1.20.1"]))
  await useItem(root, "jdk:17", "project:00000000-0000-4000-8000-000000000001", new Date("2026-11-14T08:00:00Z"))
  await recordItem(root, { ...item("jdk:17", "store/jdks/temurin-17-17.0.21_9"), bytes: 99 })
  const listed = (await readCatalog(root)).items
  expect(listed).toHaveLength(1)
  expect(listed[0]).toMatchObject({ bytes: 99, last_used_at: "2026-11-14T08:00:00.000Z", users: ["target:forge-1.20.1", "project:00000000-0000-4000-8000-000000000001"] })
  expect(() => recordItem(root, item("jdk:8", "../outside"))).toThrow("UNSAFE_STORE_PATH")
})

test("清理没用的：只删没人用的；有人用的留着并说是谁；强制才删", async () => {
  const root = await runtime()
  for (const name of ["a", "b"]) {
    await mkdir(path.join(root, "store", name), { recursive: true })
    await writeFile(path.join(root, "store", name, "f.bin"), "x")
  }
  await recordItem(root, item("jdk:17", "store/a", ["target:forge-1.20.1"]))
  await recordItem(root, item("jdk:21", "store/b"))
  const first = await removeItems(root)
  expect(first).toEqual({ removed: ["jdk:21"], kept: [], freedBytes: 10 })
  expect(await stat(path.join(root, "store", "b")).catch(() => null)).toBeNull()
  const asked = await removeItems(root, { ids: ["jdk:17"] })
  expect(asked.kept).toEqual([{ id: "jdk:17", users: ["target:forge-1.20.1"] }])
  expect(await stat(path.join(root, "store", "a"))).toBeTruthy()
  await releaseUser(root, "target:forge-1.20.1")
  expect((await removeItems(root)).removed).toEqual(["jdk:17"])
  expect((await readCatalog(root)).items).toEqual([])
})

test("坏掉的清单从头来，不会把 Studio 卡住；并发写不丢条目", async () => {
  const root = await runtime()
  await mkdir(path.join(root, "store"), { recursive: true })
  await writeFile(path.join(root, "store", "catalog.json"), "{ not json")
  expect(await readCatalog(root)).toEqual({ schema_version: 1, items: [] })
  await Promise.all(Array.from({ length: 12 }, (_, index) => recordItem(root, item(`jdk:${index + 1}`, `store/j${index}`))))
  expect((await readCatalog(root)).items).toHaveLength(12)
  expect(JSON.parse(await readFile(path.join(root, "store", "catalog.json"), "utf8")).schema_version).toBe(1)
})

test("以前就有的 JDK、Gradle 缓存、Fabric 测试场原地登记，不移动不重下", async () => {
  const root = await runtime()
  await mkdir(path.join(root, "java-21", "bin"), { recursive: true })
  await writeFile(path.join(root, "java-21", "bin", "java.exe"), "12345")
  await mkdir(path.join(root, "scene", "fabric-1.21.1", "assets"), { recursive: true })
  expect(await registerEarlierThings(root)).toEqual(["jdk:21", "scene:fabric-1.21.1"])
  const listed = (await readCatalog(root)).items
  expect(listed.find((entry) => entry.id === "jdk:21")).toMatchObject({ path: "java-21", bytes: 5, source: "registered" })
  expect(listed.find((entry) => entry.id === "scene:fabric-1.21.1")?.users).toEqual(["target:fabric-1.21.1"])
  expect(storeIds.instance("00000000-0000-4000-8000-000000000001", "forge-1.20.1")).toBe("instance:00000000-0000-4000-8000-000000000001.forge-1.20.1")
})
