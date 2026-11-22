import { z } from "zod"
import type { GenTarget } from "./platform/adapter"

export const SoundRangeSchema = z.number().int().min(8,"可闻距离最少 8 格。").max(128,"可闻距离最多 128 格。")
export const SoundVolumeSchema = z.number().finite().min(0.2).max(4)
export const soundReach = (volume: number, range?: number) => range ?? 16 * Math.max(1, volume)
export const rangedSound = (event: string, range?: number, prefix = "") =>
  range === undefined ? event : `${prefix}StudioSoundRange.wrap(${event}, ${range})`
export const SOUND_RANGE_WORDS = "原版提示音音量不超过 1 时通常传约 16 格，更大的音量通常按 16 格乘音量计算。原版有固定传播距离的声音和自带衰减距离的录音例外。Boss 和史诗档的开场、吼声和远程出招建议写 range_blocks:48 或更大，至少覆盖 start.max_distance。Studio 把所写的音量交给游戏播放，体型和档位不改这个数。写 range_blocks（8 到 128 格）可单独设传播距离，音量 0.2 到 4 仍管响度。玩家离得远时依然会听得更轻。以前用 volume:3 传 48 格的招式，现在可以写 volume:1, range_blocks:48。"
export function soundRangeRuntime(pkg: string, modId: string, target: GenTarget) {
  const root = "src/main/java/"+pkg.replaceAll(".","/")
  const helper = "StudioSoundRange"
  const files = {
    [root+"/entity/"+helper+".java"]: `package ${pkg}.entity;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvent;
public final class StudioSoundRange {
    private static final String PREFIX="studio_range/";
    public static SoundEvent wrap(SoundEvent sound, int blocks) {
        if (sound == null) return null;
        ResourceLocation id=sound.getLocation();
        ResourceLocation alias=ResourceLocation.fromNamespaceAndPath("${modId}", PREFIX+blocks+"/"+id.getNamespace()+"/"+id.getPath());
        return SoundEvent.createFixedRangeEvent(alias, blocks);
    }
    private static String[] parts(ResourceLocation id) {
        if (!id.getNamespace().equals("${modId}") || !id.getPath().startsWith(PREFIX)) return null;
        String[] fields=id.getPath().substring(PREFIX.length()).split("/",3);
        return fields.length==3 ? fields : null;
    }
    public static ResourceLocation original(ResourceLocation id) {
        String[] fields=parts(id);
        return fields==null ? id : ResourceLocation.fromNamespaceAndPath(fields[1],fields[2]);
    }
    public static float distance(ResourceLocation id,float vanilla) {
        String[] fields=parts(id);
        if(fields==null) return vanilla;
        try { int blocks=Integer.parseInt(fields[0]); return blocks>=8 && blocks<=128 ? blocks : vanilla; }
        catch(NumberFormatException ignored){return vanilla;}
    }
}`,
    [root+"/mixin/StudioRangedSample.java"]: `package ${pkg}.mixin;
import net.minecraft.client.resources.sounds.AbstractSoundInstance;
import net.minecraft.resources.ResourceLocation;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;
@Mixin(AbstractSoundInstance.class)
public abstract class StudioRangedSample {
    @ModifyArg(method="resolve",at=@At(value="INVOKE",target="Lnet/minecraft/client/sounds/SoundManager;getSoundEvent(Lnet/minecraft/resources/ResourceLocation;)Lnet/minecraft/client/sounds/WeighedSoundEvents;"),index=0)
    private ResourceLocation studioOriginalSample(ResourceLocation id) {
        return ${pkg}.entity.StudioSoundRange.original(id);
    }
}`,
    [root+"/mixin/StudioRangedAttenuation.java"]: `package ${pkg}.mixin;
import net.minecraft.client.sounds.SoundEngine;
import net.minecraft.client.resources.sounds.SoundInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
@Mixin(SoundEngine.class)
public abstract class StudioRangedAttenuation {
    // In play(), the first stored float is the sampled volume, the second is the audible distance.
    @ModifyVariable(method="play",at=@At(value="STORE"),ordinal=1)
    private float studioAudibleDistance(float vanilla, SoundInstance sound) {
        return ${pkg}.entity.StudioSoundRange.distance(sound.getLocation(), vanilla);
    }
}`,
  }
  return { files: Object.fromEntries(Object.entries(files).map(([key,value])=>[key,target.version.rewriteJava(value)])), patch: {[`src/main/resources/${modId}.mixins.json`]:(s:string)=>target.loader.addMixins(s,{client:["StudioRangedSample","StudioRangedAttenuation"]})} }
}
