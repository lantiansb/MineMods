import type { Ability, Boss, Combo, Hitbox, SharedAbilityUse, Stance, Stances } from "./entity-runtime"
import { staggerList, type Stagger } from "./combat"
import { stanceRef } from "./finding-refs"
import { bossPhaseIds } from "./boss-words"

type CreatureStances = {
  behavior: string
  stances?: Stances | undefined
  abilities?: readonly Ability[] | null | undefined
  shared_abilities?: readonly SharedAbilityUse[] | null | undefined
  combos?: readonly Combo[] | null | undefined
  hitbox?: Hitbox | null | undefined
  boss?: Boss | null | undefined
  stagger?: Stagger | undefined
}

export const stanceEventIssues = (move: Ability, ids: ReadonlySet<string>) =>
  move.events.flatMap((event, index) => event.type === "stance" && !ids.has(event.to)
    ? [{ path: ["events", index, "to"], message: `找不到「${event.to}」姿态，请选这只生物已有的姿态。` }]
    : [])

export function stanceLeaveIssues(row: Stance, move: Ability) {
  if (row.leave?.ability !== move.id) return []
  const to = destinations(move)
  if (!to.length) return [{ path: ["leave", "ability"], message: "请选择一招带有切姿态的步骤。" }]
  if (!row.then && new Set(to).size > 1)
    return [{ path: ["then"], message: "这招能切到多个姿态，请选来不及出招时要切到哪里。" }]
  return []
}

const unique = (values: readonly string[]) => new Set(values).size === values.length
const destinations = (move: Ability | undefined) =>
  (move?.events ?? []).flatMap(event => event.type === "stance" ? [event.to] : [])

/** After senses gains its own schema, select the whole definition for the current stance at this boundary. */
export const currentStance = (value: Stances, id = value.start) => value.list.find(stance => stance.id === id) ?? value.list[0]!

