import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import type { JavaInstallPlan, JavaReport } from "../../api"
import type { LibraryTask } from "../../library"
import { advanced } from "../advanced"
import { Button, Icon } from "../ui"
import { SETUP_WORDS, SOURCE_WORDS, installFacts, kindWords, plainError, shortPath } from "./project-setup-model"
import "./project-setup.css"
import { Fold } from "../fold"

// The same pace the resource manager reads its library tasks at.
const INSTALL_POLL_MS = 800
const under = (task: LibraryTask) => task.state === "running" || task.state === "canceling"

// One install for the whole window: the card is on the create page, in the build panel and in 存储空间, and each shows
// the same install, which carries on in the main process whichever page is open.
const [install, setInstall] = createSignal<{ major: number; task: LibraryTask; problem: string } | null>(null)
// Moved on when an install ends, so every card that is open looks again.
const [installEnded, setInstallEnded] = createSignal(0)
function follow(major: number, task: LibraryTask) {
  setInstall({ major, task, problem: "" })
  if (!under(task)) return setInstallEnded((value) => value + 1)
  window.setTimeout(
    () =>
      void window.studio.getLibraryTask({ id: task.id }).then(
        (next) => follow(major, next),
        (cause: unknown) => {
          setInstall({ major, task, problem: plainError(cause, SETUP_WORDS.installFailed, advanced()) })
          setInstallEnded((value) => value + 1)
        },
      ),
    INSTALL_POLL_MS,
  )
}

/**
 * 「运行环境」: every Java found on this computer, the one the next build uses, automatic or one the person picked,
 * and — when none fits — an install that says before it starts what is downloaded, from where, how much, and where it
 * goes. Nothing is downloaded without the press on the confirmation.
 */
