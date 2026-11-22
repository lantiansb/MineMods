import path from "node:path"
import { randomUUID } from "node:crypto"
import type { GameplayDocument } from "../src/gameplay"
import { openProject, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { GESTURE_EXAMPLE } from "../src/gesture-bases"
import { WorkspaceAssetSchema } from "../src/workspace"
import { SKY_EXAMPLE } from "../test/gesture-sample"
import { createDataGameplaySample } from "./data-gameplay-sample"

/**
 * The gameplay group of the platform layer (平台层-移植清单.md, D 组) on one target: the data-and-gameplay sample (`data-gameplay-sample.ts`,
 * `life`: the crystal golem with its drops, experience, spawning and the guarding gameplay that makes it keep to the azure ore) for a target of its
 * own, and beside the guarding gameplay a second one, 「玩法接口探针」, that uses every member of what gameplay code reaches the loader through
 * (`ProjectPlatform`, `ProjectClient`) and says in the log what ran. Its abilities (another group's port, A 组) are left out; so are the ore's
 * generation and experience (E 组): the blocks are the same blocks without them.
 *
 *   bun packages/mod-core/script/target-gameplay-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */

const PROBE_MAIN = (pkg: string, api: string, golem: string) => `package ${pkg};

import ${api}.GameplayEntry;
import ${api}.ProjectContent;
import ${api}.ProjectPlatform;
import com.mojang.brigadier.Command;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Supplier;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.item.Item;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class Main implements GameplayEntry {
    static final Logger LOG = LoggerFactory.getLogger("gameplay_probe");
    private static final String GOLEM = "${golem}";
    private static final Set<String> SAID = new HashSet<>();
    static final Supplier<Item> CHARM = ProjectPlatform.register(Registries.ITEM, "probe_charm", () -> new Item(new Item.Properties()));
    public static final ProjectPlatform.Channel<Ping> PING = ProjectPlatform.s2c("probe_ping", Ping.class, Ping::write, Ping::read);
    public static final ProjectPlatform.Channel<Ping> PONG = ProjectPlatform.c2s("probe_pong", Ping.class, Ping::write, Ping::read, (player, ping) -> LOG.info("GAMEPLAY_PROBE pong {} from {}", ping.value(), player.getName().getString()));
    private static int ticks;

    static void once(String key, String message, Object... values) {
        if (SAID.add(key)) LOG.info(message, values);
    }

    @Override
    public void onInitialize() {
        ProjectContent.addGoal(GOLEM, 4, ProbeGoal::new);
        ProjectContent.addTargetGoal(GOLEM, 3, mob -> new NearestAttackableTargetGoal<>(mob, Villager.class, true));
        ProjectContent.targetRule(GOLEM, (mob, candidate) -> {
            once("rule:" + candidate.getType(), "GAMEPLAY_PROBE target rule asked about {}", BuiltInRegistries.ENTITY_TYPE.getKey(candidate.getType()));
            return true;
        });
        ProjectPlatform.onServerStarted(server -> LOG.info("GAMEPLAY_PROBE server started, charm registered: {}", BuiltInRegistries.ITEM.containsKey(ProjectContent.id("probe_charm"))));
        ProjectPlatform.onServerTick(server -> {
            if (++ticks == 100) LOG.info("GAMEPLAY_PROBE 100 server ticks");
        });
        ProjectPlatform.onLevelTick(level -> once("level:" + level.dimension().location(), "GAMEPLAY_PROBE level tick {}", level.dimension().location()));
        ProjectPlatform.onPlayerJoin(player -> PING.sendTo(player, new Ping(1)));
        ProjectPlatform.onEntityDeath((entity, source) -> {
            if (ProjectContent.isEntity(entity, GOLEM)) LOG.info("GAMEPLAY_PROBE golem died: {}", source.getMsgId());
        });
        ProjectPlatform.onUseBlock((player, level, hand, hit) -> hand == InteractionHand.MAIN_HAND && level.getBlockState(hit.getBlockPos()).is(ProjectContent.block("azure_ore")) ? InteractionResult.SUCCESS : InteractionResult.PASS);
        ProjectPlatform.onUseItem((player, level, hand) -> hand == InteractionHand.MAIN_HAND && player.getItemInHand(hand).is(CHARM.get()) ? InteractionResult.SUCCESS : InteractionResult.PASS);
        ProjectPlatform.onUseEntity((player, level, hand, entity) -> hand == InteractionHand.MAIN_HAND && ProjectContent.isEntity(entity, GOLEM) ? InteractionResult.SUCCESS : InteractionResult.PASS);
        ProjectPlatform.onCommands(dispatcher -> dispatcher.register(Commands.literal("gameplayprobe").executes(context -> {
            int golems = 0;
            for (ServerLevel level : context.getSource().getServer().getAllLevels())
                for (Entity entity : level.getAllEntities())
                    if (ProjectContent.isEntity(entity, GOLEM)) golems++;
            LOG.info("GAMEPLAY_PROBE command: {} golems, the ore is {}", golems, BuiltInRegistries.BLOCK.getKey(ProjectContent.block("azure_ore")));
            final int counted = golems;
            context.getSource().sendSuccess(() -> Component.literal("golems: " + counted), false);
            return Command.SINGLE_SUCCESS;
        })));
    }
}
`

const PROBE_GOAL = (pkg: string) => `package ${pkg};

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;

/** Never runs: it only says, once for each kind, that the creature asks it. */
final class ProbeGoal extends Goal {
    private final PathfinderMob mob;

    ProbeGoal(PathfinderMob mob) {
        this.mob = mob;
    }

    @Override
    public boolean canUse() {
        Main.once("goal:" + mob.getType(), "GAMEPLAY_PROBE added goal asked by {}", BuiltInRegistries.ENTITY_TYPE.getKey(mob.getType()));
        return false;
    }
}
`

const PROBE_PING = (pkg: string) => `package ${pkg};

import net.minecraft.network.FriendlyByteBuf;

/** A packet of this gameplay's own: one number. */
public record Ping(int value) {
    public static void write(Ping ping, FriendlyByteBuf buffer) {
        buffer.writeVarInt(ping.value());
    }

    public static Ping read(FriendlyByteBuf buffer) {
        return new Ping(buffer.readVarInt());
    }
}
`

const PROBE_CLIENT = (pkg: string, api: string, root: string) => `package ${pkg}.client;

import ${api}.GameplayClientEntry;
import ${api}.ProjectClient;
import ${root}.Main;
import ${root}.Ping;
import net.minecraft.client.KeyMapping;
import org.lwjgl.glfw.GLFW;

public final class ClientMain implements GameplayClientEntry {
    private static final KeyMapping KEY = new KeyMapping("key.gameplay_probe.pong", GLFW.GLFW_KEY_P, "key.categories.misc");
    private static int received;

    @Override
    public void onInitializeClient() {
        ProjectClient.keyMapping(KEY);
        ProjectClient.onReceive(Main.PING, ping -> received = ping.value());
        ProjectClient.onClientTick(() -> {
            while (KEY.consumeClick()) ProjectClient.send(Main.PONG, new Ping(received));
        });
        ProjectClient.onHud((graphics, partialTick) -> {
            if (received > 0) graphics.fill(0, 0, 2, 2, 0xff49c6e8);
        });
    }
}
`

/** The probe gameplay for one project (its mod id), its golem (the creature's asset id) and the ore (the block's). */
export function probeGameplay(modId: string, golem: string, ore: string): GameplayDocument {
  const root = `com.minemods.content_${modId}.gameplay`
  const pkg = `${root}.studio_probe`
  return {
    kind: "gameplay",
    slug: "studio_probe",
    name: "玩法接口探针",
    summary: "检查用：把玩法代码能用的加载器接口各用一次，并在日志里说出哪些跑了。",
    behaviours: [
      { when: "服务器开好的时候", does: "在日志里写一行，说探针的物品登记上了没有", shows: "服务器日志里出现 GAMEPLAY_PROBE server started" },
      { when: "晶石傀儡想找事做、想挑目标的时候", does: "各在日志里说一次被问到了；它会去打附近的村民", shows: "日志里出现 GAMEPLAY_PROBE added goal asked 和 target rule asked" },
      { when: "在命令行里输入 /gameplayprobe 的时候", does: "数一数世界里有几只晶石傀儡", shows: "回一行 golems: 数量" },
    ],
    not_doing: ["不改变晶石傀儡平常的行为"],
    uses: [golem, ore],
    sources: [
      { path: "Main.java", content: PROBE_MAIN(pkg, `${root}.api`, golem) },
      { path: "ProbeGoal.java", content: PROBE_GOAL(pkg) },
      { path: "Ping.java", content: PROBE_PING(pkg) },
      { path: "client/ClientMain.java", content: PROBE_CLIENT(pkg, `${root}.api`, pkg) },
    ],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  }
}

/** `gestures`: also the two cast actions of the gesture sample (G and H), so one build and one server carry both groups' work. */
export async function createTargetGameplaySample(directory: string, target: TargetId, options: { gestures?: boolean } = {}) {
  const made = await createDataGameplaySample(directory, { life: true })
  const project = await openProject(directory)
  const golem = project.entities[0]!
  const now = new Date().toISOString()
  const probe = probeGameplay(project.mod_id, golem.id, project.blocks.find((block) => block.identifier === "azure_ore")!.id)
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...project,
      target,
      // The blocks without what another group ports (generation, experience), so the build is held only to this group's port.
      blocks: project.blocks.map(({ generation: _generation, experience: _experience, ...block }) => block),
      workspace: {
        assets: [
          ...project.workspace.assets,
          ...(options.gestures ? [GESTURE_EXAMPLE, SKY_EXAMPLE].map((document) => WorkspaceAssetSchema.parse({ id: randomUUID(), module: "gesture", title: document.name, revision: 1, created_at: now, updated_at: now, prompt: "施法动作", dependencies: [], document, provenance: { model: null, request_id: null }, status: "ready" })) : []),
          WorkspaceAssetSchema.parse({ id: randomUUID(), module: "gameplay", title: probe.name, revision: 1, created_at: now, updated_at: now, prompt: "检查玩法接口", dependencies: probe.uses, document: probe, provenance: { model: "example", request_id: null }, status: "ready" }),
        ],
      },
    }),
    made.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-gameplay-sample.ts <empty directory> [target]")
  const project = await createTargetGameplaySample(path.resolve(directory), target as TargetId, { gestures: process.argv.includes("--gestures") })
  console.log(`Gameplay project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
