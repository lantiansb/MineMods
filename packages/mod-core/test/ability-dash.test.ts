import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DASH_INSTRUCTIONS, DASH_LIMITS, FIGHT_RANGE, FORCE_LIMITS, dashPlan, forceDrift, movesForward } from "../src/ability-dash"
import { dashForceFaces, dashForceLabel, dashForceReview } from "../src/ability-dash-words"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, abilityHitShapes, abilityIssues, abilityPlan, abilityWords, hitLines, shapeFaces } from "../src/creature-abilities"
import { AbilitySchema, BossSchema, ENGAGEMENT_LIMITS, type Ability } from "../src/entity-runtime"
import { playerForceFiles } from "../src/fabric/player-force"
import { genTarget } from "../src/platform/target"
import { compileEntity } from "../src/fabric/entity"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { createTargetDashSample, galeAbilities, ramAbilities, ramHitbox } from "../script/target-dash-sample"
import { compileAbilityWarn } from "../src/fabric/ability-warn"
import { compileBossRuntime } from "../src/fabric/boss-runtime"
import { dragonDesign, dragonFlight } from "./giant-flier"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 4 (位移类招式): a dash the server carries a creature along, the hit it counts on the way (each one struck once), and the forces area hits leave
 * on whoever they struck. The definition, what the external AI is told, the pictures, the reviewer, and the Java on all three targets.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const [ram, vortex] = ramAbilities as [Ability, Ability]
const [gale] = galeAbilities as [Ability]
const refused = (ability: unknown) => AbilitySchema.safeParse(ability).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const dashOf = (ability: Ability) => ability.moves[0] as Extract<Ability["moves"][number], { type: "dash" }>
const withDash = (change: Record<string, unknown>) => ({ ...ram, moves: [{ ...dashOf(ram), ...change }] })
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = (suffix = "") => `src/main/java/com/minemods/content_golem_mod/entity/StudioCreature${suffix}.java`

test("a breaking dash takes a bounded hardness and checks the path before moving", () => {
  expect(refused(withDash({ break_hardness: 11 }))).toContain("硬度上限")
  const ability = AbilitySchema.parse(withDash({ break_hardness: 2 }))
  expect(String(compileEntity({ ...plain, abilities: [ability] })[entityPath()])).toContain("StudioBreak.sweep(world")
})

test("a dash and a force are written as the plan says, and an old push is what it was", () => {
  expect(AbilitySchema.parse(ram)).toEqual(ram)
  // The old push still parses exactly as written, beside a dash or alone.
  const pushed = AbilitySchema.parse({ ...gale, moves: [{ at: 0.6, forward: 0.8, up: 0.42 }] })
  expect(pushed.moves).toEqual([{ at: 0.6, forward: 0.8, up: 0.42 }])
  expect(abilityPlan(pushed).moves).toEqual([{ index: 0, tick: 12 }])
  // A dash is not a push: it runs on its own ticks.
  expect(abilityPlan(ram).moves).toEqual([])
  expect(dashPlan(ram)).toEqual({ index: 0, dash: dashOf(ram), start: 8, ticks: 20, step: 1, hitFrom: 8, reach: 20 })
  expect(movesForward(ram)).toBe(true)
  expect(movesForward(gale)).toBe(false)
  expect(forceDrift(gale.hits[0]!.type === "area" ? gale.hits[0]!.force! : (null as never))).toBe(15)
  expect(FIGHT_RANGE.usual).toBe(ENGAGEMENT_LIMITS.distance)
})

