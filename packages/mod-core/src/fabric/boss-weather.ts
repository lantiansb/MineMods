import { emitArguments } from "../common/emit"
import { groundFxSpec } from "../common/ground-fx"
import type { SoundRef } from "../sound"
import { z } from "zod"
import { bossWeatherPlan, bossWeathers, isLightningHit, type StruckAbility } from "../boss-weather"
import type { AbilityPlan } from "../creature-abilities"
import type { Boss, Stances } from "../entity-runtime"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"
import { LIGHTNING_LIMITS, WEATHER_LIMITS } from "../weather-words"

/**
 * Boss 能力 7 (天气、天色和落雷) as what it adds to a generated mod. Only written when some boss of the project has a phase with a weather, or some hostile
 * creature's ability has a lightning, so a project without either is untouched, byte for byte; each half is written only when it is needed.
 *
 * The weather of a phase is shown to the players of the fight (the players of the boss's bar) and to nobody else, and the world's own weather is never changed:
 * - `StudioBossWeather` (common): every tick the boss hands it the players of its bar and the weather of its phase (`fight`); at the end of the server's tick it moves
 *   each such player's rain and thunder a step toward it and tells that player alone, with the game's own packets (`ClientboundGameEventPacket`, START_RAINING /
 *   STOP_RAINING and the rain's and the thunder's level), and tells the player's game how dark to make it with a small packet of its own. A player who is no longer
 *   handed in (left the fight, the boss died, was reset or fell asleep, is gone from the world) is brought back the same way to the weather of the world they are in;
 *   one who left the server is forgotten, one who changed worlds or came back after dying is given the world's weather by the game itself. When the world's own weather
 *   changes the game tells everybody, the players of the fight too, and they are told theirs again in the same tick.
 * - `StudioBossWeatherClient` (client): the darkness a player's game was told, eased over the same two seconds, and forgotten in another world;
 * - two client mixins: `StudioBossDarkMixin` makes the game's own boss darkening (`GameRenderer.getDarkenWorldAmount`, which the light and the fog read) at least that dark,
 *   and `StudioBossSkyMixin` takes the sky's and the clouds' colour toward black by as much (`ClientLevel.getSkyColor` / `getCloudColor`), at the tail of each.
 *
 * Lightning (`StudioLightning`): a bolt of the game's own kind, only seen and heard. The server's copy is a subclass that is never saved and does nothing on the server but
 * count to its end (the game's bolt sets fires, cleans copper and powers a lightning rod there, which this one never does; `setVisualOnly` is set as well), and every
 * player's game is told it is a plain bolt, which it draws, lights the sky with and plays the thunder of. Who it strikes and for how much is the ability's own hit.
 *
 * Every Minecraft, Fabric and Mixin name used here is Mojang's own, read with javap from the 1.21.1 and 1.20.1 jars (the same on both: `ClientboundGameEventPacket`'s
 * four weather types and its `(Type, float)` constructor, `LightningBolt.setVisualOnly`, `GameRenderer.getDarkenWorldAmount(float)`, `ClientLevel.getSkyColor(Vec3, float)`).
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  /** Some boss has a phase with a weather. */
  weather: z.boolean(),
  /** Some ability has a lightning. */
  lightning: z.boolean(),
  styled: z.boolean().default(false),
  tint: z.boolean().default(false),
  ambience: z.boolean().default(false),
})

/** The classes the creatures reach the weather and the lightning through, the mixins, and the id of the darkness's packet. */
export const BOSS_WEATHER = { server: "StudioBossWeather", client: "StudioBossWeatherClient", dark: "StudioBossDarkMixin", sky: "StudioBossSkyMixin", lightning: "StudioLightning", packet: "studio_sky" } as const

const single = (value: number) => `${Number(value.toFixed(4))}f`
const RAMP = WEATHER_LIMITS.ramp

// ---- what the boss's own class carries (entity-boss.ts) ----

/**
 * The lines a boss with a phase weather adds to its class: per stage (0 before any line), the weather its fight shows as {rain, thunder, darkness} (null: the world's own),
 * and the statement its tick runs first. Both empty for a boss without one, so its class is what it always was. The weather shows while the fight does (its bar is seen:
 * fighting or changing phase); dead, asleep, waking up or reset, its players get the world's own back.
 */
