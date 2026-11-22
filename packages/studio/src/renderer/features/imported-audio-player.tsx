import { createEffect, createSignal, onCleanup } from "solid-js"
export { safeAudioMime } from "./safe-audio-mime"
import "./imported-audio-player.css"

export function ImportedAudioPlayer(props: { src: string; active?: boolean }) {
  let audio!: HTMLAudioElement
  const [status, setStatus] = createSignal("正在加载声音…")
  const [failed, setFailed] = createSignal(false)
  const [loop, setLoop] = createSignal(false)

  createEffect(() => {
    const source = props.src
    const active = props.active ?? true
    if (!audio) return
    if (!active) {
      audio.pause()
      return
    }
    audio.pause()
    audio.currentTime = 0
    audio.src = source
    audio.load()
    setFailed(false)
    setStatus("正在加载声音…")
  })

  const otherPreview = (event: Event) => {
    if (!(event instanceof CustomEvent) || event.detail !== audio) audio?.pause()
  }
  window.addEventListener("studio-audition", otherPreview)
  onCleanup(() => {
    window.removeEventListener("studio-audition", otherPreview)
    audio?.pause()
  })

  return (
    <div class="imported-audio-player">
      <audio
        ref={audio}
        onPlay={() => window.dispatchEvent(new CustomEvent("studio-audition", { detail: audio }))}
        controls
        preload="metadata"
        onCanPlay={() => {
          setFailed(false)
          setStatus("声音已就绪")
        }}
        onError={() => {
          setFailed(true)
          setStatus("声音无法解码或格式不受支持。")
        }}
        onWaiting={() => setStatus("正在缓冲…")}
        onEnded={() => setStatus("播放结束")}
        loop={loop()}
      />
      <div class="imported-audio-player__options">
        <label>
          <input type="checkbox" checked={loop()} onChange={(event) => setLoop(event.currentTarget.checked)} />
          循环试听
        </label>
        <p role="status" aria-live="polite" classList={{ "is-error": failed() }}>
          {status()}
        </p>
      </div>
    </div>
  )
}
