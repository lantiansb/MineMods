import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { SCENE_EXTRA, SCENE_WORDS } from "@minemods/mod-core/scene"
import { plainFix } from "@minemods/mod-core/play-words"
import type { FindingTarget } from "@minemods/mod-core/reconcile"
import type { FixFindingsResult, ModGuideView, StudioApi } from "../../api"
import { FIX_WORDS } from "../../fix-findings"
import { Button, Icon } from "../ui"
import { advanced } from "../advanced"
import { CHAIN_WORDS } from "../play-chain"
import { PreinstalledMods } from "./preinstalled-mods"
import { FindingGo } from "./finding-go"
import { SETUP_WORDS } from "./project-setup-model"
import "./test-scene.css"

/** What the main process says about a project's test scene. */
export type SceneInfo = Awaited<ReturnType<StudioApi["getScene"]>>

/**
 * The game's licence, asked before 「构建并试玩」 runs its check. Ticking it is the person's own act and nothing
 * else ever does it; left unticked, 「构建并试玩」 stops and asks (`CHAIN_WORDS.stop.eula`) before it opens the game on its main menu.
 */
export function SceneEula(props: { onAgree: () => void }) {
  return (
    <label class="test-scene-eula">
      <input
        type="checkbox"
        aria-label="同意 Minecraft 最终用户许可协议"
        onChange={(event) => event.currentTarget.checked && props.onAgree()}
      />
      <span>
        我看过并同意 Minecraft 最终用户许可协议（aka.ms/MinecraftEULA）。{CHAIN_WORDS.eula}。只问这一次。
      </span>
    </label>
  )
}

/**
 * 「测试场」 in the build panel (10-07): the built mod in a game of its own with only what it needs. 「构建并试玩」
 * runs the check and opens it by itself; here is what it is, what the last check found in the game's own answers
 * put into plain words, and — under 高级 — each of the two steps to press alone.
 */
