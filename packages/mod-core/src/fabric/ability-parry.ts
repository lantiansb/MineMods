import { z } from "zod"
import { disarmTicks, isParry } from "../ability-parry"
import { BuildStop } from "../build-stop"
import type { Ability } from "../entity-runtime"
import type { GenTarget } from "../platform/adapter"
import { PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"
import type { combatBearingJava } from "./combat"

/**
 * Boss 能力 14 (夺兵) as the Java a generated mod carries. Only vanilla names, Mojang's own, the same on Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1 (javac on each),
 * except where the attack is called off, which is the loader's: Fabric API's `AttackEntityCallback` on Fabric, `StudioPlatform.onAttack` (the loaders' `AttackEntityEvent`)
 * on a facade target. Without an ability started by a blow every piece is the empty string and no class is written: such a creature's class, and such a mod, is what it always
 * was, to the byte.
 *
 * - The creature's class (`parryJava`, put in by `compileAbilities`): its `hurt` asks first whether the blow is answered (`abilityParry`): on the server, when nothing of
 *   its abilities runs, it is alive and the blow would hurt it at all (not invulnerable to it, not inside the game's half second after a heavier blow), the blow was struck by a
 *   living thing other than itself (not a creative or spectating player), and — per ability started by a blow — of the kind it answers (melee: struck directly by the one who
 *   dealt it, as a player's or a mob's attack), its wait over, its phase allowing it, the attacker inside its window (and in sight when asked). Each such ability rolls its
 *   chance; of those that won one is picked by weight and starts at once, aimed at the attacker, who becomes its target, the body turned to them. When it `block`s, the blow
 *   does nothing; otherwise the blow lands and does not cut short the ability it started. A player it disarms is disarmed from that moment (`StudioDisarm.disarm`).
 * - `StudioDisarm` (one class a mod, written when some ability disarms): which players are disarmed until when, by their UUID and the server's tick count, so a player who
 *   leaves and comes back within the time is still disarmed (and their game is shown it again on joining); a new server (another world in the same game) starts with none,
 *   and nothing is saved: a restart forgets it. While disarmed, every melee attack of theirs is called off on the server, and what they hold shows the game's own cooldown
 *   (`ItemCooldowns.addCooldown`, sent to their game by the game itself) with a short line above the hotbar in their own language (`<mod>.disarmed`). Their own game is never
 *   asked: it would swing, and the server says no.
 */

/** The class that keeps who is disarmed, and the key of the line a disarmed player is shown. */
export const DISARM = { runtime: "StudioDisarm", key: (modId: string) => `${modId}.disarmed` } as const

const single = (value: number) => `${Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4)))}f`
const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const list = (values: readonly (number | boolean | string)[]) => `{${values.join(", ")}}`

/** Whether a creature's abilities hold one started by a blow; whether one of those disarms. */
export const abilitiesParry = (abilities: readonly Pick<Ability, "on_hurt">[]) => abilities.some(isParry)
export const abilitiesDisarm = (abilities: readonly Pick<Ability, "on_hurt">[]) => abilities.some((ability) => ability.on_hurt?.disarm !== undefined)

/**
 * What a creature's class adds for its abilities started by a blow: the fields (per ability: its chance, 0 for one chosen by distance; melee only; whether it blocks the blow;
 * the ticks it disarms for), the method that answers a blow, and the head of `hurt`. All empty without one. `boss`: its phase decides what may start (`bossAllows`);
 * `seeded`: some hit of its abilities is scattered round its target, drawn anew at every start.
 */
export function parryJava(abilities: readonly Ability[], input: { combat?: boolean; weighted?: boolean; boss: boolean; seeded: boolean; flight: boolean; headYaw?: number | undefined; bearing?: ReturnType<typeof combatBearingJava> }) {
  if (!abilitiesParry(abilities)) return { fields: "", method: "", head: "", blocks: false }
  if (input.flight) throw new BuildStop("parry_flight", [{ text: "会飞的生物现在还不能写被打中时起的招式。", fix: "取消挨打时出招，或关闭飞行。" }])
  const blocks = abilities.some((ability) => ability.on_hurt?.block)
  const disarms = abilitiesDisarm(abilities)
  const steady = input.headYaw !== undefined
  const front = steady && abilities.some(ability => ability.on_hurt?.front_yaw !== undefined)
  const defaultFront = Math.min(input.headYaw ?? 90, 90)
  const windows = abilities.flatMap((ability, index) => (ability.on_hurt ? [`            case ${index} -> distance >= ${real(ability.start.min_distance)} && distance <= ${real(ability.start.max_distance)}${ability.start.line_of_sight ? " && hasLineOfSight(attacker)" : ""}${input.bearing?.gates(ability.start.when, "attacker") ?? ""};`] : []))
  const weight = input.weighted ? `combatWeight(index, visible${input.bearing?.weighted ? ", attacker" : ""})` : "ABILITY_WEIGHT[index]"
  return {
    fields: `    // ---- Boss 能力 14: per ability, how likely a blow that may start it does (0: it is chosen by distance, never by a blow), whether only a melee blow may, whether that blow
    // then does nothing to it (parried), and the ticks the player who struck it is disarmed for (0: not) ----
    private static final float[] PARRY_CHANCE = ${list(abilities.map((ability) => single(ability.on_hurt?.chance ?? 0)))};
    private static final boolean[] PARRY_MELEE = ${list(abilities.map((ability) => ability.on_hurt?.by === "melee"))};
${blocks ? `    private static final boolean[] PARRY_BLOCKS = ${list(abilities.map((ability) => Boolean(ability.on_hurt?.block)))};\n` : ""}${disarms ? `    private static final int[] PARRY_DISARM = ${list(abilities.map((ability) => (ability.on_hurt ? disarmTicks(ability.on_hurt) : 0)))};\n` : ""}${front ? `    private static final float[] PARRY_FRONT_YAW = ${list(abilities.map(ability => single(ability.on_hurt?.front_yaw ?? defaultFront)))};\n` : ""}`,
    method: `    /**
     * Boss 能力 14: whether this blow starts one of the abilities a blow starts, and which (-1: none). Only on the server, with nothing of its abilities running, alive, and only a
     * blow that would hurt it (not one it is invulnerable to, not one inside the game's half second after a heavier one) dealt by a living thing other than itself that is not a
     * creative or spectating player. Each ability that may answer it rolls its chance; of those that won, one is picked by weight and starts now, aimed at the attacker.
     */
    private int abilityParry(DamageSource source, float amount) {
        if (level().isClientSide() || abilityRunning() || isDeadOrDying() || amount <= 0.0f || isInvulnerableTo(source) || (invulnerableTime > 10 && amount <= lastHurt)) return -1;
        if (!(source.getEntity() instanceof LivingEntity attacker) || attacker == this || !attacker.isAlive()) return -1;
        if (attacker instanceof Player player && (player.isCreative() || player.isSpectator())) return -1;
${steady ? `        float bearing = (float) Math.toDegrees(Mth.atan2(attacker.getZ() - getZ(), attacker.getX() - getX())) - 90.0f;
        float off = Math.abs(Mth.wrapDegrees(bearing - yBodyRot));
        if (off > ${single(front ? 90 : defaultFront)}) return -1;
` : ""}        // Struck by hand or with what it holds: the one who dealt it is what struck, as a player's or a mob's attack (not an arrow, a thrown trident, thorns).
        boolean melee = source.getDirectEntity() == attacker && (source.is(net.minecraft.world.damagesource.DamageTypes.PLAYER_ATTACK) || source.is(net.minecraft.world.damagesource.DamageTypes.MOB_ATTACK) || source.is(net.minecraft.world.damagesource.DamageTypes.MOB_ATTACK_NO_AGGRO));
        double distance = distanceTo(attacker);
        int won = 0;
        ${input.weighted ? "double total = 0;\n        boolean visible = hasLineOfSight(attacker);" : "int total = 0;"}
        for (int index = 0; index < PARRY_CHANCE.length; index++) {
            if (PARRY_CHANCE[index] <= 0.0f${front ? " || off > PARRY_FRONT_YAW[index]" : ""} || (PARRY_MELEE[index] && !melee) || tickCount < abilityReadyAt[index]${input.combat ? " || !combatAllows(index)" : input.boss ? " || !bossAllows(index)" : ""} || !abilityParryWindow(index, distance, attacker)) continue;
            if (getRandom().nextFloat() >= PARRY_CHANCE[index]) continue;
            won |= 1 << index;
            total += ${weight};
        }
        if (total == 0) return -1;
        ${input.weighted ? "double roll = getRandom().nextDouble() * total;" : "int roll = getRandom().nextInt(total);"}
        for (int index = 0; index < PARRY_CHANCE.length; index++) {
            if ((won & (1 << index)) == 0) continue;
            roll -= ${weight};
            if (roll >= 0) continue;
            // The one who struck is the one it now fights: a target the creature may not take (a rule of its own says no) is not answered.
            if (getTarget() != attacker) setTarget(attacker);
            if (getTarget() != attacker) return -1;
            abilityIndex = index;
            // tickAbility runs on its next tick and makes it tick 0.
            abilityTick = -1;
            abilityTarget = attacker;
${steady ? "            abilityYaw = yBodyRot;\n" : `            abilityYaw = (float) (Mth.atan2(attacker.getZ() - getZ(), attacker.getX() - getX()) * 180.0 / Math.PI) - 90.0f;
            setYRot(abilityYaw);
            setYBodyRot(abilityYaw);
            setYHeadRot(abilityYaw);
`}            abilityAim(attacker, false);
${input.seeded ? "            abilitySeed = getRandom().nextInt();\n" : ""}            getNavigation().stop();
            getEntityData().set(ABILITY, (++abilitySerial << 8) | (index + 1));
${disarms ? `            // The player who struck is disarmed from now: their melee attacks are called off and what they hold shows a cooldown (${DISARM.runtime}).
            if (PARRY_DISARM[index] > 0 && attacker instanceof net.minecraft.server.level.ServerPlayer struck) ${DISARM.runtime}.disarm(struck, PARRY_DISARM[index]);
` : ""}            return index;
        }
        return -1;
    }

    /** Boss 能力 14: whether the one who struck stands where an ability started by a blow answers them (its \`start\` window, in sight when it asks). */
    private boolean abilityParryWindow(int index, double distance, LivingEntity attacker) {
        return switch (index) {
${windows.join("\n")}
            default -> false;
        };
    }

`,
    /** The first statement of \`hurt\`: the blow is answered (and, parried, does nothing). */
    head: `        // Boss 能力 14: a blow may start an ability that answers it${blocks ? "; parried, it does nothing" : ""}.
        int parried = abilityParry(source, amount);
${blocks ? "        if (parried >= 0 && PARRY_BLOCKS[parried]) return false;\n" : ""}`,
    blocks,
  }
}

// ---- the class that keeps who is disarmed ----

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
})

