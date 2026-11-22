import { describe, expect, test } from "bun:test"
import { getModuleSchema } from "@minemods/mod-core/workspace"
import { HAND_KINDS, handShape, type HandField } from "../src/main/content-service"
import { HAND_SHAPES } from "../src/renderer/features/asset-edit-shape"
import { changedLabels, check, formOf, isPlain, plainIssue, rangeWords, same, setAt, shapeAt, wordAt } from "../src/renderer/features/asset-edit-form"
import { BLANK_KINDS, ENTITY_BASICS, HAND_KEPT, HAND_WORDS, ISSUE_WORDS, blankDocument, freeIdentifier, settle, type Loose } from "../src/renderer/features/asset-edit-words"

const block = (overrides: Loose = {}): Loose => ({ kind: "block", identifier: "moon_block", name: "月块", hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#335577", texture: null, ...overrides })
const creature = (overrides: Loose = {}): Loose => ({ kind: "entity", name: "月牛", description: "", health: 10, speed: 0.2, attack_damage: 0, behavior: "passive", model_asset_id: "7d4c4d0e-6f0a-4d53-9d55-0b1a5b0f8a11", runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, ...overrides })
const keys = (kind: (typeof HAND_KINDS)[number], document: Loose, advanced = false, basics = false) => formOf(kind, document, { advanced, basics }).flatMap((section) => section.fields.map((field) => field.key))
const field = (kind: (typeof HAND_KINDS)[number], document: Loose, key: string) => formOf(kind, document, { advanced: true }).flatMap((section) => section.fields).find((value) => value.key === key)!

/** Every place of a shape that holds one plain value, with `*` for a list's entries. */
function leaves(shape: HandField, path: string[] = []): string[] {
  if (shape.type === "object") return Object.entries(shape.fields).flatMap(([key, value]) => leaves(value, [...path, key]))
  if (shape.type === "list" && shape.of.type === "object") return leaves(shape.of, [...path, "*"])
  return [path.join(".")]
}

describe("表格是照 schema 排出来的", () => {
  test("渲染进程里存的形状和现在的 schema 一模一样", () => {
    // Fails when a schema of mod-core changes: write the file again with test/asset-edit-shape.write.ts.
    HAND_KINDS.forEach((kind) => expect(HAND_SHAPES[kind]).toEqual(handShape(kind)))
  })
  test("schema 里每一个字段，要么有名字和说明，要么明说了原样留着", () => {
    HAND_KINDS.forEach((kind) => {
      const worded = HAND_WORDS[kind].flatMap((section) => section.fields.map((word) => word.path))
      const kept = HAND_KEPT[kind]
      const unknown = leaves(HAND_SHAPES[kind]).filter((path) => !worded.includes(path) && !kept.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)))
      expect([kind, unknown]).toEqual([kind, []])
      // And nothing is worded that the schema does not have.
      expect([kind, worded.filter((path) => !shapeAt(kind, path))]).toEqual([kind, []])
      expect(new Set(worded).size).toBe(worded.length)
    })
  })
  test("每一项都有一句话的说明；选项的名字盖住 schema 的每一个选项", () => {
    HAND_KINDS.forEach((kind) =>
      HAND_WORDS[kind].flatMap((section) => section.fields).forEach((word) => {
        expect([word.path, word.label.length > 0 && word.help.endsWith("。")]).toEqual([word.path, true])
        const shape = shapeAt(kind, word.path)!
        const options = shape.type === "choice" ? shape.options : shape.type === "list" && shape.of.type === "choice" ? shape.of.options : []
        expect([word.path, options.filter((option) => !word.choices?.[option])]).toEqual([word.path, []])
        // A group that can be switched on says what it starts with, and that start is what the schema takes.
        if (shape.type === "object" && word.fresh) expect([word.path, check(kind, setAt(kind === "entity" ? creature(word.path.startsWith("runtime.spawn.") ? { runtime: { ...(creature().runtime as Loose), spawn: { biomes: ["minecraft:plains"], weight: 1, min: 1, max: 1 } } } : {}) : kind === "block" ? block() : { kind, identifier: "a", name: "甲", max_stack: 1, color: "#000000", texture: null }, word.path, word.fresh())).map((issue) => issue.path.join("."))]).toEqual([word.path, []])
      }),
    )
  })
  test("一处最多几只：没有时是“不限数量”，打开后是两个带范围的数字", () => {
    const withSpawn = (cap?: Loose): Loose => creature({ runtime: { ...(creature().runtime as Loose), spawn: { biomes: ["minecraft:plains"], weight: 1, min: 1, max: 2, ...(cap ? { cap } : {}) } } })
    expect(keys("entity", withSpawn(), true)).toContain("runtime.spawn.cap")
    expect(keys("entity", withSpawn(), true)).not.toContain("runtime.spawn.cap.count")
    expect(keys("entity", withSpawn({ count: 2, radius: 48 }), true)).toEqual(expect.arrayContaining(["runtime.spawn.cap.count", "runtime.spawn.cap.radius"]))
    expect(check("entity", withSpawn({ count: 2, radius: 48 }))).toEqual([])
    // A count or a radius out of its bounds is refused with the field named.
    expect(check("entity", withSpawn({ count: 0, radius: 48 })).map((issue) => issue.path.join("."))).toEqual(["runtime.spawn.cap.count"])
    expect(check("entity", withSpawn({ count: 2, radius: 65 })).map((issue) => issue.path.join("."))).toEqual(["runtime.spawn.cap.radius"])
  })
  test("数字的范围读自 schema", () => {
    expect(field("block", block(), "luminance")).toMatchObject({ control: "number", range: "0 到 15 的整数" })
    expect(field("block", block(), "hardness").range).toBe("0 到 3600000")
    expect(field("entity", creature(), "health").range).toBe("大于 0，最多 1024")
    expect(rangeWords({ type: "number", int: true, min: -64, max: 320 })).toBe("−64 到 320 的整数")
    expect(field("block", block(), "tool")).toMatchObject({ control: "choice", options: ["pickaxe", "axe", "shovel", "none"] })
    expect(field("block", block(), "fuel").control).toBe("switch")
    expect(field("block", block(), "texture").control).toBe("picture")
  })
  test("只有现在说得通的字段才出现", () => {
    // No tool, no tool material; something else drops only when asked for.
    expect(keys("block", block())).toContain("tool_tier")
    expect(keys("block", block({ tool: "none" }))).not.toContain("tool_tier")
    expect(keys("block", block())).not.toContain("drop_item.item")
    expect(keys("block", settle("block", block({ drop: "item" })))).toEqual(expect.arrayContaining(["drop_item.item", "drop_item.min", "drop_item.fortune", "experience"]))
    // A group's fields show once it is switched on.
    expect(keys("block", block())).not.toContain("fuel.burn_ticks")
    expect(keys("block", block({ fuel: { burn_ticks: 300 } }))).toContain("fuel.burn_ticks")
    expect(keys("block", block({ generation: null }))).not.toContain("generation.dimension")
    // The rock on offer is the rock of the chosen dimension.
    const nether = block({ generation: { dimension: "nether", min_y: 10, max_y: 100, spread: "even", vein_size: 6, veins_per_chunk: 8, replaces: ["netherrack"], biomes: null } })
    expect(field("block", nether, "generation.replaces")).toMatchObject({ control: "many", options: ["netherrack"] })
    expect(keys("block", nether)).not.toContain("generation.biomes")
    expect(keys("entity", creature())).not.toContain("attack_damage")
    expect(keys("entity", creature({ behavior: "hostile" }))).toEqual(expect.arrayContaining(["attack_damage", "engagement", "runtime.movement", "runtime.explosion"]))
  })
  test("标识符这类做模组的人才认的词，只有开了高级才出现", () => {
    expect(keys("block", block())).not.toContain("identifier")
    expect(keys("block", block(), true)).toContain("identifier")
    expect(keys("item", { kind: "item", identifier: "a", name: "甲", max_stack: 1, color: "#000000", texture: null })).not.toContain("identifier")
  })
  test("身体部位逐个开启实心，别的部位保持原值", () => {
    const part = { name: "壳", forward: 0, left: 0, up: 0, width: 2, height: 1 }
    const draft = creature({ hitbox: { core: { width: 1, height: 1 }, parts: [part, { ...part, name: "尾" }] } })
    const row = field("entity", draft, "hitbox.parts").rows[0]!
    expect(row.find((value) => value.key.endsWith(".solid"))).toMatchObject({ control: "flag" })
    const edited = setAt(draft, "hitbox.parts.0.solid", true)
    expect(edited.hitbox).toMatchObject({ parts: [{ ...part, solid: true }, { ...part, name: "尾" }] })
    expect(check("entity", edited)).toEqual([])
  })
  test("身体中心和只挡路部件能分别手改并保存", () => {
    const rail = { name: "外栏", forward: 3, left: 0, up: 0, width: 1, height: 2 }
    const draft = creature({ hitbox: { core: { width: 2, height: 2 }, blockers: [rail] } })
    expect(field("entity", draft, "hitbox.core.solid").control).toBe("flag")
    expect(field("entity", draft, "hitbox.blockers").rows[0]?.map(value => value.key)).toContain("hitbox.blockers.0.width")
    const edited = setAt(setAt(draft, "hitbox.core.solid", true), "hitbox.blockers.0.width", 2)
    expect(edited.hitbox).toMatchObject({ core: { solid: true }, blockers: [{ ...rail, width: 2 }] })
    expect(check("entity", edited)).toEqual([])
  })
  test("掉落是一行一行的，每行有自己的字段", () => {
    const loot = field("entity", creature({ loot: [{ item: "minecraft:bone", min: 0, max: 2, chance: 1, player_only: false }, { item: "", min: 1, max: 1, chance: 1, player_only: false }] }), "loot")
    expect(loot.control).toBe("list")
    expect(loot.rows.map((row) => row.map((value) => value.key))).toEqual([["loot.0.item", "loot.0.min", "loot.0.max", "loot.0.chance", "loot.0.player_only", "loot.0.looting"], ["loot.1.item", "loot.1.min", "loot.1.max", "loot.1.chance", "loot.1.player_only", "loot.1.looting"]])
    expect(loot.rows[0]![0]).toMatchObject({ control: "thing" })
  })
  test("老的保存路线只带得动生物最基本的几项", () => {
    expect(keys("entity", creature({ behavior: "hostile" }), false, true)).toEqual(["name", "description", "health", "speed", "behavior", "attack_damage"])
    expect(keys("entity", creature({ behavior: "hostile" }), false, true).every((key) => ENTITY_BASICS.includes(key))).toBe(true)
  })
})

