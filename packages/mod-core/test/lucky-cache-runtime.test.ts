import { expect, test } from "bun:test"
import { compileContent } from "../src/content"
import { compileEntity } from "../src/fabric/entity"
import { mushroomCowDesign } from "../src/example"

const block = {
  id: "11111111-1111-4111-8111-111111111111", identifier: "test_cache", name: "测试秘匣",
  hardness: 1, luminance: 0, tool: "none", drop: "self", color: "#667744",
  lucky: { max_stack: 16, outcomes: [
    { weight: 80, items: [{ item: "minecraft:diamond", min: 1, max: 3 }], effects: [] },
    { weight: 20, items: [], effects: [{ effect: "slowness", duration_ticks: 100, amplifier: 1 }] },
  ] },
}

test("lucky blocks compile a registered single-use server interaction and bounded rewards", () => {
  const files = compileContent({ mod_id: "cache_test", package_name: "studio.cache_test", blocks: [block] })
  const handler = String(files["src/main/java/studio/cache_test/StudioLuckyCaches.java"])
  const registry = String(files["src/main/java/studio/cache_test/StudioContentRegistry.java"])
  expect(registry).toContain("StudioLuckyCaches.register()")
  expect(registry).toContain("stacksTo(16)")
  expect(handler).toContain("UseBlockCallback.EVENT.register")
  expect(handler).toContain("InteractionHand.MAIN_HAND")
  expect(handler).toContain("mayInteract")
  expect(handler).toContain("player.mayBuild()")
  expect(handler.indexOf("world.removeBlock(pos, false)")).toBeLessThan(handler.indexOf("give(world, pos, Items.DIAMOND"))
  expect(handler).toContain("random.nextInt(100)")
  expect(handler).toContain("MobEffects.MOVEMENT_SLOWDOWN")
  expect(handler).not.toContain("createExplosion")
})

test("ordinary blocks do not compile or register lucky behavior", () => {
  const { lucky, ...ordinary } = block
  const files = compileContent({ mod_id: "cache_test", package_name: "studio.cache_test", blocks: [ordinary] })
  expect(Object.keys(files).some(name => name.includes("LuckyCaches"))).toBe(false)
  expect(String(files["src/main/java/studio/cache_test/StudioContentRegistry.java"])).not.toContain("StudioLuckyCaches")
})

test("entity drops preserve vanilla loot and exclude environmental and explosion deaths", () => {
  const files = compileEntity({ modId: "cache_test", packageName: "studio.cache_test", id: "creeper", name: "苦力怕",
    health: 20, speed: 0.2, attack_damage: 3, behavior: "hostile", model: mushroomCowDesign,
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null,
      death_drop: { block_identifier: "test_cache", chance: 0.35 } },
  })
  const java = String(files["src/main/java/studio/cache_test/entity/StudioCreature.java"])
  expect(java).toContain("super.dropFromLootTable(source, causedByPlayer)")
  expect(java).toContain("source.getEntity() instanceof ServerPlayer")
  expect(java).toContain("DamageTypeTags.IS_EXPLOSION")
  expect(java).toContain("GameRules.RULE_DOMOBLOOT")
  expect(java).toContain("nextDouble() < 0.35")
  expect(java).toContain('ResourceLocation.fromNamespaceAndPath("cache_test", "test_cache")')
})
