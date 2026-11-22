import { afterAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { footPlan, footSolve } from "@minemods/studio-ai/foot-placement"
import { hangChains, hangSolve, hangStep, hangTargets, toModel, toWorld, type HangChain } from "@minemods/studio-ai/hang-chains"
import { rigOf, type Rig } from "@minemods/studio-ai/pose-rig"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { projectGuide } from "../src/guide-project"
import { compileEntity } from "../src/fabric/entity"
import { FEET_JAVA, feetJava, HANG_JAVA, hangJava, RIG_JAVA } from "../src/fabric/pose-rig-java"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { quadrupedFixture } from "../../studio-ai/test/quadruped-fixture"
import { capedGolem } from "./step2-fixture"
import { hasTargetJavac, targetJavac, targetJdkTool } from "./target-javac"

/**
 * 第 2 步 (挂链和踩地) in the generated creature: a model with neither generates what it always did; a four-legged one with a hanging tail and its
 * feet placed gets StudioPose's rig, its chains and its feet, in the order the preview does them; the Java arithmetic run beside the TypeScript on
 * the same numbers gives the same numbers; and a project of it builds on all three targets.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})
const plain = { modId: "beast_mod", packageName: "com.minemods.content_beast_mod", id: "creature", name: "四足兽", health: 30, speed: 0.25, attack_damage: 3, behavior: "passive" as const }
const rendererPath = "src/main/java/com/minemods/content_beast_mod/client/StudioCreatureRenderer.java"
const entityPath = "src/main/java/com/minemods/content_beast_mod/entity/StudioCreature.java"
const beast = ModelDesignSchema.parse(quadrupedFixture()) as ModelDesign

test("按脚底接触修正后的四足兽渲染器保持稳定", () => {
  const rendered = String(compileEntity({ ...plain, model: beast })[rendererPath])
  expect(new Bun.CryptoHasher("sha256").update(rendered).digest("hex")).toBe("21afcf8fd6371ae5f0a9a692fd84226dbda5f61a1bbf38b6cb9ac944573373ae")
})

test("没写挂链和踩地的模型：写 null、mode 写 spring 和不写一样，渲染器里没有 Rig", () => {
  const before = compileEntity({ ...plain, model: capedGolem } as never)
  const nulls = { ...capedGolem, foot_placement: null, follow: capedGolem.follow!.map((follow) => ({ ...follow, mode: follow.bone === "cape" ? ("spring" as const) : null, gravity: null, attract: null, floor: null })) }
  const after = compileEntity({ ...plain, model: nulls } as never)
  expect(after[rendererPath]).toBe(before[rendererPath])
  expect(after[entityPath]).toBe(before[entityPath])
  expect(String(before[rendererPath])).not.toContain("Rig")
  expect(String(before[rendererPath])).not.toContain("columnTop")
})

test("四足兽：尾巴挂成一串、四只脚踩地，渲染器先踩地、再弹、最后挂", () => {
  const renderer = String(compileEntity({ ...plain, model: beast } as never)[rendererPath])
  expect(renderer).toContain("// 第 2 步: its chains hang and its feet stand on the ground, after GeckoLib has posed it (StudioPose below).")
  expect(renderer).toContain(`private static final Hang[] HANGS = {${hangJava(hangChains(beast)[0]!)}};`)
  expect(renderer).toContain(`private static final Feet FEET = ${feetJava(footPlan(beast)!)};`)
  expect(renderer).toContain('private static final String[] FOLLOW = {};')
  expect(renderer).toContain("private static final int[] HANG_BONES = {11, 12, 13};")
  const order = ["feet(model, creature, state, time, partialTick);", "if (FOLLOW.length > 0) follow(", "hang(model, creature, state, time, partialTick);"].map((line) => renderer.indexOf(line))
  expect(order.every((at) => at > 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  // Each creature keeps its own chain and its own feet; the bones (shared by every creature of the model) are only a scratch read anew each frame.
  expect(renderer).toContain("final double[][] hangX = new double[HANGS.length][];")
  expect(renderer).toContain("final double[] feetGround = new double[FEET.thigh.length];")
  expect(renderer).toContain(RIG_JAVA)
  expect(renderer).toContain(HANG_JAVA)
  expect(renderer).toContain(FEET_JAVA)
  // Only the tail hangs, only the feet are placed: a model with one of the two gets that one alone.
  const tailOnly = String(compileEntity({ ...plain, model: { ...beast, foot_placement: null } } as never)[rendererPath])
  expect(tailOnly).toContain("class Hang")
  expect(tailOnly).not.toContain("class Feet")
  const feetOnly = String(compileEntity({ ...plain, model: { ...beast, follow: null } } as never)[rendererPath])
  expect(feetOnly).toContain("class Feet")
  expect(feetOnly).not.toContain("class Hang")
})

/** A chain of the beast's tail with every word written otherwise: resting on a floor, held within 40 degrees, heavier, shown seven tenths. */
const restingTail = () => hangChains({ ...beast, follow: [{ bone: "tail", mode: "hang", attract: 0.1, falloff: 0.3, damping: 0.2, gravity: 2, limit: 40, floor: true, weight: 0.7 }, { bone: "tail_mid", mode: "hang" }, { bone: "tail_end", mode: "hang" }] })[0]!
const FRAMES = 160
const FLOOR = 0.55
const walk = beast.animations.find((clip) => clip.name === "walk")!
/** Frame by frame: where the body is, how it is turned, the bones as the walk poses them. Walking, turning and climbing a little. */
const frames = Array.from({ length: FRAMES }, (_, frame) => ({ at: [Math.sin(frame * 0.05) * 2, 0.002 * frame, frame * 0.04] as [number, number, number], yaw: frame * 2.5, rig: rigOf(beast, walk, frame / 80) }))

/** The chains over the frames, one step a frame, in TypeScript: each frame's turns of the links. */
function chainsInTypeScript(chains: HangChain[]) {
  const out: number[] = []
  chains.forEach((chain) => {
    let x: number[] = []
    let before: number[] = []
    frames.forEach((frame, index) => {
      const rig: Rig = { ...frame.rig, rot: [...frame.rig.rot], pos: [...frame.rig.pos] }
      const target = toWorld(hangTargets(rig, chain), frame.at, frame.yaw, 1)
      if (index === 0) {
        x = [...target]
        before = [...target]
      } else hangStep(chain, x, before, target, chain.floor ? new Array<number>(target.length / 3).fill(FLOOR) : null)
      hangSolve(rig, chain, toModel(x, frame.at, frame.yaw, 1))
      chain.bones.forEach((bone) => out.push(rig.rot[bone * 3]!, rig.rot[bone * 3 + 1]!, rig.rot[bone * 3 + 2]!))
      x.forEach((value) => out.push(value))
    })
  })
  return out
}

const LIFTS = [5, -3.5, 0, -8]
function feetInTypeScript() {
  const rig = rigOf(beast, walk, 0.3)
  footSolve(rig, footPlan(beast)!, LIFTS)
  return [...rig.rot, ...rig.pos]
}

const JAVA = targetJdkTool("fabric-1.21.1-official", "java")
test.skipIf(!existsSync(JAVA))("挂链和踩地：游戏里的 Java 和预览的 TypeScript 用同样的数算出同样的结果", async () => {
  const chains = [hangChains(beast)[0]!, restingTail()]
  const plan = footPlan(beast)!
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-pose-rig-"))
  roots.push(root)
  const feetRig = rigOf(beast, walk, 0.3)
  const numbers = (list: readonly number[]) => list.map((value) => String(value)).join(" ")
  const data = [
    String(FRAMES),
    numbers(frames[0]!.rig.pivot),
    ...frames.map((frame) => numbers([frame.yaw, ...frame.at, ...frame.rig.rot, ...frame.rig.pos, ...frame.rig.scale])),
    numbers([...feetRig.rot, ...feetRig.pos, ...feetRig.scale]),
  ]
  await writeFile(path.join(root, "frames.txt"), data.join("\n"))
  await writeFile(
    path.join(root, "PoseRigCheck.java"),
    `public class PoseRigCheck {
    static final int[] PARENT = {${frames[0]!.rig.parent.join(", ")}};
${RIG_JAVA}
${HANG_JAVA}
${FEET_JAVA}
    static double[] read(String line) {
        String[] words = line.trim().split(" ");
        double[] out = new double[words.length];
        for (int index = 0; index < words.length; index++) out[index] = Double.parseDouble(words[index]);
        return out;
    }

    static void load(Rig rig, double[] values, int from) {
        int n = rig.rot.length;
        System.arraycopy(values, from, rig.rot, 0, n);
        System.arraycopy(values, from + n, rig.pos, 0, n);
        System.arraycopy(values, from + 2 * n, rig.scale, 0, n);
    }

    public static void main(String[] args) throws Exception {
        java.util.List<String> lines = java.nio.file.Files.readAllLines(java.nio.file.Paths.get(args[0]));
        int frames = Integer.parseInt(lines.get(0).trim());
        double[] pivot = read(lines.get(1));
        Hang[] hangs = {${chains.map(hangJava).join(", ")}};
        StringBuilder out = new StringBuilder();
        for (Hang hang : hangs) {
            double[] x = null, before = null;
            for (int frame = 0; frame < frames; frame++) {
                double[] values = read(lines.get(2 + frame));
                Rig rig = new Rig(PARENT);
                System.arraycopy(pivot, 0, rig.pivot, 0, pivot.length);
                load(rig, values, 4);
                double[] at = {values[1], values[2], values[3]};
                double[] target = rigToWorld(hangTargets(rig, hang), at, values[0], 1.0);
                if (frame == 0) {
                    x = target.clone();
                    before = target.clone();
                } else {
                    double[] floors = null;
                    if (hang.floor) {
                        floors = new double[target.length / 3];
                        java.util.Arrays.fill(floors, ${FLOOR});
                    }
                    hangStep(hang, x, before, target, floors);
                }
                hangSolve(rig, hang, rigToModel(x, at, values[0], 1.0));
                for (int bone : hang.bones) for (int axis = 0; axis < 3; axis++) out.append(rig.rot[bone * 3 + axis]).append(' ');
                for (double value : x) out.append(value).append(' ');
            }
        }
        out.append('\\n');
        Rig rig = new Rig(PARENT);
        System.arraycopy(pivot, 0, rig.pivot, 0, pivot.length);
        load(rig, read(lines.get(2 + frames)), 0);
        footSolve(rig, ${feetJava(plan)}, new double[] {${LIFTS.map((value) => `${value}`).join(", ")}});
        for (double value : rig.rot) out.append(value).append(' ');
        for (double value : rig.pos) out.append(value).append(' ');
        System.out.print(out);
    }
}
`,
  )
  const compiled = Bun.spawnSync([targetJdkTool("fabric-1.21.1-official", "javac"), "-d", root, path.join(root, "PoseRigCheck.java")])
  expect(compiled.stderr.toString()).toBe("")
  const run = Bun.spawnSync([JAVA, "-cp", root, "PoseRigCheck", path.join(root, "frames.txt")])
  expect(run.stderr.toString()).toBe("")
  const [hung, stood] = run.stdout.toString().split("\n").map((line) => line.trim().split(" ").map(Number))
  const expectedHung = chainsInTypeScript(chains)
  const expectedStood = feetInTypeScript()
  expect(hung!.length).toBe(expectedHung.length)
  expect(stood!.length).toBe(expectedStood.length)
  const worst = (got: number[], want: number[]) => Math.max(...got.map((value, index) => Math.abs(value - want[index]!)))
  expect(worst(hung!, expectedHung)).toBeLessThan(1e-9)
  expect(worst(stood!, expectedStood)).toBeLessThan(1e-9)
  // The numbers did something: the tail moved off the walk's pose, and the feet moved the body.
  const last = (FRAMES - 1) * 21
  expect(Math.max(...expectedHung.slice(0, 9).map(Math.abs))).toBe(0)
  expect(Math.max(...expectedHung.slice(last, last + 9).map(Math.abs))).toBeGreaterThan(0.05)
  expect(worst(expectedStood, [...feetRig.rot, ...feetRig.pos])).toBeGreaterThan(0.1)
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: 尾巴挂着、脚踩地的四足兽由 Studio 自己的构建组装，按真实的 class path 编译通过`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-pose-rig-"))
    roots.push(root)
    const directory = path.join(root, "四足兽")
    const created = await createProject({ directory, name: "四足兽", description: "尾巴会垂、脚会踩台阶的四足兽。", mod_id: "beast_mod", target })
    const creature = (name: string, name_en: string, more: Record<string, unknown>) => EntitySchema.parse({ ...createEntity({ name, description: name, health: 30, speed: 0.25, attack_damage: 3, behavior: "passive" }), name_en, ...more })
    const entities = [creature("四足兽", "Beast", {}), creature("披风傀儡", "Caped Golem", { behavior: "hostile" })]
    let project = await saveProject(directory, { ...created, entities }, created.revision)
    project = (await putModelAsset(directory, { entity_id: entities[0]!.id, data: { design: beast }, origin: "example", expectedRevision: project.revision })).project
    project = (await putModelAsset(directory, { entity_id: entities[1]!.id, data: { design: capedGolem }, origin: "example", expectedRevision: project.revision })).project
    const source = path.join(root, "source")
    await mkdir(source)
    const assembled = await assembleBuildSource(directory, source, TEMPLATE)
    expect(assembled.guide.markdown).toContain("挂链会受重力垂下")
    expect(assembled.guide.markdown).toContain("踩地让脚在画面里随台阶和斜坡的高低调整")
    if (target === "forge-1.20.1") expect((await projectGuide(directory)).guide.markdown).toContain("挂链会受重力垂下")
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
    const renderers = await Promise.all(names.filter((name) => /Renderer/.test(path.basename(name))).map((name) => readFile(name, "utf8")))
    expect(renderers.filter((text) => text.includes("class Hang") && text.includes("class Feet")).length).toBe(1)
    expect(renderers.filter((text) => text.includes("class StudioPose")).length).toBe(2)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

test("在 Blockbench 里改过的模型：挂链和踩地从改之前的设计留下来；骨骼没了的腿不留，身体没了就不写 body", async () => {
  const { blockbenchToDesign, designToBlockbench } = await import("../src/blockbench")
  const { keptPlayWords } = await import("../src/blockbench-keys")
  const edited = blockbenchToDesign(designToBlockbench(beast))
  expect(edited.foot_placement ?? null).toBeNull()
  const kept = keptPlayWords(edited, beast)
  expect(kept.follow).toEqual(beast.follow!)
  expect(kept.foot_placement).toEqual(beast.foot_placement!)
  const legless = { ...edited, bones: edited.bones.filter((bone) => !bone.name.startsWith("front_left")) }
  expect(keptPlayWords(legless, beast).foot_placement!.feet.map((foot) => foot.thigh)).toEqual(["front_right_thigh", "hind_left_thigh", "hind_right_thigh"])
  const unplaced = { ...edited, bones: edited.bones.filter((bone) => !bone.name.includes("thigh") && !bone.name.includes("calf")) }
  expect(keptPlayWords(unplaced, beast).foot_placement).toBeUndefined()
})
