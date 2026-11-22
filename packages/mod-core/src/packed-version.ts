/**
 * Which version a pack is. No Node APIs: the build panel reads it in the window.
 *
 * Every pack (a finished build) is one fixed version of the project: the project revision it was made from, the moment it finished, and the
 * things its manifest lists. The project goes on changing after it (an outside AI saves more, the person edits), and the pack does not. So
 * everything the panel says about a pack is said about that version, and "what was made since" is worked out against it, never read off the
 * project as it is now and presented as if it were what is in the jar:
 *   - what the pack holds: the things its manifest lists (`contains`), counted from the manifest itself and never from what the plan says today: a saved thing the
 *     newest plan marks 「这次不做」 is still in the jar if it was in the project when the pack was made;
 *   - what is not in it: saved things that are not in the manifest (`added`) and things that are, saved again since (`changed`);
 *   - whether it is still the project as it is (`current`): the revision the pack was made from is the revision the project is at.
 * The window's "this pack has gone out of date" and the chain's single stale action (`build_stale`) are the same fact, read from the same revision.
 */

export type PackedBuild = {
  /** The build job: what the panel's buttons and the test scene call "the pack". */
  job_id: string
  /** The project revision it was made from. */
  revision: number
  /** When the build finished (an ISO time). */
  finished_at: string
  /** The workspace assets its manifest lists, with the revision of each that went in. */
  assets: readonly { id: string; revision: number }[]
}

/** A thing the project holds, as the overview lists it. `revision` is the saved asset's own; null for content from before assets existed. */
export type PackedItem = { asset_id: string | null; kind: string; title: string; saved: boolean; revision: number | null }

export type PackedVersion = {
  job_id: string
  packed_at: string
  revision: number
  /** The project has not been saved since: a pack made now would hold exactly this. */
  current: boolean
  /** How many saved things this pack holds; null when its manifest is gone and the project has moved on, so nothing can be said about what is in it. */
  contains: number | null
  /** Saved since, and not in this pack at all. */
  added: { title: string; kind: string }[]
  /** In this pack, and saved again since: the pack still has the earlier form. */
  changed: { title: string; kind: string }[]
}

export function packedVersion(build: PackedBuild, projectRevision: number, items: readonly PackedItem[]): PackedVersion {
  const current = build.revision === projectRevision
  // No manifest and a project that has moved on: what the pack holds cannot be told, so nothing is counted or listed (`build-record.ts`: nothing is then claimed as built).
  if (!current && build.assets.length === 0) return { job_id: build.job_id, packed_at: build.finished_at, revision: build.revision, current, contains: null, added: [], changed: [] }
  const inside = new Map(build.assets.map((asset) => [asset.id, asset.revision]))
  const saved = items.filter((item) => item.saved)
  // Content from before assets existed has no revision of its own, so it can only be placed while the project is exactly what the pack was made from; of an older pack
  // nothing is claimed about it either way.
  const held = saved.filter((item) => (item.asset_id === null ? current : inside.has(item.asset_id)))
  // What is in the jar is what the manifest lists, not what the list of things can still match to it (a thing the plan has since set aside, or is changing, is
  // not found there under its own id, but it was packed). Content from before assets existed is not in the manifest and is only placed while the project is current.
  const contains = inside.size + saved.filter((item) => item.asset_id === null && current).length
  const added = saved.filter((item) => item.asset_id !== null && !inside.has(item.asset_id))
  const changed = held.filter((item) => item.asset_id !== null && item.revision !== null && item.revision > inside.get(item.asset_id)!)
  const named = (value: PackedItem) => ({ title: value.title, kind: value.kind })
  return { job_id: build.job_id, packed_at: build.finished_at, revision: build.revision, current, contains, added: added.map(named), changed: changed.map(named) }
}

/** When a pack was made, as a person says it: the time today, the day and time before that. Local time of the `now` it is given. */
export function whenPacked(packedAt: string, now: Date = new Date()) {
  const at = new Date(packedAt)
  if (Number.isNaN(at.getTime())) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  return sameDay ? time : `${at.getMonth() + 1} 月 ${at.getDate()} 日 ${time}`
}

/** The names of up to three things, then how many more. */
export function namesOf(list: readonly { title: string }[], most = 3) {
  const names = list.slice(0, most).map((value) => `「${value.title}」`)
  return list.length > most ? `${names.join("、")}等` : names.join("、")
}

export type PackedStage = "build" | "check" | "play" | null

export const VERSION_WORDS = {
  none: "还没有打包过。",
  /** What the panel calls the pack when nothing is running: "10:32 打包的那一版，含 4 样". */
  version: (version: PackedVersion, now?: Date) => `${whenPacked(version.packed_at, now)} 打包的那一版${version.contains === null ? "" : `，含 ${version.contains} 样`}`,
  /** The same version, said for what is being done with it. */
  using: (version: PackedVersion, stage: PackedStage, now?: Date) =>
    `${stage === "play" ? "正在打开的是" : stage === "check" ? "正在检查的是" : "这次用的是"} ${VERSION_WORDS.version(version, now)}。`,
  /** Said beside it when the project is still exactly this version. */
  same: "和现在的工程一样。",
  /** What the pack does not have. Empty when it is the project as it is. */
  later: (version: PackedVersion) => {
    if (version.current) return ""
    const lines = [
      version.added.length ? `打包以后又做好了 ${version.added.length} 样（${namesOf(version.added)}），这一版里没有。` : "",
      version.changed.length ? `打包以后又改过 ${version.changed.length} 样（${namesOf(version.changed)}），这一版里还是改之前的样子。` : "",
    ].filter(Boolean)
    // Saved since, but not a thing: the mod's name, icon, author or something the AI keeps notes in. The pack is still not the project as it is.
    return lines.length ? lines.join("") : "打包以后工程又存过别的修改（比如模组信息），这一版不是现在的样子。"
  },
  /** For a pack that is out of date while the game is still being got ready: what happens to what was downloaded. */
  keeps: "游戏文件已经下的部分不会白费，重新打包以后接着用。",
  /** While the game is open: it cannot be swapped under the player. */
  close: "先把游戏窗口关掉，再点「重新打包并打开」。",
  again: (want: "play" | "jar") => (want === "jar" ? "重新打包" : "重新打包并打开"),
} as const
