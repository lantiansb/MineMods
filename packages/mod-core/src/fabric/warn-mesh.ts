import type { GenTarget } from "../platform/adapter"

export function meshHook(target: GenTarget) {
  if (!target.loader.facade) return "net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents.AFTER_TRANSLUCENT.register(context -> mesh(context.matrixStack(), context.camera()));"
  const forge = target.version.minecraft === "1.20.1"
  const ns = forge ? "net.minecraftforge" : "net.neoforged.neoforge"
  const bus = forge ? ns + ".common.MinecraftForge" : ns + ".common.NeoForge"
  const event = ns + ".client.event.RenderLevelStageEvent"
  return `${bus}.EVENT_BUS.addListener((${event} event) -> {
            if (event.getStage() == ${event}.Stage.AFTER_TRANSLUCENT_BLOCKS) mesh(event.getPoseStack(), event.getCamera());
        });`
}

export function meshMethods(modId:string, target:GenTarget, fields:boolean, pillar:number) {
  const vertex = target.version.minecraft === "1.20.1"
    ? "out.vertex(pose, x, y, z).color(r, g, b, alpha).uv(u, v).overlayCoords(655360).uv2(15728880).normal(0, 1, 0).endVertex();"
    : "out.addVertex(pose, x, y, z).setColor(r, g, b, alpha).setUv(u, v).setOverlay(655360).setLight(15728880).setNormal(0, 1, 0);"
  return `
    private interface Mark { void point(double x, double y, double z); }
    private static final net.minecraft.client.renderer.RenderType MESH = net.minecraft.client.renderer.RenderType.entityTranslucent(
        net.minecraft.resources.ResourceLocation.tryParse("${modId}:textures/fx/warn_glint.png"));

    private static void vertex(com.mojang.blaze3d.vertex.VertexConsumer out, org.joml.Matrix4f pose, float x, float y, float z, float u, float v, float r, float g, float b, float alpha) {
        ${vertex}
    }

    private static void mesh(com.mojang.blaze3d.vertex.PoseStack matrices, net.minecraft.client.Camera camera) {
        Minecraft client = Minecraft.getInstance();
        if (client.level == null || RUNNING.isEmpty() || matrices == null) return;
        var buffers = client.renderBuffers().bufferSource();
        var pose = matrices.last().pose();
        var eye = camera.getPosition();
        var right = new Vector3f(1,0,0).rotate(camera.rotation());
        var up = new Vector3f(0,1,0).rotate(camera.rotation());
        var now = client.level.getGameTime();
        boolean rendered = false;
        for (Running running : RUNNING) {
            var warn = running.warn();
            if (warn.look() < 8 || now < running.start() || now - running.start() >= warn.ticks()) continue;
            rendered = true;
            var out = buffers.getBuffer(MESH);
            var rgb = COLOURS[Mth.clamp(warn.color(), 0, COLOURS.length-1)];
            float fade = ${fields ? "warn.progress() >= 0 ? warn.intensity() : 1f" : "1f"};
            float done = ${fields ? "warn.progress() >= 0 ? warn.progress() : " : ""}Mth.clamp((float)(now-running.start())/warn.ticks(), 0f, 1f);
            int most = Mth.clamp(LINE_SHARED / Math.max(1, warn.places().length / 3), LINE_LEAST, LINE_MOST);
            for (int layer = 0; layer < 2; layer++) {
                float size = layer == 0 ? 0.18f : 0.10f;
                Mark marker = (wx,wy,wz) -> {
                    float x=(float)(wx-eye.x), y=(float)(wy-eye.y), z=(float)(wz-eye.z);
                    for (int i=0; i<4; i++) {
                        float h=(i==0 || i==3) ? -size : size, v=i<2 ? -size : size;
                        vertex(out,pose,x+h*right.x+v*up.x,y+h*right.y+v*up.y,z+h*right.z+v*up.z,h<0?0:1,v<0?1:0,rgb.x,rgb.y,rgb.z,fade);
                    }
                };
                for (int p=0; p+2<warn.places().length; p+=3) {
                    double x=warn.places()[p], y=warn.places()[p+1], z=warn.places()[p+2];
                    outline(marker,warn,x,y,z,layer==0?1f:done,most);
                    if (layer==0 && warn.look()==8+${pillar}) pillar(marker,warn,x,y,z,most);
                }
            }
        }
        if (rendered) buffers.endBatch(MESH);
    }
`
}
