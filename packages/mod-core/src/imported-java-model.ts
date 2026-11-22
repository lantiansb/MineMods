import { inspectJavaClass } from "./class-inspect"

/**
 * Entity models written in Java build their shape with builder calls. This module reads that
 * bytecode as data and replays it on a small interpreter; no mod code runs.
 *
 * It does not depend on how the game's classes happen to be named in a given mod (Mojang names,
 * Forge SRG names, Fabric intermediary names): the builder classes are recognised by the shape of
 * the calls made on them. Two generations of the game's model code are covered:
 *  - "layer" models (1.17 and later): a static method assembles parts and returns a layer definition;
 *  - "part" models (1.16 and earlier): the model's constructor creates parts and adds boxes to them.
 */

export type MethodCode = {
  name: string
  descriptor: string
  access: number
  instructions: string[]
  truncated: boolean
}
export type ClassCode = {
  name: string
  superclass: string | null
  interfaces: string[]
  strings: string[]
  fields: { name: string; descriptor: string; access: number }[]
  methods: MethodCode[]
  bootstraps: { index: number; arguments: string[] }[]
}

export type JavaModelGeometry = {
  format_version: "1.12.0"
  "minecraft:geometry": {
    description: { identifier: string; texture_width: number; texture_height: number }
    bones: {
      name: string
      parent?: string
      pivot: [number, number, number]
      rotation?: [number, number, number]
      cubes: {
        origin: [number, number, number]
        size: [number, number, number]
        uv: [number, number]
        inflate?: number
        mirror?: boolean
      }[]
    }[]
  }[]
}
export type JavaModelResult = {
  geometry: JavaModelGeometry
  /** "owner.method" the shape was read from. */
  source: string
  cubeCount: number
  /** True when part of the shape could not be read: unknown loop bounds, a base model that is not available. */
  partial: boolean
  diagnostics: string[]
  /** How see-through the game draws it (1 = solid), when the model's own drawing code says so. */
  opacity?: number
}
/** Finds another class by internal name ("a/b/C"), in the mod or in the game's own files. */
export type ClassLookup = (internalName: string) => ClassCode | null | undefined

/** Disassemble every method of a class once. */
export function readClassCode(bytes: Uint8Array): ClassCode {
  const parsed = JSON.parse(inspectJavaClass(bytes, undefined, { allMethods: true, maxInstructions: 4096 }).content) as {
    name: string
    superclass: string | null
    interfaces: string[]
    string_constants: string[]
    fields: { name: string; descriptor: string; access: number }[]
    methods: { name: string; descriptor: string; access: number; instructions?: string[]; truncated?: boolean }[]
    bootstrap_methods: { index: number; arguments: string[] }[]
  }
  return {
    name: parsed.name,
    superclass: parsed.superclass,
    interfaces: parsed.interfaces,
    strings: parsed.string_constants,
    fields: parsed.fields,
    methods: parsed.methods.map((method) => ({
      name: method.name,
      descriptor: method.descriptor,
      access: method.access,
      instructions: method.instructions ?? [],
      truncated: method.truncated === true,
    })),
    bootstraps: parsed.bootstrap_methods.map((entry) => ({ index: entry.index, arguments: entry.arguments })),
  }
}

// ---------------------------------------------------------------- instruction parsing

export type Instruction = {
  offset: number
  op: string
  /** Raw operand text before the comment, e.g. "10" for bipush. */
  operand: string
  /** Resolved constant-pool text after "//". */
  comment: string
  /** Branch target for jumps. */
  target?: number
  member?: { owner: string; name: string; descriptor: string }
}

export function parseInstruction(line: string): Instruction {
  const colon = line.indexOf(": ")
  const offset = Number(line.slice(0, colon))
  let rest = line.slice(colon + 2)
  let target: number | undefined
  const arrow = rest.match(/ -> (-?\d+)$/)
  if (arrow) {
    target = Number(arrow[1])
    rest = rest.slice(0, arrow.index)
  }
  const mark = rest.indexOf(" // ")
  const comment = mark < 0 ? "" : rest.slice(mark + 4)
  const head = (mark < 0 ? rest : rest.slice(0, mark)).split(" ")
  const op = head[0] ?? ""
  const instruction: Instruction = { offset, op, operand: head.slice(1).join(" "), comment, ...(target === undefined ? {} : { target }) }
  if (/^(invoke(static|virtual|special|interface)|getstatic|putstatic|getfield|putfield)$/.test(op)) {
    const match = comment.match(/^(.+)\.([^.:]+):(.+)$/)
    if (match) instruction.member = { owner: match[1]!, name: match[2]!, descriptor: match[3]! }
  }
  return instruction
}

/** Descriptor argument types, e.g. "(FFLjava/lang/String;I)V" → ["F","F","Ljava/lang/String;","I"]. */
export function parseDescriptor(descriptor: string) {
  const close = descriptor.indexOf(")")
  const body = descriptor.slice(1, close)
  const args: string[] = []
  for (let index = 0; index < body.length; index++) {
    const start = index
    while (body[index] === "[") index++
    if (body[index] === "L") index = body.indexOf(";", index)
    args.push(body.slice(start, index + 1))
  }
  return { args, returns: descriptor.slice(close + 1) }
}

const objectType = (type: string) => (type.startsWith("L") && type.endsWith(";") ? type.slice(1, -1) : null)
const simpleName = (internal: string) => internal.slice(internal.lastIndexOf("/") + 1).split("$")[0]!
const isStatic = (method: MethodCode) => (method.access & 0x0008) !== 0

// ---------------------------------------------------------------- builder roles

/** The game classes that take part in building a model, by internal name. */
export type BuilderRoles = {
  layer?: string
  mesh?: string
  part?: string
  cubes?: string
  pose?: string
  deformation?: string
  /** Pre-1.17 part class (ModelRenderer / ModelPart). */
  legacyPart?: string
}

// Used only until the call shapes below identify the classes; covers Mojang and SRG mapped mods.
const knownNames: Record<string, keyof BuilderRoles> = {
  LayerDefinition: "layer",
  TexturedModelData: "layer",
  MeshDefinition: "mesh",
  ModelData: "mesh",
  PartDefinition: "part",
  ModelPartData: "part",
  CubeListBuilder: "cubes",
  ModelPartBuilder: "cubes",
  PartPose: "pose",
  ModelTransform: "pose",
  CubeDeformation: "deformation",
  Dilation: "deformation",
  ModelRenderer: "legacyPart",
  RendererModel: "legacyPart",
}

/**
 * Work out which class plays which role from call shapes alone:
 *  - a part is the class with a method (String, cubes, pose) → part on itself;
 *  - a layer is produced by a static call taking (mesh, int, int);
 *  - the deformation is the object argument of a box call that has six float arguments.
 */
export function learnRoles(roles: BuilderRoles, method: MethodCode) {
  for (const line of method.instructions) {
    if (!line.includes("invoke")) continue
    const member = parseInstruction(line).member
    if (!member) continue
    const { args, returns } = parseDescriptor(member.descriptor)
    const returned = objectType(returns)
    if (args.length === 3 && args[0] === "Ljava/lang/String;" && returned === member.owner) {
      const cubes = objectType(args[1]!),
        pose = objectType(args[2]!)
      if (cubes && pose && cubes !== pose) {
        roles.part ??= member.owner
        roles.cubes ??= cubes
        roles.pose ??= pose
      }
    }
    if (returned && args.length === 3 && args[1] === "I" && args[2] === "I" && objectType(args[0]!) && returned !== objectType(args[0]!)) {
      // LayerDefinition.create(mesh, width, height)
      if (line.includes("invokestatic") && member.owner === returned) {
        roles.layer ??= returned
        roles.mesh ??= objectType(args[0]!)!
      }
    }
    if (roles.cubes && member.owner === roles.cubes && args.filter((arg) => arg === "F").length >= 6) {
      const extra = args.map(objectType).find((type) => type && type !== "java/lang/String" && !type.startsWith("java/"))
      if (extra) roles.deformation ??= extra
    }
  }
  const returned = objectType(parseDescriptor(method.descriptor).returns)
  if (returned && knownNames[simpleName(returned)] === "layer") roles.layer ??= returned
  return roles
}

const roleOf = (roles: BuilderRoles, internal: string | null | undefined): keyof BuilderRoles | undefined => {
  if (!internal) return undefined
  for (const key of ["layer", "mesh", "part", "cubes", "pose", "deformation", "legacyPart"] as const)
    if (roles[key] === internal) return key
  const guess = knownNames[simpleName(internal)]
  return guess && !roles[guess] ? guess : undefined
}

