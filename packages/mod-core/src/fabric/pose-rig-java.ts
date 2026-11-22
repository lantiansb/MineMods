import type { FootPlan } from "@minemods/studio-ai/foot-placement"
import { FEET } from "@minemods/studio-ai/foot-placement"
import { HANG, hangLinks, type HangChain } from "@minemods/studio-ai/hang-chains"

/**
 * 第 2 步 (挂链和踩地): the Java StudioPose runs for hanging chains (`hang-chains.ts`) and feet on the ground (`foot-placement.ts`): the same steps,
 * in the same order, as the preview's TypeScript, so a creature hangs and stands in the game as it does in MineMods Studio's pictures (to rounding).
 * `RIG_JAVA`, `HANG_JAVA` and `FEET_JAVA` use nothing of the game: a test runs them beside the TypeScript on the same numbers. `rigMembers` adds
 * what reads the bones from GeckoLib, the world from the game, and writes the bones back.
 */

/** A number as Java reads back the very same double. */
export const javaDouble = (value: number) => {
  if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`)
  const text = String(value === 0 ? 0 : value)
  return /[.e]/.test(text) ? text : `${text}.0`
}
const doubles = (list: readonly number[]) => `{${list.map(javaDouble).join(", ")}}`
const ints = (list: readonly number[]) => `{${list.join(", ")}}`

/** The bones as GeckoLib holds them, and the turns and moves done on them (pose-rig.ts, operation for operation). */
export const RIG_JAVA = `        // 第 2 步 (挂链和踩地): the bones as GeckoLib holds them (model pixels, x turned over, radians; three numbers a bone) and what is done to them.
        static final class Rig {
            final int[] parent;
            final double[] pivot;
            final double[] rot;
            final double[] pos;
            final double[] scale;

            Rig(int[] parent) {
                this.parent = parent;
                pivot = new double[parent.length * 3];
                rot = new double[parent.length * 3];
                pos = new double[parent.length * 3];
                scale = new double[parent.length * 3];
            }
        }

        static final double[] IDENTITY = {1, 0, 0, 0, 1, 0, 0, 0, 1};

        static double[] rigEuler(double x, double y, double z) {
            double sa = Math.sin(x), ca = Math.cos(x), sb = Math.sin(y), cb = Math.cos(y), sc = Math.sin(z), cc = Math.cos(z);
            return new double[] {cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca};
        }

        static double[] rigMul(double[] a, double[] b) {
            double[] out = new double[9];
            for (int row = 0; row < 3; row++) for (int col = 0; col < 3; col++) out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
            return out;
        }

        static double[] rigApply(double[] a, double x, double y, double z) {
            return new double[] {a[0] * x + a[1] * y + a[2] * z, a[3] * x + a[4] * y + a[5] * z, a[6] * x + a[7] * y + a[8] * z};
        }

        static double[] rigTransposed(double[] a) {
            return new double[] {a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]};
        }

        static double rigLength(double x, double y, double z) {
            return Math.sqrt(x * x + y * y + z * z);
        }

        private static double rigNear(double value, double near) {
            return value + 2 * Math.PI * Math.round((near - value) / (2 * Math.PI));
        }

        // The angles of a turn (rigEuler's inverse) written into rot at \`at\`: of the two sets that give it, the one nearest what is there.
        static void rigEulerNear(double[] m, double[] rot, int at) {
            double nx = rot[at], ny = rot[at + 1], nz = rot[at + 2];
            double sb = Math.max(-1, Math.min(1, -m[6]));
            if (Math.abs(sb) > 0.999999) {
                double z = sb > 0 ? nx - Math.atan2(m[1], m[4]) : Math.atan2(-m[1], m[4]) - nx;
                rot[at + 1] = sb > 0 ? Math.PI / 2 : -Math.PI / 2;
                rot[at + 2] = rigNear(z, nz);
                return;
            }
            double y = Math.asin(sb), x = Math.atan2(m[7], m[8]), z = Math.atan2(m[3], m[0]);
            double x1 = rigNear(x, nx), y1 = rigNear(y, ny), z1 = rigNear(z, nz);
            double x2 = rigNear(x + Math.PI, nx), y2 = rigNear(Math.PI - y, ny), z2 = rigNear(z + Math.PI, nz);
            boolean two = Math.abs(x2 - nx) + Math.abs(y2 - ny) + Math.abs(z2 - nz) < Math.abs(x1 - nx) + Math.abs(y1 - ny) + Math.abs(z1 - nz);
            rot[at] = two ? x2 : x1;
            rot[at + 1] = two ? y2 : y1;
            rot[at + 2] = two ? z2 : z1;
        }

        static double[] rigAxisTurn(double x, double y, double z, double angle) {
            double c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
            return new double[] {c + k * x * x, k * x * y - s * z, k * x * z + s * y, k * y * x + s * z, c + k * y * y, k * y * z - s * x, k * z * x - s * y, k * z * y + s * x, c + k * z * z};
        }

        // The shortest turn from the direction \`from\` to the direction \`to\`, \`share\` of the way.
        static double[] rigSwing(double fx, double fy, double fz, double tx, double ty, double tz, double share) {
            double a = rigLength(fx, fy, fz), b = rigLength(tx, ty, tz);
            if (a < 1e-9 || b < 1e-9) return IDENTITY;
            double ia = 1 / a, ib = 1 / b;
            fx = fx * ia;
            fy = fy * ia;
            fz = fz * ia;
            tx = tx * ib;
            ty = ty * ib;
            tz = tz * ib;
            double ax = fy * tz - fz * ty, ay = fz * tx - fx * tz, az = fx * ty - fy * tx;
            double s = rigLength(ax, ay, az), c = fx * tx + fy * ty + fz * tz;
            if (s < 1e-9) {
                if (c > 0) return IDENTITY;
                if (Math.abs(fx) < 0.9) {
                    ax = fy * 0 - fz * 0;
                    ay = fz * 1 - fx * 0;
                    az = fx * 0 - fy * 1;
                } else {
                    ax = fy * 0 - fz * 1;
                    ay = fz * 0 - fx * 0;
                    az = fx * 1 - fy * 0;
                }
                double ic = 1 / rigLength(ax, ay, az);
                return rigAxisTurn(ax * ic, ay * ic, az * ic, Math.PI * share);
            }
            double is = 1 / s;
            return rigAxisTurn(ax * is, ay * is, az * is, Math.atan2(s, c) * share);
        }

        // Where a bone is in model space: its turn alone (0-8), its turn and scale (9-17), where its own origin goes (18-20).
        static double[] rigPlace(Rig rig, int index) {
            int at = index * 3;
            double[] r = rigEuler(rig.rot[at], rig.rot[at + 1], rig.rot[at + 2]);
            double sx = rig.scale[at], sy = rig.scale[at + 1], sz = rig.scale[at + 2];
            double[] a = {r[0] * sx, r[1] * sy, r[2] * sz, r[3] * sx, r[4] * sy, r[5] * sz, r[6] * sx, r[7] * sy, r[8] * sz};
            double px = rig.pivot[at], py = rig.pivot[at + 1], pz = rig.pivot[at + 2];
            double[] turned = rigApply(a, px, py, pz);
            double[] t = {-rig.pos[at] + px - turned[0], rig.pos[at + 1] + py - turned[1], rig.pos[at + 2] + pz - turned[2]};
            double[] place = new double[21];
            int parent = rig.parent[index];
            if (parent < 0) {
                System.arraycopy(r, 0, place, 0, 9);
                System.arraycopy(a, 0, place, 9, 9);
                System.arraycopy(t, 0, place, 18, 3);
                return place;
            }
            double[] above = rigPlace(rig, parent);
            double[] aboveR = java.util.Arrays.copyOfRange(above, 0, 9), aboveA = java.util.Arrays.copyOfRange(above, 9, 18);
            System.arraycopy(rigMul(aboveR, r), 0, place, 0, 9);
            System.arraycopy(rigMul(aboveA, a), 0, place, 9, 9);
            double[] moved = rigApply(aboveA, t[0], t[1], t[2]);
            place[18] = moved[0] + above[18];
            place[19] = moved[1] + above[19];
            place[20] = moved[2] + above[20];
            return place;
        }

        static double[] rigTurnOf(Rig rig, int index) {
            return java.util.Arrays.copyOfRange(rigPlace(rig, index), 0, 9);
        }

        // A point of a bone as the model is built (model space), where the bone now puts it.
        static double[] rigPoint(Rig rig, int index, double x, double y, double z) {
            double[] place = rigPlace(rig, index);
            double[] moved = rigApply(java.util.Arrays.copyOfRange(place, 9, 18), x, y, z);
            return new double[] {moved[0] + place[18], moved[1] + place[19], moved[2] + place[20]};
        }

        static double[] rigPivot(Rig rig, int index) {
            return rigPoint(rig, index, rig.pivot[index * 3], rig.pivot[index * 3 + 1], rig.pivot[index * 3 + 2]);
        }

        // Turns a bone about its pivot by \`turn\` (a turn in model space).
        static void rigTurn(Rig rig, int index, double[] turn) {
            int parent = rig.parent[index];
            double[] above = parent < 0 ? IDENTITY : rigTurnOf(rig, parent);
            int at = index * 3;
            rigEulerNear(rigMul(rigMul(rigMul(rigTransposed(above), turn), above), rigEuler(rig.rot[at], rig.rot[at + 1], rig.rot[at + 2])), rig.rot, at);
        }

        static double[] rigInverse(double[] a) {
            double c0 = a[4] * a[8] - a[5] * a[7], c1 = a[5] * a[6] - a[3] * a[8], c2 = a[3] * a[7] - a[4] * a[6];
            double det = a[0] * c0 + a[1] * c1 + a[2] * c2;
            if (Math.abs(det) < 1e-12) return IDENTITY;
            double k = 1 / det;
            return new double[] {c0 * k, (a[2] * a[7] - a[1] * a[8]) * k, (a[1] * a[5] - a[2] * a[4]) * k, c1 * k, (a[0] * a[8] - a[2] * a[6]) * k, (a[2] * a[3] - a[0] * a[5]) * k, c2 * k, (a[1] * a[6] - a[0] * a[7]) * k, (a[0] * a[4] - a[1] * a[3]) * k};
        }

        // Moves a bone, and all under it, by (x, y, z) model pixels in model space.
        static void rigMove(Rig rig, int index, double x, double y, double z) {
            int parent = rig.parent[index];
            double[] local = parent < 0 ? new double[] {x, y, z} : rigApply(rigInverse(java.util.Arrays.copyOfRange(rigPlace(rig, parent), 9, 18)), x, y, z);
            int at = index * 3;
            rig.pos[at] = rig.pos[at] - local[0];
            rig.pos[at + 1] = rig.pos[at + 1] + local[1];
            rig.pos[at + 2] = rig.pos[at + 2] + local[2];
        }

        // From model space to the world (blocks) and back, for a body at \`at\` turned to \`yaw\` degrees and drawn \`scale\` times its size.
        static double[] rigToWorld(double[] points, double[] at, double yaw, double scale) {
            double turn = (180 - yaw) * Math.PI / 180, c = Math.cos(turn), s = Math.sin(turn), k = scale / 16;
            double[] out = new double[points.length];
            for (int point = 0; point < points.length; point += 3) {
                double mx = points[point] * k, my = points[point + 1] * k, mz = points[point + 2] * k;
                out[point] = at[0] + c * mx + s * mz;
                out[point + 1] = at[1] + my;
                out[point + 2] = at[2] - s * mx + c * mz;
            }
            return out;
        }

        static double[] rigToModel(double[] points, double[] at, double yaw, double scale) {
            double turn = (180 - yaw) * Math.PI / 180, c = Math.cos(turn), s = Math.sin(turn), k = 16 / scale;
            double[] out = new double[points.length];
            for (int point = 0; point < points.length; point += 3) {
                double wx = points[point] - at[0], wy = points[point + 1] - at[1], wz = points[point + 2] - at[2];
                out[point] = (c * wx - s * wz) * k;
                out[point + 1] = wy * k;
                out[point + 2] = (s * wx + c * wz) * k;
            }
            return out;
        }
