// SPDX-License-Identifier: GPL-3.0-or-later
// Numeric linear/step subset extracted and adapted from Blockbench 5.1.6:
// js/animations/timeline_animators.js BoneAnimator.interpolate (423–540)
// js/animations/keyframe.js Keyframe.getLerp (214–224).
// Copyright Blockbench contributors. Upstream GPL license is retained with the source.
// Molang, plugins, splines, quaternion modes and global timeline state are excluded.

export type CoreKeyframe = { time: number; value: readonly [number, number, number]; interpolation?: "linear" | "step" }

export function blockbenchInterpolate(frames: readonly CoreKeyframe[], time: number): [number, number, number] | undefined {
  const before = frames.filter(frame => frame.time < time).sort((a, b) => b.time - a.time)[0]
  const after = frames.filter(frame => frame.time >= time).sort((a, b) => a.time - b.time)[0]
  const fixed = before && Math.abs(before.time - time) <= 1 / 1200 ? before
    : after && Math.abs(after.time - time) <= 1 / 1200 ? after
    : before?.interpolation === "step" ? before : !after ? before : !before ? after : undefined
  if (fixed) return [...fixed.value]
  if (!before || !after) return undefined
  const amount = (time - before.time) / (after.time - before.time)
  return before.value.map((value, axis) => value + (after.value[axis] - value) * amount) as [number, number, number]
}