test("what a dash and a force may not be is said in plain words", () => {
  expect(refused(withDash({ from: 0.2 }))).toContain("不能比蓄力结束（windup，第 0.4 秒）早")
  expect(refused(withDash({ to: 0.4 }))).toContain("至少晚一刻")
  expect(refused(withDash({ to: 1.7 }))).toContain("不能比招式全长（length）还晚")
  expect(refused(withDash({ speed: 10 }))).toContain("只冲得出 10 格，比 distance（20 格）短")
  expect(refused(withDash({ hit: 3 }))).toContain("没有第 3 次")
  expect(refused(withDash({ aim: "track" }))).not.toBe("")
  expect(refused(withDash({ speed: DASH_LIMITS.speed.max + 1 }))).not.toBe("")
  expect(refused({ ...ram, moves: [dashOf(ram), dashOf(ram)] })).toContain("最多 1 段冲刺")
  expect(refused({ ...ram, hits: [{ ...ram.hits[0]!, shape: { type: "line", up: 1, length: 4, radius: 0.5 } }] })).toContain("只能是它身边的扇形（arc）、盒子（box）或球（sphere）")
  expect(refused({ ...ram, hits: [{ ...ram.hits[0]!, warn: { seconds: 0.4, look: "ring", color: "red" } }] })).toContain("不能写预警（warn）")
  expect(refused({ ...ram, hits: [{ ...ram.hits[0]!, bone: "head" }] })).toContain("不能写 bone")
  expect(refused({ ...ram, hits: [{ ...ram.hits[0]!, at: 1.5 }] })).toContain("at 要落在冲刺里")
  expect(refused({ ...ram, hits: [{ type: "shot", at: 0.5, projectile: "arrow", speed: 1.6, forward: 0.8, up: 1.4, damage: 5 }] })).toContain("要是一次范围出手")
  const force = (change: Record<string, unknown>) => refused({ ...gale, hits: [{ ...gale.hits[0]!, force: { kind: "push", strength: 4, seconds: 2, ...change } }] })
  expect(force({})).toBe("")
  expect(force({ kind: "side", toward: "origin" })).toContain("侧推")
  expect(force({ strength: -4 })).toContain("写正数")
  expect(force({ kind: "side", strength: -4 })).toBe("")
  expect(force({ kind: "side", strength: 0.2 })).toContain(`最小 ${FORCE_LIMITS.strength.min}`)
  expect(force({ seconds: FORCE_LIMITS.seconds.max + 1 })).not.toBe("")
})

test("offset radial forces rotate around the selected place and can retain the original center", () => {
  for (const shape of [{type:"sphere", forward:16, left:3, up:1, radius:8}, {type:"box", forward:16, left:3, up:1, width:8, height:3, depth:8}]) {
    for (const kind of ["pull", "push"]) {
      const build = (toward?:string) => {
        const move = AbilitySchema.parse({...vortex, hits:[{...vortex.hits[0], shape, force:{kind,strength:3,seconds:2,toward}}]})
        return String(compileEntity({...plain, abilities:[move]} as never)[entityPath()])
      }
      expect(build()).toContain("forward = 16.0; left = 3.0;")
      expect(build()).toContain("abilityPlaces[slot][at + 2], 0.0, abilityPlaceYaw[slot]")
      expect(build("origin")).not.toContain("abilityForceFrom")
    }
  }
})

test("the external AI is told how to write a dash and a force, with every limit", () => {
  expect(ABILITY_INSTRUCTIONS).toContain(DASH_INSTRUCTIONS)
  expect(DASH_INSTRUCTIONS).toContain("strength × seconds × 0.95 格")
  expect(DASH_INSTRUCTIONS).toContain("移动、抗性、碰撞会让它变少")
  for (const words of ['{type:"dash", from, to, speed, distance, aim:"locked_at_windup", stop_at_wall, hit}', "force：{kind, strength, seconds}", `${DASH_LIMITS.speed.min} 到 ${DASH_LIMITS.speed.max}`, `${DASH_LIMITS.distance.min} 到 ${DASH_LIMITS.distance.max}`, `${FORCE_LIMITS.strength.min} 到 ${FORCE_LIMITS.strength.max}`, "同一个人整段冲刺只挨一下", "strength 写负数就往右边推"])
    expect(DASH_INSTRUCTIONS).toContain(words)
  expect(abilityWords.summary(ram)).toContain("第 0.4–1.4 秒笔直往前冲 20 格（每秒 20 格，方向在蓄力结束时定下），撞墙就停，沿路用第 1 次出手打，每个人只挨一下")
  expect(abilityWords.hit(gale.hits[0]!)).toContain("之后 3 秒把打中的往它自己的左边推（目标速度每秒 5 格，实际位移受阻力、碰撞和移动影响）")
  expect(abilityWords.felt(gale)).toBe("被推着走")
})

