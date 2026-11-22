import com.minemods.content_gesture_smoke.gesture.core.GestureAim;
import com.minemods.content_gesture_smoke.gesture.core.GestureCooldown;
import com.minemods.content_gesture_smoke.gesture.core.GestureData;
import com.minemods.content_gesture_smoke.gesture.core.GestureState;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Runs the loader-neutral cast-action core on a plain JVM. Driven by gesture-core-check.ts; never shipped. */
final class GestureCoreCheck {
    public static void main(String[] args) throws Exception {
        String json = Files.readString(Path.of(args[0]));
        List<String> reports = new ArrayList<>();
        GestureData data = GestureData.parse(new StringReader(json), reports::add);
        System.out.println("loaded " + data.loaded() + " of " + data.size() + " reports " + reports.size());
        for (int index = 0; index < data.size(); index++) {
            var gesture = data.get(index);
            System.out.println("ticks " + index + " " + gesture.windupTicks() + " " + gesture.holdTicks() + " " + gesture.releaseTicks() + " " + gesture.lengthTicks());
            for (var part : gesture.parts().entrySet()) {
                dump(index, part.getKey(), "rotation", part.getValue().rotation());
                dump(index, part.getKey(), "position", part.getValue().position());
            }
        }
        // Data from another Studio generation: reported, nothing loaded, no exception.
        GestureData older = GestureData.parse(new StringReader(json.replaceFirst("\"format\":2", "\"format\":1")), reports::add);
        GestureData newer = GestureData.parse(new StringReader(json.replaceFirst("\"format\":2", "\"format\":3")), reports::add);
        // One action with a trigger this runtime does not know: only that action is skipped and it keeps its index.
        GestureData skill = GestureData.parse(new StringReader(json.replaceFirst("\"type\":\"key\"", "\"type\":\"skill\"")), reports::add);
        GestureData broken = GestureData.parse(new StringReader("{ not json"), reports::add);
        System.out.println("older " + older.size() + " newer " + newer.size() + " skill " + skill.loaded() + " of " + skill.size() + " first " + (skill.get(0) == null) + " second " + (skill.get(1) != null)
            + " broken " + broken.size() + " out-of-range " + (data.get(-1) == null && data.get(99) == null));
        reports.forEach(report -> System.out.println("report " + report));
        GestureState state = new GestureState();
        state.start(0, 20, 100);
        System.out.println("state " + state.update(119, true) + " " + state.update(120, true) + " " + state.active());
        state.start(1, 40, 200);
        System.out.println("gone " + state.update(201, false) + " " + state.active());
        GestureCooldown cooldown = new GestureCooldown();
        UUID player = UUID.randomUUID();
        System.out.println("cooldown " + cooldown.accept(player, 20, 0) + " " + cooldown.accept(player, 20, 19) + " " + cooldown.accept(player, 20, 20));
        // A new server starts its tick count again: nothing remembered from the last one may block a player.
        cooldown.clear();
        System.out.println("restart " + cooldown.accept(player, 20, 0));
        // The look is blended in and out along an in-out sine, and never over- or undershoots.
        System.out.println("fade " + GestureAim.fade(-1) + " " + GestureAim.fade(0.25f) + " " + GestureAim.fade(0.5f) + " " + GestureAim.fade(2));
        System.out.println("turns " + data.get(0).turns("right_arm") + " " + data.get(0).turns("no_such_part"));
        float[] swing = GestureAim.swing(-5, 2, -1.5f, (float) Math.toRadians(30), (float) Math.toRadians(-40));
        System.out.println("aim " + swing[0] + " " + swing[1] + " " + swing[2] + " share " + Math.toDegrees(GestureAim.share(400)) + " wrap " + GestureAim.wrap(190) + " " + GestureAim.wrap(-190));
    }

    private static void dump(int index, String part, String channel, float[][] frames) {
        if (frames == null) return;
        for (int tick = 0; tick < frames.length; tick++)
            System.out.println("frame " + index + " " + part + " " + channel + " " + (tick + 1) + " " + frames[tick][0] + " " + frames[tick][1] + " " + frames[tick][2]);
    }
}