`

/** One hanging chain's step and how its links are turned (hang-chains.ts `hangStep`, `hangSolve`). */
export const HANG_JAVA = `        // 第 2 步 (挂链): one chain: its links (top first), the far end of the last (null: none), and its numbers (hang-chains.ts).
        static final class Hang {
            final int[] bones;
            final double[] tip;
            final double fall;
            final double keep;
            final double[] pull;
            final double cos;
            final double sin;
            final boolean floor;
            final double weight;

            Hang(int[] bones, double[] tip, double fall, double keep, double[] pull, double cos, double sin, boolean floor, double weight) {
                this.bones = bones;
                this.tip = tip;
                this.fall = fall;
                this.keep = keep;
                this.pull = pull;
                this.cos = cos;
                this.sin = sin;
                this.floor = floor;
                this.weight = weight;
            }

            int links() {
                return bones.length - 1 + (tip != null ? 1 : 0);
            }
        }

        // Where the motion puts a chain's points (model space, the top first).
        static double[] hangTargets(Rig rig, Hang hang) {
            double[] points = new double[(hang.bones.length + (hang.tip != null ? 1 : 0)) * 3];
            for (int link = 0; link < hang.bones.length; link++) System.arraycopy(rigPivot(rig, hang.bones[link]), 0, points, link * 3, 3);
            if (hang.tip != null) System.arraycopy(rigPoint(rig, hang.bones[hang.bones.length - 1], hang.tip[0], hang.tip[1], hang.tip[2]), 0, points, hang.bones.length * 3, 3);
            return points;
        }

        // One step of a chain in the world: kept speed and gravity, pulled back towards the motion, each link put back to its length (within its limit, above the floor).
        static void hangStep(Hang hang, double[] x, double[] before, double[] target, double[] floors) {
            int points = x.length / 3;
            for (int axis = 0; axis < 3; axis++) {
                x[axis] = target[axis];
                before[axis] = target[axis];
            }
            for (int point = 1; point < points; point++) {
                double pull = hang.pull[point - 1];
                for (int axis = 0; axis < 3; axis++) {
                    int at = point * 3 + axis;
                    double speed = (x[at] - before[at]) * hang.keep;
                    before[at] = x[at];
                    x[at] = x[at] + speed - (axis == 1 ? hang.fall : 0);
                    x[at] = x[at] + (target[at] - x[at]) * pull;
                }
            }
            for (int point = 1; point < points; point++) {
                int at = point * 3;
                double rx = target[at] - target[at - 3], ry = target[at + 1] - target[at - 2], rz = target[at + 2] - target[at - 1];
                double rest = Math.sqrt(rx * rx + ry * ry + rz * rz);
                double dx = x[at] - x[at - 3], dy = x[at + 1] - x[at - 2], dz = x[at + 2] - x[at - 1];
                double now = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (now > 1e-9) {
                    dx /= now;
                    dy /= now;
                    dz /= now;
                } else if (rest > 1e-9) {
                    dx = rx / rest;
                    dy = ry / rest;
                    dz = rz / rest;
                } else {
                    dx = 0;
                    dy = -1;
                    dz = 0;
                }
                if (hang.cos > -1 && rest > 1e-9) {
                    double ax = rx / rest, ay = ry / rest, az = rz / rest;
                    double along = dx * ax + dy * ay + dz * az;
                    if (along < hang.cos) {
                        double sx = dx - ax * along, sy = dy - ay * along, sz = dz - az * along;
                        double side = Math.sqrt(sx * sx + sy * sy + sz * sz);
                        if (side > 1e-9) {
                            dx = ax * hang.cos + (sx / side) * hang.sin;
                            dy = ay * hang.cos + (sy / side) * hang.sin;
                            dz = az * hang.cos + (sz / side) * hang.sin;
                        } else {
                            dx = ax;
                            dy = ay;
                            dz = az;
                        }
                    }
                }
                x[at] = x[at - 3] + dx * rest;
                x[at + 1] = x[at - 2] + dy * rest;
                x[at + 2] = x[at - 1] + dz * rest;
                if (floors != null && !Double.isNaN(floors[point])) {
                    double low = floors[point] + ${javaDouble(HANG.margin)};
                    if (x[at + 1] < low) {
                        x[at + 1] = low;
                        before[at + 1] = low;
                    }
                }
            }
        }

        // Turns a chain's links, from the top down, towards where its points hang (model space), \`weight\` of the way.
        static void hangSolve(Rig rig, Hang hang, double[] points) {
            int links = hang.links();
            for (int link = 0; link < links; link++) {
                int bone = hang.bones[link];
                double[] pivot = rigPivot(rig, bone);
                double[] end = link + 1 < hang.bones.length ? rigPivot(rig, hang.bones[link + 1]) : rigPoint(rig, bone, hang.tip[0], hang.tip[1], hang.tip[2]);
                int at = (link + 1) * 3;
                rigTurn(rig, bone, rigSwing(end[0] - pivot[0], end[1] - pivot[1], end[2] - pivot[2], points[at] - pivot[0], points[at + 1] - pivot[1], points[at + 2] - pivot[2], hang.weight));
            }
        }
