import { createSignal, onCleanup, Show } from "solid-js"

export function VoiceInput(props: { disabled?: boolean; onText: (text: string) => void }) {
  const [state, setState] = createSignal<"idle" | "requesting" | "recording" | "transcribing">("idle")
  const [error, setError] = createSignal("")
  const session: {
    recorder?: MediaRecorder
    stream?: MediaStream
    timer?: number
    discard: boolean
    disposed: boolean
  } = { discard: false, disposed: false }
  const stop = (discard = false) => {
    session.discard = discard
    window.clearTimeout(session.timer)
    if (session.recorder?.state === "recording") session.recorder.stop()
    session.stream?.getTracks().forEach((track) => track.stop())
    if (discard) setState("idle")
  }
  onCleanup(() => {
    session.disposed = true
    stop(true)
  })
  const record = async () => {
    if (props.disabled || state() !== "idle") return
    setError("")
    setState("requesting")
    session.discard = false
    await navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (session.disposed || session.discard) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        session.stream = stream
        const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((value) =>
          MediaRecorder.isTypeSupported(value),
        )
        if (!mime) {
          stop(true)
          throw new Error("当前设备不支持录音，请直接输入文字。")
        }
        const recorder = new MediaRecorder(stream, { mimeType: mime })
        const chunks: Blob[] = []
        session.recorder = recorder
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data)
        }
        recorder.onerror = () => {
          stop(true)
          setError("录音设备中断，请检查麦克风后重试。")
        }
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop())
          if (session.discard || session.disposed) return
          setState("transcribing")
          const blob = new Blob(chunks, { type: mime.split(";")[0] })
          if (blob.size > 20 * 1024 * 1024) {
            setError("录音过长，请重新录制简短需求。")
            setState("idle")
            return
          }
          const reader = new FileReader()
          reader.onerror = () => {
            setError("录音读取失败，请重试。")
            setState("idle")
          }
          reader.onload = () => {
            if (session.disposed || session.discard) return
            void window.studio
              .transcribeAudio({
                audio: String(reader.result).split(",")[1],
                mime: mime.split(";")[0] as "audio/webm" | "audio/ogg" | "audio/mp4",
              })
              .then((result) => {
                if (!session.disposed) props.onText(result.text)
              })
              .catch((cause) => {
                if (!session.disposed)
                  setError(
                    cause instanceof Error
                      ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
                      : "语音转写失败，请重试。",
                  )
              })
              .finally(() => {
                if (!session.disposed) setState("idle")
              })
          }
          reader.readAsDataURL(blob)
        }
        recorder.start()
        setState("recording")
        session.timer = window.setTimeout(() => stop(), 60000)
      })
      .catch((cause) => {
        if (session.disposed) return
        setState("idle")
        setError(
          cause instanceof Error && cause.name === "NotAllowedError"
            ? "麦克风权限未开启，可以直接输入文字。"
            : cause instanceof Error
              ? cause.message
              : "无法开启麦克风。",
        )
      })
  }
  return (
    <div class="voice-input">
      <button
        type="button"
        class="studio-button"
        disabled={props.disabled || ["requesting", "transcribing"].includes(state())}
        onClick={() => (state() === "recording" ? stop() : void record())}
      >
        {state() === "recording"
          ? "停止录音并转写"
          : state() === "transcribing"
            ? "正在转写…"
            : state() === "requesting"
              ? "正在开启麦克风…"
              : "语音输入"}
      </button>
      <Show when={state() === "recording"}>
        <span role="status">正在录音 · 最长 60 秒</span>
        <button type="button" class="studio-button" onClick={() => stop(true)}>
          取消录音
        </button>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
    </div>
  )
}
