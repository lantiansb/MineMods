import { z } from "zod"
import { BossBarDocumentSchema, bossBarLayout, bossBarLines, bossBarMasks, DOT, type BossBarLayout, type Picture } from "../boss-bar"
import { encodePng } from "../png"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * A boss's own bar (Boss 能力 6) as what it adds to a generated mod. Only written when some boss of the project shows a bar asset (`boss.bar.look`), so a project
 * without one is untouched, byte for byte.
 *
 * - the bar's pictures, once per bar asset: `assets/<mod>/textures/gui/bossbar/bar_<asset>/background.png`, `fill.png`, `lock_<frame>.png`, `icon_<index>.png`;
 * - per boss, the layout its HUD reads: `assets/<mod>/studio/bossbar/<creature>.json` (where everything is, the boss's own lines of life, the language key of every stage's name);
 * - `StudioBossBarState` (common): what the server tells a player's game about the bar (stage, life, icons lit, which name, when the last lock broke, the arena's dots), with
 *   its write and read on a `FriendlyByteBuf`, and the three rules the HUD draws by (`filled`, `lockFrame`, `litIcons`), each the very rule the Studio preview draws by (`boss-bar.ts`);
 * - `StudioBossBars` (common): per creature, the icons' masks the server lights them from;
 * - `StudioBossBarHud` (client): draws one bar from its layout and a state into a `GuiGraphics`;
 * - `StudioBossBarSync` (common): the packet that carries a state (with the id of the game's bar it belongs to and the creature whose layout draws it), and its sending, by the boss
 *   (`entity-boss.ts`) whenever the state changes, to the players of its bar only;
 * - `StudioBossBarClient` (client): the states a player's game was told, and the drawing of one bar in place of the game's own; the layouts are read again after resources are reloaded.
 *
 * The state, the masks and the HUD name only Minecraft's own classes (Mojang's names, 1.21.1). The packet and the hook into the game's boss bars are the loader's:
 * - Fabric 1.21.1 (its own text, as every Fabric file): a `CustomPacketPayload` registered by a main entry point, a receiver and a reload listener set up by a client entry point,
 *   and a mixin into the game's boss bar overlay (`StudioBossBarOverlayMixin`, the client section of the mixin list) that draws the bars the mod has its own of and leaves the others to the game;
 * - Forge and NeoForge: through the facade (`StudioPlatform.s2c`, `StudioClientPlatform.onS2C`, `onBossBar` on the loader's boss bar event, `onReload`), run from the entries.
 * A bar whose layout the game cannot find (a resource pack took it away) is drawn by the game as before.
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  bosses: z
    .array(
      z.strictObject({
        /** The creature's registry path (`creatureName`): its layout file is named after it. */
        creature: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        bar: z.strictObject({ id: z.uuid(), document: BossBarDocumentSchema }),
        /** The boss's phases; only their lines of life are read. */
        phases: z.array(z.object({ below: z.number() })),
        /** The creature's choices in the generated Java's order: its abilities' ids, then its combos'. */
        choices: z.array(z.string()),
      }),
    )
    .min(1),
})

/** The classes, the folder of the pictures and of the layouts, and the version of the layout file. */
export const BOSS_BAR = {
  state: "StudioBossBarState",
  bars: "StudioBossBars",
  hud: "StudioBossBarHud",
  sync: "StudioBossBarSync",
  client: "StudioBossBarClient",
  mixin: "StudioBossBarOverlayMixin",
  packet: "studio_boss_bar",
  textures: "textures/gui/bossbar",
  layouts: "studio/bossbar",
  format: 1,
} as const

const png = (picture: Picture) => encodePng(picture.pixels, picture.width, picture.height)
/** The folder of a bar asset's pictures, under the mod's assets. */
export const bossBarFolder = (id: string) => `${BOSS_BAR.textures}/bar_${id.replaceAll("-", "")}/`
/** The language key of a stage's name on a creature's bar. */
export const bossBarNameKey = (modId: string, creature: string, stage: number) => `bossbar.${modId}.${creature}.phase${stage}`

