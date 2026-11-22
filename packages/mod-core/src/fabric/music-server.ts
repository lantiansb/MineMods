/** A tick's offers are collected before choosing a listener's track, independently of entity tick order. */
export function musicServer(packageName: string, songs: { id: string; outroTicks: number }[]) {
  return `package ${packageName}.entity;

import ${packageName}.platform.StudioPlatform;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;

public final class StudioMusic {
    public record Cue(int song, int action, int elapsed, int fade) {
        static void write(Cue cue, FriendlyByteBuf out) {
            out.writeVarInt(cue.song);
            out.writeVarInt(cue.action);
            out.writeVarInt(cue.elapsed);
            out.writeVarInt(cue.fade);
        }
        static Cue read(FriendlyByteBuf in) {
            return new Cue(in.readVarInt(), in.readVarInt(), in.readVarInt(), in.readVarInt());
        }
    }

    public static final StudioPlatform.Channel<Cue> CHANNEL = StudioPlatform.s2c("studio_music", Cue.class, Cue::write, Cue::read);
    private static final int[] OUTRO = {${songs.map(song => song.outroTicks).join(", ")}};
    private record Offer(UUID owner, int song, int elapsed, int fade) {}
    private record Listener(ServerPlayer player, Offer offer) {}
    private static final Map<UUID, Offer> offers = new HashMap<>();
    private static final Map<UUID, Listener> listeners = new HashMap<>();
    private static final Map<UUID, UUID> respawns = new HashMap<>();
    private static final Map<UUID, Integer> quietUntil = new HashMap<>();

    public static void register() {
        StudioPlatform.onServerStarted(server -> {
            offers.clear();
            respawns.clear();
            listeners.clear();
            quietUntil.clear();
        });
        StudioPlatform.onEntityDeath((owner, damage) -> {
            Listener heard = listeners.get(owner.getUUID());
            if (owner instanceof ServerPlayer && heard != null) respawns.put(owner.getUUID(), heard.offer.owner);
            end(owner);
        });
        StudioPlatform.onServerTick(StudioMusic::tick);
    }

    public static int song(String asset) {
        return switch (asset) {
${songs.map((s,i) => `            case "${s.id}" -> ${i};`).join("\n")}
            default -> throw new IllegalArgumentException(asset);
        };
    }

    public static void fight(Entity owner, Collection<ServerPlayer> players, int song, int elapsed, int fade) {
        Offer next = new Offer(owner.getUUID(), song, elapsed, fade);
        for (ServerPlayer player : players) {
            if (!player.isAlive() || player.level() != owner.level()) continue;
            UUID id = player.getUUID();
            Listener active = listeners.get(id);
            Offer prior = offers.get(id);
            if (active != null && active.offer.owner.equals(next.owner)) offers.put(id, next);
            else if (prior == null || ((active == null || !active.offer.owner.equals(prior.owner)) && next.elapsed > prior.elapsed)) offers.put(id, next);
        }
    }

    public static void end(Entity owner) {
        UUID source = owner.getUUID();
        respawns.values().removeIf(source::equals);
        offers.values().removeIf(offer -> offer.owner.equals(source));
        listeners.entrySet().removeIf(entry -> {
            Listener active = entry.getValue();
            if (!active.offer.owner.equals(source)) return false;
            if (!active.player.hasDisconnected()) {
                int song = active.offer.song;
                CHANNEL.sendTo(active.player, new Cue(song, 2, 0, 10));
                quietUntil.put(entry.getKey(), active.player.getServer().getTickCount() + Math.max(10, OUTRO[song]));
            }
            return true;
        });
    }

    private static void tick(MinecraftServer server) {
        int now = server.getTickCount();
        respawns.keySet().removeIf(id -> server.getPlayerList().getPlayer(id) == null);
        quietUntil.entrySet().removeIf(entry -> entry.getValue() <= now || server.getPlayerList().getPlayer(entry.getKey()) == null);
        listeners.entrySet().removeIf(entry -> {
            UUID id = entry.getKey();
            Listener held = entry.getValue();
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            Offer next = offers.get(id);
            if (player == null || player.hasDisconnected()) return true;
            if (next != null && held.offer.owner.equals(next.owner)) {
                if (player != held.player) {
                    CHANNEL.sendTo(player, new Cue(next.song, 0, Integer.MAX_VALUE, 0));
                    entry.setValue(new Listener(player, next));
                }
                return false;
            }
            CHANNEL.sendTo(player, new Cue(held.offer.song, 1, 0, held.offer.fade));
            if (held.offer.fade > 0) quietUntil.put(id, now + held.offer.fade);
            return true;
        });
        offers.forEach((id, offer) -> {
            if (listeners.containsKey(id) || quietUntil.containsKey(id)) return;
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player == null || player.hasDisconnected()) return;
            int elapsed = offer.owner.equals(respawns.remove(id)) ? Integer.MAX_VALUE : offer.elapsed;
            CHANNEL.sendTo(player, new Cue(offer.song, 0, elapsed, 0));
            listeners.put(id, new Listener(player, offer));
        });
        offers.clear();
    }
}
`
}
