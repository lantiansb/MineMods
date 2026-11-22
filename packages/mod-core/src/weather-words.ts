/**
 * Boss 能力 7 (天气、天色和落雷): the numbers a boss phase's weather and an ability's lightning are held to, in one place, so the document,
 * the instructions an AI is given, the words and the generated Java all say the same. No Node APIs: the app's window reads it too.
 */

/**
 * A phase's weather (`boss.phases[].weather`), seen only by the players of the fight:
 * - dark: how dark their sky and their world get, 0 (not at all) to 1 (as dark as the game's own boss darkening at its fullest, the sky itself almost black);
 * - ramp: the ticks the rain, the thunder and the darkness take to come and to go (two seconds), so a phase change is felt and does not flash;
 * - sky: how much of the sky's own colour is taken away at `dark` 1 (the game's own darkening only darkens the light and the fog, not the sky).
 */
export const WEATHER_LIMITS = { dark: { min: 0, max: 1 }, ramp: 40, sky: 0.8 } as const

/**
 * A lightning event of an ability (`{type: "lightning"}`):
 * - radius: blocks round each place in which a living thing is struck (the same column the warning outlines);
 * - low / high: blocks below and above the place a struck one may stand at (so one who jumps is still struck, one on a roof is not);
 * - life: ticks the bolt the players see is kept on the server, longer than the game's own bolt flashes, so it is never cut short;
 * - ground: blocks a place is lowered to find the ground the bolt stands on (a place in the air, a target that jumped).
 */
export const LIGHTNING_LIMITS = { radius: { min: 0.5, max: 6 }, low: -1, high: 4, life: 20, ground: 6 } as const
