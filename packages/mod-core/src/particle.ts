import { SHORT_PARTICLE_GUIDE } from "./combat-design-words"
import { ShapeFrameSchema, shapePixels, type ShapeFrame } from "@minemods/studio-ai/particle-shapes"
import { z } from "zod"
import { ParticleSpreadSchema } from "@minemods/studio-ai/particle-spread"
import type { StandardOutline } from "@minemods/studio-ai/acceptance"
import { TICKS } from "./ability-words"
import { decodeTextureDataUrl } from "./content-texture"
import { decodeRgbaPng } from "./png-decode"

/**
 * A particle (粒子, Boss 能力 11): the mod's own particle, a few small pictures and how one of them lives — how long, how it falls, how its size,
 * colour and opacity change from the moment it appears to the moment it is gone, whether it glows and how fast it turns. Registered as
 * `<mod>:<name>` and shown by an ability's `particle` event that names this asset (`{ asset }`), the way a vanilla particle is shown.
 * This file is the document, its limits and the life of one particle as a pure function: what the generated particle class does every tick
 * (`common/particles.ts`) and what every picture of it draws. No Node APIs: the app's window reads it too.
 */

/**
 * - frames 1–8: a particle is a picture on a little square that always faces the player; more than one picture is either an animation over its life or one picked at random for each.
 * - side 32: the game packs every particle picture into one atlas; vanilla ones are 8 to 16 pixels a side. Twice that is plenty for what lives a second.
 * - seconds 0.05–10: one tick to the longest anything an ability shows lives (`ABILITY_LIMITS.seconds`).
 * - gravity −2..2: the game's own measure (each tick it falls 0.04 × gravity blocks a tick faster); 1 is what dust does, negative rises.
 * - size 0.02–2 blocks: the side of its square; vanilla smoke is about 0.2, a flame 0.1.
 * - spin −720..720 degrees a second: two turns a second either way.
 */
export const PARTICLE_LIMITS = { frames: { min: 1, max: 8 }, side: 32, seconds: { min: 0.05, max: 10 }, gravity: 2, size: { min: 0.02, max: 2 }, spin: 720, url: 16_000 } as const

/** How a particle with several pictures uses them: one after another over its life (`age`, as the game's own `setSpriteFromAge` does), or one picked at random when it appears and kept (`random`). */
export const PARTICLE_FRAME_MODES = { age: "随着寿命一张接一张换", random: "出现时随机挑一张，一直用它" } as const

const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色写成 #rrggbb 的六位十六进制")
const Size = z.number().finite().min(PARTICLE_LIMITS.size.min).max(PARTICLE_LIMITS.size.max)
const Opacity = z.number().finite().min(0).max(1)

/** What a frame's picture is, read: its size, or why it cannot be one. */
export function particlePixels(frame: string | ShapeFrame) {
  return typeof frame === "string" ? decodeRgbaPng(decodeTextureDataUrl(frame), { side: PARTICLE_LIMITS.side }) : shapePixels(frame)
}

export function appearancePixels(frame: string | ShapeFrame, edge?: "soft") {
  const image = particlePixels(frame)
  if (edge === "soft") {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const r = Math.hypot(2 * (x + 0.5) / image.width - 1, 2 * (y + 0.5) / image.height - 1)
      const t = Math.min(1, Math.max(0, (1 - r) / 0.55))
      const index = 4 * (y * image.width + x) + 3
      image.pixels[index] = Math.round(image.pixels[index]! * t * t * (3 - 2 * t))
    }
  }
  return image
}

export function particleFrame(url: string | ShapeFrame): { side: number } | { fault: string } {
  try {
    const png = particlePixels(url)
    if (png.width !== png.height) return { fault: `是 ${png.width}×${png.height}，粒子的图要是正方形：游戏把它贴在一个正方形上，不是正方形就会被拉扁` }
    return { side: png.width }
  } catch {
    return { fault: `读不出来：要是 data:image/png;base64, 开头的 PNG，边长不超过 ${PARTICLE_LIMITS.side} 像素` }
  }
}