export const stanceAmbience = (stances?: Stances) => Boolean(stances?.list.some(row => row.ambient && Object.values(row.ambient).some(value => value != null)))

export function bossWeatherJava(boss: Pick<Boss, "phases"> | null | undefined, stances?: Stances, show = false) {
  if (boss && stanceAmbience(stances)) {
    const stages = bossWeatherPlan(boss).map(weather => weather ? `{${[weather.rain ? 1 : 0, weather.thunder ? 1 : 0, weather.dark].map(single).join(", ")}}` : "null")
    const overlays = stances!.list.map(row => {
      const ambient = row.ambient
      return ambient ? `{${[ambient.sky ?? -1, ambient.tint ? Number.parseInt(ambient.tint.slice(1), 16) : -1, ambient.visibility ?? -1].map(single).join(", ")}}` : "null"
    })
    return {
      fields: `    private static final float[][] BOSS_WEATHER = {${stages.join(", ")}};
    private static final float[][] STANCE_AMBIENCE = {${overlays.join(", ")}};

    private float[] stanceWeather() {
        float[] showing = ${show ? "bossShowWeather()" : "null"};
        if (isDeadOrDying() || bossState() != BOSS_FIGHT && bossState() != BOSS_CHANGE) return showing;
        float[] base = showing != null ? showing : BOSS_WEATHER[Math.min(bossPhase(), BOSS_WEATHER.length - 1)];
        float[] overlay = STANCE_AMBIENCE[stanceIndex()];
        if (overlay == null) return base;
        return new float[] {
            base == null ? -1.0f : base[0], base == null ? -1.0f : base[1],
            overlay[0] >= 0.0f ? overlay[0] : base == null ? 0.0f : base[2], overlay[1], overlay[2]
        };
    }
`,
      tick: `        ${BOSS_WEATHER.server}.fight(this, bossBar.getPlayers(), stanceWeather());
`,
    }
  }
  if (!boss || !bossWeathers(boss)) return { fields: "", tick: "" }
  const stages = bossWeatherPlan(boss).map((weather) => (weather ? `{${[weather.rain ? 1 : 0, weather.thunder ? 1 : 0, weather.dark].map(single).join(", ")}}` : "null"))
  return {
    fields: `    // Boss 能力 7: per phase (the first is before any line), the weather the players of its fight see, {rain, thunder, darkness}; null is the world's own (${BOSS_WEATHER.server}).
    private static final float[][] BOSS_WEATHER = {${stages.join(", ")}};
`,
    tick: `        // Boss 能力 7: the weather of its phase, to the players of its bar alone, while its fight is on; dead, asleep, waking up or reset they get the world's own back.
        ${BOSS_WEATHER.server}.fight(this, bossBar.getPlayers(), !isDeadOrDying() && (bossState() == BOSS_FIGHT || bossState() == BOSS_CHANGE) ? BOSS_WEATHER[Math.min(bossPhase(), BOSS_WEATHER.length - 1)] : null);
`,
  }
}

// ---- what an ability's class carries (entity-abilities.ts) ----

/**
 * The statements of a struck ability's lightning (`struckAbility`): on the tick each lands, after the hit it lands as has struck at its places, a bolt comes down on every one
 * of them. The places are the hit's own (`abilityPlaces`, decided when its warning began or on this tick), so the bolts are exactly where the warning was and where it hurts.
 */
export function lightningSteps(ability: StruckAbility, plan: AbilityPlan, indices: Readonly<Record<string, number>> = {}, sound?: (ref: SoundRef) => {event:string; source:string}) {
  return ability.hits.flatMap((hit, index) => {
    if (!isLightningHit(hit)) return []
    const tick = plan.hits[index]!.tick
    const look = hit.lightningLook
    if (!look) return [{tick, lines:[`${BOSS_WEATHER.lightning}.strike(level(), abilityPlaces[${index}]);`]}]
    const particle = look.particle && (typeof look.particle === "object" && "particle" in look.particle ? look.particle : {particle:look.particle, count:12, spread:0.5})
    const played = look.sound && sound?.(look.sound)
    const flash = look.flash && groundFxSpec({ ...look.flash, type:"flash", at:0, where:"self", hit:null, forward:0, left:0 })
    return [{tick, lines:[`${BOSS_WEATHER.lightning}.show(level(), abilityPlaces[${index}], (world, point) -> {`,
      ...(look.effect ? [`    StudioEffects.spawn(${JSON.stringify(look.effect)}, world, point, abilityYaw, null, null);`] : []),
      ...(particle ? [`    StudioEmit.send(world, point, abilityYaw, ${emitArguments(particle, indices)});`] : []),
      ...(played ? [`    world.playSound(null, point.x, point.y, point.z, ${played.event}, ${played.source}, 1f, 1f);`] : []),
      ...(flash ? [`    StudioFx.start(world, ${flash}, point, abilityYaw, this, null, 1f, null);`] : []), "});"]}]
  })
}

