import { expect, test } from "bun:test"
import { compileEntity } from "../src/fabric/entity"

const model = {
  name: "Creature",
  texture_size: 64,
  bones: [
    {
      name: "root",
      parent: null,
      pivot: [0, 0, 0],
      rotation: [0, 0, 0],
      cubes: [
        {
          name: "body",
          origin: [-2, 0, -2],
          size: [4, 8, 4],
          faces: {
            north: "#cc9966",
            east: "#cc9966",
            south: "#cc9966",
            west: "#cc9966",
            up: "#cc9966",
            down: "#cc9966",
          },
        },
      ],
    },
  ],
  animations: ["idle", "walk", "hurt"].map((name) => ({
    name,
    length: 1,
    loop: name !== "hurt",
    channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }],
  })),
}

test("entity compilation includes client registration, attributes, gameplay, actual texture and animation resources", () => {
  const files = compileEntity({
    modId: "forest",
    packageName: "studio.forest",
    id: "mushroom_cow",
    name: "蘑菇牛",
    health: 24,
    speed: 0.25,
    attack_damage: 3,
    behavior: "follow",
    model,
  })
  expect(Object.keys(files).every((file) => !file.includes("..") && !file.startsWith("/"))).toBe(true)
  const geometry = JSON.parse(String(files["src/main/resources/assets/forest/geo/mushroom_cow.geo.json"]))
  expect(geometry["minecraft:geometry"][0].bones[0].name).toBe("root")
  expect(
    Buffer.from(files["src/main/resources/assets/forest/textures/entity/mushroom_cow.png"] as Uint8Array)
      .subarray(0, 8)
      .toString("hex"),
  ).toBe("89504e470d0a1a0a")
  const animation = JSON.parse(String(files["src/main/resources/assets/forest/animations/mushroom_cow.animation.json"]))
  expect(Object.keys(animation.animations)).toHaveLength(3)
  expect(String(files["src/main/java/studio/forest/StudioContent.java"])).toContain(
    "FabricDefaultAttributeRegistry.register",
  )
  expect(String(files["src/main/java/studio/forest/client/StudioClient.java"])).toContain(
    "EntityRendererRegistry.register",
  )
})

test("rejects a model with no required animation and unsafe Java identifiers", () => {
  expect(() =>
    compileEntity({
      modId: "forest",
      packageName: "studio.forest",
      id: "bad/path",
      name: "牛",
      health: 20,
      speed: 0.2,
      attack_damage: 3,
      behavior: "passive",
      model,
    }),
  ).toThrow()
  expect(() =>
    compileEntity({
      modId: "forest",
      packageName: "studio.forest",
      id: "cow",
      name: "牛",
      health: 20,
      speed: 0.2,
      attack_damage: 3,
      behavior: "passive",
      model: { ...model, animations: [] },
    }),
  ).toThrow()
})

test("exports saved loop modes and a hurt controller that survives the damage flash", () => {
  const files = compileEntity({
    modId: "a",
    packageName: "studio.a",
    id: "cow",
    name: "Cow",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "passive",
    model: {
      ...model,
      animations: model.animations.map((animation) => ({
        ...animation,
        loop: false,
        length: animation.name === "hurt" ? 2 : animation.length,
      })),
    },
  })
  const source = String(files["src/main/java/studio/a/entity/StudioCreature.java"])
  expect(source).toContain('then("animation.cow.idle", Animation.LoopType.PLAY_ONCE)')
  expect(source).toContain('then("animation.cow.walk", Animation.LoopType.PLAY_ONCE)')
  expect(source).toContain('then("animation.cow.hurt", Animation.LoopType.PLAY_ONCE)')
  expect(source).toContain('new AnimationController<>(this, "hurt", 0')
  expect(source).toContain("hurtTime > lastHurtTime")
  expect(source).toContain("state.getController().hasAnimationFinished()")
  expect(source).not.toContain("hurtTime > 0 ? HURT")
})

test("looping hurt animations complete their current cycle before releasing movement", () => {
  const files = compileEntity({
    modId: "a",
    packageName: "studio.a",
    id: "cow",
    name: "Cow",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "passive",
    model: {
      ...model,
      animations: model.animations.map((animation) => ({
        ...animation,
        loop: true,
        length: animation.name === "hurt" ? 2 : animation.length,
      })),
    },
  })
  const source = String(files["src/main/java/studio/a/entity/StudioCreature.java"])
  expect(source).toContain('then("animation.cow.hurt", Animation.LoopType.LOOP)')
  expect(source).toContain("Math.ceil(hurtTime / 40.0) * 40.0")
  expect(source).toContain("hurtTime == 0 && tickCount >= hurtLoopStopTick")
})

test("entity compilation includes executable logic hooks when supplied", () => {
  const files = compileEntity({
    modId: "a",
    packageName: "studio.a",
    id: "cow",
    name: "Cow",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "passive",
    model,
    logic: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        entity_id: "44444444-4444-4444-8444-444444444444",
        trigger: "hurt",
        action: "look",
        enabled: true,
      },
    ],
  })
  const source = String(files["src/main/java/studio/a/entity/StudioCreature.java"])
  expect(source).toContain("if (hurtTime > studioLogicLastHurtTime && player != null)")
  expect(source).toContain("getLookControl().setLookAt(player, 30.0f, 30.0f)")
  expect(files["src/main/java/studio/a/StudioLogicHooks.java"]).toBeUndefined()
})

test("entity compilation emits Fabric runtime spawn, fuse, effects, movement and armor behavior", () => {
  const files = compileEntity({
    modId: "runtime_owl",
    packageName: "studio.runtime_owl",
    id: "runtime_owl",
    name: "Runtime Owl",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "hostile",
    model,
    runtime: {
      spawn: { biomes: ["minecraft:plains"], weight: 10, min: 1, max: 2 },
      explosion: {
        fuse_ticks: 20,
        radius: 2,
        damage_blocks: false,
        effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 1 }],
      },
      movement: "strafe",
      armor: 4,
      charging_armor: 8,
      texture_asset_id: null,
    },
  })
  const content = String(files["src/main/java/studio/runtime_owl/StudioContent.java"])
  const entity = String(files["src/main/java/studio/runtime_owl/entity/StudioCreature.java"])
  expect(content).toContain("BiomeModifications.addSpawn")
  expect(content).toContain('ResourceLocation.fromNamespaceAndPath("minecraft", "plains")')
  expect(content).toContain("MobCategory.MONSTER")
  expect(entity).toContain("level().explode(this")
  expect(entity).toContain("false, Level.ExplosionInteraction.NONE")
  expect(entity).toContain("MobEffectInstance")
  expect(entity).toContain("Attributes.ARMOR")
  expect(entity).toContain("RuntimeMovementGoal")
  expect(entity).toContain("setBaseValue(charging ? 8 : 4)")
  expect(content).toContain("SpawnPlacements.register(CREATURE, SpawnPlacementTypes.ON_GROUND")
  expect(content).toContain("Monster.isDarkEnoughToSpawn(world, pos, random)")
  expect(entity).toContain("goalSelector.addGoal(1, new RuntimeMovementGoal())")
  expect(entity).not.toContain("new MeleeAttackGoal")
  expect(entity).toContain('nbt.contains("RuntimeFuseTicks")')
})
