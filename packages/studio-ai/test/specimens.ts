import { ModelDesignSchema, type ModelDesign } from "../src/contracts"
import type { LookTexture } from "../src/model-look"
import { paintModel } from "../src/model-paint"
import guardian from "./fixtures/look/good/crystal-guardian.json"
import slime from "./fixtures/look/good/sprout-slime.json"
import viper from "./fixtures/look/good/dune-viper.json"

// Small specimens made by spoiling one thing in an accepted one. Each is evidence for the rules it names
// and for nothing else: a rule with no specimen of its own under fixtures/ has one here. They are not the
// standard, and no rule may be written to fit one of them.
type Vec = [number, number, number]
type Cube = ModelDesign["bones"][number]["cubes"][number]
export type Spoiled = {
  name: string
  /** What was done to the accepted specimen, in a few words. */
  why: string
  /** Every rule it breaks, and no other. */
  rules: string[]
  brief?: string
  complexity?: "low" | "medium" | "high"
  model: ModelDesign
  /** A hand-drawn texture judged on the model instead of the model's own paint. */
  texture?: LookTexture
}

const BASES = { guardian: guardian.model, slime: slime.model, viper: viper.model }
const made = (base: keyof typeof BASES, change: (value: ModelDesign) => void) => {
  const value = ModelDesignSchema.parse(structuredClone(BASES[base]))
  change(value)
  return value
}
const bone = (value: ModelDesign, name: string) => value.bones.find((entry) => entry.name === name)!
const walk = (value: ModelDesign) => value.animations.find((animation) => animation.name === "walk")!
const named = (value: ModelDesign, name: string) => value.animations.find((animation) => animation.name === name)!
const pose = (rotation: Vec, length: number) => [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: length / 2, rotation }, { time: length, rotation: [0, 0, 0] as Vec }]
const plain = (name: string, origin: Vec, size: Vec, color: string): Cube => ({ name, origin, size, faces: { north: color, east: color, south: color, west: color, up: color, down: color }, surface_details: [] })

/**
 * A head with nothing on it: every cube of the head and of what hangs on it one flat colour, no features, no details, no horns (a horn the colour of the head is another rule's finding).
 * A bone's paint is worn by the cubes below it, so each cube outside the head keeps the paint it wore, written on itself, before the bones are cleared. Changes `value` and returns it.
 */
export function bareHead(value: ModelDesign, color = "#3E6285") {
  const parentOf = (name: string | null) => value.bones.find((bone) => bone.name === name)
  const under = (name: string | null): boolean => name !== null && (name === "head" || under(parentOf(name)?.parent ?? null))
  const worn = (name: string | null): ModelDesign["bones"][number]["paint"] => (name === null ? undefined : (parentOf(name)?.paint ?? worn(parentOf(name)?.parent ?? null)))
  value.bones.forEach(
    (bone) =>
      (bone.cubes = bone.cubes
        .filter((part) => !(under(bone.name) && /horn/.test(part.name)))
        .map((part) => (under(bone.name) ? { ...plain(part.name, part.origin, part.size, color), paint: null, features: null } : { ...part, paint: part.paint ?? worn(bone.name) ?? null }))),
  )
  value.bones.forEach((bone) => (bone.paint = undefined))
  return value
}

/** A model's own painted atlas read back as a palette texture: the same look by another road. */
export function repainted(design: ModelDesign, recolor: (color: string, index: number, size: number) => string = (color) => color): LookTexture {
  const painted = paintModel(design)
  const colors = Array.from({ length: painted.size * painted.size }, (_, index) => recolor(`#${[0, 1, 2].map((channel) => painted.pixels[index * 4 + channel]!.toString(16).padStart(2, "0")).join("")}`, index, painted.size))
  const palette = [...new Set(colors)]
  return { width: painted.size, height: painted.size, palette, pixels: colors.map((color) => palette.indexOf(color)) }
}

const headless = made("guardian", (value) => {
  value.bones.forEach((entry) => {
    if (entry.name === "head") entry.name = "front"
    if (entry.parent === "head") entry.parent = "front"
    entry.cubes.forEach((part) => (part.name = part.name === "skull" ? "block" : part.name))
  })
  value.animations.forEach((animation) => animation.channels.forEach((channel) => (channel.bone = channel.bone === "head" ? "front" : channel.bone)))
})

