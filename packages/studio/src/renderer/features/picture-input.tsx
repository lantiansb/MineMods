import { REFERENCE_LIMITS, REFERENCE_REFUSALS } from "@minemods/studio-ai/making"

/**
 * Taking pictures in from the person — the file picker, a drop, a paste — and showing one large. Shared by the
 * 参考图 tray and the 六视图 block, so both refuse the same files with the same words before anything is sent.
 */

/** The formats the project keeps a reference picture in. */
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"]
export const PICTURE_ACCEPT = PICTURE_TYPES.join(",")

/** What a picture from the clipboard is called: it has no file name of its own. */
export const PASTED_NAME = "粘贴的图"

export const readPicture = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(REFERENCE_REFUSALS.not_a_picture))
    reader.readAsDataURL(file)
  })

/** Why this file is refused before it is read, in the project's own words; empty when it may be sent. The project checks again. */
export const pictureRefusal = (file: File) => (!PICTURE_TYPES.includes(file.type) ? REFERENCE_REFUSALS.not_a_picture : file.size > REFERENCE_LIMITS.bytes ? REFERENCE_REFUSALS.too_large : "")

/** What a refusal from the project says, without the window's wrapping of it. */
export const plainFailure = (error: unknown, fallback: string) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : fallback)

/** Files that may be pictures: a file with no type is let through for the check that follows to name. */
export const pictureFiles = (files: File[]) => files.filter((file) => file.type.startsWith("image/") || !file.type)

/** Pictures on the clipboard, unless the person is typing in a field. */
export const pastedPictures = (event: ClipboardEvent) =>
  event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? [] : [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"))

/** Handlers that take files dropped on an element. `over` says while files are held above it. */
export const dropZone = (input: { closed: () => boolean; over: (value: boolean) => void; files: (files: File[]) => void }) => ({
  onDragOver: (event: DragEvent) => {
    if (input.closed() || ![...(event.dataTransfer?.types ?? [])].includes("Files")) return
    event.preventDefault()
    input.over(true)
  },
  onDragLeave: () => input.over(false),
  onDrop: (event: DragEvent) => {
    event.preventDefault()
    input.over(false)
    input.files([...(event.dataTransfer?.files ?? [])])
  },
})

/** One picture large over the window, with what it is; a click anywhere closes it. */
export function PictureZoom(props: { label: string; title: string; url: string; alt: string; onClose: () => void }) {
  return (
    <div class="mk-zoom" role="dialog" aria-modal="true" aria-label={props.label} onClick={props.onClose}>
      <header>
        <strong>{props.title}</strong>
        <span class="pa-moves-gap" />
        <button type="button" class="pa-move" onClick={props.onClose}>
          关上
        </button>
      </header>
      <img src={props.url} alt={props.alt} draggable={false} />
    </div>
  )
}
