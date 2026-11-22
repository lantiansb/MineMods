import { z } from "zod"
import { BREAK_LIMITS, DEBRIS_LIMITS, SHAKE_LIMITS } from "../boss-words"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * What the two ability events that make a fight felt add to a generated mod (boss runtime, 10-12): a package that shakes a player's screen
 * and the pieces of the ground a creature throws up. Only written when some creature of the project has such an event, so a project
 * without any is untouched; each half is written only when it is needed.
 *
 * Shaking the screen takes four things, and nothing of the game's own is replaced:
 * - a packet (`StudioShake.Shake`, a `CustomPacketPayload` with a `StreamCodec`) registered for the server-to-client direction and sent to every player in range;
 * - a receiver in the player's game that keeps the shakes that are still running (`StudioShakeClient`);
 * - one mixin into the camera (`StudioShakeCameraMixin`, `@Inject` at the tail of `Camera.setup`, moving the camera with the camera's own `move`);
 * - the entries in fabric.mod.json and in the mixin list (`<mod id>.mixins.json`, which the template already carries, empty) that make the game load them.
 * The strength is weakened with the distance and by the player's own "screen effects" setting (`screenEffectScale`: 0 does not shake at all).
 *
 * The pieces of the ground are display entities of the game's own kind (`Display.BlockDisplay`, which a player's game already knows how to draw), moved by
 * the server every tick and gone after 8 to 20 ticks. Nothing is placed, nothing is dropped, nothing is saved: a piece only looks like a piece of the
 * ground and the world's blocks are not touched. The game's setters for a display's block and size are private, so a piece is a server-side subclass that
 * hands the game the data its own save format has (`readAdditionalSaveData` with `block_state` and `transformation`); to a player's game it is a plain block display.
 *
 * Every Minecraft, Fabric and Mixin name used here is Mojang's own (Fabric Loom's official mappings), read with javap from the 1.21.1 jar, Fabric API and Mixin.
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  /** Some ability shakes a screen. */
  shake: z.boolean(),
  /** Some ability throws up the ground. */
  debris: z.boolean(),
  /** Some ability breaks blocks of the world (`break`). Left out or false: nothing of it is written, so every other project is what it was. */
  breaks: z.boolean().default(false),
  dashBreaks: z.boolean().default(false),
  /**
   * Boss 能力 8: some shake of the project goes past what a shake could be before (`shakeExtended`): the shake is written with roll, a change of the field of view, its falloff
   * and its frequency, capped at the new cap. Left out or false: the shake exactly as it always was.
   */
  shakeMore: z.boolean().default(false),
  quietBreak:z.boolean().default(false),
  debrisLook: z.boolean().default(false),
  debrisThrow: z.boolean().default(false),
  camera: z.boolean().default(false),
})

/** The classes the creatures reach the boss runtime through, and the id of the packet. `view`: Fabric's mixin into the game renderer's field of view (Boss 能力 8). */
export const BOSS_RUNTIME = { shake: "StudioShake", shakeClient: "StudioShakeClient", mixin: "StudioShakeCameraMixin", view: "StudioShakeViewMixin", debris: "StudioDebris", breaks: "StudioBreak", packet: "studio_shake" } as const

/**
 * Boss 能力 8: the statement an ability runs at a shake's moment. A shake written as before calls the creature's `abilityShake(strength, radius, ticks)`, to the byte what it
 * always was; one with roll, a change of view, its falloff or its frequency calls the longer one (`abilityShakeMore`, `SHAKE_MORE_METHOD`).
 */
export function shakeStatement(value: { strength: number; radius: number; seconds: number; roll?: number | undefined; fov?: number | undefined; falloff?: "none" | "linear" | undefined; frequency?: number | undefined }, ticks: number) {
  // The creature's class writes its numbers so (`fabric/entity-abilities.ts`): 2.0f, 0.75f.
  const float = (number: number) => `${Number.isInteger(number) ? number.toFixed(1) : String(Number(number.toFixed(4)))}f`
  const base = `${float(value.strength)}, ${float(value.radius)}, ${ticks}`
  if (value.roll === undefined && value.fov === undefined && value.falloff === undefined && value.frequency === undefined) return `abilityShake(${base});`
  return `abilityShakeMore(${base}, ${float(value.roll ?? 0)}, ${float(value.fov ?? 0)}, ${value.falloff !== "none"}, ${float(value.frequency ?? 1)});`
}

/** Boss 能力 8: the creature's method its longer shakes call (`shakeStatement`), written beside `abilityShake` only when some shake of it needs it. */
export const SHAKE_MORE_METHOD = `    /** Boss 能力 8: a shake that turns the view (\`roll\`), changes the field of view (\`fov\`), is as strong anywhere in its radius (\`linear\` false) or shakes at its own speed. */
    private void abilityShakeMore(float strength, float radius, int ticks, float roll, float fov, boolean linear, float frequency) {
        if (level() instanceof ServerLevel world) ${BOSS_RUNTIME.shake}.send(world, position(), strength, radius, ticks, roll, fov, linear, frequency);
    }

`

const single = (value: number) => `${Number(value.toFixed(4))}f`

