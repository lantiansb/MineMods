import { outlineOf, standardBrief } from "@minemods/studio-ai/acceptance"
import { GESTURE_STANDARD } from "./gesture-gate"
import { GESTURE_ADJUST, GESTURE_BONES, GESTURE_EASINGS, GESTURE_KEYFRAMES, GESTURE_KEYS, GESTURE_TIMING, type GestureEasing } from "./gesture-rig"
import type { GestureKey, GestureMotion } from "./gesture-motion"

/**
 * The built-in cast actions. Every number here was written for this product and tuned by eye on rendered
 * contact sheets; none comes from another mod's animation files. Each is authored for the right hand (or
 * both hands) and reads the same way: the torso moves first, a move away from the target comes before the
 * strike, the strike is short and arrives early, then overshoots and settles, and the other arm, the head
 * and the legs answer it. `strength` scales that body language, not where the hand ends up, so an aimed
 * pose stays aimed.
 *
 * They are staged for the player's own eyes as much as for onlookers. The game draws the player's arms
 * where they really are, and a level 70° view only reaches hands held at face height or above and out in
 * front, so every base brings a hand up into that window during the windup, keeps one there through the
 * hold, and sends the release across it — each along a different path: into the depth of the view, down
 * through it, up out of it, across it, towards the player. Where a name asks for an ending outside the
 * window (hands on the ground, arms flung wide, a hand pulled to the chest), the hand leaves through it.
 *
 * A release is replayed up to 1.6 times as fast, which squeezes a five-tick swing into three: big swings
 * are given enough ticks, and the torso and the arm are keyed to peak on different ticks, so no part
 * turns more than the standard allows in one tick at any setting.
 */

export type GestureHand = "right" | "left" | "both"
export type GestureBase = {
  id: string
  name: string
  english_name: string
  /** When to pick it, in one line. The AI brief lists these. */
  description: string
  hands: readonly GestureHand[]
  /** Seconds a key press stays in the hold phase unless the document says otherwise. */
  hold_seconds: number
  motion: (strength: number) => GestureMotion
}

type Row = [tick: number, x: number, y: number, z: number, easing?: GestureEasing]
// Unmarked keys ease in and out; the strike keys name their own curve.
const keys = (...rows: Row[]): GestureKey[] => rows.map(([tick, x, y, z, easing]) => ({ tick, value: [x, y, z], easing: easing ?? "in_out_sine" }))
const ONE = ["right", "left"] as const
const BOTH = ["both"] as const

