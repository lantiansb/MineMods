import type { Block } from "../content"

/** The game's constant of each effect a lucky cache may give (`MobEffects`): saved by its plain name, which is not always the constant's. */
const EFFECTS: Record<NonNullable<Block["lucky"]>["outcomes"][number]["effects"][number]["effect"], string> = {
  slowness: "MOVEMENT_SLOWDOWN",
  blindness: "BLINDNESS",
  poison: "POISON",
  weakness: "WEAKNESS",
}

/** Compiles only schema-validated, bounded outcomes; never accepts commands or arbitrary Java. */
export function compileLuckyCaches(blocks: Block[], packageName: string) {
  const caches = blocks.filter(block => block.lucky)
  if (!caches.length) return {}
  // Only what the class uses is imported: the items and the effects classes when some outcome gives one.
  const outcomes = caches.flatMap((block) => block.lucky!.outcomes)
  const items = outcomes.some((outcome) => outcome.items.length)
  const effects = outcomes.some((outcome) => outcome.effects.length)
  return { [`src/main/java/${packageName.replaceAll(".", "/")}/StudioLuckyCaches.java`]: `package ${packageName};

import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.RandomSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
${effects ? "import net.minecraft.world.effect.MobEffects;\n" : ""}import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
${items ? "import net.minecraft.world.item.Items;\n" : ""}import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

public final class StudioLuckyCaches {
    private static boolean registered;

    public static void register() {
        if (registered) return;
        registered = true;
        UseBlockCallback.EVENT.register(StudioLuckyCaches::open);
    }

    public static InteractionResult open(Player player, Level world, InteractionHand hand, BlockHitResult hit) {
        BlockPos pos = hit.getBlockPos();
        BlockState state = world.getBlockState(pos);
        int cache = -1;
${caches.map((block, i) => `        if (state.is(StudioContentRegistry.BLOCK_${block.identifier.toUpperCase()})) cache = ${i};`).join("\n")}
        if (cache < 0) return InteractionResult.PASS;
        if (hand != InteractionHand.MAIN_HAND || player.isSpectator() || !player.mayBuild()
                || !world.mayInteract(player, pos)) return InteractionResult.FAIL;
        if (world.isClientSide()) return InteractionResult.SUCCESS;
        // Server world callbacks are serialized: consume first so another interaction cannot award twice.
        if (!world.removeBlock(pos, false)) return InteractionResult.FAIL;
        var random = world.getRandom();
        int roll = random.nextInt(100);
        switch (cache) {
${caches.map((block, i) => `            case ${i} -> {
                switch (select(roll, ${block.lucky!.outcomes.map(o => o.weight).join(", ")})) {
${block.lucky!.outcomes.map((outcome, j) => `                    case ${j} -> {
${outcome.items.map(item => `                        give(world, pos, Items.${item.item.split(":")[1]!.toUpperCase()}, ${item.min} + random.nextInt(${item.max - item.min + 1}));`).join("\n")}
${outcome.effects.map(effect => `                        punish(player, MobEffects.${EFFECTS[effect.effect]}, ${effect.duration_ticks}, ${effect.amplifier});`).join("\n")}
                    }`).join("\n")}
                    default -> throw new IllegalStateException("Invalid lucky cache outcome");
                }
            }`).join("\n")}
            default -> throw new IllegalStateException("Invalid lucky cache");
        }
        world.playSound(null, pos, SoundEvents.CHEST_OPEN, SoundSource.BLOCKS, 0.8f, 1.2f);
        return InteractionResult.SUCCESS;
    }

    public static int select(int roll, int... weights) {
        if (roll < 0 || roll >= 100) throw new IllegalArgumentException("Roll outside [0,100)");
        for (int i = 0; i < weights.length; i++) {
            if (roll < weights[i]) return i;
            roll -= weights[i];
        }
        throw new IllegalArgumentException("Incomplete weights");
    }

    private static void give(Level world, BlockPos pos, Item item, int count) {
        var reward = new ItemEntity(world, pos.getX() + 0.5, pos.getY() + 0.3, pos.getZ() + 0.5, new ItemStack(item, count));
        reward.setDefaultPickUpDelay();
        world.addFreshEntity(reward);
    }

    private static void punish(Player player, Holder<MobEffect> effect, int duration, int amplifier) {
        if (player.isCreative() || player.isSpectator()) return;
        var previous = player.getEffect(effect);
        // Preserve stronger external effects, but never accumulate hidden punishment durations.
        if (previous != null && (previous.getAmplifier() > amplifier || previous.getDuration() > duration)) return;
        if (previous != null) player.removeEffect(effect);
        player.addEffect(new MobEffectInstance(effect, duration, amplifier));
    }
}
` }
}
