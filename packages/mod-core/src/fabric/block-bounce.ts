import type { Block } from "../content"

/**
 * The Java of a block that bounces (`bounce` of a block), written the way the game's own slime block does it,
 * and of a block that throws up whoever steps on it (`launch`). `Block.fallOn` takes the fall damage,
 * `Block.updateEntityAfterFallOn` turns the downward speed round, `Block.stepOn` is called by `Entity.move` on every
 * tick the entity ends on the ground; all three names, their parameters and `Entity.isSuppressingBounce` /
 * `isSteppingCarefully` (both true when sneaking) are Mojang's official names for 1.21.1. A block with
 * neither never comes through here, so its Java is what every build wrote.
 */

/** The bounce as written: three places are far finer than anyone can feel, and a bounce that rounds to nothing is no bounce. */
export const bounceOf = (block: Pick<Block, "bounce">) => Number((block.bounce ?? 0).toFixed(3))

/** The launch as written: two places (a hundredth of a block) are finer than anyone can see. */
export const launchOf = (block: Pick<Block, "launch">) => Number((block.launch ?? 0).toFixed(2))

/**
 * The upward speed, in blocks per tick, that sends a living thing `height` blocks up. It is set inside `Entity.move`,
 * after the thing has moved this tick and before `LivingEntity.travel` takes the tick's gravity (0.08) off and then
 * the air's drag (x 0.98); so the first rise it makes is (speed - 0.08) x 0.98, then the same step again until the
 * speed is spent. A jump (speed 0.42, set before the move) rises 1.2522 blocks by the same sum, which is the check
 * that this is the game's own arithmetic. Found by halving, to four places.
 */
export function launchSpeed(height: number) {
  const rise = (speed: number) => {
    let total = 0
    for (let next = (speed - 0.08) * 0.98; next > 0; next = (next - 0.08) * 0.98) total += next
    return total
  }
  let low = 0
  let high = 5
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2
    if (rise(middle) < height) low = middle
    else high = middle
  }
  return Number(high.toFixed(4))
}

/** What the methods need, for the file that holds them to import (a file may list one twice, so each caller merges). */
export const BOUNCE_IMPORTS = ["net.minecraft.core.BlockPos", "net.minecraft.world.entity.Entity", "net.minecraft.world.entity.LivingEntity", "net.minecraft.world.level.BlockGetter", "net.minecraft.world.level.Level", "net.minecraft.world.level.block.state.BlockState", "net.minecraft.world.phys.Vec3"] as const

const decimal = (value: number) => (Number.isInteger(value) ? `${value}.0` : String(value))

/**
 * The methods, indented by `indent`. Landing without sneaking costs only the share of the fall the bounce
 * does not give back (the slime block takes none: bounce 1); a launching block takes none either, since whoever
 * lands on it is thrown up again at once. The bounce itself is the slime block's: only a
 * downward speed is turned round (a head against the ceiling is left alone), whatever lands that is not a living
 * thing (a minecart, an item) keeps 0.8 of it. The launch is for living things only (an item or an arrow has
 * other gravity, so the same speed would not be the same height) and sets the upward speed instead of adding to
 * it, and only when the thing is not rising faster already: standing on it for many ticks, or a bounce that has
 * just turned the fall round higher, is never made more than once. Sneaking is thrown by neither.
 */
export function bounceSource(bounce: number, indent: string, launch = 0) {
  const lines = [
    "@Override",
    "public void fallOn(Level world, BlockState state, BlockPos pos, Entity entity, float fallDistance) {",
    "    if (entity.isSuppressingBounce()) {",
    "        super.fallOn(world, state, pos, entity, fallDistance);",
    "    } else {",
    `        entity.causeFallDamage(fallDistance, ${launch > 0 ? 0 : Number((1 - bounce).toFixed(3))}f, world.damageSources().fall());`,
    "    }",
    "}",
    ...(bounce > 0
      ? [
          "",
          "@Override",
          "public void updateEntityAfterFallOn(BlockGetter world, Entity entity) {",
          "    if (entity.isSuppressingBounce()) {",
          "        super.updateEntityAfterFallOn(world, entity);",
          "        return;",
          "    }",
          "    Vec3 velocity = entity.getDeltaMovement();",
          "    if (velocity.y < 0.0) {",
          `        entity.setDeltaMovement(velocity.x, -velocity.y * ${decimal(bounce)} * (entity instanceof LivingEntity ? 1.0 : 0.8), velocity.z);`,
          "    }",
          "}",
        ]
      : []),
    ...(launch > 0
      ? [
          "",
          "@Override",
          "public void stepOn(Level world, BlockPos pos, BlockState state, Entity entity) {",
          "    super.stepOn(world, pos, state, entity);",
          "    if (entity.isSteppingCarefully() || !(entity instanceof LivingEntity)) {",
          "        return;",
          "    }",
          "    Vec3 velocity = entity.getDeltaMovement();",
          `    if (velocity.y < ${launchSpeed(launch)}) {`,
          `        entity.setDeltaMovement(velocity.x, ${launchSpeed(launch)}, velocity.z);`,
          "    }",
          "}",
        ]
      : []),
  ]
  return lines.map((line) => (line ? `${indent}${line}` : line)).join("\n")
}
