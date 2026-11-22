/**
 * Where a generated creature's own goals stand by priority, and where gameplay code may put its own.
 * One file with no imports: the generator, the reference check, the words an AI is given and the review
 * contract all read these numbers, and the app's window can too.
 */

/**
 * The goals every generated creature starts with, by priority (lower runs first). Gameplay code adds its
 * own between them through `ProjectContent.addGoal`; nothing here is ever taken away by it.
 */
export const BASELINE_GOALS = { swim: 0, engage: 1, wander: 5, look_at_player: 6, look_around: 7 } as const

/**
 * The priorities gameplay code may give a goal it adds. `over_idle`: below staying afloat and fighting,
 * above roaming, so the added behaviour takes over from idling and never from swimming or combat.
 * `after`: from here on, below everything the creature does by itself, for what it should do only when
 * it has nothing else to do. A goal at 0 or 1 would compete with swimming and combat for the same
 * controls (a creature that should fight stands still, one in water sinks); one at 5 to 7 ties with
 * roaming and looking, and which of two goals of one priority runs is whichever started first.
 */
export const GOAL_BAND = { over_idle: [BASELINE_GOALS.engage + 1, BASELINE_GOALS.wander - 1], after: BASELINE_GOALS.look_around + 1 } as const

export const inGoalBand = (priority: number) => (priority >= GOAL_BAND.over_idle[0] && priority <= GOAL_BAND.over_idle[1]) || priority >= GOAL_BAND.after

/** The baseline and the band in one sentence each, for whoever writes or checks gameplay code. */
export const GOAL_BAND_WORDS = {
  baseline: `生物自带的行为按优先级排着（数字越小越优先）：游泳 ${BASELINE_GOALS.swim}、追击或攻击 ${BASELINE_GOALS.engage}、闲逛 ${BASELINE_GOALS.wander}、看向玩家 ${BASELINE_GOALS.look_at_player}、张望 ${BASELINE_GOALS.look_around}`,
  band: `玩法加的行为，优先级只能写 ${GOAL_BAND.over_idle[0]} 到 ${GOAL_BAND.over_idle[1]}（排在追击后面、闲逛前面：该它上场时盖过闲逛，但不和游泳、战斗抢），或者 ${GOAL_BAND.after} 及以上（排在所有自带行为后面：闲着没别的事才轮到）`,
  why: `写 ${BASELINE_GOALS.swim} 或 ${BASELINE_GOALS.engage} 会和游泳、追击抢着运行（掉进水里不游、该打的时候站着不动）；写 ${BASELINE_GOALS.wander} 到 ${BASELINE_GOALS.look_around} 会和闲逛、张望撞在同一级，谁先开始谁占着`,
} as const
