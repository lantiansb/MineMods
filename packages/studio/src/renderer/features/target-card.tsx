import { createSignal, For, Show } from "solid-js"
import type { GameTarget, StudioApi } from "../../api"
import { LOADER_NAMES, SETUP_WORDS, landOn, loadersAt, targetLine, versionsOf, whyNot } from "./project-setup-model"
import "./project-setup.css"

type Targets = Awaited<ReturnType<StudioApi["getTargets"]>>
// The catalogue is a static table of the main process: asked once per window. A failed ask is forgotten, so the
// next page that needs it asks again instead of keeping the failure.
let catalogue: Promise<Targets> | null = null
export function loadTargets() {
  catalogue ??= window.studio.getTargets().catch((cause: unknown) => {
    catalogue = null
    throw cause
  })
  return catalogue
}

/**
 * 「游戏和加载器」: a game version, a loader, its version. Every combination of the catalogue is shown; one Studio
 * cannot make yet is greyed with its reason under the selector while it is pointed at or pressed, and a press on it
 * never moves the choice: `value` is only ever a target that can be made.
 */
export function TargetCard(props: { targets: readonly GameTarget[]; value: string; onChange: (id: string) => void }) {
  const chosen = () => props.targets.find((target) => target.id === props.value)
  // A version looked at that has nothing Studio can make: shown in the select, while the choice stays where it was.
  const [viewing, setViewing] = createSignal<string | null>(null)
  const [hovered, setHovered] = createSignal<GameTarget | null>(null)
  const [pressed, setPressed] = createSignal<GameTarget | null>(null)
  const version = () => viewing() ?? chosen()?.minecraft ?? versionsOf(props.targets)[0]?.minecraft ?? ""
  const loaders = () => loadersAt(props.targets, version())
  // The loader whose versions the last line lists: the chosen one on its own version, else the one last pressed.
  const entry = () => loaders().find((value) => value.targets.some((target) => target.id === (pressed() ?? chosen())?.id)) ?? loaders()[0]
  const choose = (target: GameTarget) => {
    setViewing(null)
    setPressed(null)
    props.onChange(target.id)
  }
  const pickVersion = (minecraft: string) => {
    setPressed(null)
    const landed = landOn(props.targets, minecraft, chosen()?.loader) ?? landOn(props.targets, minecraft)
    if (landed) return choose(landed)
    setViewing(minecraft)
  }
  const press = (target: GameTarget) => (target.ready ? choose(target) : setPressed(target))
  const why = () => {
    const pointed = hovered() ?? pressed()
    if (pointed && !pointed.ready) return whyNot(pointed)
    const looked = viewing() && loadersAt(props.targets, viewing()!)[0]?.target
    return looked ? whyNot(looked) : null
  }
  return (
    <section class="setup-card target-card" aria-label={SETUP_WORDS.target}>
      <header class="setup-card-head">
        <h3>{SETUP_WORDS.target}</h3>
      </header>
      <div class="target-grid">
        <label class="field">
          {SETUP_WORDS.game}
          <select aria-label={SETUP_WORDS.game} value={version()} onChange={(event) => pickVersion(event.currentTarget.value)}>
            <For each={versionsOf(props.targets)}>
              {(value) => (
                <option value={value.minecraft} selected={value.minecraft === version()}>
                  {value.minecraft}
                  {value.ready ? "" : "（还做不了）"}
                </option>
              )}
            </For>
          </select>
        </label>
        <div class="field">
          {SETUP_WORDS.loader}
          <div class="target-loaders" role="radiogroup" aria-label={SETUP_WORDS.loader}>
            <For each={loaders()}>
              {(value) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={value.targets.some((target) => target.id === props.value)}
                  aria-disabled={!value.target.ready}
                  title={whyNot(value.target) ?? ""}
                  onMouseEnter={() => setHovered(value.target)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(value.target)}
                  onBlur={() => setHovered(null)}
                  onClick={() => press(value.target)}
                >
                  {LOADER_NAMES[value.loader]}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
      <Show when={entry()}>
        {(shown) => (
          <Show
            when={shown().targets.length > 1}
            fallback={
              <Show when={shown().target.loaderVersion}>
                <p class="target-line">
                  {SETUP_WORDS.loaderVersion}：{shown().target.loaderVersion}
                </p>
              </Show>
            }
          >
            <label class="field target-line">
              {SETUP_WORDS.loaderVersion}
              <select
                aria-label={SETUP_WORDS.loaderVersion}
                value={shown().targets.find((target) => target.id === props.value)?.id ?? shown().target.id}
                onChange={(event) => {
                  const target = shown().targets.find((value) => value.id === event.currentTarget.value)
                  if (target) press(target)
                  // A select shows what was picked; one that cannot be made goes back to the choice.
                  event.currentTarget.value = shown().targets.find((value) => value.id === props.value)?.id ?? shown().target.id
                }}
              >
                <For each={shown().targets}>
                  {(target) => (
                    <option value={target.id} selected={target.id === (shown().targets.find((value) => value.id === props.value)?.id ?? shown().target.id)}>
                      {target.loaderVersion ?? LOADER_NAMES[target.loader]}
                      {target.ready ? "" : "（还做不了）"}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
        )}
      </Show>
      <Show when={why()}>
        <p class="target-why" role="status">
          {why()}
          <Show when={(viewing() || pressed()) && chosen()}> {SETUP_WORDS.stays(targetLine(chosen()!))}</Show>
        </p>
      </Show>
    </section>
  )
}