/** The layout file of one boss: everything its HUD needs to draw the bar, read from the resolved layout (the same one the preview draws). */
export function bossBarLayoutJson(modId: string, creature: string, id: string, layout: BossBarLayout, lines: readonly number[], masks: readonly number[]) {
  return {
    format: BOSS_BAR.format,
    folder: bossBarFolder(id),
    width: layout.background.width,
    height: layout.background.height,
    drain: layout.drain,
    lines: [...lines],
    segments: layout.segments.map((segment) => ({ x: segment.x, y: segment.y, width: segment.width, height: segment.height })),
    lock: { frames: layout.lock.frames.length, width: layout.lock.frames[0]!.width, height: layout.lock.frames[0]!.height, ticks: layout.lock.ticks, at: layout.lock.at },
    icons: layout.icons.map((icon, index) => ({ x: icon.x, y: icon.y, width: icon.image.width, height: icon.image.height, abilities: icon.abilities, mask: masks[index] ?? 0 })),
    names: layout.names.map((_, stage) => bossBarNameKey(modId, creature, stage)),
    name_at: layout.name_at,
    dots: layout.dots,
    dim: layout.dim,
  }
}

const argb = (color: readonly number[]) => `0x${[255, color[0]!, color[1]!, color[2]!].map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`

function stateSource(packageName: string) {
  return `package ${packageName}.entity;

import java.util.Objects;
import net.minecraft.network.FriendlyByteBuf;

/**
 * Generated by MineMods Studio: what the server tells one player's game about a boss's own bar (Boss 能力 6). Sent by ${BOSS_BAR.sync} only to the players of the boss's bar,
 * whenever it changes; the game draws it with ${packageName}.client.${BOSS_BAR.hud}.
 * - phase: the stage the fight is in (0 before the first line of life).
 * - health: the boss's life as a share of its whole (0 to 1).
 * - litIcons: a bit for each icon of the bar that is lit (${BOSS_BAR.bars}.icons with litIcons below).
 * - phaseName: which stage's name is shown (normally the phase).
 * - lockBreak: the server's game time when the last lock broke (the moment the boss crossed into this phase); -1 for none.
 * - dots, litDots: the arena's row of dots (how many, a bit for each lit one); 0 for a bar that shows none. Kept for the arena's fixtures; nothing lights them yet.
 */
public final class ${BOSS_BAR.state} {
    public final int phase;
    public final float health;
    public final int litIcons;
    public final int phaseName;
    public final long lockBreak;
    public final int dots;
    public final int litDots;

    public ${BOSS_BAR.state}(int phase, float health, int litIcons, int phaseName, long lockBreak, int dots, int litDots) {
        this.phase = phase;
        this.health = health;
        this.litIcons = litIcons;
        this.phaseName = phaseName;
        this.lockBreak = lockBreak;
        this.dots = dots;
        this.litDots = litDots;
    }

    public void write(FriendlyByteBuf buf) {
        buf.writeVarInt(phase);
        buf.writeFloat(health);
        buf.writeVarInt(litIcons);
        buf.writeVarInt(phaseName);
        buf.writeLong(lockBreak);
        buf.writeVarInt(dots);
        buf.writeVarInt(litDots);
    }

    public static ${BOSS_BAR.state} read(FriendlyByteBuf buf) {
        int phase = buf.readVarInt();
        float health = buf.readFloat();
        int litIcons = buf.readVarInt();
        int phaseName = buf.readVarInt();
        long lockBreak = buf.readLong();
        int dots = buf.readVarInt();
        int litDots = buf.readVarInt();
        return new ${BOSS_BAR.state}(phase, health, litIcons, phaseName, lockBreak, dots, litDots);
    }

    /** The same state: nothing to send again. */
    @Override public boolean equals(Object other) {
        return other instanceof ${BOSS_BAR.state} state && phase == state.phase && Float.compare(health, state.health) == 0 && litIcons == state.litIcons && phaseName == state.phaseName
            && lockBreak == state.lockBreak && dots == state.dots && litDots == state.litDots;
    }

    @Override public int hashCode() { return Objects.hash(phase, health, litIcons, phaseName, lockBreak, dots, litDots); }

    /**
     * Which icons are lit while choice running (the creature's abilities, then its combos, by place; -1 none) runs and, inside a combo, ability step plays (-1 none).
     * masks: ${BOSS_BAR.bars}.icons(creature).
     */
    public static int litIcons(int[] masks, int running, int step) {
        int lit = 0;
        for (int index = 0; index < masks.length; index++) {
            if ((running >= 0 && ((masks[index] >>> running) & 1) != 0) || (step >= 0 && ((masks[index] >>> step) & 1) != 0)) lit |= 1 << index;
        }
        return lit;
    }

    /** How many pixels of a segment width wide are full: the share of its stage's life left. lines: the top of every stage (1, then each phase's line). */
    public static int filled(int width, double[] lines, int stage, double health) {
        double high = stage >= 0 && stage < lines.length ? lines[stage] : 0.0;
        double low = stage + 1 >= 0 && stage + 1 < lines.length ? lines[stage + 1] : 0.0;
        double share = high > low ? Math.min(1.0, Math.max(0.0, (health - low) / (high - low))) : 0.0;
        return (int) Math.floor(width * share + 0.5);
    }

    /** The frame of the lock on line (between stage line and the next) to draw, -1 for none: whole until crossed, then each frame ticks ticks from the break (elapsed ticks ago, negative: unknown), then gone. */
    public static int lockFrame(int line, int phase, long elapsed, int frames, int ticks) {
        if (phase <= line) return 0;
        if (phase == line + 1 && elapsed >= 0 && elapsed < (long) (frames - 1) * ticks) return 1 + (int) (elapsed / ticks);
        return -1;
    }
}
`
}