export const GESTURE_BASES: readonly GestureBase[] = [
  {
    id: "push_one",
    name: "单手推出",
    english_name: "Palm Push",
    description: "先把手掌伸到眼前聚力，出手时猛地收回腰侧、拧身，再一掌从眼前直直推向正中，适合火球、冲击波这类朝前打出去的法术。",
    hands: ONE,
    hold_seconds: 0.2,
    motion: (s) => ({
      windup: {
        ticks: 8,
        bones: {
          torso: { rotation: keys([3, -2 * s, 5 * s, 0, "out_sine"], [8, 2 * s, -8 * s, 0]), position: keys([8, 0, 0, 0.5 * s]) },
          // Out in front where the player can watch it: the spell gathers in the open palm.
          right_arm: { rotation: keys([2, 12, 0, 6, "out_sine"], [7, -104, -5, 0, "in_out_cubic"], [8, -100, -4, 0, "out_sine"]), position: keys([7, 0, 1.5, 1]) },
          left_arm: { rotation: keys([6, 20, 0, 10]) },
          head: { rotation: keys([6, 3, 0, 0]) },
          right_leg: { rotation: keys([7, 5 * s, 0, 1]) },
          left_leg: { rotation: keys([6, -5 * s, 0, 1]) },
        },
      },
      hold: {
        ticks: 6,
        loop: true,
        bones: {
          right_arm: { rotation: keys([3, -103, -6, 3], [6, -100, -4, 0]), position: keys([3, 0, 1.5, 0.4], [6, 0, 1.5, 1]) },
          left_arm: { rotation: keys([4, 22, 0, 11], [6, 20, 0, 10]) },
          torso: { position: keys([3, 0, -0.3 * s, 0.3 * s], [6, 0, 0, 0.5 * s]) },
        },
      },
      release: {
        ticks: 10,
        bones: {
          torso: {
            rotation: keys([2, -5 * s, 18 * s, 2 * s, "out_quad"], [5, 6 * s, -15 * s, -2 * s, "out_cubic"], [7, 8 * s, -19 * s, -2 * s, "out_sine"], [10, 5 * s, -13 * s, -1 * s]),
            position: keys([2, 0, 0, -1.2 * s, "out_quad"], [5, 0, 0, 1.5 * s, "out_quad"], [10, 0, 0, 1 * s]),
          },
          // Snatched back to the ribs and thrown straight out again: the pull is as much of the push as the push.
          right_arm: {
            rotation: keys([3, -40, 14, 22], [6, -108, -8, -4, "out_quad"], [8, -101, -6, 0], [10, -104, -6, 0]),
            position: keys([3, 0, 0.5, -1.5], [6, 0, 1.5, 3.6, "out_quad"], [8, 0, 1.5, 2.4], [10, 0, 1.5, 2.8]),
          },
          left_arm: { rotation: keys([3, -24, 0, 8, "out_quad"], [7, 28, 0, 16, "out_quad"], [10, 22, 0, 12]) },
          head: { rotation: keys([2, -3, 0, 0, "out_sine"], [6, 6, 0, 0, "out_quad"], [10, 3, 0, 0]), position: keys([6, 0, 0, 0.8, "out_quad"], [10, 0, 0, 0.4]) },
          right_leg: { rotation: keys([5, 14 * s, 0, 2, "out_quad"], [10, 10 * s, 0, 2]) },
          left_leg: { rotation: keys([5, -12 * s, 0, 1, "out_quad"], [10, -9 * s, 0, 1]) },
        },
      },
    }),
  },
  {
    id: "push_both",
    name: "双手推出",
    english_name: "Double Push",
    description: "双手从两侧兜上来，在胸前拢成一团、身体后坐蓄力，再上步把两掌一起向前猛推出去，比单手更重，适合大范围的冲击、推开敌人。",
    hands: BOTH,
    hold_seconds: 0.3,
    motion: (s) => ({
      windup: {
        ticks: 9,
        bones: {
          torso: { rotation: keys([3, 4 * s, -3 * s, 0, "out_sine"], [8, -5 * s, 4 * s, 0, "in_out_quad"], [9, -5 * s, 4 * s, 0]), position: keys([3, 0, -0.3, 0.4 * s, "out_sine"], [8, 0, -0.8, -1.2 * s]) },
          // Out and round from the sides, so the player sees both hands sweep in from the corners and close on each other.
          right_arm: { rotation: keys([3, -34, 6, 34, "out_sine"], [8, -100, -19, 0, "in_out_cubic"], [9, -98, -18, 0, "out_sine"]), position: keys([8, 0, 1.5, 3.5]) },
          left_arm: { rotation: keys([4, -30, 6, 36, "out_sine"], [9, -101, -20, 0, "in_out_cubic"]), position: keys([9, 0, 1.5, 4]) },
          head: { rotation: keys([7, 5, 0, 0]) },
          right_leg: { rotation: keys([8, 20 * s, 0, 2]) },
          left_leg: { rotation: keys([8, -18 * s, 0, 2]) },
        },
      },
      hold: {
        ticks: 6,
        loop: true,
        bones: {
          right_arm: { rotation: keys([3, -100, -20, 0], [6, -98, -18, 0]), position: keys([3, 0, 1.5, 2.8], [6, 0, 1.5, 3.5]) },
          left_arm: { rotation: keys([4, -103, -22, 0], [6, -101, -20, 0]), position: keys([4, 0, 1.5, 3.3], [6, 0, 1.5, 4]) },
          torso: { rotation: keys([3, -6 * s, 4 * s, 0], [6, -5 * s, 4 * s, 0]) },
        },
      },
      release: {
        ticks: 11,
        bones: {
          torso: {
            rotation: keys([2, -8 * s, 6 * s, 0, "out_sine"], [5, 10 * s, -3 * s, 0, "out_cubic"], [8, 12 * s, -4 * s, 0, "out_sine"], [11, 9 * s, -3 * s, 0]),
            position: keys([2, 0, -1, -0.9 - 0.6 * s, "out_sine"], [5, 0, -0.5, 1.1 + 0.8 * s, "out_quad"], [11, 0, -0.4, 0.7 + 0.6 * s]),
          },
          right_arm: {
            rotation: keys([2, -93, -22, 0, "out_sine"], [6, -107, -9, -3, "out_quad"], [8, -100, -8, 0], [11, -103, -8, 0]),
            position: keys([2, 0, 1.5, 0.5, "out_sine"], [6, 0, 1.5, 4, "out_quad"], [8, 0, 1.5, 2.8], [11, 0, 1.5, 3.2]),
          },
          left_arm: {
            rotation: keys([3, -96, -24, 0, "out_sine"], [7, -105, -12, -3, "out_quad"], [9, -98, -11, 0], [11, -101, -11, 0]),
            position: keys([3, 0, 1.5, 0.8, "out_sine"], [7, 0, 1.5, 4, "out_quad"], [9, 0, 1.5, 2.8], [11, 0, 1.5, 3.2]),
          },
          head: { rotation: keys([2, 2, 0, 0, "out_sine"], [6, 8, 0, 0, "out_quad"], [11, 4, 0, 0]), position: keys([6, 0, 0, 1, "out_quad"], [11, 0, 0, 0.5]) },
          right_leg: { rotation: keys([6, 26 * s, 0, 2, "out_quad"], [11, 22 * s, 0, 2]) },
          left_leg: { rotation: keys([5, -22 * s, 0, 2, "out_quad"], [11, -18 * s, 0, 2]) },
        },
      },
    }),
  },
  {
    id: "overhead_chop",
    name: "举手下劈",
    english_name: "Overhead Chop",
    description: "一只手举到头顶前上方、在视野右上角蓄着，另一只手在身前虚按；出手时先再往后一扬，然后整条手臂连着身体一起劈下来，适合落雷、斩击、从上往下砸的法术。",
    hands: ONE,
    hold_seconds: 0.4,
    motion: (s) => ({
      windup: {
        ticks: 11,
        bones: {
          torso: { rotation: keys([3, 4 * s, -5 * s, 0, "out_sine"], [10, -3 * s, 4 * s, 1 * s, "in_out_cubic"]), position: keys([3, 0, -0.4, 0.3, "out_sine"], [10, 0, 0.2, -0.3 * s]) },
          // Up through the front and stopped short of vertical: any higher and the player loses sight of their own hand.
          right_arm: { rotation: keys([2, 14, 0, 6, "out_sine"], [9, -144, -7, -4, "in_out_cubic"], [11, -140, -7, -4, "out_sine"]), position: keys([9, 0, 1.5, 4]) },
          left_arm: { rotation: keys([3, 8, 0, 8, "out_sine"], [9, -52, -6, 6]) },
          head: { rotation: keys([9, -8, 0, 0]) },
          right_leg: { rotation: keys([9, 6 * s, 0, 1]) },
          left_leg: { rotation: keys([9, -4 * s, 0, 1]) },
        },
      },
      hold: {
        ticks: 8,
        loop: true,
        bones: {
          right_arm: { rotation: keys([4, -146, -5, -6], [8, -140, -7, -4]), position: keys([4, 0, 1.5, 3.4], [8, 0, 1.5, 4]) },
          left_arm: { rotation: keys([5, -55, -6, 6], [8, -52, -6, 6]) },
          torso: { rotation: keys([4, -5 * s, 5 * s, 1 * s], [8, -3 * s, 4 * s, 1 * s]) },
        },
      },
      release: {
        ticks: 11,
        bones: {
          torso: {
            rotation: keys([2, -9 * s, 12 * s, 2 * s, "out_sine"], [5, 12 * s, -8 * s, -2 * s, "out_cubic"], [8, 14 * s, -9 * s, -2 * s, "out_sine"], [11, 8 * s, -6 * s, -2 * s]),
            position: keys([2, 0, 0.6, -1 * s, "out_sine"], [5, 0, -1.2, 1.6 * s, "out_cubic"], [11, 0, -1, 1.2 * s]),
          },
          // Thrown back out of sight, then down through the middle of the view; it bites below level and springs back up a little.
          right_arm: {
            rotation: keys([2, -172, 0, -12, "out_sine"], [6, -94, -16, 2, "out_quad"], [8, -110, -15, 2, "out_sine"], [11, -108, -15, 2]),
            position: keys([2, 0, 1.5, 1.5, "out_sine"], [6, 0, 1, 3, "out_quad"], [11, 0, 1.5, 3.5]),
          },
          left_arm: { rotation: keys([2, -58, -6, 6, "out_sine"], [6, 22, 0, 16, "out_quad"], [11, 16, 0, 12]) },
          head: { rotation: keys([2, -12, 0, 0, "out_sine"], [6, 10, 0, 0, "out_quad"], [11, 6, 0, 0]) },
          right_leg: { rotation: keys([6, 22 * s, 0, 2, "out_quad"], [11, 20 * s, 0, 2]) },
          left_leg: { rotation: keys([5, -22 * s, 0, 2, "out_quad"], [11, -20 * s, 0, 2]) },
        },
      },
    }),
  },
  {
    id: "sky_call",
    name: "指天引雷",
    english_name: "Sky Call",
    description: "先蹲低身体，把手收在胸前、眼皮底下聚力，再整个人弹起来，把手从眼前一路捅向天空、仰头去看，适合召唤雷电、陨石、把东西从天上叫下来。",
    hands: ONE,
    hold_seconds: 0.3,
    motion: (s) => ({
      windup: {
        ticks: 9,
        bones: {
          torso: { rotation: keys([7, 8 * s, -8 * s, 0, "in_out_quad"], [9, 9 * s, -9 * s, 0, "out_sine"]), position: keys([7, 0, -1.2, 0]) },
          right_arm: { rotation: keys([2, 8, 0, 8, "out_sine"], [7, -108, -31, 0, "in_out_cubic"], [9, -106, -30, 0, "out_sine"]), position: keys([7, 0, 1.5, 1.5]) },
          left_arm: { rotation: keys([8, -25, 0, 8]) },
          head: { rotation: keys([7, 8, 0, 0]) },
          right_leg: { rotation: keys([7, 24, 0, 2]) },
          left_leg: { rotation: keys([7, -22, 0, 2]) },
        },
      },
      hold: {
        ticks: 8,
        loop: true,
        bones: {
          right_arm: { rotation: keys([4, -109, -32, 0], [8, -106, -30, 0]), position: keys([4, 0, 1.5, 1], [8, 0, 1.5, 1.5]) },
          torso: { position: keys([4, 0, -1.5, 0], [8, 0, -1.2, 0]) },
        },
      },
      release: {
        ticks: 12,
        bones: {
          torso: {
            rotation: keys([2, 13 * s, -12 * s, 0, "out_sine"], [6, -7 * s, 6 * s, 0, "out_cubic"], [9, -9 * s, 7 * s, 0, "out_sine"], [12, -4 * s, 2 * s, 0]),
            position: keys([2, 0, -1.8, 0, "out_sine"], [6, 0, 0.6, 0, "out_cubic"], [12, 0, 0.3, 0]),
          },
          // Past vertical is out of the player's sight, so it shoots through the top of the view and comes back to rest just inside it.
          right_arm: {
            rotation: keys([2, -92, -32, 0, "out_sine"], [7, -160, 0, -8, "out_quad"], [10, -148, -4, -4], [12, -146, -4, -4]),
            position: keys([2, 0, 1.2, 0.5, "out_sine"], [7, 0, 1.5, 4, "out_quad"], [12, 0, 1.5, 4]),
          },
          left_arm: { rotation: keys([2, -30, 0, 8, "out_sine"], [6, 26, 0, 24, "out_quad"], [12, 18, 0, 16]) },
          head: { rotation: keys([2, 11, 0, 0, "out_sine"], [7, -30, 0, 0], [12, -24, 0, 0]) },
          right_leg: { rotation: keys([2, 30, 0, 2, "out_sine"], [6, 6, 0, 2, "out_cubic"], [12, 4, 0, 2]) },
          left_leg: { rotation: keys([2, -28, 0, 2, "out_sine"], [6, -4, 0, 2, "out_cubic"], [12, -3, 0, 2]) },
        },
      },
    }),
  },
  {
    id: "ground_slam",
    name: "俯身拍地",
    english_name: "Ground Slam",
    description: "双手从身前举过头顶、踮起脚，在视野上方两角蓄着，再整个人扑下去把双手砸向地面，适合地刺、震地、以自己为中心的范围法术。",
    hands: BOTH,
    hold_seconds: 0.2,
    motion: (s) => ({
      windup: {
        ticks: 11,
        bones: {
          torso: { rotation: keys([3, 5 * s, 0, 0, "out_sine"], [9, -4 * s, 0, 1 * s, "in_out_cubic"], [11, -4 * s, 0, 1 * s]), position: keys([3, 0, -0.5, 0.3, "out_sine"], [9, 0, 0.4, -0.3]) },
          // Up through the front in two beats, one hand a little ahead of the other, and stopped where the player still sees both.
          right_arm: { rotation: keys([2, 12, 0, 8, "out_sine"], [7, -120, -8, 0, "out_quad"], [10, -134, -4, -6]), position: keys([7, 0, 1.5, 3, "out_quad"], [10, 0, 1.5, 4]) },
          left_arm: { rotation: keys([3, 10, 0, 8, "out_sine"], [8, -112, -12, -2, "out_quad"], [11, -128, -8, -8]), position: keys([8, 0, 1.5, 3, "out_quad"], [11, 0, 1.5, 4]) },
          head: { rotation: keys([9, -10, 0, 0]) },
        },
      },
      hold: {
        ticks: 6,
        loop: true,
        bones: {
          right_arm: { rotation: keys([3, -138, -4, -7], [6, -134, -4, -6]) },
          left_arm: { rotation: keys([4, -132, -8, -9], [6, -128, -8, -8]) },
          torso: { position: keys([3, 0, 0.7, -0.3], [6, 0, 0.4, -0.3]) },
        },
      },
      release: {
        ticks: 12,
        bones: {
          // The body falls rather than is placed: it gathers speed all the way down and stops dead on the ground.
          torso: {
            rotation: keys([2, -4 - 8 * s, 0, 2 * s, "out_sine"], [6, 42 + 4 * s, 0, 0, "in_quad"], [8, 46 + 4 * s, 0, 0, "out_sine"], [12, 43 + 4 * s, 0, 0]),
            position: keys([2, 0, 0.9, -0.9, "out_sine"], [6, 0, -4.9, 1.5, "in_quad"], [8, 0, -5.2, 1.5, "out_sine"], [12, 0, -5, 1.5]),
          },
          right_arm: { rotation: keys([2, -160, 0, -8, "out_sine"], [8, -56, 4, 8, "in_quad"], [10, -66, 4, 8, "out_sine"], [12, -62, 4, 8]), position: keys([2, 0, 1.5, 2, "out_sine"], [8, 0, 0, 0]) },
          left_arm: { rotation: keys([3, -154, -2, -10, "out_sine"], [9, -50, 8, 12, "in_quad"], [11, -60, 8, 12, "out_sine"], [12, -58, 8, 12]), position: keys([3, 0, 1.5, 2, "out_sine"], [9, 0, 0, 0]) },
          head: { rotation: keys([2, -14, 0, 0, "out_sine"], [6, 24, 0, 0], [12, 18, 0, 0]) },
          right_leg: { rotation: keys([2, 0, 0, 0, "linear"], [6, 54, 0, 4, "in_quad"], [12, 54, 0, 4]) },
          left_leg: { rotation: keys([2, 0, 0, 0, "linear"], [6, -56, 0, 4, "in_quad"], [12, -56, 0, 4]) },
        },
      },
    }),
  },
  {
    id: "side_sweep",
    name: "横向挥扫",
    english_name: "Side Sweep",
    description: "转身把手臂横着收到另一侧、手停在视野左边，再反手从左到右水平扫过整个眼前、甩过头再带回来，适合扇形火焰、风刃、一挥扫开一片。",
    hands: ONE,
    hold_seconds: 0.2,
    motion: (strength) => {
      // A sweep already turns far; full strength scaling would spin the body.
      const s = 0.5 + 0.5 * strength
      return {
        windup: {
          ticks: 9,
          bones: {
            torso: { rotation: keys([3, 2 * s, 6 * s, 0, "out_sine"], [8, -3 * s, -22 * s, -2 * s, "in_out_quad"], [9, -3 * s, -22 * s, -2 * s]) },
            // Across the body at eye height: the hold is spent with the hand at the left edge of the player's view.
            right_arm: { rotation: keys([2, 6, 0, 8, "out_sine"], [8, -106, -47, 0, "in_out_cubic"], [9, -104, -46, 0, "out_sine"]), position: keys([8, 0, 1.5, 2.5]) },
            left_arm: { rotation: keys([7, 14, 0, 14]) },
            head: { rotation: keys([6, 0, -6 * s, 0]) },
            right_leg: { rotation: keys([8, -6 * s, 0, 2]) },
            left_leg: { rotation: keys([7, 5 * s, 0, 1]) },
          },
        },
        hold: {
          ticks: 6,
          loop: true,
          bones: {
            right_arm: { rotation: keys([3, -107, -49, 0], [6, -104, -46, 0]) },
            torso: { rotation: keys([3, -4 * s, -24 * s, -2 * s], [6, -3 * s, -22 * s, -2 * s]) },
          },
        },
        release: {
          ticks: 12,
          bones: {
            torso: { rotation: keys([2, -5 * s, -28 * s, -2 * s, "out_sine"], [6, 5 * s, 18 * s, 2 * s, "out_cubic"], [9, 6 * s, 22 * s, 2 * s, "out_sine"], [12, 5 * s, 16 * s, 2 * s]), position: keys([6, 0, -0.3, 0.8 * s, "out_cubic"]) },
            // Left to right across the whole view, a touch downhill; it runs out past the right edge and is brought back in.
            right_arm: { rotation: keys([2, -103, -56, 4, "out_sine"], [7, -106, 2, 0, "out_quad"], [9, -104, 16, -4, "out_sine"], [12, -106, -2, 0]), position: keys([2, 0, 1.5, 2, "out_sine"], [7, 0, 1.5, 2.5]) },
            left_arm: { rotation: keys([2, 16, 0, 16, "out_sine"], [7, -30, -10, 20, "out_quad"], [12, -22, -8, 16]) },
            head: { rotation: keys([2, 0, -9 * s, 0, "out_sine"], [6, 2, 8 * s, 0], [12, 2, 5 * s, 0]) },
            right_leg: { rotation: keys([7, 8 * s, 0, 3, "out_quad"], [12, 6 * s, 0, 3]) },
            left_leg: { rotation: keys([6, -8 * s, 0, 2, "out_quad"], [12, -6 * s, 0, 2]) },
          },
        },
      }
    },
  },
  {
    id: "throw",
    name: "投掷",
    english_name: "Overhand Throw",
    description: "一只手举到肩后，另一只手伸在眼前指向目标，再拧身把东西从头顶甩向前方，手从视野右上划到左下，适合丢符咒、飞刀、抛出去的法球。",
    hands: ONE,
    hold_seconds: 0.2,
    motion: (s) => ({
      windup: {
        ticks: 10,
        bones: {
          torso: { rotation: keys([3, 3 * s, -6 * s, 0, "out_sine"], [8, -8 * s, 23 * s, 3 * s, "in_out_quad"], [10, -8 * s, 24 * s, 3 * s, "out_sine"]), position: keys([8, 0, 0, -1 * s]) },
          right_arm: { rotation: keys([3, 14, 0, 8, "out_sine"], [10, -188, 0, -10]) },
          // The thrower's sighting arm: it is what the player sees while the other hand is behind the head.
          left_arm: { rotation: keys([2, 6, 0, 6, "out_sine"], [8, -100, -10, 0, "in_out_cubic"]), position: keys([8, 0, 1.5, 2]) },
          head: { rotation: keys([7, -4, 0, 0]) },
          right_leg: { rotation: keys([8, 10 * s, 0, 3]) },
          left_leg: { rotation: keys([8, -8 * s, 0, 1]) },
        },
      },
      hold: {
        ticks: 6,
        loop: true,
        bones: {
          right_arm: { rotation: keys([3, -193, 0, -13], [6, -188, 0, -10]) },
          left_arm: { rotation: keys([4, -103, -11, 0], [6, -100, -10, 0]) },
          torso: { rotation: keys([3, -10 * s, 26 * s, 3 * s], [6, -8 * s, 24 * s, 3 * s]) },
        },
      },
      release: {
        ticks: 11,
        bones: {
          torso: {
            rotation: keys([2, -11 * s, 27 * s, 3 * s, "out_sine"], [5, 9 * s, -12 * s, -3 * s, "out_quad"], [8, 12 * s, -19 * s, -3 * s, "out_sine"], [11, 8 * s, -15 * s, -2 * s]),
            position: keys([2, 0, 0, -1.4 * s, "out_sine"], [5, 0, -0.4, 1.6 * s, "out_quad"], [11, 0, -0.4, 1.2 * s]),
          },
          // Over the top and on down across the body, the way a thrown arm follows through; it stops low on the far side, still in sight.
          right_arm: { rotation: keys([2, -208, 0, -16, "out_sine"], [7, -78, -44, 6], [9, -90, -44, 6, "out_sine"], [11, -88, -44, 6]), position: keys([2, 0, 0, -1.5, "out_sine"], [7, 0, 1.5, 3]) },
          left_arm: { rotation: keys([3, -103, -11, 0, "out_sine"], [8, -40, 0, 10], [11, -44, 0, 10]), position: keys([8, 0, 0, 0]) },
          head: { rotation: keys([5, 6, 0, 0, "out_quad"], [11, 4, 0, 0]) },
          right_leg: { rotation: keys([6, 20 * s, 0, 3, "out_quad"], [11, 16 * s, 0, 3]) },
          left_leg: { rotation: keys([5, -14 * s, 0, 1, "out_quad"], [11, -12 * s, 0, 1]) },
        },
      },
    }),
  },
  {
    id: "palm_seal",
    name: "合掌结印",
    english_name: "Palm Seal",
    description: "双手先向两边打开，再从视野两侧合到眼前正中、低头蓄力，最后合着的双掌向前一送，再像推开两扇门一样向两边分开，适合结界、封印、治疗这类需要“结印”的法术。",
    hands: BOTH,
    hold_seconds: 0.6,
    motion: (s) => ({
      windup: {
        ticks: 10,
        bones: {
          torso: { rotation: keys([4, -5 * s, 3 * s, 0, "out_sine"], [9, 4 * s, 0, 0]), position: keys([9, 0, -0.4 * s, 0]) },
          right_arm: { rotation: keys([4, -60, 0, 44, "out_sine"], [9, -113, -32, 0, "in_out_cubic"], [10, -112, -31, 0, "out_sine"]), position: keys([9, 0, 1.5, 2]) },
          left_arm: { rotation: keys([5, -56, 0, 40, "out_sine"], [10, -110, -32, 0, "in_out_cubic"]), position: keys([10, 0, 1.5, 2]) },
          head: { rotation: keys([4, -4, 0, 0, "out_sine"], [9, 9, 0, 0]) },
          right_leg: { rotation: keys([9, 0, 0, 4]) },
          left_leg: { rotation: keys([9, 0, 0, 4]) },
        },
      },
      hold: {
        ticks: 12,
        loop: true,
        bones: {
          torso: { rotation: keys([6, 6 * s, 0, 0], [12, 4 * s, 0, 0]), position: keys([6, 0, -0.7 * s, 0], [12, 0, -0.4 * s, 0]) },
          right_arm: { rotation: keys([6, -115, -32, 0], [12, -112, -31, 0]) },
          left_arm: { rotation: keys([7, -113, -33, 0], [12, -110, -32, 0]) },
          head: { rotation: keys([6, 12, 0, 0], [12, 9, 0, 0]) },
        },
      },
      release: {
        ticks: 11,
        bones: {
          torso: {
            rotation: keys([2, 2 * s, 0, 0, "out_sine"], [5, 6 + 8 * s, 5 * s, 0, "out_quad"], [9, -5 * s, 2 * s, 0], [11, -3 * s, 1 * s, 0]),
            position: keys([2, 0, -0.6 * s, -0.5 - 0.4 * s, "out_sine"], [5, 0, -0.3, 0.8 + 0.8 * s, "out_quad"], [11, 0, 0, 0.8 * s]),
          },
          // Sent forward still joined, then thrown open: the player sees the seal leave and the view clear behind it.
          right_arm: { rotation: keys([2, -102, -30, 0, "out_sine"], [5, -120, -30, 0, "out_quad"], [9, -108, 10, 8, "out_back"], [11, -108, 7, 8]), position: keys([2, 0, 1.5, -0.8, "out_sine"], [5, 0, 1.5, 4, "out_quad"], [11, 0, 1.5, 3]) },
          left_arm: { rotation: keys([3, -100, -31, 0, "out_sine"], [6, -118, -31, 0, "out_quad"], [10, -106, 12, 8, "out_back"], [11, -106, 10, 8]), position: keys([3, 0, 1.5, -0.8, "out_sine"], [6, 0, 1.5, 4, "out_quad"], [11, 0, 1.5, 3]) },
          head: { rotation: keys([5, 4, 0, 0, "out_quad"], [9, -9, 0, 0], [11, -7, 0, 0]) },
          // A half step into the push, so the seal is sent with the body and not only the arms.
          right_leg: { rotation: keys([5, 10 * s, 0, 4, "out_quad"], [11, 7 * s, 0, 4]) },
          left_leg: { rotation: keys([5, -9 * s, 0, 4, "out_quad"], [11, -6 * s, 0, 4]) },
        },
      },
    }),
  },
  {
    id: "self_buff",
    name: "展臂加持",
    english_name: "Empower",
    description: "先含胸低头、双臂在眼前交叉着蓄力，再猛地把双臂向两侧甩开、挺胸仰头，手从眼前正中一路分到视野之外，适合给自己加护盾、狂暴、光环。",
    hands: BOTH,
    hold_seconds: 0.3,
    motion: (s) => ({
      windup: {
        ticks: 9,
        bones: {
          torso: { rotation: keys([7, 9 * s, 0, 0, "in_out_quad"], [9, 10 * s, 0, 0, "out_sine"]), position: keys([7, 0, -0.8, 0]) },
          // One forearm over the other, right in front of the eyes.
          right_arm: { rotation: keys([2, 8, 0, 12, "out_sine"], [8, -116, -40, 0]), position: keys([8, 0, 1.5, 1.5]) },
          left_arm: { rotation: keys([3, 6, 0, 10, "out_sine"], [9, -104, -44, 0]), position: keys([9, 0, 1.5, 1]) },
          head: { rotation: keys([7, 17, 0, 0]) },
          right_leg: { rotation: keys([7, 15, 0, 2]) },
          left_leg: { rotation: keys([7, -13, 0, 2]) },
        },
      },
      hold: {
        ticks: 8,
        loop: true,
        bones: {
          torso: { rotation: keys([4, 12 * s, 0, 0], [8, 10 * s, 0, 0]) },
          right_arm: { rotation: keys([4, -118, -42, 0], [8, -116, -40, 0]) },
          left_arm: { rotation: keys([5, -106, -46, 0], [8, -104, -44, 0]) },
        },
      },
      release: {
        ticks: 12,
        bones: {
          torso: {
            rotation: keys([2, 6 + 8 * s, 0, 0, "out_sine"], [6, -12 * s, 0, 3 * s, "out_cubic"], [9, -16 * s, 0, 3 * s, "out_sine"], [12, -12 * s, 0, 2 * s]),
            position: keys([2, 0, -1.2, 0.4, "out_sine"], [6, 0, 0.6, 0, "out_cubic"], [12, 0, 0.3, 0]),
          },
          // Swept apart level across the whole view and on out past its edges: wider than the player can see, which is the point of it.
          right_arm: { rotation: keys([2, -114, -60, 0, "out_sine"], [7, -104, 78, 0], [10, -102, 64, 0], [12, -102, 67, 0]), position: keys([2, -1, 1.5, 2.5, "out_sine"], [7, 1, 1, 0], [12, 1, 1, 0]) },
          left_arm: { rotation: keys([3, -101, -64, 0, "out_sine"], [8, -100, 80, 0], [11, -99, 68, 0], [12, -99, 70, 0]), position: keys([3, -1, 1.5, 2, "out_sine"], [8, 1, 1, 0], [12, 1, 1, 0]) },
          head: { rotation: keys([2, 21, 0, 0, "out_sine"], [6, -24, 0, 0, "out_quad"], [12, -17, 0, 0]) },
          right_leg: { rotation: keys([6, 4, 0, 7 * s, "out_quad"], [12, 3, 0, 5 * s]) },
          left_leg: { rotation: keys([7, -3, 0, 6 * s, "out_quad"], [12, -2, 0, 4 * s]) },
        },
      },
    }),
  },
  {
    id: "channel_beam",
    name: "前伸引导",
    english_name: "Channel",
    description: "侧过身扎稳前后脚，一只手伸在眼前正中、另一只手斜着托在它正下方，像端着一根水龙一样顶住一股持续的力量，蓄力时身体一下一下地顶，收尾时猛推一把、双手被震得向上弹起，适合射线、喷火、持续引导的法术。",
    hands: BOTH,
    hold_seconds: 1.2,
    motion: (s) => {
      // Side-on behind the leading hand, like a fencer: what tells it from a square-on push at a glance. Only part of the
      // turn follows strength, so the hands stay on the target at any setting.
      const turn = -12 - 12 * s
      return {
        windup: {
          ticks: 9,
          bones: {
            torso: { rotation: keys([4, -6 * s, 10 * s, 0, "out_sine"], [9, 5 * s, turn, 0, "in_out_cubic"]), position: keys([4, 0, 0, -0.8 * s, "out_sine"], [9, 0, -0.9, 1.2 * s, "in_out_cubic"]) },
            // The leading hand goes out on the body's turn; the other comes across under it, one above the other like hands on a hose — not side by side like a push.
            right_arm: { rotation: keys([3, 20, 4, 10, "out_sine"], [8, -111, -1, 0, "out_quad"], [9, -108, 0, 0]), position: keys([8, 0, 1.5, 2.5, "out_quad"]) },
            left_arm: { rotation: keys([3, 8, 0, 6, "out_sine"], [9, -95, -62, 0, "in_out_cubic"]), position: keys([9, 0, 0.5, 3.5]) },
            head: { rotation: keys([9, 4, 0, 0]) },
            right_leg: { rotation: keys([8, -10 - 8 * s, 0, 4, "in_out_cubic"]) },
            left_leg: { rotation: keys([9, 12 + 10 * s, 0, 4, "in_out_cubic"]) },
          },
        },
        hold: {
          ticks: 8,
          loop: true,
          bones: {
            // Each beat is a kick back and a lean in again.
            torso: { rotation: keys([3, 1 * s, turn + 4 * s, 0, "out_sine"], [8, 5 * s, turn, 0]), position: keys([3, 0, -0.9, 0.3 * s, "out_sine"], [8, 0, -0.9, 1.2 * s]) },
            right_arm: { rotation: keys([2, -103, 2, 0, "out_sine"], [5, -110, -1, 0], [8, -108, 0, 0]), position: keys([3, 0, 1.5, 1, "out_sine"], [8, 0, 1.5, 2.5]) },
            left_arm: { rotation: keys([3, -91, -60, 0, "out_sine"], [6, -97, -63, 0], [8, -95, -62, 0]), position: keys([3, 0, 0.5, 2.1, "out_sine"], [8, 0, 0.5, 3.5]) },
            head: { rotation: keys([4, 2, 2, 0], [8, 4, 0, 0]) },
          },
        },
        release: {
          ticks: 11,
          bones: {
            torso: {
              rotation: keys([2, -1 * s, turn + 10 * s, 0, "out_sine"], [5, 9 * s, turn - 5 * s, 0, "out_quad"], [9, 1 * s, turn + 3 * s, 0], [11, 2 * s, turn + 3 * s, 0]),
              position: keys([2, 0, -0.9, -0.5 - 0.4 * s, "out_sine"], [5, 0, -0.9, 2 + 0.8 * s, "out_quad"], [9, 0, -0.7, 0.6], [11, 0, -0.7, 0.7]),
            },
            right_arm: {
              rotation: keys([2, -96, 4, 4, "out_sine"], [5, -110, 0, 0, "out_quad"], [9, -124, 4, 4], [11, -121, 4, 4]),
              position: keys([2, 0, 1.2, -1, "out_sine"], [5, 0, 1.5, 4, "out_quad"], [11, 0, 1.5, 2]),
            },
            left_arm: {
              rotation: keys([2, -89, -58, 4, "out_sine"], [6, -98, -62, 0, "out_quad"], [10, -112, -56, 4], [11, -111, -56, 4]),
              position: keys([2, 0, 0.5, -0.5, "out_sine"], [6, 0, 0.8, 4, "out_quad"], [11, 0, 0.8, 2.5]),
            },
            head: { rotation: keys([5, 6, 0, 0, "out_quad"], [9, -4, 0, 0], [11, -3, 0, 0]) },
            right_leg: { rotation: keys([5, -12 - 9 * s, 0, 4, "out_quad"], [11, -10 - 8 * s, 0, 4]) },
            left_leg: { rotation: keys([5, 15 + 11 * s, 0, 4, "out_quad"], [11, 12 + 10 * s, 0, 4]) },
          },
        },
      }
    },
  },
  {
    id: "backstep_charge",
    name: "撤步蓄力",
    english_name: "Backstep Charge",
    description: "向后撤一步压低重心，拳头拉到身后蓄力、另一只手伸在眼前像准星一样指着目标，再整个人冲出去，一拳从身后打到眼前正中，适合蓄力重击、突进。",
    hands: ONE,
    hold_seconds: 0.5,
    motion: (s) => ({
      windup: {
        ticks: 10,
        bones: {
          torso: { rotation: keys([3, 3, -6 * s, 0, "out_sine"], [8, 4, 27 * s, 0, "in_out_quad"], [10, 4, 28 * s, 0, "out_sine"]), position: keys([3, 0, -0.3, 0.4, "out_sine"], [8, 0, -1.4, -2.2 * s]) },
          right_arm: { rotation: keys([9, 6, 0, 22, "in_out_cubic"]), position: keys([9, 0, 0.5, -2]) },
          // Straight out along the line of sight while the fist is out of view behind.
          left_arm: { rotation: keys([2, 6, 0, 6, "out_sine"], [8, -110, -14, 0]), position: keys([8, 0, 2, 3.5]) },
          head: { rotation: keys([8, 3, 0, -4]) },
          right_leg: { rotation: keys([8, 31, 0, 3]) },
          left_leg: { rotation: keys([8, -24, 0, 2]) },
        },
      },
      hold: {
        ticks: 8,
        loop: true,
        bones: {
          right_arm: { rotation: keys([4, 11, 0, 25], [8, 6, 0, 22]) },
          left_arm: { rotation: keys([5, -113, -15, 0], [8, -110, -14, 0]) },
          torso: { position: keys([4, 0, -1.6, -2.5 * s], [8, 0, -1.4, -2.2 * s]) },
        },
      },
      release: {
        ticks: 11,
        bones: {
          torso: {
            rotation: keys([2, 3, 30 * s, 0, "out_sine"], [6, 7, -14 * s, 0, "out_quad"], [9, 9, -20 * s, 0, "out_sine"], [11, 7, -17 * s, 0]),
            position: keys([2, 0, -1.6, -2.7 * s, "out_sine"], [6, 0, -1.2, 2 * s, "out_quad"], [11, 0, -1, 1.5 * s]),
          },
          // The whole arm turns over as it comes through, and the fist runs a little across the middle before it is pulled back onto it.
          right_arm: {
            rotation: keys([2, 12, 0, 25, "out_sine"], [8, -110, -18, -10, "out_quad"], [10, -105, -14, -6], [11, -106, -14, -6]),
            position: keys([2, 0, 0.5, -2.4, "out_sine"], [8, 0, 2, 3.5, "out_quad"], [10, 0, 2, 2.6], [11, 0, 2, 2.7]),
          },
          left_arm: { rotation: keys([3, -112, -15, 0, "out_sine"], [8, -50, 0, 10], [11, -46, 0, 10]), position: keys([8, 0, 0.5, 0]) },
          head: { rotation: keys([5, 6, 0, 0, "out_quad"], [11, 4, 0, 0]) },
          right_leg: { rotation: keys([5, 34, 0, 3, "out_quad"], [11, 30, 0, 3]) },
          left_leg: { rotation: keys([5, -34, 0, 2, "out_quad"], [11, -30, 0, 2]) },
        },
      },
    }),
  },
  {
    id: "draw_sigil",
    name: "单手画符",
    english_name: "Draw Sigil",
    description: "一只手在胸前托着，另一只手抬到眼前一笔一顿地画出符文，眼睛跟着手走，最后把手收回来、再把画好的符向前一掌按出去，适合符咒、法阵、需要“画”出来的法术。",
    hands: ONE,
    hold_seconds: 0.8,
    motion: (s) => ({
      windup: {
        ticks: 8,
        bones: {
          torso: { rotation: keys([5, -3 * s, -8 * s, 0], [8, -3 * s, -9 * s, 0, "out_sine"]) },
          right_arm: { rotation: keys([2, 8, 0, 4, "out_sine"], [7, -114, 0, 0, "out_quad"]), position: keys([7, 0, 1.5, 2, "out_quad"]) },
          // The other hand comes up to the chest as if holding the paper; it stays under the player's view so the drawing hand has it to itself.
          left_arm: { rotation: keys([3, 6, 0, 6, "out_sine"], [8, -72, -10, 4]), position: keys([8, 0, 0, 1]) },
          head: { rotation: keys([6, -6, 6, 0]) },
        },
      },
      hold: {
        ticks: 16,
        loop: true,
        bones: {
          // Four strokes, one per beat, each stopping before the next starts.
          right_arm: { rotation: keys([4, -92, -8, 0], [8, -102, -44, 0], [12, -124, -22, 0], [16, -114, 0, 0]) },
          left_arm: { rotation: keys([8, -75, -11, 4], [16, -72, -10, 4]) },
          torso: { rotation: keys([8, -2 * s, -13 * s, 0], [16, -3 * s, -9 * s, 0]) },
          head: { rotation: keys([4, 2, 3, 0], [8, -3, -9, 0], [12, -12, -3, 0], [16, -6, 6, 0]) },
        },
      },
      release: {
        ticks: 10,
        bones: {
          torso: { rotation: keys([2, -5 * s, 8 * s, 0, "out_sine"], [5, 6 * s, -13 * s, 0, "out_quad"], [7, 8 * s, -15 * s, 0, "out_sine"], [10, 6 * s, -11 * s, 0]), position: keys([2, 0, 0, -0.8 * s, "out_sine"], [5, 0, 0, 1.4 * s, "out_quad"], [10, 0, 0, 0.9 * s]) },
          right_arm: {
            rotation: keys([2, -98, -4, 8, "out_sine"], [6, -110, -12, 0, "out_quad"], [8, -104, -10, 0], [10, -106, -10, 0]),
            position: keys([2, 0, 1.5, -1.2, "out_sine"], [6, 0, 1.5, 4, "out_quad"], [8, 0, 1.5, 2.8], [10, 0, 1.5, 3]),
          },
          left_arm: { rotation: keys([2, -75, -10, 4, "out_sine"], [7, -56, 0, 6, "out_quad"], [10, -58, 0, 6]) },
          head: { rotation: keys([6, 5, 0, 0, "out_quad"], [10, 3, 0, 0]) },
        },
      },
    }),
  },
  {
    id: "pull_back",
    name: "隔空拉扯",
    english_name: "Grasp and Pull",
    description: "探身把手远远伸到眼前正中，像抓住了什么一样较着劲，再整个人向后一仰、拧身，把手从远处一把拽回胸前，适合把敌人或物品拉过来、吸取生命、隔空取物。",
    hands: ONE,
    hold_seconds: 0.3,
    motion: (s) => ({
      windup: {
        ticks: 8,
        bones: {
          torso: { rotation: keys([3, -3 * s, 6 * s, 0, "out_sine"], [8, 8 * s, -14 * s, 0]), position: keys([3, 0, 0, -0.4 * s, "out_sine"], [8, 0, -0.3, 1.2 * s]) },
          // As far out as the arm goes: the hand is small and dead centre, so the pull has the whole depth of the view to come back through.
          right_arm: { rotation: keys([2, 14, 0, 6, "out_sine"], [7, -106, -13, 0, "in_out_cubic"], [8, -104, -12, 0, "out_sine"]), position: keys([7, 0, 1.5, 4]) },
          left_arm: { rotation: keys([7, 22, 0, 12]) },
          head: { rotation: keys([6, 4, 0, 0]) },
          right_leg: { rotation: keys([7, -12 * s, 0, 2]) },
          left_leg: { rotation: keys([7, 10 * s, 0, 1]) },
        },
      },
      hold: {
        ticks: 8,
        loop: true,
        bones: {
          // The grip: the arm twists one way and the other, and the body gives a little and takes it back.
          right_arm: { rotation: keys([3, -106, -12, 8], [6, -103, -13, -4], [8, -104, -12, 0]), position: keys([4, 0, 1.5, 3.2], [8, 0, 1.5, 4]) },
          torso: { rotation: keys([4, 6 * s, -12 * s, 0], [8, 8 * s, -14 * s, 0]), position: keys([4, 0, -0.3, 0.8 * s], [8, 0, -0.3, 1.2 * s]) },
        },
      },
      release: {
        ticks: 10,
        bones: {
          torso: {
            rotation: keys([2, 11 * s, -18 * s, 0, "out_sine"], [6, -8 * s, 16 * s, 2 * s, "out_quad"], [8, -11 * s, 20 * s, 2 * s, "out_sine"], [10, -7 * s, 14 * s, 1 * s]),
            position: keys([2, 0, -0.3, 0.8 + 0.6 * s, "out_sine"], [6, 0, -0.6, -0.8 - 0.6 * s, "out_quad"], [10, 0, -0.5, -0.5 - 0.5 * s]),
          },
          // Straight back at the player's face, growing in the middle of the view, and only then down to the chest and out under the bottom of it.
          right_arm: {
            rotation: keys([2, -106, -14, 0, "out_sine"], [5, -114, -34, 4, "linear"], [8, -72, -28, 5, "out_quad"], [10, -76, -28, 5]),
            position: keys([2, 0, 1.5, 4, "out_sine"], [5, 0, 2.2, 2.2, "linear"], [8, 0, 0, -1.2, "out_quad"], [10, 0, 0, -0.9]),
          },
          left_arm: { rotation: keys([2, 24, 0, 12, "out_sine"], [6, -28, 0, 8, "out_quad"], [10, -22, 0, 8]) },
          head: { rotation: keys([2, 5, 0, 0, "out_sine"], [6, -6, 0, 0, "out_quad"], [10, -3, 0, 0]) },
          right_leg: { rotation: keys([6, -18 * s, 0, 2, "out_quad"], [10, -15 * s, 0, 2]) },
          left_leg: { rotation: keys([6, 14 * s, 0, 1, "out_quad"], [10, 12 * s, 0, 1]) },
        },
      },
    }),
  },
  {
    id: "raise_up",
    name: "托举升起",
    english_name: "Raise",
    description: "先弯腰把双手探到身前低处抄住，蹲着把它端到眼前下方、较着劲托住，再往下一沉、蹬腿起身，把双手从眼皮底下一路托到眼前上方，适合升起土墙、召唤亡灵、把东西从地里托起来。",
    hands: BOTH,
    hold_seconds: 0.4,
    motion: (s) => ({
      windup: {
        ticks: 10,
        bones: {
          // Down to get under it, then up to the waist with it: a bow first, a squat after.
          torso: { rotation: keys([4, 16 + 4 * s, 0, 0, "out_sine"], [9, 7 + 2 * s, 0, 0], [10, 7 + 2 * s, 0, 0]), position: keys([4, 0, -1.4, 0.4, "out_sine"], [9, 0, -2.2, 0]) },
          right_arm: { rotation: keys([4, -46, 10, 10, "out_sine"], [9, -114, -4, 0, "in_out_cubic"], [10, -112, -4, 0, "out_sine"]), position: keys([9, 0, 1.5, 3]) },
          left_arm: { rotation: keys([5, -42, 12, 10, "out_sine"], [10, -110, -2, 0, "in_out_cubic"]), position: keys([10, 0, 1.5, 3]) },
          head: { rotation: keys([4, 14, 0, 0, "out_sine"], [9, 8, 0, 0]) },
          right_leg: { rotation: keys([4, 28, 0, 3, "out_sine"], [9, 36, 0, 3]) },
          left_leg: { rotation: keys([4, -26, 0, 3, "out_sine"], [9, -34, 0, 3]) },
        },
      },
      hold: {
        ticks: 8,
        loop: true,
        bones: {
          // The weight: it presses the hands down and they push it back up.
          torso: { position: keys([4, 0, -2.5, 0], [8, 0, -2.2, 0]) },
          right_arm: { rotation: keys([4, -107, -4, 0], [8, -112, -4, 0]) },
          left_arm: { rotation: keys([5, -105, -2, 0], [8, -110, -2, 0]) },
        },
      },
      release: {
        ticks: 12,
        bones: {
          // Legs first, then the back, then the arms: a lift, not a wave.
          torso: {
            rotation: keys([2, 13 + 3 * s, 0, 0, "out_sine"], [7, -8 * s, 0, 0, "out_quad"], [9, -10 * s, 0, 0, "out_sine"], [12, -5 * s, 0, 0]),
            position: keys([2, 0, -3, 0, "out_sine"], [6, 0, 0.8, 0, "out_cubic"], [12, 0, 0.4, 0]),
          },
          right_arm: { rotation: keys([2, -92, -2, 0, "out_sine"], [8, -121, 3, -3, "out_quad"], [10, -113, 2, -2], [12, -115, 2, -2]), position: keys([2, 0, 1, 2, "out_sine"], [8, 0, 1.5, 4, "out_quad"]) },
          left_arm: { rotation: keys([3, -90, 0, 0, "out_sine"], [9, -118, 5, -4, "out_quad"], [11, -110, 4, -3], [12, -112, 4, -3]), position: keys([3, 0, 1, 2, "out_sine"], [9, 0, 1.5, 4, "out_quad"]) },
          head: { rotation: keys([2, 14, 0, 0, "out_sine"], [7, -22, 0, 0], [12, -16, 0, 0]) },
          right_leg: { rotation: keys([2, 42, 0, 3, "out_sine"], [6, 5, 0, 2, "out_cubic"], [12, 4, 0, 2]) },
          left_leg: { rotation: keys([2, -40, 0, 3, "out_sine"], [6, -4, 0, 2, "out_cubic"], [12, -3, 0, 2]) },
        },
      },
    }),
  },
]

