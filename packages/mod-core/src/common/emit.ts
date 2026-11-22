import { scatterRange, resolvedAsset, type Scatter, type ParticleRef } from "../particle-emission"
import type { GenTarget } from "../platform/adapter"
import { FABRIC_LOADER } from "../platform/loader-fabric"

type Burst = Scatter & { count: number; particle: ParticleRef }
const float = (value: number) => `${Number(value.toFixed(6))}f`

export function emitArguments(event: Burst, indices: Readonly<Record<string, number>> = {}) {
  const range = scatterRange(event)
  const v = event.velocity
  const index = typeof event.particle === "string" ? -1 : indices[resolvedAsset(event.particle)]
  if (index === undefined || (typeof event.particle !== "string" && index < 0)) throw new Error("找不到这次发射使用的工程粒子。")
  const particle = typeof event.particle === "string" ? `-1, "${event.particle}"` : `${index}, ""`
  const floats = [range.left, range.up, range.forward, v?.forward ?? 0, v?.up ?? 0, v?.left ?? 0, v?.outward ?? 0, v?.vary ?? 0]
  return `${particle}, ${event.count}, ${event.shape === "disc" ? 1 : event.shape === "ring" ? 2 : 0}, ${floats.map(float).join(", ")}, ${event.motion?.type === "orbit" ? 2 : event.motion ? 1 : 0}, ${float(event.motion?.type === "orbit" ? event.motion.turns : 0)}, ${event.tint ? "0x" + event.tint.slice(1) : -1}`
}

// Long repeated bursts can otherwise exceed the JVM's 64 KiB limit for one method.
export function emissionTimeline(name: string, cast: boolean, split: boolean, ticks: number[], body: (tick: number) => string, prelude = "") {
  const signature = `private ${cast ? "static " : ""}void `
  const args = cast ? "Cast c, int tick" : "int tick"
  const method = (id: string, lines: string[]) => `    ${signature}${id}(${args}) {\n${lines.join("\n")}\n    }\n`
  if (!split || ticks.length <= 32) return method(name, [...(prelude ? [prelude.trimEnd()] : []), ...ticks.map(body)])
  const chunks = Array.from({ length: Math.ceil(ticks.length / 32) }, (_, i) => ticks.slice(i * 32, (i + 1) * 32))
  return method(name, [...(prelude ? [prelude.trimEnd()] : []), ...chunks.map((chunk, i) => `        if (tick <= ${chunk[chunk.length - 1]}) { ${name}Part${i}(${cast ? "c, " : ""}tick); return; }`)])
    + chunks.map((chunk, i) => method(`${name}Part${i}`, chunk.map(body))).join("")
}

