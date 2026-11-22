import { BLEND_MOST, followOf } from "@minemods/studio-ai/animation"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { followOrder, followSpring, STEPS_PER_TICK } from "@minemods/studio-ai/follow-bones"
import { footBones, footPlan } from "@minemods/studio-ai/foot-placement"
import { hangChains } from "@minemods/studio-ai/hang-chains"
import { PACE } from "@minemods/studio-ai/motion-continuity"
import { lookPlan } from "@minemods/studio-ai/look-bones"
import { swayPlan } from "@minemods/studio-ai/sway-bones"
import { rigParents } from "@minemods/studio-ai/pose-rig"
import { weightMembers } from "./pose-weights-java"
import { rigMembers, rigState } from "./pose-rig-java"

/**
 * 第 2 步: what a creature's renderer adds so that its motions blend into each other (a clip's `blend`) and its
 * follow bones sway (the model's `follow`), on every player's game alone. Both happen after GeckoLib has posed
 * the model for this creature this frame (`GeoModel.setCustomAnimations`, the same hook and the same `GeoBone`
 * on GeckoLib 4.8.3, 4.8.4 and 4.9.3; only the package of `AnimatableManager`, `AnimationController` and
 * `AnimationState` differs on 1.20.1, which the version's own rewrite of imports takes care of):
 *
 * - blending: which clips are showing (every controller that is not stopped, the walk and idle aside: they blend
 *   by GeckoLib's own transition, `PACE.blend`) is compared with the frame before. When it changes and a clip that
 *   started or ended has a `blend`, the pose of the frame before is kept and, over that many ticks, what GeckoLib
 *   poses is shown mixed with it, the mix going smoothly (smoothstep) from all of the old pose to none. The clip
 *   itself starts on time: the server's moments (a hit, a shot) stay where the clip puts them.
 * - follow bones: `follow-bones.ts`'s spring, the same arithmetic step by step (`STEPS_PER_TICK` a tick), driven
 *   by what this frame's pose turns the bones above it by, the body's yaw and how fast the body is carried.
 *
 * - hanging chains (`hang-chains.ts`) and feet on the ground (`foot-placement.ts`): the bones read into a rig, the same steps as the preview's done on
 *   it (`pose-rig-java.ts`), the bones it turned or moved written back. Feet go first (the follow springs and the chains hang from the body they
 *   tilt), the chains last (they hang from whatever the springs swung).
 *
 * A model with none of it gets nothing, and its renderer is what it always was.
 */

type Model = Pick<ModelDesign, "bones" | "animations" | "follow" | "foot_placement" | "sway" | "look">

/** What the renderer has to do, or null for a model with no clip that blends, no follow bone and no feet placed. */
export function posePlan(model: Model, id: string) {
  const blends = model.animations.filter((clip) => (clip.blend ?? 0) > 0).map((clip) => ({ clip: `animation.${id}.${clip.name}`, ticks: Math.min(clip.blend!, BLEND_MOST) }))
  const follows = followOrder(model).map((follow) => ({ ...followOf(follow), spring: followSpring(follow) }))
  const hangs = hangChains(model)
  const feet = footPlan(model)
  const tracks = model.animations.flatMap(clip => clip.weights && Object.values(clip.weights).some(keys => keys?.length) ? [{ name: `animation.${id}.${clip.name}`, weights: clip.weights }] : [])
  const look = lookPlan(model)
  const sway = swayPlan(model)
  if (!blends.length && !follows.length && !hangs.length && !feet && !sway.length && !look && !tracks.length) return null
  // 第 2 步 (挂链和踩地): only a model that has either has the rig at all.
  const rig = hangs.length || feet || sway.length || look ? { rig: { weightedHang: tracks.some(c => c.weights.hang?.length), look, sway, parents: rigParents(model), hangs, feet, feetBones: feet ? footBones(feet) : [] } } : {}
  return { tracks, blends, follows, bones: model.bones.map((bone) => bone.name), ...rig }
}

const number = (value: number) => (Number.isInteger(value) ? `${value}.0` : String(Number(value.toFixed(6))))
const strings = (list: readonly string[]) => `{${list.map((value) => JSON.stringify(value)).join(", ")}}`

