import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AbilitySchema, CreatureSoundsSchema, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { compileSoundRegistry, soundJava } from "../src/fabric/sound"
import { SOUND_INSTRUCTIONS, SOUND_LIMITS, SoundDocumentSchema, compileSoundData, creatureSoundIssues, creatureSoundIds, oggVorbisFacts, soundFileFacts, soundUseLines, type SoundDocument, type SoundLookup } from "../src/sound"
import { MODULES, ModuleKindSchema, kindCapability } from "../src/workspace-modules"
import { WorkspaceAssetSchema, WorkspaceSchema, getModuleSchema } from "../src/workspace"
import { ABILITY_SOUNDS } from "../src/ability-words"
import { CREATURE_SOUND_INSTRUCTIONS } from "../src/data-words"
import { ABILITY_INSTRUCTIONS } from "../src/creature-abilities"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { concat, oggDataUrl, oggVorbis, page } from "./ogg-sample"
import { compileTreeFor } from "./java-tree"

/** 任务二 §9 「自己的声音」: the sound asset, references to it, and what a build writes for it. */

const roarId = "a1b2c3d4-0000-4000-8000-000000000001"
const stepId = "a1b2c3d4-0000-4000-8000-000000000002"
const roar: SoundDocument = { kind: "sound", name: "chiyou_roar", files: [{ data: oggDataUrl(oggVorbis({ samples: 66150 })), duration: 1.5 }, { data: oggDataUrl(oggVorbis({ rate: 48000, samples: 96000 })), duration: 2, weight: 3 }], subtitle: { zh: "蚩尤怒吼", en: "Chiyou roars" }, category: "hostile", volume: 0.9, pitch: 1 }
const longStep: SoundDocument = { kind: "sound", name: "heavy_step", files: [{ data: oggDataUrl(oggVorbis({ samples: 88200 })), duration: 2 }], subtitle: null, category: null, volume: 1, pitch: 1 }
const lookup: SoundLookup = (id) => (id === roarId ? { title: "蚩尤怒吼", document: roar } : id === stepId ? { title: "沉重脚步", document: longStep } : null)

/** The game's own sounds, where Loom has downloaded them on this machine: real Vorbis files to read. */
const MINECRAFT_SOUNDS = path.join(process.env.APPDATA ?? path.join(os.homedir(), ".local", "share"), "MineMods Studio", "runtime", "gradle-home", "caches", "fabric-loom", "assets")

// ---- reading a file ----

test("an Ogg Vorbis file is measured from its pages: channels, sample rate, length", () => {
  expect(oggVorbisFacts(oggVorbis({ samples: 22050 }))).toEqual({ channels: 1, sample_rate: 44100, seconds: 0.5, bytes: expect.any(Number) })
  expect(oggVorbisFacts(oggVorbis({ channels: 2, rate: 48000, samples: 480000 }))).toMatchObject({ channels: 2, sample_rate: 48000, seconds: 10 })
})

