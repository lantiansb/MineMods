import type { CameraCue, SkyTintCue } from "../cinematic"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"

export const CINEMATIC = { server: "StudioCinematic", client: "StudioCinematicClient", view: "StudioCinematicViewMixin", sky: "StudioTintSkyMixin", fog: "StudioTintFogMixin", edge: "StudioTintEdgeMixin" } as const
const ticks = (seconds: number) => Math.round(seconds * 20)
const float = (number: number) => `${Number(number.toFixed(4))}f`
function cueValues(kind: "camera" | "sky_tint", value: CameraCue | SkyTintCue) {
  const camera = kind === "camera" ? value as CameraCue : null
  const sky = kind === "sky_tint" ? value as SkyTintCue : null
  return [camera ? 0 : sky!.edge ? 2 : 1, float(value.radius), float(camera?.fov ?? sky!.strength), camera ? Math.max(1, ticks(camera.rise)) : 0, ticks(value.hold), Math.max(1, ticks(value.fade)), camera ? ["linear", "smooth", "cubic"].indexOf(camera.easing) : 1, sky ? `0x${sky.color.slice(1)}` : 0].join(", ")
}
export function cinematicStatement(kind: "camera" | "sky_tint", value: CameraCue | SkyTintCue, world = "world", at = "position()") {
  return `${CINEMATIC.server}.send(${world}, ${at}, ${cueValues(kind, value)});`
}

export function cinematicPayload(kind: "camera" | "sky_tint", value: CameraCue | SkyTintCue) {
  return `new ${CINEMATIC.server}.Cue(${cueValues(kind, value)})`
}

