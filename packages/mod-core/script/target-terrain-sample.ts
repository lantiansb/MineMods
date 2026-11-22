import path from "node:path"
import { BlockSchema } from "../src/content"
import { AbilitySchema } from "../src/entity-runtime"
import { saveProject, EntitySchema } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetGroundFxSample, scorchAbility } from "./target-groundfx-sample"
export const terrainEvents = [
  {
    type: "shockwave",
    at: 0.7,
    where: "self",
    hit: null,
    forward: 0,
    left: 0,
    from_radius: 0,
    to_radius: 8,
    seconds: 2,
    width: 1,
    height: 0,
    color: "#a3c9da",
    glow: false,
    damage: 0,
    knockback: 0,
    hits: "everyone",
    effects: [],
    pop_blocks: { height: 1.5, every: 2, max: 64 },
  },
  ...(["column", "spike", "wall"] as const).map((shape, i) => ({
    type: "terrain_rise",
    at: 0.7,
    where: "self",
    hit: null,
    forward: 4,
    left: (i - 1) * 4,
    shape,
    width: 2,
    height: 4,
    rise_seconds: 1,
    stay_seconds: 2,
    lifts: true,
    damage: 2,
    knockback: 0.2,
    shatter: true,
  })),
  {
    type: "block_swap",
    at: 0.7,
    where: "self",
    hit: null,
    forward: 8,
    left: 0,
    block: "minecraft:ice",
    area: { shape: "circle", radius: 2, height: 1 },
    restore_after: 4,
    only_replace: ["solid"],
  },
]
export const terrainAbility = AbilitySchema.parse({
  ...scorchAbility,
  id: "earth_forms",
  name: "地形变化",
  events: terrainEvents,
})
const arenaMoves = [
  AbilitySchema.parse({
    ...terrainAbility,
    stages: [{kind:"windup",until:0.7},{kind:"loop",until:terrainAbility.length,end:{collision:[
      {when:{if:"collision",with:"own_terrain"},result:{shatter_terrain:3}},
      {when:{if:"collision",with:"world"},result:{interrupt:true}},
    ]}}],
    moves: [{type:"dash",from:0.7,to:1,speed:12,distance:3,aim:"locked_at_windup",hit:null,stop_at_wall:true,break_hardness:2}],
    events: terrainAbility.events.map(e => e.type === "terrain_rise" ? {
      ...e, restore_on_exit:true, hardness:2, blocks:{beam:true,area:true,projectile:true},
      material:e.shape==="spike" ? "minecraft:stone" : e.shape==="column" ? "minecraft:packed_ice" : "veined_slate",
    } : e.type==="block_swap" ? {...e,restore_on_exit:true} : e),
  }),
  ...[false,true].map(smash => AbilitySchema.parse({
    ...terrainAbility,id:smash?"crush":"shelter",events:[],
    hits:[{type:"area",at:0.7,shape:{type:"sphere",forward:3,up:1,left:0,radius:5},hits:"everyone",damage:8,knockback:0,effects:[],blocked_by_walls:true,...(smash?{break_terrain:3}:{})}],
  })),
  AbilitySchema.parse({...terrainAbility,id:"fracture",events:[{type:"break",at:0.7,where:"self",hit:null,forward:3,up:0,left:0,radius:2,height:4,hardness:3,drops:false}]}),
]
export async function createTargetTerrainSample(directory: string, target: TargetId, surfaces = false) {
  const project = await createTargetGroundFxSample(directory, target)
  return saveProject(
    directory,
    {
      ...project,
      ...(surfaces ? {blocks:[...project.blocks,BlockSchema.parse({id:"f723116c-a825-48b7-a8f8-68100210671e",identifier:"veined_slate",name:"铜纹岩",name_en:"Copper Slate",hardness:2,luminance:0,tool:"pickaxe",drop:"self",color:"#B45B38"})]} : {}),
      entities: project.entities.map((e, i) =>
        i === 0 ? EntitySchema.parse({ ...e, name: "大地守卫", ...(surfaces && e.boss ? {boss:{...e.boss,leash:{distance:48,reset_seconds:120}}} : {}), abilities: surfaces ? arenaMoves : [terrainAbility] }) : e,
      ),
    },
    project.revision,
  )
}

/** A player item using only the shared gameplay API, with no creature terrain events. */
export async function createTargetTerrainGameplaySample(directory: string, target: TargetId, cover = false) {
  const project = await createTargetTerrainSample(directory, target)
  const now = new Date().toISOString()
  const document = {
    kind: "gameplay",
    slug: "terrain_wand",
    name: "通用地形法杖",
    summary: "木棍长柱、雪球铺冰、烈焰棒掀地",
    behaviours: [
      { when: "主手使用原版物品", does: "木棍升柱、雪球临时铺冰、烈焰棒掀起地面", shows: "柱子、冰地和掀起的地面块" },
    ],
    not_doing: [],
    uses: [],
    sources: [
      {
        path: "Main.java",
        content: `package com.minemods.content_ground_fire_camp.gameplay.terrain_wand;
import com.minemods.content_ground_fire_camp.gameplay.api.*;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.Items;
public final class Main implements GameplayEntry {
 public void onInitialize() {
  ProjectPlatform.onUseItem((player,world,hand)->{
   if(hand!=InteractionHand.MAIN_HAND || player.isSpectator())return InteractionResult.PASS;
   var held=player.getItemInHand(hand);
   if(!held.is(Items.STICK)&&!held.is(Items.SNOWBALL)&&!held.is(Items.BLAZE_ROD)${cover ? "&&!held.is(Items.ICE)&&!held.is(Items.CLAY_BALL)" : ""})return InteractionResult.PASS;
   if(!world.isClientSide()) {
    ${cover ? `if(held.is(Items.ICE))ProjectContent.terrainRiseWith(world,player.position(),player.getYRot(),"wall",3,3,20,40,true,0f,0,true,player,1,"minecraft:packed_ice",true,true,true,2,true);
    if(held.is(Items.CLAY_BALL))ProjectContent.blockSwapWithOwner(world,player.position(),"minecraft:stone","circle",2,1,80,"solid",player);
    ` : ""}if(held.is(Items.STICK))ProjectContent.terrainRise(world,player.position(),player.getYRot(),"column",2,4,20,40,true,0f,0,true,player);
    if(held.is(Items.SNOWBALL))ProjectContent.blockSwap(world,player.position(),"minecraft:ice","circle",3,1,80,"solid");
    if(held.is(Items.BLAZE_ROD))ProjectContent.popBlocks(world,player.position(),0,8,40,1.5,2,48);
   }
   return InteractionResult.SUCCESS;
  });
 }
}`,
      },
    ],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  }
  const { WorkspaceAssetSchema } = await import("../src/workspace")
  const asset = WorkspaceAssetSchema.parse({
    id: crypto.randomUUID(),
    module: "gameplay",
    title: "通用地形法杖",
    revision: 1,
    created_at: now,
    updated_at: now,
    prompt: "给玩家物品使用的临时地形",
    dependencies: [],
    document,
    provenance: { model: "example", request_id: null },
    status: "ready",
  })
  return saveProject(
    directory,
    {
      ...project,
      entities: project.entities.map((e) => ({ ...e, abilities: null })),
      workspace: { assets: [...project.workspace.assets, asset] },
    },
    project.revision,
  )
}
