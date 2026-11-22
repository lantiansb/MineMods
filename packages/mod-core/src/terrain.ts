import { VANILLA_BLOCK_IDS } from "./fabric/content-vanilla"
import { z } from "zod"
import { ABILITY_LIMITS, EPIC_LIMITS } from "./ability-words"
import type { Ability } from "./entity-runtime"

const bounded = (min: number, max: number, name: string) =>
  z.number({error: `${name}要填数字`}).finite(`${name}要填有限数字`).min(min, `${name}至少 ${min}`).max(max, `${name}最多 ${max}`)
const place = {
  at: bounded(0, ABILITY_LIMITS.seconds, "发生时刻"),
  restore_on_exit: z.boolean({error:"离场还原写 true 开启或 false 关闭"}).optional(),
  where: z.enum(["self", "target", "hit"], { error: "落点写 self、target 或 hit" }),
  hit: z
    .number()
    .int()
    .min(0)
    .max(EPIC_LIMITS.hits - 1)
    .nullable(),
  forward: bounded(-ABILITY_LIMITS.reach, ABILITY_LIMITS.reach, "前后偏移"),
  left: bounded(-ABILITY_LIMITS.reach, ABILITY_LIMITS.reach, "左右偏移"),
}
export const PopBlocksSchema = z.strictObject({
  height: bounded(0.1, 4, "掀块高度"),
  every: z.number().int().min(1, "掀块间隔至少 1 tick").max(20, "掀块间隔最多 20 tick"),
  max: z.number().int().min(1, "掀块数量至少 1").max(128, "每道冲击波最多掀起 128 块"),
})
export const TerrainRiseEventSchema = z.strictObject({
  type: z.literal("terrain_rise"),
  ...place,
  shape: z.enum(["column", "spike", "wall"], { error: "升起形状写 column（柱）、spike（刺）或 wall（墙）" }),
  hardness: bounded(0, 50, "临时地形硬度").optional(),
  blocks: z.strictObject({
    beam: z.boolean({error:"挡光束写 true 或 false"}).optional(),
    area: z.boolean({error:"挡范围出手写 true 或 false"}).optional(),
    projectile: z.boolean({error:"挡投射物写 true 或 false"}).optional(),
  }, {error:"遮挡设置只写 beam（光束）、area（范围）和 projectile（投射物）"}).optional(),
  material: z.string({error:"方块材质要填注册名，例如 minecraft:stone"}).regex(/^(?:minecraft:)?[a-z][a-z0-9_]{0,63}$/, "材质写本工程方块的标识符或 minecraft:石材名").refine(id => !id.startsWith("minecraft:") || (VANILLA_BLOCK_IDS.has(id.slice(10)) && !["air","void_air","cave_air"].includes(id.slice(10))), "请选能看得见的原版方块，并核对拼写").optional(),
  taper: bounded(0, 1, "石刺收尖程度").optional(),
  width: bounded(0.5, 8, "地形宽度"),
  height: bounded(0.5, 12, "地形高度"),
  rise_seconds: bounded(0.1, 5, "升起时间"),
  stay_seconds: bounded(0, 30, "停留时间"),
  lifts: z.boolean(),
  damage: bounded(0, 100, "伤害").optional(),
  knockback: bounded(0, 4, "推开力度").optional(),
  shatter: z.boolean(),
})
export const TERRAIN_BLOCKS = [
  "minecraft:stone",
  "minecraft:cobblestone",
  "minecraft:mossy_cobblestone",
  "minecraft:stone_bricks",
  "minecraft:deepslate",
  "minecraft:cobbled_deepslate",
  "minecraft:dirt",
  "minecraft:coarse_dirt",
  "minecraft:rooted_dirt",
  "minecraft:grass_block",
  "minecraft:mud",
  "minecraft:clay",
  "minecraft:moss_block",
  "minecraft:sandstone",
  "minecraft:red_sandstone",
  "minecraft:ice",
  "minecraft:packed_ice",
  "minecraft:blue_ice",
  "minecraft:snow_block",
  "minecraft:cobweb",
  "minecraft:obsidian",
  "minecraft:crying_obsidian",
  "minecraft:netherrack",
  "minecraft:blackstone",
  "minecraft:basalt",
  "minecraft:soul_soil",
  "minecraft:magma_block",
  "minecraft:slime_block",
  "minecraft:honey_block",
  "minecraft:glass",
  "minecraft:tinted_glass",
  "minecraft:oak_planks",
  "minecraft:spruce_planks",
  "minecraft:oak_log",
  "minecraft:bricks",
  "minecraft:end_stone",
  "minecraft:prismarine",
] as const
export const BlockSwapEventSchema = z.strictObject({
  type: z.literal("block_swap"),
  ...place,
  block: z.enum(TERRAIN_BLOCKS, {
    error:
      "临时换块使用支持的普通方块，例如 minecraft:ice、minecraft:cobweb、minecraft:obsidian；容器、液体和不可破坏方块不可用",
  }),
  area: z.strictObject({
    shape: z.enum(["circle", "square", "sphere"], { error: "换块区域形状写 circle、square 或 sphere" }),
    radius: bounded(0.5, 8, "换块半径"),
    height: z.number().int().min(1, "区域高度至少 1 格").max(8, "区域高度最多 8 格"),
  }),
  restore_after: bounded(0.1, 120, "还原等待时间"),
  only_replace: z
    .array(z.enum(["air", "liquid", "soft", "solid"], { error: "允许替换的类别写 air、liquid、soft 或 solid" }))
    .min(1, "至少写一种允许替换的方块")
    .max(4)
    .optional(),
})
export type TerrainEvent = z.infer<typeof TerrainRiseEventSchema> | z.infer<typeof BlockSwapEventSchema>
export const isTerrainEvent = (event: { type: string }): event is TerrainEvent =>
  event.type === "terrain_rise" || event.type === "block_swap"
