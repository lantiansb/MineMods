import { VERSION_WORDS, type PackedVersion } from "@minemods/mod-core/packed-version"
import { chainOwnsNextAction, type ChainFacts, type ChainStage, type ChainStop } from "./play-chain"

/**
 * What the build panel says about which pack it is talking about: one version, said once, and the same version in every place that mentions a pack (the
 * line on top, the stage that reused it, the export row). A pack is fixed when it is made; the project goes on changing, so "what is not in it" is its own
 * line, never a count of the project as it is now presented as if it were what is in the file (round 20: three sentences, three different versions).
 */

export type VersionInput = {
  /** The pack the press in progress works from: null when it has none (yet) or none is asked about, undefined while it has not been read. */
  used?: PackedVersion | null
  /** The newest finished pack of the project, whether or not a press is in progress: null when there never was one, undefined while it has not been read. */
  latest?: PackedVersion | null
  /** The press in progress, if there is one: the step running now (null when it stands still at a stop), where it stands, what was asked for. */
  chain: { running: ChainStage | null; stop: ChainStop | "busy" | null; want: ChainFacts["want"] } | null
  /** The game is open: it cannot be swapped under the player. */
  inGame: boolean
  now?: Date
}

export type VersionView = {
  /** Which pack: "正在打开的是 10:32 打包的那一版，含 4 样。" */
  pack: string
  /** "和现在的工程一样。" for a pack that is the project as it is; empty otherwise. */
  same: string
  /** What the pack does not have; empty when it is the project as it is. */
  later: string
  /** A sentence under it: what happens to what was already downloaded, or what to do first. */
  note: string
  /** The start buttons' words once the pack is out of date: one action, 「重新打包并打开」, in place of the plain ones. Null while the plain ones are right. */
  start: { play: string; jar: string } | null
  /** Cancels what is running and packs anew, offered while the game is still being got ready. Null otherwise. */
  restart: string | null
}

export function versionView(input: VersionInput): VersionView | null {
  const chain = input.chain
  // A new pack is being made: the older one is about to be replaced, and a list of what it lacks would only say what the new one is about to hold.
  if (chain?.running === "build") return null
  const version = chain ? input.used : input.latest
  // Not read yet, or a press that has no pack to name yet: say nothing rather than something that may be wrong.
  if (version === undefined || (chain && version === null)) return null
  if (version === null) return { pack: VERSION_WORDS.none, same: "", later: "", note: "", start: null, restart: null }
  const pack = chain ? VERSION_WORDS.using(version, chain.running, input.now) : `最近一次打包是 ${VERSION_WORDS.version(version, input.now)}。`
  if (version.current) return { pack, same: VERSION_WORDS.same, later: "", note: "", start: null, restart: null }
  const want = chain?.want ?? "play"
  // While the press is under way the plain buttons are off; what can be done is said here, and only while the game is not yet open.
  const running = !!chain?.running
  const restart = running && !input.inGame ? `取消这一次，${VERSION_WORDS.again(want)}` : null
  const note = running ? (input.inGame ? VERSION_WORDS.close : VERSION_WORDS.keeps) : ""
  // At a stop that has buttons of its own the plain pair is not offered anyway (`chainOwnsNextAction`), and that stop already says the pack must be made again.
  const start = running || chainOwnsNextAction(chain?.stop) ? null : { play: VERSION_WORDS.again("play"), jar: VERSION_WORDS.again("jar") }
  return { pack, same: "", later: chain?.stop === "build_stale" ? "" : VERSION_WORDS.later(version), note, start, restart }
}