function shakeSource(packageName: string, modId: string) {
  return {
    server: `package ${packageName}.entity;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;

/** Generated by MineMods Studio: the packet that shakes a player's screen, and the server's side of sending it. */
public final class ${BOSS_RUNTIME.shake} implements ModInitializer {
    /** A shake: where it is centred, how strong it is at the centre, how far it reaches (blocks) and how long it lasts (ticks). Each game weakens it with distance. */
    public record Shake(double x, double y, double z, float strength, float radius, int ticks) implements CustomPacketPayload {
        public static final Type<Shake> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(${JSON.stringify(modId)}, ${JSON.stringify(BOSS_RUNTIME.packet)}));
        public static final StreamCodec<RegistryFriendlyByteBuf, Shake> CODEC = StreamCodec.composite(
            ByteBufCodecs.DOUBLE, Shake::x, ByteBufCodecs.DOUBLE, Shake::y, ByteBufCodecs.DOUBLE, Shake::z,
            ByteBufCodecs.FLOAT, Shake::strength, ByteBufCodecs.FLOAT, Shake::radius, ByteBufCodecs.VAR_INT, Shake::ticks, Shake::new);
        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
    }

    @Override public void onInitialize() {
        // Both sides know the packet; only the server sends it and only a player's game reads it.
        PayloadTypeRegistry.playS2C().register(Shake.ID, Shake.CODEC);
    }

    /** Tells every player within \`radius\` blocks of \`at\` to shake. A player whose game does not have this mod is skipped: the game would refuse the packet. */
    public static void send(ServerLevel world, Vec3 at, float strength, float radius, int ticks) {
        Shake shake = new Shake(at.x, at.y, at.z, strength, radius, ticks);
        for (ServerPlayer player : world.players()) {
            if (player.distanceToSqr(at) <= (double) radius * radius && ServerPlayNetworking.canSend(player, Shake.ID)) ServerPlayNetworking.send(player, shake);
        }
    }
}
`,
    client: `package ${packageName}.client;

import ${packageName}.entity.${BOSS_RUNTIME.shake};
import java.util.ArrayList;
import java.util.List;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;

/**
 * Generated by MineMods Studio: the shakes running in this player's game, and the offset they give the camera. The camera mixin
 * (${BOSS_RUNTIME.mixin}) asks for it once a frame. A shake is strongest at its centre and at its start, weakens linearly with the distance to its
 * radius and with the time to its end, is added to the others (never beyond ${SHAKE_LIMITS.legacyCap}) and is multiplied by the player's "screen effects"
 * setting, so 0 does not shake at all. Time is the world's own (it stops when the game is paused).
 */
public final class ${BOSS_RUNTIME.shakeClient} implements ClientModInitializer {
    private record Running(Vec3 at, float strength, float radius, double start, int ticks) {}

    /** The most shakes kept at once: a boss cannot make more than a few a second, and the oldest give way. */
    private static final int MOST = 16;
    private static final List<Running> RUNNING = new ArrayList<>();

    @Override public void onInitializeClient() {
        ClientPlayNetworking.registerGlobalReceiver(${BOSS_RUNTIME.shake}.Shake.ID, (payload, context) -> context.client().execute(() -> {
            if (context.client().level == null) return;
            if (RUNNING.size() >= MOST) RUNNING.remove(0);
            RUNNING.add(new Running(new Vec3(payload.x(), payload.y(), payload.z()), payload.strength(), payload.radius(), context.client().level.getGameTime(), payload.ticks()));
        }));
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> RUNNING.clear());
    }

    /** How far the camera is moved this frame, as {ahead, up, left} in blocks, or null when nothing shakes it. */
    public static float[] offset(float tickDelta) {
        Minecraft client = Minecraft.getInstance();
        if (RUNNING.isEmpty() || client.level == null || client.player == null) return null;
        double scale = client.options.screenEffectScale().get();
        double now = client.level.getGameTime() + tickDelta;
        RUNNING.removeIf(running -> now - running.start() >= running.ticks());
        if (scale <= 0.0 || RUNNING.isEmpty()) return null;
        Vec3 eyes = client.player.getEyePosition();
        double sum = 0.0;
        for (Running running : RUNNING) {
            double near = Math.max(0.0, 1.0 - eyes.distanceTo(running.at()) / running.radius());
            double left = Math.max(0.0, 1.0 - (now - running.start()) / running.ticks());
            sum += running.strength() * near * left;
        }
        double amount = Math.min(sum, ${SHAKE_LIMITS.legacyCap}.0) * scale;
        if (amount < 0.001) return null;
        // Two slow waves of different speed in each direction: a rumble, not the flicker a different random number every frame would be.
        return new float[] {
            (float) (amount * 0.04 * (Mth.sin((float) (now * 2.9 + 0.7)) * 0.6 + Mth.sin((float) (now * 6.3)) * 0.4)),
            (float) (amount * 0.09 * (Mth.sin((float) (now * 2.3 + 1.9)) * 0.6 + Mth.sin((float) (now * 5.1 + 0.4)) * 0.4)),
            (float) (amount * 0.09 * (Mth.sin((float) (now * 2.7 + 3.1)) * 0.6 + Mth.sin((float) (now * 5.7 + 2.2)) * 0.4)),
        };
    }
}
`,
    mixin: `package ${packageName}.mixin;

import ${packageName}.client.${BOSS_RUNTIME.shakeClient};
import net.minecraft.client.Camera;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.BlockGetter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Generated by MineMods Studio: moves the camera a little while a boss shakes the player's screen. It runs at the tail of the camera's own update, after
 * the game has put the camera where the player's eyes are, and moves it with the camera's own method; only what is drawn moves, never the player.
 */
@Mixin(Camera.class)
public abstract class ${BOSS_RUNTIME.mixin} {
    @Shadow protected abstract void move(float ahead, float up, float left);

    @Inject(method = "setup", at = @At("TAIL"))
    private void studio$shake(BlockGetter area, Entity focusedEntity, boolean thirdPerson, boolean inverseView, float tickDelta, CallbackInfo info) {
        float[] shake = ${BOSS_RUNTIME.shakeClient}.offset(tickDelta);
        if (shake != null) move(shake[0], shake[1], shake[2]);
    }
}
`,
  }
}

/**
 * The screen shake for a facade target (Forge, NeoForge): the same shake, its packet a plain record sent on a channel of the facade
 * (`StudioPlatform.s2c`, made while the mod is constructed by `StudioShake.register()`) and received through `StudioClientPlatform.onS2C`
 * (`StudioShakeClient.register()`, run by the client entry). Nothing names a loader. The facade sends only to players near the centre;
 * on Forge and NeoForge a player's game without this mod cannot join, so none is skipped. Shakes of a world the player has left are
 * dropped when the world the player is in is another (Fabric clears them on its disconnect event, which the facade does not have).
 * The camera mixin shadows `Camera.move` with the version's parameter type (`VersionAdapter.boss.cameraMove`).
 */
