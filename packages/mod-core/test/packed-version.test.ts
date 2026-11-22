import { expect, test } from "bun:test"
import { VERSION_WORDS, namesOf, packedVersion, whenPacked, type PackedBuild, type PackedItem } from "../src/packed-version"

// The round 20 story: four things saved, the person pressed 「构建并试玩」; while the game's files downloaded, an outside AI saved two gameplay things.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const thing = (n: number, title: string, kind = "item", revision = 1, saved = true): PackedItem => ({ asset_id: id(n), kind, title, saved, revision })
const four = [thing(1, "铜猫头鹰", "entity"), thing(2, "铜块", "block"), thing(3, "铜锭", "item"), thing(4, "铜配方", "recipe")]
const pack = (over: Partial<PackedBuild> = {}): PackedBuild => ({ job_id: id(900), revision: 12, finished_at: new Date(2026, 9, 19, 10, 32).toISOString(), assets: four.map((item) => ({ id: item.asset_id!, revision: 1 })), ...over })
const now = new Date(2026, 9, 19, 11, 0)

test("打包的是一个确定的版本：含几样、什么时候打的，之后又存了新东西不会改写这一版", () => {
  const later = [...four, thing(5, "守匣警报", "gameplay"), thing(6, "夜盾", "gameplay")]
  const version = packedVersion(pack(), 14, later)
  expect(version).toMatchObject({ current: false, contains: 4, revision: 12 })
  expect(version.added.map((value) => value.title)).toEqual(["守匣警报", "夜盾"])
  expect(version.changed).toEqual([])
  // The same pack read against the project as it was when it was made says the same of what it holds.
  expect(packedVersion(pack(), 12, four)).toMatchObject({ current: true, contains: 4, added: [], changed: [] })
  expect(VERSION_WORDS.version(version, now)).toBe("10:32 打包的那一版，含 4 样")
})

test("正在打开的是哪一版、打包以后又做好了什么、这一版里没有——各说各的，不混着现在的数量", () => {
  const version = packedVersion(pack(), 14, [...four, thing(5, "守匣警报", "gameplay"), thing(6, "夜盾", "gameplay")])
  expect(VERSION_WORDS.using(version, "play", now)).toBe("正在打开的是 10:32 打包的那一版，含 4 样。")
  expect(VERSION_WORDS.using(version, "check", now)).toContain("正在检查的是 10:32")
  expect(VERSION_WORDS.later(version)).toBe("打包以后又做好了 2 样（「守匣警报」、「夜盾」），这一版里没有。")
  // The count of the pack never moves when the project does.
  expect(VERSION_WORDS.using(version, "play", now)).not.toContain("6")
  expect(VERSION_WORDS.again("play")).toBe("重新打包并打开")
  expect(VERSION_WORDS.again("jar")).toBe("重新打包")
  // The game's download is not wasted by packing again, said while the game is still being got ready.
  expect(VERSION_WORDS.keeps).toContain("不会白费")
  // A pack that is the project as it is has nothing to add.
  expect(VERSION_WORDS.later(packedVersion(pack(), 12, four))).toBe("")
})

test("打包以后改过的东西单独说：这一版里还是改之前的样子；只改了模组信息也不假装没变", () => {
  const edited = four.map((item, index) => (index === 0 ? { ...item, revision: 3 } : item))
  const version = packedVersion(pack(), 13, edited)
  expect(version.changed.map((value) => value.title)).toEqual(["铜猫头鹰"])
  expect(version.contains).toBe(4)
  expect(VERSION_WORDS.later(version)).toBe("打包以后又改过 1 样（「铜猫头鹰」），这一版里还是改之前的样子。")
  const both = packedVersion(pack(), 14, [...edited, thing(5, "夜盾", "gameplay")])
  expect(VERSION_WORDS.later(both)).toBe("打包以后又做好了 1 样（「夜盾」），这一版里没有。打包以后又改过 1 样（「铜猫头鹰」），这一版里还是改之前的样子。")
  // The project was saved but no thing differs (the mod's name, icon, author…): still not the project as it is.
  expect(VERSION_WORDS.later(packedVersion(pack(), 13, four))).toBe("打包以后工程又存过别的修改（比如模组信息），这一版不是现在的样子。")
})

test("只算存好了的东西；设计稿和还没做出来的不算进这一版，也不算成之后做好的", () => {
  const items = [...four, thing(5, "还没做的", "item", 1, false)]
  expect(packedVersion(pack(), 14, items)).toMatchObject({ contains: 4, added: [] })
})

test("打包的记录读不到、工程又往前走了：不报数字，也不列名字，只说是哪个时间的那一版", () => {
  const version = packedVersion(pack({ assets: [] }), 14, four)
  expect(version).toMatchObject({ contains: null, added: [], changed: [], current: false })
  expect(VERSION_WORDS.version(version, now)).toBe("10:32 打包的那一版")
  expect(VERSION_WORDS.later(version)).toContain("不是现在的样子")
})

test("时间：今天只说几点几分，以前的要带上日子", () => {
  expect(whenPacked(new Date(2026, 9, 19, 9, 5).toISOString(), now)).toBe("09:05")
  expect(whenPacked(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe("10 月 18 日 23:59")
  expect(whenPacked("不是时间", now)).toBe("")
})

test("名字最多说三个，多的用「等」带过", () => {
  const list = ["甲", "乙", "丙", "丁"].map((title) => ({ title }))
  expect(namesOf(list.slice(0, 2))).toBe("「甲」、「乙」")
  expect(namesOf(list)).toBe("「甲」、「乙」、「丙」等")
})

test("包里有几样来自打包时写下的清单：清单里的东西现在的列表里找不到（计划不做、正被改、已删）也照样计入", () => {
  // The list of things no longer has 铜块 and 铜锭 (the newest plan sets them aside); the manifest still lists all four.
  const version = packedVersion(pack(), 14, [four[0]!, four[3]!, thing(5, "夜盾", "gameplay")])
  expect(version.contains).toBe(4)
  expect(version.added.map((value) => value.title)).toEqual(["夜盾"])
  expect(packedVersion(pack(), 14, [])).toMatchObject({ contains: 4, added: [], changed: [] })
  // Content from before assets existed is not in the manifest: placed only while the project is what the pack was made from.
  const old: PackedItem = { asset_id: null, kind: "block", title: "旧方块", saved: true, revision: null }
  expect(packedVersion(pack(), 12, [...four, old]).contains).toBe(5)
  expect(packedVersion(pack(), 14, [...four, old]).contains).toBe(4)
})
