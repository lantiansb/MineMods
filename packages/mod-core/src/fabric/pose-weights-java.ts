import { LAYERS, type ClipWeights } from "@minemods/studio-ai/clip-weights"

export const WEIGHT_JAVA = `        static double weightAt(double[] keys, double time) {
            if (keys.length == 0) return 1;
            if (time <= keys[0]) return keys[1];
            for (int i = 2; i < keys.length; i += 2) {
                if (time <= keys[i]) return keys[i-1] + (keys[i+1]-keys[i-1]) * (time-keys[i-2]) / (keys[i]-keys[i-2]);
            }
            return keys[keys.length - 1];
        }
        static double weightSlew(double previous, double target, double ticks) {
            return previous + Math.signum(target - previous) * Math.min(Math.abs(target - previous), 0.2 * Math.max(0, ticks));
        }
`
export function weightMembers(clips: { name: string; weights: ClipWeights }[]) {
  return `${WEIGHT_JAVA}
        private static final String[] TRACK_NAMES = {${clips.map(c => JSON.stringify(c.name)).join(", ")}};
        private static final double[][][] TRACKS = {${clips.map(c => `{${LAYERS.map(layer => `{${(c.weights[layer] ?? []).flatMap(k => [k.time * 20, k.value]).join(", ")}}`).join(", ")}}`).join(", ")}};
        private static final class Clock {
            final Object stage;
            final int serial;
            final double from;
            Clock(Object stage, int serial, double from) { this.stage = stage; this.serial = serial; this.from = from; }
        }
        private void weights(AnimatableManager<?> manager, State state, double now, int ability) {
            double dt = Double.isNaN(state.weightAt) ? 0 : Math.max(0, now - state.weightAt);
            state.weightAt = now;
            java.util.Arrays.fill(state.want, 1.0);
            for (AnimationController<?> controller : manager.getAnimationControllers().values()) {
                String name = controller.getName();
                var stage = controller.getCurrentAnimation();
                if (controller.getAnimationState() == AnimationController.State.STOPPED || stage == null) {
                    state.clocks.remove(name);
                    continue;
                }
                String clip = stage.animation().name();
                int serial = name.equals("ability") ? ability : 0;
                Clock clock = state.clocks.get(name);
                // Each playback gets a new queued stage, even when a hit restarts the same named clip.
                if (clock == null || clock.stage != stage || clock.serial != serial || now < clock.from) {
                    clock = new Clock(stage, serial, now);
                    state.clocks.put(name, clock);
                }
                for (int i = 0; i < TRACK_NAMES.length; i++) if (TRACK_NAMES[i].equals(clip)) {
                    for (int layer = 0; layer < 4; layer++) state.want[layer] = Math.min(state.want[layer], weightAt(TRACKS[i][layer], now - clock.from));
                }
            }
            for (int i = 0; i < 4; i++) state.weight[i] = weightSlew(state.weight[i], state.want[i], dt);
        }
`
}
