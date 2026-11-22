// Writes the hand-built specimens of the look gate as JSON. Run: bun test/fixtures/look/make.ts
// bad/lanjing-guard.json is real AI output and is not produced here; never regenerate or edit it.
import path from "node:path"
import { ModelDesignSchema } from "../../../src/contracts"
import { modelAtlas } from "../../../src/model-paint"

type Vec = [number, number, number]
type Paint = { material: string; base: string; secondary?: string }
type Extra = { paint?: Paint; features?: Record<string, unknown>[]; faces?: string | Record<string, string>; surface_details?: unknown[] }

const SIDES = ["north", "east", "south", "west", "up", "down"]
export const cube = (name: string, origin: Vec, size: Vec, extra: Extra = {}) => ({
  name,
  origin,
  size,
  faces: typeof extra.faces === "object" ? extra.faces : Object.fromEntries(SIDES.map((face) => [face, extra.faces ?? extra.paint?.base ?? "#808080"])),
  surface_details: extra.surface_details ?? [],
  ...(extra.paint ? { paint: extra.paint } : {}),
  ...(extra.features ? { features: extra.features } : {}),
})
export const bone = (name: string, parent: string | null, pivot: Vec, cubes: ReturnType<typeof cube>[], extra: { rotation?: Vec; paint?: Paint } = {}) => ({
  name,
  parent,
  pivot,
  rotation: extra.rotation ?? ([0, 0, 0] as Vec),
  ...(extra.paint ? { paint: extra.paint } : {}),
  cubes,
})
/** A swing around one axis sampled at nine points of a sine, so the limb slows down at both ends. */
export const swing = (name: string, axis: 0 | 1 | 2, amplitude: number, length: number, phase = 0, rest = 0) => ({
  bone: name,
  keyframes: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((step) => ({
    time: Number((step * length).toFixed(3)),
    rotation: [0, 1, 2].map((index) => (index === axis ? Number((rest + amplitude * Math.sin((step + phase) * Math.PI * 2)).toFixed(2)) : 0)) as Vec,
  })),
})
/** A quick knock and a slower return, for hurt. */
export const flinch = (name: string, rotation: Vec, length: number) => ({
  bone: name,
  keyframes: [
    { time: 0, rotation: [0, 0, 0] as Vec },
    { time: Number((length * 0.2).toFixed(3)), rotation },
    { time: Number((length * 0.5).toFixed(3)), rotation: rotation.map((value) => Number((value * -0.3).toFixed(2))) as Vec },
    { time: length, rotation: [0, 0, 0] as Vec },
  ],
})
export const animation = (name: string, length: number, loop: boolean, channels: unknown[]) => ({ name, length, loop, channels })

const STONE = { material: "stone", base: "#3E6285", secondary: "#4C5F6E" }
const CRYSTAL = { material: "crystal", base: "#3FB6CE", secondary: "#9ADBE8" }
const HORN = { material: "bone", base: "#C9DCE2" }
const PLATE = { material: "shell", base: "#42505C" }

const leg = (name: string, x: number, z: number) =>
  bone(name, "body", [x + 2, 7, z + 2], [
    cube("thigh", [x, 2, z], [4, 6, 4], { features: [{ type: "band", y: 0.95, size: 1, color: "#2B3A45" }] }),
    cube("foot", [x, 0, z - 1], [4, 2, 5], { paint: PLATE, features: [{ type: "claws", count: 3, size: 1, color: "#9ADBE8" }] }),
  ])

