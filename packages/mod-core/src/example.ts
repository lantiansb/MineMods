import { ModelDesignSchema } from "@minemods/studio-ai/contracts"

const faces = (color: string, top = color) => ({
  north: color,
  east: color,
  south: color,
  west: color,
  up: top,
  down: color,
})

// Hand-authored example, always recorded with origin "example" by the application.
export const mushroomCowDesign = ModelDesignSchema.parse({
  name: "苔原蘑菇牛",
  texture_size: 256,
  bones: [
    {
      name: "body",
      parent: null,
      pivot: [0, 11, 0],
      rotation: [0, 0, 0],
      cubes: [
        { name: "torso", origin: [-5, 8, -7], size: [10, 7, 14], faces: faces("#a89876", "#8c9765") },
        { name: "shoulders", origin: [-5, 10, -6], size: [10, 6, 5], faces: faces("#bdad88", "#acb97c") },
        { name: "patch_left", origin: [5, 10, -3], size: [1, 3, 4], faces: faces("#66794a") },
        { name: "patch_right", origin: [-6, 11, 1], size: [1, 3, 4], faces: faces("#66794a") },
        { name: "mushroom_stem_a", origin: [-3, 15, -2], size: [2, 4, 2], faces: faces("#e8d8b2") },
        { name: "mushroom_cap_a", origin: [-5, 19, -4], size: [6, 2, 6], faces: faces("#b86646", "#d48154") },
        { name: "mushroom_spot_a", origin: [-4, 21, -3], size: [2, 1, 2], faces: faces("#eddbaf") },
        { name: "mushroom_spot_b", origin: [-1, 21, 0], size: [1, 1, 1], faces: faces("#eddbaf") },
        { name: "mushroom_stem_b", origin: [2, 15, 3], size: [2, 3, 2], faces: faces("#e8d8b2") },
        { name: "mushroom_cap_b", origin: [0, 18, 1], size: [6, 2, 6], faces: faces("#b86646", "#d48154") },
        { name: "mushroom_spot_c", origin: [2, 20, 2], size: [2, 1, 2], faces: faces("#eddbaf") },
      ],
    },
    {
      name: "head",
      parent: "body",
      pivot: [0, 13, -6],
      rotation: [0, 0, 0],
      cubes: [
        { name: "skull", origin: [-4, 10, -13], size: [8, 7, 6], faces: faces("#c9b994", "#d4c6a5") },
        { name: "muzzle", origin: [-3, 9, -15], size: [6, 3, 3], faces: faces("#8b715b", "#a18a6d") },
        { name: "eye_left", origin: [3, 14, -14], size: [1, 1, 1], faces: faces("#292d27") },
        { name: "eye_right", origin: [-4, 14, -14], size: [1, 1, 1], faces: faces("#292d27") },
        { name: "ear_left", origin: [4, 14, -11], size: [3, 2, 3], faces: faces("#a89272", "#c4b490") },
        { name: "ear_right", origin: [-7, 14, -11], size: [3, 2, 3], faces: faces("#a89272", "#c4b490") },
        { name: "horn_left", origin: [2, 17, -10], size: [2, 3, 2], faces: faces("#ede0be") },
        { name: "horn_right", origin: [-4, 17, -10], size: [2, 3, 2], faces: faces("#ede0be") },
      ],
    },
    ...[
      [3, -5],
      [-3, -5],
      [3, 5],
      [-3, 5],
    ].map(([x, z], index) => ({
      name: `leg_${index}`,
      parent: "body",
      pivot: [x, 9, z],
      rotation: [0, 0, 0],
      cubes: [
        { name: "leg", origin: [x - 1, 1, z - 1], size: [2, 8, 2], faces: faces("#ac9b78") },
        { name: "hoof", origin: [x - 2, 0, z - 2], size: [4, 2, 4], faces: faces("#4b5041") },
      ],
    })),
    {
      name: "tail",
      parent: "body",
      pivot: [0, 12, 7],
      rotation: [0, 0, 0],
      cubes: [
        { name: "tail", origin: [-1, 5, 7], size: [2, 8, 2], faces: faces("#998764") },
        { name: "tail_tip", origin: [-2, 4, 7], size: [4, 3, 3], faces: faces("#586043") },
      ],
    },
  ],
  animations: [
    {
      name: "idle",
      length: 3,
      loop: true,
      channels: [
        {
          bone: "head",
          keyframes: [
            { time: 0, rotation: [0, -3, 0] },
            { time: 1.5, rotation: [2, 3, 0] },
            { time: 3, rotation: [0, -3, 0] },
          ],
        },
        {
          bone: "tail",
          keyframes: [
            { time: 0, rotation: [0, 0, -8] },
            { time: 1.5, rotation: [0, 0, 8] },
            { time: 3, rotation: [0, 0, -8] },
          ],
        },
      ],
    },
    {
      name: "walk",
      length: 1,
      loop: true,
      channels: [0, 1, 2, 3].map((index) => ({
        bone: `leg_${index}`,
        keyframes: [
          { time: 0, rotation: [index === 0 || index === 3 ? 22 : -22, 0, 0] },
          { time: 0.5, rotation: [index === 0 || index === 3 ? -22 : 22, 0, 0] },
          { time: 1, rotation: [index === 0 || index === 3 ? 22 : -22, 0, 0] },
        ],
      })),
    },
    {
      name: "hurt",
      length: 0.5,
      loop: false,
      channels: [
        {
          bone: "body",
          keyframes: [
            { time: 0, rotation: [0, 0, 0] },
            { time: 0.15, rotation: [-8, 0, 5] },
            { time: 0.5, rotation: [0, 0, 0] },
          ],
        },
      ],
    },
  ],
})