`

/** Feet on the ground: the body's tilt and drop and each leg's reach (foot-placement.ts `footTilt`, `footSolve`). */
export const FEET_JAVA = `        // 第 2 步 (踩地): the legs (bone indices; -1: none), where each foot meets the ground as built, where it looks for the ground, which way a straight knee bends,
        // whether the body carries it; the body, and whether it pitches and rolls (foot-placement.ts).
        static final class Feet {
            final int[] thigh;
            final int[] calf;
            final int[] foot;
            final int[] end;
            final double[][] point;
            final double[][][] corners;
            final double[] forward;
            final double[] side;
            final double[] knee;
            final boolean[] under;
            final int body;
            final boolean pitch;
            final boolean roll;

            Feet(int[] thigh, int[] calf, int[] foot, int[] end, double[][] point, double[][][] corners, double[] forward, double[] side, double[] knee, boolean[] under, int body, boolean pitch, boolean roll) {
                this.thigh = thigh;
                this.calf = calf;
                this.foot = foot;
                this.end = end;
                this.point = point;
                this.corners = corners;
                this.forward = forward;
                this.side = side;
                this.knee = knee;
                this.under = under;
                this.body = body;
                this.pitch = pitch;
                this.roll = roll;
            }
        }

        // A foot's ground height after \`seconds\`: towards \`target\`, at most \`rise\` blocks a second up and \`fall\` down.
        static double footGround(double now, double target, double rise, double fall, double seconds) {
            return now + Math.max(-fall * seconds, Math.min(rise * seconds, target - now));
        }

        // The mean over the feet in front (1), behind (-1) or all (0) of \`along\` (forward or side), of \`values\`.
        private static double footMean(double[] along, double middle, int pick, double[] values) {
            double sum = 0;
            int count = 0;
            for (int index = 0; index < along.length; index++) {
                if (pick > 0 && !(along[index] > middle) || pick < 0 && !(along[index] < middle)) continue;
                sum += values[index];
                count++;
            }
            return count > 0 ? sum / count : 0;
        }

        private static double footClamp(double angle) {
            double most = ${javaDouble(FEET.tilt)} * Math.PI / 180;
            return Math.max(-most, Math.min(most, angle));
        }

        // How the body tilts for feet lifted by \`lift\` (model pixels): nose down by the front feet's being lower, rolled towards the lower side.
        static double[] footTilt(Feet feet, double[] lift) {
            double[] turn = IDENTITY;
            if (feet.pitch) {
                double middle = footMean(feet.forward, 0, 0, feet.forward);
                double apart = footMean(feet.forward, middle, 1, feet.forward) - footMean(feet.forward, middle, -1, feet.forward);
                turn = rigEuler(-footClamp(Math.atan2(footMean(feet.forward, middle, -1, lift) - footMean(feet.forward, middle, 1, lift), apart)), 0, 0);
            }
            if (feet.roll) {
                double middle = footMean(feet.side, 0, 0, feet.side);
                double apart = footMean(feet.side, middle, 1, feet.side) - footMean(feet.side, middle, -1, feet.side);
                turn = rigMul(rigEuler(0, 0, footClamp(Math.atan2(footMean(feet.side, middle, -1, lift) - footMean(feet.side, middle, 1, lift), apart))), turn);
            }
            return turn;
        }

        // A thigh and a calf bent so the leg's end reaches the target, as a triangle of their lengths in the plane they bend in.
        private static void footReach(Rig rig, Feet feet, int leg, double tx, double ty, double tz) {
            double[] hip = rigPivot(rig, feet.thigh[leg]);
            double[] knee = rigPivot(rig, feet.calf[leg]);
            double[] point = feet.point[leg];
            double[] end = rigPoint(rig, feet.end[leg], point[0], point[1], point[2]);
            double upper = rigLength(knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]);
            double lower = rigLength(end[0] - knee[0], end[1] - knee[1], end[2] - knee[2]);
            double towardX = tx - hip[0], towardY = ty - hip[1], towardZ = tz - hip[2];
            double far = rigLength(towardX, towardY, towardZ);
            if (upper < 1e-6 || lower < 1e-6 || far < 1e-6) return;
            double inverse = 1 / far;
            double wx = towardX * inverse, wy = towardY * inverse, wz = towardZ * inverse;
            double span = Math.max(Math.abs(upper - lower) + 1e-4, Math.min(upper + lower - 1e-4, far));
            double alongX = knee[0] - hip[0], alongY = knee[1] - hip[1], alongZ = knee[2] - hip[2];
            double share = alongX * wx + alongY * wy + alongZ * wz;
            double ox = alongX - wx * share, oy = alongY - wy * share, oz = alongZ - wz * share;
            if (rigLength(ox, oy, oz) < 1e-4 * upper) {
                int parent = rig.parent[feet.thigh[leg]];
                double[] hint = rigApply(parent < 0 ? IDENTITY : rigTurnOf(rig, parent), 0, 0, -feet.knee[leg]);
                double hinted = hint[0] * wx + hint[1] * wy + hint[2] * wz;
                ox = hint[0] - wx * hinted;
                oy = hint[1] - wy * hinted;
                oz = hint[2] - wz * hinted;
                if (rigLength(ox, oy, oz) < 1e-9) return;
            }
            double unit = 1 / rigLength(ox, oy, oz);
            ox = ox * unit;
            oy = oy * unit;
            oz = oz * unit;
            double cos = Math.max(-1, Math.min(1, (upper * upper + span * span - lower * lower) / (2 * upper * span)));
            double sin = Math.sqrt(1 - cos * cos);
            double bentX = hip[0] + (wx * cos + ox * sin) * upper, bentY = hip[1] + (wy * cos + oy * sin) * upper, bentZ = hip[2] + (wz * cos + oz * sin) * upper;
            rigTurn(rig, feet.thigh[leg], rigSwing(alongX, alongY, alongZ, bentX - hip[0], bentY - hip[1], bentZ - hip[2], 1));
            double[] kneeNow = rigPivot(rig, feet.calf[leg]);
            double[] endNow = rigPoint(rig, feet.end[leg], point[0], point[1], point[2]);
            rigTurn(rig, feet.calf[leg], rigSwing(endNow[0] - kneeNow[0], endNow[1] - kneeNow[1], endNow[2] - kneeNow[2], hip[0] + wx * span - kneeNow[0], hip[1] + wy * span - kneeNow[1], hip[2] + wz * span - kneeNow[2], 1));
        }

        // Puts the feet \`lift\` model pixels above (or below) where the motion puts them, the body and the legs following.
        static double soleHeight(Rig rig, Feet feet, int leg) {
            double low = Double.POSITIVE_INFINITY;
            for (double[] corner : feet.corners[leg])
                low = Math.min(low, rigPoint(rig, feet.end[leg], corner[0], corner[1], corner[2])[1]);
            return low;
        }

        static void footSolve(Rig rig, Feet feet, double[] lift) { footSolve(rig, feet, lift, lift, null); }

        static void footSolve(Rig rig, Feet feet, double[] lift, double[] contact, java.util.function.ToDoubleFunction<double[]> surface) {
            double[] support = new double[lift.length];
            boolean still = true;
            for (int leg = 0; leg < support.length; leg++) {
                support[leg] = contact[leg] - soleHeight(rig, feet, leg);
                if (Math.abs(support[leg]) >= ${javaDouble(FEET.still)}) still = false;
            }
            for (double value : lift) if (!(Math.abs(value) < ${javaDouble(FEET.still)})) still = false;
            if (still && surface == null) return;
            int count = feet.thigh.length;
            double[][] ends = new double[count][];
            double[][] turns = new double[count][];
            for (int leg = 0; leg < count; leg++) {
                double[] point = feet.point[leg];
                ends[leg] = rigPoint(rig, feet.end[leg], point[0], point[1], point[2]);
                turns[leg] = feet.foot[leg] >= 0 ? rigTurnOf(rig, feet.foot[leg]) : IDENTITY;
            }
            if (feet.body >= 0) {
                double[] tilt = footTilt(feet, lift);
                double[] centre = rigPivot(rig, feet.body);
                double drop = Double.POSITIVE_INFINITY;
                for (int leg = 0; leg < count; leg++) {
                    if (!feet.under[leg]) continue;
                    double[] hip = rigPivot(rig, feet.thigh[leg]);
                    double[] end = ends[leg];
                    double span = rigLength(end[0] - hip[0], end[1] - hip[1], end[2] - hip[2]);
                    double[] arm = rigApply(tilt, hip[0] - centre[0], hip[1] - centre[1], hip[2] - centre[2]);
                    double hx = centre[0] + arm[0], hy = centre[1] + arm[1], hz = centre[2] + arm[2];
                    double dx = end[0] - hx, dz = end[2] - hz;
                    drop = Math.min(drop, end[1] + lift[leg] - soleHeight(rig, feet, leg) + Math.sqrt(Math.max(span * span - (dx * dx + dz * dz), 0)) - hy);
                }
                rigTurn(rig, feet.body, tilt);
                if (drop != Double.POSITIVE_INFINITY) rigMove(rig, feet.body, 0, drop, 0);
            }
            for (int leg = 0; leg < count; leg++) {
                double tx = ends[leg][0] + 0, ty = ends[leg][1] + support[leg], tz = ends[leg][2] + 0;
                if (feet.calf[leg] >= 0) footReach(rig, feet, leg, tx, ty, tz);
                else {
                    double[] point = feet.point[leg];
                    rigMove(rig, feet.thigh[leg], 0, ty - rigPoint(rig, feet.end[leg], point[0], point[1], point[2])[1], 0);
                }
                if (feet.foot[leg] >= 0) rigTurn(rig, feet.foot[leg], rigMul(turns[leg], rigTransposed(rigTurnOf(rig, feet.foot[leg]))));
                double correction = contact[leg] - soleHeight(rig, feet, leg);
                if (surface != null) {
                    correction = Double.NEGATIVE_INFINITY;
                    for (double[] corner : feet.corners[leg]) {
                        double[] at = rigPoint(rig, feet.end[leg], corner[0], corner[1], corner[2]);
                        correction = Math.max(correction, surface.applyAsDouble(at) - at[1]);
                    }
                }
                rigMove(rig, feet.thigh[leg], 0, correction, 0);
            }
        }