// ---- the classes ----

/** The server's half of the weather: `network` writes the darkness's packet and how it is sent, which is what differs between Fabric and a facade target. */
function weatherServer(packageName: string, network: { imports: string; implementsInit: string; members: string; send: string }, ambience: boolean) {
  return `package ${packageName}.entity;

${network.imports}import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import net.minecraft.network.protocol.game.ClientboundGameEventPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;

/**
 * Generated by MineMods Studio (Boss 能力 7): the weather a boss's phase shows to the players of its fight, and to nobody else. The world's own weather is never changed:
 * each of those players is told on their own, with the game's own packets, that it rains and thunders, and how dark to make it; whoever is no longer in the fight is told
 * the world's own weather again. Rain, thunder and darkness come and go over ${RAMP} ticks.
 */
public final class ${BOSS_WEATHER.server}${network.implementsInit} {
${network.members}
    /** One player of a fight: the fight's weather, whether the boss handed them in this tick, and what their game was last told (and of the world's weather, last seen). */
    private static final class Held {
        ServerPlayer player;
        ServerLevel level;
        float[] wanted;
        boolean called;
        float rain;
        float thunder;
        float dark;${ambience ? `
        int tint = -1;
        float visibility = -1.0f;` : ""}
        boolean raining;
        float realRain;
        float realThunder;
        boolean realRaining;

        /** What this player's game has of the world they are in: what the game told it when it came into that world, or when its weather last changed. */
        void told(ServerPlayer who) {
            player = who;
            level = who.serverLevel();
            rain = realRain = level.getRainLevel(1.0f);
            thunder = realThunder = level.getThunderLevel(1.0f);
            raining = realRaining = level.isRaining();
        }
    }

    private static final float STEP = ${single(1 / RAMP)};
    private static final Map<UUID, Held> HELD = new HashMap<>();

    /**
     * Run by a boss on every server tick: \`players\` are the players of its bar, and \`weather\` ({rain, thunder, darkness}) what its fight shows now, or null for the world's own.
     * A player it hands in with a weather keeps it as long as it keeps handing them in; one it no longer does gets the world's weather back (\`tick\`).
     */
    public static void fight(Entity boss, Collection<ServerPlayer> players, float[] weather) {
        if (weather == null) return;
        for (ServerPlayer player : players) {
            if (player.level() != boss.level()) continue;
            Held held = HELD.get(player.getUUID());
            if (held == null) {
                held = new Held();
                held.told(player);
                HELD.put(player.getUUID(), held);
            } else if (held.player != player) {
                // The same person as a new player (back after dying): the game has just told them the world's weather.
                held.told(player);
            }
            held.wanted = weather;
            held.called = true;
        }
    }

    /** At the end of every server tick: each player of a fight is moved a step toward its weather, every other one held back toward the world's own, and told only what changed. */
    public static void tick(MinecraftServer server) {
        if (HELD.isEmpty()) return;
        Iterator<Map.Entry<UUID, Held>> entries = HELD.entrySet().iterator();
        while (entries.hasNext()) {
            Map.Entry<UUID, Held> entry = entries.next();
            Held held = entry.getValue();
            boolean fighting = held.called;
            held.called = false;
            ServerPlayer player = held.player;
            if (player.isRemoved() || player.hasDisconnected()) {
                // Gone from the server: their game is gone with it. Back after dying, as a new player: the game has told them the world's weather, their darkness is still to be taken back.
                ServerPlayer back = server.getPlayerList().getPlayer(entry.getKey());
                if (back == null || back == player || back.isRemoved()) {
                    entries.remove();
                    continue;
                }
                held.told(back);
                player = back;
                fighting = false;
            }
            ServerLevel level = player.serverLevel();
            if (level != held.level) {
                // Into another world: the game tells a player its weather when they come into it, and their game starts that world with no darkness of ours.
                entries.remove();
                continue;
            }
            float realRain = level.getRainLevel(1.0f);
            float realThunder = level.getThunderLevel(1.0f);
            boolean realRaining = level.isRaining();
            // The world's weather changed this tick: the game has just told everybody in it, this player too, so what the fight shows is told again.
            boolean overwritten = realRain != held.realRain || realThunder != held.realThunder || realRaining != held.realRaining;
            held.realRain = realRain;
            held.realThunder = realThunder;
            held.realRaining = realRaining;
            if (overwritten) held.raining = realRaining;
            float[] wanted = fighting ? held.wanted : null;
            float rain = approach(held.rain, wanted != null${ambience ? " && wanted[0] >= 0.0f" : ""} ? wanted[0] : realRain);
            float thunder = approach(held.thunder, wanted != null${ambience ? " && wanted[1] >= 0.0f" : ""} ? wanted[1] : realThunder);
            float dark = wanted != null ? wanted[2] : 0.0f;
            boolean back = wanted == null && rain == realRain && thunder == realThunder;
            boolean raining = back ? realRaining : rain > 0.0f;
            boolean flag = raining != held.raining;
            // START_RAINING and STOP_RAINING set the game's rain level too (to 0 and to 1): the levels follow them.
            if (flag) tell(player, raining ? ClientboundGameEventPacket.START_RAINING : ClientboundGameEventPacket.STOP_RAINING, 0.0f);
            if (flag || overwritten || rain != held.rain) tell(player, ClientboundGameEventPacket.RAIN_LEVEL_CHANGE, rain);
            if (flag || overwritten || thunder != held.thunder) tell(player, ClientboundGameEventPacket.THUNDER_LEVEL_CHANGE, thunder);
            held.raining = raining;
            held.rain = rain;
            held.thunder = thunder;
${ambience ? `            int tint = wanted != null && wanted.length > 3 ? (int) wanted[3] : -1;
            float visibility = wanted != null && wanted.length > 4 ? wanted[4] : -1.0f;
            if (dark != held.dark || tint != held.tint || visibility != held.visibility) {
                tellDark(player, dark, tint, visibility);
                held.dark = dark;
                held.tint = tint;
                held.visibility = visibility;
            }` : `            if (dark != held.dark) {
                tellDark(player, dark);
                held.dark = dark;
            }`}
            if (back && dark == 0.0f) entries.remove();
        }
    }

    private static float approach(float from, float to) {
        return from < to ? Math.min(to, from + STEP) : Math.max(to, from - STEP);
    }

    /** One of the game's own weather packets, to this player alone. */
    private static void tell(ServerPlayer player, ClientboundGameEventPacket.Type type, float value) {
        player.connection.send(new ClientboundGameEventPacket(type, value));
    }

    /** How dark this player's game is to make it (0 to 1), to this player alone. */
    private static void tellDark(ServerPlayer player, float dark${ambience ? ", int tint, float visibility" : ""}) {
${network.send}
    }
}
`
}

