import type { HitWarn } from "../entity-runtime"
import { EFFECT_RUNTIME } from "./effect"

export const usesFieldWarn = (warn: HitWarn | undefined) => !!(warn && (warn.follow || warn.fade_seconds || warn.effect))

/** One mutable set of landing places, used by the hit and by the packets drawn before it. */
export function fieldWarnJava(own: boolean) {
  return `
    private static final java.util.List<Marker> markers = new java.util.ArrayList<>();

    public static final class Marker {
        private final ServerLevel world;
        private final Warn base;
        private final net.minecraft.world.entity.Entity owner;
        private final net.minecraft.world.entity.Entity anchor;
        private net.minecraft.world.phys.Vec3 last;
        private final long start;
        private long ends;
        private float radiusScale = 1f;

        public void radiusScale(float scale) { radiusScale = scale; }
        private final int freeze, fade;
        private boolean stopped;
        ${own ? "private final String effect;\n        private final net.minecraft.world.entity.Entity[] art;" : ""}

        public Marker(ServerLevel world, net.minecraft.world.entity.Entity owner, Warn base, net.minecraft.world.entity.Entity anchor, int freeze, int fade, String effect) {
            this.world = world;
            this.owner = owner;
            this.base = base;
            this.anchor = anchor;
            this.last = anchor == null ? null : anchor.position();
            this.start = world.getGameTime();
            this.ends = start + base.ticks();
            this.freeze = freeze;
            this.fade = fade;
            ${own ? "this.effect = effect;\n            art = new net.minecraft.world.entity.Entity[base.places().length / 3];" : ""}
            markers.add(this);
        }

        public net.minecraft.world.phys.Vec3 spot() {
            double[] p = base.places();
            return new net.minecraft.world.phys.Vec3(p[0], p[1], p[2]);
        }

        public void aim(net.minecraft.world.phys.Vec3 at, long landing) {
            ends = landing;
            if (at == null || stopped || world.getGameTime() > ends - freeze) return;
            base.places()[0] = at.x; base.places()[1] = at.y; base.places()[2] = at.z;
        }

        public void move() {
            if (stopped || anchor == null || !anchor.isAlive() || world.getGameTime() > ends - freeze) return;
            var here = anchor.position();
            var delta = here.subtract(last);
            for (int i = 0; i < base.places().length; i += 3) {
                base.places()[i] += delta.x;
                base.places()[i+1] += delta.y;
                base.places()[i+2] += delta.z;
            }
            last = here;
        }

        public void stop() {
            if (stopped) return;
            move();
            stopped = true;
            ends = Math.min(ends, world.getGameTime());
        }

        private boolean draw() {
            long now = world.getGameTime();
            if (owner != null && (!owner.isAlive() || owner.level() != world)) stop();
            if (now >= ends + fade) {
                ${own ? "for (var shown : art) if (shown != null) shown.discard();" : ""}
                return false;
            }
            move();
            if ((now & 1) != 0) return true;
            float intensity = now < ends ? 1f : (ends + fade - now) / (float)Math.max(1, fade);
            float progress = Math.min(1f, (now - start) / (float)Math.max(1, base.ticks()));
            ${own ? `if (!effect.isEmpty()) {
                for (int i = 0; i < art.length; i++) {
                    double turn = Math.toRadians(base.yaw());
                    double forward = base.shape() == 2 ? 0 : base.a(), left = base.shape() == 2 ? 0 : base.c();
                    var at = new net.minecraft.world.phys.Vec3(base.places()[3*i] - forward*Math.sin(turn) + left*Math.cos(turn), base.places()[3*i+1], base.places()[3*i+2] + forward*Math.cos(turn) + left*Math.sin(turn));
                    if (art[i] == null || art[i].isRemoved()) art[i] = ${EFFECT_RUNTIME.table}.spawn(effect, world, at, base.yaw(), null, null);
                    if (art[i] instanceof ${EFFECT_RUNTIME.entity} decal) {
                        decal.setPos(at.x, ${EFFECT_RUNTIME.table}.ground(world, at.x, at.y, at.z), at.z);
                        decal.alpha(intensity);
                    }
                }
            }` : ""}
            send(world, new Warn(base.owner(), 2, base.look(), base.color(), base.shape(), base.yaw(), base.a(), base.b(), base.c(), base.d() * radiusScale, base.e(), base.f(), base.places().clone(), progress, intensity));
            return true;
        }
    }

    private static void advance(net.minecraft.server.MinecraftServer server) {
        markers.removeIf(marker -> server.getLevel(marker.world.dimension()) != marker.world || !marker.draw());
    }
`
}
