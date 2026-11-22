import { assetRef, fixtureRef, uniqueFindingRefs } from "./finding-refs"
import { aimFixtureProblems, moveAimsAtFixture, fixtureCanCheckWalls, fixtureSlots, type FixtureAction } from "./fixture-events"
import { arenaPlan } from "./arena"
import { feasibleArc, fixtureConditions, fixtureConditionUses } from "./fixture-conditions"
import type { Stagger } from "./combat"
import type { Ability, Boss, Combo, Stances } from "./entity-runtime"

type Creature = {
  boss?: (Pick<Boss, "arena"> & Partial<Pick<Boss, "intro" | "death" | "phases">>) | null | undefined
  stagger?: Stagger | undefined
  stances?: Stances | undefined
  combos?: readonly Combo[] | null | undefined
  shared_abilities?: readonly { id?: string; asset?: string; start: Ability["start"] }[] | null | undefined
  abilities?: readonly Ability[] | null | undefined
}
export function usesFixtureControls(creature: Creature) {
  const boss = creature.boss
  return Boolean(
    boss?.arena?.fixtures.some((group) => !group.use || group.use.by === "hit" || group.use.lit_seconds !== undefined) ||
      fixtureConditions(creature).length ||
      creature.stances?.list.some(row => row.when?.some(rule => rule.if === "fixtures_lit") || row.events?.some(rule => rule.type === "fixture")) ||
      creature.abilities?.some(
        (move) =>
          moveAimsAtFixture(move) ||
          move.events.some((event) => event.type === "fixture") ||
          move.breaks?.some((rule) => rule.result.fixture),
      ) ||
      boss?.intro?.steps?.some((step) => step.type === "fixture") ||
      boss?.death?.steps?.some((step) => step.type === "fixture") ||
      boss?.phases?.some((phase) => phase.finish?.some((step) => step.type === "fixture")),
  )
}
export function fixtureIssues(creature: Creature) {
  const found: { path: (string | number)[]; message: string }[] = []
  const arena = creature.boss?.arena,
    slots = arena ? arenaPlan(arena).fixtures : []
  const add = (path: (string | number)[], message: string) => found.push({ path, message })
  // What the steps do to fixtures, so a group nobody can light (no `use`, no step lights it) is said.
  const doing = new Set<FixtureAction["do"]>()
  function action(value: FixtureAction, path: (string | number)[], at: number, end: number, ability?: Ability) {
    doing.add(value.do)
    if (!slots.length) {
      add(path, "这一步要改场地物件。请在 boss.arena.fixtures 里摆好物件。")
      return
    }
    const which = value.which
    let count = fixtureSlots(arena, which).length
    if (typeof which === "object" && "in_hit" in which) {
      const hit = ability?.hits[which.in_hit]
      if (hit?.type !== "area")
        add([...path, "which"], "in_hit 从 0 数，只能点名本招已有的范围出手。用它选择范围内的物件时，支撑方块不遮挡。演出和破绽结果可选组或实例。")
      else if (Math.round(at * 20) < Math.round(hit.at * 20))
        add([...path, "at"], "先出手才能知道罩住哪些物件。请把改灯放在范围出手同一刻或之后。")
    } else if (typeof which === "object") {
      for (const selector of Array.isArray(which) ? which : [which]) {
        const n = fixtureSlots(arena, selector).length
        if (!n)
          add(
            [...path, "which"],
            "场地里没有" +
              ("group" in selector ? "这一组 " + selector.group : "这座物件 " + selector.instance) +
              "。请对照场地图上的名称。",
          )
        if ("instance" in selector && n > 1) add([...path, "which"], "有两座展开后的实例同名，请给场地组换一个 id。")
      }
    }
    if (which === "nearest") count = 1
    if (value.every_seconds && at + (count - 1) * value.every_seconds > end + 0.000001)
      add([...path, "every_seconds"], "一盏盏切换的最后一步超过了演出或招式全长。请缩短间隔或延长演出。")
  }
  for (const [i, move] of (creature.abilities ?? []).entries()) {
    const p = ["abilities", i]
    move.hits.forEach((hit,j) => {
      if (hit.type === "area" && hit.fixture_walls && !fixtureCanCheckWalls(hit))
        add([...p,"hits",j,"fixture_walls"],"让方块挡住物件时，请选局部范围出手，并开启同一次出手的 blocked_by_walls。")
    })
    move.events.forEach((event, j) => {
      if (event.type === "fixture") action(event, [...p, "events", j], event.at, move.length, move)
    })
    move.breaks?.forEach((rule, j) => {
      if (rule.result.fixture)
        action({ type: "fixture", ...rule.result.fixture }, [...p, "breaks", j, "result", "fixture"], 0, Infinity)
    })
    for (const issue of aimFixtureProblems(move, slots.length)) add([...p, ...issue.path], issue.message)
  }
  for (const show of ["intro", "death"] as const) {
    const script = creature.boss?.[show]
    script?.steps?.forEach((step, i) => {
      if (step.type === "fixture") action(step, ["boss", show, "steps", i], step.at, script.seconds)
    })
  }
  creature.boss?.phases?.forEach((phase, i) =>
    phase.finish?.forEach((step, j) => {
      if (step.type === "fixture") action(step, ["boss", "phases", i, "finish", j], 0, Infinity)
    }),
  )
  for (const condition of fixtureConditions(creature))
    if (slots.length < condition.count)
      add(
        ["boss", "arena"],
        `条件要同时亮 ${condition.count} 座，场地只摆了 ${slots.length} 座。请补足物件或调低 count。`,
      )
  // A shared ability may light it from its own asset, and a stance's step is not read above: only said when neither can.
  const lights = doing.has("light") || Boolean(creature.shared_abilities?.length) || Boolean(creature.stances?.list.some((row) => row.events?.some((event) => event.type === "fixture" && event.do === "light")))
  if (!lights)
    arena?.fixtures.forEach((group, i) => {
      if (!group.use) add(["boss", "arena", "fixtures", i, "use"], `场地物件「${group.id}」没写 use，玩家点不亮它，招式和演出里也没有点亮它的步骤，它会一直不亮。要玩家能点亮就写 use；只想跟着招式亮，就在招式、登场或死亡里加 {type:"fixture", do:"light", which:{group:"${group.id}"}}。`)
    })
  return found
}
export function fixtureReview(creature: Creature) {
  const arena = creature.boss?.arena
  if (!arena) return []
  const spots = arenaPlan(arena).fixtures
  const fixtures = arena.fixtures.flatMap((group) => [fixtureRef(group.id), assetRef(group.look.asset)])
  return fixtureConditionUses(creature).flatMap(({ rule, refs }) => {
    const { max, narrow } = feasibleArc(spots, rule)
    return max < rule.count || narrow
      ? [
          {
            rule: "boss_arena" as const,
            refs: uniqueFindingRefs([...refs, ...fixtures]),
            stops: false,
            text: `从家观察，总角 ${rule.within_arc ?? 360}° 最多包含 ${max} 座。${narrow ? "必须恰好让物件压在边缘才能触发。" : "这个朝向条件凑不够。"}`,
            fix: "转动预览中的身体朝向，或增大 within_arc、挪动物件。",
            detail: "fixtures_lit from arena origin",
          },
        ]
      : []
  })
}
