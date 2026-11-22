// Constants of the VP8 lossy format (RFC 6386) and of the WebP lossless format's backward-reference map (RFC 9649).
// They are part of the format, not of any one decoder: every reader has the same numbers. These were read off a
// libwebp 1.x build (not typed in), and the decoders that use them are held in tests to what libwebp itself decodes from files it wrote.

const bytes = (text: string) => Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0))

/** Default probabilities of the coefficient tokens, [block type 4][band 8][context 3][11]; RFC 6386 section 13.5 (`default_coeff_probs`). */
export const COEFFICIENT_PROBABILITIES = bytes(
  "gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/Yj+/+TbgICAgIC9gfL/49X/24CAgGp+4/zW0f//gICAAWL4/+zi//+A" +
  "gIC1he7+3er/moCAgE6GyvfGtP/bgICAAbn5//P/gICAgIC4lvf/7OCAgICAgE1u2P/s5oCAgICAAWX7//H/gICAgICqi/H87NH/" +
  "/4CAgCV0xPPk////gICAAcz+//X/gICAgIDPoPr/7oCAgICAgGZn5//Tq4CAgICAAZj8//D/gICAgICxh/P/6uGAgICAgFCB0//C" +
  "4ICAgICAAQH/gICAgICAgID2Af+AgICAgICAgP+AgICAgICAgICAxiPt38G7oqCRmz6DLcbdrLDcnfzdAUQvktCVp92i/9+AAZXx" +
  "/93g//+AgIC4jer93tz/x4CAgFFjtfKwvvnK//+AAYHo/dbF8sT//4BjedL6ycb/yoCAgBdbo/Kqu/fS//+AAcj2/+r/gICAgIBt" +
  "svH/5/X//4CAgCyCyf3NwP//gICAAYTv+9vR/6WAgIBeiOH72r7//4CAgBZkrvW6of/HgICAAbb5/+jrgICAgIB8j/H/4+qAgICA" +
  "gCNNtfvB0//NgICAAZ33/+zn//+AgIB5jev/4eP//4CAgC1jvPvD2f/ggICAAQH7/9X/gICAgIDLAfj//4CAgICAgIkBsf/g/4CA" +
  "gICA/Qn4+8/Q/8CAgICvDeDzwbn5xv//gEkRq92hs+yn/+qAAV/3/dS3//+AgIDvWvT609H//4CAgJtNw/i8w///gICAARjv+9rb" +
  "/82AgIDJM9v/xLqAgICAgEUuvu/J2v/kgICAAb/7//+AgICAgIDfpfn/1f+AgICAgI18+P//gICAgICAARD4//+AgICAgIC+JOb/" +
  "7P+AgICAgJUB/4CAgICAgICAAeL/gICAgICAgID3wP+AgICAgICAgPCA/4CAgICAgICAAYb8//+AgICAgIDVPvr//4CAgICAgDdd" +
  "/4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAyhjV67q/3KDwr/9+Jrboqbjkrv+7gD0uituXsvCq/9iA" +
  "AXDm+se/95///4CmbeT809f/roCAgCdNouistPWy//+AATTc9sbH+dz//4B8Sr/zt8H63f//gBhHgtuaqvO2//+AAbbh+dvw/+CA" +
  "gICVluL82M3/q4CAgBxsqvK3wv7f//+AAVHm/MzL/8CAgIB7ZtH3vMT/6YCAgBRfmfOkrf/LgICAAd74/9jVgICAgICor/b8683/" +
  "/4CAgC901//T1P//gICAAXns/dTW//+AgICNVNX8ycr/24CAgCpQoPCiuf/NgICAAQH/gICAgICAgID0Af+AgICAgICAgO4B/4CA" +
  "gICAgICA",
)

/** The probabilities that say whether a frame updates each of the above; RFC 6386 section 13.4 (`coeff_update_probs`), same layout. */
export const COEFFICIENT_UPDATE_PROBABILITIES = bytes(
  "////////////////////////////////////////////sPb////////////f8fz///////////n9/f////////////T8////////" +
  "///q/v7///////////3///////////////b+///////////v/f7///////////7//v////////////j+///////////7//7/////" +
  "//////////////////////3+///////////7/v7///////////7//v////////////79//7////////6//7//v////////7/////" +
  "////////////////////////////////////////////////////2f/////////////h/PH9///+/////+r68fr9//3+//////7/" +
  "///////////f/v7//////////+79/v7///////////j+///////////5/v////////////////////////////3////////////3" +
  "/v////////////////////////////3+///////////8//////////////////////////////7+///////////9////////////" +
  "//////////////////79///////////6//////////////7/////////////////////////////////////////////////////" +
  "////uvv6///////////q+/T+//////////v78/3+//7///////3+///////////s/f7///////////v9/f7+//////////7+////" +
  "///////+/v7///////////////////////////7////////////+/v////////////7////////////////////////////+////" +
  "////////////////////////////////////////////////////////////////////////////////////////////////////" +
  "////////////////////////////////////////////////////////+P/////////////6/vz+//////////j++f3/////////" +
  "//39///////////2/f3///////////z++/7+//////////78///////////4/v3///////////3//v7///////////v+////////" +
  "///1+/7///////////39/v////////////v9///////////8/f7////////////+//////////////z////////////5//7/////" +
  "/////////v/////////////9///////////6///////////////////////////////////////////+////////////////////" +
  "////////",
)