function barsSource(packageName: string, bosses: { creature: string; masks: number[] }[]) {
  return `package ${packageName}.entity;

/** Generated by MineMods Studio: the bosses that show a bar of their own (Boss 能力 6), and what lights each icon of it. */
public final class ${BOSS_BAR.bars} {
    private ${BOSS_BAR.bars}() {}

    /** Whether the creature (its registry path) shows a bar of its own; its layout is assets/<mod>/${BOSS_BAR.layouts}/<creature>.json. */
    public static boolean has(String creature) {
        return icons(creature) != null;
    }

    /** For each icon of the creature's bar, a bit for every choice (its abilities, then its combos, by place) that lights it; null for a creature that shows the game's bar. */
    public static int[] icons(String creature) {
        switch (creature) {
${bosses.map((boss) => `            case ${JSON.stringify(boss.creature)}: return new int[] {${boss.masks.join(", ")}};`).join("\n")}
            default: return null;
        }
    }
}
`
}

function hudSource(packageName: string, modId: string) {
  return `package ${packageName}.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.systems.RenderSystem;
import java.io.Reader;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;
import ${packageName}.entity.${BOSS_BAR.state};

/**
 * Generated by MineMods Studio: draws a boss's own bar (Boss 能力 6) from its layout (assets/${modId}/${BOSS_BAR.layouts}/<creature>.json) and the state the server sent, in the
 * order and by the rules the Studio preview draws it: the background, each stage's segment as full as its share of life, the locks, the icons (dimmed unless lit), the arena's dots,
 * and the stage's name. ${BOSS_BAR.client} calls render where the game would draw that boss's bar, and the game's bar is left out.
 */
public final class ${BOSS_BAR.hud} {
    private ${BOSS_BAR.hud}() {}

    private static final String NAMESPACE = ${JSON.stringify(modId)};
    private static final int DOT_LIT = ${argb(DOT.lit)};
    private static final int DOT_DARK = ${argb(DOT.dark)};
    private static final Map<String, Optional<Layout>> LAYOUTS = new HashMap<>();

    /** Forgets every layout read, so the next frame reads them again (after resource packs are reloaded). */
    public static void clear() {
        LAYOUTS.clear();
    }

    /** Whether the creature (its registry path) has a layout in the loaded resources. */
    public static boolean has(String creature) {
        return layout(creature) != null;
    }

    /**
     * Draws the bar of the creature (its registry path) at the top of the screen, centred, top pixels down (the line with the boss's name first), scaled down to fit the screen.
     * title: the boss's name (the game's bar shows it). Returns how many pixels it took (the next bar goes below), 0 when there is no layout for it (draw the game's bar instead).
     */
    public static int render(GuiGraphics graphics, String creature, ${BOSS_BAR.state} state, Component title, int top) {
        Layout layout = layout(creature);
        if (layout == null) return 0;
        Minecraft minecraft = Minecraft.getInstance();
        Font font = minecraft.font;
        float scale = Math.min(1.0f, (graphics.guiWidth() - 16) / (float) layout.width);
        int left = (graphics.guiWidth() - Math.round(layout.width * scale)) / 2;
        Component name = Component.translatable(layout.names[Math.max(0, Math.min(layout.names.length - 1, state.phaseName))]);
        // A stage named as the boss is (an AI named both 「石像」 in the UI run of 2026-11-15) is not said twice.
        boolean twice = name.getString().equals(title.getString());
        graphics.drawCenteredString(font, layout.nameAt == null && !twice ? title.copy().append(Component.literal(" · ")).append(name) : title, graphics.guiWidth() / 2, top, 0xFFFFFF);
        graphics.pose().pushPose();
        graphics.pose().translate((float) left, (float) (top + font.lineHeight + 2), 0.0f);
        graphics.pose().scale(scale, scale, 1.0f);
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        graphics.blit(layout.background, 0, 0, 0.0f, 0.0f, layout.width, layout.height, layout.width, layout.height);
        for (int stage = 0; stage < layout.segments.length; stage++) {
            int[] segment = layout.segments[stage];
            int filled = ${BOSS_BAR.state}.filled(segment[2], layout.lines, stage, state.health);
            if (filled <= 0) continue;
            int x = layout.drainLeft ? segment[0] : segment[0] + segment[2] - filled;
            graphics.blit(layout.fill, x, segment[1], (float) x, (float) segment[1], filled, segment[3], layout.width, layout.height);
        }
        long elapsed = state.lockBreak < 0L || minecraft.level == null ? -1L : minecraft.level.getGameTime() - state.lockBreak;
        for (int line = 0; line < layout.locks.length; line++) {
            int frame = ${BOSS_BAR.state}.lockFrame(line, state.phase, elapsed, layout.lockFrames.length, layout.lockTicks);
            if (frame < 0) continue;
            graphics.blit(layout.lockFrames[frame], layout.locks[line][0], layout.locks[line][1], 0.0f, 0.0f, layout.lockWidth, layout.lockHeight, layout.lockWidth, layout.lockHeight);
        }
        for (int index = 0; index < layout.icons.length; index++) {
            int[] icon = layout.icons[index];
            if (((state.litIcons >>> index) & 1) == 0) graphics.setColor(layout.dim, layout.dim, layout.dim, 1.0f);
            graphics.blit(layout.iconTextures[index], icon[0], icon[1], 0.0f, 0.0f, icon[2], icon[3], icon[2], icon[3]);
            graphics.setColor(1.0f, 1.0f, 1.0f, 1.0f);
        }
        if (layout.dots != null && state.dots > 0) {
            int size = layout.dots[3];
            int gap = layout.dots[2];
            int across = state.dots * size + (state.dots - 1) * gap;
            for (int index = 0; index < state.dots; index++) {
                int x = layout.dots[0] - across / 2 + index * (size + gap);
                graphics.fill(x, layout.dots[1], x + size, layout.dots[1] + size, ((state.litDots >>> index) & 1) != 0 ? DOT_LIT : DOT_DARK);
            }
        }
        if (layout.nameAt != null) graphics.drawCenteredString(font, name, layout.nameAt[0], layout.nameAt[1] - font.lineHeight / 2, 0xFFFFFF);
        RenderSystem.disableBlend();
        graphics.pose().popPose();
        return font.lineHeight + 2 + Math.round(layout.height * scale) + 3;
    }

    private static Layout layout(String creature) {
        return LAYOUTS.computeIfAbsent(creature, ${BOSS_BAR.hud}::read).orElse(null);
    }

    private static Optional<Layout> read(String creature) {
        Optional<Resource> resource = Minecraft.getInstance().getResourceManager().getResource(ResourceLocation.fromNamespaceAndPath(NAMESPACE, ${JSON.stringify(`${BOSS_BAR.layouts}/`)} + creature + ".json"));
        if (resource.isEmpty()) return Optional.empty();
        try (Reader reader = resource.get().openAsReader()) {
            return Optional.of(new Layout(JsonParser.parseReader(reader).getAsJsonObject()));
        } catch (Exception failure) {
            return Optional.empty();
        }
    }

    private static int[][] rows(JsonArray array, String... keys) {
        int[][] rows = new int[array.size()][keys.length];
        for (int index = 0; index < array.size(); index++) {
            JsonObject row = array.get(index).getAsJsonObject();
            for (int key = 0; key < keys.length; key++) rows[index][key] = row.get(keys[key]).getAsInt();
        }
        return rows;
    }

    /** One layout file, read once. */
    private static final class Layout {
        final int width;
        final int height;
        final boolean drainLeft;
        final double[] lines;
        final int[][] segments;
        final int lockTicks;
        final int lockWidth;
        final int lockHeight;
        final int[][] locks;
        final ResourceLocation[] lockFrames;
        final int[][] icons;
        final ResourceLocation[] iconTextures;
        final String[] names;
        final int[] nameAt;
        final int[] dots;
        final float dim;
        final ResourceLocation background;
        final ResourceLocation fill;

        Layout(JsonObject json) {
            String folder = json.get("folder").getAsString();
            width = json.get("width").getAsInt();
            height = json.get("height").getAsInt();
            drainLeft = !"right".equals(json.get("drain").getAsString());
            JsonArray lineArray = json.getAsJsonArray("lines");
            lines = new double[lineArray.size()];
            for (int index = 0; index < lines.length; index++) lines[index] = lineArray.get(index).getAsDouble();
            segments = rows(json.getAsJsonArray("segments"), "x", "y", "width", "height");
            JsonObject lock = json.getAsJsonObject("lock");
            lockTicks = Math.max(1, lock.get("ticks").getAsInt());
            lockWidth = lock.get("width").getAsInt();
            lockHeight = lock.get("height").getAsInt();
            locks = rows(lock.getAsJsonArray("at"), "x", "y");
            lockFrames = new ResourceLocation[lock.get("frames").getAsInt()];
            for (int frame = 0; frame < lockFrames.length; frame++) lockFrames[frame] = ResourceLocation.fromNamespaceAndPath(NAMESPACE, folder + "lock_" + frame + ".png");
            icons = rows(json.getAsJsonArray("icons"), "x", "y", "width", "height");
            iconTextures = new ResourceLocation[icons.length];
            for (int index = 0; index < icons.length; index++) iconTextures[index] = ResourceLocation.fromNamespaceAndPath(NAMESPACE, folder + "icon_" + index + ".png");
            JsonArray nameArray = json.getAsJsonArray("names");
            names = new String[nameArray.size()];
            for (int index = 0; index < names.length; index++) names[index] = nameArray.get(index).getAsString();
            JsonElement at = json.get("name_at");
            nameAt = at == null || at.isJsonNull() ? null : new int[] {at.getAsJsonObject().get("x").getAsInt(), at.getAsJsonObject().get("y").getAsInt()};
            JsonElement row = json.get("dots");
            dots = row == null || row.isJsonNull() ? null : new int[] {row.getAsJsonObject().get("x").getAsInt(), row.getAsJsonObject().get("y").getAsInt(), row.getAsJsonObject().get("gap").getAsInt(), row.getAsJsonObject().get("size").getAsInt()};
            dim = json.get("dim").getAsFloat();
            background = ResourceLocation.fromNamespaceAndPath(NAMESPACE, folder + "background.png");
            fill = ResourceLocation.fromNamespaceAndPath(NAMESPACE, folder + "fill.png");
        }
    }
}
`
}

