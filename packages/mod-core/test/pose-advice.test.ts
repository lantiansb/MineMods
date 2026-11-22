import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createPoseSample, poseModel } from "../script/target-pose-sample"
import { reconcile } from "../src/reconcile"

test("单独保存的模型和生物一起核对头部角度，缺看向时标出写权重的动作", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "studio-pose-advice-"))
  try {
    const project = await createPoseSample(directory, "fabric-1.21.1")
    const models = Object.fromEntries(project.entities.map((e,i) => [e.id,poseModel(i)]))
    const animations = Object.fromEntries(Object.entries(models).map(([k,m]) => [k,m.animations.map(c=>c.name)]))
    const guard = models[project.entities[2]!.id]!
    guard.look!.bones.forEach(b => {b.yaw = 10; b.pitch = 12})
    const warnings = () => reconcile(project, {models, animations}).filter(f => f.rule === "model_pose_advice")
    expect(warnings().every(w => !w.stops)).toBe(true)
    expect(warnings().map(w=>w.text).join(" ")).toContain("55°")
    expect(warnings().map(w=>w.text).join(" ")).toContain("18°")
    guard.look = null
    expect(warnings().map(w=>w.text).join(" ")).toContain("slam 写的 weights.look 不起作用")
  } finally { await rm(directory, {recursive:true, force:true}) }
})