test("anything the game would not play, or would play otherwise than meant, is refused in plain words", () => {
  const said = (bytes: Uint8Array) => {
    try {
      soundFileFacts(oggDataUrl(bytes))
      return ""
    } catch (cause) {
      return (cause as Error).message
    }
  }
  // Other formats are named, with how to convert them.
  expect(said(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVEfmt ")]))).toContain("WAV 文件")
  expect(said(new Uint8Array([...Buffer.from("ID3"), 4, 0, 0, 0, 0, 0, 0]))).toContain("MP3")
  expect(said(new Uint8Array([...Buffer.from("ID3"), 4, 0, 0, 0, 0, 0, 0]))).toContain("ffmpeg")
  const opus = concat([page(1, 0, 0x02, 0, [new Uint8Array([...Buffer.from("OpusHead"), 1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0])]), page(1, 1, 0x04, 48000, [new Uint8Array(8)])])
  expect(said(opus)).toContain("Opus")
  // Two channels are not placed in the world.
  expect(said(oggVorbis({ channels: 2 }))).toContain("单声道")
  // Too long, too big.
  expect(said(oggVorbis({ samples: 44100 * 11 }))).toContain(`最长 ${SOUND_LIMITS.seconds} 秒`)
  expect(said(new Uint8Array([104, 101, 108, 108, 111]))).toContain("不是一个 OGG 文件")
  // A damaged page, a file cut short, a second stream, no end of stream.
  const good = oggVorbis()
  const broken = good.slice()
  broken[broken.length - 3]! ^= 0xff
  expect(said(broken)).toContain("校验和")
  expect(said(good.slice(0, good.length - 5))).toContain("断了")
  expect(said(concat([good, oggVorbis({ serial: 7 })]))).toContain("流结束以后")
  const open = concat([page(9, 0, 0x02, 0, [oggVorbis().subarray(28, 58)])])
  expect(said(open)).toContain("没有正常结束")
  expect(said(oggVorbis())).toBe("")
})

test("one file is at most 1 MB", () => {
  expect(() => soundFileFacts(oggDataUrl(oggVorbis({ padding: SOUND_LIMITS.bytes })))).toThrow("最大 1 MB")
})

test("the game's own sounds, where this machine has them, are read as the Vorbis files they are", () => {
  const indexes = path.join(MINECRAFT_SOUNDS, "indexes")
  if (!existsSync(indexes)) return
  const objects = JSON.parse(readFileSync(path.join(indexes, readdirSync(indexes)[0]!), "utf8")).objects as Record<string, { hash: string }>
  const names = Object.keys(objects).filter((name) => name.endsWith(".ogg") && name.includes("/sounds/mob/")).slice(0, 200)
  expect(names.length).toBeGreaterThan(0)
  names.forEach((name) => {
    const hash = objects[name]!.hash
    const facts = oggVorbisFacts(new Uint8Array(readFileSync(path.join(MINECRAFT_SOUNDS, "objects", hash.slice(0, 2), hash))))
    expect([44100, 48000]).toContain(facts.sample_rate)
    expect(facts.seconds).toBeGreaterThan(0)
    expect(facts.seconds).toBeLessThan(60)
  })
})

// ---- the document ----

test("a sound document is held to its limits, and its durations to what is measured", () => {
  expect(SoundDocumentSchema.parse(roar)).toEqual(roar)
  const issues = (document: unknown) => SoundDocumentSchema.safeParse(document).error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? []
  expect(issues({ ...roar, files: [{ ...roar.files[0]!, duration: 1 }] })).toEqual(["files.0.duration: 第 1 个文件量出来长 1.5 秒，duration 写的是 1：改成 1.5。"])
  expect(issues({ ...roar, files: Array.from({ length: SOUND_LIMITS.files + 1 }, () => roar.files[0]) })).not.toEqual([])
  expect(issues({ ...roar, name: "Chiyou-Roar" })).not.toEqual([])
  expect(issues({ ...roar, volume: 1.5 })).not.toEqual([])
  expect(issues({ ...roar, category: "music" })).not.toEqual([])
  expect(issues({ ...roar, files: [{ data: "data:audio/wav;base64,UklGRg==", duration: 1 }] })[0]).toContain("data:audio/ogg;base64")
  // All the files of one sound together are bounded, so the document still fits through one call.
  const big = oggDataUrl(oggVorbis({ padding: 900_000 }))
  expect(issues({ ...roar, files: [0, 1, 2].map(() => ({ data: big, duration: 1 })) }).join()).toContain(`合计最大 ${SOUND_LIMITS.total_bytes / 1_000_000} MB`)
})

test("the sound kind is registered like every other kind, built on every target, and told to the outside AI", () => {
  expect(ModuleKindSchema.options).toContain("sound")
  expect(MODULES.sound.label).toBe("声音")
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) expect(kindCapability("sound", target)).toBe("runtime")
  expect(getModuleSchema("sound")).toBe(SoundDocumentSchema)
  // The instructions are made from the limits, and say what is not taken.
  expect(SOUND_INSTRUCTIONS).toContain(`最长 ${SOUND_LIMITS.seconds} 秒`)
  expect(SOUND_INSTRUCTIONS).toContain(`最大 ${SOUND_LIMITS.bytes / 1_000_000} MB`)
  expect(SOUND_INSTRUCTIONS).toContain(`1 到 ${SOUND_LIMITS.files} 个文件`)
  expect(SOUND_INSTRUCTIONS).toContain("WAV、MP3")
  expect(SOUND_INSTRUCTIONS).toContain("Studio 的声音页导入")
  // The road an outside AI can walk by itself: the project's inbox folder, by file name.
  expect(SOUND_INSTRUCTIONS).toContain("收件箱")
  expect(MODULES.sound.instructions.startsWith(SOUND_INSTRUCTIONS)).toBe(true)
  // A creature and an ability are told how to use one.
  expect(CREATURE_SOUND_INSTRUCTIONS).toContain('{"asset":"<声音资产的 UUID>"}')
  expect(ABILITY_INSTRUCTIONS).toContain('{"asset":"<声音资产的 UUID>"}')
  expect(ABILITY_INSTRUCTIONS).not.toContain("自己的音效文件")
  expect(MODULES.entity.references.some((reference) => (reference.kinds as readonly string[]).includes("sound"))).toBe(true)
})

// ---- references ----

const [slam] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability]
const roaring: Ability = AbilitySchema.parse({ ...slam, events: [...slam.events, { type: "sound", at: 0.2, sound: { asset: roarId }, volume: 2, pitch: 0.9 }] })
const sounds = { ambient: null, hurt: { asset: roarId }, death: "entity.iron_golem.death", step: { asset: stepId }, pitch: 0.8, volume: 1 }

