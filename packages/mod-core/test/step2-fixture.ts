import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { fightingGolemDesign } from "../script/data-gameplay-sample"

const face = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
/** The fighting golem with a two-piece cape on its back that follows, its slam layered and blending, its burst eased and curved, its hurt blending. */
export const capedGolem = ModelDesignSchema.parse({
  ...fightingGolemDesign,
  bones: [
    ...fightingGolemDesign.bones,
    { name: "cape", parent: "body", pivot: [0, 20, 3], rotation: [0, 0, 0], paint: { material: "cloth", base: "#A02424", secondary: "#6E1818" }, cubes: [{ name: "cloth", origin: [-4, 14, 3], size: [8, 6, 1], faces: face("#8A2020") }] },
    { name: "cape_tip", parent: "cape", pivot: [0, 14, 3], rotation: [0, 0, 0], cubes: [{ name: "hem", origin: [-4, 9, 3], size: [8, 5, 1], faces: face("#6E1818") }] },
  ],
  animations: fightingGolemDesign.animations.map((clip) => {
    if (clip.name === "slam") return { ...clip, blend: 4, layered: true, channels: clip.channels.filter((channel) => channel.bone.startsWith("arm")) }
    if (clip.name === "hurt") return { ...clip, blend: 3 }
    if (clip.name === "burst")
      return {
        ...clip,
        blend: 5,
        channels: clip.channels.map((channel) =>
          channel.bone === "body"
            ? { ...channel, keyframes: channel.keyframes.map((key, index) => (index === 0 ? { ...key, easing: "easeInOutSine" } : index === 2 ? { ...key, interpolation: "bezier", bezier_right_time: [0.1, 0.1, 0.1], bezier_right_value: [-6, 0, 0] } : key)) }
            : channel,
        ),
      }
    return clip
  }),
  follow: [{ bone: "cape", period: 0.7, damping: 0.3, drag: 10, limit: 50, x_range: [0, 70] }, { bone: "cape_tip", period: 0.5, damping: 0.35, x_range: [-10, 50] }],
}) as ModelDesign

