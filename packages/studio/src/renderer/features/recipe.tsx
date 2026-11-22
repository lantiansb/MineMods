import { Icon } from "../ui"
import { Index, Show } from "solid-js"
import type { RecipeBrief } from "@minemods/mod-core/conception"
import "./recipe.css"

export type RecipeWorkbenchProps = { value: RecipeBrief; disabled?: boolean; onChange: (value: RecipeBrief) => void }

export function RecipeWorkbench(props: RecipeWorkbenchProps) {
  const draft = () => props.value
  const cache = new Map<RecipeBrief["recipe_type"], RecipeBrief>()
  const update = (changes: Partial<RecipeBrief>) => {
    if (!props.disabled) props.onChange({ ...draft(), ...changes })
  }
  const switchKind = (kind: RecipeBrief["recipe_type"]) => {
    cache.set(draft().recipe_type, structuredClone(draft()))
    props.onChange(
      cache.get(kind) ?? {
        ...draft(),
        recipe_type: kind,
        input_names:
          kind === "crafting"
            ? Array.from({ length: 9 }, (_, index) => draft().input_names[index] ?? "")
            : [draft().input_names.find((value) => value.trim()) ?? ""],
        output_names: [draft().output_name],
      },
    )
  }
  const inputs = () => draft().input_names
  const outputs = () => (draft().output_names.length ? draft().output_names : [draft().output_name])
  const setInput = (index: number, value: string) =>
    update({
      input_names: (draft().recipe_type === "crafting"
        ? Array.from({ length: 9 }, (_, i) => inputs()[i] ?? "")
        : inputs()
      ).map((item, position) => (position === index ? value : item)),
    })
  const setOutput = (index: number, value: string) => {
    const next = outputs().map((item, position) => (position === index ? value : item))
    update({ output_name: next[0] ?? "", output_names: next })
  }
  const addEntry = (key: "input_names" | "output_names") => {
    const values = key === "input_names" ? inputs() : outputs()
    if (values.length < 16) update({ [key]: [...values, ""] } as Partial<RecipeBrief>)
  }
  const removeEntry = (key: "input_names" | "output_names", index: number) => {
    const values = (key === "input_names" ? inputs() : outputs()).filter((_, position) => position !== index)
    update(key === "output_names" ? { output_name: values[0] ?? "", output_names: values } : { input_names: values })
  }
  return (
    <section class="recipe-workbench" aria-label="配方工作台">
      <div class="recipe-layout">
        <div class="recipe-main">
          <Show when={draft().recipe_type === "crafting"}>
            <div class="recipe-card">
              <div class="card-title">
                <h2>3×3 合成</h2>
              </div>
              <div class="crafting-row">
                <div class="stencil-grid">
                  <Index each={Array.from({ length: 9 }, (_, index) => inputs()[index] ?? "")}>
                    {(item, index) => (
                      <label class="text-slot">
                        <span class="sr-only">材料格 {index + 1}</span>
                        <input
                          aria-label={`材料格 ${index + 1}`}
                          value={item()}
                          disabled={props.disabled}
                          placeholder="空"
                          onInput={(event) => setInput(index, event.currentTarget.value)}
                        />
                      </label>
                    )}
                  </Index>
                </div>
                <Icon name="arrow" class="recipe-arrow" />
                <div class="result-preview">
                  <strong>{outputs()[0] || "未填写产物"}</strong>
                  <span>×{draft().count}</span>
                </div>
              </div>
            </div>
          </Show>
          <Show when={draft().recipe_type === "furnace"}>
            <div class="recipe-card furnace-card">
              <div class="card-title">
                <h2>熔炉配方</h2>
              </div>
              <div class="furnace-row">
                <label>
                  输入
                  <input
                    value={inputs()[0] ?? ""}
                    disabled={props.disabled}
                    onInput={(event) => setInput(0, event.currentTarget.value)}
                  />
                </label>
                <Icon name="arrow" class="recipe-arrow" />
                <label>
                  产物
                  <input
                    value={outputs()[0] ?? ""}
                    disabled={props.disabled}
                    onInput={(event) => setOutput(0, event.currentTarget.value)}
                  />
                </label>
              </div>
              <div class="furnace-meta">
                <label>
                  燃料
                  <input
                    value={draft().fuel}
                    disabled={props.disabled}
                    onInput={(event) => update({ fuel: event.currentTarget.value })}
                  />
                </label>
                <label>
                  时间
                  <input
                    value={draft().duration}
                    disabled={props.disabled}
                    placeholder="例如 200 ticks"
                    onInput={(event) => update({ duration: event.currentTarget.value })}
                  />
                </label>
              </div>
            </div>
          </Show>
          <Show when={draft().recipe_type === "custom"}>
            <div class="recipe-card">
              <div class="card-title">
                <h2>自定义容器</h2>
              </div>
              <label class="recipe-description">
                容器说明
                <textarea
                  aria-label="容器说明"
                  value={draft().container_description ?? ""}
                  disabled={props.disabled}
                  rows="5"
                  onInput={(event) => update({ container_description: event.currentTarget.value })}
                />
              </label>
              <div class="recipe-columns">
                <div>
                  <h3>输入</h3>
                  <Index each={inputs()}>
                    {(item, index) => (
                      <div class="repeat-row">
                        <input
                          aria-label={`输入 ${index + 1}`}
                          value={item()}
                          disabled={props.disabled}
                          onInput={(event) => setInput(index, event.currentTarget.value)}
                        />
                        <button
                          type="button"
                          disabled={props.disabled || inputs().length <= 1}
                          onClick={() => removeEntry("input_names", index)}
                        >
                          移除
                        </button>
                      </div>
                    )}
                  </Index>
                  <button
                    type="button"
                    disabled={props.disabled || inputs().length >= 16}
                    onClick={() => addEntry("input_names")}
                  >
                    + 添加输入
                  </button>
                </div>
                <div>
                  <h3>输出</h3>
                  <Index each={outputs()}>
                    {(item, index) => (
                      <div class="repeat-row">
                        <input
                          aria-label={`输出 ${index + 1}`}
                          value={item()}
                          disabled={props.disabled}
                          onInput={(event) => setOutput(index, event.currentTarget.value)}
                        />
                        <button
                          type="button"
                          disabled={props.disabled || outputs().length <= 1}
                          onClick={() => removeEntry("output_names", index)}
                        >
                          移除
                        </button>
                      </div>
                    )}
                  </Index>
                  <button
                    type="button"
                    disabled={props.disabled || outputs().length >= 16}
                    onClick={() => addEntry("output_names")}
                  >
                    + 添加输出
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </div>
        <aside class="recipe-inspector">
          <label>
            产物
            <input
              aria-label="合成产物"
              value={draft().output_name}
              disabled={props.disabled}
              onInput={(event) =>
                update({
                  output_name: event.currentTarget.value,
                  output_names: [event.currentTarget.value, ...outputs().slice(1)],
                })
              }
            />
          </label>
          <label>
            类型
            <select
              aria-label="类型"
              value={draft().recipe_type}
              disabled={props.disabled}
              onChange={(event) => switchKind(event.currentTarget.value as RecipeBrief["recipe_type"])}
            >
              <option value="crafting">3×3 合成</option>
              <option value="furnace">熔炉</option>
              <option value="custom">其他</option>
            </select>
          </label>
          <label>
            产出数量
            <input
              type="number"
              min="1"
              max="64"
              value={draft().count}
              disabled={props.disabled}
              onInput={(event) =>
                update({ count: Math.max(1, Math.min(64, Math.floor(event.currentTarget.valueAsNumber || 1))) })
              }
            />
          </label>
        </aside>
      </div>
    </section>
  )
}
