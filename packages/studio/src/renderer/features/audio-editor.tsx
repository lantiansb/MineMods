import { advanced } from "../advanced"
import { Button } from "../ui"
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { MUSIC_LABELS, MUSIC_PARTS, type MusicDocument, type MusicPart } from "@minemods/mod-core/music"
import type { Project } from "@minemods/mod-core/project"
import { SOUND_LIMITS, type SoundDocument } from "@minemods/mod-core/sound"
import type { AudioTargetInput } from "../../audio-requests"
import type { StudioView } from "../../api"
import { audioWave } from "./audio-wave"

type Saved = (next: StudioView, id: string) => void
type Place = { index?: number; part?: MusicPart }
const message = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
const [importReceipt, setImportReceipt] = createSignal<{ projectId: string; assetId: string; text: string } | null>(null)
const duration = (s: number) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0")
const lengthWords = (s: number) => Number(s.toFixed(2)) + " 秒"
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("读不了这个文件。"))
    reader.readAsDataURL(file)
  })
}

export function AudioImport(props: { project: Project; kind: "sound" | "music"; assetId?: string; place?: Place; saved: Saved; disabled?: boolean }) {
  const [title, setTitle] = createSignal("")
  const [wish, setWish] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [notice, say] = createSignal("")
  const [inbox, setInbox] = createSignal<{ folder: string; files: string[] }>()
  const label = () => (props.kind === "sound" ? "声音" : "音乐")
  const locked = () => props.disabled || busy()
  async function run(job: () => Promise<void>) {
    if (locked()) return
    setBusy(true)
    say("")
    try {
      await job()
    } catch (e) {
      say(message(e))
    } finally {
      setBusy(false)
    }
  }
  const bring = (source: File | string) =>
    run(async () => {
      const filename = typeof source === "string" ? source : source.name
      const defaultTitle = filename.replace(/\.[^.]+$/, "").trim().slice(0, 120) || filename.slice(0, 120)
      const target: AudioTargetInput = {
        projectId: props.project.id,
        expectedRevision: props.project.revision,
        kind: props.kind,
        assetId: props.assetId,
        title: props.assetId ? undefined : title().trim() || defaultTitle,
        ...props.place,
      }
      if (source instanceof File && source.size > 64 * 1024 * 1024) throw new Error("请选择 64 MB 以内的文件。")
      const result =
        typeof source === "string"
          ? await window.studio.importAudioInbox({ ...target, filename: source })
          : await window.studio.uploadAudio({ ...target, data: await fileData(source) })
      say(result.cut ? "已截到 10 秒并保存。" : "已保存，" + lengthWords(result.seconds) + "。")
      setImportReceipt({ projectId: props.project.id, assetId: result.assetId, text: notice() })
      props.saved(result.view, result.assetId)
    })
  let chooser!: HTMLInputElement
  return (
    <section class="audio-import new-asset-form" aria-label={"放入" + label()}>
      <Show when={!props.assetId}>
        <label class="field">
          {label()}的名字
          <input value={title()} maxLength={120} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
      </Show>
      <p>
        {props.kind === "sound"
          ? "把声音文件放进来，Studio 会转成游戏能用的格式。超过 10 秒会截到 10 秒。"
          : "前奏和结尾各可放 30 秒，循环段可放 5 分钟。先放循环段，再从 Boss 的「它的声音」选择这首音乐。"}
      </p>
      <div
        class="mc-slot audio-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer?.files[0]
          if (f) void bring(f)
        }}
      >
        <Button primary disabled={locked()} onClick={() => chooser.click()}>
          选文件
        </Button>{" "}
        或把文件拖到这里
        <input
          ref={chooser}
          hidden
          type="file"
          accept="audio/*,.wav,.ogg,.flac,.mp3,.m4a"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0]
            if (f) void bring(f)
            e.currentTarget.value = ""
          }}
        />
      </div>
      <div class="audio-inbox">
      <Button
        disabled={locked()}
        onClick={() =>
          void run(async () => {
            const result = await window.studio.listAudioInbox({ projectId: props.project.id })
            setInbox(result)
          })
        }
      >
        查看收件箱
      </Button>
      <Show when={inbox()}>
        {(box) => (
          <div>
            <p>把文件放进这里，再点「查看收件箱」。原文件会保留。</p>
            <p class="audio-inbox-path">{box().folder}</p>
            <p>这个文件夹里有 {box().files.length} 个声音文件。</p>
            <For each={box().files}>
              {(file) => (
                <p>
                  {file}{" "}
                  <Button disabled={locked()} onClick={() => void bring(file)}>
                    加进来
                  </Button>
                </p>
              )}
            </For>
          </div>
        )}
      </Show>
      </div>
      <Show when={!props.assetId}>
        <div class="new-asset-section">
        <label class="field">
          写一句话请 AI 制作
          <input value={wish()} onInput={(e) => setWish(e.currentTarget.value)} placeholder={`描述你想听到的${label()}`} />
        </label>
        <Button
          disabled={locked() || !wish().trim()}
          onClick={() =>
            void run(async () => {
              await navigator.clipboard.writeText(
                "在「" + props.project.name + "」里制作" + label() + "「" + title() + "」：" + wish() + "。把文件放进收件箱，再从收件箱导入。",
              )
              say("已经复制给 AI 的话。")
            })
          }
        >
          复制给我的 AI
        </Button>
        </div>
      </Show>
      <Show when={busy() || notice()}><p role="status">{busy() ? `正在处理${label()}…` : notice()}</p></Show>
      <Show when={notice().includes("下载转换工具")}>
        <Button
          disabled={locked()}
          onClick={() =>
            void run(async () => {
              await window.studio.installProgram({ id: "ffmpeg" })
              say("转换工具已下载，请再放一次文件。")
            })
          }
        >
          下载转换工具
        </Button>
      </Show>
    </section>
  )
}

