import { BUILTIN_LABELS, builtinUses, type Builtin } from "../builtin"
import { resolveParticle } from "../particle-emission"
import type { Project } from "../project"
import { creatureName } from "../registry-name"

export function builtinFiles(project: Project, pkg: string) {
  const channels = {particle:[] as string[],sound:[] as string[]}
  const effects: string[] = []
  for (const entity of project.entities) for (const {key, particle, sound, effect} of builtinUses(entity.builtin)) {
    const creature = project.mod_id + ":" + creatureName(entity)
    if (effect) {
      if (project.workspace.assets.find(a => a.id === effect)?.document.kind !== "effect") throw new Error(`「${entity.name}」的物件效果找不到，请重新选择工程中的效果。`)
      effects.push(`            case "${creature}/${key}" -> "${effect}";`)
    }
    for (const [channel, ref] of [["particle",effect || particle === "none" ? "none" : particle && resolveParticle(particle, entity.particles)], ["sound",sound]] as const) {
      if (!ref) continue
      const asset = typeof ref === "object" ? project.workspace.assets.find(a => a.id === ref.asset)?.document : null
      if (typeof ref === "object" && asset?.kind !== channel) throw new Error(`「${entity.name}」的自带表现「${BUILTIN_LABELS[key]}」（builtin.${key}）找不到所选的${channel === "particle" ? "粒子" : "声音"}，请在工程里重新选一个，或删掉这一项用回自带的。`)
      const name = ref==="none" ? "none" : typeof ref === "string" ? "minecraft:" + ref : asset && (asset.kind === "particle" || asset.kind === "sound") ? project.mod_id + ":" + asset.name : null
      if (name) channels[channel].push(`            case "${creature}/${key}" -> "${name}";`)
    }
  }
  if (!channels.particle.length && !channels.sound.length) return {}
  const lookup = (kind:"particle"|"sound") => `    private static String ${kind}Id(String owner, String key) {
        return switch (owner + "/" + key) {
${channels[kind].join("\n")}
            default -> null;
        };
    }`
  const fixtureParticles = project.entities.some(e => e.builtin?.fixture_lit?.particle || e.builtin?.fixture_ember?.particle || e.builtin?.fixture_lit?.effect || e.builtin?.fixture_ember?.effect)
  const java = `package ${pkg}.entity;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.world.entity.Entity;

public final class StudioBuiltin {
    private StudioBuiltin() {}
    public static String owner(Entity entity) { return BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString(); }
${channels.particle.some(s=>s.includes('-> "none"')) ? `    public static boolean visible(Entity e, String key) { return !"none".equals(particleId(owner(e),key)); }\n` : ""}${channels.particle.length ? lookup("particle") + `
    public static ParticleOptions particle(Entity entity, String key, ParticleOptions fallback) {
        String id = particleId(owner(entity), key);
        if (id == null) return fallback;
        var type = BuiltInRegistries.PARTICLE_TYPE.get(ResourceLocation.tryParse(id));
        return type instanceof ParticleOptions selected ? selected : fallback;
    }` : ""}
${effects.length ? `    static String fixtureEffect(String owner, String key) {
        return switch (owner + "/" + key) {
${effects.join("\n")}
            default -> null;
        };
    }
` : ""}${fixtureParticles ? `    static ParticleOptions fixtureParticle(String owner, String key, ParticleOptions fallback) {
        String id = particleId(owner, key);
        if (id == null) return fallback;
        if ("none".equals(id)) return null;
        var type = BuiltInRegistries.PARTICLE_TYPE.get(ResourceLocation.tryParse(id));
        return type instanceof ParticleOptions selected ? selected : fallback;
    }
` : ""}${channels.sound.some(s=>s.includes('-> "none"')) ? `    public static boolean audible(String owner, String key) { return !"none".equals(soundId(owner,key)); }\n` : ""}${channels.sound.length ? lookup("sound") + `
    public static SoundEvent sound(String owner, String key, String fallback) {
        String id = soundId(owner, key);
        return BuiltInRegistries.SOUND_EVENT.get(ResourceLocation.tryParse(id == null ? fallback : id));
    }` : ""}
}
`
  return { [`src/main/java/${pkg.replaceAll(".","/")}/entity/StudioBuiltin.java`]:java }
}

export type SharedBuiltin = { particle: string[]; sound: string[] }
export const sharedBuiltin = (project: Project): SharedBuiltin => {
  const uses = project.entities.flatMap(entity => builtinUses(entity.builtin))
  const keys=(kind:"particle"|"sound")=>[...new Set(uses.flatMap(u=>u[kind]==="none"?[u.key,"mute:"+u.key]:u[kind]?[u.key]:[]))]
  return {particle:[...keys("particle"), ...uses.filter(u=>u.effect).flatMap(u=>[u.key,"fixture_effect"])],sound:keys("sound")}
}

export const builtinParticle = (on:boolean, owner:string, key:keyof Builtin, original:string) =>
  on ? `StudioBuiltin.particle(${owner}, "${key}", ${original})` : original
export const builtinSound = (on:boolean, owner:string, key:keyof Builtin, original:string, fallback:string) =>
  on ? `StudioBuiltin.sound(StudioBuiltin.owner(${owner}), "${key}", "minecraft:${fallback}")` : original