export const crystalGuardian = {
  name: "crystal-guardian",
  brief: "制作一只厚实的洞穴守卫模型：低伏四足躯干、宽头、两只短角、结实四肢和背部蓝晶甲片；配色以深蓝、石板灰和青色晶簇为主，含 idle、walk、hurt 动作。",
  model: {
    name: "蓝晶守卫",
    texture_size: 128,
    bones: [
      bone("root", null, [0, 0, 0], []),
      bone("body", "root", [0, 9, 0], [
        cube("torso", [-6, 6, -7], [12, 8, 15], {
          features: [{ type: "belly", color: "#4E6C80" }, { type: "veins", face: "sides", color: "#7FE3F2", count: 1 }, { type: "cracks", face: "up", count: 2 }],
        }),
        cube("shoulders", [-7, 11, -8], [14, 4, 7], { paint: PLATE, features: [{ type: "band", y: 1, size: 1, color: "#1D2830" }] }),
      ], { paint: STONE }),
      bone("head", "body", [0, 11, -8], [
        cube("skull", [-5, 8, -15], [10, 8, 7], {
          features: [
            { type: "eyes", shape: "square", size: 2, y: 0.36, x: 0.56, color: "#8FF0FF", glow: true },
            { type: "brows", shape: "angry", size: 2, y: 0.36, x: 0.56, color: "#18232B" },
            { type: "cracks", face: "up", count: 1 },
          ],
        }),
        cube("muzzle", [-4, 8, -17], [8, 4, 2], { paint: { material: "stone", base: "#46657F" }, features: [{ type: "nose", y: 0.2, size: 2, color: "#1D2830" }, { type: "mouth", shape: "fangs", y: 0.7, size: 6, color: "#18232B", color2: "#D5F4FA" }] }),
        cube("horn_left", [-6, 15, -13], [2, 4, 2], { paint: HORN }),
        cube("horn_right", [4, 15, -13], [2, 4, 2], { paint: HORN }),
      ]),
      leg("leg_front_left", -7, -7),
      leg("leg_front_right", 3, -7),
      leg("leg_hind_left", -7, 3),
      leg("leg_hind_right", 3, 3),
      bone("shard_mid", "body", [0, 14, 0], [cube("crystal", [-2, 14, -2], [4, 7, 4])], { rotation: [-12, 0, 0], paint: CRYSTAL }),
      bone("shard_left", "body", [-3, 14, 3], [cube("crystal", [-5, 14, 1], [3, 4, 3])], { rotation: [-6, 0, -16], paint: CRYSTAL }),
      bone("shard_right", "body", [3, 14, 3], [cube("crystal", [2, 14, 1], [3, 5, 3])], { rotation: [-6, 0, 16], paint: CRYSTAL }),
      bone("tail", "body", [0, 11, 8], [
        cube("base", [-2, 8, 8], [4, 4, 4]),
        cube("tip", [-1, 9, 12], [2, 3, 3], { paint: CRYSTAL }),
      ]),
    ],
    animations: [
      animation("idle", 3, true, [swing("body", 0, 1, 3), swing("head", 0, 2, 3, 0.15), swing("tail", 1, 5, 3, 0.3)]),
      animation("walk", 1, true, [
        swing("leg_front_left", 0, 24, 1),
        swing("leg_hind_right", 0, 24, 1, 0.05),
        swing("leg_front_right", 0, 24, 1, 0.5),
        swing("leg_hind_left", 0, 24, 1, 0.55),
        swing("body", 2, 1.5, 1, 0.25),
        swing("head", 0, 3, 1, 0.1),
        swing("tail", 1, 9, 1, 0.4),
      ]),
      animation("hurt", 0.5, false, [flinch("body", [-7, 0, 0], 0.5), flinch("head", [14, 0, -5], 0.5), flinch("tail", [0, 12, 0], 0.5)]),
    ],
  },
}


const GOBLIN_SKIN = { material: "skin", base: "#6FA143", secondary: "#5F9440" }
const TUNIC = { material: "cloth", base: "#7A4E2D", secondary: "#8A5C36" }
const WOOD = { material: "wood", base: "#8B6238" }