/**
 * 第 2 步: how StudioPose puts a bone back, channel by channel (rotation, position, scale: three values each, as `read` lays them out). A motion may key one channel of a
 * bone and leave another (a cape's tip that only moves): GeckoLib then leaves the other as it was, which is what was written on it the frame before, for whichever creature of
 * the model was drawn last. A channel this class wrote that still holds exactly that is put back to what it held before; one GeckoLib set again is left as GeckoLib set it.
 */
export const POSE_CHANNELS = `        // Each channel written (bit 1 rotation, 2 position, 4 scale) still holding exactly what was written goes back to what it held before. Whether any did.
        private static boolean restore(float[] now, float[] written, float[] before, int wrote) {
            boolean any = false;
            for (int channel = 0; channel < 3; channel++) {
                int at = channel * 3;
                if ((wrote & (1 << channel)) == 0 || Float.compare(now[at], written[at]) != 0 || Float.compare(now[at + 1], written[at + 1]) != 0 || Float.compare(now[at + 2], written[at + 2]) != 0) continue;
                System.arraycopy(before, at, now, at, 3);
                any = true;
            }
            return any;
        }

        // The channels (bit 1 rotation, 2 position, 4 scale) on which \`written\` is not \`start\`.
        private static int channels(float[] written, float[] start) {
            int wrote = 0;
            for (int at = 0; at < 9; at++) if (Float.compare(written[at], start[at]) != 0) wrote |= 1 << (at / 3);
            return wrote;
        }
`

