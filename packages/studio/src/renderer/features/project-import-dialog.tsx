import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { DuplicatePair, ImportItem, ImportPlan } from "@minemods/mod-core/project-import"
import type { ProjectImportSource, StudioView } from "../../api"
import { Button } from "../ui"
import { CardShell } from "./project-assets"
import { importKindName as kindName } from "./project-import-words"
import "./project-import-dialog.css"

const renameWords = { title: "名字改成", identifier: "注册名改成", registry: "注册名改成", name: "游戏里的名字改成", id: "" } as const
const failed = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error))
/** r29b: what a person may choose for a thing the main project has under the same id or name with other content. */
type Choice = "reuse" | "replace" | "rename"
const CHOICE_WORDS: Record<Choice, string> = { reuse: "用已有的", replace: "用带进来的（换掉主工程那份）", rename: "两份都留（带进来的改名）" }
/** Brought as a thing of its own (not the main project's used, nor written over). */
const isNew = (item: ImportItem) => item.action !== "reuse" && item.action !== "replace" && item.action !== "update"
const chosenOf = (item: ImportItem): Choice => (item.action === "reuse" ? "reuse" : item.action === "replace" ? "replace" : "rename")

/**
 * 从别的工程导入: pick another project, pick what to bring, read the list of everything that comes along (and why, and what is renamed), then bring it in once.
 * The other project is only read. What was brought can be taken back out from the last step, or later by an outside AI with the import's number.
 */
