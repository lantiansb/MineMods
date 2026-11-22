import type { ModelDesign } from "@minemods/studio-ai/contracts"

export type Vector3 = readonly [number, number, number]
export type Face = keyof ModelDesign["bones"][number]["cubes"][number]["faces"]

export function explodeVector(index: number, total: number, amount: number): [number, number, number] {
  const angle = (index / Math.max(1, total)) * Math.PI * 2
  const height = ((index % 3) - 1) * 0.35
  return [Math.cos(angle) * amount, height * amount, Math.sin(angle) * amount]
}

export function uvRect(face: Face, cube: ModelDesign["bones"][number]["cubes"][number], size: number) {
  const width = face === "east" || face === "west" ? cube.size[2] : cube.size[0]
  const height = face === "up" || face === "down" ? cube.size[2] : cube.size[1]
  return { width, height, x: cube.origin[0] % size, y: cube.origin[1] % size }
}