// ---------------------------------------------------------------- interpreter values

type Cube = {
  origin: [number, number, number]
  size: [number, number, number]
  uv: [number, number]
  inflate: number
  mirror: boolean
}
type Pose = { kind: "pose"; offset: [number, number, number]; rotation: [number, number, number] }
type CubeList = { kind: "cubes"; cubes: Cube[]; uv: [number, number]; mirror: boolean }
type Part = {
  kind: "part"
  name: string
  cubes: Cube[]
  pose: Pose
  children: Map<string, Part>
  uv: [number, number]
  mirror: boolean
  attached: boolean
  /** False hides the part and everything hanging from it. */
  visible: boolean
  /** True hides the part's own boxes but still draws its children. */
  bare: boolean
}
type Mesh = { kind: "mesh"; root: Part }
type Layer = { kind: "layer"; mesh: Mesh; texture: [number, number] }
type Deformation = { kind: "deformation"; grow: number }
type Text = { kind: "text"; parts: string[] }
type Self = { kind: "self"; fields: Map<string, Value>; texture: [number, number]; /** The model's own class, where calls on it start. */ type?: string }
type List = { kind: "list"; items: Value[] }
type Unknown = { kind: "unknown" }
/** java.util.Random and the game's own seeded random source: same generator, so shapes built from a seed come out as in the game. */
type Random = { kind: "random"; seed: bigint; spare: number | null }
type Value = number | string | Pose | CubeList | Part | Mesh | Layer | Deformation | Text | Self | List | Random | Unknown | null

const unknown: Unknown = { kind: "unknown" }
const zeroPose = (): Pose => ({ kind: "pose", offset: [0, 0, 0], rotation: [0, 0, 0] })
const newPart = (name: string): Part => ({
  kind: "part",
  name,
  cubes: [],
  pose: zeroPose(),
  children: new Map(),
  uv: [0, 0],
  mirror: false,
  attached: false,
  visible: true,
  bare: false,
})
const is = <K extends string>(value: Value | undefined, kind: K): value is Extract<Value, { kind: K }> =>
  typeof value === "object" && value !== null && value.kind === kind
const known = (value: Value | undefined): value is number => typeof value === "number" && Number.isFinite(value)
const num = (value: Value | undefined) => (known(value) ? value : 0)

function addChild(parent: Part, name: string, cubes: Cube[], pose: Pose) {
  const child = newPart(name)
  child.cubes = cubes
  child.pose = pose
  child.attached = true
  // Replacing a part keeps the children that were hanging from it.
  const previous = parent.children.get(name)
  if (previous) child.children = previous.children
  parent.children.set(name, child)
  return child
}

const box = (uv: [number, number], x: number, y: number, z: number, w: number, h: number, d: number, mirror = false): Cube => ({
  origin: [x, y, z],
  size: [w, h, d],
  uv,
  inflate: 0,
  mirror,
})

/** The player-shaped base mesh, used when the game's own class files are not on this computer. */
function humanoidMesh(grow: number, yOffset: number): Mesh {
  const root = newPart("root")
  const grown = (cube: Cube, extra = 0) => ({ ...cube, inflate: grow + extra })
  const at = (x: number, y: number, z: number): Pose => ({ kind: "pose", offset: [x, y + yOffset, z], rotation: [0, 0, 0] })
  addChild(root, "head", [grown(box([0, 0], -4, -8, -4, 8, 8, 8))], at(0, 0, 0))
  addChild(root, "hat", [grown(box([32, 0], -4, -8, -4, 8, 8, 8), 0.5)], at(0, 0, 0))
  addChild(root, "body", [grown(box([16, 16], -4, 0, -2, 8, 12, 4))], at(0, 0, 0))
  addChild(root, "right_arm", [grown(box([40, 16], -3, -2, -2, 4, 12, 4))], at(-5, 2, 0))
  addChild(root, "left_arm", [grown(box([40, 16], -1, -2, -2, 4, 12, 4, true))], at(5, 2, 0))
  addChild(root, "right_leg", [grown(box([0, 16], -2, 0, -2, 4, 12, 4))], at(-1.9, 12, 0))
  addChild(root, "left_leg", [grown(box([0, 16], -2, 0, -2, 4, 12, 4, true))], at(1.9, 12, 0))
  return { kind: "mesh", root }
}

/** The four-legged base mesh, used when the game's own class files are not on this computer. */
function quadrupedMesh(legHeight: number, grow: number): Mesh {
  const root = newPart("root")
  const grown = (cube: Cube) => ({ ...cube, inflate: grow })
  const leg = () => [grown(box([0, 16], -2, 0, -2, 4, legHeight, 4))]
  addChild(root, "head", [grown(box([0, 0], -4, -4, -8, 8, 8, 8))], { kind: "pose", offset: [0, 18 - legHeight, -6], rotation: [0, 0, 0] })
  addChild(root, "body", [grown(box([28, 8], -5, -10, -7, 10, 16, 8))], {
    kind: "pose",
    offset: [0, 17 - legHeight, 2],
    rotation: [Math.PI / 2, 0, 0],
  })
  const at = (x: number, z: number): Pose => ({ kind: "pose", offset: [x, 24 - legHeight, z], rotation: [0, 0, 0] })
  addChild(root, "right_hind_leg", leg(), at(-3, 7))
  addChild(root, "left_hind_leg", leg(), at(3, 7))
  addChild(root, "right_front_leg", leg(), at(-3, -5))
  addChild(root, "left_front_leg", leg(), at(3, -5))
  return { kind: "mesh", root }
}

const randomMask = (1n << 48n) - 1n
const seeded = (seed: number): Random => ({
  kind: "random",
  seed: (BigInt(Math.trunc(Number.isFinite(seed) ? seed : 0)) ^ 0x5deece66dn) & randomMask,
  spare: null,
})
/** One draw from a seeded random source, told apart by the call's shape: (bound) → int, () → float, and so on. */
function drawRandom(random: Random, name: string, argTypes: string[], returns: string, values: Value[]): Value {
  if (!values.every(known)) return unknown
  const next = (bits: number) => {
    random.seed = (random.seed * 0x5deece66dn + 0xbn) & randomMask
    return Number(BigInt.asIntN(32, random.seed >> BigInt(48 - bits)))
  }
  const below = (bound: number) => {
    if (bound <= 0) return 0
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(next(31))) >> 31n)
    for (let tries = 0; tries < 64; tries++) {
      const bits = next(31)
      const value = bits % bound
      if (((bits - value + (bound - 1)) | 0) >= 0) return value
    }
    return 0
  }
  const real = () => (next(26) * 2 ** 27 + next(27)) * 2 ** -53
  const [first = 0, second = 0] = values as number[]
  const shape = `${argTypes.join("")}:${returns}`
  if (shape === "J:V") {
    Object.assign(random, seeded(first))
    return null
  }
  if (shape === ":I") return next(32)
  if (shape === "I:I") return below(first)
  if (shape === "II:I") return first + below(second - first)
  if (shape === ":F") return next(24) / (1 << 24)
  if (shape === ":Z") return next(1) !== 0 ? 1 : 0
  if (shape === ":J") return Number((BigInt(next(32)) << 32n) + BigInt(next(32)))
  if (shape === ":D" && /aussian|m_188583_|method_43059/.test(name)) {
    if (random.spare !== null) {
      const kept = random.spare
      random.spare = null
      return kept
    }
    for (let tries = 0; tries < 64; tries++) {
      const one = 2 * real() - 1,
        two = 2 * real() - 1
      const sum = one * one + two * two
      if (sum >= 1 || sum === 0) continue
      const scale = Math.sqrt((-2 * Math.log(sum)) / sum)
      random.spare = two * scale
      return one * scale
    }
    return 0
  }
  if (shape === ":D") return real()
  return unknown
}

/** The game's own sine and cosine helpers under the names the three mapping families give them. */
const waves: Record<string, (value: number) => number> = {
  sin: Math.sin,
  m_14031_: Math.sin,
  method_15374: Math.sin,
  cos: Math.cos,
  m_14089_: Math.cos,
  method_15362: Math.cos,
}
/** Setters on a finished part that take three numbers and mean rotation; any other such call moves the part. */
const rotationSetters = new Set(["setRotation", "m_171327_", "setAngles", "method_33425"])
/**
 * Fields of the game's own base models, by the part they hold. A model that builds on a base model
 * reads its head, arms and legs from these; the names are listed for Mojang, Forge and Fabric mappings.
 */
