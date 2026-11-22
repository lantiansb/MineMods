import type { Ability, AbilityHit, HitPlace } from "./entity-runtime"
export { FixtureActionSchema, type FixtureAction } from "./fixture-schema"
import type { FixtureAction } from "./fixture-schema"
import { arenaPlan, type Arena } from "./arena"

export const fixtureCanCheckWalls = (hit?: AbilityHit) => hit?.type === "area" && !!hit.blocked_by_walls && hit.shape.type !== "arena"

export function fixtureSlots(arena: Pick<Arena, "fixtures"> | null | undefined, which: FixtureAction["which"]) {
  if (!arena) return []
  return arenaPlan(arena).fixtures.flatMap((slot, index) => {
    if (typeof which === "object" && !("in_hit" in which)) {
      const list = Array.isArray(which) ? which : [which]
      if (
        !list.some((name) =>
          "group" in name ? arena.fixtures[slot.entry]?.id === name.group : slot.id === name.instance,
        )
      )
        return []
    }
    return [index]
  })
}
export function fixtureWords(action: FixtureAction, builtin?: import("./builtin").Builtin) {
  const which = action.which
  const subject =
    which === "all"
      ? "全部物件"
      : which === "nearest"
        ? "离施放者最近的物件"
        : Array.isArray(which)
          ? which.map((name) => ("group" in name ? `组「${name.group}」` : `物件「${name.instance}」`)).join("、")
          : "group" in which
            ? `物件组「${which.group}」`
            : "instance" in which
              ? `物件「${which.instance}」`
              : `第 ${which.in_hit + 1} 次出手罩住的物件（默认方块不挡）`
  const look = action.do === "light" ? builtin?.fixture_lit : action.do === "ember" ? builtin?.fixture_ember : undefined
  const ref = look?.particle
  const appearance = look?.effect ? "，显示工程效果" : ref === "none" ? "，不发粒子" :
    ref && typeof ref === "object" ? "，显示" + ("alias" in ref ? `粒子「${ref.alias}」` : "工程粒子") : ref ? `，显示粒子 ${ref}` : ""
  return `${{ light: "点亮", douse: "熄灭", ember: "变为余烬" }[action.do]} · ${subject}${appearance}${action.every_seconds ? `，每隔 ${action.every_seconds} 秒一座` : ""}`
}
export function fixtureStatement(
  action: FixtureAction,
  arena: Pick<Arena, "fixtures"> | null | undefined,
  owner: "ability" | "intro" | "death" | "finish",
) {
  const selected =
    typeof action.which === "object" && "in_hit" in action.which
      ? `fixtureHitMasks[${action.which.in_hit}]`
      : fixtureSlots(arena, action.which).reduce((mask, slot) => mask | (1 << slot), 0)
  return `StudioArena.change(StudioArena.room(this), this, ${selected}, ${action.which === "nearest"}, ${{ douse: 0, light: 1, ember: 2 }[action.do]}, ${Math.round(20 * (action.every_seconds ?? 0))}, "${owner}");`
}

export const namesFixture = (place: HitPlace | undefined) => typeof place === "object" && "fixture" in place
export function aimsAtFixture(hit: AbilityHit) {
  return hit.type === "area"
    ? namesFixture(hit.place)
    : hit.type === "projectile" && (namesFixture(hit.place) || ("sky" in hit.from && namesFixture(hit.from.sky.over)))
}
export function moveAimsAtFixture(move: Pick<Ability, "hits" | "events">) {
  return (
    move.hits.some(aimsAtFixture) ||
    move.events.some((event) => event.type === "lightning" && namesFixture(event.place))
  )
}

export function aimFixtureProblems(move: Ability, count: number) {
  const issues: { path: (string | number)[]; message: string }[] = []
  for (const [i, hit] of move.hits.entries())
    if (aimsAtFixture(hit)) {
      if (!count)
        issues.push({ path: ["hits", i], message: "这一下要打亮着的物件。请先在 boss.arena.fixtures 里摆物件。" })
      if (hit.type === "projectile" && hit.homing)
        issues.push({ path: ["hits", i, "homing"], message: "这一下已经指名物件落点，请去掉追踪生物的 homing。" })
      if (hit.type === "projectile" && "sky" in hit.from && hit.place && namesFixture(hit.from.sky.over))
        issues.push({ path: ["hits", i, "place"], message: "同一枚投射物只指定一次物件，选 place 或 from.sky.over。" })
      if (hit.type === "area" && hit.warn?.follow)
        issues.push({ path: ["hits", i, "warn", "follow"], message: "物件落点在预警时确定，请去掉跟随角色的 follow。" })
    }
  move.events.forEach((event, i) => {
    if (event.type === "lightning" && namesFixture(event.place) && !count)
      issues.push({ path: ["events", i], message: "这道雷要打亮着的物件，请先在 boss.arena 里摆好它们。" })
  })
  return issues
}

/** Sounds available to the creature sound table when listing its arena's interactions. */
export function fixtureSounds(arena: Pick<Arena, "fixtures"> | null | undefined) {
  return arena?.fixtures.length ? [{ event: "light" as const, sound: "minecraft:block.beacon.activate" }] : []
}
