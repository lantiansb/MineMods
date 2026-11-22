import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CONTRACT_TITLE, accessorContractLines, creatureContractLines, gameplayContract, readGeneratedCreature } from "../src/creature-contract"
import { BASELINE_GOALS } from "../src/creature-goals"
import { compileEntity } from "../src/fabric/entity"
import { projectContentSource } from "../src/fabric/gameplay"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const clip = (name: string, length: number) => ({ name, length, loop: name === "idle" || name === "walk", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })
const face = "#cc9966"
const model = (...extra: [string, number][]) => ({
  name: "Creature",
  texture_size: 64,
  bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-2, 0, -2], size: [4, 8, 4], faces: { north: face, east: face, south: face, west: face, up: face, down: face } }] }],
  animations: [clip("idle", 1), clip("walk", 1), clip("hurt", 0.4), ...extra.map(([name, length]) => clip(name, length))],
})
const plain = { modId: "life_mod", packageName: "com.minemods.content_life_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 4, behavior: "hostile" as const, gameplayGoals: true }
/** What the generator writes for one creature, read back: the class and its loot table. */
const generated = (input: Record<string, unknown>) => {
  const files = compileEntity({ ...plain, ...input }) as Record<string, unknown>
  const java = Object.values(files).find((value) => typeof value === "string" && value.includes("extends AgeableMob implements GeoEntity")) as string
  const loot = Object.entries(files).find((entry) => entry[0].includes("/loot_table/entities/"))?.[1]
  return { java, facts: readGeneratedCreature(java, typeof loot === "string" ? loot : null) }
}
const lines = (facts: ReturnType<typeof readGeneratedCreature>) => creatureContractLines({ title: "守卫", key: "guardian-id" }, facts).join("\n")

test("the contract says what the generated creature does with its clips: with an attack clip doHurtTarget plays it, without one it says the opposite", () => {
  const armed = generated({ model: model(["attack", 0.5], ["death", 1.5]), loot: [{ item: "azure_ore", min: 1, max: 2, chance: 1, player_only: false }], experience: 5 })
  expect(armed.facts).toMatchObject({ attack_motion: true, death_motion: true, death_ticks: 30, hurt_motion: true, moves: true, takes_added: true, experience: 5, damage: 4 })
  expect(lines(armed.facts)).toContain("出手：它的模型有 attack 动作。任何人调用它的 doHurtTarget(目标)——它自己的行为，或者玩法代码里的 mob.doHurtTarget(...)——生成的 doHurtTarget 都会先从服务端触发 attack 动作（附近的玩家同时看到），再结算伤害（攻击力 4）。")
  expect(lines(armed.facts)).toContain("死亡：播模型的 death 动作，播完才消失（30 刻，约 1.5 秒）。")
  expect(lines(armed.facts)).toContain("被打败：掉 1–2 个「life_mod:azure_ore」（掉落表是 Studio 生成的，抢夺附魔会多掉）；给 5 点经验。")
  const bare = generated({ model: model() })
  expect(bare.facts).toMatchObject({ attack_motion: false, death_motion: false, death_ticks: 20, experience: 0, drops: [] })
  expect(lines(bare.facts)).toContain("出手：它的模型没有 attack 动作，生成的类也没有改写 doHurtTarget。调用 doHurtTarget(目标) 只结算伤害（攻击力 4），它身上不会播任何出手的动作；说明里要是答应了出手时有自己的动作，只调用 doHurtTarget 的代码没有做到。")
  expect(lines(bare.facts)).toContain("死亡：它的模型没有 death 动作，按原版的样子侧身倒下，20 刻后消失。")
  expect(lines(bare.facts)).toContain("被打败：什么都不掉（没有生成掉落表）；不给经验。")
  // The goals are the ones the generated registerGoals adds, with the priorities it gives them.
  expect(armed.facts.goals.map((goal) => [goal.target, goal.priority, goal.type])).toEqual([
    [false, BASELINE_GOALS.swim, "FloatGoal"],
    [false, BASELINE_GOALS.engage, "MeleeAttackGoal"],
    [true, 1, "NearestAttackableTargetGoal"],
    [false, BASELINE_GOALS.wander, "WaterAvoidingRandomStrollGoal"],
    [false, BASELINE_GOALS.look_at_player, "LookAtPlayerGoal"],
    [false, BASELINE_GOALS.look_around, "RandomLookAroundGoal"],
  ])
  expect(lines(armed.facts)).toContain("0 FloatGoal（掉进水里会往上游；占 JUMP），1 MeleeAttackGoal（有目标时追上去，够得着就调用自己的 doHurtTarget 出手；占 MOVE、LOOK），5 WaterAvoidingRandomStrollGoal")
  // A passive creature picks no target by itself, and the contract says so instead of listing one.
  expect(lines(generated({ model: model(), behavior: "passive" }).facts)).toContain("它的 targetSelector 是空的：")
  // A goal the generated class defines itself is described from its own body: whom it looks for, and whether it swings.
  const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
  expect(lines(generated({ model: model(["attack", 0.5]), runtime }).facts)).toContain("1 RuntimeMovementGoal（Studio 生成的：自己找 24 格内看得见的、最近的玩家并靠近（创造模式的不算），够得着就调用自己的 doHurtTarget 出手；占 MOVE、LOOK）")
  expect(lines(generated({ model: model(), runtime, behavior: "passive" }).facts)).toContain("1 RuntimeMovementGoal（Studio 生成的：不自己找目标，所以自己不会开始，不调用 doHurtTarget；占 MOVE、LOOK）")
  expect(lines(generated({ model: model(), runtime: { ...runtime, explosion: { radius: 3, fuse_ticks: 30, damage_blocks: false, effects: [] } } }).facts)).toMatch(/1 RuntimeMovementGoal（Studio 生成的：自己找 24 格内看得见的、最近的玩家并靠近（创造模式的不算），不调用 doHurtTarget；占 MOVE、LOOK）/)
})

test("a generator that stops doing a thing stops being vouched for: the reading is of the text, not of memory", () => {
  const armed = generated({ model: model(["attack", 0.5]) })
  const unhooked = readGeneratedCreature(armed.java.replace('triggerAnim("attack", "attack");', ""), null)
  expect(unhooked.attack_motion).toBe(false)
  expect(lines(readGeneratedCreature(armed.java.replace(/ProjectContent\.applyGoals\([^)]*\);/, ""), null))).toContain("这一版生成的代码里没有读到它接收 ProjectContent.addGoal 加的行为的那一步，评审不能当它有。")
  const accessor = projectContentSource({ modId: "life_mod", items: [], blocks: [], creatures: [{ key: "guardian-id", registry: "creature_1" }] })
  expect(accessorContractLines(accessor)[0]).toStartWith('ProjectContent.addGoal("生物的 id", 优先级, 工厂) 只是登记：')
  expect(accessorContractLines(accessor.replace("goal.priority()", "0"))).toEqual(["这一版生成的代码里没有读到ProjectContent.addGoal / addTargetGoal 的做法，评审不能当它有。"])
})

test("for a project, the contract covers the creatures the gameplay lists and nothing when it lists none", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-contract-"))
  roots.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true })
  const guarding = project.workspace.assets.find((asset) => asset.document.kind === "gameplay")!
  const uses = guarding.document.kind === "gameplay" ? guarding.document.uses : []
  const contract = await gameplayContract(path.join(root, "project"), uses)
  expect(contract[0]).toContain(`生物「${project.entities[0]!.name}」`)
  expect(contract.join("\n")).toContain("出手：它的模型有 attack 动作。")
  expect(contract.at(-1)).toContain(`游泳 ${BASELINE_GOALS.swim}、追击或攻击 ${BASELINE_GOALS.engage}`)
  expect(await gameplayContract(path.join(root, "project"), [])).toEqual([])
  expect(CONTRACT_TITLE).toBe("Studio 自己生成的部分保证了什么")
}, 60000)