test("the picture draws the dash as an arrow as long as it goes and the band its hit sweeps, and a force as arrows over where it lands", () => {
  const [found] = abilityHitShapes(ram, fightingGolemDesign as never)!
  const own = shapeFaces(ram.hits[0]!.type === "area" ? ram.hits[0]!.shape : (null as never))
  // The shape where it starts, the band to where it ends, the shape again there, the arrow (shaft and head).
  expect(found!.faces).toHaveLength(own.length * 2 + 6 + 2)
  const tip = found!.faces.at(-1)![1]!
  expect(tip[2]).toBeCloseTo(-20 * 16)
  expect(Math.min(...found!.faces.flat().map((point) => point[2]))).toBeCloseTo(-(20 + 2) * 16)
  expect(dashForceLabel(ram, 0)).toBe("（冲刺 20 格）")
  expect(hitLines(ram, found!).join("")).toContain("图上地上的箭头就是它冲的方向和长度（20 格）；透明的长条是这一下沿路扫过的范围")
  // A side push: three arrows across the area (each a shaft and a head), to the creature's own left (the viewport's -X).
  const [blown] = abilityHitShapes(gale, fightingGolemDesign as never)!
  const arrows = dashForceFaces(gale, 0, [], [{ forward: 0, up: 0, left: 0 }])
  expect(arrows).toHaveLength(6)
  expect(blown!.faces.slice(-6)).toEqual(arrows)
  expect(arrows[1]![1]![0]).toBeLessThan(arrows[0]![0]![0])
  expect(dashForceLabel(gale, 0)).toBe("（推 3 秒）")
  expect(hitLines(gale, blown!).join("")).toContain("打中的人之后 3 秒把打中的往它自己的左边推")
  // A pull at the feet of the one it fights: eight arrows pointing in, at its place.
  expect(dashForceFaces(vortex, 0, [], [{ forward: 1.5, up: 0, left: 0 }])).toHaveLength(16)
  // Anything else is drawn as it always was.
  expect(dashForceFaces({ ...gale, hits: [{ ...gale.hits[0]!, force: undefined } as never] }, 0, [], [{ forward: 0, up: 0, left: 0 }])).toEqual([])
})

