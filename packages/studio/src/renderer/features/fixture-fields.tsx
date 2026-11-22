import { Index, Show, createMemo } from "solid-js"
import type { ArenaFixture } from "@minemods/mod-core/arena"
import { fixtureLabels } from "./fixture-names"

export function FixtureFields(props: {
  groups: ArenaFixture[]
  title: (id: string) => string | undefined
  advanced: boolean
  disabled: boolean
  edit: (key: string, value: unknown) => void
}) {
  const labels = createMemo(() => fixtureLabels(props.groups.map(group => ({ id: group.id, asset: group.look.asset })), props.title))
  return (
    <section class="ae-section mc-window">
      <h3>场地物件的点亮方式</h3>
      <Index each={props.groups}>
        {(group, i) => {
          const key = `boss.arena.fixtures.${i}.use.`
          const duration = () => group().use?.lit_seconds
          const mode = () => (duration() === undefined ? "legacy" : duration() === null ? "keep" : "timed")
          return (
            <fieldset disabled={props.disabled}>
              <legend>{labels().get(group().id)}{props.advanced && <small>（{group().id}）</small>}</legend>
              <label>
                点亮方式{" "}
                <select
                  value={group().use ? (group().use?.by ?? "hold") : "none"}
                  onChange={(e) => {
                    const by = e.currentTarget.value
                    // No use: the player cannot light it, only the abilities and shows do. Back to one: a click that lights it, no wait.
                    if (by === "none") return props.edit(`boss.arena.fixtures.${i}.use`, undefined)
                    if (!group().use) return props.edit(`boss.arena.fixtures.${i}.use`, { by, seconds: 0, cooldown: 0 })
                    props.edit(key + "by", by)
                  }}
                >
                  <option value="hold">按右键</option>
                  <option value="hit">近战或玩家的箭</option>
                  <option value="none">玩家点不亮（只跟着招式和演出亮）</option>
                </select>
              </label>
              <Show when={group().use}>
              <label>
                点亮时长{" "}
                <select
                  value={mode()}
                  onChange={(e) => {
                    const mode = e.currentTarget.value
                    props.edit(
                      key + "lit_seconds",
                      mode === "keep" ? null : mode === "legacy" ? undefined : group().clear.seconds,
                    )
                  }}
                >
                  <option value="legacy">沿用清雾秒数</option>
                  <option value="timed">指定秒数</option>
                  <option value="keep">保持到下次动作</option>
                </select>
              </label>
              <Show when={mode() === "timed"}>
                <label>
                  亮灯秒数{" "}
                  <input
                    type="number"
                    min="0.05"
                    max="3600"
                    step="0.05"
                    value={duration() ?? 1}
                    onChange={(e) => {
                      const n = e.currentTarget.valueAsNumber
                      if (Number.isFinite(n)) props.edit(key + "lit_seconds", n)
                    }}
                  />
                </label>
              </Show>
              </Show>
              {(["light", "ember_light"] as const).map((field) => (
                <label>
                  {field === "light" ? "亮着时的方块光照" : "余烬的方块光照"}{" "}
                  <input
                    type="number"
                    min="0"
                    max="15"
                    step="1"
                    placeholder="0"
                    value={group()[field] ?? ""}
                    onChange={(e) => {
                      const input = e.currentTarget
                      if (!input.value || input.validity.valid)
                        props.edit(`boss.arena.fixtures.${i}.${field}`, input.value ? input.valueAsNumber : undefined)
                    }}
                  />
                </label>
              ))}
            </fieldset>
          )
        }}
      </Index>
    </section>
  )
}