function shakeFacadeSource(packageName: string, target: GenTarget) {
  const camera = target.version.boss.cameraMove
  return {
    server: `package ${packageName}.entity;

import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;

/** Generated by MineMods Studio: the packet that shakes a player's screen, and the server's side of sending it. */
public final class ${BOSS_RUNTIME.shake} {
    /** A shake: where it is centred, how strong it is at the centre, how far it reaches (blocks) and how long it lasts (ticks). Each game weakens it with distance. */
    public record Shake(double x, double y, double z, float strength, float radius, int ticks) {
        static void write(Shake shake, FriendlyByteBuf buffer) {
            buffer.writeDouble(shake.x);
            buffer.writeDouble(shake.y);
            buffer.writeDouble(shake.z);
            buffer.writeFloat(shake.strength);
            buffer.writeFloat(shake.radius);
            buffer.writeVarInt(shake.ticks);
        }

        static Shake read(FriendlyByteBuf buffer) {
            return new Shake(buffer.readDouble(), buffer.readDouble(), buffer.readDouble(), buffer.readFloat(), buffer.readFloat(), buffer.readVarInt());
        }
    }

    /** Both sides know the packet; only the server sends it and only a player's game reads it. */
    public static final ${PLATFORM_CLASS}.Channel<Shake> CHANNEL = ${PLATFORM_CLASS}.s2c(${JSON.stringify(BOSS_RUNTIME.packet)}, Shake.class, Shake::write, Shake::read);

    /** Makes the channel while the mod is constructed (its field above), which is when the loader takes it. */
    public static void register() {}

    /** Tells every player within \`radius\` blocks of \`at\` to shake. */
    public static void send(ServerLevel world, Vec3 at, float strength, float radius, int ticks) {
        CHANNEL.sendNear(world, at.x, at.y, at.z, radius, new Shake(at.x, at.y, at.z, strength, radius, ticks));
    }
}
`,
    client: `package ${packageName}.client;

import ${packageName}.entity.${BOSS_RUNTIME.shake};
import ${packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;

/**
 * Generated by MineMods Studio: the shakes running in this player's game, and the offset they give the camera. The camera mixin
 * (${BOSS_RUNTIME.mixin}) asks for it once a frame. A shake is strongest at its centre and at its start, weakens linearly with the distance to its
 * radius and with the time to its end, is added to the others (never beyond ${SHAKE_LIMITS.legacyCap}) and is multiplied by the player's "screen effects"
 * setting, so 0 does not shake at all. Time is the world's own (it stops when the game is paused).
 */
public final class ${BOSS_RUNTIME.shakeClient} {
    private record Running(Vec3 at, float strength, float radius, double start, int ticks) {}

    /** The most shakes kept at once: a boss cannot make more than a few a second, and the oldest give way. */
    private static final int MOST = 16;
    private static final List<Running> RUNNING = new ArrayList<>();
    /** The world the running shakes were started in: in another one (the player left, or changed dimension) they are over. */
    private static ClientLevel world;

    /** Run once by the client entry: what this player's game does with a shake. */
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.onS2C(${BOSS_RUNTIME.shake}.CHANNEL, payload -> {
            Minecraft client = Minecraft.getInstance();
            if (client.level == null) return;
            if (client.level != world) {
                RUNNING.clear();
                world = client.level;
            }
            if (RUNNING.size() >= MOST) RUNNING.remove(0);
            RUNNING.add(new Running(new Vec3(payload.x(), payload.y(), payload.z()), payload.strength(), payload.radius(), client.level.getGameTime(), payload.ticks()));
        });
    }

    /** How far the camera is moved this frame, as {ahead, up, left} in blocks, or null when nothing shakes it. */
    public static float[] offset(float tickDelta) {
        Minecraft client = Minecraft.getInstance();
        if (RUNNING.isEmpty() || client.level == null || client.player == null) return null;
        if (client.level != world) {
            RUNNING.clear();
            return null;
        }
        double scale = client.options.screenEffectScale().get();
        double now = client.level.getGameTime() + tickDelta;
        RUNNING.removeIf(running -> now - running.start() >= running.ticks());
        if (scale <= 0.0 || RUNNING.isEmpty()) return null;
        Vec3 eyes = client.player.getEyePosition();
        double sum = 0.0;
        for (Running running : RUNNING) {
            double near = Math.max(0.0, 1.0 - eyes.distanceTo(running.at()) / running.radius());
            double left = Math.max(0.0, 1.0 - (now - running.start()) / running.ticks());
            sum += running.strength() * near * left;
        }
        double amount = Math.min(sum, ${SHAKE_LIMITS.legacyCap}.0) * scale;
        if (amount < 0.001) return null;
        // Two slow waves of different speed in each direction: a rumble, not the flicker a different random number every frame would be.
        return new float[] {
            (float) (amount * 0.04 * (Mth.sin((float) (now * 2.9 + 0.7)) * 0.6 + Mth.sin((float) (now * 6.3)) * 0.4)),
            (float) (amount * 0.09 * (Mth.sin((float) (now * 2.3 + 1.9)) * 0.6 + Mth.sin((float) (now * 5.1 + 0.4)) * 0.4)),
            (float) (amount * 0.09 * (Mth.sin((float) (now * 2.7 + 3.1)) * 0.6 + Mth.sin((float) (now * 5.7 + 2.2)) * 0.4)),
        };
    }
}
`,
    mixin: `package ${packageName}.mixin;

import ${packageName}.client.${BOSS_RUNTIME.shakeClient};
import net.minecraft.client.Camera;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.BlockGetter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Generated by MineMods Studio: moves the camera a little while a boss shakes the player's screen. It runs at the tail of the camera's own update, after
 * the game has put the camera where the player's eyes are, and moves it with the camera's own method; only what is drawn moves, never the player.
 */
@Mixin(Camera.class)
public abstract class ${BOSS_RUNTIME.mixin} {
    @Shadow protected abstract void move(${camera} ahead, ${camera} up, ${camera} left);

    @Inject(method = "setup", at = @At("TAIL"))
    private void studio$shake(BlockGetter area, Entity focusedEntity, boolean thirdPerson, boolean inverseView, float tickDelta, CallbackInfo info) {
        float[] shake = ${BOSS_RUNTIME.shakeClient}.offset(tickDelta);
        if (shake != null) move(shake[0], shake[1], shake[2]);
    }
}
`,
  }
}

/**
 * Boss 能力 8: the running shakes and what they do to this frame, the same on every loader. A shake is strongest at its centre and at its start; it weakens linearly
 * with the distance to its radius (`linear`) or is as strong anywhere inside it, and linearly with the time to its end. The camera is moved by the sum of what reaches
 * the player, each shake waving at its own frequency, the sum never beyond ${SHAKE_LIMITS.cap}; it is turned about the line of sight (`roll`, degrees, at most
 * ${SHAKE_LIMITS.roll.max} either way) and the field of view is widened or narrowed (`fov`, degrees, at most ${SHAKE_LIMITS.fov.max} either way). The move and the turn are
 * multiplied by the player's "screen effects" setting, the change of view by the "FOV effects" one: 0 does nothing. `world`: whether a shake of another world is dropped here (the facade).
 */
function shakeMoreMath(world: boolean) {
  // What every one of the three asks first: a player in a world with shakes running (`none` is what it answers otherwise), the time, and the player's eyes.
  const of = (none: string) => `        Minecraft client = Minecraft.getInstance();
        if (RUNNING.isEmpty() || client.level == null || client.player == null) return ${none};
${world ? `        if (client.level != world) {
            RUNNING.clear();
            return ${none};
        }
` : ""}        double now = client.level.getGameTime() + tickDelta;
        RUNNING.removeIf(running -> now - running.start() >= running.ticks());
        if (RUNNING.isEmpty()) return ${none};
        Vec3 eyes = client.player.getEyePosition();
`
  return `    /** How much of a running shake reaches the player's eyes now: all of it at its centre and its start, less with the distance (unless it is as strong anywhere in its radius) and with the time. */
    private static double reach(Running running, Vec3 eyes, double now) {
        double distance = eyes.distanceTo(running.at());
        double near = running.linear() ? Math.max(0.0, 1.0 - distance / running.radius()) : (distance <= running.radius() ? 1.0 : 0.0);
        return near * Math.max(0.0, 1.0 - (now - running.start()) / running.ticks());
    }

    /** How far the camera is moved this frame, as {ahead, up, left} in blocks, or null when nothing shakes it. */
    public static float[] offset(float tickDelta) {
${of("null")}        double scale = client.options.screenEffectScale().get();
        if (scale <= 0.0) return null;
        double sum = 0.0;
        double ahead = 0.0;
        double up = 0.0;
        double left = 0.0;
        for (Running running : RUNNING) {
            double amount = running.strength() * reach(running, eyes, now);
            if (amount <= 0.0) continue;
            // Two slow waves of different speed in each direction, at the shake's own frequency: a rumble, not the flicker a different random number every frame would be.
            double time = now * running.frequency();
            sum += amount;
            ahead += amount * (Mth.sin((float) (time * 2.9 + 0.7)) * 0.6 + Mth.sin((float) (time * 6.3)) * 0.4);
            up += amount * (Mth.sin((float) (time * 2.3 + 1.9)) * 0.6 + Mth.sin((float) (time * 5.1 + 0.4)) * 0.4);
            left += amount * (Mth.sin((float) (time * 2.7 + 3.1)) * 0.6 + Mth.sin((float) (time * 5.7 + 2.2)) * 0.4);
        }
        // Never more than CAP in all: past it every shake is scaled down alike.
        double kept = Math.min(1.0, CAP / Math.max(sum, 1.0E-6)) * scale;
        if (Math.min(sum, CAP) * scale < 0.001) return null;
        return new float[] {(float) (ahead * 0.04 * kept), (float) (up * 0.09 * kept), (float) (left * 0.09 * kept)};
    }

    /** Degrees the view is turned about the line of sight this frame (it swings both ways); 0 when nothing turns it. */
    public static float roll(float tickDelta) {
${of("0.0f")}        double scale = client.options.screenEffectScale().get();
        double total = 0.0;
        for (Running running : RUNNING) {
            if (running.roll() == 0.0f) continue;
            total += running.roll() * reach(running, eyes, now) * Mth.sin((float) (now * running.frequency() * 1.9 + 0.4));
        }
        return (float) (Mth.clamp(total, -ROLL, ROLL) * scale);
    }

    /** Degrees added to the field of view this frame (negative: narrowed); 0 when nothing changes it. */
    public static float fov(float tickDelta) {
${of("0.0f")}        double scale = client.options.fovEffectScale().get();
        double total = 0.0;
        for (Running running : RUNNING) total += running.fov() * reach(running, eyes, now);
        return (float) (Mth.clamp(total, -FOV, FOV) * scale);
    }
`
}

