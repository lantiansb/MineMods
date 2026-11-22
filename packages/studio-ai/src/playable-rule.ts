// The two list names are written out so this leaf imports nothing; a test in making keeps them equal to FINDING_LABELS.
const FINDING_LABELS = { blocking: "必须改的", advice: "可以更好的" } as const

/**
 * The one general rule the playable standard (`@minemods/mod-core/playable`) hands to whoever reviews a
 * finished creature or a piece of gameplay, in the words of the making loop's own two lists. It lives in
 * this leaf package so every reviewer prompt can append it as it stands, whichever package it is written in.
 */
export const PLAYABLE_REVIEW_RULE = `凡是把这一类东西平常就有的行为去掉了（它本来会自己走动、张望、对玩家有反应，做完以后不会了），或者答应过的反应在游戏里那么大的画面上看不出来（挨打、出手、死掉、被挖掉、被使用的时候没有看得见的变化），都算「${FINDING_LABELS.blocking}」，不能只写进「${FINDING_LABELS.advice}」。`