test("the reviewer is told of a dash that leaves where it is kept or meets the ground, and of a push that carries a player out of the fight", () => {
  const boss = BossSchema.parse({ bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 1, xp_bursts: 0, explosion: false }, leash: { distance: 16, reset_seconds: 30 }, lair: { biomes: ["minecraft:plains"], tags: ["is_mountain"], spacing: 40, radius: 12, floor: ["minecraft:stone"], rim: null, clearance: 8 } })
  const texts = (creature: Parameters<typeof dashForceReview>[0]) => dashForceReview(creature).map((issue) => issue.text)
  const said = texts({ name: "铁额将", abilities: [ram], boss, habits: { home: { radius: 10 } }, hitbox: null })
  expect(said.some((text) => text.includes("比它的拴绳（leash.distance，16 格）还远"))).toBe(true)
  expect(said.some((text) => text.includes("比它的家（home.radius，10 格）还大"))).toBe(true)
  expect(said.some((text) => text.includes("比它的巢的平台半径（lair.radius，12 格）还长"))).toBe(true)
  expect(said.some((text) => text.includes("只跨得上 0.6 格高的坎（碰撞箱的 step，没写就是游戏默认的 0.6）"))).toBe(true)
  // With a step of a block, on a plain creature, nothing is said of the dash.
  expect(texts({ name: "铁额将", abilities: [ram], hitbox: ramHitbox })).toEqual([])
  expect(texts({ name: "铁额将", abilities: [AbilitySchema.parse(withDash({ stop_at_wall: false }))], hitbox: ramHitbox }).join("")).toContain("撞墙不停")
  const breakEvent = { type: "break", at: 0.6, where: "self", hit: null, forward: 1, up: 0, left: 0, radius: 1, height: 3, hardness: 2, drops: false }
  const ramWith = (event: unknown) => AbilitySchema.parse({ ...withDash({ stop_at_wall: false }), events: [event] })
  expect(texts({ name: "石卫", abilities: [ramWith(breakEvent)], hitbox: ramHitbox }).join("")).not.toContain("撞墙不停")
  expect(texts({ name: "石卫", abilities: [ramWith({ ...breakEvent, at: 1.5 })], hitbox: ramHitbox }).join("")).toContain("撞墙不停")
  // The wind lord's push carries a player 15 blocks from 6: within the 24 of its fight. Ten seconds at 16 blocks a second are not.
  expect(texts({ name: "风伯", abilities: [gale] })).toEqual([])
  const storm = AbilitySchema.parse({ ...gale, hits: [{ ...gale.hits[0]!, force: { kind: "push", strength: 16, seconds: 10 } }] })
  expect(texts({ name: "风伯", abilities: [storm] }).join("")).toContain("超出它追人的范围（24 格），它会丢掉目标")
  expect(texts({ name: "风伯", abilities: [storm], boss: { ...boss, leash: null, lair: null } }).join("")).toContain(`算作在战斗里的范围（${FIGHT_RANGE.boss} 格）`)
  // They reach the creature's own findings, never as a stop; a dash closes the distance, so a far window is not said to fall short.
  const issues = abilityIssues({ name: "铁额将", behavior: "hostile", abilities: [ram], boss, hitbox: null }, null)
  // The leash, the lair and the step (no home here).
  expect(issues.filter((issue) => issue.rule === "ability_move").length).toBe(3)
  expect(issues.every((issue) => !issue.stops)).toBe(true)
  expect(issues.some((issue) => issue.rule === "ability_reach")).toBe(false)
})

