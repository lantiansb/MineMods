// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Blockbench 5.1.6, js/outliner/types/cube.js,
// CubePreviewController.updateUV (upstream lines 1338–1414).
// Copyright Blockbench contributors. See vendor/blockbench/source/blockbench-5.1.6/LICENSE.MD.
// Project/Texture/mesh globals have been replaced with explicit values.

/** Convert a game face to the rectangle used by the editor's box vertices. */
export function previewFaceUV(
  face: string,
  rect: { uv: number[]; uv_size: number[]; rotation?: number; uv_rotation?: number },
  size: readonly [number, number],
  space?: "editor",
) {
  const bounds: [number, number, number, number] = [rect.uv[0]!, rect.uv[1]!, rect.uv[0]! + rect.uv_size[0]!, rect.uv[1]! + rect.uv_size[1]!]
  const rotation = rect.uv_rotation ?? rect.rotation ?? 0
  return space === "editor" ? blockbenchFaceUV(bounds, size, rotation) : gameFaceUV(face, bounds, size, rotation)
}

export function gameFaceUV(face: string, rect: readonly [number, number, number, number], size: readonly [number, number], rotation = 0) {
  return blockbenchFaceUV(face === "up" || face === "down" ? [rect[2], rect[3], rect[0], rect[1]] : rect, size, rotation)
}

export function blockbenchFaceUV(
  rect: readonly [number, number, number, number],
  size: readonly [number, number],
  rotation = 0,
  boxUv = false,
  frameCount = 1,
  frame = 0,
) {
  const uv = [...rect]
  const stretch = -Math.max(1, frameCount)
  if (boxUv) {
    for (let axis = 0; axis < 2; axis += 1) {
      const margin = uv[axis] > uv[axis + 2] ? -1 / 64 : 1 / 64
      uv[axis] += margin
      uv[axis + 2] -= margin
    }
  }
  const coordinates: [number, number][] = [
    [uv[0] / size[0], uv[1] / size[1] / stretch + 1],
    [uv[2] / size[0], uv[1] / size[1] / stretch + 1],
    [uv[0] / size[0], uv[3] / size[1] / stretch + 1],
    [uv[2] / size[0], uv[3] / size[1] / stretch + 1],
  ]
  if (frame > 0 && stretch !== -1)
    coordinates.forEach((value) => {
      value[1] += frame / stretch
    })
  for (let remaining = rotation; remaining > 0; remaining -= 90) {
    const first = coordinates[0]
    coordinates[0] = coordinates[2]
    coordinates[2] = coordinates[3]
    coordinates[3] = coordinates[1]
    coordinates[1] = first
  }
  return coordinates
}
