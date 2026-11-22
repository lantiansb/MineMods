import type { ModelDesign } from "./contracts"

type Structure = Pick<ModelDesign, "bones" | "follow">
const angled = (rotation: readonly number[] | null | undefined) =>
  rotation?.some((degrees) => Math.abs(degrees / 90 - Math.round(degrees / 90)) > 1e-6) ?? false

/** Maximal single-child paths, with a terminal fork left out of the path. */
export function modelStructure(design: Structure) {
  const byName = new Map(design.bones.map((bone) => [bone.name, bone]))
  const children = new Map(design.bones.map((bone) => [bone.name, [] as string[]]))
  for (const bone of design.bones) if (bone.parent) children.get(bone.parent)?.push(bone.name)
  const followed = new Set(design.follow?.filter((value) => value.weight !== 0).map((value) => value.bone))
  const chains = design.bones.flatMap((bone) => {
    if (bone.parent && children.get(bone.parent)?.length === 1) return []
    const names = [bone.name]
    while (children.get(names.at(-1)!)?.length === 1) {
      const child = children.get(names.at(-1)!)![0]!
      if (children.get(child)!.length > 1 || names.includes(child)) break
      names.push(child)
    }
    return [{ names, followed: names.filter((name) => followed.has(name)) }]
  })
  const structure = design.bones.map((bone) => {
    const path = new Set([bone.name])
    let turned = angled(bone.rotation)
    for (let parent = bone.parent; parent && !path.has(parent); parent = byName.get(parent)?.parent ?? null) {
      path.add(parent)
      turned ||= angled(byName.get(parent)?.rotation)
    }
    return { depth: path.size, angled: bone.cubes.filter((cube) => turned || angled(cube.rotation)).length }
  })
  return {
    depth: Math.max(0, ...structure.map((value) => value.depth)),
    chains: chains.filter((chain) => chain.names.length >= 3),
    paths: chains,
    bones: design.bones.length,
    joints: design.bones.filter((bone) => bone.cubes.length === 0 && Boolean(children.get(bone.name)?.length)).length,
    cubes: design.bones.reduce((sum, bone) => sum + bone.cubes.length, 0),
    angled: structure.reduce((sum, value) => sum + value.angled, 0),
  }
}

export function structureWords(design: Structure) {
  const counts = modelStructure(design)
  const share = (part: number, total: number) => total ? `${part}/${total}（${Math.round(part * 100 / total)}%）` : "0/0"
  return `模型结构：最深 ${counts.depth} 层（根算第 1 层）；3 节以上的单线链 ${counts.chains.length} 串，其中 ${counts.chains.filter((chain) => chain.followed.length).length} 串有跟随或挂链；无方块的关节骨骼 ${share(counts.joints, counts.bones)}；非正放方块 ${share(counts.angled, counts.cubes)}。`
}

export const appendageGaps = (design: Structure) => appendageBoneGaps(design).map((parts) => parts.join(" → "))

/** Only unambiguously named, unbranched appendages with no unrelated child at their tip. */
export function appendageBoneGaps(design: Structure) {
  const partOf = (name: string) => name.match(/^(?:tail|cape|beard|chain)(?:[_-](?:l|r|left|right))?(?:[_-]?\d+)?$|^(?:尾巴|披风|胡子|链子)(?:[_-]?\d+)?$/i)?.[0].replace(/[_-]?\d+$/, "").toLowerCase()
  const roots = new Set(design.bones.flatMap((bone) => bone.parent ? [] : [bone.name]))
  return modelStructure(design).paths.flatMap(({ names, followed }) => {
    const head = names.findIndex((name) => Boolean(partOf(name)))
    if (head < 0 || names.slice(head).some((name) => partOf(name) !== partOf(names[head]!))) return []
    const parts = names.slice(head)
    if (roots.has(parts[0]!) || design.bones.some((bone) => bone.parent === parts.at(-1))) return []
    return parts.length < 2 || parts.length > 6 || !parts.some((name) => followed.includes(name)) ? [parts] : []
  })
}