export const GESTURE_BASE_IDS = GESTURE_BASES.map((base) => base.id) as [string, ...string[]]
export const gestureBase = (id: string) => GESTURE_BASES.find((base) => base.id === id)

/** A cast action built from a base: what the AI should write by default. */
export const GESTURE_EXAMPLE = {
  kind: "gesture",
  format: 2,
  name: "掌心雷",
  english_name: "Palm Thunder",
  trigger: { type: "key", key: "g" },
  base: "push_one",
  speed: 1,
  strength: 1,
  hand: "right",
  hold_seconds: 0.2,
  aim: true,
  mirror_for_left_handed: true,
  first_person: { arms: true, items: true },
} as const

const key = (time: number, x: number, y: number, z: number, easing: GestureEasing = "in_out_sine") => ({ time, value: [x, y, z], easing })

/** A cast action with its own tracks, written the way a document carries them (seconds, not ticks). It passes the acceptance standard. */
export const GESTURE_CUSTOM_EXAMPLE = {
  kind: "gesture",
  format: 2,
  name: "回身指",
  english_name: "Turning Point",
  trigger: { type: "key", key: "h" },
  hold_seconds: 0.3,
  aim: true,
  mirror_for_left_handed: true,
  first_person: { arms: true, items: true },
  custom: {
    windup: {
      length: 0.4,
      bones: {
        torso: { rotation: [key(0.25, -4, 22, 2, "in_out_quad"), key(0.4, -5, 26, 2, "out_sine")] },
        right_arm: { rotation: [key(0.1, 8, 0, 4, "out_sine"), key(0.4, -40, 20, 30, "in_out_cubic")], position: [key(0.35, 0, 0.5, -2)] },
        left_arm: { rotation: [key(0.3, -30, 0, 10)] },
        head: { rotation: [key(0.3, 4, 0, 0)] },
      },
    },
    hold: null,
    release: {
      length: 0.5,
      bones: {
        torso: { rotation: [key(0.1, -7, 31, 2, "out_sine"), key(0.25, 8, -14, -2, "out_quad"), key(0.5, 6, -11, -1)], position: [key(0.1, 0, 0, -1.2, "out_sine"), key(0.3, 0, 0, 1.4, "out_quad")] },
        right_arm: { rotation: [key(0.1, -30, 24, 34, "out_sine"), key(0.3, -102, -8, 2, "out_quad"), key(0.4, -93, -6, 2), key(0.5, -96, -6, 2)], position: [key(0.1, 0, 0.3, -2.4, "out_sine"), key(0.3, 0, 0, 2.4, "out_quad"), key(0.5, 0, 0, 1.6)] },
        left_arm: { rotation: [key(0.3, 26, 0, 14, "out_quad"), key(0.5, 20, 0, 10)] },
        head: { rotation: [key(0.3, 6, 0, 0, "out_quad")] },
      },
    },
  },
} as const