export const abilitiesTerrain = (abilities: readonly Pick<Ability, "events" | "hits">[] | null | undefined) =>
  (abilities ?? []).some(
    (a) =>
      a.events.some((e) => isTerrainEvent(e) || (e.type === "shockwave" && e.pop_blocks !== undefined)) ||
      a.hits.some(
        (h) =>
          h.type === "projectile" &&
          h.impact?.ground?.some((e) => e.type === "shockwave" && e.pop_blocks !== undefined),
      ),
  )
export function usesTerrainInteractions(entities: readonly {abilities?: readonly Pick<Ability,"events"|"hits"|"stages">[] | null | undefined}[]) {
  return entities.some(entity=>entity.abilities?.some(a=>a.stages?.some(s=>s.end?.collision?.length) || a.hits.some(h=>h.type==="area" && h.break_terrain!==undefined) || a.events.some(e=>isTerrainEvent(e) && (e.restore_on_exit || (e.type==="terrain_rise" && (e.blocks !== undefined || e.hardness !== undefined))))))
}
export function terrainIssues(ability: Pick<Ability, "events" | "hits" | "windup">) {
  return ability.events.flatMap((e, index) => {
    if (!isTerrainEvent(e)) return []
    const issues: { path: (string | number)[]; message: string }[] = []
    const add = (field: string, message: string) => issues.push({ path: ["events", index, field], message })
    if ((e.where === "hit") !== (e.hit !== null))
      add("hit", "where 写 hit 时必须写出手序号，self 或 target 时 hit 写 null")
    const hit = e.hit === null ? undefined : ability.hits[e.hit]
    if (
      e.hit !== null &&
      (!hit ||
        hit.type === "projectile" ||
        hit.type === "gameplay" ||
        (hit.type === "area" && (hit.place ?? (hit.shape.type === "arena" ? "center" : "self")) !== "self"))
    )
      add("hit", "临时地形需要当时已知的落点，请用 self、target 或有固定落点的近身出手")
    if (e.type === "terrain_rise" && e.taper !== undefined && e.shape !== "spike") add("taper", "只有石刺会收尖，请写 shape: spike 或删掉 taper")
    if (e.type === "terrain_rise" && ((e.damage ?? 0) > 0 || (e.knockback ?? 0) > 0) && e.at < ability.windup)
      add("at", "会伤人或推人的地形不能早于蓄力结束")
    return issues
  })
}
export const TERRAIN_INSTRUCTIONS = `通用临时地形，可用于各种生物招式、陷阱和守护物，不改写永久地形。所有事件写 at、where:self|target|hit、hit（self/target 写 null）、forward、left。冲击波 shockwave 可选 pop_blocks:{height:0.1到4,every:1到20,max:1到128}，every 为 tick，环扫过时把真实实心地面外观弹起落回，跳过带方块实体或上面不是空气的方块，世界方块不动。大地巨人砸地可写 pop_blocks:{height:1.5,every:2,max:48}。terrain_rise:{type:"terrain_rise",at:1,where:"target",hit:null,forward:0,left:0,shape:"spike",material:"minecraft:stone",restore_on_exit:true,width:2,height:4,rise_seconds:0.8,stay_seconds:2,lifts:true,shatter:true}，shape 可 column 柱、spike 刺、wall 墙；width 0.5到8、height 0.5到12，升起 0.1到5秒，停留0到30秒；damage 0到100、knockback 0到4可选。要石刺就写 material:"minecraft:stone"，冰柱可写 minecraft:packed_ice，也可以写本工程方块的标识符。省略 material 时取脚下方块并归一，草地长出泥土色。spike 默认逐节收尖，taper 在 0 到 1 之间，0 保留旧的平顶分列形状；lifts 为 true 可承托并顶起上面的人；结束 shatter:true 时碎成方块碎片与粒子。升出的柱、刺和墙是有侧面碰撞的显示实体，会挡住走过来的玩家和生物；lifts 只管顶起站在上面的人。terrain_rise.blocks 可分别写 beam、area、projectile 三个布尔值，省略即穿过。area 开关只遮住写了 blocked_by_walls:true 的范围出手。hardness 为 0 到 50，省略时不能打碎。break 的 hardness、dash 的 break_hardness、area 的 break_terrain 达到地形硬度会打碎整组。循环段 end.collision 例如 [{when:{if:"collision",with:"own_terrain"},result:{shatter_terrain:3}},{when:{if:"collision",with:"world"},result:{interrupt:true}}]；other_terrain 表示别人立的地形。Boss 的 terrain_rise 和 block_swap 都写 restore_on_exit:true，脱战重置以后场地里不该还立着上一场的柱子。block_swap:{type:"block_swap",at:1,where:"self",hit:null,forward:0,left:0,block:"minecraft:ice",restore_on_exit:true,area:{shape:"circle",radius:3,height:1},restore_after:5,only_replace:["solid"]}，区域从落点下方一格向上数 height 格，shape 可 circle/square/sphere，半径0.5到8、高1到8，0.1到120秒后逐块还原；only_replace 可 air/liquid/soft/solid，默认仅 soft（可替换植物）和 liquid。陷阱可用 height:2 把脚下上方的空气临时换蛛网，熔岩池可只换 liquid 为 obsidian。受 mobGriefing 控制，关闭时不换；拒绝带方块实体、不可破坏、传送门和无效目标方块；每次最多512块、每世界最多4096笔。还原账本随存档保存，重叠按层到期还原，期间玩家改动过的块保留玩家修改。`
export function terrainWords(e: TerrainEvent) {
  return e.type === "terrain_rise"
    ? `第 ${e.at} 秒升起${{ column: "柱", spike: "刺", wall: "墙" }[e.shape]}，宽 ${e.width} 格、高 ${e.height} 格，${e.rise_seconds} 秒长出，停留 ${e.stay_seconds} 秒${e.lifts ? "，能顶起站在上面的人" : ""}${e.shatter ? "，结束碎裂" : ""}；外观 ${e.material ?? "取脚下方块"}，侧面挡人${e.blocks?.beam ? "，挡光束" : ""}${e.blocks?.area ? "，挡受掩体影响的范围出手" : ""}${e.blocks?.projectile ? "，挡投射物" : ""}${e.hardness === undefined ? "" : "，硬度 "+e.hardness}${e.restore_on_exit ? "，来源离场时消失" : ""}`
    : `第 ${e.at} 秒临时换成 ${e.block}，半径 ${e.area.radius} 格、高 ${e.area.height} 格，${e.restore_after} 秒后逐块还原${e.restore_on_exit ? "，来源离场时提前还原" : ""}（关闭 mobGriefing 时不换）`
}
export function terrainLines(e: TerrainEvent, p: { forward: number; left: number }, blockColor?: (id: string) => string | undefined) {
  const width = e.type === "terrain_rise" ? e.width / 2 : e.area.radius
  const depth = e.type === "terrain_rise" && e.shape === "wall" ? 0.5 : width
  const height = e.type === "terrain_rise" ? e.height : e.area.height
  const point = (x: number, y: number, z: number): [number, number, number] => [
    -(p.left + z) * 16,
    y * 16,
    -(p.forward + x) * 16,
  ]
  if (e.type === "block_swap" && e.area.shape !== "square") {
    const ring = (y: number) =>
      Array.from({ length: 33 }, (_, i) => {
        const dy = y - (height - 1) / 2
        const r = e.area.shape === "sphere" ? Math.sqrt(Math.max(0, width * width - dy * dy)) : width
        return point(r * Math.cos((i * Math.PI) / 16), y - 1, r * Math.sin((i * Math.PI) / 16))
      })
    return [0, (height - 1) / 2, height - 1].map((y) => ({ points: ring(y), color: "#8fabc2" }))
  }
  const material = e.type === "terrain_rise" ? e.material : e.block
  const color = (material && blockColor?.(material)) ?? (material?.includes("ice") ? "#80bdeb" : material?.includes("stone") ? "#909093" : material ? "#b88c64" : "#8fabc2")
  const box = (cx: number, cz: number, dx: number, dz: number, bottom: number, top: number) => {
    const corner = (x: number, y: number, z: number) => point(cx + dx*x, y, cz + dz*z)
    return [
      ...[bottom,top].map(y => ({color,points:[corner(-1,y,-1),corner(1,y,-1),corner(1,y,1),corner(-1,y,1),corner(-1,y,-1)]})),
      ...[-1,1].flatMap(x => [-1,1].map(z => ({color,points:[corner(x,bottom,z),corner(x,top,z)]}))),
    ]
  }
  if (e.type === "terrain_rise" && e.shape === "spike") {
    const taper = e.taper ?? 1
    if (taper > 0) {
      const count = Math.max(3, Math.ceil(height*2))
      return Array.from({length:count}, (_,i) => {
        const half = width*(1-taper*i/count)
        return box(0,0,half,half,height*i/count,height*(i+1)/count)
      }).flat()
    }
    const outlines = []
    for (let x=0; x<e.width; x++) for (let z=0; z<e.width; z++) {
      const dx = Math.min(1,e.width-x)/2, dz = Math.min(1,e.width-z)/2
      const cx = x-width+dx, cz = z-width+dz
      outlines.push(...box(cx,cz,dx,dz,0,height*Math.max(0.15,1-Math.max(Math.abs(cx),Math.abs(cz))/width)))
    }
    return outlines
  }
  return box(0,0,depth,width,0,height)
}