export function SoundMetadata(props: { project: Project; doc: SoundDocument; assetId: string; disabled?: boolean; saved: Saved }) {
  const [zh, setZh] = createSignal(props.doc.subtitle?.zh ?? "")
  const [en, setEn] = createSignal(props.doc.subtitle?.en ?? "")
  const [volume, setVolume] = createSignal(String(props.doc.volume))
  const [saving, setSaving] = createSignal(false)
  const [status, setStatus] = createSignal("")
  const value = () => Number(volume())
  const valid = () => Number.isFinite(value()) && value() >= 0.1 && value() <= 1
  const subtitle = () => {
    const chinese = zh().trim()
    const english = en().trim()
    return chinese || english ? { zh: chinese || english, en: english || chinese } : null
  }
  const changed = () => JSON.stringify(subtitle()) !== JSON.stringify(props.doc.subtitle) || value() !== props.doc.volume
  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    if (props.disabled || saving() || !valid() || !changed()) return
    setSaving(true)
    setStatus("")
    try {
      const next = await window.studio.saveSoundSettings({
        projectId: props.project.id, expectedRevision: props.project.revision, assetId: props.assetId,
        subtitle: subtitle(), volume: value(),
      })
      props.saved(next, props.assetId)
      setStatus("声音设置已保存。")
    } catch (error) {
      setStatus(message(error))
    } finally {
      setSaving(false)
    }
  }
  return <form class="panel sound-metadata" aria-label="字幕和音量" noValidate onSubmit={save}>
    <div class="form-fields">
      <label class="field">中文字幕<input value={zh()} maxLength={SOUND_LIMITS.subtitle}
        disabled={props.disabled || saving()} onInput={(event) => setZh(event.currentTarget.value)} /></label>
      <label class="field">英文字幕<input value={en()} maxLength={SOUND_LIMITS.subtitle}
        disabled={props.disabled || saving()} onInput={(event) => setEn(event.currentTarget.value)} /></label>
      <label class="field">音量（0.1 到 1）<input type="number" min={0.1} max={1} step="any" value={volume()}
        aria-invalid={!valid()} disabled={props.disabled || saving()} onInput={(event) => setVolume(event.currentTarget.value)} /></label>
    </div>
    <p>字幕都留空时不显示。只填一种语言时，另一种也显示这行字幕。</p>
    <Button type="submit" disabled={props.disabled || saving() || !valid() || !changed()}>保存声音设置</Button>
    <Show when={status()}><p role="status">{status()}</p></Show>
  </form>
}