/** The packet (its record and how it is written) and the server's side of sending it. Fabric: a payload of its own, registered by the main entry point; a facade target: a channel of the facade. */
function syncSource(packageName: string, modId: string, facade: boolean) {
  const record = (implementsPayload: string, extra: string) => `    /** One boss's bar: the id of the game's bar it is drawn in place of, the creature (its registry path) whose layout draws it, and what it shows. */
    public record Bar(UUID id, String creature, ${BOSS_BAR.state} state)${implementsPayload} {
${extra}        public static void write(Bar bar, FriendlyByteBuf buffer) {
            buffer.writeUUID(bar.id);
            buffer.writeUtf(bar.creature);
            bar.state.write(buffer);
        }

        public static Bar read(FriendlyByteBuf buffer) {
            return new Bar(buffer.readUUID(), buffer.readUtf(), ${BOSS_BAR.state}.read(buffer));
        }
    }
`
  const doc = `/**
 * Generated by MineMods Studio: the packet that tells a player's game what a boss's own bar shows (Boss 能力 6), and the server's side of sending it. The boss sends its state
 * whenever it changes, and again whenever a player starts seeing it, to the players of its bar only (the game's bar: the players that see the boss).
 */`
  if (facade)
    return `package ${packageName}.entity;

import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import java.util.Collection;
import java.util.UUID;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerPlayer;

${doc}
public final class ${BOSS_BAR.sync} {
${record("", "")}
    /** Both sides know the packet; only the server sends it and only a player's game reads it. */
    public static final ${PLATFORM_CLASS}.Channel<Bar> CHANNEL = ${PLATFORM_CLASS}.s2c(${JSON.stringify(BOSS_BAR.packet)}, Bar.class, Bar::write, Bar::read);

    /** Makes the channel while the mod is constructed (its field above), which is when the loader takes it. */
    public static void register() {}

    /** Tells each of \`players\` what the bar \`id\` of the creature shows. */
    public static void send(Collection<ServerPlayer> players, UUID id, String creature, ${BOSS_BAR.state} state) {
        Bar bar = new Bar(id, creature, state);
        for (ServerPlayer player : players) CHANNEL.sendTo(player, bar);
    }
}
`
  return `package ${packageName}.entity;

import java.util.Collection;
import java.util.UUID;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;

${doc}
public final class ${BOSS_BAR.sync} implements ModInitializer {
${record(
  " implements CustomPacketPayload",
  `        public static final Type<Bar> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(${JSON.stringify(modId)}, ${JSON.stringify(BOSS_BAR.packet)}));
        public static final StreamCodec<RegistryFriendlyByteBuf, Bar> CODEC = StreamCodec.of((buffer, bar) -> write(bar, buffer), Bar::read);

        @Override public Type<? extends CustomPacketPayload> type() { return ID; }

