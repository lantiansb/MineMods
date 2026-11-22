import { z } from "zod"

export const HomingSchema = z.strictObject({
  strength: z.number().gt(0, "追踪力度要大于 0。").max(1, "追踪力度最大为 1，代表每刻完全转向目标。"),
  range: z.number().min(1, "追踪距离至少为 1 格。").max(128, "追踪距离最多为 128 格。"),
})

/** Blend unit directions so turning changes direction without adding speed. */
export const steerJava = `    private static Vec3 steer(Vec3 position, Vec3 velocity, LivingEntity target, double strength, double range) {
        if (target == null || !target.isAlive()) return velocity;
        Vec3 toward = target.getBoundingBox().getCenter().subtract(position);
        if (toward.lengthSqr() > range * range || toward.lengthSqr() < 1.0e-8) return velocity;
        Vec3 heading = velocity.normalize().scale(1.0 - strength).add(toward.normalize().scale(strength));
        if (heading.lengthSqr() < 1.0e-8) heading = toward;
        return heading.normalize().scale(velocity.length());
    }
`

/** A native shot keeps its own physics and collisions. Only its direction is updated. */
export function guidedShotsJava(shared: boolean) {
  const scope = shared ? "static " : ""
  return `${steerJava}
    private record Guided(net.minecraft.world.entity.projectile.Projectile shot, LivingEntity target, double strength, double range) {}
    private ${scope}final java.util.List<Guided> guided = new java.util.ArrayList<>();
    private ${scope}void guideShots() {
        guided.removeIf(track -> {
            var shot = track.shot();
            if (shot.isRemoved() || !track.target().isAlive() || shot.level() != track.target().level() || shot.tickCount >= 200 || shot.getDeltaMovement().lengthSqr() < 1.0e-8) return true;
            shot.setDeltaMovement(steer(shot.position(), shot.getDeltaMovement(), track.target(), track.strength(), track.range()));
            shot.hasImpulse = true;
            return false;
        });
    }
`
}