function curve<T extends z.ZodType>(value: T) {
  const mid = z.array(z.strictObject({at:z.number().min(.01).max(.99),value})).max(2,"最多写两个中间点").refine(points=>points.every((p,i)=>i===0 || p.at>points[i-1]!.at),"中间点的 at 要从小到大")
  return z.strictObject({start:value,end:value,mid:mid.optional()})
}

export const ParticleDocumentSchema = z
  .strictObject({
    kind: z.literal("particle"),
    /** Its name in the game (`<mod>:<name>`) and of its pictures (`textures/particle/<name>_<n>.png`): unique among the project's particles. */
    name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "粒子的 name 用小写字母开头，只含小写字母、数字和下划线，最多 32 个字"),
    /** Its pictures, each a square PNG (data URL) at most 32 pixels a side, all the same size. */
    frames: z.array(z.union([z.string().max(PARTICLE_LIMITS.url), ShapeFrameSchema])).min(PARTICLE_LIMITS.frames.min).max(PARTICLE_LIMITS.frames.max),
    frames_by: z.enum(Object.keys(PARTICLE_FRAME_MODES) as [keyof typeof PARTICLE_FRAME_MODES, ...(keyof typeof PARTICLE_FRAME_MODES)[]]),
    /** Seconds from appearing to being gone, rounded to a tick. */
    lifetime: z.number().finite().min(PARTICLE_LIMITS.seconds.min).max(PARTICLE_LIMITS.seconds.max),
    face: z.enum(["camera","motion"]).optional(),
    edge: z.literal("soft").optional(),
    stretch: z.number().min(1).max(8).optional(),
    screen_limit: z.number().min(.02).max(1).optional(),
    suggested_emit: ParticleSpreadSchema.optional(),
    drag: z.number().min(.5).max(1).optional(),
    gravity: z.number().finite().min(-PARTICLE_LIMITS.gravity).max(PARTICLE_LIMITS.gravity),
    /** The side of its square in blocks, when it appears and when it is gone; straight from one to the other over its life. */
    size: curve(Size),
    /** What its picture is tinted with (white keeps the picture's own colours), from one to the other over its life. */
    color: curve(Colour),
    /** 1 solid, 0 gone, from one to the other over its life. */
    opacity: curve(Opacity),
    /** True: drawn at full brightness whatever the light around it (a spark, an ember). */
    emissive: z.boolean(),
    /** Degrees a second it turns in the plane of its square (negative: the other way). */
    spin: z.number().finite().min(-PARTICLE_LIMITS.spin).max(PARTICLE_LIMITS.spin),
  })
  .superRefine((document, context) => {
    const read = document.frames.map(particleFrame)
    read.forEach((frame, index) => "fault" in frame && context.addIssue({ code: "custom", path: ["frames", index], message: `第 ${index + 1} 张图${frame.fault}` }))
    const sides = [...new Set(read.flatMap((frame) => ("side" in frame ? [frame.side] : [])))]
    if (sides.length > 1) context.addIssue({ code: "custom", path: ["frames"], message: `几张图要一样大，现在有 ${sides.map((side) => `${side}×${side}`).join("、")}` })
    if (document.opacity.start === 0 && document.opacity.end === 0 && !document.opacity.mid?.some(point=>point.value>0)) context.addIssue({ code: "custom", path: ["opacity"], message: "从出现到消失都是全透明（opacity 两头都是 0），游戏里什么也看不见" })
  })
export type ParticleDocument = z.infer<typeof ParticleDocumentSchema>

/** How many ticks a particle lives: its lifetime rounded to a tick, at least one. The generated class is given exactly this. */
export const particleTicks = (document: Pick<ParticleDocument, "lifetime">) => Math.max(1, Math.round(document.lifetime * TICKS))