`

/** The Java constructor call of a hanging chain. */
export const hangJava = (chain: HangChain) =>
  `new Hang(new int[] ${ints(chain.bones)}, ${chain.tip ? `new double[] ${doubles(chain.tip)}` : "null"}, ${javaDouble(chain.fall)}, ${javaDouble(chain.keep)}, new double[] ${doubles(chain.pull)}, ${javaDouble(chain.cos)}, ${javaDouble(chain.sin)}, ${chain.floor}, ${javaDouble(chain.weight)})`

/** The Java constructor call of a model's feet. */
export const feetJava = (plan: FootPlan) => {
  const list = <T>(pick: (foot: FootPlan["feet"][number]) => T) => plan.feet.map(pick)
  return `new Feet(new int[] ${ints(list((foot) => foot.thigh))}, new int[] ${ints(list((foot) => foot.calf))}, new int[] ${ints(list((foot) => foot.foot))}, new int[] ${ints(list((foot) => foot.end))}, new double[][] {${list((foot) => doubles(foot.point)).join(", ")}}, new double[][][] {${list(foot => `{${foot.corners.map(doubles).join(", ")}}`).join(", ")}}, new double[] ${doubles(list((foot) => foot.forward))}, new double[] ${doubles(list((foot) => foot.side))}, new double[] ${doubles(list((foot) => foot.knee))}, new boolean[] {${list((foot) => foot.under).join(", ")}}, ${plan.body}, ${plan.pitch}, ${plan.roll})`
}

/** The bones a chain turns. */
const chainBones = (chains: readonly HangChain[]) => chains.flatMap((chain) => chain.bones.slice(0, hangLinks(chain)))

/**
 * StudioPose's members for hanging chains and feet: the plan as constants, the arithmetic above, and the frame's work — reading the bones from
 * GeckoLib into the rig, the world from the game (where the body is and how it is turned, the top of the blocks under a point), writing back the
 * bones it turned or moved. `parents`: each bone's parent by index; `feetBones`: the bones footSolve may turn or move.
 */
export const SWAY_JAVA = `        static void swayApply(Rig rig, int[] bones, int axis, int channel, double rate, double amount,
                double phase, double grow, double seconds, double weight, double start) {
            for (int i = 0; i < bones.length; i++) {
                int at = 3 * bones[i] + axis;
                double d = amount * Math.pow(grow, i) * Math.sin(2 * Math.PI * rate * seconds + start - i * phase) * weight;
                if (channel == 0) rig.rot[at] += d * Math.PI / 180 * (axis == 2 ? 1 : -1);
                else if (channel == 1) rig.pos[at] += d;
                else rig.scale[at] += d;
            }
        }
