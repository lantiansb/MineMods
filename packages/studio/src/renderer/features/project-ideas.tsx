import { createEffect, createSignal, For, on, Show } from "solid-js"
import type { IdeaChoice, Ideas, ProjectOverview } from "../../api"
import { Button, Icon } from "../ui"
import { ideaPlay } from "@minemods/mod-core/playable"
import { earlierWords } from "@minemods/mod-core/blueprint-constraints"
import { PlayAnswers } from "./project-playable"
import "./project-ideas.css"

type Group = Ideas["groups"][number]
type Choice = Omit<IdeaChoice, "revision">
type Requirement = { id: string; text: string; origin: "said" | "added"; replaces?: string }
type Lifted = { constraint: string; change: string }

// A closed padlock and an open one, in the pixel style of the status marks.
const LOCKED = ["0011100", "0100010", "0100010", "1111111", "1110111", "1110111", "1111111"]
const OPEN = ["0011100", "0100010", "0000010", "1111111", "1110111", "1110111", "1111111"]
const pixels = (rows: string[]) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "1" ? [`M${x} ${y}h1v1h-1z`] : []))).join("")
const Lock = (props: { open?: boolean }) => (
  <svg class="pi-lock" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
    <path fill="currentColor" d={pixels(props.open ? OPEN : LOCKED)} />
  </svg>
)

/**
 * 「你说的要求」: what the person said must hold, word for word, each with a padlock. One they gave up is
 * struck through with what they agreed to instead. With `onChange` the person can change their mind without starting over: reword a
 * requirement, give it up or take it back, or add one. These are theirs alone; the lock only ever guards against an AI. A requirement
 * they reworded shows what it said before, under the new words. Without `onChange` the list is only read.
 */