/** The fields every loader's running-shake list has (Boss 能力 8). */
const SHAKE_MORE_FIELDS = `    private record Running(Vec3 at, float strength, float radius, double start, int ticks, float roll, float fov, boolean linear, float frequency) {}

    /** The most shakes kept at once: a boss cannot make more than a few a second, and the oldest give way. */
    private static final int MOST = 16;
    /** The most the running shakes move the camera in all, turn it (degrees) and change the field of view (degrees). */
    private static final double CAP = ${SHAKE_LIMITS.cap}.0;
    private static final double ROLL = ${SHAKE_LIMITS.roll.max}.0;
    private static final double FOV = ${SHAKE_LIMITS.fov.max}.0;
    private static final List<Running> RUNNING = new ArrayList<>();
`

const SHAKE_MORE_RECORD = "public record Shake(double x, double y, double z, float strength, float radius, int ticks, float roll, float fov, boolean linear, float frequency)"
const SHAKE_MORE_WRITE = `            buffer.writeDouble(shake.x);
            buffer.writeDouble(shake.y);
            buffer.writeDouble(shake.z);
            buffer.writeFloat(shake.strength);
            buffer.writeFloat(shake.radius);
            buffer.writeVarInt(shake.ticks);
            buffer.writeFloat(shake.roll);
            buffer.writeFloat(shake.fov);
            buffer.writeBoolean(shake.linear);
            buffer.writeFloat(shake.frequency);`
const SHAKE_MORE_READ = "new Shake(buffer.readDouble(), buffer.readDouble(), buffer.readDouble(), buffer.readFloat(), buffer.readFloat(), buffer.readVarInt(), buffer.readFloat(), buffer.readFloat(), buffer.readBoolean(), buffer.readFloat())"
const SHAKE_MORE_SEND_DOC = `    /** Tells every player within \`radius\` blocks of \`at\` to shake, as a shake has always been: no roll, no change of view, weaker with distance, at its own speed. */`
const SHAKE_MORE_SEND = `    /**
     * Tells every player within \`radius\` blocks of \`at\` to shake: \`roll\` and \`fov\` in degrees at its centre and start, \`linear\` false for a shake as strong anywhere in its radius,
     * \`frequency\` against the shake as it always was (1).
     */`
const SHAKE_MORE_ADDED = (shake: string) => `        ${shake}.add(new Running(new Vec3(payload.x(), payload.y(), payload.z()), payload.strength(), payload.radius(), client.level.getGameTime(), payload.ticks(), payload.roll(), payload.fov(), payload.linear(), payload.frequency()));`

/**
 * Boss 能力 8 on Fabric 1.21.1: the shake as `shakeSource` writes it, with roll, a change of the field of view, its falloff and its frequency. The camera mixin moves the camera as
 * before and turns the camera's own rotation (the one the game draws the world with) about its line of sight; a second mixin, into the game renderer's `getFov`, adds the change of view
 * to the field of view of the world (not the hand's). Only a project with a shake past what could be written before gets this; any other keeps `shakeSource`'s text.
 */
function shakeMoreSource(packageName: string, modId: string) {
  return {
    server: `package ${packageName}.entity;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;

/** Generated by MineMods Studio: the packet that shakes a player's screen, and the server's side of sending it. */
public final class ${BOSS_RUNTIME.shake} implements ModInitializer {
    /** A shake: where it is centred, how strong it is at the centre, how far it reaches (blocks), how long it lasts (ticks), how it turns the view and changes the field of view (degrees), how it weakens and how fast it shakes. */
    ${SHAKE_MORE_RECORD} implements CustomPacketPayload {
        public static final Type<Shake> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(${JSON.stringify(modId)}, ${JSON.stringify(BOSS_RUNTIME.packet)}));
        public static final StreamCodec<RegistryFriendlyByteBuf, Shake> CODEC = StreamCodec.ofMember(Shake::write, Shake::read);

        static void write(Shake shake, RegistryFriendlyByteBuf buffer) {
${SHAKE_MORE_WRITE}
        }

        static Shake read(RegistryFriendlyByteBuf buffer) {
            return ${SHAKE_MORE_READ};
        }

        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
    }

    @Override public void onInitialize() {
        // Both sides know the packet; only the server sends it and only a player's game reads it.
        PayloadTypeRegistry.playS2C().register(Shake.ID, Shake.CODEC);
    }

${SHAKE_MORE_SEND_DOC}
    public static void send(ServerLevel world, Vec3 at, float strength, float radius, int ticks) { send(world, at, strength, radius, ticks, 0.0f, 0.0f, true, 1.0f); }

${SHAKE_MORE_SEND}
    public static void send(ServerLevel world, Vec3 at, float strength, float radius, int ticks, float roll, float fov, boolean linear, float frequency) {
        Shake shake = new Shake(at.x, at.y, at.z, strength, radius, ticks, roll, fov, linear, frequency);
        // A player whose game does not have this mod is skipped: the game would refuse the packet.
        for (ServerPlayer player : world.players()) {
            if (player.distanceToSqr(at) <= (double) radius * radius && ServerPlayNetworking.canSend(player, Shake.ID)) ServerPlayNetworking.send(player, shake);
        }
    }
}
`,
    client: `package ${packageName}.client;

import ${packageName}.entity.${BOSS_RUNTIME.shake};
import java.util.ArrayList;
import java.util.List;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;

/**
 * Generated by MineMods Studio: the shakes running in this player's game, and what they do to this frame. The camera mixin (${BOSS_RUNTIME.mixin}) asks for the move and
 * the turn once a frame, the view mixin (${BOSS_RUNTIME.view}) for the change of the field of view. Time is the world's own (it stops when the game is paused).
 */
public final class ${BOSS_RUNTIME.shakeClient} implements ClientModInitializer {
${SHAKE_MORE_FIELDS}
    @Override public void onInitializeClient() {
        ClientPlayNetworking.registerGlobalReceiver(${BOSS_RUNTIME.shake}.Shake.ID, (payload, context) -> context.client().execute(() -> {
            Minecraft client = context.client();
            if (client.level == null) return;
            if (RUNNING.size() >= MOST) RUNNING.remove(0);
${SHAKE_MORE_ADDED("RUNNING")}
        }));
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> RUNNING.clear());
    }

${shakeMoreMath(false)}}
`,
    mixin: `package ${packageName}.mixin;

import ${packageName}.client.${BOSS_RUNTIME.shakeClient};
import net.minecraft.client.Camera;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.BlockGetter;
import org.joml.Quaternionf;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Generated by MineMods Studio: moves the camera a little and turns it about its line of sight while a boss shakes the player's screen. It runs at the tail of the camera's own
 * update, after the game has put the camera where the player's eyes are; the game draws the world with the camera's rotation, so turning that turns the view. Only what is drawn moves, never the player.
 */
@Mixin(Camera.class)
public abstract class ${BOSS_RUNTIME.mixin} {
    @Shadow @Final private Quaternionf rotation;

    @Shadow protected abstract void move(float ahead, float up, float left);

    @Inject(method = "setup", at = @At("TAIL"))
    private void studio$shake(BlockGetter area, Entity focusedEntity, boolean thirdPerson, boolean inverseView, float tickDelta, CallbackInfo info) {
        float[] shake = ${BOSS_RUNTIME.shakeClient}.offset(tickDelta);
        if (shake != null) move(shake[0], shake[1], shake[2]);
        float roll = ${BOSS_RUNTIME.shakeClient}.roll(tickDelta);
        if (roll != 0.0f) rotation.rotateZ(roll * Mth.DEG_TO_RAD);
    }
}
`,
    view: `package ${packageName}.mixin;

import ${packageName}.client.${BOSS_RUNTIME.shakeClient};
import net.minecraft.client.Camera;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Generated by MineMods Studio: widens or narrows the field of view of the world (never the hand's) while a boss's shake says so. */
@Mixin(GameRenderer.class)
public abstract class ${BOSS_RUNTIME.view} {
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void studio$fov(Camera camera, float tickDelta, boolean world, CallbackInfoReturnable<Double> info) {
        if (!world) return;
        float more = ${BOSS_RUNTIME.shakeClient}.fov(tickDelta);
        if (more != 0.0f) info.setReturnValue(info.getReturnValue() + more);
    }
}
`,
  }
}