/** The class, with what differs between Fabric (an entry point of its own) and a facade target (`register()`, run by the common entry). */
function disarmSource(packageName: string, modId: string, loader: { imports: string; implementsInit: string; register: string }) {
  return `package ${packageName}.entity;

import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
${loader.imports}import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

/**
 * Boss 能力 14 (缴械): which players are disarmed until when, on the server alone. A creature's ability started by a blow disarms the player who struck it (\`disarm\`); while
 * disarmed, every melee attack of theirs is called off (\`allows\`, asked by the loader before an attack goes ahead), and what they hold shows the game's own cooldown with a short
 * line above the hotbar in their language. Kept by their UUID and the server's tick count: leaving and coming back within the time they are still disarmed (and are shown it
 * again on joining); another server starts with none, and nothing is saved. Generated by MineMods Studio.
 */
public final class ${DISARM.runtime}${loader.implementsInit} {
    /** Per disarmed player, the server tick at which it ends. Read and written on the server's own thread only (attacks, blows and joins all run there). */
    private static final Map<UUID, Long> UNTIL = new HashMap<>();
    /** The server the table belongs to: a new one (another world opened in the same game) starts it afresh. */
    private static WeakReference<MinecraftServer> owner = new WeakReference<>(null);

${loader.register}
    private static Map<UUID, Long> table(MinecraftServer server) {
        if (owner.get() != server) {
            owner = new WeakReference<>(server);
            UNTIL.clear();
        }
        return UNTIL;
    }

    /** \`player\` is disarmed for \`ticks\` from now (a longer disarm already running is kept); what they hold shows it at once. */
    public static void disarm(ServerPlayer player, int ticks) {
        MinecraftServer server = player.getServer();
        if (server == null || ticks <= 0) return;
        Map<UUID, Long> until = table(server);
        long now = server.getTickCount();
        until.values().removeIf(end -> end <= now);
        until.merge(player.getUUID(), now + ticks, Math::max);
        show(player, (int) (until.get(player.getUUID()) - now), true);
    }

    /** The ticks \`player\` is still disarmed for, on the server; 0 when they are not (and always in a player's own game, which is never told). */
    public static int left(Player player) {
        if (!(player instanceof ServerPlayer served) || served.getServer() == null) return 0;
        Map<UUID, Long> until = table(served.getServer());
        Long end = until.get(served.getUUID());
        if (end == null) return 0;
        long left = end - served.getServer().getTickCount();
        if (left <= 0) {
            until.remove(served.getUUID());
            return 0;
        }
        return (int) left;
    }

    /** Whether a melee attack of \`player\` goes ahead: not while disarmed, decided on the server (a player's own game always swings; the server calls the attack off). */
    public static boolean allows(Player player) {
        if (player.level().isClientSide()) return true;
        int left = left(player);
        if (left <= 0) return true;
        show((ServerPlayer) player, left, false);
        return false;
    }

    /** A player who left while disarmed and is back within the time: their game is shown it again (a new game knows no cooldown). */
    private static void rejoined(ServerPlayer player) {
        int left = left(player);
        if (left > 0) show(player, left, true);
    }

    /** What they hold shows the cooldown (\`fresh\`: set it whatever it was; otherwise only on what is not cooling down already, such as an item just taken in hand), and the line. */
    private static void show(ServerPlayer player, int left, boolean fresh) {
        ItemStack held = player.getMainHandItem();
        if (!held.isEmpty() && (fresh || !player.getCooldowns().isOnCooldown(held.getItem()))) player.getCooldowns().addCooldown(held.getItem(), left);
        player.displayClientMessage(Component.translatable(${JSON.stringify(DISARM.key(modId))}, String.format(Locale.ROOT, "%.1f", left / 20.0)), true);
    }
}
`
}