const channels = (colour: string) => [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16) / 255) as [number, number, number]
type Curve<T> = {start:T;end:T;mid?:{at:number;value:T}[]}
export function particleKnots<T>(curve:Curve<T>, read:(value:T)=>number) {
  return [0,read(curve.start), ...(curve.mid??[]).flatMap(point=>[point.at,read(point.value)]),1,read(curve.end)]
}

function curveAt(knots:number[], part:number) {
  for(let i=2;i<knots.length;i+=2) {
    if(part>knots[i]!) continue
    const t=(part-knots[i-2]!)/(knots[i]!-knots[i-2]!)
    return knots[i-1]!+(knots[i+1]!-knots[i-1]!)*t
  }
  return knots[knots.length-1]!
}

export function particleCurves(document: ParticleDocument) {
  return [particleKnots(document.size,Number),particleKnots(document.opacity,Number),...[0,1,2].map(axis=>particleKnots(document.color,c=>channels(c)[axis]!))]
}

/**
 * One particle at `age` ticks after it appeared (0 to its lifetime): which picture it wears, how big it is (blocks a side), its tint (0–1 each), how
 * solid it is and how far it has turned (degrees). The arithmetic of the generated class, in the same order: the part of its life gone is `age / lifetime`,
 * a picture by age is the game's own pick (`SpriteSet.get(age, lifetime)`: the number of pictures less one, times age, divided by lifetime, rounded down).
 * A particle that picks at random wears the first here.
 */
export function particleAt(document: ParticleDocument, age: number) {
  const ticks = particleTicks(document)
  const part = Math.min(1, Math.max(0, age / ticks))
  const [size,opacity,red,green,blue] = particleCurves(document).map(curve=>curveAt(curve,part))
  return {
    frame: document.frames_by === "age" ? Math.floor((Math.min(age, ticks) * (document.frames.length - 1)) / ticks) : 0,
    size: size!,
    color: [red!,green!,blue!] as [number,number,number],
    opacity: opacity!,
    turn: (document.spin / TICKS) * age,
  }
}

const num = (value: number, digits = 2) => Number(value.toFixed(digits))

export function particleWarnings(doc:ParticleDocument) {
  const warnings:string[]=[]
  doc.frames.forEach((frame,i)=>{
    const {width,pixels}=particlePixels(frame)
    let ink=0,edge=false
    for(let j=0;j<width*width;j++) if(pixels[4*j+3]) {
      ink++
      if(j<width || j>=width*(width-1) || j%width===0 || j%width===width-1)edge=true
    }
    if(ink<width*width*.05)warnings.push(`第 ${i+1} 张图有颜色的像素不到 5%，几乎是空的。`)
    if(edge)warnings.push(`第 ${i+1} 张图画到了边上，旋转时轮廓会断，四周各留 1 格空。`)
  })
  const values=<T>(curve:Curve<T>)=>[curve.start,...(curve.mid??[]).map(p=>p.value),curve.end]
  const size=Math.max(...values(doc.size)),opacity=Math.max(...values(doc.opacity))
  if(size<=.05 && opacity<=.25)warnings.push(`最大只有 ${size} 格，最实的时候不透明度 ${opacity}。把 size 或 opacity 调大。`)
  if(!doc.emissive && values(doc.color).every(c=>{const [r,g,b]=channels(c);return .2126*r+.7152*g+.0722*b<.24}))warnings.push("它不发光，颜色也暗，夜里难看见。调亮颜色或打开 emissive。")
  if(doc.frames_by==="age" && doc.frames.length>particleTicks(doc))warnings.push("按寿命换的图比存活的刻数多，有些帧轮不到。延长寿命或减少帧数。")
  if(new Set(values(doc.size)).size===1 && new Set(values(doc.color)).size===1 && new Set(values(doc.opacity)).size===1 && !doc.spin && (doc.frames_by==="random"||doc.frames.length===1))warnings.push("一生中大小、颜色和透明度都不变，也不转、不换图，看起来像贴上去的。")
  return warnings
}