export const bogGoblin = {
  name: "bog-goblin",
  brief: "做一只沼泽哥布林：两足，大头尖耳，穿棕色布衣，手里拿一根木棒，黄眼睛、露出两颗牙。",
  model: {
    name: "沼泽哥布林",
    texture_size: 64,
    bones: [
      bone("root", null, [0, 0, 0], []),
      bone("body", "root", [0, 5, 0], [
        cube("torso", [-3, 5, -2], [6, 7, 4], { paint: TUNIC, features: [{ type: "band", y: 0.72, size: 1, color: "#2E2018" }, { type: "gem", face: "north", y: 0.72, size: 1, color: "#E2B84A" }, { type: "band", y: 1, size: 1, color: "#5A381F" }] }),
      ], { paint: GOBLIN_SKIN }),
      bone("head", "body", [0, 12, 0], [
        cube("skull", [-4, 12, -4], [8, 7, 7], {
          features: [
            { type: "eyes", shape: "square", size: 2, y: 0.45, x: 0.5, color: "#F4D84E", color2: "#1B1B24" },
            { type: "brows", shape: "angry", size: 2, y: 0.45, x: 0.5, color: "#3F6B26" },
            { type: "mouth", shape: "fangs", y: 0.75, size: 4, color: "#2F4F1D", color2: "#F3EFD9" },
            { type: "spots", face: "up", count: 3, size: 1 },
          ],
        }),
        cube("nose", [-1, 14, -6], [2, 2, 2], { paint: { material: "skin", base: "#5C8F3A" } }),
        cube("ear_left", [-7, 15, 0], [3, 3, 1], { features: [{ type: "belly", face: "north", color: "#C9828A", size: 1, y: 0.34 }] }),
        cube("ear_right", [4, 15, 0], [3, 3, 1], { features: [{ type: "belly", face: "north", color: "#C9828A", size: 1, y: 0.34 }] }),
      ]),
      bone("arm_left", "body", [-4, 11, 0], [cube("arm", [-5, 5, -1], [2, 7, 2], { features: [{ type: "band", y: 0.1, size: 2, color: "#7A4E2D" }] })]),
      bone("arm_right", "body", [4, 11, 0], [cube("arm", [3, 5, -1], [2, 7, 2], { features: [{ type: "band", y: 0.1, size: 2, color: "#7A4E2D" }] })]),
      bone("club", "arm_right", [4, 6, -1], [
        cube("handle", [4, 4, -2], [1, 8, 1], { paint: WOOD }),
        cube("knob", [3, 11, -3], [3, 4, 3], { paint: { material: "wood", base: "#6E4A28" }, features: [{ type: "band", y: 0.5, size: 1, color: "#8E9AA0" }] }),
      ], { rotation: [-18, 0, 0] }),
      bone("leg_left", "body", [-2, 5, 0], [cube("leg", [-3, 0, -1], [3, 5, 3], { features: [{ type: "band", y: 0.1, size: 1, color: "#5A381F" }, { type: "claws", count: 2, size: 1, color: "#E8E2C4" }] })]),
      bone("leg_right", "body", [2, 5, 0], [cube("leg", [0, 0, -1], [3, 5, 3], { features: [{ type: "band", y: 0.1, size: 1, color: "#5A381F" }, { type: "claws", count: 2, size: 1, color: "#E8E2C4" }] })]),
    ],
    animations: [
      animation("idle", 2.4, true, [swing("head", 2, 3, 2.4), swing("arm_left", 0, 3, 2.4, 0.2), swing("arm_right", 0, 3, 2.4, 0.7), swing("body", 0, 1, 2.4)]),
      animation("walk", 0.8, true, [
        swing("leg_left", 0, 28, 0.8),
        swing("leg_right", 0, 28, 0.8, 0.5),
        swing("arm_left", 0, 22, 0.8, 0.5),
        swing("arm_right", 0, 12, 0.8),
        swing("body", 1, 4, 0.8, 0.25),
        swing("head", 0, 2, 0.8, 0.1),
      ]),
      animation("hurt", 0.4, false, [flinch("body", [-10, 0, 0], 0.4), flinch("head", [16, 0, 6], 0.4), flinch("arm_left", [-30, 0, 0], 0.4)]),
      animation("attack", 0.6, false, [flinch("arm_right", [-95, 0, 0], 0.6), flinch("body", [8, -10, 0], 0.6)]),
    ],
  },
}