/** Only generated for new cues; old projects never enter this compiler. The packet and arithmetic are shared across all three targets. */
export function compileCinematic(input: { modId: string; packageName: string; camera: boolean; sky: boolean; edge: boolean; sharedSky?: boolean; sharedView?: boolean }, target: GenTarget) {
  const { packageName: pkg, modId } = input
  const facade = target.loader.facade
  const legacy = target.version.minecraft === "1.20.1"
  const source = `src/main/java/${pkg.replaceAll(".", "/")}`
  const S = CINEMATIC.server, C = CINEMATIC.client
  const fields = "int kind, float radius, float amount, int rise, int hold, int fade, int ease, int color"
  const payload = `    public record Cue(${fields})${facade ? "" : " implements CustomPacketPayload"} {
        static void write(FriendlyByteBuf b, Cue p) {
            b.writeVarInt(p.kind); b.writeFloat(p.radius); b.writeFloat(p.amount);
            b.writeVarInt(p.rise); b.writeVarInt(p.hold); b.writeVarInt(p.fade); b.writeVarInt(p.ease); b.writeInt(p.color);
        }
        static Cue read(FriendlyByteBuf b) { return new Cue(b.readVarInt(), b.readFloat(), b.readFloat(), b.readVarInt(), b.readVarInt(), b.readVarInt(), b.readVarInt(), b.readInt()); }
${facade ? "" : `        public static final Type<Cue> ID = new Type<>(ResourceLocation.fromNamespaceAndPath("${modId}", "studio_cinematic"));
        public static final StreamCodec<RegistryFriendlyByteBuf, Cue> CODEC = StreamCodec.of(Cue::write, Cue::read);
        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
`}    }
`
  const files: Record<string, string> = {
    [`${source}/entity/${S}.java`]: `package ${pkg}.entity;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;
${facade ? `import ${pkg}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};` : `import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;`}
/** Local visual cues: sent only to players inside the radius at the event's moment. Never changes weather or a player's FOV setting. */
public final class ${S}${facade ? "" : " implements ModInitializer"} {
${payload}
${facade ? `    public static final ${PLATFORM_CLASS}.Channel<Cue> CHANNEL = ${PLATFORM_CLASS}.s2c("studio_cinematic", Cue.class, (p,b) -> Cue.write(b,p), Cue::read);
    public static void register() {}` : `    @Override public void onInitialize() { PayloadTypeRegistry.playS2C().register(Cue.ID, Cue.CODEC); }`}
    public static void send(ServerLevel world, Vec3 at, Cue cue) {
        if (cue != null) send(world, at, cue.kind(), cue.radius(), cue.amount(), cue.rise(), cue.hold(), cue.fade(), cue.ease(), cue.color());
    }
    public static void send(ServerLevel world, Vec3 at, int kind, float radius, float amount, int rise, int hold, int fade, int ease, int color) {
        Cue cue = new Cue(kind, radius, amount, rise, hold, fade, ease, color);
        for (var player : world.players()) if (player.distanceToSqr(at) <= (double) radius * radius) {
            ${facade ? "CHANNEL.sendTo(player, cue);" : "if (ServerPlayNetworking.canSend(player, Cue.ID)) ServerPlayNetworking.send(player, cue);"}
        }
    }
}
`,
    [`${source}/client/${C}.java`]: `package ${pkg}.client;
import ${pkg}.entity.${S};
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
${input.edge ? "import net.minecraft.client.gui.GuiGraphics;\n" : ""}${facade ? `import ${pkg}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};` : `import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;`}
/** World-time curves, capped storage and user screen-effect scaling. Leaving a world or replacing the player clears every cue. */
public final class ${C}${facade ? "" : " implements ClientModInitializer"} {
    private record Running(${S}.Cue cue, double start) {}
    private static final List<Running> RUNNING = new ArrayList<>();
    private static Object seenLevel, seenPlayer;
    ${facade ? `public static void register() { ${CLIENT_PLATFORM_CLASS}.onS2C(${S}.CHANNEL, ${C}::accept); }` : `@Override public void onInitializeClient() {
        ClientPlayNetworking.registerGlobalReceiver(${S}.Cue.ID, (p,ctx) -> ctx.client().execute(() -> accept(p)));
        ClientPlayConnectionEvents.DISCONNECT.register((handler,client) -> RUNNING.clear());
    }`}
    private static void world() {
        Minecraft c = Minecraft.getInstance();
        if (seenLevel != c.level || seenPlayer != c.player) { RUNNING.clear(); seenLevel = c.level; seenPlayer = c.player; }
    }
    private static void accept(${S}.Cue cue) {
        world();
        Minecraft c = Minecraft.getInstance();
        if (c.level == null || c.player == null) return;
        if (RUNNING.size() >= 32) RUNNING.remove(0);
        RUNNING.add(new Running(cue, c.level.getGameTime()));
    }
    private static double now(float partial) {
        world();
        Minecraft c = Minecraft.getInstance();
        if (c.level == null || c.player == null) return 0;
        double now = c.level.getGameTime() + partial;
        RUNNING.removeIf(r -> now - r.start >= r.cue.rise() + r.cue.hold() + r.cue.fade());
        return now;
    }
    private static double ease(double u, int easing) {
        u = Mth.clamp(u, 0.0, 1.0);
        return easing == 1 ? u*u*(3.0-2.0*u) : easing == 2 ? (u < 0.5 ? 4.0*u*u*u : 1.0-Math.pow(-2.0*u+2.0,3.0)/2.0) : u;
    }
    private static double envelope(Running r, double now) {
        var p = r.cue;
        double t = Math.max(0, now-r.start);
        if (p.rise() > 0 && t < p.rise()) return ease(t/p.rise(), p.ease());
        if (t < p.rise()+p.hold()) return 1;
        return 1-ease((t-p.rise()-p.hold())/Math.max(1,p.fade()), p.ease());
    }
    private static double scale() { return Minecraft.getInstance().options.screenEffectScale().get(); }
${input.camera ? `    /** Multiply the current rendered FOV, including shakes; never touches options.fov. */
    public static double fov(float partial) {
        double now=now(partial), factor=1;
        for (Running r : RUNNING) if (r.cue.kind()==0) factor *= 1+(r.cue.amount()-1)*envelope(r,now)*scale();
        return Mth.clamp(factor,0.25,2.0);
    }
` : ""}${input.sky ? `    public static Vec3 tint(Vec3 base, float partial) { return tint(base,partial,false); }
    private static Vec3 tint(Vec3 base, float partial, boolean edgeOnly) {
        double now=now(partial);
        for (Running r : RUNNING) if (r.cue.kind()>0 && (!edgeOnly || r.cue.kind()==2)) {
            double a=Mth.clamp(r.cue.amount()*envelope(r,now)*scale(),0.0,1.0);
            int rgb=r.cue.color();
            base=base.lerp(new Vec3(((rgb>>16)&255)/255.0,((rgb>>8)&255)/255.0,(rgb&255)/255.0),a);
        }
        return base;
    }
` : ""}${input.edge ? `    public static void edge(GuiGraphics graphics, float partial) {
        double now=now(partial), alpha=0;
        for (Running r : RUNNING) if (r.cue.kind()==2) alpha=Math.min(0.35,alpha+r.cue.amount()*envelope(r,now)*scale()*0.35);
        if(alpha<=0) return;
        Vec3 rgb=tint(Vec3.ZERO,partial,true);
        int color=((int)(rgb.x*255)<<16)|((int)(rgb.y*255)<<8)|(int)(rgb.z*255);
        int w=graphics.guiWidth(),h=graphics.guiHeight(),band=Math.max(8,Math.min(w,h)/8);
        for(int i=0;i<band;i++) {
            int argb=((int)(255*alpha*(1.0-(double)i/band))<<24)|color;
            graphics.fill(i,i,w-i,i+1,argb); graphics.fill(i,h-i-1,w-i,h-i,argb);
            graphics.fill(i,i+1,i+1,h-i-1,argb); graphics.fill(w-i-1,i+1,w-i,h-i-1,argb);
        }
    }