/** A particle in plain words, a line a property: what the look, the card and the reviewer say of it. */
export function particleLines(document: ParticleDocument) {
  const ticks = particleTicks(document)
  const first = particleFrame(document.frames[0]!)
  const side = "side" in first ? first.side : null
  const through = <T>(curve:Curve<T>) => [String(curve.start), ...(curve.mid??[]).map(p=>`${p.value}（寿命 ${num(p.at*100)}%）`), String(curve.end)].join(" → ")
  return [
    `图：${document.frames.length} 张${side ? `，每张 ${side}×${side}` : ""}${document.frames.length > 1 ? `，${PARTICLE_FRAME_MODES[document.frames_by]}` : ""}。`,
    `寿命：${num(ticks / TICKS)} 秒（${ticks} 刻）。`,
    `下落：${document.gravity === 0 ? "不受重力，停在空中慢慢减速" : document.gravity > 0 ? `往下掉（重力 ${num(document.gravity)}，1 是灰尘那样）` : `往上飘（重力 ${num(document.gravity)}）`}${document.drag!==undefined?`，每刻保留 ${num(document.drag*100)}% 速度`:""}。`,
    `大小：${document.size.mid?.length ? through(document.size)+" 格见方" : document.size.start === document.size.end ? `一直 ${num(document.size.start)} 格见方` : `从 ${num(document.size.start)} 格见方变到 ${num(document.size.end)} 格`}。`,
    `颜色：${document.color.mid?.length ? through(document.color) : document.color.start === document.color.end ? `一直染成 ${document.color.start}` : `从 ${document.color.start} 变到 ${document.color.end}`}（白色 #ffffff 是图本来的颜色）；不透明度${document.opacity.mid?.length ? through(document.opacity) : document.opacity.start === document.opacity.end ? `一直 ${num(document.opacity.start)}` : `从 ${num(document.opacity.start)} 变到 ${num(document.opacity.end)}`}。`,
    `${document.emissive ? "自己发光：黑夜里也是最亮的" : "不发光：跟着周围的明暗变"}；${document.face==="motion"?`顺着飞行方向，拉长到 ${document.stretch??1} 倍`:document.spin === 0 ? "不转" : `每秒转 ${num(Math.abs(document.spin))} 度（${document.spin > 0 ? "顺时针" : "逆时针"}）`}。`,
  ]
}

/** What the standard asks of a particle: nothing is refused by a measurement; it is judged by looking at its pictures over its life, with its parameters said beside them. */
export const PARTICLE_STANDARD: StandardOutline = {
  kind: "particle",
  label: "粒子",
  rules: [],
  unmeasured: {
    earns_place: "一个粒子该有多少变化量不了；它的大小、颜色和透明度怎么变是按参数画出来给你看的",
    not_mechanical: "几张图换得顺不顺量不了，对着它一生的几个时刻自己看",
    reads: "它像不像要表现的东西（火星、烟、碎屑）量不了，由人自己看",
    hierarchy: "一个粒子只有一张小图，没有主次",
    sound: "粒子悬在空中、可以穿过东西，站不站得住对它不适用",
    fits: "它和用它的招式配不配，在看那只生物的招式时看，不在这里",
  },
  told: {
    earns_place: "贴图覆盖和边缘、寿命刻数、曲线、重力、运动朝向与日夜可见度；预览提示仅供自评",
  },
}

