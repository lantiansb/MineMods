import { GESTURE_RECOVER_TICKS, gestureTicks } from "../gesture-motion"
import { GESTURE_AIM, GESTURE_BONE_NAMES, GESTURE_FORMAT, GESTURE_KEYS, GESTURE_RUNTIME_VERSION, GESTURE_TICK, GESTURE_TIMING } from "../gesture-rig"

const strings = (values: readonly string[]) => values.map((value) => `"${value}"`).join(", ")

/**
 * The cast-action runtime: the same Java for every project and every action, differing only in package
 * and mod id. `core` knows the data, the timeline and the aim arithmetic and must compile without any
 * loader, animation library or Minecraft class on the classpath; `fabric` is the thin part to rewrite for
 * another loader. Kept as text here, like the other Fabric compilers, so it ships with the app's code and a
 * project without cast actions gets none of it.
 *
 * How it plays was learnt from how established mods use the playerAnimator library (one animation layer
 * per player, a fade in and out, an adjustment that follows the look direction, a mirror for left-handed
 * players, the third-person model shown in first person). Only the library's public API is used; no code
 * or animation data from any other mod is in here.
 */
export function gestureRuntimeSources(packageName: string, modId: string): Record<string, string> {
  const root = `src/main/java/${packageName.replaceAll(".", "/")}`
  const core = `${packageName}.gesture.core`
  const fabric = `${packageName}.gesture.fabric`
  return {
    [`${root}/gesture/core/GestureRuntime.java`]: `package ${core};

/** Identity and fixed timings of the cast-action runtime. The build writes the version and format into the mod metadata too. */
public final class GestureRuntime {
    public static final String VERSION = "${GESTURE_RUNTIME_VERSION}";
    /** The cast-action data format this runtime reads. */
    public static final int FORMAT = ${GESTURE_FORMAT};
    public static final int TICKS_PER_SECOND = ${Math.round(1 / GESTURE_TICK)};
    /** Ticks the body takes to ease back to its own pose after the release. */
    public static final int RECOVER_TICKS = ${GESTURE_RECOVER_TICKS};
    /** Ticks an action takes to blend in over whatever the player was doing. */
    public static final int FADE_IN_TICKS = ${gestureTicks(GESTURE_TIMING.fade_in)};
    /** Ticks an interrupted action takes to blend out. */
    public static final int CANCEL_TICKS = ${gestureTicks(GESTURE_TIMING.cancel)};
    /** Share of the look direction the casting arms follow. */
    public static final float AIM_SHARE = ${GESTURE_AIM}f;

    private GestureRuntime() {}
}
`,
    [`${root}/gesture/core/GestureData.java`]: `package ${core};

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;
import java.util.function.Consumer;

/**
 * The cast actions a mod carries, read from its data file. The file already holds every body part's value
 * for every tick, so nothing here interpolates or eases. An action this runtime does not understand is
 * reported in plain words and left out; nothing here throws at the caller.
 */
public final class GestureData {
    public static final List<String> PARTS = List.of(${strings(GESTURE_BONE_NAMES)});
    public static final List<String> KEYS = List.of(${strings(GESTURE_KEYS)});
    private static final int LONGEST_TICKS = 400;

    /**
     * One body part through the whole action: entry t is the value at tick t + 1. Rotation is degrees about
     * the vanilla model's x, y and z; position is the pivot's offset in model pixels. A null channel is left
     * to the game.
     */
    public record Track(float[][] rotation, float[][] position) {}

    public record Gesture(String id, String name, String key, boolean aim, boolean mirrorForLeftHanded, boolean showArms,
                          boolean showItems, int windupTicks, int holdTicks, int releaseTicks, Map<String, Track> parts) {
        /** Ticks from the key press to the end of the release. */
        public int ticks() {
            return windupTicks + holdTicks + releaseTicks;
        }

        /** Ticks until the body is its own again. */
        public int lengthTicks() {
            return ticks() + GestureRuntime.RECOVER_TICKS;
        }

        /** Whether the action itself turns this part. A part it does not turn keeps the game's own angles. */
        public boolean turns(String part) {
            return parts.containsKey(part) && parts.get(part).rotation() != null;
        }
    }

    private record Phase(int ticks, boolean loop, Map<String, Track> parts) {}

    // A skipped action keeps its place as null: the index in this list is what travels over the network.
    private final List<Gesture> gestures;

    private GestureData(List<Gesture> gestures) {
        this.gestures = gestures;
    }

    public static GestureData load(Class<?> owner, String resource, Consumer<String> report) {
        try (var stream = owner.getResourceAsStream(resource)) {
            if (stream != null) return parse(new InputStreamReader(stream, StandardCharsets.UTF_8), report);
            report.accept("no cast-action data at " + resource + "; no action will play");
        } catch (IOException error) {
            report.accept("cast-action data could not be read (" + error.getMessage() + "); no action will play");
        }
        return new GestureData(List.of());
    }

    public static GestureData parse(Reader reader, Consumer<String> report) {
        try {
            JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
            int format = need(root, "format").getAsInt();
            if (format != GestureRuntime.FORMAT) {
                report.accept("cast-action data is format " + format + " but runtime " + GestureRuntime.VERSION + " reads format "
                    + GestureRuntime.FORMAT + "; no action will play until the mod is rebuilt with a matching runtime");
                return new GestureData(List.of());
            }
            JsonArray list = need(root, "gestures").getAsJsonArray();
            List<Gesture> gestures = new ArrayList<>();
            Set<String> keys = new HashSet<>();
            for (int index = 0; index < list.size(); index++) gestures.add(readOrSkip(list.get(index), index, keys, report));
            return new GestureData(Collections.unmodifiableList(gestures));
        } catch (RuntimeException error) {
            report.accept("cast-action data is not valid (" + error.getMessage() + "); no action will play");
            return new GestureData(List.of());
        }
    }

    private static Gesture readOrSkip(JsonElement element, int index, Set<String> keys, Consumer<String> report) {
        try {
            Gesture gesture = read(element.getAsJsonObject());
            if (!keys.add(gesture.key())) throw new IllegalArgumentException("key " + gesture.key() + " is already used by an earlier action");
            return gesture;
        } catch (RuntimeException error) {
            report.accept("cast action #" + index + " skipped: " + error.getMessage());
            return null;
        }
    }

    private static Gesture read(JsonObject json) {
        String id = need(json, "id").getAsString();
        if (!id.matches("[a-z][a-z0-9_]{0,63}")) throw new IllegalArgumentException("invalid id");
        JsonObject trigger = need(json, "trigger").getAsJsonObject();
        String type = need(trigger, "type").getAsString();
        if (!type.equals("key")) throw new IllegalArgumentException(id + ": trigger type \\"" + type + "\\" is not supported by runtime " + GestureRuntime.VERSION);
        String key = need(trigger, "key").getAsString();
        if (!KEYS.contains(key)) throw new IllegalArgumentException(id + ": key \\"" + key + "\\" is not supported");
        JsonObject firstPerson = need(json, "first_person").getAsJsonObject();
        Phase windup = phase(id, need(json, "windup").getAsJsonObject());
        Phase release = phase(id, need(json, "release").getAsJsonObject());
        JsonElement held = json.get("hold");
        Phase hold = held == null || held.isJsonNull() ? null : phase(id, held.getAsJsonObject());
        int holdTicks = need(json, "hold_ticks").getAsInt();
        if (holdTicks < 0 || (holdTicks > 0) != (hold != null)) throw new IllegalArgumentException(id + ": the hold and its length disagree");
        int ticks = windup.ticks() + holdTicks + release.ticks();
        if (ticks > LONGEST_TICKS) throw new IllegalArgumentException(id + ": the action is too long");
        if (!windup.parts().keySet().equals(release.parts().keySet()) || (hold != null && !hold.parts().keySet().equals(windup.parts().keySet())))
            throw new IllegalArgumentException(id + ": every phase must move the same parts");
        Map<String, Track> parts = new LinkedHashMap<>();
        for (String part : windup.parts().keySet()) {
            Track first = windup.parts().get(part);
            Track middle = hold == null ? null : hold.parts().get(part);
            Track last = release.parts().get(part);
            parts.put(part, new Track(
                join(id, first.rotation(), middle == null ? null : middle.rotation(), last.rotation(), hold, holdTicks),
                join(id, first.position(), middle == null ? null : middle.position(), last.position(), hold, holdTicks)));
        }
        return new Gesture(id, need(json, "name").getAsString(), key, need(json, "aim").getAsBoolean(), need(json, "mirror_for_left_handed").getAsBoolean(),
            need(firstPerson, "arms").getAsBoolean(), need(firstPerson, "items").getAsBoolean(), windup.ticks(), holdTicks, release.ticks(),
            Collections.unmodifiableMap(parts));
    }

    // One channel for the whole action: the windup, then the hold repeated (or frozen on its last tick) for as long as asked, then the release.
    private static float[][] join(String id, float[][] windup, float[][] hold, float[][] release, Phase held, int holdTicks) {
        if (windup == null && release == null && hold == null) return null;
        if (windup == null || release == null || (held != null && hold == null)) throw new IllegalArgumentException(id + ": a channel must be present in every phase");
        List<float[]> frames = new ArrayList<>(List.of(windup));
        for (int tick = 0; tick < holdTicks; tick++) frames.add(hold[held.loop() ? tick % hold.length : Math.min(tick, hold.length - 1)]);
        frames.addAll(List.of(release));
        return frames.toArray(new float[0][]);
    }

    private static Phase phase(String id, JsonObject json) {
        int ticks = need(json, "ticks").getAsInt();
        if (ticks < 1 || ticks > LONGEST_TICKS) throw new IllegalArgumentException(id + ": a phase length is out of range");
        JsonElement loop = json.get("loop");
        Map<String, Track> parts = new LinkedHashMap<>();
        for (var entry : need(json, "parts").getAsJsonObject().entrySet()) {
            if (!PARTS.contains(entry.getKey())) throw new IllegalArgumentException(id + ": unknown body part \\"" + entry.getKey() + "\\"");
            JsonObject channels = entry.getValue().getAsJsonObject();
            parts.put(entry.getKey(), new Track(frames(id, channels.get("rotation"), ticks, 720), frames(id, channels.get("position"), ticks, 32)));
        }
        return new Phase(ticks, loop != null && loop.getAsBoolean(), parts);
    }

    private static float[][] frames(String id, JsonElement element, int ticks, float limit) {
        if (element == null || element.isJsonNull()) return null;
        JsonArray array = element.getAsJsonArray();
        if (array.size() != ticks) throw new IllegalArgumentException(id + ": a channel must have one value per tick");
        float[][] frames = new float[ticks][];
        for (int tick = 0; tick < ticks; tick++) {
            JsonArray value = array.get(tick).getAsJsonArray();
            if (value.size() != 3) throw new IllegalArgumentException(id + ": a value must be three numbers");
            frames[tick] = new float[] {value.get(0).getAsFloat(), value.get(1).getAsFloat(), value.get(2).getAsFloat()};
            for (float number : frames[tick]) if (!(Math.abs(number) <= limit)) throw new IllegalArgumentException(id + ": a value is out of range");
        }
        return frames;
    }

    private static JsonElement need(JsonObject json, String name) {
        JsonElement value = json.get(name);
        if (value == null || value.isJsonNull()) throw new IllegalArgumentException("missing field \\"" + name + "\\"");
        return value;
    }

    public int size() {
        return gestures.size();
    }

    /** The action at a network index, or null when the index is out of range or that action was skipped. */
    public Gesture get(int index) {
        return index < 0 || index >= gestures.size() ? null : gestures.get(index);
    }

    public int loaded() {
        return (int) gestures.stream().filter(gesture -> gesture != null).count();
    }
}
`,
    [`${root}/gesture/core/GestureState.java`]: `package ${core};

/** The one cast action the local player is showing. Time is the caller's own tick counter, so nothing outside can freeze it. */
public final class GestureState {
    private int gesture = -1;
    private long startTick;
    private int lengthTicks;

    public void start(int gesture, int lengthTicks, long nowTick) {
        this.gesture = gesture;
        this.lengthTicks = lengthTicks;
        this.startTick = nowTick;
    }

    public boolean active() {
        return gesture >= 0;
    }

    public int gesture() {
        return gesture;
    }

    /** Ends the action when its time is up or its player is gone. True when it ended on this call. */
    public boolean update(long nowTick, boolean ownerPresent) {
        if (!active() || (ownerPresent && nowTick - startTick < lengthTicks)) return false;
        stop();
        return true;
    }

    public void stop() {
        gesture = -1;
    }
}
`,
    [`${root}/gesture/core/GestureCooldown.java`]: `package ${core};

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Server-side limit: a player cannot start a cast action while their previous one is still playing. */
public final class GestureCooldown {
    /** Shortest gap between two accepted actions, whatever their length. */
    public static final int MIN_GAP_TICKS = 5;
    private final Map<UUID, Long> busyUntil = new HashMap<>();

    public boolean accept(UUID player, int lengthTicks, long nowTick) {
        Long until = busyUntil.get(player);
        if (until != null && nowTick < until) return false;
        busyUntil.put(player, nowTick + Math.max(lengthTicks, MIN_GAP_TICKS));
        return true;
    }

    public void forget(UUID player) {
        busyUntil.remove(player);
    }

    /** A new server counts its ticks from zero again, so nothing remembered from the last one still applies. */
    public void clear() {
        busyUntil.clear();
    }
}
`,
    [`${root}/gesture/core/GestureAim.java`]: `package ${core};

/**
 * How a casting arm follows where the player looks. The arm turns by a share of the look angles, and its
 * shoulder swings round the neck by the same angles so the arm stays on the body instead of pivoting in
 * mid-air. Angles in radians; points in model pixels from the neck, x to the player's left, y down, z back.
 */
public final class GestureAim {
    private GestureAim() {}

    /** The share of a look angle (degrees) an arm takes, in radians. */
    public static float share(float degrees) {
        return (float) Math.toRadians(wrap(degrees) * GestureRuntime.AIM_SHARE);
    }

    /** How much of the look is added while an action blends in or eases back: 0 to 1 along the same curve the motion itself uses. */
    public static float fade(float amount) {
        return (float) ((1 - Math.cos(Math.PI * Math.max(0, Math.min(1, amount)))) / 2);
    }

    public static float wrap(float degrees) {
        float wrapped = degrees % 360;
        if (wrapped >= 180) return wrapped - 360;
        return wrapped < -180 ? wrapped + 360 : wrapped;
    }

    /** How far a point moves when it is pitched and then yawed about the neck: the offset to add to it. */
    public static float[] swing(float x, float y, float z, float pitch, float yaw) {
        float pitchedY = (float) (y * Math.cos(pitch) - z * Math.sin(pitch));
        float pitchedZ = (float) (y * Math.sin(pitch) + z * Math.cos(pitch));
        float turnedX = (float) (x * Math.cos(yaw) + pitchedZ * Math.sin(yaw));
        float turnedZ = (float) (-x * Math.sin(yaw) + pitchedZ * Math.cos(yaw));
        return new float[] {turnedX - x, pitchedY - y, turnedZ - z};
    }
}
`,
    [`${root}/gesture/fabric/GestureMod.java`]: `package ${fabric};

import ${core}.GestureCooldown;
import ${core}.GestureData;
import ${core}.GestureData.Gesture;
import ${core}.GestureRuntime;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Fabric side shared by client and server: the two packets and the server's checks. */
public final class GestureMod implements ModInitializer {
    public static final String MOD_ID = "${modId}";
    public static final Logger LOG = LoggerFactory.getLogger(MOD_ID + "/gesture");
    public static final GestureData DATA = GestureData.load(GestureMod.class, "/data/" + MOD_ID + "/studio/gestures.json",
        message -> LOG.warn("Cast-action runtime: {}", message));
    /** Blocks within which other players are told about a cast action. */
    private static final double RANGE = 64;
    private static final GestureCooldown COOLDOWN = new GestureCooldown();

    /** Client asks to play one of its own cast actions. The sender is whoever the connection belongs to, never a field. */
    public record Play(int gesture) implements CustomPacketPayload {
        public static final Type<Play> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(MOD_ID, "gesture_play"));
        public static final StreamCodec<RegistryFriendlyByteBuf, Play> CODEC = StreamCodec.composite(ByteBufCodecs.VAR_INT, Play::gesture, Play::new);
        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
    }

    /** Server tells nearby clients which player plays which cast action. */
    public record Show(int playerId, int gesture) implements CustomPacketPayload {
        public static final Type<Show> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(MOD_ID, "gesture_show"));
        public static final StreamCodec<RegistryFriendlyByteBuf, Show> CODEC = StreamCodec.composite(ByteBufCodecs.VAR_INT, Show::playerId, ByteBufCodecs.VAR_INT, Show::gesture, Show::new);
        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
    }

    @Override public void onInitialize() {
        LOG.info("Cast-action runtime {} (data format {}): {} loaded, {} skipped", GestureRuntime.VERSION, GestureRuntime.FORMAT,
            DATA.loaded(), DATA.size() - DATA.loaded());
        PayloadTypeRegistry.playC2S().register(Play.ID, Play.CODEC);
        PayloadTypeRegistry.playS2C().register(Show.ID, Show.CODEC);
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> COOLDOWN.forget(handler.player.getUUID()));
        ServerLifecycleEvents.SERVER_STARTING.register(server -> COOLDOWN.clear());
        ServerPlayNetworking.registerGlobalReceiver(Play.ID, (payload, context) -> context.server().execute(() -> {
            var player = context.player();
            var gesture = DATA.get(payload.gesture());
            if (gesture == null || player.isRemoved() || !player.isAlive() || player.isSpectator()) return;
            if (!COOLDOWN.accept(player.getUUID(), gesture.lengthTicks(), context.server().getTickCount())) return;
            var show = new Show(player.getId(), payload.gesture());
            for (var other : player.serverLevel().players()) {
                if (other.distanceToSqr(player) <= RANGE * RANGE && ServerPlayNetworking.canSend(other, Show.ID))
                    ServerPlayNetworking.send(other, show);
            }
        }));
    }
}
`,
    [`${root}/gesture/fabric/client/GestureClient.java`]: `package ${fabric}.client;

import ${core}.GestureData.Gesture;
import ${core}.GestureState;
import ${fabric}.GestureMod;
import com.mojang.blaze3d.platform.InputConstants;
import dev.kosmx.playerAnim.core.data.KeyframeAnimation;
import dev.kosmx.playerAnim.minecraftApi.PlayerAnimationFactory;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.resources.ResourceLocation;
import org.lwjgl.glfw.GLFW;

/**
 * Fabric client side: key bindings and playing a cast action on whichever player the server names. The
 * same animation is what others see and, through the library's first-person mode, what the player sees of
 * their own arms; there is no separate hand model.
 */
public final class GestureClient implements ClientModInitializer {
    private static final ResourceLocation LAYER = ResourceLocation.fromNamespaceAndPath(GestureMod.MOD_ID, "gesture");
    private static final GestureState STATE = new GestureState();
    private static final Map<KeyMapping, Integer> KEYS = new LinkedHashMap<>();
    // Built once from the data file; entry i is the animation of cast action i, null where that action was skipped.
    private static final List<KeyframeAnimation> ANIMATIONS = new ArrayList<>();
    // One cast layer per player the client knows, made by the animation library when the player appears and
    // dropped in tick() once that player is gone. A cast holds its player, so a weak map would never let go.
    private static final Map<AbstractClientPlayer, GestureCast> CASTS = new HashMap<>();
    // Own counter rather than world time: world time can be frozen by a command, and a cast must never get stuck.
    private static long ticks;

    @Override public void onInitializeClient() {
        PlayerAnimationFactory.ANIMATION_DATA_FACTORY.registerFactory(LAYER, 1000, player -> {
            var cast = new GestureCast(player);
            CASTS.put(player, cast);
            return cast.layer();
        });
        for (int index = 0; index < GestureMod.DATA.size(); index++) {
            var gesture = GestureMod.DATA.get(index);
            ANIMATIONS.add(gesture == null ? null : GestureAnimations.build(gesture));
            if (gesture == null) continue;
            KEYS.put(KeyBindingHelper.registerKeyBinding(new KeyMapping("key." + GestureMod.MOD_ID + ".gesture." + gesture.key(),
                InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_A + gesture.key().charAt(0) - 'a', "category." + GestureMod.MOD_ID + ".gestures")), index);
        }
        ClientPlayNetworking.registerGlobalReceiver(GestureMod.Show.ID, (payload, context) -> context.client().execute(() -> show(context.client(), payload)));
        ClientTickEvents.END_CLIENT_TICK.register(GestureClient::tick);
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> forgetAll());
    }

    private static void show(Minecraft client, GestureMod.Show payload) {
        var gesture = GestureMod.DATA.get(payload.gesture());
        if (gesture == null || client.level == null) return;
        if (!(client.level.getEntity(payload.playerId()) instanceof AbstractClientPlayer player) || !player.isAlive()) return;
        var cast = CASTS.get(player);
        if (cast == null) return;
        cast.play(gesture, ANIMATIONS.get(payload.gesture()));
        if (player == client.player) STATE.start(payload.gesture(), gesture.lengthTicks(), ticks);
    }

    private static void tick(Minecraft client) {
        ticks++;
        KEYS.forEach((key, index) -> {
            while (key.consumeClick()) {
                if (client.level != null && client.player != null && client.player.isAlive() && !STATE.active() && ClientPlayNetworking.canSend(GestureMod.Play.ID))
                    ClientPlayNetworking.send(new GestureMod.Play(index));
            }
        });
        if (client.level == null) {
            forgetAll();
            return;
        }
        // Death, a respawn or a change of dimension ends a cast early; each of them shows on the player object itself.
        // A respawn and a change of dimension make a new player object, so the old one is forgotten once idle.
        CASTS.entrySet().removeIf(entry -> {
            boolean here = !entry.getKey().isRemoved() && entry.getKey().level() == client.level;
            return entry.getValue().tick(here && entry.getKey().isAlive()) && !here;
        });
        STATE.update(ticks, client.player != null && client.player.isAlive());
    }

    /** Leaving a world: every cast is dropped at once, with no fade, because nothing is left to draw it on. */
    private static void forgetAll() {
        STATE.stop();
        CASTS.values().forEach(GestureCast::drop);
        CASTS.clear();
    }
}
`,
    [`${root}/gesture/fabric/client/GestureAnimations.java`]: `package ${fabric}.client;

import ${core}.GestureData;
import dev.kosmx.playerAnim.core.data.AnimationFormat;
import dev.kosmx.playerAnim.core.data.KeyframeAnimation;
import dev.kosmx.playerAnim.core.data.KeyframeAnimation.AnimationBuilder;
import dev.kosmx.playerAnim.core.data.KeyframeAnimation.StateCollection;
import dev.kosmx.playerAnim.core.util.Ease;

/**
 * Turns a cast action from the data file into the animation library's own animation, once, when the mod
 * loads; playing it afterwards costs nothing per tick here. One linear key per game tick, exactly as the
 * file has it, instead of the few eased keys a person wrote: a leaning torso carries the head and arms, and
 * that carried motion is not an eased curve between the written keys, so the build resolves it and the
 * library only joins the dots. Touches nothing of the game, so a plain JVM can build and play one to check it.
 */
public final class GestureAnimations {
    private GestureAnimations() {}

    public static KeyframeAnimation build(GestureData.Gesture gesture) {
        var builder = new KeyframeAnimation.AnimationBuilder(AnimationFormat.UNKNOWN);
        // Tick 0 is the player's own pose; the library eases from it to the first key and, after the last, back to it.
        builder.beginTick = 1;
        builder.endTick = gesture.ticks();
        builder.stopTick = gesture.lengthTicks();
        builder.isLooped = false;
        builder.setName(gesture.id());
        gesture.parts().forEach((name, track) -> {
            var part = switch (name) {
                case "head" -> builder.head;
                case "torso" -> builder.torso;
                case "right_arm" -> builder.rightArm;
                case "left_arm" -> builder.leftArm;
                case "right_leg" -> builder.rightLeg;
                default -> builder.leftLeg;
            };
            if (track.rotation() != null) {
                keys(part.pitch, track.rotation(), 0, true);
                keys(part.yaw, track.rotation(), 1, true);
                keys(part.roll, track.rotation(), 2, true);
            }
            if (track.position() != null) {
                keys(part.x, track.position(), 0, false);
                keys(part.y, track.position(), 1, false);
                keys(part.z, track.position(), 2, false);
            }
        });
        return builder.build();
    }

    private static void keys(KeyframeAnimation.StateCollection.State state, float[][] frames, int axis, boolean angle) {
        state.setEnabled(true);
        for (int tick = 0; tick < frames.length; tick++) {
            // A position in the file is an offset; the library wants the pivot itself.
            float value = angle ? (float) Math.toRadians(frames[tick][axis]) : state.defaultValue + frames[tick][axis];
            // The curve on the last key shapes the stretch after it: the return to the player's own pose.
            state.addKeyFrame(tick + 1, value, tick == frames.length - 1 ? Ease.INOUTSINE : Ease.LINEAR);
        }
    }
}
`,
    [`${root}/gesture/fabric/client/GestureCast.java`]: `package ${fabric}.client;

import ${core}.GestureData;
import ${core}.GestureRuntime;
import dev.kosmx.playerAnim.api.firstPerson.FirstPersonConfiguration;
import dev.kosmx.playerAnim.api.firstPerson.FirstPersonMode;
import dev.kosmx.playerAnim.api.layered.IAnimation;
import dev.kosmx.playerAnim.api.layered.KeyframeAnimationPlayer;
import dev.kosmx.playerAnim.api.layered.ModifierLayer;
import dev.kosmx.playerAnim.api.layered.modifier.AbstractFadeModifier;
import dev.kosmx.playerAnim.api.layered.modifier.MirrorModifier;
import dev.kosmx.playerAnim.core.data.KeyframeAnimation;
import dev.kosmx.playerAnim.core.util.Ease;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.world.entity.HumanoidArm;

/** One player's cast layer: the animation slot, the aim that follows their look, and the mirror for left-handed players. */
final class GestureCast {
    private final AbstractClientPlayer player;
    private final ModifierLayer<IAnimation> layer = new ModifierLayer<>();
    private final GestureAimModifier aim;
    private final MirrorModifier mirror = new MirrorModifier(false);
    // The action now playing, or null. Its own tick count decides when it is over, so a paused game cannot desynchronise the two.
    private KeyframeAnimationPlayer current;

    GestureCast(AbstractClientPlayer player) {
        this.player = player;
        this.aim = new GestureAimModifier(player);
        // The aim is added outside the mirror: where the player looks must not be flipped with the motion.
        layer.addModifier(aim, 0);
        layer.addModifierLast(mirror);
    }

    ModifierLayer<IAnimation> layer() {
        return layer;
    }

    void play(GestureData.Gesture gesture, KeyframeAnimation animation) {
        var playing = new KeyframeAnimationPlayer(animation);
        // The player's own skinned arms (and what they hold) do the motion in first person; nothing is drawn in their place.
        if (gesture.showArms() || gesture.showItems()) {
            playing.setFirstPersonMode(FirstPersonMode.THIRD_PERSON_MODEL);
            playing.setFirstPersonConfiguration(new FirstPersonConfiguration(gesture.showArms(), gesture.showArms(), gesture.showItems(), gesture.showItems()));
        }
        if (!gesture.showArms() && !gesture.showItems()) playing.setFirstPersonMode(FirstPersonMode.DISABLED);
        boolean mirrored = gesture.mirrorForLeftHanded() && player.getMainArm() == HumanoidArm.LEFT;
        mirror.setEnabled(mirrored);
        // Only an arm the action itself turns follows the look; mirrored, the action's right arm is drawn on the left.
        aim.follow(playing, gesture.aim() && gesture.turns(mirrored ? "left_arm" : "right_arm"), gesture.aim() && gesture.turns(mirrored ? "right_arm" : "left_arm"), gesture.turns("head"));
        layer.replaceAnimationWithFade(AbstractFadeModifier.standardFadeIn(GestureRuntime.FADE_IN_TICKS, Ease.INOUTSINE), playing, true);
        current = playing;
    }

    /** Once a client tick. An owner who died or left has the action blended out instead of cut. True when nothing is playing afterwards. */
    boolean tick(boolean ownerPresent) {
        if (current != null && current.isActive() && ownerPresent) return false;
        if (current != null && current.isActive()) {
            layer.replaceAnimationWithFade(AbstractFadeModifier.standardFadeIn(GestureRuntime.CANCEL_TICKS, Ease.INOUTSINE), null, false);
            aim.fadeOut(GestureRuntime.CANCEL_TICKS);
        }
        current = null;
        return true;
    }

    void drop() {
        current = null;
        layer.setAnimation(null);
    }
}
`,
    [`${root}/gesture/fabric/client/GestureAimModifier.java`]: `package ${fabric}.client;

import ${core}.GestureAim;
import ${core}.GestureRuntime;
import dev.kosmx.playerAnim.api.TransformType;
import dev.kosmx.playerAnim.api.layered.KeyframeAnimationPlayer;
import dev.kosmx.playerAnim.api.layered.modifier.AdjustmentModifier;
import dev.kosmx.playerAnim.core.util.Vec3f;
import java.util.Optional;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.util.Mth;

/**
 * Adds the player's look to a cast action. The arms the action turns take a share of it so a cast points
 * where the player aims; a head the action turns gets all of it, because the action's head angles are
 * offsets from the look.
 */
final class GestureAimModifier extends AdjustmentModifier {
    private final AbstractClientPlayer player;
    private KeyframeAnimationPlayer playing;
    private boolean rightArm;
    private boolean leftArm;
    private boolean head;
    // The partial tick of the frame being drawn; the library hands it to get3DTransform but not to the source.
    private float delta;

    GestureAimModifier(AbstractClientPlayer player) {
        super(part -> Optional.empty());
        this.player = player;
        this.source = this::adjust;
    }

    void follow(KeyframeAnimationPlayer playing, boolean rightArm, boolean leftArm, boolean head) {
        this.playing = playing;
        this.rightArm = rightArm;
        this.leftArm = leftArm;
        this.head = head;
    }

    @Override public Vec3f get3DTransform(String modelName, TransformType type, float tickDelta, Vec3f value0) {
        delta = tickDelta;
        return super.get3DTransform(modelName, type, tickDelta, value0);
    }

    // The library fades an adjustment by itself only when the animation sits directly under it. Here the
    // mirror and the fade sit in between, so both fades are worked out from the playing animation: without
    // them the arms would snap by the look angle on the action's first and last frame.
    @Override protected float getFadeIn(float tickDelta) {
        return playing == null ? 1 : GestureAim.fade((playing.getTick() + tickDelta) / GestureRuntime.FADE_IN_TICKS);
    }

    // Eases out over the same ticks, along the same curve, as the library's own return to the player's pose.
    @Override protected float getFadeOut(float tickDelta) {
        return playing == null ? super.getFadeOut(tickDelta)
            : Math.min(super.getFadeOut(tickDelta), GestureAim.fade((playing.getData().stopTick - playing.getTick() - tickDelta) / GestureRuntime.RECOVER_TICKS));
    }

    private Optional<PartModifier> adjust(String part) {
        float pitch = player.getViewXRot(delta);
        float yaw = Mth.rotLerp(delta, player.yHeadRotO - player.yBodyRotO, player.yHeadRot - player.yBodyRot);
        if (part.equals("head") && head)
            return Optional.of(new PartModifier(new Vec3f((float) Math.toRadians(GestureAim.wrap(pitch)), (float) Math.toRadians(GestureAim.wrap(yaw)), 0), Vec3f.ZERO));
        if (!(part.equals("rightArm") && rightArm) && !(part.equals("leftArm") && leftArm)) return Optional.empty();
        if (getAnim() == null) return Optional.empty();
        float turnedPitch = GestureAim.share(pitch);
        float turnedYaw = GestureAim.share(yaw);
        // Where the action has put this shoulder, measured from the neck, so the swing carries what the action did.
        Vec3f shoulder = getAnim().get3DTransform(part, TransformType.POSITION, delta, new Vec3f(part.equals("rightArm") ? -5 : 5, 2, 0));
        float[] swing = GestureAim.swing(shoulder.getX(), shoulder.getY(), shoulder.getZ(), turnedPitch, turnedYaw);
        return Optional.of(new PartModifier(new Vec3f(turnedPitch, turnedYaw, 0), new Vec3f(swing[0], swing[1], swing[2])));
    }
}
`,
  }
}