const PLUMAGE = { material: "feather", base: "#8A6846", secondary: "#95724E" }
const WING = { material: "feather", base: "#6A4D33", secondary: "#735439" }
const BEAK = { material: "bone", base: "#E3A53A" }

const owlWing = (name: string, x: number, pivotX: number, tilt: number) =>
  bone(name, "body", [pivotX, 9, 0], [
    cube("wing", [x, 3, -2], [1, 7, 5], { features: [{ type: "band", y: 1, size: 1, color: "#3F2D1D" }] }),
    cube("tip", [x, 1, 0], [1, 2, 4]),
  ], { rotation: [0, 0, tilt], paint: WING })

export const dawnOwl = {
  name: "dawn-owl",
  brief: "做一只晨枭：会飞的小猫头鹰，圆头大黄眼，胸口浅色，翅膀收在身侧，橙色的喙和爪。",
  model: {
    name: "晨枭",
    texture_size: 64,
    bones: [
      bone("root", null, [0, 0, 0], []),
      bone("body", "root", [0, 3, 0], [
        cube("torso", [-3, 2, -3], [6, 8, 6], { features: [{ type: "belly", face: "north", color: "#E3D2AE", y: 0.18 }, { type: "spots", face: "north", count: 4, size: 1, color: "#8A6846" }] }),
        cube("tail", [-2, 3, 3], [4, 2, 3], { paint: WING }),
      ], { paint: PLUMAGE }),
      bone("head", "body", [0, 10, 0], [
        cube("skull", [-4, 10, -4], [8, 6, 7], {
          features: [
            { type: "belly", face: "north", color: "#D9C39B", size: 1, y: 0.1 },
            { type: "eyes", shape: "square", size: 2, y: 0.5, x: 0.52, color: "#F7C948", color2: "#1B1B24" },
            { type: "brows", shape: "angry", size: 2, y: 0.5, x: 0.52, color: "#5A4029" },
          ],
        }),
        cube("beak", [-1, 11, -5], [2, 2, 1], { paint: BEAK }),
        cube("tuft_left", [-4, 16, -3], [1, 2, 2], { paint: WING }),
        cube("tuft_right", [3, 16, -3], [1, 2, 2], { paint: WING }),
      ]),
      owlWing("wing_left", -4, -3, -6),
      owlWing("wing_right", 3, 3, 6),
      bone("foot_left", "body", [-2, 2, 0], [cube("foot", [-3, 0, -2], [2, 2, 3], { paint: BEAK, features: [{ type: "claws", count: 2, size: 1, color: "#3A2A1C" }] })]),
      bone("foot_right", "body", [2, 2, 0], [cube("foot", [1, 0, -2], [2, 2, 3], { paint: BEAK, features: [{ type: "claws", count: 2, size: 1, color: "#3A2A1C" }] })]),
    ],
    animations: [
      animation("idle", 3, true, [swing("head", 1, 8, 3), swing("wing_left", 2, 2, 3, 0.2), swing("wing_right", 2, 2, 3, 0.7), swing("body", 0, 1.5, 3)]),
      animation("walk", 0.6, true, [swing("foot_left", 0, 22, 0.6), swing("foot_right", 0, 22, 0.6, 0.5), swing("body", 2, 4, 0.6, 0.25), swing("head", 2, 3, 0.6, 0.75)]),
      animation("hurt", 0.4, false, [flinch("body", [-12, 0, 0], 0.4), flinch("head", [14, 0, 8], 0.4), flinch("wing_left", [0, 0, -40], 0.4), flinch("wing_right", [0, 0, 40], 0.4)]),
      animation("fly", 0.5, true, [swing("wing_left", 2, 50, 0.5, 0), swing("wing_right", 2, 50, 0.5, 0.5), swing("body", 0, 4, 0.5, 0.25)]),
    ],
  },
}

const SLIME = { material: "slime", base: "#62B95E", secondary: "#74C96C" }
const LEAF = { material: "leaf", base: "#3F8F3A", secondary: "#58A84A" }

