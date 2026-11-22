import { For, Show } from "solid-js"
import { ItemIcon } from "./item-icon"
import "./reward-pool.css"

export type RewardOutcome = {
  weight: number
  items: { item: string; min: number; max: number }[]
  effects: { effect: string; duration_ticks: number; amplifier: number }[]
}

// Names and a representative colour for the rewards blind boxes can hand out.
const items: Record<string, { name: string; color: string }> = {
  "minecraft:apple": { name: "苹果", color: "#d8322b" },
  "minecraft:bread": { name: "面包", color: "#c28a3e" },
  "minecraft:emerald": { name: "绿宝石", color: "#1fbf5b" },
  "minecraft:oak_sapling": { name: "橡树树苗", color: "#4f8a2b" },
  "minecraft:diamond": { name: "钻石", color: "#4ee2e2" },
  "minecraft:golden_apple": { name: "金苹果", color: "#f2c230" },
  "minecraft:coal": { name: "煤炭", color: "#2c2c2c" },
  "minecraft:torch": { name: "火把", color: "#f39a26" },
  "minecraft:iron_ingot": { name: "铁锭", color: "#d8d8d8" },
  "minecraft:copper_ingot": { name: "铜锭", color: "#c8693f" },
  "minecraft:gold_ingot": { name: "金锭", color: "#f4d043" },
  "minecraft:cooked_salmon": { name: "熟鲑鱼", color: "#e8845b" },
  "minecraft:slime_ball": { name: "黏液球", color: "#7ccf5c" },
  "minecraft:clay_ball": { name: "黏土球", color: "#a2a8b8" },
  "minecraft:prismarine_shard": { name: "海晶碎片", color: "#5fa89a" },
  "minecraft:heart_of_the_sea": { name: "海洋之心", color: "#2c6fd6" },
}
const effects: Record<string, string> = {
  slowness: "缓慢",
  blindness: "失明",
  poison: "中毒",
  weakness: "虚弱",
  nausea: "反胃",
  hunger: "饥饿",
  mining_fatigue: "挖掘疲劳",
  levitation: "飘浮",
  darkness: "黑暗",
  wither: "凋零",
  speed: "迅捷",
  regeneration: "生命恢复",
  strength: "力量",
}
const roman = ["I", "II", "III", "IV", "V"]

export const itemName = (id: string) => items[id]?.name ?? id.replace(/^minecraft:/, "").replaceAll("_", " ")

/** Accepts anything that looks like a list of weighted outcomes (used to spot pools inside design notes). */
export function asRewardPool(value: unknown): RewardOutcome[] | null {
  if (!Array.isArray(value) || !value.length) return null
  const valid = value.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as RewardOutcome).weight === "number" &&
      Array.isArray((entry as RewardOutcome).items ?? []) &&
      Array.isArray((entry as RewardOutcome).effects ?? []),
  )
  if (!valid) return null
  return value.map((entry) => ({
    weight: (entry as RewardOutcome).weight,
    items: ((entry as RewardOutcome).items ?? []).filter((item) => typeof item?.item === "string"),
    effects: ((entry as RewardOutcome).effects ?? []).filter((effect) => typeof effect?.effect === "string"),
  }))
}

/**
 * A blind-box pool at a glance: one bar split by chance (green for rewards, red for penalties),
 * then one row per outcome with item icons and effect badges.
 */
export function RewardPool(props: { outcomes: RewardOutcome[]; label?: string }) {
  const total = () => props.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0) || 1
  const share = (weight: number) => Math.round((weight / total()) * 100)
  const penalty = (outcome: RewardOutcome) => !outcome.items.length && outcome.effects.length > 0
  const rewards = () => props.outcomes.filter((outcome) => !penalty(outcome)).reduce((sum, o) => sum + o.weight, 0)
  return (
    <section class="reward-pool" aria-label={props.label ?? "盲盒奖池"}>
      <div class="reward-odds">
        <span>
          奖励 <strong>{share(rewards())}%</strong>
        </span>
        <span>
          惩罚 <strong>{100 - share(rewards())}%</strong>
        </span>
      </div>
      <div class="reward-bar" aria-hidden="true">
        <For each={props.outcomes}>
          {(outcome) => (
            <span
              classList={{ penalty: penalty(outcome) }}
              style={{ "flex-grow": outcome.weight }}
              title={`${share(outcome.weight)}%`}
            />
          )}
        </For>
      </div>
      <ol class="reward-rows">
        <For each={props.outcomes}>
          {(outcome) => (
            <li classList={{ penalty: penalty(outcome) }}>
              <span class="reward-chance">{share(outcome.weight)}%</span>
              <span class="reward-items">
                <For each={outcome.items}>
                  {(reward) => (
                    <span class="reward-item" title={reward.item}>
                      <ItemIcon id={reward.item} color={items[reward.item]?.color} />
                      <span>
                        {itemName(reward.item)}
                        <em>{reward.min === reward.max ? `×${reward.min}` : `×${reward.min}–${reward.max}`}</em>
                      </span>
                    </span>
                  )}
                </For>
                <For each={outcome.effects}>
                  {(effect) => (
                    <span class="reward-effect">
                      {effects[effect.effect] ?? effect.effect} {roman[effect.amplifier] ?? effect.amplifier + 1}
                      <em>{Math.round(effect.duration_ticks / 20)} 秒</em>
                    </span>
                  )}
                </For>
                <Show when={!outcome.items.length && !outcome.effects.length}>
                  <span class="reward-empty">什么也没有</span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ol>
    </section>
  )
}
