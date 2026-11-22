import { afterAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { AbilitySchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { POSE_CHANNELS } from "../src/fabric/entity-pose"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { capedGolem } from "./step2-fixture"
import { hasTargetJavac, targetJavac, targetJdkTool } from "./target-javac"

/**
 * 第 2 步 (动作): what the animation contract's version 3 does to a generated creature — clips that blend into each other, an ability whose clip is
 * layered (the walk keeps the bones it does not key and the creature keeps walking to its target), and follow bones that sway after their parents —
 * and that a creature using none of it is generated exactly as before. The three-target test builds a project with all of it the way Studio does
 * and compiles it with javac against each target's real class path.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "傀儡", health: 300, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const rendererPath = "src/main/java/com/minemods/content_golem_mod/client/StudioCreatureRenderer.java"
// The slam's dust plume is 1.21's alone: a cloud of poof instead, so the same creature builds for 1.20.1 too.
const abilities = golemAbilities.map((ability) => AbilitySchema.parse({ ...ability, events: ability.events.map((event) => ("particle" in event && event.particle === "dust_plume" ? { ...event, particle: "poof" } : event)) }))
const runtime = { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }

test("不写新字段的生物生成的 Java 一字不差：写 null 和不写一样，没有 StudioPose，也没有 ABILITY_WALKS", () => {
  const nulls = { ...fightingGolemDesign, follow: null, animations: fightingGolemDesign.animations.map((clip) => ({ ...clip, blend: null, layered: null })) }
  for (const more of [{ abilities }, { abilities, runtime }, {}]) {
    const before = compileEntity({ ...plain, model: fightingGolemDesign, ...more } as never)
    const after = compileEntity({ ...plain, model: nulls, ...more } as never)
    expect(after[entityPath]).toBe(before[entityPath])
    expect(after[rendererPath]).toBe(before[rendererPath])
    expect(String(before[rendererPath])).not.toContain("StudioPose")
    expect(String(before[rendererPath])).not.toContain("setCustomAnimations")
    expect(String(before[entityPath])).not.toContain("ABILITY_WALKS")
  }
})

test("blend、layered、follow 写进生成的 Java：渲染器混合和跟随，招式边放边走", () => {
  const files = compileEntity({ ...plain, model: capedGolem, abilities } as never)
  const renderer = String(files[rendererPath])
  const entity = String(files[entityPath])
  expect(renderer).toContain("@Override public void setCustomAnimations(StudioCreature creature, long instanceId, AnimationState<StudioCreature> state)")
  expect(renderer).toContain('private static final String[] BLEND_CLIPS = {"animation.creature.hurt", "animation.creature.slam", "animation.creature.burst"};')
  expect(renderer).toContain("private static final int[] BLEND_TICKS = {3, 4, 5};")
  // Parents before children: the cape's sway goes into its tip's.
  expect(renderer).toContain('private static final String[] FOLLOW = {"cape", "cape_tip"};')
  // The slam is layered: the walk keeps the legs under it, the creature keeps going to its target, the slam's own navigation stop is skipped.
  const slam = abilities.findIndex((ability) => ability.clip === "slam")
  expect(entity).toContain(`private static final boolean[] ABILITY_WALKS = {${abilities.map((_, index) => index === slam).join(", ")}};`)
  expect(entity).toContain("if ((getEntityData().get(ABILITY) != 0 && !ABILITY_WALKS[(getEntityData().get(ABILITY) & 255) - 1])) return PlayState.STOP;")
  expect(entity).toContain("if (abilityWalks()) getNavigation().moveTo(target, 1.2);")
  expect(entity).toContain("if (!abilityWalks()) getNavigation().stop();")
  // With a runtime block the movement goal keeps walking too.
  const ruled = String(compileEntity({ ...plain, model: capedGolem, abilities, runtime } as never)[entityPath])
  expect(ruled).toContain("if (abilityWalks()) {\n                getNavigation().moveTo(target, 1.2);\n                return;\n            }")
  // The exported clip carries the eased and curved segments as straight pieces.
  const animation = JSON.parse(String(files["src/main/resources/assets/golem_mod/animations/creature.animation.json"]))
  expect(Object.keys(animation.animations["animation.creature.burst"].bones.body.rotation).length).toBeGreaterThan(6)
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: 带混合、分层和跟随骨骼的生物由 Studio 自己的构建组装，按真实的 class path 编译通过`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-step2-"))
    roots.push(root)
    const directory = path.join(root, "披风傀儡")
    const created = await createProject({ directory, name: "披风傀儡", description: "披风会飘、边走边砸的傀儡。", mod_id: "cape_golem", target })
    const creature = (name: string, name_en: string, more: Record<string, unknown>) => EntitySchema.parse({ ...createEntity({ name, description: name, health: 300, speed: 0.25, attack_damage: 6, behavior: "hostile" }), name_en, ...more })
    const entities = [creature("披风傀儡", "Caped Golem", { abilities }), creature("规则傀儡", "Ruled Golem", { abilities, runtime })]
    let project = await saveProject(directory, { ...created, entities }, created.revision)
    for (const entity of entities) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: capedGolem }, origin: "example", expectedRevision: project.revision })).project
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
    const renderers = await Promise.all(names.filter((name) => /Renderer/.test(path.basename(name))).map((name) => readFile(name, "utf8")))
    expect(renderers.filter((text) => text.includes("class StudioPose")).length).toBe(2)
    if (target === "forge-1.20.1") expect(renderers.some((text) => text.includes("import software.bernie.geckolib.core.animation.AnimationState;"))).toBe(true)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

/**
 * A follow bone whose clip keys only its position, on one bone every creature of the model shares, drawn for two creatures in turn: GeckoLib sets the position each frame and
 * leaves the rotation as it was — what StudioPose wrote on it for the creature drawn before. StudioPose's own `restore` and `channels` (word for word as the renderer has them)
 * put the rotation back channel by channel, so each creature's sway is added to the rest pose and nothing builds up. The old way (all nine values compared at once) is run beside
 * it on the same frames: the moving position kept it from putting the rotation back, and the sway piled up frame on frame.
 */
const JAVA = targetJdkTool("fabric-1.21.1-official", "java")
test.skipIf(!existsSync(JAVA))("跟随骨骼的动作只动位置：同一个模型的几只轮流画，旋转按通道放回，摆动不越积越多", async () => {
  const renderer = String(compileEntity({ ...plain, model: capedGolem, abilities } as never)[rendererPath])
  expect(renderer).toContain(POSE_CHANNELS)
  expect(renderer).toContain("if (restore(read(bone, now), written[index], before[index], wrote[index])) put(bone, now);")
  expect(renderer).not.toContain("java.util.Arrays.equals")
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-pose-channels-"))
  roots.push(root)
  await writeFile(
    path.join(root, "PoseCheck.java"),
    `public class PoseCheck {
${POSE_CHANNELS}
    // One frame of one creature: GeckoLib keys the position (and the rotation when \`keyed\`), then the bone is put back, then the creature's sway is added (StudioPose.apply).
    static float frame(float[] bone, float[] written, float[] before, int[] wrote, boolean old, boolean keyed, int frame, float sway) {
        bone[4] = (float) Math.sin(frame * 0.37);
        if (keyed) bone[0] = (float) Math.cos(frame * 0.21);
        float[] now = bone.clone();
        if (old) { if (wrote[0] != 0 && java.util.Arrays.equals(now, written)) System.arraycopy(before, 0, bone, 0, 9); }
        else if (restore(now, written, before, wrote[0])) System.arraycopy(now, 0, bone, 0, 9);
        float[] start = bone.clone();
        float rest = keyed ? (float) Math.cos(frame * 0.21) : 0.0f;
        bone[0] += sway;
        System.arraycopy(bone, 0, written, 0, 9);
        wrote[0] = old ? (java.util.Arrays.equals(written, start) ? 0 : 7) : channels(written, start);
        if (wrote[0] != 0) System.arraycopy(start, 0, before, 0, 9);
        return Math.abs(bone[0] - rest - sway);
    }

    public static void main(String[] args) {
        for (String way : new String[] {"channels", "old"}) for (boolean keyed : new boolean[] {false, true}) {
            float[] bone = {0, 0, 0, 0, 0, 0, 1, 1, 1};
            float[] written = new float[9], before = new float[9];
            int[] wrote = {0};
            float worst = 0.0f;
            // Two creatures of the model drawn in turn, each with a sway of its own; then one alone.
            for (int at = 0; at < 200; at++) worst = Math.max(worst, frame(bone, written, before, wrote, way.equals("old"), keyed, at, at < 150 ? (at % 2 == 0 ? 0.3f : -0.2f) : 0.1f));
            System.out.println(way + " " + keyed + " " + worst + " " + bone[6] + " " + bone[7] + " " + bone[8]);
        }
    }
}
`,
  )
  const compiled = Bun.spawnSync([targetJdkTool("fabric-1.21.1-official", "javac"), "-d", root, path.join(root, "PoseCheck.java")])
  expect(compiled.stderr.toString()).toBe("")
  const lines = Bun.spawnSync([JAVA, "-cp", root, "PoseCheck"]).stdout.toString().trim().split(/\r?\n/).map((line) => line.split(" "))
  const worst = (way: string, keyed: boolean) => Number(lines.find(([w, k]) => w === way && k === String(keyed))![2])
  // Each frame the rotation is the rest pose (or what GeckoLib keyed) plus this creature's own sway, whichever was drawn before; the scale is never touched.
  expect(worst("channels", false)).toBeLessThan(1e-6)
  expect(worst("channels", true)).toBeLessThan(1e-6)
  expect(lines.filter(([w]) => w === "channels").every((line) => line.slice(3).every((value) => Number(value) === 1))).toBe(true)
  // The old way: fine while GeckoLib keyed the rotation too, the sway piling up when it keyed only the position.
  expect(worst("old", true)).toBeLessThan(1e-6)
  expect(worst("old", false)).toBeGreaterThan(1)
})

test("史诗档的制作：部件说明写了 epic，就有 12 版、一次看图收 6 张、留 12 张；别的档还是 6 版、3 张、6 张", async () => {
  const { begin, describe: described, fingerprint, looked, MAKING_LIMITS } = await import("../src/making")
  const sheet = {
    subject: "一位披风大将，敌对的史诗 Boss。",
    recognisable: ["身后长长的红披风", "双手巨锤", "比玩家高三倍"],
    parts: [{ name: "body", what: "躯干", shape: "宽厚的铠甲躯干", attaches: "立在两条腿上", surface: "暗铁铠甲", moves: "出招时拧身", assumed: false }],
    assumed: [],
  }
  const start = () => begin(null, { asset_id: "22222222-2222-4222-8222-222222222222", entry: "general_model", kind: "model", request: "披风大将", brief: "披风大将的模型", task_id: "11111111-1111-4111-8111-111111111111", remark: null })
  const epic = described(start(), { ...sheet, budget: { tier: "epic", reason: "整场战斗都盯着它看的终极 Boss", at_once: 1 } })
  expect(epic.rounds_allowed).toBe(12)
  const plain = described(start(), sheet)
  expect(plain.rounds_allowed).toBe(MAKING_LIMITS.rounds)
  const pictures = Array.from({ length: 8 }, (_, index) => ({ label: `图 ${index}`, file: `1-a-${index}.jpg` }))
  expect(looked(epic, { fingerprint: fingerprint({ kind: "model", name: "v1" }), pictures, findings: [] }).rounds[0]!.pictures).toHaveLength(6)
  expect(looked(plain, { fingerprint: fingerprint({ kind: "model", name: "v1" }), pictures, findings: [] }).rounds[0]!.pictures).toHaveLength(MAKING_LIMITS.sheets)
})

test("walk 和 idle 写了 blend：走路和待机之间按它过渡（GeckoLib 自己的过渡），不写还是 4 tick", () => {
  const walking = { ...capedGolem, animations: capedGolem.animations.map((clip) => (clip.name === "walk" ? { ...clip, blend: 7 } : clip)) }
  expect(String(compileEntity({ ...plain, model: walking } as never)[entityPath])).toContain('super(StudioCreature.this, "movement", 7, handler);')
  expect(String(compileEntity({ ...plain, model: capedGolem } as never)[entityPath])).toContain('super(StudioCreature.this, "movement", 4, handler);')
})

test("在 Blockbench 里改过的模型：动作的 blend、layered 和 follow 骨骼从改之前的设计留下来；骨骼没了的 follow 不留", async () => {
  const { blockbenchToDesign, designToBlockbench } = await import("../src/blockbench")
  const { keptPlayWords } = await import("../src/blockbench-keys")
  const named = {...capedGolem, animations:capedGolem.animations.map(clip=>clip.name==="slam"?{...clip,display_name:"落地重击"}:clip)}
  const edited = blockbenchToDesign(designToBlockbench(named))
  expect(edited.follow ?? null).toBeNull()
  const kept = keptPlayWords(edited, named)
  expect(kept.follow).toEqual(capedGolem.follow!)
  expect(kept.animations.find((clip) => clip.name === "slam")).toMatchObject({ blend: 4, layered: true, display_name:"落地重击" })
  const withoutCape = { ...edited, bones: edited.bones.filter((bone) => !bone.name.startsWith("cape")) }
  expect(keptPlayWords(withoutCape, capedGolem).follow).toBeUndefined()
  expect(keptPlayWords(edited, null)).toBe(edited)
})