/** What an AI making a particle is told. */
export const PARTICLE_GUIDE =
  '粒子任务默认要看图。look 会画三张：每帧放大、一生六个时刻、日夜标准场景。看图后写 self_review，自评完成即可 commit_task。粒子的图会随用到它的资产一起审查。设置里关掉「粒子要看图」就可以直接提交。' +
  ' frames 可以直接写 {"shape":"ember","seed":1}。用 list_particle_shapes 看全部形状、种子示例和参数。也可以随文档交脚本，用 api.canvas 绘制或用 api.shape("ember",{seed:1}) 取画布再改，最后 return 画布列表（1 到 8 张、同尺寸正方形、边长不超过 32，#rrggbbaa 支持半透明）。' +
  ' size、color、opacity 各可加最多 2 个 mid 点，每个写 {at,value}，at 在 0.01 到 0.99 之间、依次增大。火花沿速度方向绘制用 face:"motion"，stretch 为 1 到 8 倍。drag 是每刻保留的速度比例，范围 0.5 到 1，默认 0.98。'

export const PARTICLE_INSTRUCTIONS =
  "粒子图会同时给出单点和工程里常用的撒法，最多四种。尚未用到它时可在粒子文档填 suggested_emit（和看图选项 particle_emit 相同）；省略会给贴地圆盘和同向一线。"+
  SHORT_PARTICLE_GUIDE.trimStart() + " " +
  `粒子是模组自己的粒子（注册成 模组id:name），招式的 particle 事件可以写 {"asset":"这个粒子资产的 id"} 来放它，和放原版粒子一样（数量、位置、散开范围写在事件里）。` +
  ` 文档：{kind:"particle", name, frames, frames_by, lifetime, gravity, size:{start,end}, color:{start,end}, opacity:{start,end}, emissive, spin}。` +
  ` name：小写字母开头，只含小写字母、数字、下划线，同一个工程里的粒子不能重名。frames：${PARTICLE_LIMITS.frames.min} 到 ${PARTICLE_LIMITS.frames.max} 张贴图，每张可写形状参数或 PNG（data:image/png;base64,…）。贴图是正方形，边长不超过 ${PARTICLE_LIMITS.side} 像素，几张一样大；透明的地方就是透明的，图要画在中间、四周留空。` +
  ` frames_by：age 是随着寿命一张接一张换（火苗烧完、烟散开），random 是每个粒子出现时随机挑一张一直用（碎屑、星星的几种样子）。lifetime：存在多少秒（${PARTICLE_LIMITS.seconds.min} 到 ${PARTICLE_LIMITS.seconds.max}，按 0.05 秒一刻取整）。` +
  ` gravity：-${PARTICLE_LIMITS.gravity} 到 ${PARTICLE_LIMITS.gravity}，按游戏的算法每刻往下加速 0.04×gravity 格，1 是灰尘那样往下掉，0 停在空中慢慢减速，负数往上飘（火星、烟）。size：出现时和消失时正方形的边长（格，${PARTICLE_LIMITS.size.min} 到 ${PARTICLE_LIMITS.size.max}），没有中间点时均匀变化。` +
  ` 拉长风痕可写 screen_limit:0.2，让单颗的宽和高都不超过屏幕高度的 20%；近处保留运动方向。Boss 和史诗档的风线可以先试 0.2。 edge 可选 soft，贴图的边缘按距离渐淡；铺雾也可以选 mist 形状。 color：出现时和消失时给图染的颜色（#rrggbb，白色 #ffffff 是图本来的颜色，其余颜色是乘上去的，所以图最好画成白色或浅灰，靠 color 上色）；opacity：出现时和消失时的不透明度（0 到 1，比如 1 到 0 是慢慢淡掉）。emissive：true 是自己发光，黑夜里也最亮（火星、魔法光点），false 跟着周围的明暗变（烟、尘土）。spin：每秒转多少度（-${PARTICLE_LIMITS.spin} 到 ${PARTICLE_LIMITS.spin}，0 不转）。` +
  PARTICLE_GUIDE

export const PARTICLE_SUMMARY = "模组自己的粒子：1 到 8 张不超过 32×32 的正方形贴图（PNG 或自带形状，按寿命换着用或随机挑一张），加上寿命、重力、大小变化、颜色和透明度变化、是否发光、旋转；注册成 模组id:name，招式的 particle 事件写 {asset: 粒子资产 id} 就能放。"
