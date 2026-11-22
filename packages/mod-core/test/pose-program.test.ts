import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { clipWeightSampler, weightAt, weightSlew } from "@minemods/studio-ai/clip-weights"
import { lookPlan, lookSolve, lookStep, type Gaze } from "@minemods/studio-ai/look-bones"
import { rigOf } from "@minemods/studio-ai/pose-rig"
import { swayApply, swayPlan } from "@minemods/studio-ai/sway-bones"
import { poseModel } from "../script/target-pose-sample"
import { LOOK_JAVA, RIG_JAVA, SWAY_JAVA } from "../src/fabric/pose-rig-java"
import { WEIGHT_JAVA, weightMembers } from "../src/fabric/pose-weights-java"
import { targetJdkTool } from "./target-javac"

const target = "fabric-1.21.1-official"
test.skipIf(!existsSync(targetJdkTool(target, "javac")))("四足兽连续160帧的看向、摆动和动作权重在 Java 和 TypeScript 中一致", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pose-program-"))
  try {
    const model = poseModel(1), look = lookPlan(model)!, sway = swayPlan(model)
    const clip = model.animations[1]!
    const keys = [{time:0,value:1},{time:1,value:0},{time:3,value:0},{time:4,value:1}]
    const sample = clipWeightSampler({look:keys}, 8)
    const first = rigOf(model, clip, 0), lines: string[] = [], values: number[] = []
    let gaze: Gaze = [0,0], w = 1
    let moved = false
    for (let frame=0; frame<160; frame++) {
      const t=frame/20, rig=rigOf(model, clip, t)
      const target: Gaze = [85*Math.sin(t),45*Math.cos(t*1.5)]
      lines.push([...target, ...rig.rot, ...rig.pos, ...rig.scale].join(" "))
      gaze=lookStep(gaze,target,look.speed,0.05)
      w=weightSlew(w,weightAt(keys,t),frame ? 1 : 0)
      expect(w).toBeCloseTo(sample("look",t),12)
      const head=look.bones.at(-1)!.index * 3
      const original=rig.rot.slice(head,head+3)
      swayApply(rig,sway,t,w,0.37)
      lookSolve(rig,look,gaze,w)
      if (w===0) expect(rig.rot.slice(head,head+3)).toEqual(original)
      if (w>0 && Math.abs(rig.rot[head+1]!-original[1]!)>0.05) moved=true
      values.push(...gaze,w,...rig.rot,...rig.pos,...rig.scale)
    }
    expect(moved).toBe(true)
    await writeFile(path.join(root,"frames.txt"),lines.join("\n"))
    await writeFile(path.join(root,"Mirror.java"),`import java.nio.file.*; import java.io.*;
public class Mirror {
${RIG_JAVA}
${LOOK_JAVA}
${SWAY_JAVA}
${WEIGHT_JAVA}
  public static void main(String[] args) throws Exception {
    Rig rig=new Rig(new int[]{${first.parent.join(",")}});
    double[] piv={${first.pivot.join(",")}}, gaze={0,0}, keys={0,1,1,0,3,0,4,1}; double weight=1; int frame=0;
    System.arraycopy(piv,0,rig.pivot,0,piv.length);
    try(var out=new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(Path.of("values.bin"))))) {
      for(String line: Files.readAllLines(Path.of("frames.txt"))){
        String[] row=line.split(" "); int at=2;
        for(double[] arr:new double[][]{rig.rot,rig.pos,rig.scale})for(int j=0;j<arr.length;j++)arr[j]=Double.parseDouble(row[at++]);
        double t=frame/20.0;
        lookStep(gaze,Double.parseDouble(row[0]),Double.parseDouble(row[1]),${look.speed},0.05);
        weight=weightSlew(weight,weightAt(keys,t),frame==0?0:1);
${sway.map(s=>`        swayApply(rig,new int[]{${s.bones.join(",")}},${s.axis},${["rotation","position","scale"].indexOf(s.channel)},${s.speed},${s.amount},${s.phase},${s.grow},t,weight,0.37);`).join("\n")}
        lookSolve(rig,new int[]{${look.bones.map(b=>b.index)}},new double[][]{${look.bones.map(b=>`{${b.share},${b.yaw},${b.pitch}}`)}},gaze,weight);
        out.writeDouble(gaze[0]);out.writeDouble(gaze[1]);out.writeDouble(weight);
        for(double[] arr:new double[][]{rig.rot,rig.pos,rig.scale})for(double v:arr)out.writeDouble(v);
        frame++;
      }
    }
  }
}`)
    for (const [tool,args] of [["javac",["Mirror.java"]],["java",["-cp",".","Mirror"]]] as const) {
      const proc=Bun.spawnSync([targetJdkTool(target,tool),...args],{cwd:root})
      if(proc.exitCode!==0) throw new Error(proc.stderr.toString())
    }
    const output=await readFile(path.join(root,"values.bin"))
    expect(output.length).toBe(values.length*8)
    let worst=0
    values.forEach((v,i)=>{worst=Math.max(worst,Math.abs(v-output.readDoubleBE(i*8)))})
    console.log(`程序层 160 帧、${values.length} 个数，最大绝对误差 ${worst}`)
    expect(worst).toBeLessThan(1e-9)
  } finally { await rm(root,{recursive:true,force:true}) }
},30000)

test.skipIf(!existsSync(targetJdkTool(target, "java")))("同一控制器重播同名动作时，从头读取权重轨道", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pose-replay-"))
  try {
    const members = weightMembers([{ name: "hurt", weights: { look: [{time: 0, value: 1}, {time: 0.5, value: 0}] } }])
    await writeFile(path.join(root, "Replay.java"), `import java.util.*;
class Replay {
    record Animation(String name) {}
    record Stage(Animation animation) {}
    static class AnimationController<T> {
        enum State { RUNNING, STOPPED }
        Stage stage;
        String getName() { return "hurt"; }
        State getAnimationState() { return State.RUNNING; }
        Stage getCurrentAnimation() { return stage; }
    }
    static class AnimatableManager<T> {
        AnimationController<T> ctrl = new AnimationController<>();
        Map<String,AnimationController<T>> getAnimationControllers() { return Map.of("hurt", ctrl); }
    }
    static class State {
        double weightAt = Double.NaN;
        double[] want = new double[4], weight = {1,1,1,1};
        Map<String,Clock> clocks = new HashMap<>();
    }
${members}
    public static void main(String[] args) {
        var pose = new Replay();
        var manager = new AnimatableManager<>();
        var state = new State();
        var hurt = new Animation("hurt");
        manager.ctrl.stage = new Stage(hurt);
        for (int t = 0; t <= 10; t++) pose.weights(manager, state, t, 0);
        if (state.weight[0] != 0) throw new AssertionError("end of first playback");
        manager.ctrl.stage = new Stage(hurt);
        pose.weights(manager, state, 11, 0);
        if (state.want[0] != 1 || state.weight[0] != 0.2) throw new AssertionError("restart and slew");
        pose.weights(manager, state, 12, 0);
        if (state.want[0] != 0.9) throw new AssertionError("advance after restart");
    }
}`)
    const result = Bun.spawnSync([targetJdkTool(target, "java"), "Replay.java"], {cwd: root})
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 30000)