/** The client's half of the weather: `network` receives the darkness and ticks it, which is what differs between Fabric and a facade target. */
function weatherClient(packageName: string, network: { imports: string; implementsInit: string; register: string }, ambience: boolean) {
  return `package ${packageName}.client;

${network.imports}import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.util.Mth;

/**
 * Generated by MineMods Studio (Boss 能力 7): how dark a boss's fight makes this player's game, as the server told it (only a player of the fight is told), eased
 * over ${RAMP} ticks; the mixins ${BOSS_WEATHER.dark} and ${BOSS_WEATHER.sky} read it every frame. A world this game has left takes its darkness with it.
 */
public final class ${BOSS_WEATHER.client}${network.implementsInit} {
    private static final float STEP = ${single(1 / RAMP)};
    private static float target;
    private static float now;
    private static float before;
    private static ClientLevel world;${ambience ? `
    private static int tint = -1;
    private static float visibility = -1.0f;

    public static float visibility() {
        return Minecraft.getInstance().level == world ? visibility : -1.0f;
    }

    public static net.minecraft.world.phys.Vec3 tint(net.minecraft.world.phys.Vec3 base) {
        if (tint < 0 || Minecraft.getInstance().level != world) return base;
        return base.lerp(new net.minecraft.world.phys.Vec3((tint >> 16 & 255) / 255.0, (tint >> 8 & 255) / 255.0, (tint & 255) / 255.0), 0.55);
    }` : ""}

${network.register}
    private static void told(float dark${ambience ? ", int tint, float visibility" : ""}) {
        Minecraft client = Minecraft.getInstance();
        if (client.level != world) {
            world = client.level;
            now = before = 0.0f;
        }
        target = Mth.clamp(dark, 0.0f, 1.0f);${ambience ? `
        ${BOSS_WEATHER.client}.tint = tint;
        ${BOSS_WEATHER.client}.visibility = visibility;` : ""}
    }

    private static void tick() {
        Minecraft client = Minecraft.getInstance();
        if (client.level != world) {
            world = client.level;
            target = now = before = 0.0f;${ambience ? `
            tint = -1;
            visibility = -1.0f;` : ""}
            return;
        }
        before = now;
        now = now < target ? Math.min(target, now + STEP) : Math.max(target, now - STEP);
    }

    /** How dark the fight makes this frame, 0 to 1. */
    public static float dark(float partialTick) {
        return Minecraft.getInstance().level != world ? 0.0f : Mth.lerp(partialTick, before, now);
    }
}
`
}

