/** Resolve all solid surfaces together, including the live owner box when a project enables core solidity. */
export function solidBodyFile(pkg: string, core = false) {
  return `package ${pkg}.entity;

import java.util.Arrays;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.Shapes;

final class StudioSolidBody {
    private static final double GAP = 0.001;

    private StudioSolidBody() {}

    /** Once after all parts have been positioned. Open space between parts stays open. */
    static void clear(LivingEntity owner, ${core ? "net.minecraft.world.entity.Entity" : "StudioPart"}[] parts, AABB[] boxes) {
        AABB bounds = ${core ? "owner.canBeCollidedWith() ? owner.getBoundingBox() : null" : "null"};
        int count = 0;${core ? "\n        if (bounds != null) boxes[count++] = bounds;" : ""}
        ${core ? "if (parts != null) for (net.minecraft.world.entity.Entity" : "for (StudioPart"} part : parts) {
            if (part == null || !part.canBeCollidedWith()) continue;
            AABB box = part.getBoundingBox();
            boxes[count++] = box;
            bounds = bounds == null ? box : bounds.minmax(box);
        }
        if (bounds == null) return;
        Level level = owner.level();
        for (LivingEntity actor : level.getEntitiesOfClass(LivingEntity.class, bounds, actor ->
            actor.isAlive() && !actor.noPhysics && !actor.isSpectator() && !owner.isPassengerOfSameVehicle(actor))) {
            AABB body = actor.getBoundingBox();
            if (!overlaps(body, boxes, count)) continue;
            Vec3 exit = nearest(level, actor, body, boxes, count);
            if (exit == null) {
                // Terrain may cover all the closest faces. Try open space near the top of the body.
                AABB space = bounds.inflate(2.0, 2.0 + body.getYsize(), 2.0);
                Vec3 center = body.getCenter();
                Vec3 hint = new Vec3(center.x, bounds.maxY + body.getYsize() * 0.5 + GAP, center.z);
                Vec3 free = level.findFreePosition(actor, Shapes.create(space), hint, body.getXsize(), body.getYsize(), body.getZsize()).orElse(null);
                if (free != null && available(level, actor, body.move(free.subtract(center)), boxes, count)) exit = free.subtract(center);
            }
            if (exit == null) continue;
            double x = actor.getX() + exit.x, y = actor.getY() + exit.y, z = actor.getZ() + exit.z;
            if (actor instanceof ServerPlayer player) player.connection.teleport(x, y, z, player.getYRot(), player.getXRot());
            else actor.setPos(x, y, z);
            actor.fallDistance = 0;
        }
        Arrays.fill(boxes, 0, count, null);
    }

    private static boolean overlaps(AABB box, AABB[] boxes, int count) {
        for (int i = 0; i < count; i++) if (boxes[i].intersects(box)) return true;
        return false;
    }

    private static boolean available(Level level, LivingEntity actor, AABB box, AABB[] boxes, int count) {
        return !overlaps(box, boxes, count)
            && level.getWorldBorder().isWithinBounds(box)
            && box.minY >= level.getMinBuildHeight() && box.maxY <= level.getMaxBuildHeight()
            && level.hasChunkAt(BlockPos.containing(box.getCenter()))
            && level.noCollision(actor, box);
    }

    // The closest point outside intersecting boxes lies at a face or an intersection of faces.
    // Consider zero and every face offset per axis, ordered by distance, pruning beyond the best legal result.
    private static Vec3 nearest(Level level, LivingEntity actor, AABB body, AABB[] boxes, int count) {
        double[] x = new double[1 + 2 * count];
        double[] y = new double[x.length];
        double[] z = new double[x.length];
        for (int i = 0; i < count; i++) {
            AABB box = boxes[i];
            int at = 2 * i + 1;
            x[at] = box.minX - body.maxX - GAP; x[at + 1] = box.maxX - body.minX + GAP;
            y[at] = box.minY - body.maxY - GAP; y[at + 1] = box.maxY - body.minY + GAP;
            z[at] = box.minZ - body.maxZ - GAP; z[at + 1] = box.maxZ - body.minZ + GAP;
        }
        byDistance(x); byDistance(y); byDistance(z);
        Vec3 best = null;
        double limit = Double.POSITIVE_INFINITY;
        for (double dx : x) {
            double alongX = dx * dx;
            if (alongX >= limit) break;
            for (double dy : y) {
                double alongXY = alongX + dy * dy;
                if (alongXY >= limit) break;
                for (double dz : z) {
                    double distance = alongXY + dz * dz;
                    if (distance >= limit) break;
                    if (distance == 0 || !available(level, actor, body.move(dx, dy, dz), boxes, count)) continue;
                    limit = distance;
                    best = new Vec3(dx, dy, dz);
                    break;
                }
            }
        }
        return best;
    }

    private static void byDistance(double[] offsets) {
        for (int i = 1; i < offsets.length; i++) {
            double value = offsets[i];
            int j = i;
            while (j > 0 && Math.abs(offsets[j - 1]) > Math.abs(value)) {
                offsets[j] = offsets[j - 1];
                j--;
            }
            offsets[j] = value;
        }
    }
}
`
}