`

export const LOOK_JAVA = `        static void lookStep(double[] gaze, double yaw, double pitch, double speed, double seconds) {
            double step = speed * Math.max(0, seconds);
            gaze[0] += Math.max(-step, Math.min(step, yaw - gaze[0]));
            gaze[1] += Math.max(-step, Math.min(step, pitch - gaze[1]));
        }
        static void lookSolve(Rig rig, int[] bones, double[][] limits, double[] gaze, double weight) {
            if (weight == 0) return;
            double yaw = 0, pitch = 0;
            double[] prev = rigEuler(0, 0, 0);
            for (int i = 0; i < bones.length; i++) {
                double[] link = limits[i];
                yaw += Math.max(-link[1], Math.min(link[1], gaze[0] * link[0])) * weight;
                pitch += Math.max(-link[2], Math.min(link[2], gaze[1] * link[0])) * weight;
                double[] turn = rigEuler(Math.toRadians(pitch), Math.toRadians(yaw), 0);
                rigTurn(rig, bones[i], rigMul(turn, rigTransposed(prev)));
                prev = turn;
            }
        }
`

export function rigMembers(plan: { weightedHang: boolean; look: ReturnType<typeof import("@minemods/studio-ai/look-bones").lookPlan>; sway: ReturnType<typeof import("@minemods/studio-ai/sway-bones").swayPlan>; parents: readonly number[]; hangs: readonly HangChain[]; feet: FootPlan | null; feetBones: readonly number[] }) {
  const hangs = plan.hangs.length > 0
  const feet = plan.feet !== null
  return `
        private static final int[] PARENT = ${ints(plan.parents)};