function stanceFog(packageName: string) {
  return `package ${packageName}.mixin;

import ${packageName}.client.StudioBossWeatherClient;
import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Camera;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.FogRenderer;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(FogRenderer.class)
public abstract class StudioStanceFogMixin {
    @Shadow private static float fogRed;
    @Shadow private static float fogGreen;
    @Shadow private static float fogBlue;

    @Inject(method = "setupFog", at = @At("RETURN"))
    private static void studio$stanceFog(Camera camera, FogRenderer.FogMode mode, float distance, boolean thick, float partial, CallbackInfo info) {
        float far = StudioBossWeatherClient.visibility();
        if (far < 0.0f) return;
        RenderSystem.setShaderFogStart(Math.min(RenderSystem.getShaderFogStart(), mode == FogRenderer.FogMode.FOG_SKY ? 0.0f : far * 0.25f));
        RenderSystem.setShaderFogEnd(Math.min(RenderSystem.getShaderFogEnd(), far));
    }

    @Inject(method = "setupColor", at = @At("RETURN"))
    private static void studio$stanceTint(Camera camera, float partial, ClientLevel level, int distance, float darkness, CallbackInfo info) {
        Vec3 base = new Vec3(fogRed, fogGreen, fogBlue);
        Vec3 tint = StudioBossWeatherClient.tint(base);
        if (base == tint) return;
        fogRed = (float) tint.x;
        fogGreen = (float) tint.y;
        fogBlue = (float) tint.z;
        RenderSystem.clearColor(fogRed, fogGreen, fogBlue, 0.0f);
    }
}
`
}

function mixins(packageName: string) {
  return {
    dark: `package ${packageName}.mixin;

import ${packageName}.client.${BOSS_WEATHER.client};
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Generated by MineMods Studio (Boss 能力 7): a boss's fight darkens this player's world as the game's own boss darkening does (the light and the fog read this), at least as
 * much as the fight's darkness, and never less than the game's own.
 */
@Mixin(GameRenderer.class)
public abstract class ${BOSS_WEATHER.dark} {
    @Inject(method = "getDarkenWorldAmount", at = @At("RETURN"), cancellable = true)
    private void studio$dark(float partialTick, CallbackInfoReturnable<Float> info) {
        float dark = ${BOSS_WEATHER.client}.dark(partialTick);
        if (dark > info.getReturnValueF()) info.setReturnValue(dark);
    }
}
`,
    sky: `package ${packageName}.mixin;

import ${packageName}.client.${BOSS_WEATHER.client};
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Generated by MineMods Studio (Boss 能力 7): a boss's fight takes this player's sky and clouds toward black, by ${WEATHER_LIMITS.sky * 100}% at its darkest. */
@Mixin(ClientLevel.class)
public abstract class ${BOSS_WEATHER.sky} {
    @Inject(method = "getSkyColor", at = @At("RETURN"), cancellable = true)
    private void studio$sky(Vec3 at, float partialTick, CallbackInfoReturnable<Vec3> info) {
        float dark = ${BOSS_WEATHER.client}.dark(partialTick);
        if (dark > 0.0f) info.setReturnValue(info.getReturnValue().scale(1.0 - ${WEATHER_LIMITS.sky} * dark));
    }

    @Inject(method = "getCloudColor", at = @At("RETURN"), cancellable = true)
    private void studio$clouds(float partialTick, CallbackInfoReturnable<Vec3> info) {
        float dark = ${BOSS_WEATHER.client}.dark(partialTick);
        if (dark > 0.0f) info.setReturnValue(info.getReturnValue().scale(1.0 - ${WEATHER_LIMITS.sky} * dark));
    }
}
`,
  }
}

