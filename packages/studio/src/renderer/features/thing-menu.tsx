import {focusSound} from "./sound-focus"
import {soundUsers} from "@minemods/mod-core/sound-moments"
import { createSignal, For, onCleanup, Show } from "solid-js"
import { MoreMenu } from "../more-menu"
import { COPY_KINDS } from "../../asset-actions"
import type { Project } from "@minemods/mod-core/project"
import type { AssetUsage, StudioView } from "../../api"

const [deleted, remember] = createSignal<{ projectId: string; deletion: string; title: string } | null>(null)
export function UndoThing(props: { project: Project; saved: (v: StudioView) => void }) {
  const [error, say] = createSignal("")
  return (
    <Show when={deleted()?.projectId === props.project.id && deleted()}>
      {(entry) => (
        <div role="status" class="panel">
          已删除「{entry().title}」。{" "}
          <button
            onClick={async () => {
              try {
                const result = await window.studio.restoreDeleted({
                  projectId: props.project.id,
                  expectedRevision: props.project.revision,
                  deletion: entry().deletion,
                })
                remember(null)
                say("")
                props.saved(result.view)
              } catch (e) {
                say(String(e))
              }
            }}
          >
            撤销
          </button>{" "}
          {error()}
        </div>
      )}
    </Show>
  )
}
export function ThingMenu(props: {
  project: Project
  id: string
  kind: string
  title: string
  busy?: boolean
  saved: (v: StudioView, id: string | null) => void
  replace?: () => void
  go?: (id: string) => void
  planned?: boolean
  omit?: () => void
}) {
  const [panel, select] = createSignal(""),
    [name, setName] = createSignal(""),
    [error, say] = createSignal(""),
    [working, work] = createSignal(false),
    [users, setUsers] = createSignal<AssetUsage["used_by"]>([])
  const target = () => ({ projectId: props.project.id, assetId: props.id, ...(props.kind === "entity" ? { creature: true as const } : {}) })
  const input = () => ({ ...target(), expectedRevision: props.project.revision })
  async function run(fn: () => Promise<void>) {
    if (working()) return
    work(true)
    say("")
    try {
      await fn()
    } catch (e) {
      say(String(e).replace(/^.*?Error: /, ""))
    } finally {
      work(false)
    }
  }
  const action = (label: string, fn: () => void, reason?: string) => (
    <div>
      <button role="menuitem" disabled={!!reason || working()} onClick={fn}>
        {label}
      </button>
      <Show when={reason}>
        <small> {reason}</small>
      </Show>
    </div>
  )
  const locked = () => (props.busy ? "AI 正在做它，做完再来。" : props.planned ? "蓝图里这样东西还没做出来。" : undefined)
  const replaceName = () => (["block", "item"].includes(props.kind) ? "换图" : props.kind === "entity" ? "换模型" : "换文件")
  return (
    <MoreMenu class="thing-menu" label="管理这样东西">
      {(close) => {
        let available = true
        onCleanup(() => { available = false; select(""); say("") })
        return <>
      <Show when={!panel()}>
        <div class="panel thing-options" role="menu">
          {action(
            "改名",
            () => {
              setName(props.title)
              select("name")
            },
            locked(),
          )}
          {action(
            "复制一份",
            () =>
              void run(async () => {
                const copy = await window.studio.duplicateAsset(input())
                close()
                props.saved(copy.view, copy.assetId)
              }),
            locked() || (!COPY_KINDS.includes(props.kind) ? (props.kind === "entity" ? "生物暂时不能复制。可以加一只，再把模型带进来。" : "这一类东西暂时不能复制。") : undefined),
          )}
          {action(
            replaceName(),
            () => {
              close()
              props.replace?.()
            },
            locked() || (!props.replace ? "这一类东西没有可换的文件。" : undefined),
          )}
          {props.planned
            ? action(
                "不做这个了",
                () => {
                  close()
                  props.omit?.()
                },
                props.busy ? "AI 正在做它，做完再来。" : !props.omit ? "这项蓝图还不能修改。" : undefined,
              )
            : action(
                "删除",
                () =>
                  void run(async () => {
                    const usage = await window.studio.getAssetUsage(target())
                    if (!available) return
                    setUsers(usage.used_by)
                    select("delete")
                  }),
                locked(),
              )}
        </div>
      </Show>
      <Show when={panel() === "name"}>
        <div class="panel">
          <label>
            新名字
            <input maxLength={120} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <button
            disabled={working() || !name().trim()}
            onClick={() =>
              void run(async () => {
                const v = await window.studio.renameAsset({ ...input(), title: name().trim() })
                close()
                props.saved(v, props.id)
              })
            }
          >
            保存名字
          </button>
        </div>
      </Show>
      <Show when={panel() === "delete"}>
        <section class="panel" aria-label="删除确认">
          <Show
            when={users().length}
            fallback={
              <>
                <p>
                  删除「{props.title}」？{props.project.blueprint?.entries.some((e) => e.asset_id === props.id) ? "蓝图里对应的那一条也会去掉。" : ""}
                  删完可以撤销。
                </p>
                <button
                  disabled={working()}
                  onClick={() =>
                    void run(async () => {
                      const gone = await window.studio.deleteAsset(input())
                      if (gone.deletion === null) {
                        setUsers(gone.used_by)
                        return
                      }
                      remember({ projectId: props.project.id, deletion: gone.deletion, title: props.title })
                      close()
                      props.saved(gone.view, null)
                    })
                  }
                >
                  确认删除
                </button>
              </>
            }
          >
            <p>还不能删，下面这些地方在用它。</p>
            <For each={users()}>{user=>{
              const asset=props.project.workspace.assets.find(a=>a.id===user.id || user.id.endsWith(a.id))??props.project.workspace.assets.find(a=>a.id===props.project.blueprint?.entries.find(e=>e.key===user.id)?.asset_id)
              const moments=props.kind==="sound"?soundUsers(props.project,props.id).filter(r=>r.entity && asset?.document.kind==="entity" && asset.document.model_asset_id===r.entity):[]
              const go=(moment?:typeof moments[number])=>{if(moment?.entity)focusSound({entity:moment.entity,key:moment.key,edit:true});close();props.go?.(user.id)}
              return <Show when={moments.length} fallback={<p>{user.title} <button onClick={()=>go()}>去换</button></p>}><For each={moments}>{m=><p>{user.title} · {m.where} <button onClick={()=>go(m)}>去换</button></p>}</For></Show>
            }}</For>
          </Show>
          <button onClick={close}>取消</button>
        </section>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
        </>
      }}
    </MoreMenu>
  )
}