export function stanceDocumentIssues(creature: CreatureStances) {
  const config = creature.stances
  const moves = creature.abilities ?? []
  const shared = creature.shared_abilities ?? []
  const combos = creature.combos ?? []
  const ids = new Set(config?.list.map(row => row.id))
  const choices = new Set([...moves, ...shared, ...combos].map(row => row.id))
  const issues: { path: (string | number)[]; message: string }[] = []
  const add = (path: (string | number)[], message: string) => issues.push({ path, message })
  const known = (id: string | undefined, path: (string | number)[]) => {
    if (id !== undefined && !ids.has(id)) add(path, `找不到「${id}」姿态，请选这只生物已有的姿态。`)
  }
  const refs = (rows: readonly (Ability | SharedAbilityUse | Combo)[], field: string) => rows.forEach((row, index) => {
    row.start.when?.forEach((rule, i) => { if (rule.if === "stance") known(rule.id, [field, index, "start", "when", i, "id"]) })
    row.start.weight_when?.forEach((rule, i) => { if (rule.if === "stance") known(rule.id, [field, index, "start", "weight_when", i, "id"]) })
    if ("events" in row) stanceEventIssues(row, ids).forEach(issue => add([field, index, ...issue.path], issue.message))
    if ("interrupt" in row) known(row.interrupt?.result?.stance, [field, index, "interrupt", "result", "stance"])
    if ("breaks" in row) row.breaks?.forEach((rule, i) => known(rule.result.stance, [field, index, "breaks", i, "result", "stance"]))
  })
  refs(moves, "abilities")
  refs(shared, "shared_abilities")
  refs(combos, "combos")
  staggerList(creature.stagger).forEach((kind, index) =>
    known(kind.result?.stance, ["stagger", ...(Array.isArray(creature.stagger) ? [index] : []), "result", "stance"]))
  for (const show of ["intro", "death"] as const) creature.boss?.[show]?.steps?.forEach((event, index) => {
    if (event.type === "stance") known(event.to, ["boss", show, "steps", index, "to"])
  })
  creature.boss?.phases.forEach((phase, index) => Object.keys(phase.stances ?? {}).forEach(id => {
    const path = ["boss", "phases", index, "stances", id]
    known(id, path)
    if (config?.list.some(row => row.id === id && !row.then)) add(path, "这个姿态需要先写到点后切到哪里。")
  }))
  if (!config) return issues
  if (creature.behavior !== "hostile" || !moves.length && !shared.length)
    add(["stances"], "姿态需要一只会出招的敌对生物。")
  known(config.start, ["stances", "start"])
  config.list.forEach((row, index) => {
    const path = ["stances", "list", index] as const
    if (config.list.findIndex(item => item.id === row.id) !== index)
      add([...path, "id"], "请给每个姿态用不同的代号。")
    known(row.then, [...path, "then"])
    if (row.max_seconds !== undefined && !row.then) add([...path, "then"], "请选到点后切到哪个姿态。")
    if (row.model?.hide?.some(name => row.model?.show?.includes(name)))
      add([...path, "model"], "同一根骨骼请只选藏起或露出中的一种。")
    if (row.then === row.id) add([...path, "then"], "请选当前姿态以外的姿态。")
    for (const [i, rule] of (row.when ?? []).entries()) {
      known(rule.to, [...path, "when", i, "to"])
      if (rule.if === "fixtures_lit" && !creature.boss?.arena?.fixtures?.length)
        add([...path, "when", i], "请先在场内放置可点亮的物件。")
    }
    for (const [i, id] of (row.abilities ?? []).entries())
      if (!choices.has(id)) add([...path, "abilities", i], "请选择这只生物已有的招式或连招。")
    for (const [i, scale] of (row.part_scales ?? []).entries()) {
      if (!creature.hitbox?.parts?.some(part => part.name === scale.part))
        add([...path, "part_scales", i, "part"], "请选择碰撞箱里已有的部位。")
      if (row.part_scales!.findIndex(other => other.part === scale.part) !== i)
        add([...path, "part_scales", i, "part"], "每个部位只写一次倍率。")
    }
    if (row.abilities && !unique(row.abilities)) add([...path, "abilities"], "每招只需选一次。")
    if (row.leave) {
      const pathToMove = [...path, "leave", "ability"]
      if (row.abilities && !row.abilities.includes(row.leave.ability)) add(pathToMove, "这招得先放进当前姿态能出的招里。")
      const move = moves.find(item => item.id === row.leave!.ability)
      if (move) stanceLeaveIssues(row, move).forEach(issue => add([...path, ...issue.path], issue.message))
      else if (!shared.some(use => use.id === row.leave!.ability)) add(pathToMove, "请选择一招带有切姿态的步骤。")
    }
  })
  return issues
}

/** Missing picks inherit the previous list. An empty list intentionally leaves no choices. */
export function stanceChoices(stance: Stance | undefined, choices: readonly string[], phase?: readonly string[], tactic?: readonly string[]) {
  return choices.filter(id => (!phase || phase.includes(id)) && (!stance?.abilities || stance.abilities.includes(id)) && (!tactic || tactic.includes(id)))
}

export function stanceClips(config: Stances | undefined) {
  return config?.list.flatMap(row => [row.clips?.idle, row.clips?.walk, row.change?.clip].flatMap(clip => clip ? [clip] : [])) ?? []
}

