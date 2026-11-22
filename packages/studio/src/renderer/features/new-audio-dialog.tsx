import type { ComponentProps } from "solid-js"
import { AudioImport } from "./audio-editor"
import { CardShell } from "./project-assets"

export function NewAudioDialog(props: Pick<ComponentProps<typeof AudioImport>, "project" | "kind" | "saved" | "disabled"> & { close: () => void }) {
  return (
    <CardShell title={props.kind === "sound" ? "加一个声音" : "加一首音乐"} manageFocus onClose={props.close}>
      <AudioImport project={props.project} kind={props.kind} disabled={props.disabled} saved={props.saved} />
    </CardShell>
  )
}