test("the creature's class starts the dash on its tick, counts the carried hit only along it, and leaves the forces on whoever is struck", () => {
  const files = compileEntity({ ...plain, abilities: [ram, vortex, gale] } as never)
  const java = String(files[entityPath()])
  expect(java).toContain("abilityDashStart(20, 1.0, 20.0, true, 8);")
  // The ram's box is not counted at its own moment: only along the dash, each one once.
  const step0 = /private void abilityStep0\(int tick\) \{[\s\S]*?\n    \}/.exec(java)![0]
  expect(step0).not.toContain("abilityStrike(")
  expect(java).toContain("if (abilityDashStruck.contains(victim.getId())) continue;")
  expect(java).toContain("inside = abilityDashInBox(victim, moved * part / parts, 1.0, 1.0, 0.0, 2.0, 2.5, 2.0);")
  // The vortex's pull from where it landed, the gale's side push from the creature.
  expect(java).toContain("private static final double[][] ABILITY_FORCES = {{1.0, 0.15, 40.0}, {2.0, 0.25, 60.0}};")
  expect(/private void abilityStep1\(int tick\) \{[\s\S]*?abilityForceNext = 0;[\s\S]*?abilityStrikeAt[\s\S]*?abilityForceNext = -1;/.test(java)).toBe(true)
  expect(/private void abilityStep2\(int tick\) \{[\s\S]*?abilityForceNext = 1;[\s\S]*?abilityStrike\(victim, 0\.0f, 0\.0\)[\s\S]*?abilityForceNext = -1;/.test(java)).toBe(true)
  expect(java).toContain("        tickAbility();\n        abilityDashTick();\n        abilityForceTick();")
  expect(java).toContain("StudioPlayerForce.send(player, dx * speed, dz * speed)")
  const sideOnly = String(compileEntity({ ...plain, abilities: [gale] } as never)[entityPath()])
  expect(sideOnly).not.toContain("StudioPlayerForce")
  expect(sideOnly).toContain("victim.hurtMarked = true;")
  // An ability with only an old push, beside nothing new, writes none of this.
  const old = String(compileEntity({ ...plain, abilities: [AbilitySchema.parse({ ...gale, hits: [{ ...gale.hits[0]!, force: undefined }], moves: [{ at: 0.6, forward: 0.8, up: 0 }] })] } as never)[entityPath()])
  expect(old).not.toMatch(/abilityDash|abilityForce|AbilityForce/)
  expect(old).toContain("abilityPush(0.8, 0.0);")
  expect(old).toContain("        tickAbility();\n")
})

test.skipIf(!hasTargetJavac(CLASSPATH["fabric-1.21.1"]))("on Fabric a creature with a dash, a placed pull and a side push compiles, as a boss, a flier and a combo step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-dash-"))
  roots.push(root)
  const boss = BossSchema.parse({ bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.5, clip: null, seconds: 1, bar_color: null, speed: 1, damage: 1.5, abilities: ["ram"] }], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null })
  const shapes = [
    { classSuffix: "", abilities: [ram, vortex, gale], hitbox: ramHitbox },
    { classSuffix: "B", abilities: [ram, vortex, gale], boss },
    { classSuffix: "C", abilities: [ram, vortex, gale], combos: [{ id: "rush", name: "冲撞连击", steps: ["gale", "ram"], gap_ticks: 2, damage_scale: 1.2, start: { ...ram.start, min_distance: 0 } }] },
    // A flier dashes only on the ground (its flight carries it in the air).
    { classSuffix: "F", model: dragonDesign, abilities: [{ ...ram, clip: "sweep", where: "ground" }, { ...gale, clip: "breath" }], flight: dragonFlight },
  ]
  const { writeFile } = await import("node:fs/promises")
  for (const shape of shapes) {
    const files = compileEntity({ ...plain, ...shape } as never)
    await writeFile(path.join(root, `StudioCreature${shape.classSuffix}.java`), String(files[entityPath(shape.classSuffix)]))
  }
  // What the classes lean on beside themselves: the warning of the vortex and the boss's runtime.
  const support = [compileAbilityWarn({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod" }), compileBossRuntime({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: false, debris: false })]
  for (const files of support) for (const [name, text] of Object.entries(files.files)) await writeFile(path.join(root, path.basename(name)), String(text))
  const target = genTarget("fabric-1.21.1")
  const force = { ...target.loader.platformFiles({ ...plain, version: target.version }), ...playerForceFiles(plain.packageName) }
  for (const [name, text] of Object.entries(force)) await writeFile(path.join(root, path.basename(name)), String(text))
  const compiled = await targetJavac(CLASSPATH["fabric-1.21.1"], root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: the dash sample's whole tree is assembled by Studio's own build and compiles against the real class path`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-dash-tree-"))
    roots.push(root)
    await createTargetDashSample(path.join(root, "铁额关"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(path.join(root, "铁额关"), source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
    const creatures = await Promise.all(names.filter((name) => /StudioCreatureEntity\d_\w+\.java$/.test(name) && !/Renderer|Model/.test(name)).map((name) => readFile(name, "utf8")))
    expect(creatures.some((text) => text.includes("abilityDashStart(20, 1.0, 20.0, true, 8);"))).toBe(true)
    expect(creatures.some((text) => text.includes("{2.0, 0.25, 60.0}"))).toBe(true)
    // The common layer names no loader.
    expect(creatures.every((text) => !/^import net\.(minecraftforge|neoforged|fabricmc)\./m.test(text))).toBe(true)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}
