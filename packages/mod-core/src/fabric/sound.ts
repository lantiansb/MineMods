import { soundConstant } from "../data-words"
import { isSoundAsset, type SoundCategory, type SoundRef, SOUND_CATEGORIES } from "../sound"
import type { GenTarget } from "../platform/adapter"
import { PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * 任务二 §9: the one loader-specific piece of a project's own sounds. The data (`sounds.json`, the `.ogg` files,
 * the subtitles) is the same on every loader and comes from `sound.ts`; what differs is how the sound event is
 * registered. On Fabric each is a field of one class, registered when the class loads, and the content registry
 * loads it while the mod starts (before the game's registries are frozen). Written with Mojang's names.
 */

export const SOUND_CLASS = "StudioSounds"

/** A project's own sound as the generated Java needs it: the name it is registered by and the category an ability plays it under. */
export type CustomSound = { name: string; category: SoundCategory | null }

const field = (name: string) => `SOUND_${name.toUpperCase()}`

/**
 * The class that registers every sound of the project, as `src/main/java/…/StudioSounds.java`. `target`: a facade target
 * (Forge, NeoForge) registers each through `StudioPlatform.register` (the loader's deferred register, which takes the very
 * event made here), so every field is still the `SoundEvent` itself and the code that plays it reads the same on every loader.
 */
export function compileSoundRegistry(input: { modId: string; packageName: string; names: readonly string[] }, target: GenTarget = FABRIC_TARGET) {
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  if (target.loader.facade)
    return {
      [`${source}/${SOUND_CLASS}.java`]: target.version.rewriteJava(`package ${input.packageName};

import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraft.core.registries.Registries;
import net.minecraft.sounds.SoundEvent;

/** The project's own sounds (assets/${input.modId}/sounds.json), registered once while the mod is constructed (${target.manifest.id}). */
public final class ${SOUND_CLASS} {
${input.names.map((name) => `    public static final SoundEvent ${field(name)} = register("${name}");`).join("\n")}

    private ${SOUND_CLASS}() {}

    private static SoundEvent register(String name) {
        SoundEvent event = SoundEvent.createVariableRangeEvent(${PLATFORM_CLASS}.id(name));
        ${PLATFORM_CLASS}.register(Registries.SOUND_EVENT, name, () -> event);
        return event;
    }

    /** Called by the content registry: loading this class registers every sound above. */
    public static void register() {}
}
`),
    }
  return {
    [`${source}/${SOUND_CLASS}.java`]: `package ${input.packageName};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvent;

/** The project's own sounds (assets/${input.modId}/sounds.json), registered once while the mod starts. */
public final class ${SOUND_CLASS} {
${input.names.map((name) => `    public static final SoundEvent ${field(name)} = register("${name}");`).join("\n")}

    private ${SOUND_CLASS}() {}

    private static SoundEvent register(String name) {
        ResourceLocation id = ResourceLocation.fromNamespaceAndPath("${input.modId}", name);
        return Registry.register(BuiltInRegistries.SOUND_EVENT, id, SoundEvent.createVariableRangeEvent(id));
    }

    /** Called by the content registry: loading this class registers every sound above. */
    public static void register() {}
}
`,
  }
}

/** The line the content registry's `register()` starts with when the project has sounds of its own. */
export const soundRegistryCall = `        ${SOUND_CLASS}.register();\n`

/**
 * A sound in the generated Java: a vanilla one by its `SoundEvents` constant, as always; one of the project's own by
 * its registered field (fully named, so a class in any package of the mod can use it without an import).
 */
export function soundJava(ref: SoundRef, packageName: string, custom: Readonly<Record<string, CustomSound>>) {
  if (!isSoundAsset(ref)) return `SoundEvents.${soundConstant(ref)}`
  const found = custom[ref.asset]
  if (!found) throw new Error(`ENTITY_SOUND_MISSING:${ref.asset}`)
  return `${packageName}.${SOUND_CLASS}.${field(found.name)}`
}

/** The category an ability plays a sound under: the creature's own, unless the project's sound says another. */
export function soundSourceJava(ref: SoundRef, custom: Readonly<Record<string, CustomSound>>) {
  const category = isSoundAsset(ref) ? custom[ref.asset]?.category : null
  return category ? `net.minecraft.sounds.SoundSource.${SOUND_CATEGORIES[category].java}` : "getSoundSource()"
}