export const sproutSlime = {
  name: "sprout-slime",
  brief: "做一只发芽史莱姆：一团绿色果冻，头顶长着两片嫩叶，黑眼睛，笑着。",
  model: {
    name: "发芽史莱姆",
    texture_size: 64,
    bones: [
      bone("root", null, [0, 0, 0], []),
      bone("body", "root", [0, 0, 0], [
        cube("jelly", [-6, 0, -6], [12, 9, 12], {
          features: [
            { type: "eyes", shape: "tall", size: 3, y: 0.42, x: 0.5, color: "#16301A", color2: "#EAF7E4" },
            { type: "mouth", shape: "smile", y: 0.72, size: 4, color: "#16301A" },
            { type: "spots", face: "up", count: 3, size: 2, color: "#8BD982" },
          ],
        }),
        cube("crown", [-4, 9, -4], [8, 2, 8]),
      ], { paint: SLIME }),
      bone("sprout", "body", [0, 11, 0], [cube("stem", [-1, 11, -1], [2, 3, 2])], { paint: LEAF }),
      bone("leaf_left", "sprout", [-1, 14, 0], [cube("leaf", [-5, 13, -1], [4, 1, 2])], { rotation: [0, 0, -24], paint: LEAF }),
      bone("leaf_right", "sprout", [1, 14, 0], [cube("leaf", [1, 13, -1], [4, 1, 2])], { rotation: [0, 0, 24], paint: LEAF }),
    ],
    animations: [
      animation("idle", 2, true, [swing("body", 2, 2, 2), swing("sprout", 2, 6, 2, 0.3), swing("leaf_left", 2, 5, 2, 0.1), swing("leaf_right", 2, 5, 2, 0.6)]),
      // It stands on its whole underside, so it inches: pressed down it pushes itself back along the ground, then it hops forward clear of it.
      // (Rocking on the spot while the game carries it forward is the gate's fault `glide`, motion-continuity.ts.)
      animation("walk", 0.7, true, [
        {
          bone: "body",
          keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.7, rotation: [0, 0, 0] }],
          position: [{ time: 0, position: [0, 0, -1.5] }, { time: 0.4, position: [0, 0, 1.5] }, { time: 0.55, position: [0, 3, 0] }, { time: 0.7, position: [0, 0, -1.5] }],
          scale: [{ time: 0, scale: [1, 1, 1] }, { time: 0.4, scale: [1.08, 0.85, 1.08] }, { time: 0.55, scale: [0.94, 1.12, 0.94] }, { time: 0.7, scale: [1, 1, 1] }],
        },
        swing("sprout", 0, 12, 0.7, 0.3),
        swing("leaf_left", 2, 10, 0.7, 0.2),
        swing("leaf_right", 2, 10, 0.7, 0.7),
      ]),
      animation("hurt", 0.35, false, [flinch("body", [0, 0, 9], 0.35), flinch("sprout", [0, 0, -20], 0.35)]),
    ],
  },
}

const SAND = { material: "scales", base: "#C8A04C", secondary: "#B58B3E" }
const stripe = { type: "stripes", color: "#8A6230" }
const underside = { type: "belly", color: "#EBDCA9" }
const segment = (name: string, parent: string, z: number, turn: number, body: ReturnType<typeof cube>[]) => bone(name, parent, [0, 2, z], body, { rotation: [0, turn, 0] })