describe("按位置读写文档", () => {
  test("写一处，别处原样；undefined 是拿掉", () => {
    const before = creature({ loot: [{ item: "a", min: 1 }] })
    const after = setAt(before, "loot.0.min", 3)
    expect(after.loot).toEqual([{ item: "a", min: 3 }])
    expect(before.loot).toEqual([{ item: "a", min: 1 }])
    expect(setAt(before, "runtime.armor", 5).runtime).toMatchObject({ armor: 5, movement: "direct" })
    expect("loot" in setAt(before, "loot", undefined)).toBe(false)
    expect(same({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(same({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
    expect(same(null, undefined)).toBe(false)
  })
  test("改了哪几项，按表格上的名字说；开关一组只说那一组", () => {
    expect(changedLabels("block", block(), block({ hardness: 3, luminance: 5 }))).toEqual(["硬度", "发光"])
    expect(changedLabels("block", block(), block({ fuel: { burn_ticks: 300 } }))).toEqual(["能当燃料"])
    expect(changedLabels("block", block({ fuel: { burn_ticks: 300 } }), block({ fuel: { burn_ticks: 400 } }))).toEqual(["能烧多久"])
    expect(changedLabels("entity", creature(), creature({ loot: [{ item: "minecraft:bone", min: 1, max: 1, chance: 1, player_only: false }] }))).toEqual(["掉落"])
    expect(changedLabels("block", block(), block())).toEqual([])
  })
})

describe("游戏自己的规矩，改一处的时候顺手理好", () => {
  test("方块", () => {
    expect(settle("block", block({ tool: "none", tool_tier: "iron" })).tool_tier).toBeNull()
    expect(settle("block", block({ drop: "item" })).drop_item).toEqual({ item: "", min: 1, max: 1, fortune: false })
    expect(settle("block", block({ drop: "self", drop_item: { item: "a", min: 1, max: 1, fortune: false }, experience: { min: 1, max: 2 } }))).toMatchObject({ drop_item: null, experience: null })
    // Nothing is written into a document that had nothing there.
    expect(settle("block", block())).toEqual(block())
    const moved = settle("block", block({ generation: { dimension: "nether", min_y: -16, max_y: 300, spread: "even", vein_size: 6, veins_per_chunk: 8, replaces: ["stone", "deepslate"], biomes: "is_forest" } }))
    expect(moved.generation).toMatchObject({ replaces: ["netherrack"], min_y: 0, max_y: 255, biomes: null })
    expect(getModuleSchema("block").safeParse(moved).success).toBe(true)
  })
  test("物品：工具不能叠放，也不是食物", () => {
    const tool = HAND_WORDS.item.flatMap((section) => section.fields).find((word) => word.path === "tool")!.fresh!()
    expect(settle("item", { kind: "item", identifier: "a", name: "甲", max_stack: 64, color: "#000000", texture: null, food: { hunger: 4, saturation: 0.3 }, tool })).toMatchObject({ max_stack: 1, food: null })
  })
  test("物品：瞬间生效的效果没有持续时间，表格替它写成 1", () => {
    const food = (effects: unknown[]) => ({ kind: "item", identifier: "a", name: "甲", max_stack: 16, color: "#000000", texture: null, food: { hunger: 3, saturation: 0.3, effects, drink: true, leaves: "minecraft:glass_bottle" } })
    const heal = { effect: "instant_health", seconds: 30, level: 2, chance: 1 }
    const regeneration = { effect: "regeneration", seconds: 8, level: 2, chance: 1 }
    expect(getModuleSchema("item").safeParse(food([heal])).success).toBe(false)
    const settled = settle("item", food([heal, regeneration]))
    expect(settled.food).toMatchObject({ effects: [{ effect: "instant_health", seconds: 1 }, { effect: "regeneration", seconds: 8 }] })
    expect(getModuleSchema("item").safeParse(settled).success).toBe(true)
    // Nothing is written into a document that had nothing there, and an unknown effect is left for the schema to say.
    expect(settle("item", food([regeneration]))).toEqual(food([regeneration]))
    expect(settle("item", { ...food([]), food: null })).toEqual({ ...food([]), food: null })
    expect(() => settle("item", food([{ effect: "wither", seconds: 3, level: 1, chance: 1 }]))).not.toThrow()
  })
  test("方块「站上去」里有一行「落下反弹」：0 到 1，一句话带原版对照，不用先打开别的开关", () => {
    const stand = formOf("block", block(), { advanced: false }).find((section) => section.title === "站上去")!
    expect(stand.fields.map((value) => value.word.label)).toEqual(["落下反弹", "踩上去弹高", "改变站在上面的人"])
    const bounce = field("block", block(), "bounce")
    expect(bounce).toMatchObject({ control: "number", range: "0 到 1" })
    expect(bounce.word.help).toBe("0 是不弹，1 是落多高弹多高。原版：黏液块 1。")
    expect(isPlain(bounce.word.help)).toBe(true)
    // Beside the movement switch, not inside it: a jelly that only bounces needs nothing else turned on.
    expect(keys("block", block({ bounce: 0.5 }))).toContain("bounce")
    expect(keys("block", block({ bounce: 0.5 }))).not.toContain("movement.speed")
    expect(changedLabels("block", block(), block({ bounce: 0.5 }))).toEqual(["落下反弹"])
    // Out of range is found before anything is sent, in words; left empty it is left out.
    expect(check("block", block({ bounce: 1.5 })).map((value) => value.path.join("."))).toEqual(["bounce"])
    expect(check("block", block({ bounce: -0.1 })).map((value) => value.path.join("."))).toEqual(["bounce"])
    expect(plainIssue("block", check("block", block({ bounce: 1.5 }))[0]!, false)).toMatchObject({ label: "落下反弹", text: "要填 0 到 1。" })
    ;[0, 0.5, 1, null, undefined].forEach((value) => expect(check("block", block({ bounce: value }))).toEqual([]))
    expect(getModuleSchema("block").safeParse({ ...block(), bounce: 0.5 }).success).toBe(true)
  })
  test("方块「站上去」里有一行「踩上去弹高」：1.25 到 10 格，留空是不弹，能存下来，不用先打开别的开关", () => {
    const launch = field("block", block(), "launch")
    expect(launch).toMatchObject({ control: "number", range: "1.25 到 10" })
    expect(launch.word.help).toBe("弹到几格高，留空是不弹。原版：跳一下约 1.25 格。")
    expect(isPlain(launch.word.help)).toBe(true)
    expect(isPlain(launch.word.label)).toBe(true)
    // Beside the bounce and the movement switch, not inside either.
    expect(keys("block", block({ launch: 4 }))).toContain("launch")
    expect(keys("block", block({ launch: 4 }))).not.toContain("movement.speed")
    // The value is kept as typed, and a change to it is the only change.
    const saved = setAt(block(), "launch", 4)
    expect(saved).toMatchObject({ launch: 4 })
    expect(changedLabels("block", block(), saved)).toEqual(["踩上去弹高"])
    expect(getModuleSchema("block").safeParse(saved).success).toBe(true)
    // Out of range, or lower than a jump, is found before anything is sent, in words; left empty it is left out.
    for (const value of [0, 1, 11]) {
      expect(check("block", block({ launch: value })).map((issue) => issue.path.join("."))).toEqual(["launch"])
      expect(plainIssue("block", check("block", block({ launch: value }))[0]!, false)).toMatchObject({ label: "踩上去弹高", text: "要填 1.25 到 10。" })
    }
    ;[1.25, 4, 10, null, undefined].forEach((value) => expect(check("block", block({ launch: value }))).toEqual([]))
  })
  test("方块的脚下手感和食物的效果各有自己的表格项，开了才出现", () => {
    expect(keys("block", block())).not.toContain("movement.speed")
    expect(keys("block", block({ movement: { speed: 0.4, jump: 0.5, slip: 0.6 } }))).toEqual(expect.arrayContaining(["movement", "movement.speed", "movement.jump", "movement.slip"]))
    expect(field("block", block(), "movement").control).toBe("switch")
    expect(field("block", block({ movement: { speed: 0.4, jump: 0.5, slip: 0.6 } }), "movement.speed").range).toBe("0.2 到 1")
    expect(changedLabels("block", block(), block({ movement: { speed: 0.4, jump: 0.5, slip: 0.6 } }))).toEqual(["改变站在上面的人"])
    const item = { kind: "item", identifier: "a", name: "甲", max_stack: 16, color: "#000000", texture: null }
    const eaten = { ...item, food: { hunger: 3, saturation: 0.3, effects: [{ effect: "regeneration", seconds: 8, level: 2, chance: 1 }], leaves: "minecraft:glass_bottle" } }
    expect(keys("item", eaten)).toEqual(expect.arrayContaining(["food.drink", "food.leaves", "food.effects"]))
    expect(field("item", eaten, "food.effects").control).toBe("list")
    expect(field("item", eaten, "food.leaves")).toMatchObject({ control: "choice", options: ["minecraft:glass_bottle", "minecraft:bowl"] })
  })
  test("配方：换了做的地方，格子和数量跟着变", () => {
    const shaped = { kind: "recipe", name: "甲", pattern: [null, "minecraft:stick", null, "minecraft:coal", null, null, null, null, null], result: "minecraft:torch", count: 4, type: "shaped" }
    expect(settle("recipe", { ...shaped, type: "smelting" })).toMatchObject({ pattern: ["minecraft:stick", null, null, null, null, null, null, null, null], count: 1 })
    expect(settle("recipe", { ...shaped, type: "shapeless", experience: 0.7, cooking_time: 100 })).toMatchObject({ pattern: shaped.pattern, count: 4, experience: null, cooking_time: null })
    expect(settle("recipe", { ...shaped, type: "smithing" })).toMatchObject({ pattern: [null, "minecraft:stick", null, null, null, null, null, null, null], count: 1 })
    expect(getModuleSchema("recipe").safeParse(settle("recipe", { ...shaped, type: "campfire", experience: 0.35 })).success).toBe(true)
  })
})

describe("从空白开始", () => {
  test("方块和物品一开始就是 schema 收的；名字不撞", () => {
    // 书: a book starts from one empty page, and the schema takes it as it is.
    expect(BLANK_KINDS).toEqual(["block", "item", "recipe", "book"])
    expect(freeIdentifier(["block_1", "block_2", "item_1"], "block")).toBe("block_3")
    const made = blankDocument("block", "月块", ["block_1"])!
    expect(made).toMatchObject({ identifier: "block_2", name: "月块", hardness: 1.5, tool: "pickaxe", drop: "self" })
    expect(getModuleSchema("block").safeParse(made).success).toBe(true)
    expect(check("block", made)).toEqual([])
    expect(getModuleSchema("item").safeParse(blankDocument("item", "月屑", [])).success).toBe(true)
    expect(blankDocument("entity", "月牛", [])).toBeNull()
    const book = blankDocument("book", "冒险笔记", [])!
    expect(getModuleSchema("book").safeParse(book).success).toBe(true)
    expect(check("book", book)).toEqual([])
  })
  test("配方要先放材料、选好做出来的东西，才存得了", () => {
    const made = blankDocument("recipe", "合月块", [])!
    expect(check("recipe", made).map((issue) => plainIssue("recipe", issue, false))).toEqual([
      { key: "result", label: "做出来的是", text: ISSUE_WORDS.unpicked },
      { key: "pattern", label: "材料", text: "配方至少需要一种材料。" },
    ])
    const filled = { ...made, pattern: ["minecraft:stick", ...Array<null>(8).fill(null)], result: "minecraft:stick" }
    expect(check("recipe", filled)).toEqual([])
    expect(getModuleSchema("recipe").safeParse(filled).success).toBe(true)
  })
})

describe("哪里不对，用人话说在那一项旁边", () => {
  const said = (kind: (typeof HAND_KINDS)[number], document: Loose, advanced = false) => check(kind, document).map((issue) => plainIssue(kind, issue, advanced))
  test("表格自己查得出的：空着、超出范围、不是整数、没选", () => {
    expect(said("block", block({ name: " " }))).toEqual([{ key: "name", label: "名字", text: "不能空着。" }])
    expect(said("block", block({ luminance: 16 }))).toEqual([{ key: "luminance", label: "发光", text: "要填 0 到 15 的整数。" }])
    expect(said("block", block({ luminance: 1.5 }))).toEqual([{ key: "luminance", label: "发光", text: "要填整数，不带小数点。" }])
    expect(said("block", block({ hardness: Number.NaN }))).toEqual([{ key: "hardness", label: "硬度", text: "要填一个数。" }])
    expect(said("entity", creature({ health: 0 }))).toEqual([{ key: "health", label: "生命", text: "要填 大于 0，最多 1024。" }])
    expect(said("block", block({ identifier: "Moon Block" }))).toEqual([{ key: "identifier", label: "标识符", text: "要用小写字母开头，只用小写字母、数字和下划线。" }])
    expect(said("block", settle("block", block({ drop: "item" })))).toEqual([{ key: "drop_item.item", label: "掉哪一样", text: "还没选。" }])
    expect(said("entity", creature({ loot: [{ item: "", min: 1, max: 1, chance: 2, player_only: false }] })).map((issue) => issue.key)).toEqual(["loot.0.item", "loot.0.chance"])
    // What the form's own check passes, the schema takes.
    expect(getModuleSchema("block").safeParse(block({ luminance: 16 })).success).toBe(false)
    expect(said("block", block())).toEqual([])
  })
  test("原样留着的字段不归表格查", () => {
    expect(check("entity", creature({ abilities: [{ broken: true }] }))).toEqual([])
  })
  test("mod-core 查出来的：写给 AI 的话换成给人的话，本来就是人话的原样说", () => {
    const plain = (kind: (typeof HAND_KINDS)[number], path: (string | number)[], message: string, advanced = false) => plainIssue(kind, { path, code: "custom", message }, advanced)
    expect(plain("recipe", ["pattern", 0], "Unknown content reference: hand_made:nothing")).toEqual({ key: "pattern", label: "材料", text: "用到了「nothing」，可是模组里没有这样东西。先把它做出来，或者换一样。" })
    expect(plain("item", ["max_stack"], "物品「月镐」是工具，工具不能叠放：max_stack 写 1。").text).toBe("工具不能叠放，一格只能放 1 个。")
    expect(plain("block", ["experience"], "方块「月块」挖掉会掉它自己，又给经验：玩家可以反复放下再挖来刷经验。让它掉别的物品，或者去掉经验。")).toMatchObject({ key: "experience", text: "方块「月块」挖掉会掉它自己，又给经验：玩家可以反复放下再挖来刷经验。让它掉别的物品，或者去掉经验。" })
    expect(plain("entity", ["runtime", "spawn", "max"], "Spawn min must not exceed max")).toEqual({ key: "runtime.spawn.max", label: "一次最多几只", text: "一次最多几只，不能比最少还少。" })
    expect(plain("entity", ["runtime", "spawn", "biomes"], "自然生成至少要写一个群系（biomes）或者一组群系（tags）").text).toBe("至少选一类地方，或者单独加一个群系。")
    expect(plain("block", ["name_en"], "英文名里不能有中文；写一个简短自然的英文名，例如 Azure Ore。").text).toBe("英文名里不能有中文，写一个简短的英文名，例如 Azure Ore。")
    // Words a document spells never reach the person; with 高级 on the raw finding follows.
    expect(plain("block", ["lucky"], "Lucky cache outcomes must not be empty").text).toBe(ISSUE_WORDS.other)
    expect(plain("block", ["hardness"], "Something raw_here", true).text).toBe(`${ISSUE_WORDS.other}（hardness：Something raw_here）`)
    expect(plain("block", [], "Workspace dependencies must be acyclic")).toEqual({ key: "", label: "", text: ISSUE_WORDS.whole_thing })
  })
  test("会弄坏别的东西的改动，说出是哪一样；拒绝的话原样说", () => {
    expect(plainIssue("item", { path: [], code: "custom", message: "Unknown content reference: hand_made:moon_shard", elsewhere: "合月块" }, false)).toEqual({ key: "", label: "", text: "这样改了以后，「合月块」就对不上了。先去改它，或者把这里改回去。" })
    expect(plainIssue("entity", { path: [], code: "refused", message: "生物要先有模型，不能从空白的表格开始。" }, false).text).toBe("生物要先有模型，不能从空白的表格开始。")
  })
  test("什么算人话", () => {
    expect(isPlain("掉落数量的最大值不能比最小值小。")).toBe(true)
    expect(isPlain("主世界的高度只有 -64 到 320，生成高度要落在这个范围里。")).toBe(true)
    expect(isPlain("方块「moon_block」挖掉后要掉「azure_shard」，可是模组里没有别的方块或物品叫这个名字。先把它做出来。")).toBe(true)
    expect(isPlain("配方「甲」不是烧炼类配方，不能写 experience 和 cooking_time。")).toBe(false)
    expect(isPlain("Invalid input: expected number, received string")).toBe(false)
  })
  test("格子里面的毛病算在格子头上，不当成整格的范围", () => {
    expect(wordAt("recipe", "pattern.3")).toMatchObject({ key: "pattern" })
    expect(plainIssue("recipe", { path: ["pattern", 3], code: "invalid_format", message: "Invalid string: must match pattern" }, false)).toEqual({ key: "pattern", label: "材料", text: ISSUE_WORDS.other })
  })
})
