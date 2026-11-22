import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { AbilityEventSchema, AbilitySchema } from "../src/entity-runtime"
import { cameraWords, skyTintWords, CINEMATIC_INSTRUCTIONS } from "../src/cinematic"
import { cinematicPayload, compileCinematic } from "../src/common/cinematic"
import { impactSpec, projectileImpactNeeds, compileProjectiles } from "../src/common/projectiles"
import { compileBossRuntime } from "../src/fabric/boss-runtime"
import { compileBossWeather } from "../src/fabric/boss-weather"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { assembleBuildSource } from "../src/build-source"
import { genTarget } from "../src/platform/target"
import { cameraCue, skyCue, cinematicAbility, createTargetCinematicSample } from "../script/target-cinematic-sample"
import { golemAbilities } from "../script/data-gameplay-sample"
import { abilityWords } from "../src/creature-abilities"
import { saveProject } from "../src/project"
import { voidRainAbility } from "../script/target-groundfx-sample"
import { impactWords } from "../src/ability-projectile"
import { hasTargetJavac, targetJavac } from "./target-javac"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const template = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))

test("新事件保存参数、中文说明和招式文字，旧事件不加默认字段", () => {
  expect(AbilityEventSchema.parse({ type: "camera", at: 7.2, ...cameraCue })).toEqual({ type: "camera", at: 7.2, ...cameraCue })
  expect(cameraWords({ at: 7.2, ...cameraCue })).toContain("第 7.2 秒镜头一推")
  expect(skyTintWords({ at: 7.2, ...skyCue })).toContain("第 7.2 秒天染成红色")
  expect(abilityWords.events(cinematicAbility)).toContain("重力 0.04，碰地消失")
  expect(CINEMATIC_INSTRUCTIONS).toContain("格/刻")
  const old = { type: "debris", at: 0, where: "self", hit: null, forward: 0, up: 0, left: 0, radius: 2, count: 6 } as const
  expect(AbilityEventSchema.parse(old)).toEqual(old)
})

test("不合理的新参数用中文拒绝，时刻不能晚于招式结束", () => {
  const camera = { type: "camera", at: 0.5, ...cameraCue }
  const sky = { type: "sky_tint", at: 0.5, ...skyCue }
  for (const [event, field, value, words] of [
    [camera, "fov", 0.1, "视野倍率"], [camera, "rise", 0, "推到峰值"], [camera, "hold", 6, "保持"], [camera, "fade", 0, "回到原位"], [camera, "radius", 65, "半径"], [camera, "easing", "wrong", "缓动"],
    [sky, "color", "red", "六位十六进制"], [sky, "strength", 2, "强度"], [sky, "edge", 1, "屏幕边缘"],
  ] as const) {
    const result = AbilityEventSchema.safeParse({ ...event, [field]: value })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]!.message).toContain(words)
  }
  const debris = cinematicAbility.events.find(e => e.type === "debris")!
  for (const field of ["speed", "spread", "gravity"]) {
    const result = AbilityEventSchema.safeParse({ ...debris, throw: { speed: 0.5, spread: 0.1, gravity: 0.04, [field]: -1 } })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]!.message).toMatch(/碎块/)
  }
  expect(AbilitySchema.safeParse({ ...cinematicAbility, events: [{ ...camera, at: 9.5 }] }).error?.issues[0]?.message).toContain("镜头")
})

test("落点触发沿用同一镜头曲线、染天参数，混用旧 impact 的构造函数保留", () => {
  const hit = cinematicAbility.hits[1]!
  if (hit.type !== "projectile" || !hit.impact) throw new Error("sample")
  expect(projectileImpactNeeds([hit])).toMatchObject({ cinematic: true })
  expect(cinematicPayload("camera", cameraCue)).toBe("new StudioCinematic.Cue(0, 32f, 0.5f, 12, 16, 12, 1, 0)")
  expect(impactSpec(hit.impact)).toContain("new StudioCinematic.Cue")
  expect(AbilitySchema.safeParse(cinematicAbility).success).toBe(true)
})

test("没有阶段天气和扩展晃屏时，独立的视野、天空混入也能在 Fabric 编译", async () => {
  const made=compileCinematic({modId:"solo_mod",packageName:"com.minemods.content_solo_mod",camera:true,sky:true,edge:false},genTarget("fabric-1.21.1"))
  expect(made.classes.some(c=>c.endsWith("StudioCinematicViewMixin.class"))).toBe(true)
  expect(made.classes.some(c=>c.endsWith("StudioTintSkyMixin.class"))).toBe(true)
  expect(made.classes.some(c=>c.endsWith("StudioTintEdgeMixin.class"))).toBe(false)
  if(!hasTargetJavac("fabric-1.21.1-official")) return
  const root=await mkdtemp(path.join(os.tmpdir(),"minemods-cinematic-solo-")); roots.push(root)
  for(const [name,text] of Object.entries(made.files)){
    const file=path.join(root,name); await mkdir(path.dirname(file),{recursive:true}); await writeFile(file,text)
  }
  const compiled=await targetJavac("fabric-1.21.1-official",path.join(root,"src/main/java"))
  expect(compiled.output.split("\n").filter(s=>/error/.test(s))).toEqual([])
  expect(compiled.code).toBe(0)
},30000)