export function ProjectImportDialog(props: { project: Project; close: () => void; imported: (view: StudioView, open: string | null) => void }) {
  const [sources] = createResource(() => window.studio.projectImportSources({ projectId: props.project.id }))
  const [source, setSource] = createSignal<ProjectImportSource | null>(null)
  const [picked, setPicked] = createSignal<string[]>([])
  const [same, setSame] = createSignal(true)
  const [choices, setChoices] = createSignal<Record<string, Choice>>({})
  // r29b 合并重复件: the list, which of it is chosen, and the merge just made (to take back).
  const [duplicates, setDuplicates] = createSignal<DuplicatePair[] | null>(null)
  const [drops, setDrops] = createSignal<string[]>([])
  const [merged, setMerged] = createSignal<{ view: StudioView; mergeId: string; pairs: DuplicatePair[] } | null>(null)
  const [plan, setPlan] = createSignal<ImportPlan | null>(null)
  const [done, setDone] = createSignal<{ view: StudioView; importId: string; plan: ImportPlan } | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal("")
  const groups = createMemo(() => {
    const things = source()?.things ?? []
    return [...new Set(things.map((thing) => thing.kind))].map((kind) => ({ kind, label: kindName(kind), things: things.filter((thing) => thing.kind === kind) }))
  })
  // r29c: a project folder outside Studio's projects is read where it is, by its path.
  const from = () => (source()!.path ? { sourcePath: source()!.path } : { sourceId: source()!.id })
  const input = () => ({ projectId: props.project.id, ...from(), picks: picked(), conflict: same() ? ("reuse_same" as const) : ("rename" as const), ...(Object.keys(choices()).length ? { choices: choices() } : {}) })
  const run = async (step: () => Promise<void>) => {
    setBusy(true)
    setProblem("")
    await step().catch((error: unknown) => setProblem(failed(error)))
    setBusy(false)
  }
  const look = () => run(async () => {
    setPlan(await window.studio.previewProjectImport(input()))
  })
  // A choice for one namesake changes the list: it is made again with it.
  const choose = (item: ImportItem, choice: Choice) => {
    setChoices({ ...choices(), [item.source_id]: choice })
    void look()
  }
  const chooseFolder = () => run(async () => {
    const found = await window.studio.chooseProjectImportFolder({ projectId: props.project.id })
    if (found) setSource(found)
  })
  const findDuplicates = () => run(async () => {
    const found = await window.studio.listDuplicateAssets({ projectId: props.project.id })
    setDuplicates(found)
    setDrops(found.map((pair) => pair.drop.id))
  })
  const merge = () => run(async () => {
    const result = await window.studio.mergeDuplicateAssets({ projectId: props.project.id, expectedRevision: props.project.revision, drops: drops() })
    setMerged(result)
    props.imported(result.view, null)
  })
  const unmerge = () => run(async () => {
    const result = await window.studio.undoAssetMerge({ projectId: props.project.id, expectedRevision: merged()!.view.project.revision, mergeId: merged()!.mergeId })
    props.imported(result.view, null)
    props.close()
  })
  const bring = () => run(async () => {
    const result = await window.studio.applyProjectImport({ ...input(), expectedRevision: props.project.revision, fingerprint: plan()!.fingerprint })
    setDone(result)
    const creature = result.plan.items.find((item) => item.kind === "entity" && item.action !== "reuse")
    props.imported(result.view, creature?.target_id ?? null)
  })
  const takeBack = () => run(async () => {
    const result = await window.studio.undoProjectImport({ projectId: props.project.id, expectedRevision: done()!.view.project.revision, importId: done()!.importId })
    props.imported(result.view, null)
    props.close()
  })
  const title = () => (merged() ? "合并了" : duplicates() ? "以前带进来时留下的重复件" : done() ? "已经带进来了" : plan() ? "会带进来这些" : source() ? `从「${source()!.name}」选要带进来的东西` : "从别的工程导入")
  return (
    <CardShell title={title()} wide manageFocus onClose={props.close} onBack={duplicates() && !merged() ? () => setDuplicates(null) : plan() && !done() ? () => setPlan(null) : source() && !done() ? () => { setSource(null); setPicked([]); setChoices({}) } : undefined}>
      <div class="pji-body">
        <Show when={duplicates() && !merged()}>
          <Show when={!duplicates()!.length}><p class="pji-line">没有找到以前带进来时改名另存的重复件。</p></Show>
          <Show when={duplicates()!.length}>
            <p class="pji-line">这些是以前从别的工程带进来时，因为「{props.project.name}」里已经有同名的，改了名另存的一份。合并以后只留原来那份，用到另一份的地方都改成指向它；另一份里不一样的地方不会留下。合并后可以撤销。</p>
            <table class="pji-table">
              <thead><tr><th>合并</th><th>改名另存的那份</th><th>留下的</th><th>不一样的地方</th></tr></thead>
              <tbody>
                <For each={duplicates()!}>{(pair) => (
                  <tr>
                    <td><input type="checkbox" class="pji-check" aria-label={`合并「${pair.drop.title}」`} checked={drops().includes(pair.drop.id)} onChange={(event) => setDrops(event.currentTarget.checked ? [...drops(), pair.drop.id] : drops().filter((id) => id !== pair.drop.id))} /></td>
                    <td><strong>{pair.drop.title}</strong><small>{kindName(pair.kind)}{pair.drop.name ? ` · ${pair.drop.name}` : ""} · 从「{pair.from}」带进来</small></td>
                    <td><strong>{pair.keep.title}</strong><small>{pair.keep.name ?? ""}</small></td>
                    <td>{pair.fields.join("、") || "两份一样"}</td>
                  </tr>
                )}</For>
              </tbody>
            </table>
            <div class="pji-actions"><Button primary disabled={busy() || !drops().length} onClick={() => void merge()}>{busy() ? "正在合并…" : `合并选中的 ${drops().length} 样`}</Button></div>
          </Show>
        </Show>
        <Show when={merged()}>
          <p class="pji-line">合并了 {merged()!.pairs.length} 样：{merged()!.pairs.map((pair) => `「${pair.drop.title}」并进「${pair.keep.title}」`).join("、")}。</p>
          <div class="pji-actions">
            <Button primary onClick={props.close}>好的</Button>
            <Button disabled={busy()} onClick={() => void unmerge()}>撤销这次合并</Button>
          </div>
        </Show>
        <Show when={!source() && !duplicates()}>
          <p class="pji-line">几个工程要合成一个模组时用：把别的工程里做好的生物或别的东西，连同它用到的一切，带进「{props.project.name}」。那个工程本身不会被改。</p>
          <Show when={sources.loading}><p class="pji-line">正在找别的工程…</p></Show>
          <Show when={sources() && !sources()!.length}><p class="pji-line">Studio 里没有别的工程。要合进来的工程在别的文件夹里，就用下面的「选别处的工程文件夹」。</p></Show>
          <div class="pji-sources">
            <For each={sources() ?? []}>{(value) => (
              <button type="button" class="nav-link pji-source" onClick={() => setSource(value)}>
                <strong>{value.name}</strong>
                <small>{value.things.filter((thing) => thing.kind === "creature").length} 只生物，共 {value.things.length} 样东西 · 做给 {value.targets.join("、")}</small>
              </button>
            )}</For>
          </div>
          <p class="pji-line pji-muted">要合进来的工程不在上面（放在别的盘、别的文件夹里）？<button type="button" class="nav-link pji-inline" disabled={busy()} onClick={() => void chooseFolder()}>选别处的工程文件夹</button>，直接从那里读，不复制、不改它。</p>
          <p class="pji-line pji-muted">以前带进来时改名另存了一堆同名的东西？<button type="button" class="nav-link pji-inline" disabled={busy()} onClick={() => void findDuplicates()}>找出以前带进来时留下的重复件</button></p>
        </Show>
        <Show when={source() && !plan()}>
          <Show when={source()!.path}><p class="pji-line pji-muted">从这个文件夹读：{source()!.path}</p></Show>
          <For each={groups()}>{(group) => (
            <fieldset class="pji-group">
              <legend>{group.label}</legend>
              <For each={group.things}>{(thing) => (
                <label class="pji-pick">
                  <input type="checkbox" checked={picked().includes(thing.id)} onChange={(event) => setPicked(event.currentTarget.checked ? [...picked(), thing.id] : picked().filter((id) => id !== thing.id))} />
                  {thing.title}
                </label>
              )}</For>
            </fieldset>
          )}</For>
          <label class="pji-pick pji-same">
            <input type="checkbox" checked={same()} onChange={(event) => setSame(event.currentTarget.checked)} />
            两边一模一样的东西（比如同一个声音），用「{props.project.name}」里已有的那一个，不另带一份
          </label>
          <p class="pji-line pji-muted">重名的东西会改个名再带进来，用到它们的地方跟着改。</p>
          <div class="pji-actions"><Button primary disabled={!picked().length || busy()} onClick={() => void look()}>{busy() ? "正在列清单…" : "看看会带进来什么"}</Button></div>
        </Show>
        <Show when={plan() && !done()}>{(_) => (
          <>
            <p class="pji-line">从「{plan()!.source.name}」带进「{plan()!.main.name}」，共 {plan()!.items.length} 样{plan()!.models ? `，连同 ${plan()!.models} 个生物的模型` : ""}。</p>
            <table class="pji-table">
              <thead><tr><th>东西</th><th>为什么带上</th><th>怎么带</th></tr></thead>
              <tbody>
                <For each={plan()!.items}>{(item) => (
                  <tr>
                    <td><strong>{item.title}</strong><small>{kindName(item.kind)}</small></td>
                    <td>{item.why.join("；")}</td>
                    <td>
                      {item.action === "reuse" ? `用「${plan()!.main.name}」里已有的「${item.same_as?.title ?? ""}」` : item.action === "replace" ? `用带进来的换掉「${plan()!.main.name}」的「${item.namesake?.title ?? ""}」` : item.action === "update" ? "上次从这里带进来过：原地换成新版" : "新带进来"}
                      <For each={item.renames.filter((rename) => rename.what !== "id")}>{(rename) => <small>{renameWords[rename.what]}「{rename.to}」</small>}</For>
                      <Show when={item.again?.edited}><small class="pji-stop">带进来以后在「{plan()!.main.name}」里改过，会被盖掉</small></Show>
                      <Show when={item.namesake}>
                        <div class="pji-namesake">
                          <small class="pji-flag">「{plan()!.main.name}」里有同名的「{item.namesake!.title}」，写的不一样：{item.namesake!.fields.join("、") || "用到的东西"}</small>
                          <select aria-label={`「${item.title}」怎么带`} disabled={busy()} value={chosenOf(item)} onChange={(event) => choose(item, event.currentTarget.value as Choice)}>
                            <For each={Object.entries(CHOICE_WORDS)}>{([value, words]) => <option value={value}>{words}</option>}</For>
                          </select>
                          <Show when={item.action === "reuse"}><small>用「{plan()!.main.name}」的「{item.namesake!.title}」，「{plan()!.source.name}」那份里的不同之处不会带进来。</small></Show>
                          <Show when={item.action === "replace"}><small>「{item.namesake!.title}」的编号和游戏里的名字不变，其余换成「{plan()!.source.name}」那份的。</small></Show>
                        </div>
                      </Show>
                    </td>
                  </tr>
                )}</For>
              </tbody>
            </table>
            <Show when={plan()!.left_out.length}>
              <h4>不带的</h4>
              <ul class="pji-notes"><For each={plan()!.left_out}>{(thing) => <li>「{thing.title}」：{thing.why}</li>}</For></ul>
            </Show>
            <Show when={plan()!.notes.length}>
              <h4>要留意的</h4>
              <ul class="pji-notes"><For each={plan()!.notes}>{(note) => <li>{note.text}</li>}</For></ul>
            </Show>
            <Show when={plan()!.blocked.length}>
              <h4 class="pji-stop">现在带不进来</h4>
              <ul class="pji-notes pji-stop"><For each={plan()!.blocked}>{(line) => <li>{line}</li>}</For></ul>
            </Show>
            <div class="pji-actions">
              <Button primary disabled={busy() || !!plan()!.blocked.length} onClick={() => void bring()}>{busy() ? "正在带进来…" : "就这样带进来"}</Button>
              <Button onClick={() => setPlan(null)}>重新选</Button>
            </div>
          </>
        )}</Show>
        <Show when={done()}>
          <p class="pji-line">从「{done()!.plan.source.name}」带进来了 {done()!.plan.items.filter(isNew).length} 样东西{((over) => (over ? `，换成新版或换掉了 ${over} 样` : "，「" + props.project.name + "」里原来的东西没有动"))(done()!.plan.items.filter((item) => item.action === "replace" || item.action === "update").length)}。</p>
          <div class="pji-actions">
            <Button primary onClick={props.close}>好的</Button>
            <Button disabled={busy()} onClick={() => void takeBack()}>撤销这次导入</Button>
          </div>
        </Show>
        <Show when={problem()}><p class="pji-line pji-stop" role="alert">{problem()}</p></Show>
      </div>
    </CardShell>
  )
}