` : ""}}
`,
  }
  const mixins: string[] = []
  function mixin(name: string, text: string) { files[`${source}/mixin/${name}.java`] = `package ${pkg}.mixin;
import ${pkg}.client.${C};
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
${text}`; mixins.push(name) }
  if (input.camera && !input.sharedView) mixin(CINEMATIC.view, `import net.minecraft.client.Camera;
import net.minecraft.client.renderer.GameRenderer;
@Mixin(value=GameRenderer.class, priority=900)
public abstract class ${CINEMATIC.view} {
    @Inject(method="getFov", at=@At("RETURN"), cancellable=true)
    private void studio$curve(Camera camera,float partial,boolean changing,CallbackInfoReturnable<Double> info) {
        if (changing) info.setReturnValue(MthClamp(info.getReturnValue()*${C}.fov(partial)));
    }
    private static double MthClamp(double v) { return Math.max(10.0,Math.min(170.0,v)); }
}
`)
  if (input.sky) {
    if (!input.sharedSky) mixin(CINEMATIC.sky, `import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.phys.Vec3;
@Mixin(value=ClientLevel.class, priority=900)
public abstract class ${CINEMATIC.sky} {
    @Inject(method="getSkyColor", at=@At("RETURN"), cancellable=true)
    private void studio$sky(Vec3 position,float partial,CallbackInfoReturnable<Vec3> info) { info.setReturnValue(${C}.tint(info.getReturnValue(),partial)); }
    @Inject(method="getCloudColor", at=@At("RETURN"), cancellable=true)
    private void studio$cloud(float partial,CallbackInfoReturnable<Vec3> info) { info.setReturnValue(${C}.tint(info.getReturnValue(),partial)); }
}
`)
    mixin(CINEMATIC.fog, `import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Camera;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.FogRenderer;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Shadow;
@Mixin(value=FogRenderer.class, priority=900)
public abstract class ${CINEMATIC.fog} {
    @Shadow private static float fogRed;
    @Shadow private static float fogGreen;
    @Shadow private static float fogBlue;
    @Inject(method="setupColor",at=@At("RETURN"))
    private static void studio$tint(Camera camera,float partial,ClientLevel level,int distance,float dark,CallbackInfo info) {
        Vec3 rgb=${C}.tint(new Vec3(fogRed,fogGreen,fogBlue),partial);
        fogRed=(float)rgb.x; fogGreen=(float)rgb.y; fogBlue=(float)rgb.z;
        RenderSystem.clearColor(fogRed,fogGreen,fogBlue,0);
    }
}
`)
  }
  if (input.edge) mixin(CINEMATIC.edge, `import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
${legacy ? "" : "import net.minecraft.client.DeltaTracker;"}
@Mixin(Gui.class)
public abstract class ${CINEMATIC.edge} {
    @Inject(method="render",at=@At("TAIL"))
    private void studio$edge(GuiGraphics graphics,${legacy ? "float partial" : "DeltaTracker delta"},CallbackInfo info) { ${C}.edge(graphics,${legacy ? "partial" : "delta.getGameTimeDeltaPartialTick(false)"}); }
}
`)
  const edit = (text: string, change: (value: any) => any) => `${JSON.stringify(change(JSON.parse(text)),null,2)}\n`.replaceAll("\n",text.includes("\r\n") ? "\r\n" : "\n")
  return {
    files: Object.fromEntries(Object.entries(files).map(([name,text]) => [name,target.version.rewriteJava(text)])),
    classes: Object.keys(files).map(name => name.replace("src/main/java/","").replace(/\.java$/,".class")),
    entries: { common: facade ? [`${pkg}.entity.${S}`] : [], client: facade ? [`${pkg}.client.${C}`] : [] },
    patch: {
      ...(!facade ? { "src/main/resources/fabric.mod.json": (text: string) => edit(text,m => ({ ...m,entrypoints: { ...m.entrypoints,main: [...m.entrypoints.main,`${pkg}.entity.${S}`],client: [...(m.entrypoints.client??[]),`${pkg}.client.${C}`] } })) } : {}),
      [`src/main/resources/${modId}.mixins.json`]: (text: string) => target.loader.addMixins(text,{client:mixins}),
    } as Record<string,(text:string)=>string>,
  }
}