/** A reachability check counts edges, including moves shared by several stances. */
export function stanceFindings(creature: CreatureStances & { name: string; tactics?: import("./ability-tactics").Tactics | null }) {
  const config = creature.stances
  if (!config) return []
  const moves = creature.abilities ?? []
  const choices = [...moves, ...(creature.shared_abilities ?? []), ...(creature.combos ?? [])]
  const ids = choices.map(row => row.id)
  const explicit = [
    ...(creature.boss?.intro?.steps ?? []), ...(creature.boss?.death.steps ?? []),
  ].flatMap(step => step.type === "stance" ? [step.to] : [])
  const incoming = new Set([config.start, ...explicit, ...staggerList(creature.stagger).flatMap(row => row.result ? [row.result.stance] : [])])
  const reachable = new Set<string>()
  function visit(id: string) {
    if (reachable.has(id)) return
    const row = config!.list.find(pose => pose.id === id)
    if (!row) return
    reachable.add(id)
    for (const to of [row.then, ...(row.when ?? []).map(rule => rule.to)]) if (to) visit(to)
    const playable = stanceChoices(row, ids)
    const steps = new Set((creature.combos ?? []).filter(combo => playable.includes(combo.id)).flatMap(combo => combo.steps))
    for (const move of moves) if (playable.includes(move.id) || steps.has(move.id)) {
      for (const to of destinations(move)) visit(to)
      for (const rule of move.breaks ?? []) if (rule.result.stance) visit(rule.result.stance)
      if (move.interrupt?.result) visit(move.interrupt.result.stance)
    }
  }
  for (const id of incoming) visit(id)
  const phases = bossPhaseIds(creature.boss?.phases ?? [], ids, true)
  const close = creature.tactics?.hugged?.use, far = creature.tactics?.kited?.use
  const warnings = config.list.flatMap((row, index) => {
    const ref = stanceRef(row)
    const findings: { rule: "stance_unreachable" | "stance_empty" | "stance_boss_only"; refs: import("@minemods/studio-ai/acceptance").FindingRef[]; text: string; fix: string; field: string }[] = []
    if (!reachable.has(row.id))
      findings.push({ rule: "stance_unreachable", field: `stances.list.${index}.name`, refs: [ref], text: `「${creature.name}」到不了「${row.name}」姿态。`, fix: "让已有姿态、招式或演出能切进来，也可以选作开场姿态。" })
    const empty = (subset?: readonly string[]) => phases.every(phase => !stanceChoices(row, ids, phase, subset).length)
    const blocked = empty() ? "所有阶段都挑不出能用的招" : close && empty(close) ? "被贴身时挑不出能用的招" : far && empty(far) ? "被引着跑时挑不出能用的招" : null
    if (blocked)
      findings.push({ rule: "stance_empty", field: `stances.list.${index}.abilities`, refs: [ref], text: `「${creature.name}」在「${row.name}」时，${blocked}，它会等着。`, fix: "在对应的几份名单里留一招共同能用的，或者保留这段等待。" })
    if (!creature.boss && (row.bar || row.ambient))
      findings.push({ rule: "stance_boss_only", field: `stances.list.${index}.name`, refs: [ref], text: `「${creature.name}」的「${row.name}」写了血条颜色或天色，这些在 Boss 的战斗中才会出现。`, fix: "可以删掉这两项，或者把生物设成 Boss。" })
    return findings
  })
  return warnings
}