`,
)}
    @Override public void onInitialize() {
        // Both sides know the packet; only the server sends it and only a player's game reads it.
        PayloadTypeRegistry.playS2C().register(Bar.ID, Bar.CODEC);
    }

    /** Tells each of \`players\` what the bar \`id\` of the creature shows. A player whose game does not have this mod is skipped: the game would refuse the packet. */
    public static void send(Collection<ServerPlayer> players, UUID id, String creature, ${BOSS_BAR.state} state) {
        Bar bar = new Bar(id, creature, state);
        for (ServerPlayer player : players) {
            if (ServerPlayNetworking.canSend(player, Bar.ID)) ServerPlayNetworking.send(player, bar);
        }
    }
}
`
}

/**
 * What a player's game keeps of the bars and how it draws one: the last state of each bar the server told it of (by the id of the game's bar), forgotten when the player is in
 * another world; `draw` is asked for every bar the game shows. Fabric: a client entry point (the receiver, a reload listener); a facade target: `register()`, run by the client entry.
 */
function clientSource(packageName: string, modId: string, facade: boolean) {
  const imports = facade
    ? [`${packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS}`]
    : [
        "net.fabricmc.api.ClientModInitializer",
        "net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking",
        "net.fabricmc.fabric.api.resource.ResourceManagerHelper",
        "net.fabricmc.fabric.api.resource.SimpleSynchronousResourceReloadListener",
        "net.minecraft.resources.ResourceLocation",
        "net.minecraft.server.packs.PackType",
        "net.minecraft.server.packs.resources.ResourceManager",
      ]
  const lines = [...imports, `${packageName}.entity.${BOSS_BAR.state}`, `${packageName}.entity.${BOSS_BAR.sync}`, "java.util.HashMap", "java.util.Map", "java.util.UUID", "net.minecraft.client.Minecraft", "net.minecraft.client.gui.GuiGraphics", "net.minecraft.client.multiplayer.ClientLevel", "net.minecraft.world.BossEvent"]
  const setup = facade
    ? `    /** Run once by the client entry: the packet's receiver, the boss bars drawn here, and the layouts read again after a reload of the resources. */
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.onS2C(${BOSS_BAR.sync}.CHANNEL, bar -> keep(bar.id(), bar.creature(), bar.state()));
        ${CLIENT_PLATFORM_CLASS}.onBossBar(${BOSS_BAR.client}::draw);
        ${CLIENT_PLATFORM_CLASS}.onReload(${BOSS_BAR.hud}::clear);
    }
`
    : `    @Override public void onInitializeClient() {
        ClientPlayNetworking.registerGlobalReceiver(${BOSS_BAR.sync}.Bar.ID, (bar, context) -> context.client().execute(() -> keep(bar.id(), bar.creature(), bar.state())));
        // The layouts are resources: a resource pack may change them, so they are read again after every reload.
        ResourceManagerHelper.get(PackType.CLIENT_RESOURCES).registerReloadListener(new SimpleSynchronousResourceReloadListener() {
            @Override public ResourceLocation getFabricId() { return ResourceLocation.fromNamespaceAndPath(${JSON.stringify(modId)}, ${JSON.stringify(BOSS_BAR.packet)}); }

            @Override public void onResourceManagerReload(ResourceManager manager) { ${BOSS_BAR.hud}.clear(); }
        });
    }
`
  return `package ${packageName}.client;

${[...new Set(lines)].sort().map((name) => `import ${name};`).join("\n")}

/**
 * Generated by MineMods Studio: the bars of their own (Boss 能力 6) a player's game was told of, and the drawing of one in place of the game's bar. A bar the server said
 * nothing of, or whose layout is not in the resources, is the game's to draw. What it was told is forgotten when the player is in another world (the server tells it again).
 */
public final class ${BOSS_BAR.client}${facade ? "" : " implements ClientModInitializer"} {
    private record Shown(String creature, ${BOSS_BAR.state} state) {}

    private static final Map<UUID, Shown> SHOWN = new HashMap<>();
    /** The world what is kept was told in. */
    private static ClientLevel world;

${setup}
    private static void keep(UUID id, String creature, ${BOSS_BAR.state} state) {
        ClientLevel level = Minecraft.getInstance().level;
        if (level != world) {
            SHOWN.clear();
            world = level;
        }
        SHOWN.put(id, new Shown(creature, state));
    }

    /** Whether the bar \`id\` is one the server told this game of. */
    public static boolean shows(UUID id) {
        return SHOWN.containsKey(id) && Minecraft.getInstance().level == world;
    }

    /** Draws the bar the game shows as \`bar\`, the line of its name at \`top\`, when it is one of the mod's own: the pixels it took, 0 to leave it to the game. */
    public static int draw(GuiGraphics graphics, BossEvent bar, int top) {
        if (Minecraft.getInstance().level != world) {
            SHOWN.clear();
            return 0;
        }
        Shown shown = SHOWN.get(bar.getId());
        return shown == null ? 0 : ${BOSS_BAR.hud}.render(graphics, shown.creature(), shown.state(), bar.getName(), top);
    }
}
`
}

