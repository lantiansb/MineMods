import type { InsideTab, CreatureInside } from "./creature-inside-model"
import { insideTabs } from "./creature-inside-model"
import { For, Show, type JSX } from "solid-js"
import { WORDS } from "../words"

export function CreationSteps(props: {
  data?: CreatureInside | null
  inside?: InsideTab | null
  onInside?: (tab:InsideTab)=>void
  menu?: JSX.Element
  page: string
  canContinue: boolean
  /** Why the last step cannot be opened, said on the step itself. */
  behaviorHint?: string
  onMode: (mode: "model" | "animation") => void
  onBehavior: () => void
  onLoot?: () => void
}) {
  const steps = [
    { id: "model", title: "外观", detail: "模型与贴图" },
    { id: "animation", title: WORDS.motion, detail: "播放动作" },
    { id: "behavior", title: "行为", detail: "设计玩法" },
  ] as const
  return (
    <nav class="object-workflow" aria-label="生物制作流程">
      <For each={steps}>
        {(step) => (
          <button
            class={`workflow-step ${(props.page === "texture" ? "model" : props.page) === step.id && !props.inside ? "active" : ""}`}
            aria-current={(props.page === "texture" ? "model" : props.page) === step.id && !props.inside ? "step" : undefined}
            disabled={step.id === "behavior" && !props.canContinue}
            title={step.id === "behavior" && !props.canContinue ? props.behaviorHint : undefined}
            onClick={() => (step.id === "behavior" ? props.onBehavior() : props.onMode(step.id))}
          >
            <span class="step-copy">
              <strong>{step.title}</strong>
            </span>
          </button>
        )}
      </For>
      <Show when={props.data}>{data=><For each={insideTabs.filter(tab=>tab.key==="sounds" || tab.count(data())>0)}>{tab=>
        <button class={`workflow-step ${props.inside===tab.key ? "active" : ""}`} aria-current={props.inside===tab.key ? "step" : undefined}
          onClick={()=>props.onInside?.(tab.key)}><strong>{tab.title}</strong> <small>{tab.count(data())}{tab.key === "sounds" ? " 处已设" : ""}</small></button>}</For>}</Show>
      <Show when={props.onLoot}>
        <button class="workflow-step" type="button" onClick={() => props.onLoot?.()}>编辑掉落</button>
      </Show>
      {props.menu}
    </nav>
  )
}