/**
 * Boss 能力 8 on a facade target (Forge, NeoForge): the shake as `shakeFacadeSource` writes it, with roll, a change of the field of view, its falloff and its frequency. The camera
 * mixin moves the camera as before; the turn and the change of view go through the loader's own camera events (`StudioClientPlatform.onCameraRoll` / `onFov`: Forge's and NeoForge's
 * `ViewportEvent.ComputeCameraAngles` and `ComputeFov`), set up by the client entry with the receiver.
 */
function shakeMoreFacadeSource(packageName: string, target: GenTarget) {
  const camera = target.version.boss.cameraMove
  return {
    server: `package ${packageName}.entity;

import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;

/** Generated by MineMods Studio: the packet that shakes a player's screen, and the server's side of sending it. */
public final class ${BOSS_RUNTIME.shake} {
    /** A shake: where it is centred, how strong it is at the centre, how far it reaches (blocks), how long it lasts (ticks), how it turns the view and changes the field of view (degrees), how it weakens and how fast it shakes. */
    ${SHAKE_MORE_RECORD} {
        static void write(Shake shake, FriendlyByteBuf buffer) {
${SHAKE_MORE_WRITE}
        }

        static Shake read(FriendlyByteBuf buffer) {
            return ${SHAKE_MORE_READ};
        }
    }

    /** Both sides know the packet; only the server sends it and only a player's game reads it. */
    public static final ${PLATFORM_CLASS}.Channel<Shake> CHANNEL = ${PLATFORM_CLASS}.s2c(${JSON.stringify(BOSS_RUNTIME.packet)}, Shake.class, Shake::write, Shake::read);

    /** Makes the channel while the mod is constructed (its field above), which is when the loader takes it. */
    public static void register() {}

${SHAKE_MORE_SEND_DOC}
    public static void send(ServerLevel world, Vec3 at, float strength, float radius, int ticks) { send(world, at, strength, radius, ticks, 0.0f, 0.0f, true, 1.0f); }

${SHAKE_MORE_SEND}
    public static void send(ServerLevel world, Vec3 at, float strength, float radius, int ticks, float roll, float fov, boolean linear, float frequency) {
        CHANNEL.sendNear(world, at.x, at.y, at.z, radius, new Shake(at.x, at.y, at.z, strength, radius, ticks, roll, fov, linear, frequency));
    }
}
`,
    client: `package ${packageName}.client;

import ${packageName}.entity.${BOSS_RUNTIME.shake};
import ${packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;

/**
 * Generated by MineMods Studio: the shakes running in this player's game, and what they do to this frame. The camera mixin (${BOSS_RUNTIME.mixin}) asks for the move once a frame;
 * the loader's camera events ask for the turn and the change of the field of view. Time is the world's own (it stops when the game is paused).
 */
public final class ${BOSS_RUNTIME.shakeClient} {
${SHAKE_MORE_FIELDS}    /** The world the running shakes were started in: in another one (the player left, or changed dimension) they are over. */
    private static ClientLevel world;

    /** Run once by the client entry: what this player's game does with a shake, and the turn and the change of view it asks the camera for. */
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.onS2C(${BOSS_RUNTIME.shake}.CHANNEL, payload -> {
            Minecraft client = Minecraft.getInstance();
            if (client.level == null) return;
            if (client.level != world) {
                RUNNING.clear();
                world = client.level;
            }
            if (RUNNING.size() >= MOST) RUNNING.remove(0);
${SHAKE_MORE_ADDED("RUNNING")}
        });
        ${CLIENT_PLATFORM_CLASS}.onCameraRoll(${BOSS_RUNTIME.shakeClient}::roll);
        ${CLIENT_PLATFORM_CLASS}.onFov((fov, partialTick) -> fov + ${BOSS_RUNTIME.shakeClient}.fov(partialTick));
    }

${shakeMoreMath(true)}}
`,
    mixin: `package ${packageName}.mixin;

import ${packageName}.client.${BOSS_RUNTIME.shakeClient};
import net.minecraft.client.Camera;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.BlockGetter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Generated by MineMods Studio: moves the camera a little while a boss shakes the player's screen. It runs at the tail of the camera's own update, after
 * the game has put the camera where the player's eyes are, and moves it with the camera's own method; only what is drawn moves, never the player.
 * The turn and the change of view are the loader's camera events' (${BOSS_RUNTIME.shakeClient}.register).
 */
@Mixin(Camera.class)
public abstract class ${BOSS_RUNTIME.mixin} {
    @Shadow protected abstract void move(${camera} ahead, ${camera} up, ${camera} left);

    @Inject(method = "setup", at = @At("TAIL"))
    private void studio$shake(BlockGetter area, Entity focusedEntity, boolean thirdPerson, boolean inverseView, float tickDelta, CallbackInfo info) {
        float[] shake = ${BOSS_RUNTIME.shakeClient}.offset(tickDelta);
        if (shake != null) move(shake[0], shake[1], shake[2]);
    }
}
`,
  }
}

