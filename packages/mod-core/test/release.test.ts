import { afterEach, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { compileContent } from "../src/content"
import { blockFacets } from "../src/content-facets"
import { DATA_CAPABILITY, SCENE_CHECK_WORDS, dataWords, needsTool } from "../src/data-words"
import { mushroomCowDesign } from "../src/example"
import { EGG_COLORS, compileEntity, eggColors } from "../src/fabric/entity"
import { MOD_ICON, givenIcon, iconBytes, iconUrl, modIcon } from "../src/fabric/icon"
import { resolveProfile } from "../src/fabric/profile"
import { dependencyRanges, scaffoldProject } from "../src/fabric/scaffold"
import { GAMEPLAY_NO_GAME_WORDS, PLAYTEST_WORDS } from "../src/gameplay-words"
import { modGuide } from "../src/guide"
import { encodePng } from "../src/png"
import { decodeRgbaPng } from "../src/png-decode"
import { ProjectSchema } from "../src/project"
import { GIVEN_ICON, ICON_WORDS, RELEASE_DEFAULTS, RELEASE_LICENSES, ReleaseSchema, jarName, licenseNotice, modVersion, releaseContact } from "../src/release"
import { SCENE_WORDS } from "../src/scene"
import { builtWorkspaceAssets } from "../src/workspace"
import { ASSET_KINDS, DESIGN_ONLY_WORDS, MODULES, designNote, ModuleKindSchema } from "../src/workspace-modules"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const fixtures = path.join(import.meta.dir, "fixtures", "pre-0a")
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const legacy = async () => JSON.parse(await readFile(path.join(fixtures, "project.json"), "utf8"))

/** The old sample with something changed in its project file, assembled the way a build does. */
async function assembled(change: (project: Record<string, any>) => Record<string, any>, options: { author?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-release-"))
  roots.push(root)
  const original = await legacy()
  await writeFile(path.join(root, "minemods.project.json"), `${JSON.stringify(change(original))}\n`)
  await mkdir(path.join(root, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(path.join(fixtures, "model-asset.json"), path.join(root, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  const source = path.join(root, "source")
  await mkdir(source)
  const result = await assembleBuildSource(root, source, TEMPLATE, options)
  const text = (name: string) => readFile(path.join(source, name), "utf8")
  return { source, result, text, metadata: JSON.parse(await text("src/main/resources/fabric.mod.json")) }
}

const year = String(new Date().getFullYear())

// ---- 1. release metadata ----

test("发布信息是可选的：旧工程没有它，写错的值说得出哪里不对", async () => {
  const old = ProjectSchema.parse(await legacy())
  expect("release" in old).toBe(false)
  expect(modVersion(old)).toBe("0.1.0")
  expect(jarName(old)).toBe("legacy_sample-0.1.0.jar")
  expect(ReleaseSchema.parse({})).toEqual({})
  expect(Object.keys(RELEASE_LICENSES)).toEqual(["MIT", "Apache-2.0", "GPL-3.0-only", "LGPL-3.0-only", "MPL-2.0", "CC0-1.0", "ARR"])
  expect(ReleaseSchema.safeParse({ version: "1.2.3-beta.1" }).success).toBe(true)
  for (const version of ["1.2", "v1.2.3", "1.2.3+build", "1.2.3-"]) expect(ReleaseSchema.safeParse({ version }).success).toBe(false)
  expect(ReleaseSchema.safeParse({ license: "WTFPL" }).success).toBe(false)
  expect(ReleaseSchema.safeParse({ author: "x".repeat(81) }).success).toBe(false)
  expect(ReleaseSchema.safeParse({ author: "两行\n名字" }).success).toBe(false)
  for (const homepage of ["http://example.com", "https://exa mple.com", "example.com", 'https://example.com/"x']) expect(ReleaseSchema.safeParse({ homepage }).success).toBe(false)
  expect(ReleaseSchema.safeParse({ homepage: "http://example.com" }).error?.issues[0]?.message).toBe("链接要以 https:// 开头，中间不能有空格。")
  expect(releaseContact(undefined)).toBeUndefined()
  expect(releaseContact({ version: "1.0.0" })).toBeUndefined()
  expect(releaseContact({ issues: "https://example.com/issues" })).toEqual({ issues: "https://example.com/issues" })
})

test("没有发布信息的旧工程：作者、许可、版本、图标和联系方式都和以前一样", async () => {
  const built = await assembled((project) => project)
  expect(built.metadata.authors).toEqual([RELEASE_DEFAULTS.author])
  expect(built.metadata.license).toBe("MIT")
  expect("contact" in built.metadata || "icon" in built.metadata).toBe(false)
  expect(await built.text("gradle.properties")).toContain("mod_version=0.1.0\n")
  expect(await built.text("LICENSE")).toStartWith(`MIT License\n\nCopyright (c) ${year} MineMods Studio\n`)
  expect((await readdir(path.join(built.source, "src/main/resources/assets/legacy_sample"))).includes(MOD_ICON.file)).toBe(false)
})

test("发布信息写进 fabric.mod.json、gradle.properties、LICENSE 和 jar 的文件名", async () => {
  const release = { author: "天天玩AI", version: "1.2.0-beta.1", license: "MIT", homepage: "https://example.com/mod", issues: "https://example.com/mod/issues" }
  const built = await assembled((project) => ({ ...project, release }), { author: "昵称" })
  expect(built.metadata.authors).toEqual(["天天玩AI"])
  expect(built.metadata.license).toBe("MIT")
  expect(built.metadata.version).toBe("${version}")
  expect(built.metadata.contact).toEqual({ homepage: release.homepage, issues: release.issues })
  expect(built.metadata.icon).toBe("assets/legacy_sample/icon.png")
  expect(built.metadata.entrypoints.main).toEqual(["com.minemods.content_legacy_sample.StudioContent"])
  expect(await built.text("gradle.properties")).toContain("mod_version=1.2.0-beta.1\n")
  expect(await built.text("LICENSE")).toStartWith(`MIT License\n\nCopyright (c) ${year} 天天玩AI\n\nPermission is hereby granted`)
  expect(jarName(built.result.project)).toBe("legacy_sample-1.2.0-beta.1.jar")
  expect(built.result.guide.markdown).toContain("这个模组的 legacy_sample-1.2.0-beta.1.jar、")
  // The saved project in the backup keeps the release as written.
  expect(JSON.parse(await built.text("project-backup/minemods.project.json")).release).toEqual(release)
  // The icon: the first item's 16 × 16 picture, every pixel a square of 8 × 8.
  const item = decodeRgbaPng(await readFile(path.join(built.source, "src/main/resources/assets/legacy_sample/textures/item/moon_dew.png")))
  const icon = decodeRgbaPng(await readFile(path.join(built.source, "src/main/resources/assets/legacy_sample/icon.png")))
  expect([item.width, item.height, icon.width, icon.height]).toEqual([16, 16, 128, 128])
  expect([...icon.pixels.subarray(0, 4)]).toEqual([0x99, 0xcc, 0xff, 255])
})

test("只有联系方式没有别的：只多出 contact；没有 16×16 图的工程没有图标", async () => {
  const large = `data:image/png;base64,${Buffer.from(encodePng(new Uint8Array(32 * 32 * 4).fill(255), 32, 32)).toString("base64")}`
  const built = await assembled((project) => ({ ...project, release: { sources: "https://example.com/src" }, items: project.items.map((item: Record<string, unknown>) => ({ ...item, texture: large })), blocks: project.blocks.map((block: Record<string, unknown>) => ({ ...block, texture: large })) }))
  expect(built.metadata.contact).toEqual({ sources: "https://example.com/src" })
  expect("icon" in built.metadata).toBe(false)
  expect(built.metadata.authors).toEqual([RELEASE_DEFAULTS.author])
})

test("打包时给的名字只在工程自己没写作者时用", async () => {
  expect((await assembled((project) => project, { author: "  昵称  " })).metadata.authors).toEqual(["昵称"])
  expect((await assembled((project) => ({ ...project, release: { version: "2.0.0" } }), { author: "昵称" })).metadata.authors).toEqual(["昵称"])
  // A name that cannot be printed on one line is left out; the build goes on with what it always said.
  expect((await assembled((project) => project, { author: "两行\n名字" })).metadata.authors).toEqual([RELEASE_DEFAULTS.author])
})

test("别的许可只写一份短说明：点名许可和作者，说全文在哪，不贴全文", async () => {
  const apache = await assembled((project) => ({ ...project, release: { author: "天天玩AI", license: "Apache-2.0" } }))
  expect(apache.metadata.license).toBe("Apache-2.0")
  expect(await apache.text("LICENSE")).toBe(`旧工程样例\nAuthor: 天天玩AI (${year})\n\nLicensed under the Apache License 2.0 (SPDX identifier: Apache-2.0).\nThis file names the licence; its full text is at https://spdx.org/licenses/Apache-2.0.html\n`)
  expect(await apache.text("README.md")).toContain("Author: 天天玩AI. Licensed under Apache-2.0.")
  const reserved = await assembled((project) => ({ ...project, release: { author: "天天玩AI", license: "ARR" } }))
  expect(reserved.metadata.license).toBe("All-Rights-Reserved")
  expect(await reserved.text("LICENSE")).toBe(`Copyright (c) ${year} 天天玩AI\n\nAll rights reserved.\n`)
  for (const license of ["GPL-3.0-only", "LGPL-3.0-only", "MPL-2.0", "CC0-1.0"] as const) {
    const notice = licenseNotice(license, { name: "模组", author: "某人", year: "2026" })
    expect(notice).toContain(RELEASE_LICENSES[license].name)
    expect(notice).toContain(`https://spdx.org/licenses/${license}.html`)
    expect(notice.split("\n").length).toBeLessThan(8)
  }
})

test("图标只从 16×16 的图放大，读不了的图就没有图标", () => {
  const pixels = new Uint8Array(16 * 16 * 4)
  pixels.set([10, 20, 30, 255], 0)
  pixels.set([40, 50, 60, 255], 4)
  const icon = decodeRgbaPng(modIcon(encodePng(pixels, 16, 16))!)
  const at = (x: number, y: number) => [...icon.pixels.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)]
  expect([at(0, 0), at(7, 7), at(8, 0), at(15, 7), at(16, 0), at(0, 8)]).toEqual([[10, 20, 30, 255], [10, 20, 30, 255], [40, 50, 60, 255], [40, 50, 60, 255], [0, 0, 0, 0], [0, 0, 0, 0]])
  expect(modIcon(encodePng(new Uint8Array(32 * 32 * 4), 32, 32))).toBeNull()
  expect(modIcon(new Uint8Array([1, 2, 3]))).toBeNull()
})

test("人自己给的图标：正方形的 PNG 才收，小的整数倍放大到 128，大的原样留，其余说清楚为什么不行", () => {
  const square = (side: number, color: number[] = [10, 20, 30, 255]) => {
    const pixels = new Uint8Array(side * side * 4)
    for (let at = 0; at < side * side; at++) pixels.set(color, at * 4)
    return encodePng(pixels, side, side)
  }
  // 16, 32 and 64 are enlarged by whole steps to the 128 the game's mod list is drawn from.
  for (const side of GIVEN_ICON.smallSides) {
    const made = givenIcon(square(side))
    expect(made.ok).toBe(true)
    if (!made.ok) continue
    const image = decodeRgbaPng(made.png)
    expect([image.width, image.height, made.side, made.scaled]).toEqual([128, 128, side, true])
    expect([...image.pixels.subarray(0, 4)]).toEqual([10, 20, 30, 255])
  }
  // 128 to 512 are kept byte for byte: nothing is redrawn that did not need to be.
  for (const side of [128, 200, 512]) {
    const png = square(side)
    const made = givenIcon(png)
    expect(made.ok && made.png === png && !made.scaled).toBe(true)
  }
  // A pixel stays a block: the corner of a 16 × 16 picture with one different pixel is an 8 × 8 block.
  const pixels = new Uint8Array(16 * 16 * 4)
  pixels.set([1, 2, 3, 255], 4)
  const enlarged = givenIcon(encodePng(pixels, 16, 16))
  const picture = enlarged.ok ? decodeRgbaPng(enlarged.png) : null
  expect([[8, 0], [15, 7], [16, 0], [8, 8]].map(([x, y]) => [...picture!.pixels.subarray((y! * 128 + x!) * 4, (y! * 128 + x!) * 4 + 4)])).toEqual([[1, 2, 3, 255], [1, 2, 3, 255], [0, 0, 0, 0], [0, 0, 0, 0]])
  const refused = (png: Uint8Array) => {
    const made = givenIcon(png)
    return made.ok ? null : made.text
  }
  expect(refused(encodePng(new Uint8Array(64 * 32 * 4), 64, 32))).toBe(ICON_WORDS.notSquare(64, 32))
  expect(refused(square(48))).toBe(ICON_WORDS.wrongSide(48))
  expect(refused(square(700))).toBe(ICON_WORDS.wrongSide(700))
  expect(refused(new Uint8Array([1, 2, 3]))).toBe(ICON_WORDS.unreadable)
  expect(refused(new Uint8Array(GIVEN_ICON.maxBytes + 1))).toBe(ICON_WORDS.tooBig)
  // The stored form round-trips, and anything else is not one.
  const png = square(128)
  expect(iconBytes(iconUrl(png))).toEqual(new Uint8Array(png))
  expect(iconBytes("https://example.com/icon.png")).toBeNull()
  expect(iconBytes(null)).toBeNull()
})

test("给了图标的工程：图标是人给的那张，不看有没有发布信息；给的图坏了就退回原来的做法", async () => {
  const side = 64
  const pixels = new Uint8Array(side * side * 4)
  for (let at = 0; at < side * side; at++) pixels.set([200, 30, 40, 255], at * 4)
  const given = await assembled((project) => ({ ...project, icon: iconUrl(encodePng(pixels, side, side)) }))
  expect(given.metadata.icon).toBe("assets/legacy_sample/icon.png")
  const icon = decodeRgbaPng(await readFile(path.join(given.source, "src/main/resources/assets/legacy_sample/icon.png")))
  expect([icon.width, icon.height, ...icon.pixels.subarray(0, 4)]).toEqual([128, 128, 200, 30, 40, 255])
  // The project file may have been edited by hand into a picture that is not square: the build does not fail, and does what it did without one.
  const bad = await assembled((project) => ({ ...project, icon: iconUrl(encodePng(new Uint8Array(64 * 32 * 4), 64, 32)) }))
  expect("icon" in bad.metadata).toBe(false)
  expect(ProjectSchema.safeParse({ ...(await legacy()), icon: "https://example.com/x.png" }).success).toBe(false)
  expect(ProjectSchema.safeParse({ ...(await legacy()), icon: null }).success).toBe(true)
})

// ---- 2. dependency ranges ----

test("前置的版本范围：GeckoLib 接受同一大版本里更新的，Minecraft 写死，加载器和 Fabric API 是不低于", async () => {
  const profile = resolveProfile("fabric-1.21.1")
  expect(dependencyRanges(profile)).toEqual({ geckolib: ">=4.8.3 <5.0.0" })
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-release-"))
  roots.push(directory)
  await scaffoldProject({ templateDirectory: TEMPLATE, directory: path.join(directory, "mod"), modId: "ranges", name: "Ranges", packageName: "studio.ranges" })
  const metadata = JSON.parse(await readFile(path.join(directory, "mod/src/main/resources/fabric.mod.json"), "utf8"))
  expect(metadata.depends).toEqual({ fabricloader: `>=${profile.loader}`, minecraft: "1.21.1", java: ">=21", "fabric-api": `>=${profile.fabricApi}`, geckolib: ">=4.8.3 <5.0.0" })
  // What is compiled against stays the exact version.
  expect(await readFile(path.join(directory, "mod/gradle.properties"), "utf8")).toContain("geckolib_version=4.8.3")
  expect((await assembled((project) => project)).metadata.depends.geckolib).toBe(">=4.8.3 <5.0.0")
})

// ---- 3. blocks that drop by hand ----

const block = (extra: Record<string, unknown>) => ({ id: crypto.randomUUID(), identifier: `b_${Object.values(extra).join("_")}`.replaceAll("null", "x"), name: "方块", hardness: 2, luminance: 0, tool: "none", drop: "self", color: "#775533", ...extra })

test("只有镐挖的方块和要求工具材质的方块空手挖不掉东西；斧和锹只是挖得更快", () => {
  const blocks = [block({ tool: "pickaxe" }), block({ tool: "axe" }), block({ tool: "shovel" }), block({ tool: "none" }), block({ tool: "axe", tool_tier: "iron" }), block({ tool: "shovel", tool_tier: "stone" })]
  expect(blocks.map((value) => needsTool(value as Parameters<typeof needsTool>[0]))).toEqual([true, false, false, false, true, true])
  const files = compileContent({ mod_id: "azure", package_name: "com.minemods.content_azure", entities: [], blocks, items: [], recipes: [], logic: [] })
  const lines = String(files["src/main/java/com/minemods/content_azure/StudioContentRegistry.java"]).split("\n").filter((line) => line.includes("public static final Block "))
  expect(lines.map((line) => line.includes(".requiresCorrectToolForDrops()"))).toEqual([true, false, false, false, true, true])
  // The tool still mines it faster: the tags are as they were.
  expect(JSON.parse(String(files["src/main/resources/data/minecraft/tags/block/mineable/axe.json"])).values).toEqual(["azure:b_axe", "azure:b_axe_iron"])
  expect(JSON.parse(String(files["src/main/resources/data/minecraft/tags/block/mineable/shovel.json"])).values).toEqual(["azure:b_shovel", "azure:b_shovel_stone"])
  expect(JSON.parse(String(files["src/main/resources/data/minecraft/tags/block/needs_iron_tool.json"])).values).toEqual(["azure:b_axe_iron"])
})

test("说给人听的话跟着生成的代码走", async () => {
  expect(dataWords.breaks({ tool: "pickaxe" })).toBe("要用镐挖才掉东西")
  expect(dataWords.breaks({ tool: "axe" })).toBe("用斧头砍得更快，空手也能挖下来")
  expect(dataWords.breaks({ tool: "shovel" })).toBe("用锹铲得更快，空手也能挖下来")
  expect(dataWords.breaks({ tool: "none" })).toBe("空手就能挖")
  expect(dataWords.breaks({ tool: "axe", tool_tier: "iron" })).toBe("要用斧头砍才掉东西")
  const project = ProjectSchema.parse(await legacy())
  const withTool = (tool: "pickaxe" | "axe") => ({ ...project, blocks: project.blocks.map((value) => ({ ...value, tool })) })
  const guide = (tool: "pickaxe" | "axe") => modGuide(withTool(tool), { findings: [], animations: {}, glowing: [], built: false }).markdown
  expect(guide("pickaxe")).toContain("方块「秘匣」：硬度 1，会发光（亮度 3，最亮是 15），要用镐挖才掉东西；")
  expect(guide("axe")).toContain("方块「秘匣」：硬度 1，会发光（亮度 3，最亮是 15），用斧头砍得更快，空手也能挖下来；")
  const { id: _id, ...document } = withTool("axe").blocks[0]!
  expect(blockFacets(document, withTool("axe")).find((facet) => facet.question === "reaction")?.words).toStartWith("用斧头砍得更快，空手也能挖下来；")
  expect(blockFacets({ ...document, tool_tier: "iron" }, withTool("axe")).find((facet) => facet.question === "reaction")?.words).toStartWith("至少要用铁斧才挖得下来，用更差的工具挖什么都不掉")
})

// ---- 4. the creature's egg and shadow ----

const creature = { modId: "forest", packageName: "studio.forest", id: "cow", name: "牛", health: 20, speed: 0.2, attack_damage: 3, behavior: "passive" as const, model: mushroomCowDesign }
const picture = (colors: readonly (readonly [number, number, number, number, number])[]) => {
  const pixels = new Uint8Array(16 * 16 * 4)
  let at = 0
  colors.forEach(([red, green, blue, alpha, count]) => {
    for (let index = 0; index < count; index++, at += 4) pixels.set([red, green, blue, alpha], at)
  })
  return encodePng(pixels, 16, 16)
}

test("刷怪蛋的两个颜色取自生物自己的图：用得最多的，和用得最多的另一个看得出不同的", () => {
  // The second most used is a shade of the first (12 a channel, about 21 apart): it is passed over for the one that differs.
  expect(eggColors(picture([[100, 100, 100, 255, 100], [112, 112, 112, 255, 80], [200, 40, 40, 255, 30]]))).toEqual([0x646464, 0xc82828])
  // Transparent and half-transparent pixels are not the creature's colour, however many there are.
  expect(eggColors(picture([[1, 2, 3, 0, 120], [9, 9, 9, 128, 60], [10, 20, 30, 255, 40], [250, 240, 230, 255, 20]]))).toEqual([0x0a141e, 0xfaf0e6])
  // Exactly the threshold apart is still one material; one step further is another colour.
  expect(Math.round(0.12 * 255 * Math.sqrt(3))).toBe(EGG_COLORS.apart)
  expect(eggColors(picture([[0, 0, 0, 255, 9], [53, 0, 0, 255, 5]]))).toEqual(EGG_COLORS.fallback)
  expect(eggColors(picture([[0, 0, 0, 255, 9], [54, 0, 0, 255, 5]]))).toEqual([0x000000, 0x360000])
  // Fewer than two such colours, or nothing readable: the pair every egg had.
  expect(eggColors(picture([[10, 20, 30, 255, 256]]))).toEqual([0x6b7960, 0xd8b484])
  expect(eggColors(picture([[10, 20, 30, 0, 256]]))).toEqual(EGG_COLORS.fallback)
  expect(eggColors(new Uint8Array([1, 2, 3]))).toEqual(EGG_COLORS.fallback)
})

test("生成的生物用上这两个颜色；另画的贴图优先于模型自带的", () => {
  const content = (files: Record<string, string | Uint8Array>) => String(files["src/main/java/studio/forest/StudioContent.java"])
  const own = compileEntity(creature)
  const [first, second] = eggColors(own["src/main/resources/assets/forest/textures/entity/cow.png"] as Uint8Array).map((color) => `0x${color.toString(16).padStart(6, "0")}`)
  expect(content(own)).toContain(`new SpawnEggItem(CREATURE, ${first}, ${second}, new Item.Properties())`)
  expect([first, second]).not.toEqual(["0x6b7960", "0xd8b484"])
  const drawn = compileEntity({ ...creature, texture: picture([[0x33, 0x55, 0x33, 255, 200], [0x88, 0xaa, 0x66, 255, 56]]) })
  expect(content(drawn)).toContain("new SpawnEggItem(CREATURE, 0x335533, 0x88aa66, new Item.Properties())")
})

test("影子是碰撞箱宽度的一半；没写碰撞箱的生物还是原来的 0.45", () => {
  const renderer = (files: Record<string, string | Uint8Array>) => String(files["src/main/java/studio/forest/client/StudioCreatureRenderer.java"])
  expect(renderer(compileEntity(creature))).toContain("this.shadowRadius = 0.45f;")
  expect(renderer(compileEntity({ ...creature, hitbox: null }))).toContain("this.shadowRadius = 0.45f;")
  expect(renderer(compileEntity({ ...creature, hitbox: { core: { width: 0.6, height: 1.8 } } }))).toContain("this.shadowRadius = 0.3f;")
  expect(renderer(compileEntity({ ...creature, hitbox: { core: { width: 1.3965, height: 1.6 } } }))).toContain("this.shadowRadius = 0.6983f;")
  expect(renderer(compileEntity({ ...creature, hitbox: { core: { width: 2, height: 2 } } }))).toContain("this.shadowRadius = 1f;")
})

// ---- 5. what Studio does with a running game ----

test("不再说 Studio 从不启动游戏：说的是测试场这一项检查，和它看不到什么", () => {
  expect(SCENE_CHECK_WORDS).toBe("Studio 只在打包后可以做一项「测试场」检查：不开窗口地启动游戏自己的服务器，问游戏每样东西放不放得出来；它看不到画面，也不替人试玩。")
  expect(SCENE_CHECK_WORDS).toContain(`「${SCENE_WORDS.name}」`)
  expect(DATA_CAPABILITY.not_done.at(-1)).toBe(`这些都没有人在游戏里试玩过，试玩由用户自己做；${SCENE_CHECK_WORDS}`)
  expect(GAMEPLAY_NO_GAME_WORDS).toContain(SCENE_CHECK_WORDS)
  for (const text of [...DATA_CAPABILITY.done, ...DATA_CAPABILITY.not_done, DATA_CAPABILITY.summary, GAMEPLAY_NO_GAME_WORDS, PLAYTEST_WORDS]) expect(text).not.toMatch(/不启动 ?(游戏|Minecraft)，|都不启动游戏，|不会替你打开游戏/)
})

// ---- 6. kinds that build nothing ----

test("每一类要么会做进游戏，要么带着「只是设计稿」的标记和一句话", async () => {
  const project = ProjectSchema.parse(await legacy())
  // One asset of every kind: the old sample has twelve of them; the three kinds added later are built whenever saved.
  const assets = [...project.workspace.assets, ...ModuleKindSchema.options.filter((kind) => !project.workspace.assets.some((asset) => asset.module === kind)).map((kind) => ({ id: crypto.randomUUID(), module: kind, revision: 1, document: { kind } }))]
  expect([...new Set(assets.map((asset) => asset.module))].sort()).toEqual([...ModuleKindSchema.options].sort())
  // A boss bar is built once a boss shows it, as a texture is once a creature wears it: the first creature shows the one added here.
  const bar = assets.find((asset) => asset.module === "bossbar")!.id
  // Boss 能力 12: a fixture is built once a boss's arena puts it down: the first creature's arena puts down the one added here.
  const fixture = assets.find((asset) => asset.module === "fixture")!.id
  // 技能资产: an ability is built once something casts it: the first creature uses the one added here as an ability of its own.
  const ability = assets.find((asset) => asset.module === "ability")!.id
  const entities = project.entities.map((entity, index) => (index ? entity : { ...entity, behavior: "hostile", boss: { music: { asset: assets.find(a => a.module === "music")!.id, starts: "fight", fade_seconds: 1 }, bar: { look: { asset: bar } }, arena: { fixtures: [{ look: { asset: fixture } }] } }, shared_abilities: [{ asset: ability }] }))
  const built = new Set(builtWorkspaceAssets({ ...project, entities, workspace: { ...project.workspace, assets } } as typeof project).map((asset) => asset.module))
  ASSET_KINDS.forEach((kind) => {
    expect(kind.capability === "design").toBe(!built.has(kind.id))
    expect(kind.design_note).toBe(built.has(kind.id) ? null : DESIGN_ONLY_WORDS)
    for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) expect(designNote(kind.id, target)).toBe(kind.design_note)
    expect(MODULES[kind.id].design_note).toBe(kind.design_note)
  })
  expect(DESIGN_ONLY_WORDS).toBe("这一类现在只是设计稿，不会做进游戏")
  expect(ASSET_KINDS.filter((kind) => kind.design_note).map((kind) => kind.id)).toEqual(["animation", "worldview", "biome", "dimension", "terrain"])
})