test("a creature's moments and an ability's events take a vanilla id or a sound asset", () => {
  expect(CreatureSoundsSchema.parse(sounds)).toEqual(sounds)
  expect(CreatureSoundsSchema.safeParse({ ...sounds, hurt: { asset: "not-a-uuid" } }).success).toBe(false)
  expect(CreatureSoundsSchema.safeParse({ ...sounds, hurt: { asset: roarId, extra: 1 } }).success).toBe(false)
  expect(CreatureSoundsSchema.safeParse({ ...sounds, hurt: "entity.player.burp" }).success).toBe(false)
  expect(roaring.events.at(-1)).toMatchObject({ sound: { asset: roarId } })
  expect(creatureSoundIds({ name: "蚩尤", sounds, abilities: [roaring] })).toEqual([roarId, stepId])
})

test("a creature playing a sound asset must depend on it, and it must be a sound; two sounds never share a name", () => {
  const now = new Date().toISOString()
  const asset = (id: string, module: string, document: unknown, dependencies: string[] = []) => WorkspaceAssetSchema.parse({ id, module, title: module, revision: 1, created_at: now, updated_at: now, prompt: "测试", dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const model = randomUUID()
  const creature = { kind: "entity", name: "蚩尤", description: "", health: 200, speed: 0.25, attack_damage: 6, behavior: "hostile", model_asset_id: model, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, sounds }
  const said = (assets: unknown[]) => WorkspaceSchema.safeParse({ assets }).error?.issues.map((issue) => issue.message) ?? []
  const models = asset(model, "model", { kind: "model", ...fightingGolemDesign })
  const both = [asset(roarId, "sound", roar), asset(stepId, "sound", longStep)]
  expect(said([models, ...both, asset(randomUUID(), "entity", creature, [model, roarId, stepId])])).toEqual([])
  expect(said([models, ...both, asset(randomUUID(), "entity", creature, [model, roarId])])).toEqual(["「entity」的声音依赖还没登记。重新提交生物任务，Studio 会根据文档自动登记已有声音。"])
  expect(said([models, asset(roarId, "sound", roar), asset(stepId, "model", { kind: "model", ...fightingGolemDesign }), asset(randomUUID(), "entity", creature, [model, roarId, stepId])]).join()).toContain(`引用的声音在这个工程里找不到：${stepId}`)
  expect(said([asset(roarId, "sound", roar), asset(stepId, "sound", { ...longStep, name: roar.name })]).join()).toContain("Another sound already uses the name chiyou_roar")
})

test("the review says which moment plays which sound, and warns of a missing one and of a long one on a frequent moment", () => {
  const creature = { name: "蚩尤", sounds, abilities: [roaring] }
  expect(soundUseLines(creature, lookup, ABILITY_SOUNDS)).toEqual([
    "受伤时：「蚩尤怒吼」（自己的声音，2 个文件随机，最长 2 秒）",
    "死的时候：「铁傀儡死亡」",
    "走路时：「沉重脚步」（自己的声音，2 秒）",
    `招式「${slam.name}」第 ${slam.events[0]!.at} 秒：「${ABILITY_SOUNDS[slam.events[0]!.type === "sound" ? (slam.events[0]!.sound as string) : ""]}」`,
    `招式「${slam.name}」第 0.2 秒：「蚩尤怒吼」（自己的声音，2 个文件随机，最长 2 秒）`,
  ])
  const issues = creatureSoundIssues(creature, lookup)
  // A 2-second footstep is heard over the next step; a 2-second hurt sound is at the edge and not said; nothing is missing.
  expect(issues.map((issue) => [issue.rule, issue.stops])).toEqual([["sound_long", false]])
  expect(issues[0]!.text).toContain("走路时放的「沉重脚步」长 2 秒")
  // An ability that comes again before its sound is over is said too.
  const quick: Ability = { ...roaring, length: 0.6, start: { ...roaring.start, cooldown: 0.5 } }
  expect(creatureSoundIssues({ name: "蚩尤", sounds: null, abilities: [quick] }, lookup).map((issue) => [issue.rule, issue.ability])).toEqual([["sound_long", quick.id]])
  // A sound asset that is gone stops the build.
  const gone = creatureSoundIssues({ name: "蚩尤", sounds: { ...sounds, step: null, hurt: { asset: randomUUID() } }, abilities: [] }, lookup)
  expect(gone.map((issue) => [issue.rule, issue.stops])).toEqual([["sound_missing", true]])
})

// ---- what a build writes ----

test("sounds.json, the .ogg files and the subtitles are written as the game's own are", () => {
  const data = compileSoundData("chiyou_mod", [roar, longStep])
  const resources = "src/main/resources/assets/chiyou_mod"
  expect(JSON.parse(String(data.files[`${resources}/sounds.json`]))).toEqual({
    chiyou_roar: { subtitle: "subtitles.chiyou_mod.chiyou_roar", sounds: [{ name: "chiyou_mod:chiyou_roar", volume: 0.9 }, { name: "chiyou_mod:chiyou_roar-2", volume: 0.9, weight: 3 }] },
    heavy_step: { sounds: [{ name: "chiyou_mod:heavy_step" }] },
  })
  expect(Object.keys(data.files).sort()).toEqual([`${resources}/sounds.json`, `${resources}/sounds/chiyou_roar-2.ogg`, `${resources}/sounds/chiyou_roar.ogg`, `${resources}/sounds/heavy_step.ogg`])
  expect(oggVorbisFacts(data.files[`${resources}/sounds/chiyou_roar-2.ogg`] as Uint8Array)).toMatchObject({ sample_rate: 48000, seconds: 2 })
  expect(data.language).toEqual({ zh_cn: { "subtitles.chiyou_mod.chiyou_roar": "蚩尤怒吼" }, en_us: { "subtitles.chiyou_mod.chiyou_roar": "Chiyou roars" } })
})

test("the generated creature plays its own sounds through the registered events, and its abilities under the sound's category", () => {
  const plain = { modId: "chiyou_mod", packageName: "com.minemods.content_chiyou_mod", id: "creature", name: "蚩尤", health: 200, speed: 0.25, attack_damage: 6, behavior: "hostile" as const, model: fightingGolemDesign, runtime: { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null } }
  const customSounds = { [roarId]: { name: "chiyou_roar", category: "hostile" as const }, [stepId]: { name: "heavy_step", category: null } }
  const java = String(compileEntity({ ...plain, sounds, abilities: [roaring], customSounds })["src/main/java/com/minemods/content_chiyou_mod/entity/StudioCreature.java"])
  expect(java).toContain("getHurtSound(DamageSource source) { return com.minemods.content_chiyou_mod.StudioSounds.SOUND_CHIYOU_ROAR; }")
  expect(java).toContain("playSound(com.minemods.content_chiyou_mod.StudioSounds.SOUND_HEAVY_STEP, ")
  expect(java).toContain("getDeathSound() { return SoundEvents.IRON_GOLEM_DEATH; }")
  expect(java).toContain("level().playSound(null, getX(), getY(), getZ(), com.minemods.content_chiyou_mod.StudioSounds.SOUND_CHIYOU_ROAR, net.minecraft.sounds.SoundSource.HOSTILE, 2.0f, 0.9f);")
  // One the generator was not told about is never written as a name that does not exist.
  expect(() => compileEntity({ ...plain, sounds, abilities: [roaring], customSounds: { [roarId]: customSounds[roarId] } })).toThrow(`ENTITY_SOUND_MISSING:${stepId}`)
  expect(soundJava("entity.iron_golem.hurt", "x", {})).toBe("SoundEvents.IRON_GOLEM_HURT")
  const registry = String(Object.values(compileSoundRegistry({ modId: "chiyou_mod", packageName: "com.minemods.content_chiyou_mod", names: ["chiyou_roar", "heavy_step"] }))[0])
  expect(registry).toContain('public static final SoundEvent SOUND_CHIYOU_ROAR = register("chiyou_roar");')
  expect(registry).toContain("Registry.register(BuiltInRegistries.SOUND_EVENT, id, SoundEvent.createVariableRangeEvent(id))")
})

test("a project with sounds of its own builds sounds.json, the files, the registry, and compiles on the official class path", async () => {
  const { assembleBuildSource } = await import("../src/build-source")
  const { openProject, saveProject, ProjectSchema } = await import("../src/project")
  const { createDataGameplaySample } = await import("../script/data-gameplay-sample")
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-声音-构建-"))
  try {
    const directory = path.join(root, "project")
    await createDataGameplaySample(directory, { life: true, abilities: true })
    const project = await openProject(directory)
    const golem = project.entities[0]!
    const now = new Date().toISOString()
    const voiced = { ...golem, sounds: { ...golem.sounds!, hurt: { asset: roarId }, step: { asset: stepId } }, abilities: (golem.abilities ?? []).map((ability, index) => (index === 0 ? AbilitySchema.parse({ ...ability, events: [...ability.events, { type: "sound", at: 0.1, sound: { asset: roarId }, volume: 1.5, pitch: 1 }] }) : ability)) }
    const saved = (id: string, title: string, document: SoundDocument) => WorkspaceAssetSchema.parse({ id, module: "sound", title, revision: 1, created_at: now, updated_at: now, prompt: "测试", dependencies: [], document, provenance: { model: "example", request_id: null }, status: "ready" })
    const assets = project.workspace.assets.map((asset) => {
      if (asset.document.kind !== "entity") return asset
      const { id: _id, model_asset_id: _model, ...rules } = voiced
      return { ...asset, dependencies: [...asset.dependencies, roarId, stepId], document: { ...asset.document, sounds: rules.sounds, abilities: rules.abilities } }
    })
    await saveProject(directory, ProjectSchema.parse({ ...project, entities: [voiced], workspace: { assets: [saved(roarId, "蚩尤怒吼", roar), saved(stepId, "沉重脚步", longStep), ...assets] } }), project.revision)
    const source = path.join(root, "source")
    const template = path.join(import.meta.dir, "..", "..", "..", "templates", "fabric-1.21")
    const built = await assembleBuildSource(directory, source, template)
    const resources = path.join(source, "src", "main", "resources", "assets", project.mod_id)
    expect(JSON.parse(await readFile(path.join(resources, "sounds.json"), "utf8"))).toEqual(JSON.parse(String(compileSoundData(project.mod_id, [roar, longStep]).files[`src/main/resources/assets/${project.mod_id}/sounds.json`])))
    expect(oggVorbisFacts(new Uint8Array(await readFile(path.join(resources, "sounds", "chiyou_roar-2.ogg"))))).toMatchObject({ seconds: 2 })
    expect(JSON.parse(await readFile(path.join(resources, "lang", "en_us.json"), "utf8"))[`subtitles.${project.mod_id}.chiyou_roar`]).toBe("Chiyou roars")
    const java = path.join(source, "src", "main", "java", ...built.packageName.split("."))
    expect(await readFile(path.join(java, "StudioContentRegistry.java"), "utf8")).toContain("    public static void register() {\n        StudioSounds.register();\n")
    expect(await readFile(path.join(java, "StudioSounds.java"), "utf8")).toContain(`ResourceLocation.fromNamespaceAndPath("${project.mod_id}", name)`)
    expect(built.soundFiles).toContain(`${built.packageName.replaceAll(".", "/")}/StudioSounds.class`)
    expect(built.soundFiles).toContain(`assets/${project.mod_id}/sounds/heavy_step.ogg`)
    // The review of the build says the long footstep.
    expect(built.findings.filter((finding) => finding.rule === "sound_long").length).toBe(1)
    const compiled = await compileTreeFor("fabric-1.21.1-official", source)
    expect(compiled === null || !compiled.output.includes("error")).toBe(true)
    if (compiled) expect(compiled.code).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 180000)
