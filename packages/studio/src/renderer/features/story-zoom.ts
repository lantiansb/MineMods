/**
 * The picture a person opened large in a making story: which round, which of its sheets, and when that round was made. A round is told apart by its
 * time, not only its number: a redo starts a new making whose rounds are numbered from 1 again, and the same number there is another picture.
 */
export type StoryZoom = { round: number; label: string; at: string }

/**
 * The round the large picture is of in the record as it is read now. Whatever else the record gained or changed in the meantime (a new round,
 * the AI's own check, the review) leaves it where it is; it goes only when that round is no longer among the rounds, and a round that is
 * there without a picture at this read is still there.
 */
export function zoomedRound<Round extends { round: number; at: string }>(zoom: Pick<StoryZoom, "round" | "at"> | null, rounds: readonly Round[]): Round | undefined {
  return zoom ? rounds.find((value) => value.round === zoom.round && value.at === zoom.at) : undefined
}
