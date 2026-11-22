import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.Direction;
import org.joml.Vector3f;
import software.bernie.geckolib.animation.*;
import software.bernie.geckolib.animation.keyframe.*;
import software.bernie.geckolib.cache.object.*;
import software.bernie.geckolib.loading.json.raw.Model;
import software.bernie.geckolib.loading.json.typeadapter.BakedAnimationsAdapter;
import software.bernie.geckolib.loading.json.typeadapter.KeyFramesAdapter;
import software.bernie.geckolib.loading.object.BakedModelFactory;
import software.bernie.geckolib.loading.object.GeometryTree;
import software.bernie.geckolib.util.RenderUtil;

/**
 * Plays an exported model and its animation file through GeckoLib 4.8.3's own classes, outside the game.
 *
 * What is GeckoLib's own code here, and so what the output proves:
 * - the geometry is read by GeckoLib's Gson (`KeyFramesAdapter.GEO_GSON`) and baked by
 *   `BakedModelFactory.DEFAULT_FACTORY.constructGeoModel` (this is where X is mirrored);
 * - every animation's bones are baked by `BakedAnimationsAdapter.bakeBoneAnimations` (the method
 *   `deserialize` calls per animation; `deserialize` itself only loops and logs through a class that needs a
 *   running game);
 * - each track is read with `AnimationController.getAnimationPointAtTick` and
 *   `EasingType.lerpWithOverride`, the two calls `AnimationController.processCurrentAnimation` makes for
 *   every bone and axis;
 * - the bone matrices are built by `RenderUtil.prepMatrixForBone` and the cube matrices by
 *   `RenderUtil.translateToPivotPoint / rotateMatrixAroundCube / translateAwayFromPivotPoint`, in the order
 *   `GeoRenderer.renderRecursively` and `renderCube` call them.
 * What is this file's own: handing the values to the bones exactly as `AnimationProcessor.tickAnimation`
 * does (rotation = value + the bone's initial rotation; position and scale = value), read from its bytecode.
 *
 * usage: GeckoProbe <geo.json> <animation.json> <time,time,...>
 * prints { animation: { time: { tracks: { bone: { rotation|position|scale: [x, y, z] } },
 *                                corners: { bone: [ [ [x, y, z] x 8 ] per cube ] } } } }
 * `tracks` are the values GeckoLib hands to the bone (rotation in radians, X and Y already negated);
 * `corners` are every cube's eight corners as drawn, in model pixels, sorted.
 */
public class GeckoProbe {
  static Method point;
  static Object controller;
  static final Direction.Axis[] AXES = { Direction.Axis.X, Direction.Axis.Y, Direction.Axis.Z };

  static double[] read(KeyframeStack<?> stack, double tick, boolean rotation) throws Exception {
    List<?>[] lists = { stack.xKeyframes(), stack.yKeyframes(), stack.zKeyframes() };
    if (lists[0].isEmpty()) return null;
    double[] value = new double[3];
    for (int axis = 0; axis < 3; axis++) value[axis] = EasingType.lerpWithOverride((AnimationPoint) point.invoke(controller, lists[axis], tick, rotation, AXES[axis]), null);
    return value;
  }

  static JsonArray array(double[] value) {
    JsonArray out = new JsonArray();
    for (double part : value) out.add(part);
    return out;
  }

  static void walk(GeoBone bone, MatrixStack stack, JsonObject corners) {
    stack.push();
    RenderUtil.prepMatrixForBone(stack, bone);
    JsonArray cubes = new JsonArray();
    for (GeoCube cube : bone.getCubes()) {
      stack.push();
      RenderUtil.translateToPivotPoint(stack, cube);
      RenderUtil.rotateMatrixAroundCube(stack, cube);
      RenderUtil.translateAwayFromPivotPoint(stack, cube);
      TreeSet<String> seen = new TreeSet<>();
      List<double[]> found = new ArrayList<>();
      for (GeoQuad quad : cube.quads()) {
        if (quad == null) continue;
        for (GeoVertex vertex : quad.vertices()) {
          Vector3f at = stack.peek().getPositionMatrix().transformPosition(new Vector3f(vertex.position()));
          double[] pixels = { at.x * 16.0, at.y * 16.0, at.z * 16.0 };
          if (seen.add(String.format("%.3f,%.3f,%.3f", pixels[0], pixels[1], pixels[2]))) found.add(pixels);
        }
      }
      found.sort((a, b) -> a[0] != b[0] ? Double.compare(a[0], b[0]) : a[1] != b[1] ? Double.compare(a[1], b[1]) : Double.compare(a[2], b[2]));
      JsonArray list = new JsonArray();
      for (double[] value : found) list.add(array(value));
      cubes.add(list);
      stack.pop();
    }
    corners.add(bone.getName(), cubes);
    for (GeoBone child : bone.getChildBones()) walk(child, stack, corners);
    stack.pop();
  }

