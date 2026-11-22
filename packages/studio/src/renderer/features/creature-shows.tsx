import { WORDS } from "../words"
import { For, Show, createMemo, createSignal } from "solid-js"
import { bossShowTimeline } from "@minemods/mod-core/boss-show-timeline"
import { BOSS_SHOW_KINDS } from "@minemods/mod-core/boss-show"
import { bossWords } from "@minemods/mod-core/creature-boss"
import { CreaturePicture, type InsideActions } from "./creature-inside-page"
export function CreatureShows(p: InsideActions) {
  const [selected, setSelected] = createSignal(p.data.shows[0]!)
  const timelines = createMemo(() => bossShowTimeline(p.data.boss!, p.data.names))
  const show = () => timelines().find((s) => s.show === selected())
  const title = (key: string) => (key === "intro" ? "登场" : "死亡")
  return (
    <>
      <h2>演出</h2>
      <button disabled={p.busy} onClick={() => p.edit({ tab: "shows", show: selected() })}>编辑{title(selected())}演出</button>
      <div class="phase-line">
        <For each={p.data.shows}>
          {(key) => (
            <button aria-pressed={key === selected()} onClick={() => setSelected(key)}>
              {title(key)} {p.data.boss![key]!.seconds} 秒
            </button>
          )}
        </For>
      </div>
      <Show
        when={show()}
        keyed
        fallback={
          <p>
            {selected() === "intro"
              ? bossWords.intro(p.data.boss!, p.data.names, p.data.moves)
              : bossWords.death(p.data.boss!, p.data.names)}
          </p>
        }
      >
        {(s) => (
          <>
            <section class="inside-card">
              <h3>{s.name}时间轴</h3>
              <p>0 秒至 {s.seconds} 秒</p>
              <For each={[...new Set(s.steps.map((x) => x.kind))]}>
                {(kind) => (
                  <div class="show-track">
                    <b>{kind === "effect" ? WORDS.effect : BOSS_SHOW_KINDS[kind]}</b>
                    <div>
                      <For each={s.steps.map((x, i) => ({ x, i })).filter((a) => a.x.kind === kind)}>
                        {({ x, i }) => (
                          <button
                            style={{ left: Math.min(96, (100 * x.at) / s.seconds) + "%" }}
                            title={x.at + " 秒 · " + x.words}
                            aria-label={x.at + " 秒 " + x.words}
                            onClick={() =>
                              document.getElementById("show-step-" + i)?.scrollIntoView({ block: "nearest" })
                            }
                          >
                            {x.at}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </section>
            <ol class="show-list">
              <For each={s.steps}>
                {(x, i) => (
                  <li id={"show-step-" + i()}>
                    <strong>
                      第 {x.at} 秒 · {x.kind === "effect" ? WORDS.effect : BOSS_SHOW_KINDS[x.kind]}
                    </strong>
                    <p>{x.words}</p>
                    {x.step.type === "clip" ? (
                      <button
                        onClick={() => {
                          if (x.step.type === "clip") p.play(x.step.clip)
                        }}
                      >
                        播放
                      </button>
                    ) : x.step.type === "sound" ? (
                      <button
                        onClick={() => {
                          if (x.step.type === "sound") void p.listen(x.step.sound)
                        }}
                      >
                        试听
                      </button>
                    ) : ["drop", "glow", "place_structure"].includes(x.kind) ? (
                      <CreaturePicture
                        data={p.data}
                        part="show"
                        value={s.show + "/" + x.at}
                        label="看这一刻"
                        busy={p.busy}
                      />
                    ) : null}
                  </li>
                )}
              </For>
            </ol>
          </>
        )}
      </Show>
    </>
  )
}