export function Requirements(props: {
  constraints: Requirement[]
  lifted: Lifted[]
  busy?: boolean
  /** How the plan keeps each requirement: the entry's name (null for the plan as a whole) and what it says. */
  honours?: { constraint: string; title: string | null; how: string }[]
  /** Who compared the plan with the requirements, in one plain sentence. */
  checked?: string
  /** Studio's own AI is comparing the plan with the changed list right now. */
  comparing?: boolean
  /** Bring the person to one requirement (null: the list as a whole) and open it for rewording. A new `nonce` brings them again. */
  focus?: { id: string | null; nonce: number } | null
  onChange?: (change: Choice) => void
}) {
  const [adding, setAdding] = createSignal("")
  const [editing, setEditing] = createSignal<string | null>(null)
  const [words, setWords] = createSignal("")
  let section: HTMLElement | undefined
  const lifted = (id: string) => props.lifted.find((value) => value.constraint === id)
  // A line the person reworded is shown once, as the new line with its history under it, not twice.
  const shown = () => props.constraints.filter((constraint) => !(lifted(constraint.id) && props.constraints.some((value) => value.replaces === constraint.id)))
  const add = () => {
    if (!adding().trim()) return
    props.onChange?.({ add: adding().trim() })
    setAdding("")
  }
  const open = (constraint: Requirement) => {
    setWords(constraint.text)
    setEditing(constraint.id)
    queueMicrotask(() => section?.querySelector<HTMLTextAreaElement>(`[data-constraint="${constraint.id}"] textarea`)?.focus())
  }
  const save = (constraint: Requirement) => {
    const text = words().trim()
    if (!text || text === constraint.text) return setEditing(null)
    props.onChange?.({ reword: [{ id: constraint.id, text }] })
    setEditing(null)
  }
  createEffect(
    on(
      () => props.focus?.nonce,
      () => {
        const target = props.focus
        if (!target) return
        // The line may have been reworded since: what the person wants is its current form.
        const current = shown().find((value) => value.id === target.id) ?? shown().find((value) => value.replaces === target.id)
        queueMicrotask(() => {
          const card = current ? section?.querySelector<HTMLElement>(`[data-constraint="${current.id}"]`) : null
          ;(card ?? section)?.scrollIntoView?.({ block: "nearest" })
          if (current && props.onChange && !lifted(current.id)) open(current)
        })
      },
      { defer: true },
    ),
  )
  return (
    <section class="pi-required" aria-label="你说的要求" ref={section}>
      <h3>
        <Lock />
        你说的要求
        <small>{props.constraints.length - props.lifted.filter((value) => props.constraints.some((constraint) => constraint.id === value.constraint)).length} 条锁着</small>
      </h3>
      <Show when={props.constraints.length} fallback={<p class="pa-hint">你的话里没有「只能」「不要」这样的硬要求。想加一条，写在下面。</p>}>
        <p class="pa-hint">这些是你的原话，一个字没改。AI 出的做法和蓝图都不能违反，AI 也不能替你改；想改字、想放开哪一条，只有你自己能点。</p>
        <ul>
          <For each={shown()}>
            {(constraint) => (
              <li data-constraint={constraint.id} classList={{ lifted: !!lifted(constraint.id), editing: editing() === constraint.id }}>
                <Lock open={!!lifted(constraint.id)} />
                <span class="pi-required-text">
                  <Show
                    when={editing() === constraint.id}
                    fallback={
                      <>
                        <q>{constraint.text}</q>
                        <Show when={constraint.replaces}>
                          <em>你改过的说法</em>
                        </Show>
                        <Show when={constraint.origin === "added" && !constraint.replaces}>
                          <em>你后来加的</em>
                        </Show>
                        <For each={earlierWords(props.constraints, constraint.id)}>
                          {(before, index) => (
                            <small class="pi-earlier">
                              {index() === 0 ? "你改之前说的是：" : "更早说的是："}
                              <q>{before}</q>
                            </small>
                          )}
                        </For>
                      </>
                    }
                  >
                    <textarea
                      class="pa-input"
                      aria-label="把这条要求改成"
                      rows={2}
                      maxLength={300}
                      value={words()}
                      disabled={props.busy}
                      onInput={(event) => setWords(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditing(null)
                        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                          event.preventDefault()
                          save(constraint)
                        }
                      }}
                    />
                    <small class="pi-edit-note">改好以后，AI 做的蓝图要按新的说法来；原来的话会留着，写在下面。</small>
                  </Show>
                  <Show when={lifted(constraint.id)}>
                    {(value) => <small>你同意放开了{value().change ? `，改成：${value().change}` : ""}</small>}
                  </Show>
                  <For each={lifted(constraint.id) ? [] : (props.honours ?? []).filter((value) => value.constraint === constraint.id)}>
                    {(value) => (
                      <small class="pi-honour">
                        {value.title ? `「${value.title}」` : "整份蓝图"}：{value.how}
                      </small>
                    )}
                  </For>
                  {/* In a plan's view only: a requirement the plan has not answered yet (the person added or reworded it after the plan was drawn). */}
                  <Show when={props.honours && !lifted(constraint.id) && !props.honours.some((value) => value.constraint === constraint.id)}>
                    <small class="pi-unanswered">蓝图里还没写怎么做到这一条。</small>
                  </Show>
                </span>
                <Show when={props.onChange}>
                  <span class="pi-actions">
                    <Show
                      when={editing() === constraint.id}
                      fallback={
                        <>
                          <Show when={!lifted(constraint.id)}>
                            <button type="button" class="pa-link" disabled={props.busy} onClick={() => open(constraint)}>
                              改字
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="pa-link"
                            disabled={props.busy}
                            onClick={() => props.onChange?.(lifted(constraint.id) ? { restore: [constraint.id] } : { lift: [constraint.id] })}
                          >
                            {lifted(constraint.id) ? "还是要这条" : "这条不要了"}
                          </button>
                        </>
                      }
                    >
                      <Button primary disabled={props.busy || !words().trim()} onClick={() => save(constraint)}>
                        就改成这样
                      </Button>
                      <button type="button" class="pa-link" onClick={() => setEditing(null)}>
                        算了
                      </button>
                    </Show>
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.comparing}>
        <p class="pi-checked" role="status">
          正在请审查员照你改过的要求，把蓝图重新审查一遍……
        </p>
      </Show>
      <Show when={props.checked && !props.comparing}>
        <p class="pi-checked">{props.checked}</p>
      </Show>
      <Show when={props.onChange}>
        <div class="pi-add">
          <input
            class="pa-input"
            aria-label="再加一条要求"
            maxLength={300}
            placeholder="再加一条要求，比如：守卫不能飞"
            value={adding()}
            disabled={props.busy}
            onInput={(event) => setAdding(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && !event.isComposing && add()}
          />
          <Button disabled={props.busy || !adding().trim()} onClick={add}>
            加上
          </Button>
        </div>
      </Show>
    </section>
  )
}

/**
 * A plan an AI handed in and Studio turned back. A refused plan is not stored, so this stands where the plan should be: who handed it in, why it was
 * turned back in the words of the refusal itself, and what the person can do about it. When the reason is one of their own requirements the
 * button leads to that very card, open for rewording; nothing here changes anything by itself.
 */
export function RefusedPlan(props: {
  refusal: NonNullable<ProjectOverview["plan_refusal"]>
  /** A plan is stored: what the person is looking at is the one before. */
  standing: boolean
  /** An outside AI draws the plans: handing in again is done in its window. */
  external: boolean
  advanced: boolean
  /** Bring the person to a requirement (null: the whole list), open for rewording. */
  onToRequirement: (id: string | null) => void
}) {
  const refusal = () => props.refusal
  const who = () => (refusal().by === "studio" ? "Studio 的 AI" : "你的 AI")
  const given = () => (refusal().constraint ? !!refusal().constraint!.lifted : false)
  return (
    <section class="pi-refused" role="alert" aria-label="蓝图被退回了" data-about={refusal().about}>
      <h3>
        <Lock />
        {who()}交上来的蓝图被退回了
      </h3>
      <p class="pa-hint">
        {props.standing ? "这一版没有保存，你现在看到的还是上一版。" : "这一版没有保存，所以这里还没有蓝图。"}
        <Show when={refusal().titles.length}>
          它打算做：{refusal().titles.slice(0, 5).join("、")}
          {refusal().titles.length > 5 ? `等 ${refusal().titles.length} 样` : ""}。
        </Show>
      </p>
      <div class="pi-refused-why">
        <strong>退回的原因</strong>
        <For each={refusal().why.split("\n").filter(Boolean)}>{(line) => <p>{line}</p>}</For>
      </div>
      <div class="pi-refused-next">
        <strong>你可以这样做</strong>
        <Show when={refusal().settled}>
          <p>退回以后你改过要求了，上面的原因现在可能已经不对。{props.external ? "回到你的 AI 窗口说一句「继续」，让它照现在的要求再交一次。" : "让 AI 照现在的要求再出一次蓝图就知道了。"}</p>
        </Show>
        <Show when={refusal().about === "requirement"}>
          <Show
            when={refusal().constraint}
            fallback={
              <>
                <p>这是蓝图有没有违反你的要求的审查没做完整。你的要求没有被动过，让 AI 重新交一次就行；也可以先看看你说的要求。</p>
                <Button onClick={() => props.onToRequirement(null)}>去看你说的要求</Button>
              </>
            }
          >
            {(constraint) => (
              <Show
                when={constraint().recorded}
                fallback={
                  <p>
                    这一条是从你的话里找出来的：<q>{constraint().text}</q>。它还没有记进「你说的要求」，所以这里没有地方改它。如果你不是这个意思，把上面那句话改一改再发给 AI 就行。
                  </p>
                }
              >
                <p>
                  这一条是你亲口说的：<q>{constraint().text}</q>。AI 不能替你改，只有你能。想照它原来的意思做，就让 AI 照原话重新出一份；想换个说法或者不要它，在「你说的要求」里这一条上直接改。
                </p>
                <Show when={!given()}>
                  <Button primary onClick={() => props.onToRequirement(constraint().id)}>
                    去改这一条要求
                  </Button>
                </Show>
                <Show when={given()}>
                  <p class="pa-hint">你已经不要这一条了。{props.external ? "回到你的 AI 窗口说一句「继续」。" : "让 AI 重新出蓝图就不会再受它限制。"}</p>
                </Show>
              </Show>
            )}
          </Show>
        </Show>
        <Show when={refusal().about === "playable"}>
          <p>这不是你的要求的问题，是蓝图里有些东西没交代清楚怎么玩。让 AI 补上再交一次；你的要求没有被动过。</p>
        </Show>
        <Show when={refusal().about === "rule"}>
          <p>这不是你的要求的问题，是 AI 交上来的蓝图本身（写法、引用，或者它交蓝图的方式）没过 Studio 的检查。让 AI 照上面的原因改好再交一次；你的要求没有被动过。</p>
        </Show>
        <p class="pa-hint">AI 每次交蓝图、被退回的原因，也都记在「动态」里。</p>
      </div>
      <Show when={props.advanced}>
        <code class="pi-tech">
          {refusal().by === "studio" ? "Studio 自己的 AI" : "外部 AI"} · {refusal().about} · {refusal().at}
        </code>
      </Show>
    </section>
  )
}

/**
 * Idea cards: the groups an AI drew from the person's sentence, two or three concrete ways each. The person
 * picks one per group (or none, or writes their own), answers any question about a requirement of theirs,
 * reads the summary and may rewrite it, and says go. Nothing here chooses for them.
 */
export function IdeaChooser(props: {
  ideas: Ideas
  advanced: boolean
  busy: boolean
  /** An AI app outside Studio draws the plan: saying go copies a sentence for it. */
  external: boolean
  /** Why "go" cannot work right now (no AI connected); empty when it can. */
  blocked: string
  /** Said after go, when there is something to tell (the sentence for an outside AI was copied). */
  notice?: string
  onChoose: (change: Choice) => Promise<Ideas | null>
  /** The person said go and the choice is stored as final. */
  onGo: (ideas: Ideas) => void
  /** Straight to a plan from the sentence, without the cards. */
  onSkip: () => void
  /** Put the cards away. */
  onDiscard: () => void
}) {
  const [step, setStep] = createSignal<"pick" | "summary">(props.ideas.state === "ready" ? "summary" : "pick")
  const [writing, setWriting] = createSignal<string | null>(null)
  const [own, setOwn] = createSignal("")
  const [summary, setSummary] = createSignal(props.ideas.summary ?? "")
  const [edited, setEdited] = createSignal(false)

  const pickOf = (group: Group) => props.ideas.picks.find((value) => value.group === group.id)
  const play = () => ideaPlay(props.ideas)
  const picked = () => props.ideas.groups.filter((group) => pickOf(group)).length
  const unanswered = () => props.ideas.questions.filter((question) => !props.ideas.answers.some((value) => value.question === question.id))
  const answer = (id: string) => props.ideas.answers.find((value) => value.question === id)
  const constraint = (id: string) => props.ideas.constraints.find((value) => value.id === id)
  const left = () => props.ideas.groups.length - picked()
  const missing = () => [...(left() ? [`还有 ${left()} 组没选`] : []), ...(unanswered().length ? [`有 ${unanswered().length} 个问题等你决定`] : [])].join("，")
  // The summary on screen follows the choices until the person types in it.
  createEffect(
    on(
      () => props.ideas.summary,
      (text) => !edited() && setSummary(text ?? ""),
    ),
  )
  const pick = (group: Group, option: string | null, words = "") => {
    setWriting(null)
    // The summary is written again from the choices, so an edit of the old one no longer stands.
    setEdited(false)
    void props.onChoose({ picks: [...props.ideas.picks.filter((value) => value.group !== group.id), { group: group.id, option, own: words.trim() }] })
  }
  const write = (group: Group) => {
    setOwn(pickOf(group)?.own ?? "")
    setWriting(group.id)
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>(".pi-own textarea")?.focus())
  }
  const go = async () => {
    const stored = await props.onChoose({ ...(edited() ? { summary: summary() } : {}), ready: true })
    if (stored?.state === "ready") props.onGo(stored)
  }
  // Written again from the choices: the person's own wording of the summary is given up.
  const rewrite = () => {
    setEdited(false)
    void props.onChoose({ picks: props.ideas.picks })
  }

  return (
    <div class="pi-chooser" data-step={step()}>
      <aside class="pi-side mc-window">
        <div class="pi-side-scroll">
          <section>
            <h3>你说的</h3>
            <p class="pa-quote mc-well">{props.ideas.request}</p>
          </section>
          <Requirements constraints={props.ideas.constraints} lifted={props.ideas.lifted} busy={props.busy} onChange={(change) => void props.onChoose(change)} />
          {/* The playable standard on the cards as they stand: every thing and its answers, following each pick. */}
          <Show when={props.ideas.things?.length}>
            <section class="pi-play" aria-label="每样东西怎么玩">
              <h3>
                每样东西怎么玩
                <small>{play().gaps.length ? `${play().gaps.length} 个问题还没有答案` : "都有交代"}</small>
              </h3>
              <p class="pa-hint">能玩的模组，每样东西都要答得上这几个问题。没选的组先按推荐的做法算，你一选这里就跟着变；空着的，出蓝图时 AI 会补上并标出来。</p>
              <PlayAnswers report={play()} side />
            </section>
          </Show>
          <Show when={props.advanced}>
            <code class="pi-tech">
              想法第 {props.ideas.revision} 版 · {props.ideas.by === "studio" ? "Studio 自己的 AI" : "外部 AI"} · {props.ideas.state}
            </code>
          </Show>
        </div>
      </aside>

      <div class="pi-main mc-window">
        <header class="pi-top">
          <div>
            <strong>{step() === "pick" ? "AI 替你想了这些，挑一挑" : "看看总结，想改就直接改"}</strong>
            <span>
              {step() === "pick"
                ? `每一组选一个做法。带「AI 补的」的是你没说、AI 替你补上的；${props.ideas.by === "outside" ? "这些是你的 AI 出的，" : ""}不喜欢可以都不要，或者自己写。`
                : "AI 会照这段话出蓝图。左边锁着的要求会原样带过去。"}
            </span>
          </div>
          <ol class="pi-steps" aria-label="进度">
            <li aria-current={step() === "pick" ? "step" : undefined} classList={{ done: step() === "summary" }}>
              1 挑做法
            </li>
            <li aria-current={step() === "summary" ? "step" : undefined}>2 看总结</li>
            <li>3 出蓝图</li>
          </ol>
        </header>

        <div class="pi-scroll">
          <For each={props.ideas.questions}>
            {(question) => (
              <section class="pi-question" data-question={question.id} data-answered={answer(question.id) ? (answer(question.id)!.yes ? "yes" : "no") : "none"} role="group" aria-label="要你亲自决定">
                <header>
                  <Lock open={answer(question.id)?.yes} />
                  <strong>这一条要你亲自决定</strong>
                  <em>AI 不能替你改</em>
                </header>
                <p class="pi-ask">{question.ask}</p>
                <dl>
                  <dt>你原来说的</dt>
                  <dd>
                    <q>{constraint(question.constraint)?.text}</q>
                  </dd>
                  <dt>同意的话会改成</dt>
                  <dd>{question.change}</dd>
                </dl>
                <div class="pi-answers">
                  <button type="button" class="pi-answer" aria-pressed={answer(question.id)?.yes === false} disabled={props.busy} onClick={() => void props.onChoose({ answers: { [question.id]: false } })}>
                    <Lock />
                    不改，照我说的
                  </button>
                  <button type="button" class="pi-answer yes" aria-pressed={answer(question.id)?.yes === true} disabled={props.busy} onClick={() => void props.onChoose({ answers: { [question.id]: true } })}>
                    <Lock open />
                    同意，改掉这条
                  </button>
                  <Show when={!answer(question.id)}>
                    <span class="pa-hint warn">还没决定</span>
                  </Show>
                </div>
              </section>
            )}
          </For>

          <Show
            when={step() === "pick"}
            fallback={
              <section class="pi-summary">
                <textarea
                  class="pa-input"
                  aria-label="做法总结"
                  maxLength={6000}
                  value={summary()}
                  disabled={props.busy}
                  onInput={(event) => {
                    setEdited(true)
                    setSummary(event.currentTarget.value)
                  }}
                />
                <p class="pa-hint">
                  {edited() ? "你改过这段话了，会照你改的来。" : "这段话是按你选的做法一条一条写出来的，没有经过 AI 改写。"}
                  <Show when={edited()}>
                    <button type="button" class="pa-link" disabled={props.busy} onClick={rewrite}>
                      按我选的重新写一遍
                    </button>
                  </Show>
                </p>
              </section>
            }
          >
            <For each={props.ideas.groups}>
              {(group) => (
                <section class="pi-group" data-group={group.id} classList={{ chosen: !!pickOf(group) }} role="radiogroup" aria-label={group.title}>
                  <header>
                    <strong>{group.title}</strong>
                    <span>{group.about}</span>
                  </header>
                  <div class="pi-options">
                    <For each={group.options}>
                      {(option) => (
                        <button
                          type="button"
                          role="radio"
                          class="pi-option"
                          data-option={option.id}
                          aria-checked={pickOf(group)?.option === option.id}
                          classList={{ limited: !!option.limit }}
                          disabled={props.busy}
                          onClick={() => pick(group, option.id)}
                        >
                          <span class="pi-option-head">
                            <strong>{option.title}</strong>
                            <Show when={option.recommended}>
                              <em class="pi-best">推荐</em>
                            </Show>
                          </span>
                          <span class="pi-lines">
                            <For each={option.lines}>
                              {(line) => (
                                <span data-from={line.from}>
                                  <i>{line.from === "ai" ? "AI 补的" : "你说的"}</i>
                                  {line.text}
                                </span>
                              )}
                            </For>
                          </span>
                          <Show when={option.limit}>
                            {(limit) => (
                              <span class="pi-limit">
                                <b>这一点现在做不了</b>
                                {limit().cannot}。会用这个代替：{limit().instead}
                              </span>
                            )}
                          </Show>
                          <Show when={props.advanced && option.kinds.length}>
                            <code>{option.kinds.join(" · ")}</code>
                          </Show>
                        </button>
                      )}
                    </For>
                    <div class="pi-else">
                      <button type="button" role="radio" class="pi-none" aria-checked={!!pickOf(group) && pickOf(group)!.option === null && !pickOf(group)!.own} disabled={props.busy} onClick={() => pick(group, null)}>
                        都不要
                      </button>
                      <button type="button" role="radio" class="pi-none" aria-checked={!!pickOf(group)?.own} disabled={props.busy} onClick={() => write(group)}>
                        我自己写
                      </button>
                    </div>
                  </div>
                  <Show when={writing() === group.id}>
                    <div class="pi-own">
                      <textarea class="pa-input" aria-label={`自己写${group.title}`} rows={2} maxLength={300} placeholder="用自己的话写这一项想怎么做" value={own()} onInput={(event) => setOwn(event.currentTarget.value)} />
                      <Button primary disabled={props.busy || !own().trim()} onClick={() => pick(group, null, own())}>
                        就写这个
                      </Button>
                      <Button onClick={() => setWriting(null)}>算了</Button>
                    </div>
                  </Show>
                  <Show when={writing() !== group.id && pickOf(group)?.own}>
                    <p class="pi-wrote">
                      <i>你写的</i>
                      {pickOf(group)!.own}
                    </p>
                  </Show>
                </section>
              )}
            </For>
          </Show>
        </div>

        <Show when={props.notice}>
          <p class="pa-copied" role="status">
            <Icon name="check" />
            <span>{props.notice}</span>
          </p>
        </Show>
        <footer class="pi-foot">
          <span class="pi-count" role="status">
            {step() === "pick" ? `已选 ${picked()} / ${props.ideas.groups.length} 组` : missing() || "都选好了"}
            <Show when={step() === "pick" && unanswered().length}>
              {/* The question lies at the top of the list and may have scrolled away. */}
              <button type="button" class="pa-link pi-to-question" onClick={() => document.querySelector(".pi-question[data-answered=none]")?.scrollIntoView({ block: "nearest" })}>
                有 {unanswered().length} 个问题等你决定
              </button>
            </Show>
          </span>
          <Show when={props.blocked && step() === "summary"}>
            <span class="pa-hint warn">{props.blocked}</span>
          </Show>
          <button type="button" class="pa-link" disabled={props.busy} onClick={props.onDiscard}>
            先不选了
          </button>
          <Button disabled={props.busy} onClick={props.onSkip}>
            让 AI 做
          </Button>
          <Show
            when={step() === "pick"}
            fallback={
              <>
                <Button disabled={props.busy} onClick={() => setStep("pick")}>
                  <Icon name="undo" />
                  回去重选
                </Button>
                <Button primary class="pi-go" disabled={props.busy || !!missing() || !!props.blocked || !summary().trim()} onClick={() => void go()}>
                  <Icon name={props.external ? "copy" : "check"} />
                  {props.external ? "就按这个做，复制给我的 AI" : "就按这个做"}
                </Button>
              </>
            }
          >
            <Button primary class="pi-go" disabled={props.busy || !picked()} onClick={() => setStep("summary")}>
              看看总结
              <Icon name="arrow" />
            </Button>
          </Show>
        </footer>
      </div>
    </div>
  )
}