export function compileEmit(modId: string, pkg: string, own: boolean, target: GenTarget) {
  const root = `src/main/java/${pkg.replaceAll(".", "/")}`
  const fabric = !target.loader.facade
  const fields = [
    ["int", "particle"], ["String", "vanilla"], ["double", "x"], ["double", "y"], ["double", "z"], ["float", "yaw"],
    ["int", "count"], ["int", "shape"], ...["sx", "sy", "sz", "forward", "up", "left", "outward", "vary"].map(key => ["float", key]),
    ["int", "motion"], ["float", "turns"], ["int", "tint"], ["long", "seed"],
  ]
  const codec: Record<string, string> = { int: "Int", String: "Utf", float: "Float", double: "Double", long: "Long" }
  const access = (names: string[]) => names.map(name => `p.${name}()`).join(", ")
  const spatial = ["x", "y", "z", "yaw", "count", "shape", "sx", "sy", "sz", "forward", "up", "left", "outward", "vary"]
  const server = `package ${pkg}.entity;

import ${pkg}.platform.StudioPlatform;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;

public final class StudioEmit${fabric ? " implements net.fabricmc.api.ModInitializer" : ""} {
    public record Burst(${fields.map(f => f.join(" ")).join(", ")}) {
        static void write(Burst p, FriendlyByteBuf b) {
${fields.map(([type, key]) => `            b.write${codec[type!]}(p.${key}());`).join("\n")}
        }
        static Burst read(FriendlyByteBuf b) {
            return new Burst(${fields.map(([type]) => `b.read${codec[type!]}()`).join(", ")});
        }
    }

    public static final StudioPlatform.Channel<Burst> CHANNEL = StudioPlatform.s2c("studio_emit", Burst.class, Burst::write, Burst::read);
    public static void register() {}
${fabric ? "    @Override public void onInitialize() { register(); }\n" : ""}
    public static Vec3 offset(Vec3 origin, float yaw, double forward, double up, double left) {
        double angle = Math.toRadians(yaw);
        return origin.add(left * Math.cos(angle) - forward * Math.sin(angle), up, forward * Math.cos(angle) + left * Math.sin(angle));
    }

    public static void send(ServerLevel world, Vec3 at, float yaw, int particle, String vanilla, int count, int shape,
            float sx, float sy, float sz, float forward, float up, float left, float outward, float vary, int motion, float turns, int tint) {
        Burst burst = null;
        for (var player : world.players()) {
            if (player.distanceToSqr(at.x, at.y, at.z) > 4096.0) continue;
            if (burst == null) burst = new Burst(particle, vanilla, at.x, at.y, at.z, yaw, count, shape, sx, sy, sz, forward, up, left, outward, vary, motion, turns, tint, world.random.nextLong());
            CHANNEL.sendTo(player, burst);
        }
    }
}
`
  const client = `package ${pkg}.client;

import ${pkg}.entity.StudioEmit;
import ${pkg}.platform.StudioClientPlatform;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;

public final class StudioEmitClient${fabric ? " implements net.fabricmc.api.ClientModInitializer" : ""} {
    public static void register() { StudioClientPlatform.onS2C(StudioEmit.CHANNEL, StudioEmitClient::receive); }
${fabric ? "    @Override public void onInitializeClient() { register(); }\n" : ""}
    private static void receive(StudioEmit.Burst p) {
        ClientLevel level = Minecraft.getInstance().level;
        if (level == null) return;
        if (p.particle() >= 0) {
            ${own ? `StudioParticleEmit.emit(level, p.particle(), ${access([...spatial, "motion", "turns", "tint", "seed"])});` : "return;"}
        } else if (!p.vanilla().isEmpty() && BuiltInRegistries.PARTICLE_TYPE.get(${target.version.resourceLocation('"minecraft"', "p.vanilla()")}) instanceof SimpleParticleType type) {
            scatter(level, type, ${access([...spatial, "seed"])});
        }
    }

    static void scatter(ClientLevel level, SimpleParticleType type, double x, double y, double z, float yaw, int count, int shape,
            float sx, float sy, float sz, float forward, float up, float left, float outward, float vary, long seed) {
        java.util.Random random = new java.util.Random(seed);
        double angle = Math.toRadians(yaw), sin = Math.sin(angle), cos = Math.cos(angle);
        for (int i = 0; i < count; i++) {
            double theta = random.nextDouble() * Math.PI * 2, h = random.nextDouble() * 2 - 1;
            double radius = shape == 2 ? 1 : shape == 1 ? Math.sqrt(random.nextDouble()) : Math.cbrt(random.nextDouble());
            double flat = shape == 0 ? radius * Math.sqrt(1 - h * h) : radius;
            double side = Math.cos(theta) * flat * sx, dy = h * sy * (shape == 0 ? radius : 1), ahead = Math.sin(theta) * flat * sz;
            double dx = side * cos - ahead * sin, dz = ahead * cos + side * sin;
            double norm = Math.sqrt(dx * dx + dy * dy + dz * dz);
            double radial = norm == 0 ? 0 : outward / norm;
            double rate = (1 + vary * (2 * random.nextDouble() - 1)) / 20;
            level.addParticle(type, x + dx, y + dy, z + dz, (left * cos - forward * sin + radial * dx) * rate,
                    (up + radial * dy) * rate, (forward * cos + left * sin + radial * dz) * rate);
        }
    }
}
`
  const entries = { common: [`${pkg}.entity.StudioEmit`], client: [`${pkg}.client.StudioEmitClient`] }
  const patch: Record<string, (text: string) => string> = {}
  if (fabric) patch["src/main/resources/fabric.mod.json"] = text => {
    const meta = JSON.parse(text)
    meta.entrypoints.main.push(...entries.common)
    meta.entrypoints.client = [...(meta.entrypoints.client ?? []), ...entries.client]
    const json = JSON.stringify(meta, null, 2) + "\n"
    return text.includes("\r\n") ? json.replaceAll("\n", "\r\n") : json
  }
  const classRoot = pkg.replaceAll(".", "/")
  const classes = ["entity/StudioEmit", "entity/StudioEmit$Burst", "client/StudioEmitClient", ...(own ? ["client/StudioParticleEmit"] : [])].map(name => `${classRoot}/${name}.class`)
  return { entries, patch, classes, files: {
    ...(fabric ? FABRIC_LOADER.platformFiles({ modId, packageName: pkg, version: target.version }) : {}),
    [`${root}/entity/StudioEmit.java`]: server, [`${root}/client/StudioEmitClient.java`]: client,
  } }
}