export function stanceWords(row: Stance, config: Stances, moves: readonly { id: string; name: string }[]) {
  const name = (id: string) => config.list.find(item => item.id === id)?.name ?? id
  const moveName = (id: string) => moves.find(move => move.id === id)?.name ?? id
  return [
    ...(row.id === config.start ? ["开场用这个姿态，脱离战斗后也会回来。"] : []),
    ...(row.clips?.walk === null ? ["平时停在原地。"] : []),
    ...(row.change ? [`切进来先停 ${row.change.seconds} 秒，这段时间不能出招。`] : []),
    ...(row.guard === null ? ["这个姿态没有正面格挡。"] : row.guard ? [`正面 ${row.guard.arc} 度内格挡，符合条件时承受 ${row.guard.damage_scale} 倍伤害。`] : []),
    ...(row.max_seconds !== undefined && row.then ? [`待满 ${row.max_seconds} 秒就切到「${name(row.then)}」。`] : []),
    ...(row.leave ? [`待满 ${row.leave.after_seconds} 秒先试「${moveName(row.leave.ability)}」来切姿态。出不了或被打断时，等 ${row.leave.retry_seconds} 秒再试，最多推迟 ${row.leave.max_delays} 回。`] : []),
    ...(row.when ?? []).map(rule => {
      const reason = rule.if === "fixtures_lit" ? `亮着至少 ${rule.count} 座物件` :
        rule.if === "stance_elapsed" ? `在这个姿态待满 ${rule.seconds} 秒` :
        rule.if === "target_still" ? `目标在 ${rule.within} 格内站定 ${rule.seconds} 秒` :
        rule.if === "damage_taken" ? `来击量累计到 ${"points" in rule.amount ? rule.amount.points + " 点" : "满血的 " + Math.round(100 * rule.amount.share) + "%"}` :
        `血量${rule.if === "health_above" ? "超过" : "降到"} ${Math.round(100 * rule.share)}%`
      return `${reason}时切到「${name(rule.to)}」。`
    }),
    ...(row.events?.length ? [`切入时有 ${row.events.length} 个步骤。`] : []),
  ]
}

export const STANCE_INSTRUCTIONS = `全部可以不写。会出招的敌对生物可以写 stances: {start, list}。start 是开场和脱战后回去的姿态代号。list 每项写不同的 id 和展示名 name。clips.idle 和 clips.walk 用模型已有动作，walk 写 null 表示平时留在原地。change 写 clip 和 seconds，切进来时不走、不转、不出招。model 沿用阶段的显隐、贴图和发光写法，只盖点名的部件；离开后恢复当前阶段，已经脱落的部件不会回来。events 沿用阶段 finish 的声光步骤。Boss 可在 bar.color 换血条颜色，在 ambient 写 sky（0–1，越大越暗）、tint（#RRGGBB）和 visibility（能看多远，单位是格），参战玩家会看见这些变化。
abilities 省略时沿用阶段，写了就与阶段和当前走位的名单取交集，空表表示等着。招式或连招的 start.when 可以写 {if:"stance",id:"shell"}，选招的 weight_when 可以写同样的条件并加 scale；连招按整套招筛，切姿态时也核对剩余的单招。正在出的招在新姿态里不许用时会停下来，包括撤掉预警和取消后面的出手。
max_seconds 和 then 表示待到时间就切，Boss 的 phases[].stances 可以按代号改最长时间，已经过去的时间照算。也可写 leave: {after_seconds,ability,retry_seconds,max_delays}，到点先试这招，它用 events 里的 {type:"stance",at,to} 来切换；被打断或起不了招时会推迟再试，用完次数就直接切到 then 或这招唯一的去处。登场和死亡步骤可用同一种事件。破绽组的 breaks.result、interrupt.result 和硬直的 result 能写 stance。when 里每条写 to，并从 health_point、health_above、health_below、damage_taken、fixtures_lit、stance_elapsed、target_still 中选触发条件。stance_elapsed 配 seconds，target_still 配 within 和 seconds。
来击按部位窗口、全身窗口、姿态 part_scales、阶段条目、部位原先的倍率依次寻找适用的一个。正面格挡再乘，命中窗口、正在硬直或判断不了来击方向时跳过。姿态 guard 可以换规则，写 null 可明确关闭。破防累计仍按倍率之前的来击量。
例如，已有翻滚 roll、咬合 bite 和碰撞箱部位 shell、head 的龟可以加：{"stances":{"start":"shell","list":[{"id":"shell","name":"缩壳","clips":{"walk":null},"part_scales":[{"part":"shell","damage_scale":0}],"abilities":["roll"],"max_seconds":3,"then":"peek"},{"id":"peek","name":"探头","abilities":["bite"]}]}}。在咬合的头部破绽组打够后，把结果写成 {"stance":"shell"}，龟就会缩回去。感知留给后续版本。`
