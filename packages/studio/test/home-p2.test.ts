import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { recentWorlds, thingCount, WORLDS_SHOWN, worldLine, worldWaits } from "../src/renderer/features/home-worlds-model"

const renderer = path.resolve("src/renderer")
const project = (over: Record<string, unknown> = {}) => ({ entities: [], blocks: [], items: [], recipes: [], conception: { entries: [] }, workspace: { assets: [] }, updated_at: "2026-10-20T08:00:00.000Z", ...over }) as never

test("接着做：最近改过的在前，只列三样，不动原来的顺序", () => {
  const entries = ["2026-10-01", "2026-10-30", "2026-10-20", "2026-10-25"].map((day, index) => ({ id: index, project: { updated_at: `${day}T00:00:00.000Z` } }))
  expect(recentWorlds(entries).map((value) => value.id)).toEqual([1, 3, 2])
  expect(WORLDS_SHOWN).toBe(3)
  expect(entries[0]!.id).toBe(0)
  expect(recentWorlds([])).toEqual([])
})

test("接着做的每一行只写取得到的事：样数按东西算，时间说改过，没有等验收就不提", () => {
  const same = { id: "a" }
  expect(thingCount(project({ entities: [same], workspace: { assets: [same, { id: "b" }] } }))).toBe(2)
  expect(worldLine(project({ items: [same] }))).toMatch(/^1 样东西 · 10-2\d 改过$/)
  expect(worldLine(project())).toMatch(/^还是空的 · /)
  expect(worldWaits(2)).toBe("2 样等你验收")
  for (const value of [0, null, undefined]) expect(worldWaits(value)).toBeNull()
})

test("首页保留两个入口，图鉴和设置都能到存储空间，设置也能到工具", () => {
  const app = readFileSync(path.join(renderer, "studio-app.tsx"), "utf8")
  const ways = app.slice(app.indexOf('<nav class="title-ways"'), app.indexOf("</nav>", app.indexOf('<nav class="title-ways"')))
  expect(ways).toContain("打开或导入工程")
  expect(ways).toContain("模组图鉴")
  for (const gone of ["存储空间", "导入工程\n"]) expect(ways).not.toContain(gone)
  expect(app).toContain("void openExistingProject()")
  expect(app).toContain("window.studio.chooseImport()")
  const resources = readFileSync(path.join(renderer, "features/resource-manager.tsx"), "utf8")
  expect(resources).toContain('storage: "存储空间"')
  expect(resources).toContain("props.onTab(key)")
  const settings = readFileSync(path.join(renderer, "features/personal-settings.tsx"), "utf8")
  for (const tab of ["tools", "storage"]) expect(settings).toContain(`props.onResources("${tab}")`)
})

test("封面动效都有减少动画的开关，循环距离是整块石头，不会跳", () => {
  const css = readFileSync(path.join(renderer, "features/home-worlds.css"), "utf8")
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))
  for (const animated of ['.studio-root[data-page="home"]::before', ".title-screen .mm-logo-face", ".mm-world-play svg"]) {
    expect(css).toContain(animated)
    expect(reduced).toContain(animated)
  }
  expect(reduced).toContain("animation: none")
  const world = readFileSync(path.join(renderer, "world.css"), "utf8")
  expect(world).toContain("64px 64px")
  expect(512 % 64).toBe(0)
  expect(css).toContain("background-position: -512px 0")
  // The pulsing line under the title was there before, with its own switch.
  expect(world.slice(world.indexOf("@media (prefers-reduced-motion: reduce)", world.indexOf(".title-way:hover")))).toContain(".mm-splash")
})
