import { Fold } from "../fold"
import { For, Show, createSignal, createMemo } from "solid-js"
import { abilityPlays, abilityWords, comboWords } from "@minemods/mod-core/creature-abilities"
import { creatureDesignHints } from "@minemods/mod-core/combat-design"
import { combatAdvice, combatGuide } from "@minemods/mod-core/combat"
import { branchWords } from "@minemods/mod-core/ability-tactics"
import { ABILITY_SOUNDS } from "@minemods/mod-core/ability-words"
import { particleLabel, resolveParticle } from "@minemods/mod-core/particle-emission"
import { CreaturePicture, type InsideActions } from "./creature-inside-page"

export function CreatureMoves(p: InsideActions) {
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const extract = async (moveId: string) => {
    const project = p.data.project
    const owner = project.workspace.assets.find(a => a.document.kind === "entity" && a.document.model_asset_id === p.data.doc.model_asset_id)
    if (!owner || saving()) return
    setSaving(true)
    setError("")
    try {
      const result = await window.studio.extractAbility({ projectId: project.id, expectedRevision: project.revision, entityAssetId: owner.id, moveId })
      p.saved(result.view)
      p.go(result.assetId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }
  const advice = createMemo(() => combatAdvice({ ...p.data.doc, abilities: p.data.moves }))
  return (
    <>
      <h2>
        招式 {p.data.moves.length} 个 · 连招 {p.data.combos.length} 套
      </h2>
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <For each={p.data.moves}>
        {(move) => {
          const shared = p.data.doc.shared_abilities?.find(
            (u) => u.id === move.id && !p.data.doc.abilities?.some((a) => a.id === u.id),
          )
          const hints = createMemo(() => creatureDesignHints(p.data.doc, [move], p.data.model))
          const hitLines = () => {
            const groups = new Map<string, number[]>()
            for (const hit of move.hits) {
              const text = abilityWords.hit(hit, undefined, p.data.names).replace(/^第 [0-9.]+ 秒/, "")
              groups.set(text, [...(groups.get(text) ?? []), hit.at])
            }
            return [...groups].map(([text, times]) => "第 " + times.join("、") + " 秒" + text)
          }
          const eventLines = () => {
            const lines = new Map<string, number>()
            for (const event of move.events) {
              const line = abilityWords.events({ ...move, events: [event] }, p.data.names)
              if (line) lines.set(line, (lines.get(line) ?? 0) + 1)
            }
            return [...lines].map(([line, count]) => {
              return count > 1 ? `${line}（共 ${count} 次）` : line
            })
          }
          const motion = () => p.data.motion(move.clip)
          return (
            <article class="inside-card" id={"creature-move-" + move.id}>
              <header>
                <h3>{move.name}</h3>
                <button disabled={p.busy} onClick={() => p.edit({ tab: "moves", id: move.id })}>编辑这招</button>
                <Show when={shared}>
                  <button disabled={p.busy} onClick={() => p.edit({ tab: "moves", id: move.id, skill: true })}>编辑共用出手</button>
                </Show>
                <Show when={shared} fallback={<button disabled={p.busy || saving()} onClick={() => void extract(move.id)}>提取成技能</button>}>
                  <button onClick={() => p.go(shared!.asset)}>来自技能「{p.data.title(shared!.asset)}」</button>
                </Show>
                <button
                  disabled={!p.data.model?.animations.some((c) => c.name === move.clip)}
                  onClick={() => p.play(move.clip, move.name)}
                >
                  播放
                </button>
              </header>
              <dl>
                <dt>多远会用</dt>
                <dd>{abilityWords.start(move)}</dd>
                <dt>伤害</dt>
                <dd>
                  <Show when={move.hits.length} fallback="没有伤害">
                    <For each={hitLines()}>{(line) => <p>{line}</p>}</For>
                  </Show>
                </dd>
                <dt>蓄力</dt>
                <dd>{move.windup} 秒</dd>
                <dt>全程</dt>
                <dd>{move.length} 秒</dd>
                <dt>歇多久</dt>
                <dd>{move.start.cooldown} 秒</dd>
              </dl>
              <Show when={p.data.phases.length}>
                <p>
                  哪些阶段用{" "}
                  <For each={p.data.phases.map((s, i) => ({ s, i })).filter(({ s }) => s.ids.includes(move.id))}>
                    {({ i }) => <button onClick={() => p.selectPhase(i)}>第 {i + 1} 阶段</button>}
                  </For>
                </p>
              </Show>
              <p class="inside-badges">
                用到的 <button onClick={() => p.play(move.clip, move.name)}>动作 · {motion()}</button>
                <For each={move.events}>
                  {(ev) => {
                    if (ev.type === "sound") {
                      const sound = ev.sound
                      return (
                        <>
                          <button onClick={() => void p.listen(sound)}>
                            试听 ·{" "}
                            {typeof sound === "string"
                              ? (ABILITY_SOUNDS[sound] ?? "原版声音")
                              : p.data.title(sound.asset)}
                          </button>
                          <Show when={typeof sound === "object"}>
                            <button
                              onClick={() => {
                                if (typeof sound === "object") p.go(sound.asset)
                              }}
                            >
                              查看声音
                            </button>
                          </Show>
                        </>
                      )
                    }
                    if (ev.type === "particle") {
                      const ref = resolveParticle(ev.particle, p.data.doc.particles)
                      return (
                        <button
                          disabled={typeof ref !== "object" || !p.data.title(ref.asset)}
                          onClick={() => {
                            if (ref && typeof ref === "object") p.go(ref.asset)
                          }}
                        >
                          粒子 · {particleLabel(ev.particle, p.data.names)}
                        </button>
                      )
                    }
                    if (ev.type === "effect")
                      return <button onClick={() => p.go(ev.effect)}>效果 · {p.data.title(ev.effect)}</button>
                  }}
                </For>
              </p>
              <For each={advice().filter(item => item.ability === move.id)}>{item => <p class="inside-hint">{item.text}</p>}</For>
              <For each={hints()}>{(h) => <p class="inside-hint">{h.text}</p>}</For>
              <For each={combatGuide({ abilities: [move] }, p.data.names.bone)}>{(s) => <p>{s}</p>}</For>
              <CreaturePicture data={p.data} part="move" value={move.id} label="看判定范围图" busy={p.busy} />
              <Fold summary="全部说明">
                <p>{abilityPlays(move, p.data.model?.animations ?? null, p.data.motion)}</p>
                <p>{abilityWords.summary(move, "\n", undefined, p.data.motion, p.data.doc.stagger, p.data.names)}</p>
                <Show when={eventLines().length}>
                  <ul><For each={eventLines()}>{(line) => <li>{line}</li>}</For></ul>
                </Show>
              </Fold>
              <button
                disabled={p.busy || !p.canAsk}
                title={!p.canAsk ? "先连接 AI" : undefined}
                onClick={() =>
                  p.ask("请修改「" + p.data.doc.name + "」的招式「" + move.name + "」，先和我确认要怎么改。")
                }
              >
                让 AI 改这一招
              </button>
            </article>
          )
        }}
      </For>
    </>
  )
}

export function CreatureCombos(p: InsideActions) {
  const named = (id: string) => p.data.actions.find((a) => a.id === id)?.name ?? "指定招式"
  return (
    <For each={p.data.combos}>
      {(combo) => (
        <article class="inside-card" id={"creature-move-" + combo.id}>
          <h3>连招「{combo.name}」</h3>
          <p>{comboWords.summary(combo, p.data.moves, "；", true, p.data.doc.stagger)}</p>
          <p>{comboWords.timeline(combo, p.data.moves)}</p>
          <div class="combo-path">
            <For each={combo.steps}>
              {(id, i) => (
                <>
                  {i() > 0 ? " → " : ""}
                  <button onClick={() => p.selectMove(id)}>{named(id)}</button>
                </>
              )}
            </For>
          </div>
          <For each={combo.branches}>{(b) => <p>{branchWords({ ...combo, branches: [b] }, named)}</p>}</For>
        </article>
      )}
    </For>
  )
}
