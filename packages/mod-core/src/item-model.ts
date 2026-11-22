import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { paintModel } from "@minemods/studio-ai/model-paint"

/** A Java item model is static. Refuse unsupported geometry rather than silently changing its appearance. */
export function compileItemModel(input: ModelDesign) {
  const design = ModelDesignSchema.parse(input)
  if (design.bones.some(bone => bone.rotation.some(value => value !== 0))) throw new Error("物品模型暂不支持旋转骨骼；请使用无旋转的静态立方体模型。")
  if (design.animations.some(animation => animation.channels.some(channel =>
    channel.keyframes.some(key => key.rotation.some(value => value !== 0)) ||
    channel.position?.some(key => key.position.some(value => value !== 0)) ||
    channel.scale?.some(key => key.scale.some(value => value !== 1)),
  ))) throw new Error("物品模型暂不支持动画运动；请使用所有动画轨道均保持静止的模型。")
  const texture = paintModel(design)
  const elements = design.bones.flatMap((bone, boneIndex) => bone.cubes.map((cube, cubeIndex) => {
    // GeckoLib mirrors model X. Java models are centred at [8,8,8]; preserve the editor's geometry and size.
    const from = [8 - cube.origin[0] - cube.size[0], cube.origin[1], 8 + cube.origin[2]]
    const to = from.map((value, axis) => value + cube.size[axis]!)
    if ([...from, ...to].some(value => value < -16 || value > 32)) throw new Error(`物品部件 ${bone.name}.${cube.name} 超出原版模型的 -16 到 32 坐标范围。`)
    return {
      name: `${bone.name}.${cube.name}`,
      from,
      to,
      faces: Object.fromEntries(texture.islands.filter(island => island.boneIndex === boneIndex && island.cubeIndex === cubeIndex).map(island => [
        island.face,
        { uv: [island.x, island.y, island.x + island.width, island.y + island.height].map(value => value * 16 / texture.size), texture: "#layer0" },
      ])),
    }
  }))
  return { elements, texture }
}
