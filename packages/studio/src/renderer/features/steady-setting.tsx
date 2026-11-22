import { For, Show, createSignal } from "solid-js"
import { unwrap } from "solid-js/store"
import type { Project } from "@minemods/mod-core/project"
import { STEADY_PRESETS, steadyAutoPreset, steadyPresetWords, type Steady } from "@minemods/mod-core/creature-steady"
import type { StudioView } from "../../api"

type PresetId = keyof typeof STEADY_PRESETS

/**
 * What the chosen tier comes to, in degrees a second: a tier's name alone tells no one how fast the creature turns (r20: the creator was choosing
 * between 40, 60 and 90 a second and the form showed only 「超巨型」).
 * `auto` says which tier this creature's hitbox takes when its height is written on it; otherwise it lists the three.
 */
export function steadyChosenWords(steady: Steady | null | undefined, height: number | null) {
  if (!steady) return []
  if (steady.preset && steady.preset !== "auto") return [steadyPresetWords(steady.preset)]
  if (steady.preset !== "auto") return ["自定义：每一项按这只生物自己写的数，没写的转身类按体型取。"]
  if (height === null) return ["按体型：看碰撞箱的高度取下面三档里的一档。", ...(Object.keys(STEADY_PRESETS) as PresetId[]).map(steadyPresetWords)]
  const taken = steadyAutoPreset(height)
  return taken ? [`按体型：它的碰撞箱高 ${Number(height.toFixed(2))} 格，取的是——${steadyPresetWords(taken)}`] : [`按体型：它的碰撞箱高 ${Number(height.toFixed(2))} 格，不到 ${STEADY_PRESETS.large.height} 格，转身和以前一样。`]
}

export function SteadySetting(props: { project: Project; entityId: string; disabled?: boolean; saved: (view: StudioView) => void }) {
  const creature = () => props.project.entities.find(value => value.id === props.entityId)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  async function save(preset: Steady["preset"] | null) {
    const entity = creature()
    if (!entity || busy()) return
    setBusy(true)
    setError("")
    try {
      const { name, description, health, speed, attack_damage, behavior } = entity
      const steady = preset ? { ...unwrap(entity.steady ?? {}), preset } : null
      props.saved(await window.studio.saveEntity({ projectId: props.project.id, expectedRevision: props.project.revision, entityId: entity.id, name, description, health, speed, attack_damage, behavior, steady }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重新打开这只生物。")
    } finally {
      setBusy(false)
    }
  }
  return <Show when={creature()}><section class="pa-part-block" aria-label="转身和盯人">
    <h4>转身和盯人</h4>
    <Show when={creature()?.steady} fallback={<button type="button" disabled={props.disabled || busy()} onClick={() => void save("auto")}>让它稳重</button>}>
      <label>稳重档位 <select aria-label="稳重档位" value={creature()?.steady?.preset ?? ""} disabled={props.disabled || busy()} onChange={event => void save(event.currentTarget.value as Steady["preset"])}>
        <Show when={!creature()?.steady?.preset}><option value="">自定义</option></Show><option value="auto">按体型</option>
        <For each={Object.entries(STEADY_PRESETS)}>{([id, p]) => <option value={id}>{p.label}（身体每秒 {p.body_turn}°）</option>}</For>
      </select></label>{" "}<button type="button" disabled={props.disabled || busy()} onClick={() => void save(null)}>去掉稳重</button>
      <For each={steadyChosenWords(creature()?.steady, creature()?.hitbox?.core.height ?? null)}>{line => <p class="pa-hint">{line}</p>}</For>
    </Show>
    <Show when={error()}><p role="alert">{error()}</p></Show>
  </section></Show>
}
