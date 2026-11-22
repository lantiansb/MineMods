import { createHash, randomUUID } from "node:crypto"
import { link, readFile, rm, writeFile } from "node:fs/promises"
import { storagePath } from "./project"

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const hashPattern = /^[0-9a-f]{64}$/

export function mediaPath(hash: string) {
  if (!hashPattern.test(hash)) throw new Error("媒体文件编号无效。")
  return `.minemods/media/${hash}`
}

export async function readMedia(directory: string, hash: string) {
  const bytes = await readFile(await storagePath(directory, mediaPath(hash).split("/")))
  if (digest(bytes) !== hash) throw new Error("媒体文件已损坏，请从备份恢复。")
  return bytes
}

/** Publish a complete immutable file. Two imports of the same bytes may race. */
export async function storeMedia(directory: string, bytes: Uint8Array) {
  const hash = digest(bytes)
  const target = await storagePath(directory, mediaPath(hash).split("/"), true)
  const temp = target + "." + randomUUID() + ".tmp"
  await writeFile(temp, bytes, { flag: "wx" })
  try {
    await link(temp, target).catch(async (cause: NodeJS.ErrnoException) => {
      if (cause.code !== "EEXIST") throw cause
      await readMedia(directory, hash)
    })
    return hash
  } finally {
    await rm(temp, { force: true })
  }
}

/** Asset documents use this key to refer to immutable media. Version snapshots keep their own references. */
export function mediaHashes(value: unknown): string[] {
  const found = new Set<string>()
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return
    for (const [key, entry] of Object.entries(node)) {
      if (key === "media_sha256" && typeof entry === "string") {
        mediaPath(entry)
        found.add(entry)
      } else visit(entry)
    }
  }
  visit(value)
  return [...found]
}
