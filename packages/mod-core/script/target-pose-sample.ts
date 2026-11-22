import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { quadrupedFixture } from "../../studio-ai/test/quadruped-fixture"
import { putModelAsset } from "../src/assets"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign, golemAbilities } from "./data-gameplay-sample"

export const poseNames = ["沙丘耳狐", "山脊驮兽", "铜喙守卫"]
const painted = (name: string, origin: number[], size: number[], color: string) => ({
  name, origin, size, faces: Object.fromEntries(["north", "south", "east", "west", "up", "down"].map(face => [face, color])),
})
export function poseModel(subject: number): ModelDesign {
  const guard = subject === 2
  const model = ModelDesignSchema.parse(guard ? fightingGolemDesign : quadrupedFixture())
  const head = model.bones.find(b => b.name === "head")!
  const body = model.bones.find(b => b.name === "body")!
  const [x,y,z] = head.pivot
  const append = (name: string, parent: string, pivot: number[], cubes: ReturnType<typeof painted>[]) => {
    model.bones.push({ name, parent, pivot, rotation: [0,0,0], cubes } as typeof head)
  }
  append("neck", head.parent!, [x, y-2, z+2], [painted("collar", [x-2,y-2,z-1], [4,3,4], "#bb7845")])
  head.parent = "neck"
  head.cubes.push(painted("snout", [x-1.5,y-0.5,z-10], [3,2,7], "#e4ac57") as typeof head.cubes[number])
  model.look = { bones: [{bone:"neck", share:0.35, yaw:28, pitch:18}, {bone:"head", share:0.65, yaw:52, pitch:35}] }
  append("chest", body.name, body.pivot, [painted("breast", [-3, body.pivot[1]-2, body.pivot[2]-6], [6,5,4], "#b9744e")])
  model.sway = [{ bones:["chest"], axis:"z", channel:"scale", speed:0.6, amount:0.12 }]
  if (!guard) {
    model.sway.push({ bones:["tail","tail_mid","tail_end"], axis:"y", speed:0.8, amount:12, phase:55, grow:1.25 })
    model.follow = null
    const move = subject === 0 ? "nip" : "shove"
    model.animations.push({name:move, length:1.6, loop:false, channels:[{bone:"neck", keyframes:[
      {time:0, rotation:[0,0,0]}, {time:0.6, rotation:[-24,0,0]}, {time:0.8, rotation:[32,0,0]},
      {time:1.05, rotation:[32,0,0]}, {time:1.6, rotation:[0,0,0]},
    ]}]})
    if (subject === 0) {
      for (const sign of [-1,1]) {
        const name = sign < 0 ? "ear_right" : "ear_left"
        append(name, "head", [2*sign,y+2,z-3], [painted("ear", [2*sign-1,y+2,z-4], [2,5,2], "#e8c996")])
        model.sway.push({ bones:[name], axis:"z", amount:12, speed:0.7 })
      }
    }
  } else {
    const slam = model.animations.find(c=>c.name === "slam")!
    const timing = new Map([[0, 0], [0.5, 1.8], [0.7, 1.9], [0.85, 2.2], [1.2, 3]])
    for (const channel of slam.channels) {
      for (const key of channel.keyframes) {
        const at = timing.get(key.time)
        if (at === undefined) throw new Error("重锤的关键帧已变化，请重新对齐蓄力、判定和收招。")
        key.time = at
      }
    }
    slam.length = 3
    slam.weights = { look:[{time:0,value:1},{time:1.6,value:1},{time:1.9,value:0},{time:2.5,value:0},{time:3,value:1}], sway:[{time:0,value:0}] }
    model.follow = [{ bone: "head", period: 0.4, limit: 5 }]
  }
  const scale = [0.85, 2.5, 2.1][subject]!
  model.name = poseNames[subject]!
  model.texture_size = 256
  for (const bone of model.bones) {
    for(let i=0;i<3;i++) bone.pivot[i] = Math.round(bone.pivot[i]! * scale)
    for(const cube of bone.cubes) for(let i=0;i<3;i++) {
      cube.origin[i] = Math.round(cube.origin[i]! * scale)
      cube.size[i] = Math.max(1, Math.round(cube.size[i]! * scale))
    }
  }
  return ModelDesignSchema.parse(model)
}
export async function createPoseSample(directory: string, target: TargetId) {
  const created = await createProject({directory, target, name:"程序动作试场", description:"看向、呼吸和蓄力的三种体型。",mod_id:"pose_field"})
  const entities = poseNames.map((name,i) => EntitySchema.parse({
    ...createEntity({name,description:name,behavior:"hostile",health:120,speed:0.2,attack_damage:2}),
    id: "10000000-0000-4000-8000-00000000000"+(i+1),
    ...(i===2 ? { engagement:"provoked", steady:{preset:"huge",body_turn:50,head:{turn:220,yaw:75,pitch:42},ability_turn:36},
      abilities:[{...golemAbilities[0], windup:1.8, length:3, turn_speed:36, hits:[{...golemAbilities[0]!.hits[0], at:1.9}], events:[], start:{min_distance:0,max_distance:15,line_of_sight:false,cooldown:3,weight:1}}] } : {
      engagement:"provoked",
      abilities:[{...golemAbilities[0], id:i===0?"nip":"shove", name:i===0?"探身啄咬":"低头顶撞", clip:i===0?"nip":"shove",
        windup:0.6, length:1.6, hits:[{...golemAbilities[0]!.hits[0],at:0.8,damage:2,effects:[]}], events:[],
        start:{min_distance:0,max_distance:15,line_of_sight:false,cooldown:3,weight:1}}],
    }),
  }))
  let project=await saveProject(directory,{...created,entities},created.revision)
  for(const [i,entity] of entities.entries())
    project=(await putModelAsset(directory,{entity_id:entity.id,data:{design:poseModel(i)},origin:"example",expectedRevision:project.revision})).project
  return project
}