const baseFields: Record<string, string[]> = {
  head: ["head", "f_102808_", "field_3398", "f_103492_"],
  hat: ["hat", "f_102809_", "field_3394"],
  body: ["body", "f_102810_", "field_3391", "f_103493_"],
  right_arm: ["rightArm", "f_102811_", "field_3401"],
  left_arm: ["leftArm", "f_102812_", "field_27433"],
  right_leg: ["rightLeg", "f_102813_", "field_3392"],
  left_leg: ["leftLeg", "f_102814_", "field_3397"],
  right_hind_leg: ["rightHindLeg", "f_170852_"],
  left_hind_leg: ["leftHindLeg", "f_170853_"],
  right_front_leg: ["rightFrontLeg", "f_170854_"],
  left_front_leg: ["leftFrontLeg", "f_170855_"],
}
function bindBaseFields(self: Self, root: Part) {
  for (const [child, names] of Object.entries(baseFields)) {
    const part = root.children.get(child)
    if (part) names.forEach((name) => self.fields.has(name) || self.fields.set(name, part))
  }
}
const drawShape = /^\(L[^;]+;L[^;]+;II(FFFF|I)?\)V$/

// Field and method names that tell rotation from position. Everything else is recognised by shape.
const rotationOnly = new Set(["rotation", "m_171430_", "method_32092"])
const partFields: Record<string, ["rotation" | "offset", 0 | 1 | 2] | "mirror" | "visible" | "bare"> = {
  f_104203_: ["rotation", 0],
  f_104204_: ["rotation", 1],
  f_104205_: ["rotation", 2],
  f_104200_: ["offset", 0],
  f_104201_: ["offset", 1],
  f_104202_: ["offset", 2],
  visible: "visible",
  showModel: "visible",
  f_104207_: "visible",
  field_78806_j: "visible",
  field_3665: "visible",
  skipDraw: "bare",
  f_233556_: "bare",
  rotateAngleX: ["rotation", 0],
  rotateAngleY: ["rotation", 1],
  rotateAngleZ: ["rotation", 2],
  xRot: ["rotation", 0],
  yRot: ["rotation", 1],
  zRot: ["rotation", 2],
  field_78795_f: ["rotation", 0],
  field_78796_g: ["rotation", 1],
  field_78808_h: ["rotation", 2],
  pitch: ["rotation", 0],
  yaw: ["rotation", 1],
  roll: ["rotation", 2],
  field_3654: ["rotation", 0],
  field_3675: ["rotation", 1],
  field_3674: ["rotation", 2],
  rotationPointX: ["offset", 0],
  rotationPointY: ["offset", 1],
  rotationPointZ: ["offset", 2],
  x: ["offset", 0],
  y: ["offset", 1],
  z: ["offset", 2],
  field_78800_c: ["offset", 0],
  field_78797_d: ["offset", 1],
  field_78798_e: ["offset", 2],
  pivotX: ["offset", 0],
  pivotY: ["offset", 1],
  pivotZ: ["offset", 2],
  field_3657: ["offset", 0],
  field_3656: ["offset", 1],
  field_3655: ["offset", 2],
  mirror: "mirror",
  field_78809_i: "mirror",
  field_3666: "mirror",
}
const textureFields: Record<string, 0 | 1> = {
  textureWidth: 0,
  textureHeight: 1,
  texWidth: 0,
  texHeight: 1,
  field_78090_t: 0,
  field_78089_u: 1,
  field_17138: 0,
  field_17139: 1,
}

type Run = {
  roles: BuilderRoles
  lookup: ClassLookup
  steps: number
  partial: boolean
  diagnostics: Set<string>
  /** Every legacy part created, in creation order. */
  parts: Part[]
  partNames: Map<Part, string>
  /** Meshes in creation order, to salvage a shape when the replay stops early. */
  meshes: Mesh[]
  /** Number tables a class sets up for itself once (sizes, offsets), by "class.field". */
  statics: Map<string, Value>
  /** Classes whose tables have been read, or are being read. */
  prepared: Set<string>
  /** Set while replaying how a finished model is posed and drawn, rather than how it is built. */
  stage?: Stage
}
/**
 * What the model's drawing code does with its parts. While this is being read, anything only the
 * running game knows (the creature's state, the time) counts as zero: the creature standing still.
 */
type Stage = {
  /** Parts the model draws one by one. */
  drawn: Set<Part>
  /** The model also hands drawing to the game's base class. */
  inherited: boolean
  opacity: number
  /**
   * How questions only the game can answer are answered in this replay: 0 = always no, 1 = always yes,
   * anything else = a fixed scatter of yes and no, different for each question asked.
   */
  pattern: number
  asked: number
}
/** The answer to the next question only the game could answer. */
function guess(stage: Stage | undefined): 0 | 1 {
  if (!stage || stage.pattern === 0) return 0
  if (stage.pattern === 1) return 1
  let mixed = Math.imul(stage.pattern * 0x9e3779b1 + ++stage.asked, 0x85ebca6b)
  mixed ^= mixed >>> 15
  mixed = Math.imul(mixed, 0xc2b2ae35)
  return ((mixed >>> 16) & 1) as 0 | 1
}
const stepLimit = 200_000