function legacyDebrisSource(packageName: string, modId: string, look: boolean) {
  return `package ${packageName}.entity;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.FloatTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Mth;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * Generated by MineMods Studio: one piece of the ground thrown up by a creature's ability. It is only seen: a block display of the game's own kind,
 * moved by the server every tick (up, then back down, turning), gone after ${DEBRIS_LIMITS.life.min} to ${DEBRIS_LIMITS.life.max} ticks, never saved. It places no block, changes no block
 * and drops nothing. A player's game is told it is an ordinary block display, which it already knows how to draw.
 */
public class ${BOSS_RUNTIME.debris} extends Display.BlockDisplay {
    /** The most pieces that exist in the whole world at once; more are not made. */
    private static final int ALIVE = ${DEBRIS_LIMITS.alive};
    private static final List<${BOSS_RUNTIME.debris}> PIECES = new ArrayList<>();
    private double riseX;
    private double riseY;
    private double riseZ;
    private double fall;
    private float spinYaw;
    private float spinPitch;
    private int life;
    private int lived;

    private ${BOSS_RUNTIME.debris}(Level world) { super(EntityType.BLOCK_DISPLAY, world); }

    /** The first block under (x, y, z), within a few blocks, that a player would call ground; its position, or null where there is none (air, water, a plant, a place not loaded). */
    private static BlockPos ground(ServerLevel world, double x, double y, double z) {
        int blockX = Mth.floor(x);
        int blockZ = Mth.floor(z);
        if (!world.hasChunk(blockX >> 4, blockZ >> 4)) return null;
        for (int below = 0; below <= 5; below++) {
            BlockPos pos = new BlockPos(blockX, Mth.floor(y - 0.01) - below, blockZ);
            BlockState state = world.getBlockState(pos);
            if (!state.isAir() && state.getFluidState().isEmpty() && state.getRenderShape() == RenderShape.MODEL && !state.getCollisionShape(world, pos).isEmpty()) return pos;
        }
        return null;
    }

    private static ListTag floats(float... values) {
        ListTag list = new ListTag();
        for (float value : values) list.add(FloatTag.valueOf(value));
        return list;
    }

    /**
     * Throws up the ground round \`at\`: a ring of dust \`radius\` blocks wide (and a puff in the middle) made of the blocks it stands on, and \`count\` pieces of
     * those blocks flying up from inside the ring. Called on the server. Pieces beyond the world's ${DEBRIS_LIMITS.alive} are left out, the dust is not.
     */
    ${look ? `public static BlockState block(String name) {
        var id = net.minecraft.resources.ResourceLocation.tryParse(name.contains(":") ? name : "${modId}:" + name);
        return net.minecraft.core.registries.BuiltInRegistries.BLOCK.get(id).defaultBlockState();
    }

    public static void burst(ServerLevel world, Vec3 at, double radius, int count) {
        burst(world, at, radius, count, null, null);
    }

    ` : ""}public static void burst(ServerLevel world, Vec3 at, double radius, int count${look ? ", BlockState block, net.minecraft.core.particles.ParticleOptions dust" : ""}) {
        RandomSource random = world.getRandom();
        int points = Mth.clamp((int) Math.ceil(radius * 4.0), ${DEBRIS_LIMITS.ringLeast}, ${DEBRIS_LIMITS.ring});
        for (int index = -1; index < points; index++) {
            double angle = index * 2.0 * Math.PI / points;
            double x = at.x + (index < 0 ? 0.0 : radius * Math.cos(angle));
            double z = at.z + (index < 0 ? 0.0 : radius * Math.sin(angle));
            BlockPos ground = ground(world, x, at.y, z);
            if (ground == null) continue;
            double top = ground.getY() + world.getBlockState(ground).getCollisionShape(world, ground).max(Direction.Axis.Y);
            world.sendParticles(${look ? "dust != null ? dust : " : ""}new BlockParticleOption(ParticleTypes.BLOCK, world.getBlockState(ground)), x, top + 0.1, z, index < 0 ? 8 : 3, 0.3, 0.05, 0.3, 0.05);
        }
        PIECES.removeIf(Entity::isRemoved);
        for (int made = 0; made < count && PIECES.size() < ALIVE; made++) {
            double angle = random.nextDouble() * 2.0 * Math.PI;
            double distance = Math.sqrt(random.nextDouble()) * radius;
            double x = at.x + distance * Math.cos(angle);
            double z = at.z + distance * Math.sin(angle);
            BlockPos ground = ground(world, x, at.y, z);
            if (ground == null) continue;
            BlockState state = world.getBlockState(ground);
            ${BOSS_RUNTIME.debris} piece = new ${BOSS_RUNTIME.debris}(world);
            piece.start(${look ? "block != null ? block : state" : "state"}, x, ground.getY() + state.getCollisionShape(world, ground).max(Direction.Axis.Y), z, random);
            if (world.addFreshEntity(piece)) PIECES.add(piece);
        }
    }

    /** Gives the piece its block, its size, its place on the ground and the throw that brings it back to the ground exactly when its life is over. */
    private void start(BlockState state, double x, double top, double z, RandomSource random) {
        float size = ${single(DEBRIS_LIMITS.scale.min)} + random.nextFloat() * ${single(DEBRIS_LIMITS.scale.max - DEBRIS_LIMITS.scale.min)};
        life = ${DEBRIS_LIMITS.life.min} + random.nextInt(${DEBRIS_LIMITS.life.max - DEBRIS_LIMITS.life.min + 1});
        // The game's own save format, read the way a saved block display is: the block, and a transformation that shrinks it about its middle (so it turns about its middle).
        CompoundTag data = new CompoundTag();
        data.put("block_state", NbtUtils.writeBlockState(state));
        CompoundTag transformation = new CompoundTag();
        transformation.put("translation", floats(-size / 2.0f, -size / 2.0f, -size / 2.0f));
        transformation.put("left_rotation", floats(0.0f, 0.0f, 0.0f, 1.0f));
        transformation.put("scale", floats(size, size, size));
        transformation.put("right_rotation", floats(0.0f, 0.0f, 0.0f, 1.0f));
        data.put("transformation", transformation);
        // Moved a little every tick: a player's game glides between two positions instead of jumping.
        data.putInt("teleport_duration", 2);
        readAdditionalSaveData(data);
        setPos(x, top + size / 2.0, z);
        double rise = 0.2 + random.nextDouble() * 0.25;
        riseX = (random.nextDouble() - 0.5) * 0.12;
        riseZ = (random.nextDouble() - 0.5) * 0.12;
        riseY = rise;
        // Up at \`rise\` and slowing by \`fall\` every tick, it is back where it started after \`life\` ticks.
        fall = 2.0 * rise / (life - 1);
        spinYaw = (random.nextFloat() - 0.5f) * 50.0f;
        spinPitch = (random.nextFloat() - 0.5f) * 50.0f;
        setYRot(random.nextFloat() * 360.0f);
    }

    @Override public void tick() {
        super.tick();
        if (level().isClientSide() || isRemoved()) return;
        if (++lived >= life) {
            discard();
            return;
        }
        setPos(getX() + riseX, getY() + riseY, getZ() + riseZ);
        riseY -= fall;
        setYRot(getYRot() + spinYaw);
        setXRot(getXRot() + spinPitch);
    }

    // Pieces of a moment: they are not kept when the world is saved or a chunk unloads.
    @Override public boolean shouldBeSaved() { return false; }
}
`
}