const span = (range: readonly [number, number]) => `${range[0]}~${range[1]}`
const bones = GESTURE_BONES.map(
  (bone) => `${bone.name}（${bone.label}）旋转 x ${span(bone.rotation.x)}、y ${span(bone.rotation.y)}、z ${span(bone.rotation.z)}，位移 x ${span(bone.position.x)}、y ${span(bone.position.y)}、z ${span(bone.position.z)}`,
).join("；")

/** The brief for the AI that makes a cast action. Written from the tables so the words cannot drift from the limits. */
export const GESTURE_INSTRUCTIONS = [
  "输出一个施法动作：玩家按键后做的一整套身体动作，分三段——起手（进入施法姿势）、蓄力（保持或小幅循环）、出手（短促的一击），之后由游戏自动平滑收回。自己在第一人称看到的是自己的手臂做同一套动作，别人看到的是全身。",
  `动作有两种写法，哪一种都可以，没有默认的那一种，做完都要看逐帧图：自己写轨道（custom），或者拿一个内置的基础动作（base）来调。照部件说明里写的动作来选：基础动作正好是你要的那个动作才用它，不要因为省事去套。用基础动作时写 base（基础动作的 id）、speed（${span([GESTURE_ADJUST.speed.min, GESTURE_ADJUST.speed.max])}，越大越快）、strength（${span([GESTURE_ADJUST.strength.min, GESTURE_ADJUST.strength.max])}，越大身体带动越猛）、hand（单手动作写 right 或 left，双手动作写 both）、hold_seconds（蓄力停留几秒，${span([GESTURE_TIMING.hold.min, GESTURE_TIMING.hold.max])}，0.05 的整数倍）。`,
  `内置的基础动作：${GESTURE_BASES.map((base) => `${base.id}「${base.name}」（${base.hands.includes("both") ? "双手" : "单手"}）：${base.description}`).join(" ")}`,
  `样例（用基础动作，只示范写法）：${JSON.stringify(GESTURE_EXAMPLE)}`,
  "自己写轨道时去掉 base、speed、strength、hand，改写 custom。两种写法提交时按同一套验收标准检查，僵硬的动作会被退回并告诉你要改什么。",
  `custom 的写法：windup、hold（没有就写 null）、release 三段，每段有 length（秒，0.05 的整数倍；起手 ${span([GESTURE_TIMING.windup.min, GESTURE_TIMING.windup.max])}，蓄力一轮 ${span([GESTURE_TIMING.hold_cycle.min, GESTURE_TIMING.hold_cycle.max])}，出手 ${span([GESTURE_TIMING.release.min, GESTURE_TIMING.release.max])}）和 bones。hold 另有 loop（true 表示蓄力期间重复这一轮，最后一帧必须回到这一轮开始的姿势）。bones 里每根骨骼可以有 rotation 和 position 两条轨道，每条是 1~${GESTURE_KEYFRAMES.max} 个关键帧 {time, value:[x,y,z], easing}；time 从这一段开始算，大于 0、不超过 length、递增。每段都从上一段结束的姿势接着动（起手从自然站姿开始），所以不用写第 0 秒的帧，没写的骨骼保持不动。`,
  `骨骼只有这六根，范围（旋转是度，位移是像素，1 像素 = 1/16 格）：${bones}。`,
  "方向：手臂和腿的 x 负值是向前抬（-90 平举，-180 举过头顶），正值向后摆；y 和 z 两边都是「向外为正」，所以左右对称的姿势两只手写一样的数字——z 是向身体外侧抬起，y 是抬平之后向外摆（负值是向身体中线收）。躯干和头的 x 正值是向前俯身/低头，y 正值是向右转，z 正值是向右歪。位移：四肢的 x 向外为正，躯干和头的 x 向右为正；y 向上为正，z 向前为正。躯干会带着头和双臂一起动；头始终跟着玩家的视线，head 的旋转是在视线基础上再加的偏移。",
  `easing 说的是「怎样到达这一帧」，只能用：${GESTURE_EASINGS.join(" / ")}。出手那一下用 out_cubic 或 out_quad（一开始就快、到位时刹住），蓄势用 in_out 系列。`,
  // The rules are not written here: they are the acceptance standard's, generated from the same definitions that judge the hand-in.
  standardBrief(outlineOf(GESTURE_STANDARD)),
  `样例（自定义轨道，只示范写法）：${JSON.stringify(GESTURE_CUSTOM_EXAMPLE)}`,
  `name 是中文显示名，english_name 是英文显示名（只用英文字母、数字和空格），两者会出现在游戏的按键设置里。trigger 目前只有一种：{"type":"key","key":"g"}，即按键播放；可选的键只有 ${GESTURE_KEYS.join("、")}，同一个工程里每个键只能给一个施法动作。不要写别的 type。要让技能来播这个动作，不写在这里：做一个技能（ability），在它的 gesture 里写这个施法动作的资产 id（放那个技能时玩家身上播这个动作），或者在它的 bindings 里写 {"type":"gesture","gesture": 这个施法动作的资产 id}（按这个动作的键就放那个技能，动作照常播）。`,
  "aim（默认 true）是手臂跟着玩家看的方向抬高或压低；mirror_for_left_handed（默认 true）是左撇子玩家自动镜像；first_person 里 arms 是第一人称是否显示自己的手臂，items 是是否显示手里的东西，默认都是 true。",
  "做不到的事不要写进说明里：不能动手指、不能弯手肘和膝盖；不带粒子、音效或伤害；只能按键播放。",
].join(" ")

export const GESTURE_SUMMARY = `施法动作：按键播放的全身动作，分起手、蓄力、出手三段；可以自己写轨道（头、躯干、双臂、双腿的旋转和位移关键帧），也可以拿 ${GESTURE_BASES.length} 个内置基础动作里的一个来调速度、力度、左右手和蓄力时长；提交时按验收标准检查，僵硬的动作会被退回。第一人称显示玩家自己的手臂。只能按键播放（${GESTURE_KEYS.join("/")}，每键一个），不带粒子、音效或伤害。`