/**
 * The 4×4 sub-block intra modes' probabilities, [mode above][mode left][9]; RFC 6386 section 11.5 (`kf_bmode_probs`).
 * The modes are numbered as libwebp numbers them (DC, TM, VE, HE, RD, VR, LD, VL, HD, HU), which is not the RFC's order.
 */
export const SUBBLOCK_MODE_PROBABILITIES = bytes(
  "53gwWXNxeJhwmLNAfqp2LkZfr0WPUFVSSJtnODoKq9q9EQ2YchoRoyzDFQqteRhQwxo+LEBVkEcKJqvVkCIaqi43E4igIc5HPxQI" +
  "cnLQDAniUSgLYLZUHRAkhrdZiWJlaqWUSLtkgp1vIEtQQmanY0o+KOqAKTUJsvGNGghrSisakkmmMRedQSZpoDM0H3OAaE8MG9n/" +
  "VxEHV0RHLHIzD7oXLykObra3FRHCQi0ZZsW9FxIWWFiTliouLcTNK2G3dVUmI7M9JzXIVxoVK+irOCIzaHJmHV1NJxxVqzqlWmJA" +
  "IhZ0zhciK6ZJazYgGjMBUSsfRBlqFkCrJOFyIhMVZoS8EEx8PhJOX1U5MjAzwWUjn9dvWS5vPJQfrNvkFRJvcHFNVbP/JnhyKCoB" +
  "xPXRChltWCsdjKbVJSuaPT8em0MtRAHRZFAIK5oBMxpHjk5OEP+AIsWrKSgFZtO3BAHdMzIRqNHAFxlSih8kqxumJizlQ1c6qVJz" +
  "GjuzPztatDumXUmaKCgVdI/RIievLw8QtyLfMS23LhEhtwZiDyC3OS4WGIABNhElQSBJcxyAF4DNKAMJczPAEgbfVyUJcztNQBUv" +
  "aDcs2gk2NYLiQFpGzSgpFxo5NjlwuAUpJqbVHiIahZh0CiCGJxM13RpyIEn/HwlB6gIPAXZJSyAMM8D/oCszWB8jQ2ZVN7pVOBUX" +
  "bzvNLSXANyZGfElmASJifWIqWGhVda9SX1Q1WYBkcWUtS097LzOAUasBOREFR2Y5NSkxJiENeTlJGgFVKQpDik1uWi9ycxUCCmb/" +
  "phcGZR0QClWAZcQaORIKZmbVIhQrdRQPJKOARAEaZj1HJSI1H/PARTxHJkl3HN4lRC2AIgEvC/WrPhETRpJVNz5GJSslmmSjVaAB" +
  "PwlciBxAIMlVSw8JCUD/uHcQVgYcBUD/GfgBOAgRhIn/N3SAOg8UUoc5GnkopDIfiZqFGSPaM2csg4N7HwaeVihAh5TgLbeAFhoR" +
  "g/CaDgHRLRAVW0DeBwHFOBUnmzyKF2bVUwwNNsD/RC8cVRpVVYCAIJKrEgsHP5CrBAT2IxsKkq6rDBqAvlAjY7RQfjYtVX4vV7Az" +
  "KRQgZUuAi3aSdIBVOCkPsOxVJQk+Rx4Rd3b/ERKKZSY8ijdGKxqOkiQTHqv/YRsUii09PtsBUbxAICkUdZeOFBWjcBMMPcOAMAQY",
)

/** Quantiser step by index 0..127: the DC and the AC columns of RFC 6386 section 14.1 (`dc_qlookup`, `ac_qlookup`). */
export const DC_STEP = [4, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 15, 16, 17, 17, 18, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 25, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 93, 95, 96, 98, 100, 101, 102, 104, 106, 108, 110, 112, 114, 116, 118, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 143, 145, 148, 151, 154, 157] as const
export const AC_STEP = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 119, 122, 125, 128, 131, 134, 137, 140, 143, 146, 149, 152, 155, 158, 161, 164, 167, 170, 173, 177, 181, 185, 189, 193, 197, 201, 205, 209, 213, 217, 221, 225, 229, 234, 239, 245, 249, 254, 259, 264, 269, 274, 279, 284] as const

/** WebP lossless: the 120 shortest backward-reference distances as 2-D offsets, each packed as (rows up << 4) | (8 - columns across): RFC 9649 section 4.2.2. */
export const NEIGHBOUR_OFFSETS = [24, 7, 23, 25, 40, 6, 39, 41, 22, 26, 38, 42, 56, 5, 55, 57, 21, 27, 54, 58, 37, 43, 72, 4, 71, 73, 20, 28, 53, 59, 70, 74, 36, 44, 88, 69, 75, 52, 60, 3, 87, 89, 19, 29, 86, 90, 35, 45, 68, 76, 85, 91, 51, 61, 104, 2, 103, 105, 18, 30, 102, 106, 34, 46, 84, 92, 67, 77, 101, 107, 50, 62, 120, 1, 119, 121, 83, 93, 17, 31, 100, 108, 66, 78, 118, 122, 33, 47, 117, 123, 49, 63, 99, 109, 82, 94, 0, 116, 124, 65, 79, 16, 32, 98, 110, 48, 115, 125, 81, 95, 64, 114, 126, 97, 111, 80, 113, 127, 96, 112] as const