export const TRAP_GAMEPLAY_WORDS = "方块被踩时触发玩法：写一个 gameplay 并在 uses 列出该方块的资产 UUID。服务端 tick 中检查玩家已着地、脚下的 BlockState 是否为 ProjectContent.block(方块标识符)，首次踩上或冷却结束时调用 terrainRise、blockSwap 或 popBlocks。Forge 和 NeoForge 用 ProjectPlatform.onServerTick；Fabric 可用 ServerTickEvents.END_SERVER_TICK。"

export const TERRAIN_GAMEPLAY_INSTRUCTIONS = `物品、陷阱和竞技场的玩法也可通过 ProjectContent 调临时地形，写出调用后生成器自动加入同一运行层，不依赖任何 Boss。只在服务端的事件回调中调用：ProjectContent.terrainRise(Level, Vec3落点, float朝向, String形状column/spike/wall, double宽, double高, int升起tick, int停留tick, boolean承托抬升, float伤害, double推开力度, boolean碎裂, Entity来源可null)；ProjectContent.blockSwap(Level, Vec3落点, String方块minecraft:ice等, String区域circle/square/sphere, double半径, int高, int还原tick, String允许替换类别逗号分隔air/liquid/soft/solid)；ProjectContent.popBlocks(Level, Vec3落点, double初始半径, double最终半径, int扩散tick, double掀起高度, int每隔tick, int最多块数)。数值上限与招式临时地形一致，时间这里用tick（20tick=1秒）；blockSwap 仍服从 mobGriefing、带存档还原账本。玩法要指定材质和遮挡，可用 terrainRiseWith，在 terrainRise 原参数之后加 taper、material（可 null）、挡光束、挡范围、挡投射物、hardness（-1 为不可毁）、随来源离场还原。blockSwapWithOwner 在 blockSwap 原参数之后加来源实体，离场时还原。陷阱可在玩家踩上去时 terrainRise；玩家物品右键可 popBlocks 或 terrainRise；冰法师的法杖可 blockSwap 冰地，守护石像的竞技场可 terrainRise 石墙。`