function lightningSource(packageName: string, styled: boolean) {
  return `package ${packageName}.entity;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LightningBolt;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Generated by MineMods Studio (Boss 能力 7): the lightning of a creature's ability, only seen and heard. Every player's game near it is told it is the game's own bolt, and
 * draws it, flashes the sky and plays its thunder; on the server it is a bolt that does nothing but wait for its end, so it sets nothing on fire, changes no block (no
 * copper is cleaned, no lightning rod powered), strikes nobody and is never saved. Who it strikes, and for how much, is the ability's own hit at the same places.
 */
public final class ${BOSS_WEATHER.lightning} {
    /** Ticks a bolt is kept on the server: longer than the game's own bolt flashes, so a player's game is never told it is gone before it is done. */
    private static final int LIFE = ${LIGHTNING_LIMITS.life};
    /** Blocks a place is lowered to find the ground a bolt comes down on. */
    private static final int GROUND = ${LIGHTNING_LIMITS.ground};

    private static final class Bolt extends LightningBolt {
        private int lived;

        private Bolt(Level level) {
            super(EntityType.LIGHTNING_BOLT, level);
            setVisualOnly(true);
        }

        @Override public void tick() {
            if (level().isClientSide()) {
                super.tick();
                return;
            }
            if (++lived > LIFE) discard();
        }

        @Override public boolean shouldBeSaved() { return false; }
    }

    private ${BOSS_WEATHER.lightning}() {}

    /** A bolt on every place (x, y, z each), on the ground under it. Called on the server; null or empty places strike nothing. */
${styled ? `    public static void show(Level level, double[] places, java.util.function.BiConsumer<ServerLevel, net.minecraft.world.phys.Vec3> draw) {
        if (!(level instanceof ServerLevel world) || places == null) return;
        for (int i = 0; i + 2 < places.length; i += 3) {
            draw.accept(world, new net.minecraft.world.phys.Vec3(places[i], ground(world, places[i], places[i + 1], places[i + 2]), places[i + 2]));
        }
    }
` : ""}    public static void strike(Level level, double[] places) {
        if (!(level instanceof ServerLevel world) || places == null) return;
        for (int at = 0; at + 2 < places.length; at += 3) {
            Bolt bolt = new Bolt(world);
            bolt.moveTo(places[at], ground(world, places[at], places[at + 1], places[at + 2]), places[at + 2]);
            world.addFreshEntity(bolt);
        }
    }

    /** The top of the first block under (x, y, z) that something can stand on, within GROUND blocks; y itself where there is none or it is not loaded. */
    private static double ground(ServerLevel world, double x, double y, double z) {
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int top = Mth.floor(y - 0.01);
        for (int below = 0; below <= GROUND; below++) {
            pos.set(Mth.floor(x), top - below, Mth.floor(z));
            if (!world.isLoaded(pos)) return y;
            VoxelShape shape = world.getBlockState(pos).getCollisionShape(world, pos);
            if (!shape.isEmpty()) return pos.getY() + shape.max(Direction.Axis.Y);
        }
        return y;
    }
}
`
}