/** Where the loader's part of the runtime lives on Forge and NeoForge, and the two classes the facade's entries run (D 组). */
export const GESTURE_FACADE = { package: "gesture.platform", common: "GestureMod", client: "client.GestureClient" } as const

/**
 * The cast-action runtime on Forge and NeoForge (D 组): `core` and the animation library's part (the three client classes that only
 * use playerAnimator's API, whose packages and classes are the same on every loader) as on Fabric, in a package of their own; the
 * loader's part written again against the generated facade: the two packets (`StudioPlatform.c2s` / `s2c`), the keys
 * (`StudioClientPlatform.keyMapping`), the client tick. `GestureMod.register()` is run by the common entry while the mod is
 * constructed and `GestureClient.register()` by the client entry. `rewrite`: the game version's last pass (`VersionAdapter.rewriteJava`).
 */
export function gestureFacadeSources(packageName: string, modId: string, rewrite: (source: string) => string): Record<string, string> {
  const fabricSources = gestureRuntimeSources(packageName, modId)
  const root = `src/main/java/${packageName.replaceAll(".", "/")}`
  const core = `${packageName}.gesture.core`
  const fabric = `${packageName}.gesture.fabric`
  const platform = `${packageName}.${GESTURE_FACADE.package}`
  const moved = Object.fromEntries(
    Object.entries(fabricSources).flatMap(([name, text]) => {
      if (name.includes("/gesture/core/")) return [[name, text]]
      if (!/\/gesture\/fabric\/client\/Gesture(Animations|Cast|AimModifier)\.java$/.test(name)) return []
      return [[name.replace("/gesture/fabric/", "/gesture/platform/"), text.replaceAll(`package ${fabric}.client;`, `package ${platform}.client;`).replaceAll(`import ${fabric}.`, `import ${platform}.`)]]
    }),
  )
  const files: Record<string, string> = {
    ...moved,
    [`${root}/gesture/platform/GestureMod.java`]: `package ${platform};

import ${core}.GestureCooldown;
import ${core}.GestureData;
import ${core}.GestureRuntime;
import ${packageName}.platform.StudioPlatform;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Shared by client and server on Forge and NeoForge: the two packets, through the facade, and the server's checks. */
public final class GestureMod {
    public static final String MOD_ID = "${modId}";
    public static final Logger LOG = LoggerFactory.getLogger(MOD_ID + "/gesture");
    public static final GestureData DATA = GestureData.load(GestureMod.class, "/data/" + MOD_ID + "/studio/gestures.json",
        message -> LOG.warn("Cast-action runtime: {}", message));
    /** Blocks within which other players are told about a cast action. */
    private static final double RANGE = 64;
    private static final GestureCooldown COOLDOWN = new GestureCooldown();

    /** Client asks to play one of its own cast actions. The sender is whoever the connection belongs to, never a field. */
    public record Play(int gesture) {
        static void write(Play play, FriendlyByteBuf buffer) { buffer.writeVarInt(play.gesture()); }

        static Play read(FriendlyByteBuf buffer) { return new Play(buffer.readVarInt()); }
    }

    /** Server tells nearby clients which player plays which cast action. */
    public record Show(int playerId, int gesture) {
        static void write(Show show, FriendlyByteBuf buffer) {
            buffer.writeVarInt(show.playerId());
            buffer.writeVarInt(show.gesture());
        }

        static Show read(FriendlyByteBuf buffer) { return new Show(buffer.readVarInt(), buffer.readVarInt()); }
    }

    public static final StudioPlatform.Channel<Play> PLAY = StudioPlatform.c2s("gesture_play", Play.class, Play::write, Play::read, GestureMod::play);
    public static final StudioPlatform.Channel<Show> SHOW = StudioPlatform.s2c("gesture_show", Show.class, Show::write, Show::read);

    private GestureMod() {}

    /** Run by the common entry while the mod is constructed: the packets above are made as the class loads. */
    public static void register() {
        LOG.info("Cast-action runtime {} (data format {}): {} loaded, {} skipped", GestureRuntime.VERSION, GestureRuntime.FORMAT,
            DATA.loaded(), DATA.size() - DATA.loaded());
        // Cooldowns count in the ticks of one server: a new one (another world in the same game) starts with none.
        StudioPlatform.onServerStarted(server -> COOLDOWN.clear());
    }

    private static void play(ServerPlayer player, Play payload) {
        var gesture = DATA.get(payload.gesture());
        if (gesture == null || player.isRemoved() || !player.isAlive() || player.isSpectator() || player.getServer() == null) return;
        if (!COOLDOWN.accept(player.getUUID(), gesture.lengthTicks(), player.getServer().getTickCount())) return;
        SHOW.sendNear(player.serverLevel(), player.getX(), player.getY(), player.getZ(), RANGE, new Show(player.getId(), payload.gesture()));
    }
}
`,
    [`${root}/gesture/platform/client/GestureClient.java`]: `package ${platform}.client;

import ${core}.GestureState;
import ${platform}.GestureMod;
import ${packageName}.platform.StudioClientPlatform;
import com.mojang.blaze3d.platform.InputConstants;
import dev.kosmx.playerAnim.core.data.KeyframeAnimation;
import dev.kosmx.playerAnim.minecraftApi.PlayerAnimationFactory;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.resources.ResourceLocation;
import org.lwjgl.glfw.GLFW;

/**
 * The player's game on Forge and NeoForge: key bindings and playing a cast action on whichever player the server names, as on Fabric,
 * through the facade. Run once by the client entry when the game sets up.
 */
public final class GestureClient {
    private static final ResourceLocation LAYER = ResourceLocation.fromNamespaceAndPath(GestureMod.MOD_ID, "gesture");
    private static final GestureState STATE = new GestureState();
    private static final Map<KeyMapping, Integer> KEYS = new LinkedHashMap<>();
    // Built once from the data file; entry i is the animation of cast action i, null where that action was skipped.
    private static final List<KeyframeAnimation> ANIMATIONS = new ArrayList<>();
    // One cast layer per player the client knows, made by the animation library when the player appears and
    // dropped in tick() once that player is gone. A cast holds its player, so a weak map would never let go.
    private static final Map<AbstractClientPlayer, GestureCast> CASTS = new HashMap<>();
    // Own counter rather than world time: world time can be frozen by a command, and a cast must never get stuck.
    private static long ticks;

    private GestureClient() {}

    public static void register() {
        PlayerAnimationFactory.ANIMATION_DATA_FACTORY.registerFactory(LAYER, 1000, player -> {
            var cast = new GestureCast(player);
            CASTS.put(player, cast);
            return cast.layer();
        });
        for (int index = 0; index < GestureMod.DATA.size(); index++) {
            var gesture = GestureMod.DATA.get(index);
            ANIMATIONS.add(gesture == null ? null : GestureAnimations.build(gesture));
            if (gesture == null) continue;
            var key = new KeyMapping("key." + GestureMod.MOD_ID + ".gesture." + gesture.key(),
                InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_A + gesture.key().charAt(0) - 'a', "category." + GestureMod.MOD_ID + ".gestures");
            StudioClientPlatform.keyMapping(key);
            KEYS.put(key, index);
        }
        StudioClientPlatform.onS2C(GestureMod.SHOW, GestureClient::show);
        StudioClientPlatform.onClientTick(GestureClient::tick);
    }

    private static void show(GestureMod.Show payload) {
        var client = Minecraft.getInstance();
        var gesture = GestureMod.DATA.get(payload.gesture());
        if (gesture == null || client.level == null) return;
        if (!(client.level.getEntity(payload.playerId()) instanceof AbstractClientPlayer player) || !player.isAlive()) return;
        var cast = CASTS.get(player);
        if (cast == null) return;
        cast.play(gesture, ANIMATIONS.get(payload.gesture()));
        if (player == client.player) STATE.start(payload.gesture(), gesture.lengthTicks(), ticks);
    }

    private static void tick() {
        var client = Minecraft.getInstance();
        ticks++;
        KEYS.forEach((key, index) -> {
            while (key.consumeClick()) {
                if (client.level != null && client.player != null && client.player.isAlive() && !STATE.active() && client.getConnection() != null)
                    StudioClientPlatform.sendToServer(GestureMod.PLAY, new GestureMod.Play(index));
            }
        });
        // Leaving a world shows as no world here: every cast is dropped at once (Fabric has a disconnect event for it).
        if (client.level == null) {
            forgetAll();
            return;
        }
        // Death, a respawn or a change of dimension ends a cast early; each of them shows on the player object itself.
        // A respawn and a change of dimension make a new player object, so the old one is forgotten once idle.
        CASTS.entrySet().removeIf(entry -> {
            boolean here = !entry.getKey().isRemoved() && entry.getKey().level() == client.level;
            return entry.getValue().tick(here && entry.getKey().isAlive()) && !here;
        });
        STATE.update(ticks, client.player != null && client.player.isAlive());
    }

    /** Leaving a world: every cast is dropped at once, with no fade, because nothing is left to draw it on. */
    private static void forgetAll() {
        STATE.stop();
        CASTS.values().forEach(GestureCast::drop);
        CASTS.clear();
    }
}
`,
  }
  return Object.fromEntries(Object.entries(files).map(([name, text]) => [name, rewrite(text)]))
}
