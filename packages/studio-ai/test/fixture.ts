import type { ModelDesign } from "../src/contracts"

export function designFixture(): ModelDesign {
  return {
    name: "Mossling",
    texture_size: 64,
    bones: [
      {
        name: "root",
        parent: null,
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        cubes: [
          {
            name: "body",
            origin: [-2, 0, -2],
            size: [4, 8, 4],
            faces: {
              north: "#226633",
              east: "#336644",
              south: "#447755",
              west: "#558866",
              up: "#669977",
              down: "#114422",
            },
            surface_details: [],
          },
        ],
      },
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({
      name,
      length: 1,
      loop: name !== "hurt",
      channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }],
    })),
  }
}
