import { mkdir } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { DELETED_FOLDER } from "./api"

/**
 * The folder a new project lives in is named after the project, so a person who has to find it (to move it, to back it up, to tell an AI which
 * one) can recognise it. Before this it was a UUID, which nobody can tell apart. The id stays inside the project file; nothing reads it from the
 * folder's name (`listProjects` opens every folder and trusts the file), so old UUID folders and new readable ones sit side by side.
 */

/** The most characters of a name kept in a folder name. The folder used to be a 36-character UUID, so a path built under it is never longer than it was. */
export const FOLDER_NAME_MAX = 36

/** Folders Studio keeps in the same place as the projects. A project must never take their names, even before Studio has made them. */
const RESERVED = new Set(["analysis-projects", DELETED_FOLDER.toLowerCase()])
/** Windows turns these into devices whatever the extension, so a folder of this name cannot be made there. */
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * What of a project's name can stand as a folder name on every system: characters a Windows path cannot hold, control and invisible
 * characters are dropped, runs of white space become one space, and dots and spaces at the ends go (Windows silently drops a trailing one,
 * which would make two names the same folder). Empty when nothing readable is left.
 */
export function folderBase(name: string): string {
  const cleaned = name
    .normalize("NFC")
    // White space first, so a tab or a line break between words stays a space instead of being dropped as a control character.
    .replace(/\s+/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
  // Cut by characters, not by UTF-16 units, so a character outside the basic plane is not split in half.
  const cut = [...cleaned].slice(0, FOLDER_NAME_MAX).join("").replace(/[.\s]+$/g, "")
  return DEVICE.test(cut.split(".")[0] ?? "") ? `${cut}_` : cut
}

/**
 * Makes the project's folder in `parent` and answers its path. The first free of: the name; the name with " (2)", " (3)" … when another
 * folder or file already has it (people do name two projects alike); and, for a name with nothing readable in it, "工程" with a short random
 * suffix, since there is nothing to tell it apart by. The folder is made here, not just looked up free, so two projects created at the same
 * moment (an outside AI can call twice at once) never end up in one folder: the system refuses the second `mkdir`.
 */
export async function claimProjectFolder(parent: string, name: string, random: () => string = () => randomBytes(3).toString("hex")): Promise<string> {
  await mkdir(parent, { recursive: true })
  const base = folderBase(name)
  const readable = base || `工程-${random()}`
  const attempt = async (candidate: string) => {
    if (RESERVED.has(candidate.toLowerCase())) return null
    const directory = path.join(parent, candidate)
    return mkdir(directory).then(
      () => directory,
      (error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") return null
        throw error
      },
    )
  }
  const first = await attempt(readable)
  if (first) return first
  // The number goes after the cut, so a long name still gets its number.
  const stem = [...readable].slice(0, FOLDER_NAME_MAX - 6).join("").replace(/[.\s]+$/g, "")
  for (let count = 2; count < 100; count += 1) {
    const found = await attempt(`${stem} (${count})`)
    if (found) return found
  }
  // A hundred projects of one name: a random suffix cannot collide in practice.
  const last = await attempt(`${stem}-${random()}`)
  if (last) return last
  throw new Error("找不到可用的工程文件夹名，请换一个工程名字再试。")
}
