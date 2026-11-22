import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import {createDataGameplaySample} from "../../mod-core/script/data-gameplay-sample"
import os from "node:os"
import { PLAN_CHECK_WORDS } from "@minemods/mod-core/blueprint-constraints"
import { editableConnection, reviewEnabled } from "../src/connection"
import { createConnectionStore } from "../src/main/connection-store"
import { dispatchExternal } from "../src/main/external-dispatch"
import { createStudioService } from "../src/main/service"
import { reviewOffer } from "../src/renderer/features/review-offer"
import { insideTabs, creatureInside } from "../src/renderer/features/creature-inside-model"
import type { Project } from "@minemods/mod-core/project"
import type { ProjectRun } from "@minemods/mod-core/workspace-runs"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
for (const legacy of [false, true]) {
  test((legacy ? "旧连接" : "新连接") + "按保存历史取默认值，重启与两条连接路径一致", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "studio-review-default-"))
    roots.push(root)
    const store = createConnectionStore(path.join(root, "connection.json"), { encrypt: (s) => s, decrypt: (s) => s })
    const settings = {
      mode: "mcp" as const,
      baseUrl: "",
      model: "fixture",
      routerModel: "fixture",
      moduleModel: "fixture",
      transcriptionModel: "fixture",
    }
    if (legacy) await store.save({ settings })
    const options = {
      workspaceDirectory: path.join(root, "projects"),
      runtimeDirectory: path.join(root, "runtime"),
      templateDirectory: path.join(root, "templates"),
      connectionStore: store,
      ai: {},
    }
    const service = await createStudioService(options)
    const initial = await service.saveConnection(settings)
    expect(reviewEnabled(initial)).toBe(legacy)
    expect((await store.load())?.settings.review).toBeUndefined()
    const restarted = await createStudioService(options)
    const current = await restarted.getConnection()
    expect(reviewEnabled(current)).toBe(legacy)
    const view = await restarted.createProject({ name: "溪谷", description: "" })
    expect((await restarted.getProjectOverview({ projectId: view.project.id })).review_on).toBe(legacy)
    const caps = await dispatchExternal(restarted,{method:"getBlueprint",input:{projectId:view.project.id}})
    expect(caps).toMatchObject({plan_checks:{reviewer:legacy}})
    const capabilities = await dispatchExternal(restarted, { method: "getCapabilities", input: { projectId: view.project.id } })
    expect(capabilities).toMatchObject({ locked_requirements: { independent_check: PLAN_CHECK_WORDS[legacy ? "independent" : "self"] } })
    const pending = await restarted.externalRunner.nextInspection({projectId:view.project.id,wait_seconds:0})
    expect(pending).toMatchObject(legacy ? {waiting:true} : {waiting:false,review_off:true})
    const project = {
      ...view.project,
      workspace: { ...view.project.workspace, assets: [{ id: "asset" }] },
      blueprint: { entries: [{ tier: { level: "boss" } }] },
    } as Project
    const runs = [{ project_id: project.id, tasks: [{ state: "completed", asset_id: "asset" }] }] as ProjectRun[]
    const dismissed = new Set<string>()
    if (!legacy) {
      const epic = { ...project, blueprint: { ...project.blueprint!, entries: [{ tier: { level: "epic" } }] } } as Project
      expect(reviewOffer(current, epic, [], () => false)?.key).toContain("boss")
      for (const kind of ["boss", "first"]) {
        const offer = reviewOffer(current, project, runs, (key) => dismissed.has(key))
        expect(offer?.key).toContain(kind)
        dismissed.add(offer!.key)
      }
    }
    expect(reviewOffer(current, project, runs, (key) => dismissed.has(key))).toBeNull()
    const api = await restarted.saveConnection({ ...editableConnection(current), mode: "api" })
    expect(reviewEnabled(api)).toBe(true)
    const explicit = await restarted.saveConnection({ ...editableConnection(api), review: false })
    expect(reviewEnabled(explicit)).toBe(false)
    expect(reviewEnabled(await restarted.saveConnection({ ...editableConnection(explicit), mode: "mcp" }))).toBe(false)
    expect(insideTabs.map((t) => t.key)).toEqual(["moves", "phases", "stances", "shows", "sounds"])
    const data = creatureInside(view.project, {
      kind: "entity",
      name: "溪边石羊",
      description: "",
      health: 12,
      speed: 0.2,
      attack_damage: 0,
      behavior: "passive",
      model_asset_id: "7d4c4d0e-6f0a-4d53-9d55-0b1a5b0f8a11",
      runtime: {
        spawn: null,
        explosion: null,
        movement: "direct",
        armor: 0,
        charging_armor: 0,
        texture_asset_id: null,
      },
    })
    expect(data.moves).toEqual([])
    expect(data.phases).toEqual([])
  })
}

test("打开生物不画判定图，同一版复用结果，制作期间不画新的图",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"studio-creature-picture-"))
  roots.push(root)
  const workspaceDirectory=path.join(root,"projects")
  const project=await createDataGameplaySample(path.join(workspaceDirectory,"sample"),{life:true,abilities:true})
  let draws=0
  const service=await createStudioService({workspaceDirectory,runtimeDirectory:path.join(root,"runtime"),templateDirectory:path.join(root,"templates"),ai:{mode:"mcp"},look:async job=>{
    draws++
    return {ok:true,pictures:job.sheets.map(sheet=>({label:sheet.label,url:"data:image/png;base64,AA=="}))}
  }})
  try {
    const asset=project.workspace.assets.find(a=>a.document.kind==="entity")!
    if(asset.document.kind!=="entity")throw Error("缺少生物")
    const doc=asset.document
    const tab=creatureInside(project,doc)
    expect(tab.moves.length).toBeGreaterThan(1)
    const input={projectId:project.id,expectedRevision:project.revision,assetId:asset.id,part:"move" as const,key:tab.moves[0]!.id}
    expect(draws).toBe(0)
    const first=await service.getCreatureLook(input)
    expect(first.pictures.length).toBeGreaterThan(0)
    expect(await service.getCreatureLook(input)).toEqual(first)
    expect(draws).toBe(1)
    const active=await service.externalRunner.startExternal({projectId:project.id,expectedRevision:project.revision,prompt:"做一块石头",plan:{summary:"做石头",questions:[],tasks:[{key:"stone",module:"block",title:"石头",prompt:"做一块石头",source:"做一块石头",dependencies:[],target_id:null}]}})
    const view=await service.openProject(project.id)
    expect(await service.getCreatureLook({...input,expectedRevision:view.project.revision,key:tab.moves[1]!.id})).toMatchObject({pictures:[],note:expect.stringContaining("AI 正在制作")})
    expect(draws).toBe(1)
    await service.externalRunner.cancelExternalRun({projectId:project.id,runId:active.run.id})
  } finally {await service.dispose()}
},60000)
