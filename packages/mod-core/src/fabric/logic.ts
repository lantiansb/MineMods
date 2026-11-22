import type { Logic } from "../content"

type LogicCompilation = {
  fields: string
  method: string
  controller: string
  /** The statement that runs the rules once a tick, for a creature whose own tick() already exists; empty without rules. */
  tick: string
}

function javaString(value: string) {
  return JSON.stringify(value)
}

function itemIdentifier(value: string) {
  const match = /^([a-z][a-z0-9_.-]{0,63}):([a-z0-9][a-z0-9_./-]{0,63})$/.exec(value)
  if (!match) throw new Error(`逻辑物品引用无效: ${value}`)
  return `ResourceLocation.fromNamespaceAndPath(${javaString(match[1]!)}, ${javaString(match[2]!)})`
}

function animationIdentifier(value: string, animations: ReadonlySet<string>) {
  if (!animations.has(value)) throw new Error(`逻辑动作引用了不存在的动画: ${value}`)
  if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value)) throw new Error(`逻辑动画名称不受支持: ${value}`)
  return value
}

/** Generate executable server-side hooks for the supported content logic vocabulary. */
export function compileEntityLogic(
  logic: readonly Logic[],
  animations: readonly string[],
  modelIdentifier: string,
  /** False when the creature class writes its own tick(): Java allows one, so the rules are called from there. */
  ownTick = true,
): LogicCompilation {
  const animationNames = new Set(animations)
  const enabled = logic.filter((rule) => rule.enabled)
  const playRules = enabled.filter((rule) => rule.action === "play_animation")
  const followRules = enabled.filter((rule) => rule.action === "follow")
  const fields = [
    ...playRules.map((_rule, index) => `    private boolean studioLogicActive${index};`),
    ...(followRules.length ? ["    private boolean studioLogicFollowing;"] : []),
    ...followRules.flatMap((rule, index) => rule.trigger === "hurt" ? [`    private long studioLogicHurtFollowUntil${index};`] : []),
  ].join("\n")
  const triggerFields = playRules.map((rule, index) => {
    const animation = animationIdentifier(rule.animation!, animationNames)
    return `            .triggerableAnim("logic_${index}", RawAnimation.begin().then("animation.${modelIdentifier}.${animation}", Animation.LoopType.PLAY_ONCE))`
  }).join("\n")
  const conditionFor = (rule: Logic, needsPlayer = false) => {
    const trigger = rule.trigger === "hurt" ? "hurtTime > studioLogicLastHurtTime" : "player != null"
    if (rule.trigger === "holding_item") return `player != null && (player.getMainHandItem().is(BuiltInRegistries.ITEM.get(${itemIdentifier(rule.item!)})) || player.getOffhandItem().is(BuiltInRegistries.ITEM.get(${itemIdentifier(rule.item!)})))`
    if (rule.trigger === "hurt" && rule.action === "follow") {
      const followIndex = followRules.indexOf(rule)
      return `(tickCount < studioLogicHurtFollowUntil${followIndex})${needsPlayer ? " && player != null" : ""}`
    }
    return needsPlayer && rule.trigger === "hurt" ? `${trigger} && player != null` : trigger
  }
  const statements = enabled.map((rule) => {
    const condition = conditionFor(rule, rule.action === "look" || rule.action === "follow")
    if (rule.action === "look") return `        if (${condition}) getLookControl().setLookAt(player, 30.0f, 30.0f);`
    if (rule.action === "follow") return ""
    const active = `studioLogicActive${playRules.indexOf(rule)}`
    return `        if (${condition}) { if (!${active}) { triggerAnim("logic", "logic_${playRules.indexOf(rule)}"); ${active} = true; } } else ${active} = false;`
  }).join("\n")
  const followConditions = followRules.map((rule) => conditionFor(rule, true))
  const playerNeeded = enabled.some((rule) => rule.trigger !== "hurt" || rule.action === "look" || rule.action === "follow")
  const hurtFollowTimers = followRules
    .map((rule, index) => rule.trigger === "hurt" ? `        if (hurtTime > studioLogicLastHurtTime) studioLogicHurtFollowUntil${index} = tickCount + 40;` : "")
    .filter(Boolean)
    .join("\n")
  const stopFollowing = followConditions.length
    ? `        if (${followConditions.join(" || ")}) {
${followRules.map((rule) => `            if (${conditionFor(rule, true)}) getNavigation().moveTo(player, 1.0);`).join("\n")}
            studioLogicFollowing = true;
        } else if (studioLogicFollowing) {
            getNavigation().stop();
            studioLogicFollowing = false;
        }
`
    : ""
  const tick = "if (!level().isClientSide()) applyStudioLogic();"
  const method = enabled.length
    ? `    private int studioLogicLastHurtTime;

    private void applyStudioLogic() {
${playerNeeded ? "        Player player = level().getNearestPlayer(this, 8.0);\n" : ""}${hurtFollowTimers}${hurtFollowTimers ? "\n" : ""}${statements}
${stopFollowing}
        studioLogicLastHurtTime = hurtTime;
    }${ownTick ? `

    @Override public void tick() {
        super.tick();
        ${tick}
    }` : ""}`
    : ""
  return { fields, method, controller: triggerFields, tick: enabled.length ? tick : "" }
}