test("未用新字段：三端晃屏、旧碎块、阶段天气、旧 impact 与 5fbd922、招式源码与 313c5e5 逐字节一致", () => {
  // Golden SHA-256 from the original generators read directly with git show 5fbd922:<file>.
  const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex")
  const options={modId:"legacy_mod",packageName:"com.minemods.content_legacy_mod"}
  const golden=[
    ["fabric-1.21.1","ee2cac5a29772f1e10574c87a92e34d92c8269046e7ce71e321fee087acdf1c8","10ac0bb252c2cfa8c25e0941c3f477bef7fc22245322bdfeedf108052bfff5c5"],
    ["forge-1.20.1","fd1bb9c15771437061d7d98f002dfabcc6c0f1ef955e6e932ae5a8df5b9cd275","2cd44e01007eedceff7ee2ea6f463b628ef65d860d2d0e32dc3bd2059af191d7"],
    ["neoforge-1.21.1","7d865f55f0539b761bf5a343b625a742d19924a13c2b703c5f77e3a57fd40b2a","75cba0c2ec98c0351227614eddbae3b19d797fb1715845d1831ef8d63b656397"],
  ] as const
  for(const [id,runtime,impact] of golden){
    expect(hash(compileBossRuntime({...options,shake:true,debris:true},genTarget(id)).files)).toBe(runtime)
    expect(hash(compileProjectiles({...options,effects:false,warned:false,impact:{effects:false,own:false,shake:true}},genTarget(id)).files)).toBe(impact)
    expect(hash(compileBossWeather({...options,weather:true,lightning:true},genTarget(id)).files)).toBe(id === "fabric-1.21.1" ? "023938fe0a8e36520aef714b9c86ef474dd433cbfd30c8bff5effdae52f8a39a" : "d7baf0d79bd9f2ce0a66197d01f01dbf7516bb1c780743b0e923229997d0e99b")
  }
  const events=AbilitySchema.parse({...golemAbilities[0],events:[{type:"shake",at:0.65,strength:2,radius:16,seconds:1},{type:"debris",at:0.65,where:"self",hit:null,forward:0,up:0,left:0,radius:3,count:10}]}).events
  expect(hash(compileAbilities({entity:"StudioLegacy",model:"LegacyModel",hostile:true,runtime:true,death:true,abilities:[{...AbilitySchema.parse(golemAbilities[0]),events}]}))).toBe("a3bd9599963afe51f19c3bef87369b2b67d80c7592f714655cc297389100235f")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}：完整 Boss、晃屏、阶段变暗、镜头、染天、抛起碎块和落点触发编译`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-cinematic-")); roots.push(root)
    const project=await createTargetCinematicSample(path.join(root,"project"),target)
    const oldShot=cinematicAbility.hits[1]!
    await saveProject(path.join(root,"project"),{
      ...project,
      entities: project.entities.map(e=>({...e,abilities:[AbilitySchema.parse({
        ...cinematicAbility,
        hits:[...cinematicAbility.hits,{...oldShot,at:8,impact:{particle:"flame"}}],
        events:[...cinematicAbility.events,{type:"debris",at:8,where:"self",hit:null,forward:0,up:0,left:0,radius:2,count:2}],
      })]})),
    },project.revision)
    const source=path.join(root,"source"); await mkdir(source)
    const made=await assembleBuildSource(path.join(root,"project"),source,template)
    expect(made.bossFiles.some(f=>f.endsWith("StudioCinematic.class"))).toBe(true)
    const mixins=JSON.parse(await readFile(path.join(source,"src/main/resources/zhuolu_field.mixins.json"),"utf8"))
    expect(mixins.client).toEqual(expect.arrayContaining(["StudioTintFogMixin","StudioBossSkyMixin","StudioTintEdgeMixin",target === "fabric-1.21.1" ? "StudioShakeViewMixin" : "StudioCinematicViewMixin"]))
    expect(mixins.client).not.toContain("StudioTintSkyMixin")
    const base=path.join(source,"src/main/java",made.packageName.replaceAll(".","/"))
    expect(await readFile(path.join(base,"entity/StudioDebris.java"),"utf8")).toContain("ClipContext.Block.COLLIDER")
    expect(await readFile(path.join(base,"entity/StudioProjectile.java"),"utf8")).toContain("impact.skyTint()")
    expect(await readFile(path.join(base,"mixin/StudioBossSkyMixin.java"),"utf8")).toContain("StudioCinematicClient.tint(info.getReturnValue().scale(")
    if (target === "fabric-1.21.1") {
      expect(mixins.client).not.toContain("StudioCinematicViewMixin")
      expect(await readFile(path.join(base,"mixin/StudioShakeViewMixin.java"),"utf8")).toContain("(info.getReturnValue() + more) * factor")
    }
    const cp=target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target
    if (!hasTargetJavac(cp)) return
    const compiled=await targetJavac(cp,path.join(source,"src/main/java"))
    expect(compiled.output.split("\n").filter(s=>/error/.test(s))).toEqual([])
    expect(compiled.code).toBe(0)
  },180000)
}

// 合并第 4 步之后：一个落点同时写地面效果（ground）和镜头、染天，另有只写 ground、只写镜头染天、两样都不写的落点，同一个 Impact 记录的四个构造函数都要用上。
for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}：投射物落点同时留地面效果、推镜头、染天编译`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-cinematic-ground-")); roots.push(root)
    const project=await createTargetCinematicSample(path.join(root,"project"),target)
    const shot=cinematicAbility.hits[1]!
    const sample=voidRainAbility.hits[0]!
    if (shot.type !== "projectile" || sample.type !== "projectile" || !shot.impact || !sample.impact?.ground) throw new Error("sample")
    const ground=sample.impact.ground
    const ability=AbilitySchema.parse({
      ...cinematicAbility,
      hits:[
        ...cinematicAbility.hits,
        {...shot,at:7,impact:{...shot.impact,ground}},
        {...shot,at:7.5,impact:{ground}},
        {...shot,at:8,impact:{particle:"flame"}},
      ],
    })
    expect(projectileImpactNeeds(ability.hits.flatMap(h=>h.type === "projectile" ? [h] : []))).toMatchObject({ground:true,cinematic:true})
    await saveProject(path.join(root,"project"),{...project,entities:project.entities.map(e=>({...e,abilities:[ability]}))},project.revision)
    const source=path.join(root,"source"); await mkdir(source)
    const made=await assembleBuildSource(path.join(root,"project"),source,template)
    expect(made.bossFiles.some(f=>f.endsWith("StudioCinematic.class"))).toBe(true)
    expect(made.groundFxFiles.length).toBeGreaterThan(0)
    const base=path.join(source,"src/main/java",made.packageName.replaceAll(".","/"))
    const table=await readFile(path.join(base,"entity/StudioProjectiles.java"),"utf8")
    const java=await readFile(path.join(base,"entity/StudioProjectile.java"),"utf8")
    expect(table).toContain("int ticks, StudioFxSpec[] ground, StudioCinematic.Cue camera, StudioCinematic.Cue skyTint) {")
    expect(table).toContain("this(effect, particle, own, count, spread, strength, radius, ticks, null, null, null);")
    expect(table).toContain("this(effect, particle, own, count, spread, strength, radius, ticks, ground, null, null);")
    expect(table).toContain("this(effect, particle, own, count, spread, strength, radius, ticks, null, camera, skyTint);")
    expect(java).toContain("impact.skyTint()")
    expect(java).toContain("for (StudioFxSpec fx : impact.ground())")
    const cp=target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target
    if (!hasTargetJavac(cp)) return
    const compiled=await targetJavac(cp,path.join(source,"src/main/java"))
    expect(compiled.output.split("\n").filter(s=>/error/.test(s))).toEqual([])
    expect(compiled.code).toBe(0)
  },180000)
}