${hangs ? `        private static final Hang[] HANGS = {${plan.hangs.map(hangJava).join(", ")}};
        private static final int[] HANG_BONES = ${ints(chainBones(plan.hangs))};
        private static final int HANG_STEPS = ${HANG.steps};
` : ""}${feet ? `        private static final Feet FEET = ${feetJava(plan.feet!)};
        private static final int[] FEET_BONES = ${ints(plan.feetBones)};
        // Blocks a second a foot rises and falls at the most, and the most blocks it reaches down or up.
        private static final double FEET_RISE = ${javaDouble(plan.feet!.rise)};
        private static final double FEET_FALL = ${javaDouble(plan.feet!.fall)};
        private static final double FEET_DROP = ${javaDouble(plan.feet!.drop)};
` : ""}        private final Rig rig = new Rig(PARENT);

${RIG_JAVA}${plan.look ? `
${LOOK_JAVA}
        private static final int[] LOOK_BONES = ${ints(plan.look.bones.map(b => b.index))};
        private static final double[][] LOOK_LIMITS = {${plan.look.bones.map(b => `{${b.share}, ${b.yaw}, ${b.pitch}}`).join(", ")}};
        private void programLook(GeoModel<?> model, LivingEntity creature, State state, double now, float partial, double weight) {
            double head = Mth.rotLerp(partial, creature.yHeadRotO, creature.yHeadRot);
            double body = Mth.rotLerp(partial, creature.yBodyRotO, creature.yBodyRot);
            double dt = Double.isNaN(state.lookAt) ? 0.05 : Math.max(0, now - state.lookAt) / 20;
            state.lookAt = now;
            lookStep(state.gaze, -Mth.wrapDegrees(head - body), -Mth.lerp(partial, creature.xRotO, creature.getXRot()), ${plan.look.speed}, dt);
            loadRig(model);
            lookSolve(rig, LOOK_BONES, LOOK_LIMITS, state.gaze, weight);
            storeRig(model, LOOK_BONES);
        }
` : ""}${plan.sway.length ? `
${SWAY_JAVA}
        private static final int[] SWAY_BONES = ${ints([...new Set(plan.sway.flatMap(chain => chain.bones))])};
${plan.sway.map((chain, i) => `        private static final int[] SWAY_${i} = ${ints(chain.bones)};`).join("\n")}
        private void programSway(GeoModel<?> model, double tick, int id, double weight) {
            loadRig(model);
            double start = id * 2.399963229728653;
${plan.sway.map((s, i) => `            swayApply(rig, SWAY_${i}, ${s.axis}, ${["rotation","position","scale"].indexOf(s.channel)}, ${s.speed}, ${s.amount}, ${s.phase}, ${s.grow}, tick / 20, weight, start);`).join("\n")}
            storeRig(model, SWAY_BONES);
        }
` : ""}${hangs ? `\n${HANG_JAVA}${plan.weightedHang ? "\n" + HANG_JAVA.slice(HANG_JAVA.indexOf("        static void hangSolve(")).replace("void hangSolve(Rig rig, Hang hang, double[] points)", "void weightedHangSolve(Rig rig, Hang hang, double[] points, double weight)").replace("hang.weight)", "hang.weight * weight)") : ""}` : ""}${feet ? `\n${FEET_JAVA}` : ""}
        private void loadRig(GeoModel<?> model) {
            for (int index = 0; index < BONES.length; index++) {
                GeoBone bone = model.getBone(BONES[index]).orElse(null);
                int at = index * 3;
                if (bone == null) {
                    for (int axis = 0; axis < 3; axis++) {
                        rig.pivot[at + axis] = 0;
                        rig.rot[at + axis] = 0;
                        rig.pos[at + axis] = 0;
                        rig.scale[at + axis] = 1;
                    }
                    continue;
                }
                rig.pivot[at] = bone.getPivotX();
                rig.pivot[at + 1] = bone.getPivotY();
                rig.pivot[at + 2] = bone.getPivotZ();
                rig.rot[at] = bone.getRotX();
                rig.rot[at + 1] = bone.getRotY();
                rig.rot[at + 2] = bone.getRotZ();
                rig.pos[at] = bone.getPosX();
                rig.pos[at + 1] = bone.getPosY();
                rig.pos[at + 2] = bone.getPosZ();
                rig.scale[at] = bone.getScaleX();
                rig.scale[at + 1] = bone.getScaleY();
                rig.scale[at + 2] = bone.getScaleZ();
            }
        }

        private void storeRig(GeoModel<?> model, int[] bones) {
            for (int index : bones) {
                GeoBone bone = model.getBone(BONES[index]).orElse(null);
                if (bone == null) continue;
                int at = index * 3;
                bone.setRotX((float) rig.rot[at]);
                bone.setRotY((float) rig.rot[at + 1]);
                bone.setRotZ((float) rig.rot[at + 2]);
                bone.setPosX((float) rig.pos[at]);
                bone.setPosY((float) rig.pos[at + 1]);
                bone.setPosZ((float) rig.pos[at + 2]);${plan.sway.length ? "\n                bone.setScaleX((float) rig.scale[at]);\n                bone.setScaleY((float) rig.scale[at + 1]);\n                bone.setScaleZ((float) rig.scale[at + 2]);" : ""}
            }
        }

        // Where the body is drawn this frame (blocks).
        private static double[] drawnAt(LivingEntity creature, float partialTick) {
            return new double[] {Mth.lerp(partialTick, creature.xOld, creature.getX()), Mth.lerp(partialTick, creature.yOld, creature.getY()), Mth.lerp(partialTick, creature.zOld, creature.getZ())};
        }

        // Whether the body went further than a few blocks since the frame before: it was moved there (teleported), not carried.
        private static boolean jumped(double[] before, double[] now) {
            return before == null || Math.abs(now[0] - before[0]) + Math.abs(now[1] - before[1]) + Math.abs(now[2] - before[2]) > 4.0;
        }

        // The top of the highest block shape under (x, z) from \`from\` down to \`to\` (blocks): NaN where there is none; infinity where a block there reaches above \`from\`.
        private static double columnTop(net.minecraft.world.level.Level level, double x, double z, double from, double to) {
            net.minecraft.core.BlockPos.MutableBlockPos at = new net.minecraft.core.BlockPos.MutableBlockPos();
            int bx = Mth.floor(x), bz = Mth.floor(z);
            double fx = x - bx, fz = z - bz;
            for (int by = Mth.floor(from); by >= Mth.floor(to); by--) {
                at.set(bx, by, bz);
                net.minecraft.world.phys.shapes.VoxelShape shape = level.getBlockState(at).getCollisionShape(level, at);
                if (shape.isEmpty()) continue;
                double best = Double.NaN;
                for (net.minecraft.world.phys.AABB box : shape.toAabbs()) {
                    if (fx < box.minX || fx > box.maxX || fz < box.minZ || fz > box.maxZ) continue;
                    double top = by + box.maxY;
                    if (top > from + 1e-6) return Double.POSITIVE_INFINITY;
                    if (Double.isNaN(best) || top > best) best = top;
                }
                if (!Double.isNaN(best)) return best;
            }
            return Double.NaN;
        }