/** Fabric 1.21.1: an entry point of its own registers Fabric API's attack and join callbacks. */
const fabricSource = (packageName: string, modId: string) =>
  disarmSource(packageName, modId, {
    imports: `import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.world.InteractionResult;
`,
    implementsInit: " implements ModInitializer",
    register: `    /** Fabric's entry point (named in fabric.mod.json): a disarmed player's attack fails on the server; a player who joins while disarmed is shown it again. */
    @Override public void onInitialize() {
        AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> allows(player) ? InteractionResult.PASS : InteractionResult.FAIL);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> rejoined(handler.player));
    }
`,
  })

/** A facade target (Forge, NeoForge): \`register()\` is run by the common entry, through the facade's attack and join hooks. */
const facadeSource = (packageName: string, modId: string) =>
  disarmSource(packageName, modId, {
    imports: `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
`,
    implementsInit: "",
    register: `    /** Run by the common entry while the mod is constructed: a disarmed player's attack is called off; a player who joins while disarmed is shown it again. */
    public static void register() {
        ${PLATFORM_CLASS}.onAttack((player, target) -> allows(player));
        ${PLATFORM_CLASS}.onPlayerJoin(${DISARM.runtime}::rejoined);
    }
`,
  })

/**
 * The disarm's class for a mod in which some ability disarms. \`target\`: Fabric 1.21.1 (the default) names it as an entry point in fabric.mod.json (\`patch\`); a facade target
 * maps it to its game version and runs it from the common entry (\`entries\`). \`language\`: the line a disarmed player is shown, per language.
 */
