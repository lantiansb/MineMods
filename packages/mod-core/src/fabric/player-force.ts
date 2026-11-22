// Players integrate their own movement. Send the requested horizontal speed so that
// friction, input, falling and collisions are all resolved on the same physics tick.
export function playerForceFiles(pkg: string) {
  const root = `src/main/java/${pkg.replaceAll(".", "/")}/entity`
  return {
    [`${root}/StudioPlayerForce.java`]: `package ${pkg}.entity;

import ${pkg}.platform.StudioPlatform;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerPlayer;

public record StudioPlayerForce(int entityId, double x, double z) {
    public static final StudioPlatform.Channel<StudioPlayerForce> CHANNEL =
        StudioPlatform.s2c("player_force", StudioPlayerForce.class, StudioPlayerForce::write, StudioPlayerForce::read);

    public static void register() {} // The common entry initializes the channel on both sides.

    public static void send(ServerPlayer player, double x, double z) {
        CHANNEL.sendTo(player, new StudioPlayerForce(player.getId(), x, z));
    }

    private static void write(StudioPlayerForce step, FriendlyByteBuf buf) {
        buf.writeVarInt(step.entityId);
        buf.writeDouble(step.x);
        buf.writeDouble(step.z);
    }

    private static StudioPlayerForce read(FriendlyByteBuf buf) {
        return new StudioPlayerForce(buf.readVarInt(), buf.readDouble(), buf.readDouble());
    }
}
`,
    [`${root}/StudioPlayerForceClient.java`]: `package ${pkg}.entity;

import ${pkg}.platform.StudioClientPlatform;
import net.minecraft.client.Minecraft;

public final class StudioPlayerForceClient {
    public static void register() {
        StudioClientPlatform.onS2C(StudioPlayerForce.CHANNEL, step -> {
            var player = Minecraft.getInstance().player;
            if (player == null || player.getId() != step.entityId() || !player.isAlive() || player.isCreative() || player.isSpectator()) return;
            double drag = player.onGround() ? player.level().getBlockState(player.blockPosition().below()).getBlock().getFriction() * 0.91 : 0.91;
            player.setDeltaMovement(player.getDeltaMovement().add(step.x() * (1.0 - drag), 0.0, step.z() * (1.0 - drag)));
        });
    }
}
`,
  }
}
