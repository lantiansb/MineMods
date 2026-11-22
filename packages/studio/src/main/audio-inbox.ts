import { open, readdir } from "node:fs/promises"
import path from "node:path"
import { storagePath } from "@minemods/mod-core/project"

export const AUDIO_INPUT_BYTES = 64 * 1024 * 1024
export const INBOX = "收件箱"
const allowed = (name: string) =>
  name.length <= 180 &&
  !/[<>:"/\\|?*\x00-\x1f]/.test(name) &&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) &&
  /\.(?:ogg|wav|mp3|flac|m4a|aac|opus|aif|aiff|wma)$/i.test(name)

export async function listAudioInbox(directory: string) {
  const folder = path.dirname(await storagePath(directory, [INBOX, "listing"], true))
  const entries = await readdir(folder, { withFileTypes: true })
  return {
    folder,
    files: entries
      .filter((entry) => entry.isFile() && allowed(entry.name))
      .map((entry) => entry.name)
      .sort(),
  }
}

export async function readInboxFile(directory: string, filename: string) {
  if (!allowed(filename)) throw new Error("请选择收件箱里列出的音频文件。")
  const file = await open(await storagePath(directory, [INBOX, filename]), "r")
  try {
    const stat = await file.stat()
    if (!stat.isFile() || !stat.size || stat.size > AUDIO_INPUT_BYTES) throw new Error("音频文件必须大于零且不超过 64 MB。")
    return await file.readFile()
  } finally {
    await file.close()
  }
}