export function compileDisarm(value: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const facade = target.loader.facade
  const file = `src/main/java/${input.packageName.replaceAll(".", "/")}/entity/${DISARM.runtime}.java`
  const text = facade ? target.version.rewriteJava(facadeSource(input.packageName, input.modId)) : fabricSource(input.packageName, input.modId)
  const edit = (text: string, change: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const edited = `${JSON.stringify(change(z.record(z.string(), z.unknown()).parse(JSON.parse(text))), null, 2)}\n`
    return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
  }
  return {
    files: { [file]: text },
    /** Paths inside the built jar that prove the disarm went in. */
    classes: [`${input.packageName.replaceAll(".", "/")}/entity/${DISARM.runtime}.class`],
    /** Fabric: the class is an entry point (the attack and the join are Fabric API callbacks it registers). A facade target edits nothing. */
    patch: (facade
      ? {}
      : {
          "src/main/resources/fabric.mod.json": (text: string) =>
            edit(text, (metadata) => {
              const entrypoints = z.looseObject({ main: z.array(z.string()) }).parse(metadata.entrypoints)
              return { ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${DISARM.runtime}`] } }
            }),
        }) as Record<string, (text: string) => string>,
    /** What a facade target's common entry runs (\`<class>.register()\`). */
    entries: { common: facade ? [`${input.packageName}.entity.${DISARM.runtime}`] : [], client: [] as string[] },
    language: {
      zh_cn: { [DISARM.key(input.modId)]: "兵器被夺：%s 秒内不能近战攻击" },
      en_us: { [DISARM.key(input.modId)]: "Disarmed: you can't strike for %s s" },
    } as Record<"zh_cn" | "en_us", Record<string, string>>,
  }
}