  static void collect(GeoBone bone, Map<String, GeoBone> all) {
    all.put(bone.getName(), bone);
    for (GeoBone child : bone.getChildBones()) collect(child, all);
  }

  public static void main(String[] args) throws Exception {
    Model raw = KeyFramesAdapter.GEO_GSON.fromJson(Files.readString(Path.of(args[0])), Model.class);
    BakedGeoModel model = BakedModelFactory.DEFAULT_FACTORY.constructGeoModel(GeometryTree.fromModel(raw));
    Map<String, GeoBone> bones = new LinkedHashMap<>();
    for (GeoBone top : model.topLevelBones()) collect(top, bones);
    for (GeoBone bone : bones.values()) if (bone.getInitialSnapshot() == null) bone.saveInitialSnapshot();

    JsonObject file = JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonObject().getAsJsonObject("animations");
    BakedAnimationsAdapter adapter = new BakedAnimationsAdapter();
    Method bake = BakedAnimationsAdapter.class.getDeclaredMethod("bakeBoneAnimations", JsonObject.class);
    bake.setAccessible(true);
    Field unsafe = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
    unsafe.setAccessible(true);
    // getAnimationPointAtTick reads no field of the controller; a controller cannot be constructed without an entity.
    controller = ((sun.misc.Unsafe) unsafe.get(null)).allocateInstance(AnimationController.class);
    point = AnimationController.class.getDeclaredMethod("getAnimationPointAtTick", List.class, double.class, boolean.class, Direction.Axis.class);
    point.setAccessible(true);

    JsonObject out = new JsonObject();
    for (Map.Entry<String, JsonElement> entry : file.entrySet()) {
      BoneAnimation[] baked = (BoneAnimation[]) bake.invoke(adapter, entry.getValue().getAsJsonObject().getAsJsonObject("bones"));
      JsonObject times = new JsonObject();
      for (String time : args[2].split(",")) {
        double tick = Double.parseDouble(time) * 20;
        JsonObject tracks = new JsonObject();
        for (GeoBone bone : bones.values()) {
          bone.updateRotation(bone.getInitialSnapshot().getRotX(), bone.getInitialSnapshot().getRotY(), bone.getInitialSnapshot().getRotZ());
          bone.updatePosition(0, 0, 0);
          bone.updateScale(1, 1, 1);
        }
        for (BoneAnimation animation : baked) {
          GeoBone bone = bones.get(animation.boneName());
          JsonObject values = new JsonObject();
          double[] rotation = read(animation.rotationKeyFrames(), tick, true);
          double[] position = read(animation.positionKeyFrames(), tick, false);
          double[] scale = read(animation.scaleKeyFrames(), tick, false);
          if (rotation != null) {
            values.add("rotation", array(rotation));
            bone.updateRotation((float) rotation[0] + bone.getInitialSnapshot().getRotX(), (float) rotation[1] + bone.getInitialSnapshot().getRotY(), (float) rotation[2] + bone.getInitialSnapshot().getRotZ());
          }
          if (position != null) {
            values.add("position", array(position));
            bone.updatePosition((float) position[0], (float) position[1], (float) position[2]);
          }
          if (scale != null) {
            values.add("scale", array(scale));
            bone.updateScale((float) scale[0], (float) scale[1], (float) scale[2]);
          }
          tracks.add(animation.boneName(), values);
        }
        JsonObject corners = new JsonObject();
        MatrixStack stack = new MatrixStack();
        for (GeoBone top : model.topLevelBones()) walk(top, stack, corners);
        JsonObject at = new JsonObject();
        at.add("tracks", tracks);
        at.add("corners", corners);
        times.add(time, at);
      }
      out.add(entry.getKey(), times);
    }
    System.out.println(new Gson().toJson(out));
  }
}