export function AudioEditor(props: {
  replace?: boolean
  project: Project
  doc: SoundDocument | MusicDocument
  assetId: string
  disabled?: boolean
} & ({ auditionOnly: true; saved?: never } | { auditionOnly?: false; saved: Saved })) {
  let section!: HTMLElement
  const [place, choose] = createSignal<Place | null>(props.replace ? (props.doc.kind === "music" ? { part: "loop" } : { index: 0 }) : null)
  const [notice, say] = createSignal("")
  const [playing, setPlaying] = createSignal("")
  const [time, setTime] = createSignal(0)
  const [total, setTotal] = createSignal(0)
  let audio: HTMLAudioElement | undefined,
    generation = 0
  const stop = () => {
    generation++
    if (audio) {
      audio.onended = null
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
      audio = undefined
    }
    setPlaying("")
  }
  onCleanup(stop)
  onMount(() => {
    const observer = new IntersectionObserver(entries => {
      if (!(entries[0]?.intersectionRatio > 0)) stop()
    }, { threshold: [0, 0.0001] })
    observer.observe(section)
    window.addEventListener("studio-audition", stop)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("studio-audition", stop)
    })
    if (props.auditionOnly) return
    const replace = () => choose(props.doc.kind === "music" ? { part: "loop" } : { index: 0 })
    window.addEventListener("studio-replace-audio", replace)
    onCleanup(() => window.removeEventListener("studio-replace-audio", replace))
  })
  const rows = () => {
    const doc = props.doc
    if (doc.kind === "sound")
      return doc.files.map((file, index) => ({
        key: String(index),
        label: "文件 " + (index + 1),
        seconds: file.duration,
        channels: 1,
        place: { index } as Place,
        read: async () => file.data,
      }))
    return MUSIC_PARTS.map((part) => ({
      key: part,
      label: MUSIC_LABELS[part],
      seconds: doc[part]?.seconds ?? 0,
      channels: doc[part]?.channels ?? 0,
      place: { part } as Place,
      read: () => window.studio.readMusicPart({ projectId: props.project.id, assetId: props.assetId, part }),
    }))
  }
  async function play(queue: ReturnType<typeof rows>) {
    window.dispatchEvent(new Event("studio-audition"))
    const run = generation
    say("")
    try {
      for (const row of queue) {
        const src = await row.read()
        if (run !== generation) return
        const item = new Audio(src)
        audio = item
        setTime(0)
        setTotal(row.seconds)
        setPlaying(row.label)
        item.ontimeupdate = () => {
          if (run === generation) setTime(item.currentTime)
        }
        const ended = new Promise<void>((resolve, reject) => {
          item.onended = () => resolve()
          item.onerror = () => reject(new Error("这份文件无法播放。"))
          item.onpause = () => {
            if (run !== generation) resolve()
          }
        })
        await item.play()
        await ended
        if (run !== generation) return
      }
      setPlaying("")
    } catch (e) {
      if (run === generation) {
        stop()
        say(message(e))
      }
    }
  }
  const remove = async (pos: Place) => {
    try {
      const next = await window.studio.removeAudio({
        projectId: props.project.id,
        expectedRevision: props.project.revision,
        kind: props.doc.kind,
        assetId: props.assetId,
        ...pos,
      })
      stop()
      props.saved?.(next, props.assetId)
    } catch (e) {
      say(message(e))
    }
  }
  return (
    <section ref={section} class="effect-preview audio-editor" aria-label={props.doc.kind === "sound" ? "声音文件" : "音乐片段"}>
      <Show when={importReceipt()?.projectId === props.project.id && importReceipt()?.assetId === props.assetId}>
        <p role="status">{importReceipt()?.text}</p>
      </Show>
      <Show when={props.doc.kind === "music"}>
        <h3>什么时候放</h3>
        <p>在 Boss 的「它的声音」里选中这首曲子。玩家进入战斗时会听到它。下面列出了每只 Boss 从什么时候放、脱战后多久淡出。</p>
        <button
          onClick={() => {
            const all = rows()
            void play([all[0], all[1], all[1], all[2]].filter((r) => r.seconds))
          }}
        >
          连起来试听（循环两遍）
        </button>
      </Show>
      <For each={rows()}>
        {(row) => {
          const [wave] = createResource(
            () => row.seconds > 0,
            async () => {
              try {
                return await audioWave(await row.read())
              } catch {
                return null
              }
            },
          )
          const last = () => (props.doc.kind === "sound" ? props.doc.files.length === 1 : row.key === "loop")
          return (
            <section class="panel resource-item audio-file">
              <h3>{row.label}</h3>
              <Show when={wave()}>{(src) => <img alt={row.label + "的波形"} width="256" height="64" src={src()} />}</Show>
              <p>{row.seconds ? lengthWords(row.seconds) + (advanced() ? " · " + (row.channels === 2 ? "立体声" : "单声道") : "") : "还没有文件"}</p>
              <Show when={row.seconds}>
                <button onClick={() => void play([row])}>试听</button>
              </Show>
              <Show when={playing() === row.label}>
                <p role="status">
                  正在放{row.label}　{duration(time())} / {duration(total())}
                </p>
                <progress aria-label="播放进度" max={total()} value={time()} />
                <button onClick={stop}>停止</button>
              </Show>
              <Show when={!props.auditionOnly}><button disabled={props.disabled} onClick={() => choose(row.place)}>
                {row.seconds ? "换文件" : "放文件"}
              </button>
              <Show when={row.seconds}>
                <button
                  disabled={last() || props.disabled}
                  title={last() ? "至少要保留" + (props.doc.kind === "music" ? "循环段" : "一个声音文件") : undefined}
                  onClick={() => void remove(row.place)}
                >
                  去掉
                </button>
              </Show>
              </Show>
            </section>
          )
        }}
      </For>
      <Show when={!props.auditionOnly && props.doc.kind === "sound" && props.doc.files.length < 8}>
        <button disabled={props.disabled} onClick={() => choose({})}>
          加一个文件
        </button>
      </Show>
      <Show when={place()}>
        {(pos) => (
          <AudioImport
            project={props.project}
            kind={props.doc.kind}
            assetId={props.assetId}
            place={pos()}
            saved={(v, id) => {
              choose(null)
              props.saved?.(v, id)
            }}
            disabled={props.disabled}
          />
        )}
      </Show>
      <p role="status">{notice()}</p>
    </section>
  )
}
