import { expect, test } from "bun:test"
import { briefForCreator, creatorWords } from "../src/creator-words"
import type { Project } from "../src/project"

test("保留中文要求，把夹在要求中的规格放到高级", () => {
  expect(briefForCreator("做一把铜剑。max_stack 1, tool {kind sword}")).toBe("做一把铜剑。")
  expect(briefForCreator('血条用青铜色，background "bronze"；fill #C8202A, drain left')).toBe("血条用青铜色")
  expect(briefForCreator("shaped minecraft:iron_block")).toBe("")
  expect(briefForCreator("awaken（苏醒）时发出低吼。")).toBe("苏醒时发出低吼。")
})

test("物品、招式和有说明的部件保留名字，查看技术细节时能找到原记录", () => {
  const project = {
    mod_id: "azure", items: [{identifier:"shard", name:"蓝晶碎片"}], blocks: [],
    workspace: {assets: [
      {id:"model", title:"石像", document:{kind:"model", bones:[{name:"leg_r"}]}},
      {id:"boss", title:"守卫", document:{kind:"entity",model_asset_id:"model",abilities:[{id:"bang_quake",name:"震地"}]}},
    ]},
  } as unknown as Project
  const words = creatorWords(project, "model", [{name:"leg_r",what:"右后腿"}])
  const line = "「bang_quake」踩下「leg_r」，掉出 minecraft:dark_oak_log 和 azure:shard"
  expect(words(line)).toBe("「震地」踩下「右后腿」，掉出 深色橡木原木 和 蓝晶碎片")
  expect(words(line, true)).toContain("右后腿（leg_r）")
  expect(words("用 `/locate structure azure:den` 找巢")).not.toContain("/locate")
})

test("错误提示保留环境变量、路径和命令，普通文案仍照常换词", () => {
  const words = creatorWords({ mod_id: "fixture", items: [], blocks: [], workspace: { assets: [] } } as unknown as Project)
  const message = "排查 JAVA_HOME、GRADLE_USER_HOME 和「C:/MineMods tools/jdk_cache」。运行 `java -version`。"
  expect(words(message)).toBe(message)
  expect(words(message, true)).toBe(message)
})