/** Fabric 1.21.1: the darkness's packet is a payload of its own, registered by the server class's entry point and received by the client class's. */
function fabricSources(packageName: string, modId: string, ambience: boolean) {
  return {
    server: weatherServer(packageName, {
      imports: `import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
`,
      implementsInit: " implements ModInitializer",
      members: `    /** How dark a player's game is to make it, 0 to 1. */
    public record Sky(float dark${ambience ? ", int tint, float visibility" : ""}) implements CustomPacketPayload {
        public static final Type<Sky> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(${JSON.stringify(modId)}, ${JSON.stringify(BOSS_WEATHER.packet)}));
        public static final StreamCodec<RegistryFriendlyByteBuf, Sky> CODEC = StreamCodec.composite(ByteBufCodecs.FLOAT, Sky::dark, ${ambience ? "ByteBufCodecs.INT, Sky::tint, ByteBufCodecs.FLOAT, Sky::visibility, " : ""}Sky::new);
        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
    }

    @Override public void onInitialize() {
        // Both sides know the packet; only the server sends it. The weather is moved at the end of every server tick.
        PayloadTypeRegistry.playS2C().register(Sky.ID, Sky.CODEC);
        ServerTickEvents.END_SERVER_TICK.register(${BOSS_WEATHER.server}::tick);
    }
`,
      send: `        // A player whose game does not have this mod is skipped: the game would refuse the packet.
        if (ServerPlayNetworking.canSend(player, Sky.ID)) ServerPlayNetworking.send(player, new Sky(dark${ambience ? ", tint, visibility" : ""}));`,
    }, ambience),
    client: weatherClient(packageName, {
      imports: `import ${packageName}.entity.${BOSS_WEATHER.server};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
`,
      implementsInit: " implements ClientModInitializer",
      register: `    @Override public void onInitializeClient() {
        ClientPlayNetworking.registerGlobalReceiver(${BOSS_WEATHER.server}.Sky.ID, (payload, context) -> context.client().execute(() -> told(payload.dark()${ambience ? ", payload.tint(), payload.visibility()" : ""})));
        ClientTickEvents.END_CLIENT_TICK.register(client -> tick());
    }

`,
    }, ambience),
  }
}

/** A facade target (Forge, NeoForge): the darkness's packet is a plain record on a channel of the facade, made by the server class's `register()` and received through the client's. */
function facadeSources(packageName: string, ambience: boolean) {
  return {
    server: weatherServer(packageName, {
      imports: `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraft.network.FriendlyByteBuf;
`,
      implementsInit: "",
      members: `    /** How dark a player's game is to make it, 0 to 1. */
    public record Sky(float dark${ambience ? ", int tint, float visibility" : ""}) {
        static void write(Sky sky, FriendlyByteBuf buffer) {
            buffer.writeFloat(sky.dark);${ambience ? `
            buffer.writeInt(sky.tint);
            buffer.writeFloat(sky.visibility);` : ""}
        }

        static Sky read(FriendlyByteBuf buffer) {
            return new Sky(buffer.readFloat()${ambience ? ", buffer.readInt(), buffer.readFloat()" : ""});
        }
    }

    /** Both sides know the packet; only the server sends it and only a player's game reads it. */
    public static final ${PLATFORM_CLASS}.Channel<Sky> CHANNEL = ${PLATFORM_CLASS}.s2c(${JSON.stringify(BOSS_WEATHER.packet)}, Sky.class, Sky::write, Sky::read);

    /** Run by the common entry while the mod is constructed: makes the channel (its field above) and moves the weather at the end of every server tick. */
    public static void register() {
        ${PLATFORM_CLASS}.onServerTick(${BOSS_WEATHER.server}::tick);
    }
`,
      send: `        CHANNEL.sendTo(player, new Sky(dark${ambience ? ", tint, visibility" : ""}));`,
    }, ambience),
    client: weatherClient(packageName, {
      imports: `import ${packageName}.entity.${BOSS_WEATHER.server};
import ${packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};
`,
      implementsInit: "",
      register: `    /** Run once by the client entry: what this player's game does with the darkness it is told, and its easing every client tick. */
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.onS2C(${BOSS_WEATHER.server}.CHANNEL, sky -> told(sky.dark()${ambience ? ", sky.tint(), sky.visibility()" : ""}));
        ${CLIENT_PLATFORM_CLASS}.onClientTick(${BOSS_WEATHER.client}::tick);
    }

`,
    }, ambience),
  }
}

/**
 * `target`: Fabric 1.21.1 (the default) writes the weather's packet and ticks with Fabric API and names its two classes in fabric.mod.json; a facade target writes them through
 * the facade, maps every class to its game version and gives its entries (`entries`). The mixins are added to the template's list, in its client section, on every target.
 * The lightning names only the game, the same on every target.
 */