export function TestScene(props: {
  scene: SceneInfo | null
  /** The finished build this scene is for; null until there is one. */
  buildJobId: string | null
  projectId: string
  /** The project's game target: what the mods to pre-install are searched for. */
  targetId: string
  revision: number
  /** Something else is running. */
  busy: boolean
  start: (action: () => Promise<{ jobId: string }>) => void
  /** A finding's button: open the field it names (the app closes this panel and takes the person there). */
  onGo?: (target: FindingTarget) => void
}) {
  const ready = () => !!props.buildJobId && !props.busy
  const job = () => ({ projectId: props.projectId, jobId: props.buildJobId! })
  // A check of an earlier build says nothing about this one.
  const report = () => (props.scene?.record?.report ? props.scene : null)
  const [guide, setGuide] = createSignal<ModGuideView | null>(null)
  // By value, here and below: they are read off a view and a check read anew, and neither says anything new each time it is read.
  const guideOf = createMemo(() => `${props.projectId}:${props.revision}`)
  createEffect(
    on(
      guideOf,
      () => {
        const projectId = props.projectId
        let current = true
        setGuide(null)
        onCleanup(() => {
          current = false
        })
        void window.studio.getModGuide({ projectId }).then(
          (value) => {
            if (current) setGuide(value)
          },
          () => undefined,
        )
      },
    ),
  )
  const findings = () => (guide()?.revision === props.revision ? guide()!.findings : [])
  // The one thing this panel does by itself: hand what the check found to the AI and say what became of it.
  const [fixing, setFixing] = createSignal(false)
  const [fixed, setFixed] = createSignal<FixFindingsResult | null>(null)
  const [refused, setRefused] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  // Another check, or another project: what was handed over before is no longer about what is shown.
  const checkOf = createMemo(() => `${props.projectId}:${props.scene?.record?.checked_at}`)
  createEffect(
    on(
      checkOf,
      () => (setFixed(null), setRefused(""), setCopied(false)),
      { defer: true },
    ),
  )
  const fix = () => {
    if (fixing()) return
    setFixing(true)
    setRefused("")
    void window.studio
      .fixFindings({ projectId: props.projectId })
      .then(setFixed, (cause: unknown) =>
        setRefused(
          cause instanceof Error && /[一-鿿]/.test(cause.message) ? cause.message : "没能交给 AI，请再试一次。",
        ),
      )
      .finally(() => setFixing(false))
  }
  return (
    <section class="build-step test-scene">
      <h3>{SCENE_WORDS.name}</h3>
      <p class="build-note">
        一个只装了这个模组、它必须的前置和你加的预装模组、没有任何别的内容的游戏：平坦的空世界里，方块、物品和生物在面前横着摆成一排（物品浮在空中，最多 8 件，全部也放在后面的箱子里），每样头上都浮着它的名字。不用启动器，也不登录账号。
      </p>
      <Show when={props.scene?.record?.missing.length}>
        <p class="test-scene-missing">{SCENE_WORDS.missing(props.scene!.record!.missing)}</p>
      </Show>
      <Show when={report()}>
        <div
          class={`test-scene-report ${report()!.record!.report!.findings.length || (report()!.current && findings().length) ? "found" : "clean"}`}
        >
          <strong>
            上一次后台检查
            {report()!.record!.report!.findings.length
              ? `发现 ${report()!.record!.report!.findings.length} 处`
              : "没有发现问题"}
          </strong>
          {/* The project was changed after this check: what it says is about the mod as it was then. */}
          <Show when={!report()!.current}>
            <p class="test-scene-stale">
              这是工程改动之前那一次的结果。现在这一版还没有检查过，重新打包并检查以后这里会换成新的。
            </p>
          </Show>
          <ul>
            <For each={report()!.lines}>{(line) => <li>{line}</li>}</For>
          </ul>
          <Show when={report()!.current && findings().length}>
            <p>工程规则检查另有 {findings().length} 处提醒（不是游戏检查的结果）：</p>
            <ul>
              <For each={findings()}>
                {(finding) => (
                  <li>
                    {advanced() ? finding.text : plainFix(finding.text)} {advanced() ? finding.fix : plainFix(finding.fix)}
                    <FindingGo finding={finding} onGo={props.onGo} />
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={report()!.current && (report()!.record!.report!.findings.length || findings().length)}>
            <div class="test-scene-fix">
              <Show when={!fixed()}>
                <Button primary disabled={fixing() || props.busy} onClick={fix}>
                  <Icon name="tool" />
                  {fixing() ? "正在交给 AI…" : FIX_WORDS.button}
                </Button>
              </Show>
              <Show when={refused()}>
                <p class="test-scene-missing">{refused()}</p>
              </Show>
              <Show when={fixed()}>
                {(result) => (
                  <div class="test-scene-fixed" role="status">
                    <Show when={result().nothing}>
                      <p>{FIX_WORDS.nothing}</p>
                    </Show>
                    <Show when={result().started.length}>
                      <p>
                        {(result().waiting ? FIX_WORDS.recorded : FIX_WORDS.started)(
                          result().started.map((value) => value.title),
                        )}
                      </p>
                    </Show>
                    <Show when={result().waiting}>
                      <p>{result().tell ? FIX_WORDS.outside : FIX_WORDS.unconnected}</p>
                    </Show>
                    <Show when={result().tell}>
                      {(tell) => (
                        <Button
                          onClick={() => void window.studio.copyText({ text: tell() }).then(() => setCopied(true))}
                        >
                          <Icon name="copy" />
                          {copied() ? "已复制，再复制一次" : "复制这句话给我的 AI"}
                        </Button>
                      )}
                    </Show>
                    <Show when={result().left.length}>
                      <p>{FIX_WORDS.left}</p>
                      <ul>
                        <For each={result().left}>
                          {(value) => (
                            <li>
                              {value.why.startsWith(`「${value.title}」`)
                                ? value.why
                                : `「${value.title}」：${value.why}`}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </div>
      </Show>
      <PreinstalledMods projectId={props.projectId} targetId={props.targetId} />
      {/* The folder is still read for jars put there by hand; the card above is the way most people add one. */}
      <p class="build-note">{SETUP_WORDS.sceneFolder(SCENE_EXTRA)}</p>
      <Show when={advanced()}>
        <div class="build-actions">
          <Button
            disabled={!ready() || !props.scene?.eula}
            onClick={() => props.start(() => window.studio.startSceneCheck(job()))}
          >
            <Icon name="check" />
            后台检查（不开窗口）
          </Button>
          <Button disabled={!ready()} onClick={() => props.start(() => window.studio.startScenePlay(job()))}>
            <Icon name="play" />
            打开测试场
          </Button>
        </div>
        <p class="build-note">单独做其中一步。要先有这个版本的打包。</p>
      </Show>
    </section>
  )
}