export const SPOILED: Spoiled[] = [
  {
    name: "one-lump",
    why: "只剩一个方块",
    rules: ["too_few_parts"],
    complexity: "low",
    model: made("slime", (value) => {
      value.bones = value.bones.slice(0, 2)
      value.bones[1]!.cubes = value.bones[1]!.cubes.slice(0, 1)
      value.animations.forEach((animation) => (animation.channels = animation.channels.filter((channel) => channel.bone === "body")))
    }),
  },
  {
    name: "lifted-guardian",
    why: "整只抬高了五格",
    rules: ["off_ground"],
    model: made("guardian", (value) =>
      value.bones.forEach((entry) => {
        entry.pivot[1] += 5
        entry.cubes.forEach((part) => (part.origin[1] += 5))
      }),
    ),
  },
  {
    name: "short-leg",
    why: "一条前腿短了一截，够不着地",
    rules: ["hanging_limbs"],
    model: made("guardian", (value) => {
      bone(value, "leg_front_left").cubes = bone(value, "leg_front_left").cubes.filter((part) => part.name !== "foot")
      bone(value, "leg_front_left").cubes[0]!.origin[1] += 2
      bone(value, "leg_front_left").cubes[0]!.size[1] -= 2
    }),
  },
  {
    name: "one-sided",
    why: "右边的腿都没了，身上多长出一大块",
    rules: ["lopsided"],
    model: made("guardian", (value) => {
      value.bones = value.bones.filter((entry) => !entry.name.endsWith("_right"))
      value.animations.forEach((animation) => (animation.channels = animation.channels.filter((channel) => !channel.bone.endsWith("_right"))))
      bone(value, "body").cubes.push({ ...plain("growth", [6, 6, -7], [10, 8, 15], "#3E6285"), paint: { material: "stone", base: "#3E6285" } })
    }),
  },
  {
    name: "pin-head",
    why: "头缩成了一小粒",
    rules: ["head_out_of_scale"],
    model: made("guardian", (value) => {
      const head = bone(value, "head")
      head.cubes = head.cubes.filter((part) => part.name === "skull")
      head.cubes[0]!.origin = [-2, 9, -11]
      head.cubes[0]!.size = [4, 4, 3]
    }),
  },
  {
    name: "stub-legs",
    why: "腿只剩一格高",
    rules: ["legs_out_of_scale"],
    model: made("guardian", (value) => {
      value.bones.forEach((entry) => {
        const leg = entry.name.startsWith("leg_")
        entry.pivot[1] -= leg ? 6 : 5
        entry.cubes = entry.cubes.filter((part) => part.name !== "thigh")
        entry.cubes.forEach((part) => {
          part.origin[1] -= leg ? 0 : 5
          part.size[1] = leg ? 1 : part.size[1]
        })
      })
    }),
  },
  {
    name: "loose-joint",
    why: "尾巴的关节放到了很远的地方",
    rules: ["misplaced_joint"],
    model: made("guardian", (value) => (bone(value, "tail").pivot = [0, 30, 30])),
  },
  {
    name: "bare-blocks",
    why: "材质和五官全去掉，每个面同一个颜色",
    rules: ["same_fill", "few_tones", "flat_surfaces", "unshaded", "accents_blend_in", "no_face"],
    model: made("guardian", (value) =>
      value.bones.forEach((entry) => {
        entry.paint = undefined
        entry.cubes = entry.cubes.map((part) => plain(part.name, part.origin, part.size, "#3E6285"))
      }),
    ),
  },
  {
    name: "speckled-guardian",
    why: "每个方块上撒满互不相连的杂点",
    rules: ["noisy_texture"],
    model: made("guardian", (value) =>
      value.bones.forEach((entry) =>
        entry.cubes.forEach((part) => {
          const spots = (["north", "south", "east", "west", "up", "down"] as const).flatMap((face) => {
            const [width, height] = face === "up" || face === "down" ? [part.size[0], part.size[2]] : face === "north" || face === "south" ? [part.size[0], part.size[1]] : [part.size[2], part.size[1]]
            return Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) })).filter((spot) => spot.x % 2 === 0 && spot.y % 2 === 0).map((spot) => ({ face, x: spot.x, y: spot.y, width: 1, height: 1, color: (spot.x + spot.y) % 4 === 0 ? "#F2E9C8" : "#1B1420" }))
          })
          // A document holds at most 64 details on one cube: spread them evenly over its faces.
          part.surface_details = spots.filter((_, index) => index % Math.ceil(spots.length / 64) === 0).slice(0, 64)
        }),
      ),
    ),
  },
  {
    name: "stone-horns",
    why: "角、晶体和尾尖都换成了身体的材质和颜色",
    rules: ["accents_blend_in"],
    model: made("guardian", (value) =>
      value.bones.forEach((entry) => {
        if (entry.name.startsWith("shard_")) entry.paint = { material: "stone", base: "#3E6285", secondary: "#4C5F6E" }
        entry.cubes.forEach((part) => {
          if (part.name.startsWith("horn_")) part.paint = { material: "stone", base: "#3E6285", secondary: "#4C5F6E" }
        })
      }),
    ),
  },
  { name: "nameless-head", why: "头部骨骼和头骨改了名字，找不到头", rules: ["no_head"], model: headless },
  {
    name: "twin-horn",
    why: "同一只角做了两遍",
    rules: ["duplicates"],
    model: made("guardian", (value) => bone(value, "head").cubes.push({ ...structuredClone(bone(value, "head").cubes.find((part) => part.name === "horn_left")!), name: "horn_left_again" })),
  },
  {
    name: "covered-marks",
    why: "细节画在贴着身体、谁也看不见的那一面",
    rules: ["invisible_details"],
    model: made("guardian", (value) => {
      bone(value, "head").cubes[0]!.surface_details = [0, 2, 4, 6].map((x) => ({ face: "south" as const, x: x + 1, y: 1, width: 1, height: 2, color: "#F2E9C8" }))
    }),
  },
  {
    name: "statue",
    why: "三个动作里所有关键帧都一样",
    rules: ["nothing_moves", "walk_legs_still", "walk_body_frozen"],
    model: made("guardian", (value) => value.animations.forEach((animation) => animation.channels.forEach((channel) => channel.keyframes.forEach((frame) => (frame.rotation = [0, 0, 0]))))),
  },
  {
    name: "still-legs",
    why: "走路时一条后腿不动",
    rules: ["walk_legs_still"],
    model: made("guardian", (value) => (walk(value).channels = walk(value).channels.filter((channel) => channel.bone !== "leg_hind_left"))),
  },
  {
    name: "still-slider",
    why: "没有腿的生物走路时一点不动",
    rules: ["walk_legs_still"],
    model: made("viper", (value) => walk(value).channels.forEach((channel) => channel.keyframes.forEach((frame) => (frame.rotation = [0, 0, 0])))),
  },
  {
    name: "hopping-pair",
    why: "两条前腿一起往同一个方向摆",
    rules: ["walk_same_phase"],
    model: made("guardian", (value) => (walk(value).channels.find((channel) => channel.bone === "leg_front_right")!.keyframes = structuredClone(walk(value).channels.find((channel) => channel.bone === "leg_front_left")!.keyframes))),
  },
  {
    name: "robot-legs",
    why: "腿只剩匀速的几个关键帧",
    rules: ["constant_speed"],
    model: made("guardian", (value) => walk(value).channels.filter((channel) => channel.bone.startsWith("leg_")).forEach((channel) => (channel.keyframes = channel.keyframes.filter((_, index) => index % 2 === 0)))),
  },
  {
    name: "legs-only-walk",
    why: "走路时只有腿在动",
    rules: ["walk_body_frozen"],
    model: made("guardian", (value) => (walk(value).channels = walk(value).channels.filter((channel) => channel.bone.startsWith("leg_")))),
  },
  { name: "frozen-idle", why: "待机一动不动", rules: ["idle_still"], model: made("guardian", (value) => (named(value, "idle").channels = [{ bone: "body", keyframes: pose([0, 0, 0], 3) }])) },
  { name: "thrashing-idle", why: "待机时头来回甩六十度", rules: ["idle_wild"], model: made("guardian", (value) => (named(value, "idle").channels = [{ bone: "head", keyframes: pose([60, 0, 0], 3) }])) },
  { name: "numb-hurt", why: "受伤只动了一度", rules: ["hurt_still"], model: made("guardian", (value) => (named(value, "hurt").channels = [{ bone: "body", keyframes: pose([-1, 0, 0], 0.5) }])) },
  {
    name: "slow-hurt",
    why: "受伤拖了三秒",
    rules: ["hurt_slow"],
    model: made("guardian", (value) => {
      named(value, "hurt").length = 3
      named(value, "hurt").channels = [{ bone: "body", keyframes: pose([-10, 0, 0], 3) }]
    }),
  },
  // Hand-drawn textures, judged on an accepted model.
  {
    name: "whitewash（贴图）",
    why: "整张贴图刷成一个颜色",
    rules: ["same_fill", "few_tones", "flat_surfaces", "unshaded", "accents_blend_in", "no_face"],
    model: made("guardian", () => undefined),
    texture: repainted(ModelDesignSchema.parse(guardian.model), () => "#3e6285"),
  },
  { name: "nameless-head（贴图）", why: "贴图画得好，但它穿的模型找不到头", rules: ["no_head"], model: headless, texture: repainted(headless) },
  {
    name: "half-size（贴图）",
    why: "贴图只有模型贴图空间的一半大",
    rules: ["wrong_size"],
    model: made("guardian", () => undefined),
    texture: { width: guardian.model.texture_size / 2, height: guardian.model.texture_size / 2, palette: ["#3e6285"], pixels: Array.from({ length: (guardian.model.texture_size / 2) ** 2 }, () => 0) },
  },
]


/**
 * Specimens the measures are not sure of: each is a guardian with one thing changed that a number cannot call a fault. They pass, and the rule that noticed says so as advice,
 * and nothing else. Evidence that a grey zone is advice and not a refusal.
 */
export type Advised = { name: string; why: string; advice: string[]; model: ModelDesign }
export const ADVISED: Advised[] = [
  {
    name: "eyeless-guardian",
    why: "去掉了眼睛和眉毛，头上还有石头的纹理和角：看不出脸，但不能说头上什么都没有",
    advice: ["no_face"],
    model: made("guardian", (value) => {
      const skull = bone(value, "head").cubes[0]!
      skull.features = skull.features!.filter((feature) => feature.type !== "eyes" && feature.type !== "brows")
    }),
  },
]