export function JavaCard(props: {
  major: number
  /** The build panel's short form: the one in use on top, the list folded. */
  compact?: boolean
  buildProblem?: string
  onReport?: (report: JavaReport) => void
  /** Called when an install this window started has ended, after which the card has looked again. */
  onInstalled?: () => void
  /**
   * A counter the window moves on whenever a job (a build, a check, a test-scene run) has ended. A build may download Studio's own Java on its
   * first run, so the line read when the panel opened ("no suitable Java, it will be downloaded") is out of date the moment the build succeeds.
   */
  after?: number
}) {
  const [report, setReport] = createSignal<JavaReport>()
  const [looking, setLooking] = createSignal(false)
  const [problem, setProblem] = createSignal("")
  const [plan, setPlan] = createSignal<JavaInstallPlan | null>(null)
  const [asking, setAsking] = createSignal(false)
  const ticket = { asked: 0 }
  const shown = (next: JavaReport) => {
    setReport(next)
    props.onReport?.(next)
  }
  const detect = () => {
    const asked = ++ticket.asked
    setLooking(true)
    setProblem("")
    void window.studio
      .detectJava({ major: props.major })
      .then(
        (next) => asked === ticket.asked && shown(next),
        (cause: unknown) => asked === ticket.asked && setProblem(plainError(cause, SETUP_WORDS.javaFailed, advanced())),
      )
      .finally(() => asked === ticket.asked && setLooking(false))
  }
  // By value: looking for Java takes a moment and says 「正在找」 meanwhile, and the same major version read again is no reason to.
  const major = createMemo(() => props.major)
  createEffect(on(major, detect))
  createEffect(on(() => props.after, detect, { defer: true }))
  createEffect(
    on(
      installEnded,
      () => {
        detect()
        props.onInstalled?.()
      },
      { defer: true },
    ),
  )
  // A press that asks the main process something; one at a time, its failure said in the card.
  const act = (operation: () => Promise<unknown>, fallback: string = SETUP_WORDS.actionFailed) => {
    if (asking()) return
    setAsking(true)
    setProblem("")
    void operation()
      .catch((cause: unknown) => setProblem(plainError(cause, fallback, advanced())))
      .finally(() => setAsking(false))
  }
  const choose = (home: string | null) => act(async () => shown(await window.studio.chooseJava({ home, major: props.major })))
  const askInstall = () => act(async () => setPlan(await window.studio.planJavaInstall({ major: props.major })), SETUP_WORDS.planFailed)
  const moveTo = () =>
    act(async () => {
      const next = await window.studio.chooseJavaDirectory({ major: props.major })
      if (next) setPlan(next)
    }, SETUP_WORDS.planFailed)
  const backHome = (home: string) => act(async () => setPlan(await window.studio.planJavaInstall({ major: props.major, directory: home })), SETUP_WORDS.planFailed)
  const start = (chosen: JavaInstallPlan) =>
    act(async () => {
      // The default place is sent as "default", so a later change of the default moves with it.
      const task = await window.studio.installJava({ major: props.major, directory: chosen.directory === chosen.defaultDirectory ? null : chosen.directory })
      setPlan(null)
      follow(props.major, task)
    })
  const mine = () => (install()?.major === props.major ? install() : null)
  const installing = () => !!mine() && under(mine()!.task)
  // The task's own failure is a sentence of the main process; one that is not in words a person reads stays under 高级.
  const installLine = () => {
    const value = mine()
    if (!value) return ""
    return value.problem || (value.task.error ? plainError(value.task.error, "", advanced()) : value.task.detail)
  }
  const using = () => props.buildProblem ? null : report()?.using ?? null
  const row = (found: JavaReport["found"][number]) => (
    <li class={`java-row ${using()?.home === found.home ? "using" : ""} ${found.fits ? "" : "unfit"}`}>
      <div class="java-row-head">
        <strong>Java {found.version}</strong>
        <span>{found.vendor}</span>
        <Show when={using()?.home === found.home}>
          <span class="java-badge">{SETUP_WORDS.using}</span>
        </Show>
      </div>
      <span class="java-where" title={found.home}>
        {SOURCE_WORDS[found.source]} · {shortPath(found.home)}
      </span>
      <span class="java-kind">
        {kindWords(found.jdk, advanced())}
        {advanced() ? ` · ${found.arch}` : ""}
      </span>
      <span class={found.fits && !props.buildProblem ? "java-fits" : "java-why"}>{found.fits ? (props.buildProblem ? "可选择" : `✓ ${SETUP_WORDS.fits}`) : found.why}</span>
      <Show when={found.fits && using()?.home !== found.home}>
        <Button disabled={asking()} onClick={() => choose(found.home)}>
          {SETUP_WORDS.useThis}
        </Button>
      </Show>
    </li>
  )
  return (
    <section class={`setup-card java-card ${props.compact ? "compact" : ""}`} aria-label={SETUP_WORDS.java}>
      <header class="setup-card-head">
        <h3>
          {SETUP_WORDS.java} · Java {props.major}
        </h3>
        <Button disabled={looking() || asking()} onClick={detect}>
          <Icon name="undo" />
          {looking() ? SETUP_WORDS.detecting : SETUP_WORDS.redetect}
        </Button>
      </header>
      <Show when={props.buildProblem}><p class="java-why" role="alert">{props.buildProblem}</p></Show>
      <Show when={report()}>
        {(value) => (
          <>
            <div class="java-mode">
              <span>{value().mode === "auto" ? SETUP_WORDS.auto : SETUP_WORDS.chosen}</span>
              <Show when={value().mode === "chosen"}>
                <Button disabled={asking()} onClick={() => choose(null)}>
                  {SETUP_WORDS.backToAuto}
                </Button>
              </Show>
            </div>
            <Show
              when={props.compact}
              fallback={
                <ul class="java-rows">
                  <For each={value().found}>{row}</For>
                </ul>
              }
            >
              <Show when={using()} keyed>
                {(found) => <ul class="java-rows">{row(found)}</ul>}
              </Show>
              <Show when={value().found.length}>
                <Fold class="java-all" summary={SETUP_WORDS.foundAll(value().found.length)}>
                  <ul class="java-rows">
                    <For each={value().found}>{row}</For>
                  </ul>
                </Fold>
              </Show>
            </Show>
            <Show when={!value().using && !installing()}>
              <div class="java-none">
                <p>{SETUP_WORDS.javaNone}</p>
                <Show when={!plan()}>
                  <Button primary disabled={asking()} onClick={askInstall}>
                    <Icon name="download" />
                    {SETUP_WORDS.installNow}
                  </Button>
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>
      <Show when={plan()}>
        {(chosen) => {
          const facts = () => installFacts(chosen())
          return (
            <div class="java-confirm mc-well" role="group" aria-label="安装 Java 之前">
              <dl>
                <dt>要装的</dt>
                <dd>{facts().what}</dd>
                <dt>从哪里下</dt>
                <dd title={advanced() ? chosen().url : undefined}>{facts().from}</dd>
                <dt>流量</dt>
                <dd>{facts().traffic}</dd>
                <dt>硬盘</dt>
                <dd>{facts().disk}</dd>
                <dt>装到哪</dt>
                <dd>
                  <span class="java-path">{facts().where}</span>
                  <span class="java-confirm-row">
                    <Button disabled={asking()} onClick={moveTo}>
                      <Icon name="folder" />
                      {SETUP_WORDS.moveTo}
                    </Button>
                    <Show when={facts().moved}>
                      <Button disabled={asking()} onClick={() => backHome(chosen().defaultDirectory)}>
                        {SETUP_WORDS.defaultPlace}
                      </Button>
                    </Show>
                  </span>
                </dd>
                <dt>剩余空间</dt>
                <dd>{facts().free}</dd>
              </dl>
              <Show when={facts().problem}>
                <p class="java-problem" role="alert">
                  {facts().problem}
                </p>
              </Show>
              <div class="java-confirm-row">
                <Button primary disabled={facts().blocked || asking() || installing()} onClick={() => start(chosen())}>
                  <Icon name="download" />
                  {SETUP_WORDS.install}
                </Button>
                <Button onClick={() => setPlan(null)}>{SETUP_WORDS.notNow}</Button>
              </div>
            </div>
          )
        }}
      </Show>
      <Show when={mine()}>
        {(value) => (
          <div class={`java-install ${value().task.state}`} role="status">
            <strong>
              {under(value().task)
                ? SETUP_WORDS.installing
                : value().task.state === "completed" && !value().problem
                  ? SETUP_WORDS.installed
                  : SETUP_WORDS.installFailed}
            </strong>
            <Show when={installLine()}>
              <p>{installLine()}</p>
            </Show>
            <Show when={!under(value().task)}>
              <button type="button" class="java-install-close" aria-label="收起这一条" onClick={() => setInstall(null)}>
                <Icon name="close" />
              </button>
            </Show>
          </div>
        )}
      </Show>
      <Show when={problem()}>
        <p class="java-problem" role="alert">
          {problem()}
        </p>
      </Show>
    </section>
  )
}