/**
 * The blocks an ability breaks (`break`): every block in an upright cylinder no harder than the ability says, broken as the game breaks a block (its sound and its pieces,
 * its drops when asked). Only where the world lets this mob change blocks: on Fabric the game rule mobGriefing, on a facade target the loader's own question
 * (`${PLATFORM_CLASS}.mobGriefing`, which claim mods answer). Never a block with a store (a block entity), one the game calls unbreakable, nor a fluid.
 */
function breakSource(packageName: string, facade: boolean, dash: boolean, quiet: boolean) {
  return `package ${packageName}.entity;

${facade ? `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};\n` : ""}import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
${facade ? "" : "import net.minecraft.world.level.GameRules;\n"}import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/** Generated by MineMods Studio: the blocks of the world a creature's ability breaks. */
public final class ${BOSS_RUNTIME.breaks} {
    /** The most blocks one break takes, so a wide one cannot stall the server. */
    private static final int MOST = ${BREAK_LIMITS.blocks};

    private ${BOSS_RUNTIME.breaks}() {}${dash ? `

    public static int sweep(ServerLevel world, Entity breaker, Vec3 step, float hardness, int budget) {
        if (!${facade ? `${PLATFORM_CLASS}.mobGriefing(breaker)` : "world.getGameRules().getBoolean(GameRules.RULE_MOBGRIEFING)"}) return 0;
        int broken = 0;
        int visited = 0;
        int steps = Math.max(1, Mth.ceil(step.length() * 4));
        for (int i = 1; i <= steps; i++) {
            var box = breaker.getBoundingBox().move(step.scale(i / (double)steps)).deflate(0.0001);
            var soft = new java.util.ArrayList<BlockPos>();
            for (BlockPos pos : BlockPos.betweenClosed(Mth.floor(box.minX), Mth.floor(box.minY), Mth.floor(box.minZ), Mth.floor(box.maxX), Mth.floor(box.maxY), Mth.floor(box.maxZ))) {
                if (++visited > 4096 || !world.isLoaded(pos)) return broken;
                BlockState state = world.getBlockState(pos);
                if (state.isAir()) continue;
                var shape = state.getCollisionShape(world, pos);
                if (shape.isEmpty() || shape.toAabbs().stream().noneMatch(part -> part.move(pos).intersects(box))) continue;
                float tough = state.getDestroySpeed(world, pos);
                if (!state.getFluidState().isEmpty() || state.hasBlockEntity() || tough < 0 || tough > hardness) return broken;
                soft.add(pos.immutable());
            }
            for (BlockPos pos : soft) {
                if (broken >= budget || !world.destroyBlock(pos, false, breaker)) return broken;
                broken++;
            }
        }
        return broken;
    }
` : ""}

    /**
     * Breaks every block within \`radius\` of \`centre\` (level distance to the middle of the block) and from \`centre\`'s height up to \`height\` above it, no harder than
     * \`hardness\`, nearest the middle first. The blocks broken, or -1 when the world does not let this mob change blocks.
     */
    public static int smash(ServerLevel world, Entity breaker, Vec3 centre, double radius, double height, float hardness, boolean drops) {${quiet ? `
        return smash(world, breaker, centre, radius, height, hardness, drops, true);
    }

    public static int smash(ServerLevel world, Entity breaker, Vec3 centre, double radius, double height, float hardness, boolean drops, boolean particles) {` : ""}
        if (!${facade ? `${PLATFORM_CLASS}.mobGriefing(breaker)` : "world.getGameRules().getBoolean(GameRules.RULE_MOBGRIEFING)"}) return -1;
        int reach = Mth.ceil(radius);
        int bottom = Mth.floor(centre.y);
        int top = Mth.floor(centre.y + height - 1.0E-6);
        int cx = Mth.floor(centre.x);
        int cz = Mth.floor(centre.z);
        int broken = 0;
        // Ring by ring outward, so what breaks first when \`MOST\` stops it is what is nearest where it struck.
        for (int ring = 0; ring <= reach && broken < MOST; ring++) {
            for (int dx = -ring; dx <= ring && broken < MOST; dx++) {
                for (int dz = -ring; dz <= ring && broken < MOST; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) != ring) continue;
                    double x = cx + dx + 0.5 - centre.x;
                    double z = cz + dz + 0.5 - centre.z;
                    if (x * x + z * z > radius * radius) continue;
                    for (int y = bottom; y <= top && broken < MOST; y++) {
                        BlockPos here = new BlockPos(cx + dx, y, cz + dz);
                        if (!world.isLoaded(here)) continue;
                        BlockState state = world.getBlockState(here);
                        if (state.isAir() || !state.getFluidState().isEmpty() || state.hasBlockEntity()) continue;
                        float tough = state.getDestroySpeed(world, here);
                        if (tough < 0.0f || tough > hardness) continue;
${quiet ? `                        if (!particles) {
                            if (!world.removeBlock(here, false)) continue;
                            if (drops) net.minecraft.world.level.block.Block.dropResources(state, world, here, null, breaker, net.minecraft.world.item.ItemStack.EMPTY);
                            var sound = state.getSoundType();
                            world.playSound(null, here, sound.getBreakSound(), net.minecraft.sounds.SoundSource.BLOCKS, sound.getVolume(), sound.getPitch());
                            world.gameEvent(net.minecraft.world.level.gameevent.GameEvent.BLOCK_DESTROY, here, net.minecraft.world.level.gameevent.GameEvent.Context.of(breaker, state));
                            broken++;
                            continue;
                        }
` : ""}                        if (world.destroyBlock(here, drops, breaker)) broken++;
                    }
                }
            }
        }
        return broken;
    }
}
`
}

/**
 * `target`: Fabric 1.21.1 (the default) is this file's own text and its edits to fabric.mod.json, exactly as before. A facade target gets the
 * shake through the facade (`shakeFacadeSource`), the pieces of the ground as they are (they name only the game), every class mapped to its game
 * version, the mixin added to the template's list by the loader's adapter, and the two classes whose `register()` its entries run (`entries`).
 */