${feet ? `
        // 第 2 步 (踩地): each foot's ground under where it stands, reached at capped speeds (none of it off the ground), then the body and the legs follow.
        private void feet(GeoModel<?> model, LivingEntity creature, State state, double now, float partialTick) {
            double[] at = drawnAt(creature, partialTick);
            double yaw = Mth.rotLerp(partialTick, creature.yBodyRotO, creature.yBodyRot);
            double scale = creature.getScale();
            boolean fresh = Double.isNaN(state.feetAt) || now < state.feetAt || now - state.feetAt > 40.0 || jumped(state.feetSeen, at);
            boolean grounded = creature.onGround() && !creature.isPassenger();
            double seconds = fresh ? 0 : (now - state.feetAt) / 20.0;
            int count = FEET.thigh.length;
            double[] probes = new double[count * 3];
            for (int leg = 0; leg < count; leg++) {
                probes[leg * 3] = -FEET.side[leg];
                probes[leg * 3 + 2] = -FEET.forward[leg];
            }
            double[] spots = rigToWorld(probes, at, yaw, scale);
            double[] lift = new double[count];
            double[] contact = new double[count];
            for (int leg = 0; leg < count; leg++) {
                double target = at[1];
                if (grounded) {
                    double top = columnTop(creature.level(), spots[leg * 3], spots[leg * 3 + 2], at[1] + FEET_DROP, at[1] - FEET_DROP);
                    target = Double.isNaN(top) ? at[1] - FEET_DROP : Math.min(top, at[1] + FEET_DROP);
                }
                contact[leg] = Math.max(-FEET_DROP, Math.min(FEET_DROP, target - at[1])) * 16 / scale;
                state.feetGround[leg] = fresh ? target : footGround(state.feetGround[leg], target, FEET_RISE, FEET_FALL, seconds);
                lift[leg] = Math.max(-FEET_DROP, Math.min(FEET_DROP, state.feetGround[leg] - at[1])) * 16 / scale;
            }
            state.feetAt = now;
            state.feetSeen = at;
            loadRig(model);
            if (grounded) footSolve(rig, FEET, lift, contact, point -> {
                double[] world = rigToWorld(point, at, yaw, scale);
                double top = columnTop(creature.level(), world[0], world[2], at[1] + FEET_DROP, at[1] - FEET_DROP);
                return (Double.isNaN(top) ? -FEET_DROP : Mth.clamp(top - at[1], -FEET_DROP, FEET_DROP)) * 16 / scale;
            });
            storeRig(model, FEET_BONES);
        }
` : ""}${hangs ? `
        // 第 2 步 (挂链): each chain stepped in the world ${HANG.steps} times a tick, the motion's pose between the frame before and this one, then its links turned to it.
        private void hang(GeoModel<?> model, LivingEntity creature, State state, double now, float partialTick) {
            double[] at = drawnAt(creature, partialTick);
            double yaw = Mth.rotLerp(partialTick, creature.yBodyRotO, creature.yBodyRot);
            double scale = creature.getScale();
            boolean fresh = Double.isNaN(state.hangAt) || now < state.hangAt || now - state.hangAt > 10.0 || jumped(state.hangSeen, at);
            int steps = fresh ? 0 : (int) Math.floor((now - state.hangAt) * HANG_STEPS);
            loadRig(model);
            for (int chain = 0; chain < HANGS.length; chain++) {
                Hang hang = HANGS[chain];
                double[] target = rigToWorld(hangTargets(rig, hang), at, yaw, scale);
                double[] x = state.hangX[chain];
                if (fresh || x == null) {
                    state.hangX[chain] = target.clone();
                    state.hangBefore[chain] = target.clone();
                } else {
                    double[] last = state.hangLast[chain];
                    double[] between = new double[target.length];
                    double[] floors = hang.floor ? new double[target.length / 3] : null;
                    for (int step = 1; step <= steps; step++) {
                        for (int value = 0; value < target.length; value++) between[value] = last[value] + (target[value] - last[value]) * step / steps;
                        if (floors != null) for (int point = 0; point < floors.length; point++) {
                            double top = columnTop(creature.level(), x[point * 3], x[point * 3 + 2], x[point * 3 + 1] + 0.5, x[point * 3 + 1] - 2.0);
                            floors[point] = Double.isInfinite(top) ? Double.NaN : top;
                        }
                        hangStep(hang, x, state.hangBefore[chain], between, floors);
                    }
                }
                state.hangLast[chain] = target;
                ${plan.weightedHang ? "weightedHangSolve(rig, hang, rigToModel(state.hangX[chain], at, yaw, scale), state.weight[3])" : "hangSolve(rig, hang, rigToModel(state.hangX[chain], at, yaw, scale))"};
            }
            storeRig(model, HANG_BONES);
            state.hangAt = fresh ? now : state.hangAt + (double) steps / HANG_STEPS;
            state.hangSeen = at;
        }
` : ""}`
}

/** The fields each creature's State keeps for chains and feet. */
export const rigState = (plan: { hangs: readonly HangChain[]; feet: FootPlan | null }) =>
  `${plan.hangs.length ? `            double hangAt = Double.NaN;
            double[] hangSeen;
            final double[][] hangX = new double[HANGS.length][];
            final double[][] hangBefore = new double[HANGS.length][];
            final double[][] hangLast = new double[HANGS.length][];
` : ""}${plan.feet ? `            double feetAt = Double.NaN;
            double[] feetSeen;
            final double[] feetGround = new double[FEET.thigh.length];
` : ""}`