/**
 * Fabric's hook into the game's boss bars (it has no event for them): at the head of `BossHealthOverlay.render`, when some bar shown is one the mod draws itself (`shows`, a
 * static method of the id; null: whenever there is a bar), the overlay's own loop is done here instead, each bar asked of `draw` (a static method: graphics, bar, the line of its
 * name) and every other drawn exactly as the game draws it (its own `drawBar`, its name above, 19 pixels a bar, no further than a third of the screen down).
 */
export function bossBarOverlayMixin(packageName: string, call: { readonly draw: string; readonly shows: string | null; readonly imports: readonly string[] }) {
  const imports = [...call.imports, "java.util.Map", "java.util.UUID", "net.minecraft.client.Minecraft", "net.minecraft.client.gui.GuiGraphics", "net.minecraft.client.gui.components.BossHealthOverlay", "net.minecraft.client.gui.components.LerpingBossEvent", "net.minecraft.network.chat.Component", "net.minecraft.world.BossEvent", "org.spongepowered.asm.mixin.Final", "org.spongepowered.asm.mixin.Mixin", "org.spongepowered.asm.mixin.Shadow", "org.spongepowered.asm.mixin.injection.At", "org.spongepowered.asm.mixin.injection.Inject", "org.spongepowered.asm.mixin.injection.callback.CallbackInfo"]
  return `package ${packageName}.mixin;

${[...new Set(imports)].sort().map((name) => `import ${name};`).join("\n")}

/**
 * Generated by MineMods Studio: a boss's own bar (Boss 能力 6) in place of the game's. When none of the bars shown is the mod's own, the game draws them all as ever;
 * when one is, they are drawn here in the game's order and places, that one by the mod and every other by the game's own drawBar.
 */
@Mixin(BossHealthOverlay.class)
public abstract class ${BOSS_BAR.mixin} {
    @Shadow @Final private Minecraft minecraft;
    @Shadow @Final Map<UUID, LerpingBossEvent> events;

    @Shadow protected abstract void drawBar(GuiGraphics graphics, int x, int y, BossEvent bar);

    @Inject(method = "render", at = @At("HEAD"), cancellable = true)
    private void studio$bossBars(GuiGraphics graphics, CallbackInfo info) {
        if (events.isEmpty()${call.shows ? ` || events.keySet().stream().noneMatch(${call.shows})` : ""}) return;
        info.cancel();
        int width = graphics.guiWidth();
        int y = 12;
        for (LerpingBossEvent bar : events.values()) {
            int taken = ${call.draw}(graphics, bar, y - 9);
            if (taken > 0) {
                y += taken;
            } else {
                drawBar(graphics, width / 2 - 91, y, bar);
                Component name = bar.getName();
                graphics.drawString(minecraft.font, name, width / 2 - minecraft.font.width(name) / 2, y - 9, 0xFFFFFF);
                y += 10 + 9;
            }
            if (y >= graphics.guiHeight() / 3) break;
        }
    }
}
`
}