export const duneViper = {
  name: "dune-viper",
  brief: "做一条沙丘蝰蛇：贴地的长身子弯成 S 形，沙黄色鳞片带深色横纹，浅色肚皮，橙红色的眼睛长在头两侧，尾巴末端有骨质响环。",
  model: {
    name: "沙丘蝰蛇",
    texture_size: 64,
    bones: [
      bone("root", null, [0, 0, 0], [], { paint: SAND }),
      segment("body_mid", "root", 0, 0, [cube("coil", [-3, 0, -3], [6, 5, 6], { features: [stripe, underside] })]),
      segment("body_front", "body_mid", -3, 22, [cube("coil", [-3, 0, -9], [6, 4, 6], { features: [stripe, underside] })]),
      segment("neck", "body_front", -9, -30, [cube("coil", [-2, 0, -14], [4, 4, 5], { features: [stripe, underside] })]),
      bone("head", "neck", [0, 2, -14], [
        cube("skull", [-3, 1, -20], [6, 4, 6], {
          features: [
            { type: "eyes", face: "sides", shape: "wide", size: 2, x: 0.34, y: 0.36, color: "#F0642C", color2: "#1B1B24" },
            { type: "stripes", shape: "long", face: "up", size: 2, color: "#8A6230" },
            underside,
          ],
        }),
        cube("snout", [-2, 1, -23], [4, 3, 3], { features: [{ type: "mouth", y: 0.8, size: 4, color: "#7A5528" }, underside] }),
        cube("tongue", [-1, 1, -25], [2, 1, 2], { paint: { material: "skin", base: "#C8323A" } }),
      ], { rotation: [-14, 12, 0] }),
      segment("body_back", "body_mid", 3, -22, [cube("coil", [-3, 0, 3], [6, 4, 6], { features: [stripe, underside] })]),
      segment("tail", "body_back", 9, 30, [cube("coil", [-2, 0, 9], [4, 3, 6], { features: [stripe, underside] })]),
      segment("tail_tip", "tail", 15, 24, [
        cube("coil", [-1, 0, 15], [2, 2, 5], { features: [underside] }),
        cube("rattle", [-1, 0, 20], [2, 3, 3], { paint: { material: "bone", base: "#E6DCC0" }, features: [{ type: "stripes", count: 2, size: 1, color: "#A3946E" }] }),
      ]),
    ],
    animations: [
      animation("idle", 3, true, [swing("head", 1, 6, 3, 0), swing("neck", 0, 3, 3, 0.2), swing("tail_tip", 1, 8, 3, 0.5)]),
      animation("walk", 1, true, [
        swing("body_front", 1, 14, 1, 0),
        swing("neck", 1, 14, 1, 0.25),
        swing("head", 1, 8, 1, 0.5),
        swing("body_back", 1, 14, 1, 0.5),
        swing("tail", 1, 16, 1, 0.75),
        swing("tail_tip", 1, 18, 1, 0),
      ]),
      animation("hurt", 0.4, false, [flinch("head", [-20, 0, 0], 0.4), flinch("neck", [-12, 10, 0], 0.4), flinch("tail_tip", [0, 30, 0], 0.4)]),
    ],
  },
}


// ---- Rejected specimens. Each stands for one family of failure and must stay rejected for that reason. ----

type Model = typeof crystalGuardian.model
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)

/** A standalone texture for a model, filled island by island by `fill`; the gutter keeps palette entry 0. */
function texture(model: Model, palette: string[], fill: (u: number, v: number, island: { bone: string; cube: string; face: string }) => number) {
  const size = model.texture_size
  const pixels = Array.from({ length: size * size }, () => 0)
  modelAtlas(ModelDesignSchema.parse(model)).forEach((island) => {
    for (let v = 0; v < island.height; v++) for (let u = 0; u < island.width; u++) pixels[(island.y + v) * size + island.x + u] = fill(u, v, island)
  })
  return { width: size, height: size, palette, pixels }
}

const noise = lcg(20261005)
export const noiseTexture = {
  name: "noise-texture",
  brief: crystalGuardian.brief,
  why: "A texture that picks a palette colour per pixel at random: reads as static on the model.",
  model: crystalGuardian.model,
  texture: texture(crystalGuardian.model, ["#1B2B3A", "#35536F", "#4C7396", "#3FB6CE", "#9ADBE8", "#C9DCE2"], () => 1 + Math.floor(noise() * 5)),
}

export const onePattern = {
  name: "one-pattern",
  brief: dawnOwl.brief,
  why: "Tidy two-pixel bands, but the very same bands on every face of every part: no face, no parts, no light.",
  model: dawnOwl.model,
  texture: texture(dawnOwl.model, ["#3F2D1D", "#6A4D33", "#8A6846", "#A07C56", "#D9C39B", "#E3A53A"], (_, v) => 1 + (Math.floor(v / 2) % 5)),
}