function interpret(run: Run, owner: ClassCode, method: MethodCode, args: Value[], depth: number): Value {
  const code = method.instructions.map(parseInstruction)
  const at = new Map(code.map((instruction, index) => [instruction.offset, index]))
  const stack: Value[] = []
  const locals = new Map<number, Value>()
  // Arguments occupy local slots in order; long and double take two.
  let slot = 0
  const types = [...(isStatic(method) ? [] : ["this"]), ...parseDescriptor(method.descriptor).args]
  types.forEach((type, index) => {
    locals.set(slot, args[index] ?? unknown)
    slot += type === "J" || type === "D" ? 2 : 1
  })
  const pop = () => stack.pop() ?? unknown
  const stop = (reason: string) => {
    run.partial = true
    run.diagnostics.add(reason)
  }
  const local = (instruction: Instruction) =>
    instruction.op.includes("_") ? Number(instruction.op.at(-1)) : Number.parseInt(instruction.operand, 16)

  for (let pc = 0; pc < code.length; ) {
    if (++run.steps > stepLimit) {
      stop("模型的构建步骤太多，只读取了前面的部分。")
      return null
    }
    const instruction = code[pc]!
    const { op, comment } = instruction
    let next = pc + 1
    const jump = (taken: boolean | undefined, atRest?: boolean) => {
      if (taken === undefined && run.stage) taken = atRest ?? false
      if (taken === undefined) {
        // The branch depends on something only the running game knows.
        stop("模型的一部分由游戏运行时才知道的条件决定，没有读取。")
        return false
      }
      if (taken) {
        const index = at.get(instruction.target ?? -1)
        if (index === undefined) return false
        next = index
      }
      return true
    }
    if (/^[ilfd]const_/.test(op)) stack.push(op === "iconst_m1" ? -1 : Number(op.at(-1)))
    else if (op === "aconst_null") stack.push(null)
    else if (op === "bipush") stack.push((Number.parseInt(instruction.operand, 16) << 24) >> 24)
    else if (op === "sipush") stack.push((Number.parseInt(instruction.operand, 16) << 16) >> 16)
    else if (op === "ldc" || op === "ldc_w" || op === "ldc2_w")
      stack.push(/^-?(\d+(\.\d+)?(e[+-]?\d+)?|Infinity)$/i.test(comment) ? Number(comment) : comment)
    else if (/^[ailfd]load(_\d)?$/.test(op)) stack.push(locals.get(local(instruction)) ?? unknown)
    else if (/^[ailfd]store(_\d)?$/.test(op)) locals.set(local(instruction), pop())
    else if (op === "iinc") {
      const index = Number.parseInt(instruction.operand.slice(0, 2), 16)
      const delta = (Number.parseInt(instruction.operand.slice(2, 4), 16) << 24) >> 24
      const value = locals.get(index)
      locals.set(index, known(value) ? value + delta : unknown)
    } else if (op === "pop") pop()
    else if (op === "pop2") {
      pop()
      pop()
    } else if (op === "dup") stack.push(stack.at(-1) ?? unknown)
    else if (op === "dup_x1") {
      const first = pop(),
        second = pop()
      stack.push(first, second, first)
    } else if (op === "dup2") stack.push(stack.at(-2) ?? unknown, stack.at(-1) ?? unknown)
    else if (op === "swap") {
      const first = pop(),
        second = pop()
      stack.push(first, second)
    } else if (/^[fdil]neg$/.test(op)) {
      const value = pop()
      stack.push(known(value) ? -value : unknown)
    } else if (/^[fdil](add|sub|mul|div|rem)$/.test(op)) {
      const right = pop(),
        left = pop()
      if (!known(left) || !known(right)) stack.push(unknown)
      else {
        const whole = op[0] === "i" || op[0] === "l"
        const result = op.endsWith("add")
          ? left + right
          : op.endsWith("sub")
            ? left - right
            : op.endsWith("mul")
              ? left * right
              : op.endsWith("div")
                ? left / right
                : left % right
        stack.push(whole ? Math.trunc(result) : result)
      }
    } else if (/^[ifdl]2[ifdlbcs]$/.test(op)) {
      const value = pop()
      stack.push(known(value) ? (/[ilbcs]$/.test(op) ? Math.trunc(value) : value) : unknown)
    } else if (/^if_icmp/.test(op)) {
      const right = pop(),
        left = pop()
      const test = { eq: left === right, ne: left !== right, lt: num(left) < num(right), ge: num(left) >= num(right), gt: num(left) > num(right), le: num(left) <= num(right) }[op.slice(7)]
      const assumed = known(left) && known(right) ? 0 : guess(run.stage)
      const one = known(left) ? left : assumed,
        two = known(right) ? right : assumed
      const rest = { eq: one === two, ne: one !== two, lt: one < two, ge: one >= two, gt: one > two, le: one <= two }[op.slice(7)]
      if (!jump(known(left) && known(right) ? test : undefined, rest)) return null
    } else if (/^if(eq|ne|lt|ge|gt|le)$/.test(op)) {
      const value = pop()
      const test = { eq: value === 0, ne: value !== 0, lt: num(value) < 0, ge: num(value) >= 0, gt: num(value) > 0, le: num(value) <= 0 }[op.slice(2)]
      const assumed = known(value) ? value : guess(run.stage)
      const rest = { eq: assumed === 0, ne: assumed !== 0, lt: assumed < 0, ge: assumed >= 0, gt: assumed > 0, le: assumed <= 0 }[op.slice(2)]
      if (!jump(known(value) ? test : undefined, rest)) return null
    } else if (op === "ifnull" || op === "ifnonnull") {
      const value = pop()
      const isNull = value === null ? true : is(value, "unknown") ? undefined : false
      if (!jump(isNull === undefined ? undefined : op === "ifnull" ? isNull : !isNull, isNull === undefined && (op === "ifnull") === (guess(run.stage) === 1))) return null
    } else if (op === "if_acmpeq" || op === "if_acmpne") {
      const right = pop(),
        left = pop()
      const same = is(left, "unknown") || is(right, "unknown") ? undefined : left === right
      if (!jump(same === undefined ? undefined : op === "if_acmpeq" ? same : !same, same === undefined && (op === "if_acmpeq") === (guess(run.stage) === 1))) return null
    } else if (op === "goto" || op === "goto_w") jump(true)
    else if (/^[fd]cmp[lg]$/.test(op) || op === "lcmp") {
      const right = pop(),
        left = pop()
      stack.push(known(left) && known(right) ? Math.sign(left - right) : unknown)
    } else if (op === "new") {
      const role = roleOf(run.roles, comment)
      if (role === "mesh") {
        const mesh: Mesh = { kind: "mesh", root: newPart("root") }
        run.meshes.push(mesh)
        stack.push(mesh)
      } else if (role === "deformation") stack.push({ kind: "deformation", grow: 0 })
      else if (role === "legacyPart" || isLegacyPartClass(run, comment)) {
        const created = newPart(`part_${run.parts.length}`)
        run.parts.push(created)
        stack.push(created)
      } else if (comment === "java/lang/StringBuilder") stack.push({ kind: "text", parts: [] })
      else if (comment === "java/util/Random") stack.push(seeded(0))
      else if (/^java\/util\/(ArrayList|LinkedList)$/.test(comment)) stack.push({ kind: "list", items: [] })
      else stack.push(unknown)
    } else if (op === "getstatic") {
      const type = instruction.member?.descriptor ?? ""
      const role = roleOf(run.roles, objectType(type))
      if (role === "deformation") stack.push({ kind: "deformation", grow: 0 })
      else if (role === "pose") stack.push(zeroPose())
      else if ((type === "F" || type === "D") && /PI$/i.test(instruction.member?.name ?? "")) stack.push(Math.PI)
      else if (/^\[*[IFDBSJ]$/.test(type) && instruction.member) {
        // A table of numbers the class fills in when it is first used: replay that set-up once, then read from it.
        const holder = instruction.member.owner
        if (!run.prepared.has(holder)) {
          run.prepared.add(holder)
          const code = run.lookup(holder)
          const setup = code?.methods.find((entry) => entry.name === "<clinit>")
          if (code && setup && setup.instructions.length <= 4000 && depth < 24) {
            const posing = run.stage
            run.stage = undefined
            interpret(run, code, setup, [], depth + 1)
            run.stage = posing
          }
        }
        stack.push(run.statics.get(`${holder}.${instruction.member.name}`) ?? unknown)
      } else stack.push(unknown)
    } else if (op === "putstatic") {
      const value = pop()
      if (method.name === "<clinit>" && instruction.member) run.statics.set(`${instruction.member.owner}.${instruction.member.name}`, value)
    }
    else if (op === "getfield") {
      const target = pop()
      const field = instruction.member?.name ?? ""
      if (is(target, "self")) {
        // While posing, flags and timers the game would set (attacking, riding, a swing in progress) are at rest.
        const primitive = run.stage && !/^[L[]/.test(instruction.member?.descriptor ?? "L")
        stack.push(target.fields.get(field) ?? (primitive ? 0 : unknown))
      } else if (is(target, "part")) {
        const slot = partFields[field]
        stack.push(
          slot === "mirror"
            ? Number(target.mirror)
            : slot === "visible"
              ? Number(target.visible)
              : slot === "bare"
                ? Number(target.bare)
                : slot
                  ? target.pose[slot[0]][slot[1]]
                  : unknown,
        )
      } else stack.push(unknown)
    } else if (op === "putfield") {
      const value = pop(),
        target = pop()
      const field = instruction.member?.name ?? ""
      if (is(target, "self")) {
        target.fields.set(field, value)
        if (is(value, "part") && !run.partNames.has(value)) run.partNames.set(value, field)
        const side = textureFields[field]
        if (side !== undefined && known(value)) target.texture[side] = value
      } else if (is(target, "part")) {
        const slot = partFields[field]
        // While posing, a value that depends on the running game leaves the part as it was.
        if (run.stage && !known(value)) {
          // Nothing to write.
        } else if (slot === "mirror") target.mirror = num(value) !== 0
        else if (slot === "visible") target.visible = num(value) !== 0
        else if (slot === "bare") target.bare = num(value) !== 0
        else if (slot) target.pose[slot[0]][slot[1]] = num(value)
      }
    } else if (op === "invokedynamic") {
      // String concatenation is the only dynamic call that matters here: it names parts.
      const match = comment.match(/^bootstrap#(\d+) ([^:]+):(.+)$/)
      const { args: dynamicArgs, returns } = parseDescriptor(match?.[3] ?? "()V")
      const values = dynamicArgs.map(() => pop()).reverse()
      const recipe = owner.bootstraps.find((entry) => entry.index === Number(match?.[1]))?.arguments[0]
      if (match?.[2] === "makeConcatWithConstants" && typeof recipe === "string") {
        let index = 0
        stack.push(recipe.replace(/\u0001/g, () => text(values[index++])))
      } else if (returns !== "V") stack.push(unknown)
    } else if (/^invoke(static|virtual|special|interface)$/.test(op)) {
      const member = instruction.member
      if (!member) return null
      const { args: argTypes, returns } = parseDescriptor(member.descriptor)
      const values = argTypes.map(() => pop()).reverse()
      const target = op === "invokestatic" ? undefined : pop()
      const result = call(run, owner, { op, member, argTypes, returns, values, target }, depth)
      if (returns !== "V" && result !== undefined) stack.push(result)
      else if (returns !== "V") stack.push(unknown)
    } else if (op === "areturn" || op === "ireturn" || op === "freturn" || op === "dreturn" || op === "lreturn") return pop()
    else if (op === "return") return null
    else if (op === "checkcast" || op === "nop") {
      // No effect on the values tracked here.
    } else if (op === "instanceof") {
      pop()
      stack.push(unknown)
    } else if (op === "arraylength") {
      const value = pop()
      stack.push(is(value, "list") ? value.items.length : unknown)
    } else if (op === "anewarray" || op === "newarray") {
      const length = pop()
      stack.push(known(length) && length <= 4096 ? { kind: "list", items: Array.from({ length }, () => unknown as Value) } : unknown)
    } else if (/^[aifdbcsl]aload$/.test(op)) {
      const index = pop(),
        array = pop()
      stack.push(is(array, "list") && known(index) ? (array.items[index] ?? unknown) : unknown)
    } else if (/^[aifdbcsl]astore$/.test(op)) {
      const value = pop(),
        index = pop(),
        array = pop()
      if (is(array, "list") && known(index)) array.items[index] = value
    } else if (op === "tableswitch" || op === "lookupswitch") {
      // Operand bytes: default, then (low, high, offsets…) or (count, (match, offset)…), all relative to this instruction.
      const key = pop()
      const words = instruction.operand.match(/.{8}/g)?.map((word) => Number.parseInt(word, 16) | 0) ?? []
      let relative = words[0] ?? 0
      if (!known(key)) {
        stop("模型的一部分由游戏运行时才知道的条件决定，没有读取。")
        return null
      }
      if (op === "tableswitch") {
        const low = words[1] ?? 0,
          high = words[2] ?? -1
        if (key >= low && key <= high) relative = words[3 + key - low] ?? relative
      } else
        for (let index = 2; index + 1 < words.length; index += 2) if (words[index] === key) relative = words[index + 1]!
      const index = at.get(instruction.offset + relative)
      if (index === undefined) return null
      next = index
    } else if (op === "athrow") return null
    else {
      stop("模型的一部分用到了读取不了的写法，没有读取。")
      return null
    }
    pc = next
  }
  return null
}

const text = (value: Value | undefined) =>
  typeof value === "string" ? value : known(value) ? String(value) : is(value, "text") ? value.parts.join("") : "x"

function isLegacyPartClass(run: Run, internal: string) {
  if (run.roles.legacyPart) return run.roles.legacyPart === internal
  return false
}

type Call = {
  op: string
  member: { owner: string; name: string; descriptor: string }
  argTypes: string[]
  returns: string
  values: Value[]
  target: Value | undefined
}

/** One method call. Returns the value it leaves on the stack, or undefined for "nothing known". */
function call(run: Run, owner: ClassCode, input: Call, depth: number): Value | undefined {
  const { op, member, argTypes, returns, values, target } = input
  const roles = run.roles
  const ownerRole = roleOf(roles, member.owner)
  const returned = objectType(returns)
  const returnedRole = roleOf(roles, returned)
  const floats = values.filter((_, index) => argTypes[index] === "F" || argTypes[index] === "D").map(num)
  const ints = values.filter((_, index) => argTypes[index] === "I").map(num)
  const find = <K extends string>(kind: K) => values.find((value) => is(value, kind)) as Extract<Value, { kind: K }> | undefined

  // Strings: part names are often built from pieces.
  if (member.owner === "java/lang/StringBuilder") {
    if (member.name === "<init>") {
      if (is(target, "text") && values.length) target.parts.push(text(values[0]))
      return undefined
    }
    if (member.name === "append" && is(target, "text")) {
      target.parts.push(text(values[0]))
      return target
    }
    if (member.name === "toString") return text(target)
  }
  if (member.owner === "java/lang/String" && member.name === "valueOf") return text(values[0])
  // The game's own sine and cosine read from a table built at start-up, which cannot be replayed. They are
  // recognised by the table's scale constant when the game's code is at hand, else by their names.
  if (op === "invokestatic" && member.descriptor === "(F)F") {
    const body = resolveMethod(run.lookup, member.owner, member.name, member.descriptor)?.method.instructions
    const tabled = body?.some((line) => line.includes("10430.378"))
    const kind = tabled
      ? body!.some((line) => line.includes("16384.0"))
        ? "cos"
        : "sin"
      : /(^|\/)(Mth|MathHelper|class_3532)$/.test(member.owner)
        ? gameTrig[member.name]
        : undefined
    if (kind) return known(values[0]) ? (kind === "sin" ? Math.sin(num(values[0])) : Math.cos(num(values[0]))) : unknown
  }
  if (member.owner === "java/lang/Math" || member.owner === "java/lang/StrictMath") {
    const [first = 0, second = 0] = values.map(num)
    if (!values.every(known)) return unknown
    const table: Record<string, number> = {
      toRadians: (first * Math.PI) / 180,
      toDegrees: (first * 180) / Math.PI,
      sin: Math.sin(first),
      cos: Math.cos(first),
      abs: Math.abs(first),
      max: Math.max(first, second),
      min: Math.min(first, second),
      sqrt: Math.sqrt(first),
      floor: Math.floor(first),
      ceil: Math.ceil(first),
    }
    return member.name in table ? table[member.name] : unknown
  }
  if (op === "invokestatic" && argTypes.length === 1 && argTypes[0] === returns && (returns === "F" || returns === "D") && waves[member.name])
    return known(values[0]) ? waves[member.name]!(values[0]) : unknown
  if (member.owner === "java/util/Random" && member.name === "<init>") {
    if (is(target, "random")) Object.assign(target, seeded(num(values[0])))
    return undefined
  }
  if (op === "invokestatic" && argTypes.join("") === "J" && returned && /Random|class_5819/.test(simpleName(returned))) return seeded(num(values[0]))
  if (is(target, "random")) return drawRandom(target, member.name, argTypes, returns, values)
  if (/^java\/util\//.test(member.owner) && is(target, "list")) {
    if (member.name === "add") {
      target.items.push(values.at(-1) ?? unknown)
      return 1
    }
    if (member.name === "size") return target.items.length
    if (member.name === "get") return target.items[num(values[0])] ?? unknown
  }

  // ---- layer models (1.17+)
  if (ownerRole === "deformation") {
    if (member.name === "<init>") {
      if (is(target, "deformation")) target.grow = floats[0] ?? 0
      return undefined
    }
    if (is(target, "deformation") && returnedRole === "deformation") return { kind: "deformation", grow: target.grow + (floats[0] ?? 0) }
  }
  if (ownerRole === "cubes" || (returnedRole === "cubes" && (op === "invokestatic" || is(target, "cubes")))) {
    if (op === "invokestatic" && !argTypes.length) return { kind: "cubes", cubes: [], uv: [0, 0], mirror: false }
    if (is(target, "cubes")) {
      if (floats.length >= 6) {
        const flag = values.find((_, index) => argTypes[index] === "Z")
        target.cubes.push({
          origin: [floats[0]!, floats[1]!, floats[2]!],
          size: [floats[3]!, floats[4]!, floats[5]!],
          uv: ints.length >= 2 ? [ints[0]!, ints[1]!] : [...target.uv],
          inflate: find("deformation")?.grow ?? 0,
          mirror: known(flag) ? flag !== 0 : target.mirror,
        })
      } else if (argTypes.length === 2 && ints.length === 2) target.uv = [ints[0]!, ints[1]!]
      else if (!argTypes.length) target.mirror = true
      else if (argTypes.length === 1 && argTypes[0] === "Z") target.mirror = num(values[0]) !== 0
      return target
    }
  }
  if (returnedRole === "pose" && op === "invokestatic") {
    if (floats.length === 6)
      return { kind: "pose", offset: [floats[0]!, floats[1]!, floats[2]!], rotation: [floats[3]!, floats[4]!, floats[5]!] }
    if (floats.length === 3)
      return rotationOnly.has(member.name)
        ? { kind: "pose", offset: [0, 0, 0], rotation: [floats[0]!, floats[1]!, floats[2]!] }
        : { kind: "pose", offset: [floats[0]!, floats[1]!, floats[2]!], rotation: [0, 0, 0] }
  }
  if (ownerRole === "mesh") {
    if (member.name === "<init>") return undefined
    if (is(target, "mesh") && returnedRole === "part") return target.root
  }
  if (ownerRole === "part" && is(target, "part") && returnedRole === "part") {
    const label = typeof values[0] === "string" ? values[0] : is(values[0], "text") ? text(values[0]) : `part_${target.children.size}`
    const cubes = find("cubes")
    if (cubes) return addChild(target, label, cubes.cubes, find("pose") ?? zeroPose())
    return target.children.get(label) ?? addChild(target, label, [], zeroPose())
  }
  if (returnedRole === "layer" && op === "invokestatic" && member.owner === returned) {
    const mesh = find("mesh")
    if (mesh) return { kind: "layer", mesh, texture: [ints[0] ?? 64, ints[1] ?? 32] }
  }

  // ---- part models (1.16 and earlier)
  if (member.name === "<init>" && is(target, "part")) {
    // new Part(model, u, v) / new Part(model) / new Part(model, texW, texH, u, v)
    if (ints.length === 2) target.uv = [ints[0]!, ints[1]!]
    else if (ints.length === 4) target.uv = [ints[2]!, ints[3]!]
    roles.legacyPart ??= member.owner
    return undefined
  }
  if (is(target, "part") && member.owner === roles.legacyPart) {
    const part = find("part")
    if (part && argTypes.length === 1) {
      // addChild(child)
      part.attached = true
      target.children.set(run.partNames.get(part) ?? part.name, part)
      return undefined
    }
    const numbers = values.filter((_, index) => /^[FDI]$/.test(argTypes[index]!)).map(num)
    const strings = argTypes.filter((type) => type === "Ljava/lang/String;").length
    if (numbers.length >= 6 && argTypes.filter((type) => type === "F").length >= 3) {
      // addBox(x, y, z, w, h, d[, grow][, mirror]) with float or int sizes; named variants carry (u, v) last.
      const named = strings > 0 && ints.length >= 2 && argTypes.at(-1) === "I" && argTypes.filter((type) => type === "F").length >= 6
      const flag = values.find((_, index) => argTypes[index] === "Z")
      target.cubes.push({
        origin: [numbers[0]!, numbers[1]!, numbers[2]!],
        size: [numbers[3]!, numbers[4]!, numbers[5]!],
        uv: named ? [numbers.at(-2)!, numbers.at(-1)!] : [...target.uv],
        inflate: named ? 0 : (numbers[6] ?? 0),
        mirror: known(flag) ? flag !== 0 : target.mirror,
      })
      return returnedRole === "legacyPart" || returned === member.owner ? target : undefined
    }
    if (argTypes.length === 3 && floats.length === 3 && returns === "V") {
      // setRotationPoint(x, y, z)
      if (!run.stage || values.every(known)) target.pose.offset = [floats[0]!, floats[1]!, floats[2]!]
      return undefined
    }
    if (argTypes.length === 2 && ints.length === 2 && returned === member.owner) {
      // setTextureOffset(u, v)
      target.uv = [ints[0]!, ints[1]!]
      return target
    }
    if (returned === member.owner) return target
  }
  if (is(target, "self") && returns === "V" && argTypes.length === 2 && ints.length === 2 && !run.lookup(member.owner)?.methods.some((method) => method.name === member.name && method.descriptor === member.descriptor && method.instructions.length)) {
    // model.setTextureSize(w, h) inherited from the game's base model class.
    target.texture = [ints[0]!, ints[1]!]
    return undefined
  }

  // ---- a finished model being posed and drawn
  if (run.stage) {
    const stage = run.stage
    const flat = () => values.flatMap((value) => (is(value, "list") ? value.items : [value]))
    if (op === "invokestatic" && returned && /^(com\/google\/common\/collect\/Immutable(List|Set)|java\/util\/(List|Set|Arrays))$/.test(member.owner) && argTypes.every((type) => /^[L[]/.test(type)))
      return { kind: "list", items: flat() }
    if (op === "invokestatic" && /\/Iterables$/.test(member.owner) && member.name === "concat") return { kind: "list", items: flat() }
    if (is(target, "list")) {
      if (/^add(All)?$/.test(member.name)) {
        target.items.push(...flat())
        return returns === "Z" ? 1 : target
      }
      if (member.name === "build") return target
      // Handing the list to a loop: which of the parts get drawn there cannot be told apart.
      if (/^(forEach|iterator|stream)$/.test(member.name)) {
        target.items.forEach((item) => (is(item, "part") ? stage.drawn.add(item) : (stage.inherited = true)))
        return returns === "V" ? undefined : unknown
      }
    }
    const drawing = drawShape.test(member.descriptor)
    const alpha = () => {
      if (floats.length === 4 && known(values.at(-1))) stage.opacity = Math.min(stage.opacity, Math.max(0, floats[3]!))
    }
    if (is(target, "part") && ownerRole !== "part" && member.owner !== roles.legacyPart) {
      if (argTypes.length === 1 && argTypes[0] === "Ljava/lang/String;") {
        const child = target.children.get(text(values[0]))
        return returns === "Z" ? Number(!!child) : (child ?? unknown)
      }
      if (drawing) {
        stage.drawn.add(target)
        alpha()
        return undefined
      }
      if (argTypes.join("") === "FFF" && returns === "V") {
        if (values.every(known)) target.pose[rotationSetters.has(member.name) ? "rotation" : "offset"] = [floats[0]!, floats[1]!, floats[2]!]
        return undefined
      }
      const other = values[0]
      if (argTypes.length === 1 && returns === "V" && is(other, "part")) {
        // copyFrom(other): take the other part's place and turn.
        target.pose = { kind: "pose", offset: [...other.pose.offset], rotation: [...other.pose.rotation] }
        return undefined
      }
      return undefined
    }
    if (drawing && op !== "invokestatic" && !is(target, "part")) {
      // Drawing handed to the base class, or to a part that could not be followed.
      // How see-through it is asked to be counts whether or not the base class can be read.
      if (is(target, "self")) alpha()
      const own = is(target, "self") && resolveMethod(run.lookup, op === "invokespecial" ? member.owner : (target.type ?? owner.name), member.name, member.descriptor)
      if (!own) {
        stage.inherited = true
        return undefined
      }
    }
  }

  // ---- anything else: follow the call when its code is available and it touches the model
  const touches =
    [target, ...values].some((value) => is(value, "part") || is(value, "mesh") || is(value, "cubes") || is(value, "self")) ||
    ["mesh", "layer", "part", "cubes", "pose"].includes(returnedRole ?? "")
  if (touches && depth < 12 && member.name !== "<init>") {
    // A call on the model itself starts at the model's own class; super.method() starts at the named parent.
    const start = op === "invokevirtual" && is(target, "self") ? (target.type ?? owner.name) : undefined
    const resolved = resolveMethod(run.lookup, member.owner, member.name, member.descriptor, start)
    if (resolved) {
      learnRoles(roles, resolved.method)
      return interpret(run, resolved.owner, resolved.method, op === "invokestatic" ? values : [target ?? unknown, ...values], depth + 1) ?? undefined
    }
  }
  if (member.name === "<init>" && is(target, "self") && depth < 12) {
    // super(...) of a model whose parent class is also in the mod.
    const resolved = resolveMethod(run.lookup, member.owner, "<init>", member.descriptor)
    if (resolved) interpret(run, resolved.owner, resolved.method, [target, ...values], depth + 1)
    else if (run.stage) {
      // The game's own base model: it keeps the standard parts in its standard fields.
      const root = values.find((value) => is(value, "part"))
      if (root && is(root, "part")) bindBaseFields(target, root)
    }
    return undefined
  }
  if (returnedRole === "mesh") {
    // A base mesh from the game itself, and the game's files are not available.
    const grow = find("deformation")?.grow ?? 0
    const base =
      argTypes.length === 2 && argTypes[0] === "I"
        ? quadrupedMesh(num(values[0]), grow)
        : argTypes.length === 2 && argTypes[1] === "F"
          ? humanoidMesh(grow, num(values[1]))
          : null
    if (!base) {
      run.partial = true
      run.diagnostics.add(`${simpleName(member.owner)} 提供的基础模型需要原版游戏文件，这里只显示在它之上添加的部分。`)
    }
    const mesh = base ?? { kind: "mesh" as const, root: newPart("root") }
    run.meshes.push(mesh)
    return mesh
  }
  if (returnedRole === "layer") {
    run.partial = true
    run.diagnostics.add(`${simpleName(member.owner)} 的模型需要原版游戏文件。`)
  }
  return undefined
}

/** The game's sine and cosine under each naming the game has shipped with. */
const gameTrig: Record<string, "sin" | "cos"> = {
  sin: "sin",
  cos: "cos",
  m_14031_: "sin",
  m_14089_: "cos",
  method_15374: "sin",
  method_15362: "cos",
  func_76126_a: "sin",
  func_76134_b: "cos",
}

function resolveMethod(lookup: ClassLookup, owner: string, name: string, descriptor: string, startAt?: string) {
  // Virtual calls on the model itself start at the model's own class, then walk up.
  let current = lookup(startAt ?? owner)
  for (let depth = 0; current && depth < 16; depth++) {
    const method = current.methods.find((entry) => entry.name === name && entry.descriptor === descriptor && entry.instructions.length)
    if (method) return { owner: current, method }
    current = current.superclass ? lookup(current.superclass) : null
  }
  return null
}

// ---------------------------------------------------------------- output

const degrees = (radians: number) => Math.round(((radians * 180) / Math.PI) * 1000) / 1000

function toGeometry(roots: [Part, string][], texture: [number, number], identifier: string): JavaModelGeometry {
  const bones: JavaModelGeometry["minecraft:geometry"][number]["bones"] = []
  const used = new Set<string>()
  const walk = (node: Part, label: string, parent: string | undefined, base: [number, number, number], depth: number) => {
    if (depth > 64 || bones.length >= 512 || !node.visible) return
    const pivot: [number, number, number] = [base[0] + node.pose.offset[0], base[1] + node.pose.offset[1], base[2] + node.pose.offset[2]]
    let name = label.replace(/[^\w.-]/g, "_").slice(0, 60) || "part"
    for (let index = 2; used.has(name); index++) name = `${label}_${index}`
    used.add(name)
    const [rx, ry, rz] = node.pose.rotation
    bones.push({
      name,
      ...(parent ? { parent } : {}),
      // Java parts hang downwards from y = 24; Bedrock geometry grows upwards from the ground.
      // The x axis and the rotation angles carry over unchanged between the two formats.
      pivot: [pivot[0], 24 - pivot[1], pivot[2]],
      ...(rx || ry || rz ? { rotation: [degrees(rx), degrees(ry), degrees(rz)] as [number, number, number] } : {}),
      cubes: (node.bare ? [] : node.cubes)
        .filter((cube) => [...cube.size, ...cube.origin].every(Number.isFinite) && cube.size.every((side) => Math.abs(side) <= 256))
        .map((cube) => ({
          origin: [pivot[0] + cube.origin[0], 24 - (pivot[1] + cube.origin[1] + cube.size[1]), pivot[2] + cube.origin[2]],
          // Flat planes (wings, fins) have a zero side; the loader needs a hair of thickness.
          size: cube.size.map((side) => Math.max(Math.abs(side), 0.01)) as [number, number, number],
          uv: [Math.trunc(cube.uv[0]), Math.trunc(cube.uv[1])],
          ...(cube.inflate ? { inflate: cube.inflate } : {}),
          ...(cube.mirror ? { mirror: true } : {}),
        })),
    })
    node.children.forEach((child, key) => walk(child, key, name, pivot, depth + 1))
  }
  roots.forEach(([part, label]) => walk(part, label, undefined, [0, 0, 0], 0))
  const size = (value: number, fallback: number) => (Number.isInteger(value) && value >= 1 && value <= 4096 ? value : fallback)
  return {
    format_version: "1.12.0",
    "minecraft:geometry": [
      { description: { identifier, texture_width: size(texture[0], 64), texture_height: size(texture[1], 32) }, bones },
    ],
  }
}

const cubeCount = (geometry: JavaModelGeometry) =>
  geometry["minecraft:geometry"][0]!.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)

const newRun = (lookup: ClassLookup, roles: BuilderRoles = {}): Run => ({
  roles,
  lookup,
  steps: 0,
  partial: false,
  diagnostics: new Set(),
  parts: [],
  partNames: new Map(),
  meshes: [],
  statics: new Map(),
  prepared: new Set(),
})

/** Models of the game itself whose arms reach forward. */
const reaching = /Zombie|Drowned|Husk|Giant/
function reach(root: Part) {
  for (const arm of ["right_arm", "left_arm"]) {
    const part = root.children.get(arm)
    if (part) part.pose.rotation[0] = -Math.PI / 2
  }
}

/**
 * Pose a finished shape the way the game shows it standing still.
 *
 * A model class does three things beyond building its parts, and all three change what is on screen:
 * it picks which parts are drawn at all, it moves and turns parts every frame, and it may draw itself
 * see-through. This replays those methods of the class with the creature at rest (no movement, time zero).
 */
function stageModel(base: Run, model: ClassCode, root: Part | null, built?: Self) {
  const stage: Stage = { drawn: new Set(), inherited: false, opacity: 1, pattern: 0, asked: 0 }
  const run: Run = { ...newRun(base.lookup, base.roles), parts: base.parts, partNames: base.partNames, stage }
  const chain: ClassCode[] = []
  for (let current: ClassCode | null | undefined = model; current && chain.length < 16; current = current.superclass ? base.lookup(current.superclass) : null)
    chain.push(current)
  const real = (method: MethodCode) => !isStatic(method) && method.instructions.length > 0 && (method.access & 0x1040) === 0
  /** The most derived method with this shape, plus the class that holds it. */
  const first = (shape: RegExp) => {
    for (const owner of chain) {
      const method = owner.methods.find((entry) => real(entry) && entry.name !== "<init>" && shape.test(entry.descriptor))
      if (method) return { owner, method }
    }
    return null
  }
  const invoke = (found: { owner: ClassCode; method: MethodCode }, self: Self, fill: (type: string) => Value) =>
    interpret(run, found.owner, found.method, [self, ...parseDescriptor(found.method.descriptor).args.map(fill)], 0)

  let self = built
  if (!self) {
    if (!root) return stage
    // A layer model is a class wrapped around the finished part tree: build it to learn which field holds which part.
    const constructor = model.methods
      .filter((method) => method.name === "<init>" && method.instructions.length && parseDescriptor(method.descriptor).args.some(objectType))
      .sort((one, two) => parseDescriptor(one.descriptor).args.length - parseDescriptor(two.descriptor).args.length)[0]
    if (!constructor) return stage
    self = { kind: "self", fields: new Map(), texture: [64, 32], type: model.name }
    let given = false
    invoke({ owner: model, method: constructor }, self, (type) => {
      if (!objectType(type) || given) return unknown
      given = true
      return root
    })
    if (![...self.fields.values()].some((value) => is(value, "part") || is(value, "list"))) return stage
  }
  self.type ??= model.name

  if (root) {
    // Which parts are drawn: the model's own draw method, or the two part lists the game's base class asks for.
    const draw = first(drawShape)
    if (draw) invoke(draw, self, (type) => (type === "F" ? 1 : type === "I" ? 0 : unknown))
    const lists: Value[] = []
    const seen = new Set<string>()
    for (const owner of chain)
      for (const method of owner.methods)
        if (real(method) && method.descriptor === "()Ljava/lang/Iterable;" && !seen.has(method.name)) {
          seen.add(method.name)
          lists.push(interpret(run, owner, method, [self], 0))
        }
    const listed = lists.flatMap((list) => (is(list, "list") ? list.items : [unknown]))
    let keep: Set<Part> | null = null
    if (draw && !stage.inherited && stage.drawn.size) keep = stage.drawn
    else if (lists.length === 2 && listed.length && listed.every((item) => is(item, "part")))
      keep = new Set([...(listed as Part[]), ...stage.drawn])
    const prune = (node: Part) => {
      for (const [name, child] of [...node.children]) {
        if (keep!.has(child)) continue
        prune(child)
        if (child.children.size) child.bare = true
        else node.children.delete(name)
      }
    }
    // Drawing a part draws everything under it, so a model that draws its root keeps the lot.
    if (keep && !keep.has(root)) prune(root)
  }

  // How it stands: the per-frame methods with every input at zero. Questions about the creature's state
  // ("is it carrying something?") cannot be answered here, so the methods are replayed several times with
  // different answers, and only what comes out the same every time is kept.
  // The first ancestor that belongs to the game: its own pose code is not here, but a zombie's reach is well known.
  const ancestor = chain.at(-1)?.superclass
  const reaches = !!root && ((!!ancestor && reaching.test(simpleName(ancestor))) || chain.some((entry) => /^net\/minecraft\//.test(entry.name) && reaching.test(simpleName(entry.name))))
  if (reaches) reach(root!)
  const parts = new Set<Part>(base.parts)
  const collect = (node: Part) => {
    if (parts.has(node) && node !== root) return
    parts.add(node)
    node.children.forEach(collect)
  }
  if (root) collect(root)
  self.fields.forEach((value) => {
    if (is(value, "part")) collect(value)
    else if (is(value, "list")) value.items.forEach((item) => is(item, "part") && collect(item))
  })
  type Stance = [number, number, number, number, number, number, number, number]
  const read = (part: Part): Stance => [...part.pose.offset, ...part.pose.rotation, Number(part.visible), Number(part.bare)]
  const write = (part: Part, stance: Stance) => {
    part.pose.offset = [stance[0], stance[1], stance[2]]
    part.pose.rotation = [stance[3], stance[4], stance[5]]
    part.visible = stance[6] !== 0
    part.bare = stance[7] !== 0
  }
  const before = new Map([...parts].map((part) => [part, read(part)]))
  const rest = (type: string) => (objectType(type) ? unknown : 0)
  const replay = (pattern: number) => {
    stage.pattern = pattern
    stage.asked = 0
    before.forEach((stance, part) => write(part, stance))
    for (const shape of [/^\(L[^;]+;FFF\)V$/, /^\(L[^;]+;F{5}\)V$/, /^\(F{6}L[^;]+;\)V$/]) {
      const found = first(shape)
      if (found) invoke(found, self!, rest)
    }
    return new Map([...parts].map((part) => [part, read(part)]))
  }
  const replays = [0, 1, 2, 3, 4, 5, 6, 7].map(replay)
  stage.pattern = 0
  before.forEach((stance, part) => {
    const first = replays[0]!.get(part)!
    write(
      part,
      stance.map((value, index) =>
        Number.isFinite(first[index]) && replays.every((result) => Math.abs(result.get(part)![index]! - first[index]!) < 1e-6) ? first[index]! : value,
      ) as Stance,
    )
  })
  // The reach is decided by whether the creature is attacking, which a replay cannot settle; it stays as set.
  if (reaches) reach(root!)
  return stage
}


/** Static methods that return a layer definition: the entry points of 1.17+ models. */
export function layerMethods(code: ClassCode, layerType?: string) {
  return code.methods.filter((method) => {
    if (!isStatic(method) || !method.instructions.length) return false
    const returned = objectType(parseDescriptor(method.descriptor).returns)
    if (!returned) return false
    if (layerType) return returned === layerType
    return knownNames[simpleName(returned)] === "layer" || learnRoles({}, method).layer === returned
  })
}

/** Replay a 1.17+ layer method into geometry. */
export function readLayerModel(
  owner: ClassCode,
  method: MethodCode,
  lookup: ClassLookup,
  identifier = `geometry.${simpleName(owner.name)}`,
  /** The class the game wraps around this shape, when it is not the one that builds it; a name alone for the game's own classes. */
  wrapper?: { code?: ClassCode | null; name?: string },
): JavaModelResult | null {
  const run = newRun(lookup)
  learnRoles(run.roles, method)
  const declared = objectType(parseDescriptor(method.descriptor).returns)
  if (declared && !declared.startsWith("java/")) run.roles.layer ??= declared
  const result = interpret(run, owner, method, [], 0)
  const layer = is(result, "layer") ? result : undefined
  const mesh = layer?.mesh ?? (is(result, "mesh") ? result : run.meshes[0])
  if (!mesh) return null
  const output = () =>
    toGeometry(
      [...mesh.root.children].map(([name, part]) => [part, name] as [Part, string]),
      layer?.texture ?? [64, 32],
      identifier,
    )
  const plain = output()
  if (!cubeCount(plain)) return null
  let geometry = plain
  let opacity = 1
  const model = wrapper?.code ?? (wrapper?.name ? null : owner)
  if (model) {
    try {
      opacity = stageModel(run, model, mesh.root).opacity
      const posed = output()
      // Posing must never cost the shape: if it hid everything, the unposed shape stands.
      if (cubeCount(posed)) geometry = posed
      else opacity = 1
    } catch {
      // The unposed shape is still a faithful build of the parts.
    }
  } else if (wrapper?.name && reaching.test(simpleName(wrapper.name))) {
    reach(mesh.root)
    geometry = output()
  }
  return {
    geometry,
    source: `${owner.name}.${method.name}`,
    cubeCount: cubeCount(geometry),
    partial: run.partial || method.truncated || !layer,
    diagnostics: [...run.diagnostics],
    ...(opacity < 1 ? { opacity } : {}),
  }
}

/** The pre-1.17 part class a model constructor builds with, recognised by `new Part(model, u, v)` plus box calls. */
function learnLegacyPart(model: ClassCode, lookup: ClassLookup) {
  const ancestors = new Set<string>()
  for (let current: ClassCode | null | undefined = model, depth = 0; current && depth < 16; depth++) {
    ancestors.add(current.name)
    if (current.superclass) ancestors.add(current.superclass)
    current = current.superclass ? lookup(current.superclass) : null
  }
  const created = new Map<string, number>()
  const boxed = new Set<string>()
  for (const method of model.methods)
    for (const line of method.instructions) {
      if (!line.includes("invoke")) continue
      const member = parseInstruction(line).member
      if (!member) continue
      const { args } = parseDescriptor(member.descriptor)
      const first = objectType(args[0] ?? "")
      if (
        member.name === "<init>" &&
        first &&
        /^(II|IIII)?$/.test(args.slice(1).join("")) &&
        (ancestors.has(first) || /Model/.test(simpleName(first)))
      )
        created.set(member.owner, (created.get(member.owner) ?? 0) + 1)
      if (args.filter((arg) => /^[FI]$/.test(arg)).length >= 6 && args.filter((arg) => arg === "F").length >= 3)
        boxed.add(member.owner)
    }
  return [...created].filter(([name]) => boxed.has(name)).sort((first, second) => second[1] - first[1])[0]?.[0]
}

/** Replay the constructor of a pre-1.17 model class into geometry. */
export function readPartModel(
  model: ClassCode,
  lookup: ClassLookup,
  identifier = `geometry.${simpleName(model.name)}`,
): JavaModelResult | null {
  const legacyPart = learnLegacyPart(model, lookup)
  if (!legacyPart) return null
  const constructor = model.methods
    .filter((method) => method.name === "<init>" && method.instructions.length)
    .sort(
      (first, second) => parseDescriptor(first.descriptor).args.length - parseDescriptor(second.descriptor).args.length,
    )[0]
  if (!constructor) return null
  const run = newRun(lookup, { legacyPart })
  const self: Self = { kind: "self", fields: new Map(), texture: [64, 32], type: model.name }
  interpret(run, model, constructor, [self], 0)
  const output = () =>
    toGeometry(
      run.parts.filter((part) => !part.attached).map((part) => [part, run.partNames.get(part) ?? part.name] as [Part, string]),
      self.texture,
      identifier,
    )
  let geometry = output()
  const cubes = cubeCount(geometry)
  if (!cubes) return null
  try {
    stageModel(run, model, null, self)
    const posed = output()
    if (cubeCount(posed)) geometry = posed
  } catch {
    // The unposed shape is still a faithful build of the parts.
  }
  return {
    geometry,
    source: `${model.name}.<init>`,
    cubeCount: cubes,
    partial: run.partial || constructor.truncated,
    diagnostics: [...run.diagnostics],
  }
}

/** Every shape a class defines: its layer methods, or its constructor for older models. */
export function readJavaModels(code: ClassCode, lookup: ClassLookup, layerType?: string): JavaModelResult[] {
  const layers = layerMethods(code, layerType).flatMap((method) => {
    const model = readLayerModel(code, method, lookup)
    return model ? [model] : []
  })
  if (layers.length) return layers
  const legacy = readPartModel(code, lookup)
  return legacy ? [legacy] : []
}

/**
 * Texture and model file names a class mentions, e.g. "bighorn.png" or "geo/deer.geo.json".
 * With a method name only that method is read, which is how a registration lambda names its texture.
 */
export function readJavaResourceNames(code: ClassCode, method?: string) {
  const named = (value: string) => /^[\w./:-]+\.(png|geo\.json)$/i.test(value)
  if (!method) return code.strings.filter(named)
  return code.methods
    .filter((entry) => entry.name === method)
    .flatMap((entry) => entry.instructions)
    .flatMap((line) => (/ ldc(_w)? /.test(line) && line.includes(" // ") ? [line.slice(line.indexOf(" // ") + 4)] : []))
    .filter(named)
}