/**
 * Everything the bosses' own bars add to the mod: the pictures of every bar asset a boss shows (once each), a layout per boss, the language of every stage's name,
 * the state, the masks and the HUD, and the packet, its client side and the hook into the game's boss bars. `classes`: where the jar must hold them (the build looks for exactly these).
 * `target`: Fabric 1.21.1 (the default) is this file's own text, with its entry points and its mixin added to fabric.mod.json and the mixin list (`patch`). A facade target gets
 * the packet and the hook through the facade, every class mapped to its game version, and the two classes whose `register()` its entries run (`entries`).
 */
export function compileBossBars(raw: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(raw)
  const resources = `src/main/resources/assets/${input.modId}`
  const root = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const files: Record<string, string | Uint8Array> = {}
  const language: Record<"zh_cn" | "en_us", Record<string, string>> = { zh_cn: {}, en_us: {} }
  const layouts = new Map<string, BossBarLayout>()
  const bosses = input.bosses.map((boss) => {
    const layout = layouts.get(boss.bar.id) ?? bossBarLayout(boss.bar.document)
    if (!layouts.has(boss.bar.id)) {
      layouts.set(boss.bar.id, layout)
      const folder = `${resources}/${bossBarFolder(boss.bar.id)}`
      files[`${folder}background.png`] = png(layout.background)
      files[`${folder}fill.png`] = png(layout.fill)
      layout.lock.frames.forEach((frame, index) => (files[`${folder}lock_${index}.png`] = png(frame)))
      layout.icons.forEach((icon, index) => (files[`${folder}icon_${index}.png`] = png(icon.image)))
    }
    const masks = bossBarMasks(layout.icons, boss.choices)
    files[`${resources}/${BOSS_BAR.layouts}/${boss.creature}.json`] = `${JSON.stringify(bossBarLayoutJson(input.modId, boss.creature, boss.bar.id, layout, bossBarLines(boss.phases), masks), null, 2)}\n`
    layout.names.forEach((name, stage) => {
      language.zh_cn[bossBarNameKey(input.modId, boss.creature, stage)] = name.zh
      language.en_us[bossBarNameKey(input.modId, boss.creature, stage)] = name.en
    })
    return { creature: boss.creature, masks }
  })
  const facade = target.loader.facade
  const java: Record<string, string> = {
    [`${root}/entity/${BOSS_BAR.state}.java`]: stateSource(input.packageName),
    [`${root}/entity/${BOSS_BAR.bars}.java`]: barsSource(input.packageName, bosses),
    [`${root}/client/${BOSS_BAR.hud}.java`]: hudSource(input.packageName, input.modId),
    [`${root}/entity/${BOSS_BAR.sync}.java`]: syncSource(input.packageName, input.modId, facade),
    [`${root}/client/${BOSS_BAR.client}.java`]: clientSource(input.packageName, input.modId, facade),
    ...(facade ? {} : { [`${root}/mixin/${BOSS_BAR.mixin}.java`]: bossBarOverlayMixin(input.packageName, { draw: `${BOSS_BAR.client}.draw`, shows: `${BOSS_BAR.client}::shows`, imports: [`${input.packageName}.client.${BOSS_BAR.client}`] }) }),
  }
  Object.entries(java).forEach(([name, text]) => (files[name] = target.version.rewriteJava(text)))
  const classPath = input.packageName.replaceAll(".", "/")
  const classes = [
    `${classPath}/entity/${BOSS_BAR.state}.class`,
    `${classPath}/entity/${BOSS_BAR.bars}.class`,
    `${classPath}/client/${BOSS_BAR.hud}.class`,
    `${classPath}/entity/${BOSS_BAR.sync}.class`,
    `${classPath}/client/${BOSS_BAR.client}.class`,
    ...(facade ? [] : [`${classPath}/mixin/${BOSS_BAR.mixin}.class`]),
  ]
  const sync = `${input.packageName}.entity.${BOSS_BAR.sync}`
  const client = `${input.packageName}.client.${BOSS_BAR.client}`
  if (facade)
    return {
      files,
      language,
      classes,
      // Forge and NeoForge hand the boss bars to an event the facade listens to: no mixin, nothing to edit.
      patch: {} as Record<string, (text: string) => string>,
      /** What the mod's common entry and its client entry run (`<class>.register()`): the packet's channel, and what a player's game does with it. */
      entries: { common: [sync], client: [client] },
    }
  const edit = (text: string, change: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const edited = `${JSON.stringify(change(z.record(z.string(), z.unknown()).parse(JSON.parse(text))), null, 2)}\n`
    return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
  }
  return {
    files,
    language,
    classes,
    /**
     * Edits to files the scaffold wrote: the packet is registered when the mod starts (both sides), its receiver when a player's game does; the overlay exists only in a
     * player's game, so the mixin is in the list's client section and a server never loads it.
     */
    patch: {
      "src/main/resources/fabric.mod.json": (text: string) =>
        edit(text, (metadata) => {
          const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
          return { ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, sync], client: [...entrypoints.client, client] } }
        }),
      [`src/main/resources/${input.modId}.mixins.json`]: (text: string) => edit(text, (mixins) => ({ ...mixins, client: [...z.array(z.string()).default([]).parse(mixins.client), BOSS_BAR.mixin] })),
    } as Record<string, (text: string) => string>,
    /** Fabric names its entry points in fabric.mod.json (the patch above): nothing for the facade's entries. */
    entries: { common: [] as string[], client: [] as string[] },
  }
}
