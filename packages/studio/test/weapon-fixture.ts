import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"

export const WEAPON_MODEL_ID = "d1ac764a-3a50-4c79-823e-b20b1d3e3d40"
export const WEAPON_ITEM_ID = "b8cc5f79-08c0-4b63-92ee-a7fd37140d03"

/** One original static weapon used across annotation, editing, held views and resource export checks. */
export function weaponFixture(): ModelDesign {
  const cube = (name: string, origin: [number, number, number], size: [number, number, number], color: string) => ({
    name, origin, size,
    faces: { north: color, south: color, east: color, west: color, up: color, down: color },
    surface_details: [],
  })
  const bone = (name: string, cubes: ReturnType<typeof cube>[]) => ({ name, parent: name === "root" ? null : "root", pivot: [0, 0, 0], rotation: [0, 0, 0], cubes })
  return ModelDesignSchema.parse({
    name: "铜齿电锯剑", texture_size: 128,
    bones: [
      bone("root", [cube("grip", [-1, 0, -1], [2, 6, 2], "#49392e"), cube("pommel", [-2, 0, -2], [4, 1, 4], "#bd8545")]),
      bone("motor", [cube("housing", [-3, 5, -2], [6, 5, 4], "#826143"), cube("cap", [-2, 6, -3], [4, 3, 1], "#244b51"), cube("vent_a", [-1, 6, -4], [1, 1, 1], "#dda35c"), cube("vent_b", [1, 7, -4], [1, 1, 1], "#dda35c")]),
      bone("guard", [cube("crossguard", [-5, 9, -2], [10, 1, 4], "#d9a04f"), cube("rear_bar", [4, 2, -1], [1, 7, 2], "#a37a48"), cube("grip_bar", [1, 2, -1], [3, 1, 2], "#a37a48")]),
      bone("blade", [cube("core", [-2, 10, -1], [4, 16, 2], "#28555e"), cube("front_rib", [-1, 11, -2], [2, 14, 1], "#437681")]),
      bone("frame", [cube("left_rail", [-3, 10, -1], [1, 17, 2], "#d9a04f"), cube("right_rail", [2, 10, -1], [1, 17, 2], "#d9a04f"), cube("tip", [-2, 26, -1], [4, 1, 2], "#e8b567")]),
      bone("teeth", Array.from({ length: 7 }, (_, index) => [cube(`left_${index}`, [-4, 11 + index * 2, -1], [1, 1, 2], "#ddd5bd"), cube(`right_${index}`, [3, 11 + index * 2, -1], [1, 1, 2], "#ddd5bd")]).flat()),
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })),
  })
}