export function compileBossWeather(value: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const pack = input.packageName.replaceAll(".", "/")
  const facade = target.loader.facade
  const weather = input.weather ? (facade ? facadeSources(input.packageName, input.ambience) : fabricSources(input.packageName, input.modId, input.ambience)) : null
  const mixed = input.weather ? mixins(input.packageName) : null
  const sky = mixed ? input.tint ? tintedSky(mixed.sky, input.packageName) : mixed.sky : ""
  const stanceSky = input.ambience ? sky.replaceAll(/if \(dark > 0\.0f\) info\.setReturnValue\((.+)\);/g,
    'info.setReturnValue(' + BOSS_WEATHER.client + '.tint($1));')
    .replaceAll(/info\.setReturnValue\((StudioCinematicClient\.tint\(.+\))\);/g,
      'info.setReturnValue(' + BOSS_WEATHER.client + '.tint($1));') : sky
  const written: Record<string, string> = {
    ...(weather
      ? {
          [`${source}/entity/${BOSS_WEATHER.server}.java`]: weather.server,
          [`${source}/client/${BOSS_WEATHER.client}.java`]: weather.client,
          [`${source}/mixin/${BOSS_WEATHER.dark}.java`]: mixed!.dark,
          [`${source}/mixin/${BOSS_WEATHER.sky}.java`]: stanceSky,
          ...(input.ambience ? { [`${source}/mixin/StudioStanceFogMixin.java`]: stanceFog(input.packageName) } : {}),
        }
      : {}),
    ...(input.lightning ? { [`${source}/entity/${BOSS_WEATHER.lightning}.java`]: lightningSource(input.packageName, input.styled) } : {}),
  }
  const files = facade ? Object.fromEntries(Object.entries(written).map(([name, text]) => [name, target.version.rewriteJava(text)])) : written
  const edit = (text: string, change: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const edited = `${JSON.stringify(change(z.record(z.string(), z.unknown()).parse(JSON.parse(text))), null, 2)}\n`
    return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
  }
  const mixinList = `src/main/resources/${input.modId}.mixins.json`
  const clientMixins = [BOSS_WEATHER.dark, BOSS_WEATHER.sky, ...(input.ambience ? ["StudioStanceFogMixin"] : [])]
  return {
    files,
    /** Paths inside the built jar that prove the weather and the lightning went in. */
    classes: [
      ...(weather ? [`${pack}/entity/${BOSS_WEATHER.server}.class`, `${pack}/client/${BOSS_WEATHER.client}.class`, `${pack}/mixin/${BOSS_WEATHER.dark}.class`, `${pack}/mixin/${BOSS_WEATHER.sky}.class`] : []),
      ...(input.lightning ? [`${pack}/entity/${BOSS_WEATHER.lightning}.class`] : []),
    ],
    /**
     * Edits to files the scaffold wrote: the mixins go in the template's mixin list, in its \`client\` section (the sky exists only in a player's game, so a server never loads them);
     * on Fabric the two classes are also named as entry points (both sides know the packet, only a player's game receives it).
     */
    patch: (!weather
      ? {}
      : facade
        ? { [mixinList]: (text: string) => target.loader.addMixins(text, { client: clientMixins }) }
        : {
            "src/main/resources/fabric.mod.json": (text: string) =>
              edit(text, (metadata) => {
                const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
                return { ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${BOSS_WEATHER.server}`], client: [...entrypoints.client, `${input.packageName}.client.${BOSS_WEATHER.client}`] } }
              }),
            [mixinList]: (text: string) => edit(text, (list) => ({ ...list, client: [...z.array(z.string()).default([]).parse(list.client), ...clientMixins] })),
          }) as Record<string, (text: string) => string>,
    /** What a facade target's common entry and client entry run (\`<class>.register()\`); Fabric names its entry points in fabric.mod.json. */
    entries: { common: weather && facade ? [`${input.packageName}.entity.${BOSS_WEATHER.server}`] : [], client: weather && facade ? [`${input.packageName}.client.${BOSS_WEATHER.client}`] : [] },
  }
}

/** When both are present one return callback darkens then tints: cancelling the return cannot skip either half. */
function tintedSky(sky: string, packageName: string) {
  return sky.replace("import net.minecraft.client.multiplayer.ClientLevel;", `import net.minecraft.client.multiplayer.ClientLevel;\nimport ${packageName}.client.StudioCinematicClient;`)
    .replaceAll(`if (dark > 0.0f) info.setReturnValue(info.getReturnValue().scale(1.0 - ${WEATHER_LIMITS.sky} * dark));`,
      `info.setReturnValue(StudioCinematicClient.tint(info.getReturnValue().scale(1.0 - ${WEATHER_LIMITS.sky} * dark), partialTick));`)
}
