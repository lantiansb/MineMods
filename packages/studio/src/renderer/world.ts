/**
 * Words for the world behind the GUI (world.css): the title screen's splash line. Each one says something true about
 * MineMods in the game's own cheerful voice; one is picked when the page loads, like the game's yellow splash text.
 */
export const SPLASHES = [
  "一句话就能做！",
  "不用装 Java！",
  "会飞的也行！",
  "AI 做，Studio 验！",
  "每一轮都看得见！",
  "连碰撞箱都量过！",
  "进游戏就看得到！",
  "配方撞了原版会拦下！",
  "说明书自己写好！",
  "模型自己会动！",
  "不满意就改它！",
  "做好了一键试玩！",
] as const

/** A few days of the year have their own line, the first thing said that day. */
const DAYS: Record<string, string> = { "1-1": "新的一年，新的模组！", "10-31": "今晚适合做个怪物！", "12-25": "给世界加一份礼物！" }
const dayLine = (date: Date) => DAYS[`${date.getMonth() + 1}-${date.getDate()}`]

export const pickSplash = (random: () => number = Math.random, date = new Date()) => dayLine(date) ?? SPLASHES[Math.floor(random() * SPLASHES.length)]!

/** Pressed, it says something else: never the line it just said. */
export function nextSplash(now: string, random: () => number = Math.random, date = new Date()): string {
  const day = dayLine(date)
  const lines = [...SPLASHES, ...(day ? [day] : [])].filter((line) => line !== now)
  return lines[Math.floor(random() * lines.length)]!
}

/** The title art (assets/world/title.png), found the way every bundled picture is. */
export const TITLE_IMAGE = new URL("./assets/world/title.png", import.meta.url).href