const pebble = lcg(7)
export const paddedPile = {
  name: "padded-pile",
  brief: crystalGuardian.brief,
  why: "The good guardian with cubes added only to raise the count: blocks buried in the torso and one-pixel crumbs.",
  model: {
    ...copy(crystalGuardian.model),
    bones: copy(crystalGuardian.model.bones).map((value) =>
      value.name !== "body"
        ? value
        : {
            ...value,
            cubes: [
              ...value.cubes,
              ...Array.from({ length: 8 }, (_, index) => cube(`core_${index}`, [-5 + (index % 2) * 5, 7 + (Math.floor(index / 2) % 2) * 3, -6 + Math.floor(index / 4) * 7], [5, 3, 6])),
              ...Array.from({ length: 10 }, (_, index) => cube(`crumb_${index}`, [index % 2 === 0 ? -7 : 6, 7 + Math.floor(pebble() * 6), -6 + Math.floor(pebble() * 12)], [1, 1, 1])),
            ],
          },
    ),
  },
}

const flat = (name: string) => (name === "torso" ? "#7A4E2D" : name === "handle" || name === "knob" ? "#8B6238" : "#6FA143")
export const facelessFlat = {
  name: "faceless-flat",
  brief: bogGoblin.brief,
  why: "Right shape, nothing on it: every cube one flat colour on all six faces, and no face at all.",
  model: {
    ...copy(bogGoblin.model),
    bones: copy(bogGoblin.model.bones).map((value) => ({ name: value.name, parent: value.parent, pivot: value.pivot, rotation: value.rotation, cubes: value.cubes.map((part) => cube(part.name, part.origin, part.size, { faces: flat(part.name) })) })),
  },
}

const shift = (part: ReturnType<typeof cube>, by: Vec) => ({ ...part, origin: part.origin.map((value, axis) => value + by[axis]!) as Vec })
export const floatingParts = {
  name: "floating-parts",
  brief: dawnOwl.brief,
  why: "Well painted, but the wings hang beside the body and the ear tufts hover above the head.",
  model: {
    ...copy(dawnOwl.model),
    bones: copy(dawnOwl.model.bones).map((value) => ({
      ...value,
      cubes: value.cubes.map((part) => (value.name === "wing_left" ? shift(part, [-3, 0, 0]) : value.name === "wing_right" ? shift(part, [3, 0, 0]) : part.name.startsWith("tuft") ? shift(part, [0, 2, 0]) : part)),
    })),
  },
}

const two = (name: string, rotation: Vec, length: number) => ({ bone: name, keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: length / 2, rotation }, { time: length, rotation: [0, 0, 0] as Vec }] })
export const stiffWalker = {
  name: "stiff-walker",
  brief: bogGoblin.brief,
  why: "The good goblin with lifeless motion: both legs swing together at one speed, nothing else moves, idle is frozen, hurt drags on.",
  model: {
    ...copy(bogGoblin.model),
    animations: [
      animation("idle", 2, true, [two("head", [0, 0, 0], 2)]),
      animation("walk", 1, true, [two("leg_left", [30, 0, 0], 1), two("leg_right", [30, 0, 0], 1)]),
      animation("hurt", 2.5, false, [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 2, rotation: [-10, 0, 0] }, { time: 2.5, rotation: [0, 0, 0] }] }]),
    ],
  },
}

if (import.meta.main) {
  const good = [crystalGuardian, bogGoblin, dawnOwl, sproutSlime, duneViper]
  await Promise.all(good.map((value) => Bun.write(path.join(import.meta.dir, "good", `${value.name}.json`), `${JSON.stringify(value)}\n`)))
  const bad = [noiseTexture, onePattern, paddedPile, facelessFlat, floatingParts, stiffWalker]
  await Promise.all(bad.map((value) => Bun.write(path.join(import.meta.dir, "bad", `${value.name}.json`), `${JSON.stringify(value)}\n`)))
  console.log([...good, ...bad].map((value) => value.name).join(" "))
}
