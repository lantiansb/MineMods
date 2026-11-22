import com.minemods.content_gesture_smoke.gesture.core.GestureData;
import com.minemods.content_gesture_smoke.gesture.fabric.client.GestureAnimations;
import dev.kosmx.playerAnim.api.TransformType;
import dev.kosmx.playerAnim.api.layered.KeyframeAnimationPlayer;
import dev.kosmx.playerAnim.core.data.KeyframeAnimation;
import dev.kosmx.playerAnim.core.util.Ease;
import dev.kosmx.playerAnim.core.util.Vec3f;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Plays the generated animations through the real animation library on a plain JVM, and prints the
 * library's easing curves. Driven by gesture-core-check.ts; never shipped. No game is involved: this proves
 * what the library is handed and what it computes from it, not what the game draws.
 */
final class GestureLibraryCheck {
    private static final Map<String, String> LIBRARY = Map.of("head", "head", "torso", "torso", "right_arm", "rightArm", "left_arm", "leftArm", "right_leg", "rightLeg", "left_leg", "leftLeg");

    public static void main(String[] args) throws Exception {
        GestureData data = GestureData.parse(new StringReader(Files.readString(Path.of(args[0]))), message -> System.out.println("report " + message));
        for (int index = 0; index < data.size(); index++) {
            var gesture = data.get(index);
            KeyframeAnimation animation = GestureAnimations.build(gesture);
            var player = new KeyframeAnimationPlayer(animation);
            var builder = new KeyframeAnimation.AnimationBuilder(animation.animationFormat);
            // One tick past the end: the library must have let go of every part by then.
            for (int tick = 0; tick <= gesture.lengthTicks() + 1; tick++) {
                player.setupAnim(0);
                for (String part : gesture.parts().keySet()) {
                    var rest = builder.getPart(LIBRARY.get(part));
                    Vec3f pivot = new Vec3f(rest.x.defaultValue, rest.y.defaultValue, rest.z.defaultValue);
                    Vec3f rotation = player.get3DTransform(LIBRARY.get(part), TransformType.ROTATION, 0, Vec3f.ZERO);
                    Vec3f position = player.get3DTransform(LIBRARY.get(part), TransformType.POSITION, 0, pivot);
                    System.out.println("played " + index + " " + part + " " + tick + " " + (player.isActive() ? 1 : 0) + " " + Math.toDegrees(rotation.getX()) + " " + Math.toDegrees(rotation.getY()) + " " + Math.toDegrees(rotation.getZ())
                        + " " + (position.getX() - pivot.getX()) + " " + (position.getY() - pivot.getY()) + " " + (position.getZ() - pivot.getZ()));
                }
                player.tick();
            }
        }
        for (int name = 1; name < args.length; name++) {
            StringBuilder line = new StringBuilder("ease " + args[name]);
            for (int step = 0; step <= 20; step++) line.append(' ').append(Ease.valueOf(args[name]).invoke(step / 20f));
            System.out.println(line);
        }
    }
}