export function compileBossRuntime(value: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const pack = input.packageName.replaceAll(".", "/")
  if (target.loader.facade) {
    // Boss 能力 8: the longer shake when some shake of the project needs it; its turn and change of view go through the loader's camera events, not a mixin.
    const shake = input.shake ? (input.shakeMore ? shakeMoreFacadeSource(input.packageName, target) : shakeFacadeSource(input.packageName, target)) : null
    const written: Record<string, string> = {
      ...(shake
        ? {
            [`${source}/entity/${BOSS_RUNTIME.shake}.java`]: shake.server,
            [`${source}/client/${BOSS_RUNTIME.shakeClient}.java`]: shake.client,
            [`${source}/mixin/${BOSS_RUNTIME.mixin}.java`]: shake.mixin,
          }
        : {}),
      ...(input.debris ? { [`${source}/entity/${BOSS_RUNTIME.debris}.java`]: debrisSource(input.packageName, input.modId, input.debrisThrow, input.debrisLook) } : {}),
      ...(input.breaks ? { [`${source}/entity/${BOSS_RUNTIME.breaks}.java`]: breakSource(input.packageName, true, input.dashBreaks, input.quietBreak) } : {}),
    }
    return {
      files: Object.fromEntries(Object.entries(written).map(([name, text]) => [name, target.version.rewriteJava(text)])),
      classes: [
        ...(shake ? [`${pack}/entity/${BOSS_RUNTIME.shake}.class`, `${pack}/client/${BOSS_RUNTIME.shakeClient}.class`, `${pack}/mixin/${BOSS_RUNTIME.mixin}.class`] : []),
        ...(input.debris ? [`${pack}/entity/${BOSS_RUNTIME.debris}.class`] : []),
        ...(input.breaks ? [`${pack}/entity/${BOSS_RUNTIME.breaks}.class`] : []),
      ],
      // The camera exists only in a player's game: the mixin is in the list's client section, so a server never loads it.
      patch: (shake ? { [`src/main/resources/${input.modId}.mixins.json`]: (text: string) => target.loader.addMixins(text, { client: [BOSS_RUNTIME.mixin] }) } : {}) as Record<string, (text: string) => string>,
      /** What the mod's common entry and its client entry run (`<class>.register()`): the shake's channel, and what a player's game does with it. */
      entries: { common: shake ? [`${input.packageName}.entity.${BOSS_RUNTIME.shake}`] : [], client: shake ? [`${input.packageName}.client.${BOSS_RUNTIME.shakeClient}`] : [] },
    }
  }
  const shake = input.shake ? shakeSource(input.packageName, input.modId) : null
  // Boss 能力 8: the longer shake and its second mixin (the field of view) when some shake of the project needs it; any other project is written exactly as before.
  const more = shake && input.shakeMore ? shakeMoreSource(input.packageName, input.modId) : null
  const views = more ? [BOSS_RUNTIME.view] : []
  const files: Record<string, string> = {
    ...(shake
      ? {
          [`${source}/entity/${BOSS_RUNTIME.shake}.java`]: more?.server ?? shake.server,
          [`${source}/client/${BOSS_RUNTIME.shakeClient}.java`]: more?.client ?? shake.client,
          [`${source}/mixin/${BOSS_RUNTIME.mixin}.java`]: more?.mixin ?? shake.mixin,
          ...(more ? { [`${source}/mixin/${BOSS_RUNTIME.view}.java`]: (input.camera ? cameraView(more.view, input.packageName) : more.view) } : {}),
        }
      : {}),
    ...(input.debris ? { [`${source}/entity/${BOSS_RUNTIME.debris}.java`]: debrisSource(input.packageName, input.modId, input.debrisThrow, input.debrisLook) } : {}),
    ...(input.breaks ? { [`${source}/entity/${BOSS_RUNTIME.breaks}.java`]: breakSource(input.packageName, false, input.dashBreaks, input.quietBreak) } : {}),
  }
  const edit = (text: string, change: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const edited = `${JSON.stringify(change(z.record(z.string(), z.unknown()).parse(JSON.parse(text))), null, 2)}\n`
    return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
  }
  return {
    files,
    /** Paths inside the built jar that prove the runtime went in. */
    classes: [
      ...(shake ? [`${pack}/entity/${BOSS_RUNTIME.shake}.class`, `${pack}/client/${BOSS_RUNTIME.shakeClient}.class`, `${pack}/mixin/${BOSS_RUNTIME.mixin}.class`] : []),
      ...views.map((view) => `${pack}/mixin/${view}.class`),
      ...(input.debris ? [`${pack}/entity/${BOSS_RUNTIME.debris}.class`] : []),
      ...(input.breaks ? [`${pack}/entity/${BOSS_RUNTIME.breaks}.class`] : []),
    ],
    /**
     * Edits to files the scaffold wrote. The packet is registered when the mod starts (both sides) and its receiver when a player's game does;
     * the mixin goes in the template's mixin list, in its \`client\` section: the camera exists only in a player's game, so a server never loads it.
     */
    patch: (shake
      ? {
          "src/main/resources/fabric.mod.json": (text: string) =>
            edit(text, (metadata) => {
              const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
              return { ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${BOSS_RUNTIME.shake}`], client: [...entrypoints.client, `${input.packageName}.client.${BOSS_RUNTIME.shakeClient}`] } }
            }),
          [`src/main/resources/${input.modId}.mixins.json`]: (text: string) =>
            edit(text, (mixins) => ({ ...mixins, client: [...z.array(z.string()).default([]).parse(mixins.client), BOSS_RUNTIME.mixin, ...views] })),
        }
      : {}) as Record<string, (text: string) => string>,
    /** Fabric names its entry points in fabric.mod.json (the patch above): nothing for the facade's entries. */
    entries: { common: [] as string[], client: [] as string[] },
  }
}

/** Explicit throw physics, opted in without changing legacy generation. A swept collision sees thin floors and walls too. */
function debrisSource(packageName: string, modId: string, throwing: boolean, look: boolean) {
  const old = legacyDebrisSource(packageName, modId, look)
  if (!throwing) return old
  return old
    .replace("private int lived;", "private int lived;\n    private boolean thrown;")
    .replace(look ? "ParticleOptions dust) {" : "double radius, int count) {", look ? "ParticleOptions dust, double... throwing) {" : "double radius, int count, double... throwing) {")
    .replace("int count) {\n        burst(world, at, radius, count, null, null);", "int count, double... throwing) {\n        burst(world, at, radius, count, null, null, throwing);")
    .replace("z, random);", "z, random);\n            if (throwing.length == 3) {\n                piece.thrown = true; piece.life = 160;\n                piece.riseY = throwing[0]; piece.fall = throwing[2];\n                piece.riseX = Math.cos(angle) * throwing[1]; piece.riseZ = Math.sin(angle) * throwing[1];\n            }")
    .replace("setPos(getX() + riseX, getY() + riseY, getZ() + riseZ);", `if (thrown) {
            Vec3 from = position(), to = from.add(riseX, riseY, riseZ);
            var hit = level().clip(new net.minecraft.world.level.ClipContext(from, to, net.minecraft.world.level.ClipContext.Block.COLLIDER, net.minecraft.world.level.ClipContext.Fluid.NONE, this));
            if (hit.getType() != net.minecraft.world.phys.HitResult.Type.MISS) { discard(); return; }
        }
        setPos(getX() + riseX, getY() + riseY, getZ() + riseZ);`)
}

function cameraView(view: string, packageName: string) {
  return view.replace("import net.minecraft.client.Camera;", `import net.minecraft.client.Camera;\nimport ${packageName}.client.StudioCinematicClient;`)
    .replace("if (more != 0.0f) info.setReturnValue(info.getReturnValue() + more);", `double factor = StudioCinematicClient.fov(tickDelta);
        if (more != 0.0f || factor != 1.0) info.setReturnValue(Math.max(10.0, Math.min(170.0, (info.getReturnValue() + more) * factor)));`)
}