/** The renderer's part: imports, the model's hook (inside its `GeoModel`), and the class that does the work (a member of the renderer). */
export function poseRenderer(entity: string, plan: NonNullable<ReturnType<typeof posePlan>>, hasAbility = false) {
  const weighted = plan.tracks.length > 0
  const weightedFollow = plan.follows.length > 0 && plan.tracks.some(c => c.weights.follow?.length)
  const renderer = {
    imports: `import java.util.Map;
import java.util.WeakHashMap;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.LivingEntity;
import software.bernie.geckolib.animation.AnimatableManager;
import software.bernie.geckolib.animation.AnimationController;
import software.bernie.geckolib.animation.AnimationState;
import software.bernie.geckolib.cache.object.GeoBone;
`,
    hook: `            // 第 2 步: ${[plan.blends.length ? "its motions blend into each other" : "", plan.follows.length ? "its follow bones sway" : "", plan.rig?.hangs.length ? "its chains hang" : "", plan.rig?.feet ? "its feet stand on the ground" : ""].filter(Boolean).join(" and ")}, after GeckoLib has posed it (StudioPose below).
            @Override public void setCustomAnimations(${entity} creature, long instanceId, AnimationState<${entity}> state) {
                super.setCustomAnimations(creature, instanceId, state);
                POSE.apply(this, creature, creature.getAnimatableInstanceCache().getManagerForId(instanceId), state.getPartialTick());
            }
`,
    members: `
    private static final StudioPose POSE = new StudioPose();

    /**
     * 第 2 步, on this player's game alone. Blending: when the clips showing change and one that started or ended has a blend, the pose shown the frame before is
     * mixed into what GeckoLib poses for that many ticks, from all of it to none (smoothstep); the clips themselves start on time. Follow bones: each is a damped
     * spring per axis (degrees, the model's axes) pulled towards where the bones above it, the body's yaw and its movement point it (w'' = k (P + d - w) - c w'),
     * stepped ${STEPS_PER_TICK} times a tick; its sway (w - P, held within its range) is added to its rotation. The same arithmetic as MineMods Studio's preview.
     */
    private static final class StudioPose {
        private static final String[] BONES = ${strings(plan.bones)};
        private static final String[] BLEND_CLIPS = ${strings(plan.blends.map((blend) => blend.clip))};
        private static final int[] BLEND_TICKS = {${plan.blends.map((blend) => blend.ticks).join(", ")}};
        private static final String[] FOLLOW = ${strings(plan.follows.map((follow) => follow.bone))};
        // Per follow bone: k, c, drag (degrees per block a second), then the least and the most sway (degrees) on x, y and z.
        private static final double[][] SPRING = {${plan.follows.map((follow) => `{${[follow.spring.k, follow.spring.c, follow.drag, follow.low[0], follow.high[0], follow.low[1], follow.high[1], follow.low[2], follow.high[2]].map(number).join(", ")}}`).join(", ")}};
        private static final int STEPS = ${STEPS_PER_TICK};
        private static final double STEP = 1.0 / (20.0 * STEPS);
        private final Map<LivingEntity, State> states = new WeakHashMap<>();
        // What this class last wrote on each bone, on which of its channels, and what the bone held before it. GeckoLib leaves a channel no motion keys as it is, and a bone
        // is shared by every creature of this model: a channel still holding exactly what was written is put back to what it held before (\`restore\`), so nothing builds up
        // frame on frame, whichever creature of the model is drawn next.
        private final float[][] written = new float[BONES.length][9];
        private final float[][] before = new float[BONES.length][9];
        private final int[] wrote = new int[BONES.length];
        private final float[][] start = new float[BONES.length][9];
        private final float[] now = new float[9];

        private static final class State {
            String shown;
            boolean posed;
            double blendFrom = -1;
            int blendTicks;
            final float[][] from = new float[BONES.length][9];
            final float[][] last = new float[BONES.length][9];
            double followAt = Double.NaN;
            double yaw;
            float bodyYaw;
            final double[][] w = new double[FOLLOW.length][3];
            final double[][] v = new double[FOLLOW.length][3];
            final double[][] parent = new double[FOLLOW.length][3];
            final double[][] sway = new double[FOLLOW.length][3];
${weighted ? "            double weightAt = Double.NaN;\n            final double[] want = new double[4], weight = {1, 1, 1, 1};\n            final Map<String, Clock> clocks = new java.util.HashMap<>();\n" : ""}${plan.rig?.look ? "            double lookAt = Double.NaN;\n            final double[] gaze = new double[2];\n" : ""}${plan.rig ? rigState(plan.rig) : ""}        }

        void apply(GeoModel<?> model, LivingEntity creature, AnimatableManager<?> manager, float partialTick) {
            State state = states.computeIfAbsent(creature, key -> new State());
            double time = creature.tickCount + partialTick;
            for (int index = 0; index < BONES.length; index++) {
                GeoBone bone = model.getBone(BONES[index]).orElse(null);
                if (bone == null) continue;
                if (restore(read(bone, now), written[index], before[index], wrote[index])) put(bone, now);
                System.arraycopy(now, 0, start[index], 0, 9);
            }
            if (BLEND_CLIPS.length > 0) blend(model, manager, state, time);
${weighted ? `            weights(manager, state, time, ${hasAbility ? `((${entity})creature).studioAbilityShown()` : "0"});\n` : ""}${plan.rig?.feet ? "            feet(model, creature, state, time, partialTick);\n" : ""}${plan.rig?.sway.length ? `            programSway(model, time, creature.getId(), ${weighted ? "state.weight[1]" : "1.0"});\n` : ""}${plan.rig?.look ? `            programLook(model, creature, state, time, partialTick, ${weighted ? "state.weight[0]" : "1.0"});\n` : ""}            if (FOLLOW.length > 0) ${weightedFollow ? "weightedFollow" : "follow"}(model, creature, state, time, partialTick);
${plan.rig?.hangs.length ? "            hang(model, creature, state, time, partialTick);\n" : ""}            for (int index = 0; index < BONES.length; index++) {
                GeoBone bone = model.getBone(BONES[index]).orElse(null);
                wrote[index] = bone == null ? 0 : channels(read(bone, written[index]), start[index]);
                if (wrote[index] != 0) System.arraycopy(start[index], 0, before[index], 0, 9);
            }
        }

${POSE_CHANNELS}
        private static float[] read(GeoBone bone, float[] into) {
            into[0] = bone.getRotX();
            into[1] = bone.getRotY();
            into[2] = bone.getRotZ();
            into[3] = bone.getPosX();
            into[4] = bone.getPosY();
            into[5] = bone.getPosZ();
            into[6] = bone.getScaleX();
            into[7] = bone.getScaleY();
            into[8] = bone.getScaleZ();
            return into;
        }

        private static void put(GeoBone bone, float[] values) {
            bone.setRotX(values[0]);
            bone.setRotY(values[1]);
            bone.setRotZ(values[2]);
            bone.setPosX(values[3]);
            bone.setPosY(values[4]);
            bone.setPosZ(values[5]);
            bone.setScaleX(values[6]);
            bone.setScaleY(values[7]);
            bone.setScaleZ(values[8]);
        }

        private static int blendTicks(String clip) {
            for (int index = 0; index < BLEND_CLIPS.length; index++) if (BLEND_CLIPS[index].equals(clip)) return BLEND_TICKS[index];
            return 0;
        }

        // The most ticks any clip showing in \`one\` and not in \`other\` blends over.
        private static int changed(String one, String other) {
            int most = 0;
            for (String clip : one.split(";")) if (!clip.isEmpty() && !(";" + other).contains(";" + clip + ";")) most = Math.max(most, blendTicks(clip));
            return most;
        }

        private void blend(GeoModel<?> model, AnimatableManager<?> manager, State state, double now) {
            StringBuilder showing = new StringBuilder();
            for (AnimationController<?> controller : manager.getAnimationControllers().values()) {
                if (controller.getName().equals("movement") || controller.getAnimationState() == AnimationController.State.STOPPED || controller.getCurrentAnimation() == null) continue;
                showing.append(controller.getCurrentAnimation().animation().name()).append(';');
            }
            String shown = showing.toString();
            if (state.shown != null && !shown.equals(state.shown)) {
                int ticks = Math.max(changed(shown, state.shown), changed(state.shown, shown));
                if (ticks > 0 && state.posed) {
                    for (int index = 0; index < BONES.length; index++) System.arraycopy(state.last[index], 0, state.from[index], 0, 9);
                    state.blendFrom = now;
                    state.blendTicks = ticks;
                } else state.blendFrom = -1;
            }
            state.shown = shown;
            double share = state.blendFrom < 0 ? 1.0 : Math.max(0.0, (now - state.blendFrom) / state.blendTicks);
            if (share >= 1.0) state.blendFrom = -1;
            double mix = share * share * (3.0 - 2.0 * share);
            for (int index = 0; index < BONES.length; index++) {
                GeoBone bone = model.getBone(BONES[index]).orElse(null);
                if (bone == null) continue;
                float[] last = state.last[index];
                if (share < 1.0) {
                    float[] from = state.from[index];
                    bone.setRotX((float) (from[0] + (bone.getRotX() - from[0]) * mix));
                    bone.setRotY((float) (from[1] + (bone.getRotY() - from[1]) * mix));
                    bone.setRotZ((float) (from[2] + (bone.getRotZ() - from[2]) * mix));
                    bone.setPosX((float) (from[3] + (bone.getPosX() - from[3]) * mix));
                    bone.setPosY((float) (from[4] + (bone.getPosY() - from[4]) * mix));
                    bone.setPosZ((float) (from[5] + (bone.getPosZ() - from[5]) * mix));
                    bone.setScaleX((float) (from[6] + (bone.getScaleX() - from[6]) * mix));
                    bone.setScaleY((float) (from[7] + (bone.getScaleY() - from[7]) * mix));
                    bone.setScaleZ((float) (from[8] + (bone.getScaleZ() - from[8]) * mix));
                }
                last[0] = bone.getRotX();
                last[1] = bone.getRotY();
                last[2] = bone.getRotZ();
                last[3] = bone.getPosX();
                last[4] = bone.getPosY();
                last[5] = bone.getPosZ();
                last[6] = bone.getScaleX();
                last[7] = bone.getScaleY();
                last[8] = bone.getScaleZ();
            }
            state.posed = true;
        }

        // Where the bones above a follow bone turn it, in degrees and the model's axes (GeckoLib keeps x and y the other way round), plus the body's yaw on y.
        private static void parentTurn(GeoBone bone, double yaw, double[] into) {
            into[0] = 0;
            into[1] = yaw;
            into[2] = 0;
            for (GeoBone above = bone.getParent(); above != null; above = above.getParent()) {
                into[0] -= Math.toDegrees(above.getRotX() - above.getInitialSnapshot().getRotX());
                into[1] -= Math.toDegrees(above.getRotY() - above.getInitialSnapshot().getRotY());
                into[2] += Math.toDegrees(above.getRotZ() - above.getInitialSnapshot().getRotZ());
            }
        }

        private void follow(GeoModel<?> model, LivingEntity creature, State state, double now, float partialTick) {
            float bodyYaw = Mth.rotLerp(partialTick, creature.yBodyRotO, creature.yBodyRot);
            // From rest: the first frame, after a pause long enough that catching up means nothing, or when time went back.
            boolean fresh = Double.isNaN(state.followAt) || now < state.followAt || now - state.followAt > 40.0;
            if (fresh) state.yaw = 0;
            else state.yaw += Mth.wrapDegrees(bodyYaw - state.bodyYaw);
            state.bodyYaw = bodyYaw;
            // Blocks a second the body is carried, forwards and towards its own left.
            double speedX = (creature.getX() - creature.xo) * 20.0;
            double speedZ = (creature.getZ() - creature.zo) * 20.0;
            double turn = Math.toRadians(bodyYaw);
            double forward = -Math.sin(turn) * speedX + Math.cos(turn) * speedZ;
            double left = Math.cos(turn) * speedX + Math.sin(turn) * speedZ;
            int steps = fresh ? 0 : (int) Math.floor((now - state.followAt) * STEPS);
            double[] parent = new double[3];
            double[] drag = new double[3];
            for (int index = 0; index < FOLLOW.length; index++) {
                GeoBone bone = model.getBone(FOLLOW[index]).orElse(null);
                if (bone == null) continue;
                double[] spring = SPRING[index];
                parentTurn(bone, state.yaw, parent);
                drag[0] = spring[2] * forward;
                drag[1] = 0;
                drag[2] = spring[2] * left;
                double[] w = state.w[index];
                double[] v = state.v[index];
                double[] before = state.parent[index];
                double[] sway = state.sway[index];
                for (int axis = 0; axis < 3; axis++) {
                    double low = spring[3 + 2 * axis];
                    double high = spring[4 + 2 * axis];
                    if (fresh) {
                        w[axis] = parent[axis] + drag[axis];
                        v[axis] = 0;
                        sway[axis] = Math.max(low, Math.min(high, drag[axis]));
                    }
                    for (int step = 1; step <= steps; step++) {
                        double p = before[axis] + (parent[axis] - before[axis]) * step / steps;
                        double pBefore = before[axis] + (parent[axis] - before[axis]) * (step - 1) / steps;
                        double a = spring[0] * (p + drag[axis] - w[axis]) - spring[1] * v[axis];
                        v[axis] += a * STEP;
                        w[axis] += v[axis] * STEP;
                        double off = w[axis] - p;
                        if (off < low || off > high) {
                            off = off < low ? low : high;
                            w[axis] = p + off;
                            v[axis] = (p - pBefore) / STEP;
                        }
                        sway[axis] = off;
                    }
                    before[axis] = parent[axis];
                }
                bone.setRotX(bone.getRotX() - (float) Math.toRadians(sway[0]));
                bone.setRotY(bone.getRotY() - (float) Math.toRadians(sway[1]));
                bone.setRotZ(bone.getRotZ() + (float) Math.toRadians(sway[2]));
            }
            state.followAt = fresh ? now : state.followAt + (double) steps / STEPS;
        }
${weighted ? weightMembers(plan.tracks) : ""}${plan.rig ? rigMembers(plan.rig) : ""}    }
`,
  }
  if (weightedFollow) {
    const start = renderer.members.indexOf("        private void follow(")
    const end = renderer.members.indexOf("\n        }", start) + "\n        }".length
    const method = renderer.members.slice(start, end).replace("void follow(", "void weightedFollow(")
      .replace(/Math\.toRadians\(sway\[(\d)\]\)/g, "Math.toRadians(sway[$1] * state.weight[2])")
    renderer.members = renderer.members.slice(0, end) + "\n" + method + renderer.members.slice(end)
  }
  return renderer
}

/**
 * 第 2 步: per ability, whether the clip it plays is `layered` — the walk and the idle keep the bones it does not key, and the creature keeps walking to its
 * target while it plays (`compileAbilities`' `layered`). Nothing when no ability's clip is, so the abilities compile as they always did.
 */
export function layeredAbilities(model: Pick<ModelDesign, "animations">, abilities: readonly { clip: string }[]): { layered?: boolean[] } {
  const layered = abilities.map((ability) => Boolean(model.animations.find((clip) => clip.name === ability.clip)?.layered))
  return layered.some(Boolean) ? { layered } : {}
}

/** 第 2 步: the ticks the walk and the idle blend into each other over: the longer `blend` either writes, else `PACE.blend` as always. */
export function movementBlendTicks(model: Pick<ModelDesign, "animations">) {
  const written = model.animations.filter((clip) => clip.name === "walk" || clip.name === "idle").map((clip) => clip.blend ?? 0)
  const most = Math.max(0, ...written)
  return most > 0 ? Math.min(most, BLEND_MOST) : PACE.blend
}