test("落点只写镜头和染天时，说明文字也说出这两样，不会只剩「在落点炸开：」", () => {
  const shot=cinematicAbility.hits[1]!
  if (shot.type !== "projectile" || !shot.impact) throw new Error("sample")
  const words=impactWords(shot.impact)
  expect(words).not.toMatch(/：$/)
  expect(words).toBe("落下的那一刻（碰到人或者落地）在落点炸开：镜头拉远（32 格内，视野 ×1.3，0.2 秒推到、保持 0.3 秒、0.4 秒回落，平滑）、天染成红色（32 格内的天空和雾，强度 0.85，保持 0.3 秒、0.4 秒淡回）")
  expect(impactWords({camera:{...cameraCue}})).toContain("在落点炸开：镜头一推（32 格内，视野 ×0.5")
  const ground=voidRainAbility.hits[0]!
  if (ground.type !== "projectile" || !ground.impact?.ground) throw new Error("sample")
  const both=impactWords({...shot.impact,ground:ground.impact.ground})
  expect(both).toContain("镜头拉远")
  expect(both).toContain("天染成红色")
  expect(both).toContain("地裂")
  expect(cameraWords({at:0.5,...cameraCue})).toBe("第 0.5 秒镜头一推（32 格内，视野 ×0.5，0.6 秒推到、保持 0.8 秒、0.6 秒回落，平滑）")
})
