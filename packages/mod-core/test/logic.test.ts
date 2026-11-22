import { expect, test } from "bun:test"
import { compileEntity } from "../src/fabric/entity"

const model = {
  name: "铜鸮",
  texture_size: 64,
  bones: [{
    name: "root",
    parent: null,
    pivot: [0, 0, 0],
    rotation: [0, 0, 0],
    cubes: [{
      name: "body",
      origin: [-2, 0, -2],
      size: [4, 8, 4],
      faces: { north: "#cc9966", east: "#cc9966", south: "#cc9966", west: "#cc9966", up: "#cc9966", down: "#cc9966" },
    }],
  }],
  animations: ["idle", "walk", "hurt"].map((name) => ({
    name,
    length: 1,
    loop: name !== "hurt",
    channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }],
  })),
}

test("compiles content logic into executable entity hooks", () => {
  const files = compileEntity({
    modId: "aviary",
    packageName: "studio.aviary",
    id: "copper_owl",
    name: "铜鸮",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "passive",
    model,
    animationNames: ["flight"],
    logic: [
      { id: "11111111-1111-4111-8111-111111111111", entity_id: "22222222-2222-4222-8222-222222222222", trigger: "player_near", action: "look", enabled: true },
      { id: "33333333-3333-4333-8333-333333333333", entity_id: "22222222-2222-4222-8222-222222222222", trigger: "holding_item", action: "follow", item: "minecraft:feather", enabled: true },
      { id: "44444444-4444-4444-8444-444444444444", entity_id: "22222222-2222-4222-8222-222222222222", trigger: "hurt", action: "play_animation", animation: "flight", enabled: true },
    ],
  })
  const source = String(files["src/main/java/studio/aviary/entity/StudioCreature.java"])
  expect(source).toContain("getLookControl().setLookAt(player")
  expect(source).toContain("getNavigation().moveTo(player, 1.0)")
  expect(source).toContain("else if (studioLogicFollowing)")
  expect(source).toContain("getNavigation().stop()")
  expect(source).toContain("getMainHandItem().is(BuiltInRegistries.ITEM.get(ResourceLocation.fromNamespaceAndPath(\"minecraft\", \"feather\")))")
  expect(source).toContain('.triggerableAnim("logic_0", RawAnimation.begin().then("animation.copper_owl.flight"')
  expect(source).toContain('triggerAnim("logic", "logic_0")')
  expect(source).toContain("if (!level().isClientSide()) applyStudioLogic();")
})

test("rejects a logic animation absent from the saved model", () => {
  expect(() => compileEntity({
    modId: "aviary",
    packageName: "studio.aviary",
    id: "copper_owl",
    name: "铜鸮",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "passive",
    model,
    logic: [{
      id: "55555555-5555-4555-8555-555555555555",
      entity_id: "22222222-2222-4222-8222-222222222222",
      trigger: "hurt",
      action: "play_animation",
      animation: "fly",
      enabled: true,
    }],
})).toThrow(/不存在的动画/)
})

test("emits all supported trigger and action combinations with required context", () => {
  const triggers = ["player_near", "holding_item", "hurt"] as const
  const actions = ["look", "follow", "play_animation"] as const
  const logic = triggers.flatMap((trigger, triggerIndex) => actions.map((action, actionIndex) => ({
    id: `66666666-6666-4666-8666-${String(triggerIndex * 3 + actionIndex + 1).padStart(12, "0")}`,
    entity_id: "22222222-2222-4222-8222-222222222222",
    trigger,
    action,
    ...(trigger === "holding_item" ? { item: "minecraft:feather" } : {}),
    ...(action === "play_animation" ? { animation: "idle" } : {}),
    enabled: true,
  })))
  const files = compileEntity({ modId: "aviary", packageName: "studio.aviary", id: "copper_owl", name: "铜鸮", health: 20, speed: 0.2, attack_damage: 3, behavior: "passive", model, logic })
  const source = String(files["src/main/java/studio/aviary/entity/StudioCreature.java"])
  expect(source).toContain("Player player = level().getNearestPlayer(this, 8.0);")
  expect(source.match(/triggerableAnim/g)).toHaveLength(3)
  expect(source).toContain("studioLogicFollowing")
  expect(source).toContain("studioLogicHurtFollowUntil")
  expect(source).toContain("tickCount + 40")
  expect(source).not.toContain("tickCount % 10")
})
