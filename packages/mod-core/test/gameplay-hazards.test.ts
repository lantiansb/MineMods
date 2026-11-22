import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { blockFacets, itemFacets } from "../src/content-facets"
import { findingLine, type GameplayDocument } from "../src/gameplay"
import { GAMEPLAY_API_WORDS, floorPassed, staticChecks } from "../src/gameplay-check"
import { GameplayCheckSchema } from "../src/gameplay-loop"
import { GOAL_ALWAYS_WORDS, READ_FROM_CODE, checkGameplayReferences, gameplayPuts, goalAdvice } from "../src/gameplay-references"
import { EMPTY_WEAPON_WORDS, GAMEPLAY_SCAN_LIMITS, HAND_WORDS, INTERACTION_CALLBACKS, LOAD_REENTRY, scanEmptyWeapon, scanGameplay, scanInteractionHands, scanStartup } from "../src/gameplay-scan"
import { GAMEPLAY_ALWAYS_REVIEW, GAMEPLAY_DISCIPLINE, GAMEPLAY_HAND_REVIEW, GAMEPLAY_LOAD_REVIEW, GAMEPLAY_LOAD_WORDS, GAMEPLAY_REVIEWER_INSTRUCTIONS, GAMEPLAY_RUNTIME_REVIEW, GAMEPLAY_RUNTIME_WORDS, GAMEPLAY_WRITER_INSTRUCTIONS } from "../src/gameplay-words"
import { playability, projectThings } from "../src/playable"
import type { Project } from "../src/project"
import { playFindings } from "../src/reconcile"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const fixture = (name: string) => readFile(path.join(import.meta.dir, "fixtures", "gameplay", name), "utf8")
const PACKAGE = "com.minemods.content_azure_sample.gameplay.highland"
const scan = (content: string, file = "Main.java") => scanGameplay({ mod_id: "azure_sample", slug: "highland", sources: [{ path: file, content }] })
const java = (body: string, members = "") => `package ${PACKAGE};\nfinal class Probe {\n${members}\n    void run() {\n${body}\n    }\n}\n`

/** The living sample with its one gameplay replaced by `sources`, attached to the golem, the block 蓝晶块 and the item 蓝晶碎片. */
async function sample(sources: GameplayDocument["sources"], change: (project: Project) => Partial<Project> = () => ({})) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-hazards-"))
  roots.push(root)
  const made = await createDataGameplaySample(path.join(root, "project"), { life: true })
  const golem = made.entities[0]!
  const uses = [golem.id, made.blocks.find((block) => block.identifier === "azure_block")!.id, made.items.find((item) => item.identifier === "azure_shard")!.id]
  const written = sources.map((file) => ({ ...file, content: file.content.replaceAll("CREATURE_ID", golem.id) }))
  const assets = made.workspace.assets.map((asset) => (asset.document.kind === "gameplay" ? { ...asset, title: "高处长出来", dependencies: uses, document: { ...asset.document, slug: "highland", name: "高处长出来", uses, sources: written } } : asset))
  const project = { ...made, workspace: { assets }, ...change(made) } as Project
  const gameplay = assets.find((asset) => asset.document.kind === "gameplay")!
  return { project, asset: gameplay, document: gameplay.document as unknown as GameplayDocument }
}

// ---- 1. the world is not asked for anything from inside a load callback ----

test("the gameplay that froze a world at load is refused line by line, and its repair passes", async () => {
  const original = scan(await fixture("chunk-load-original.java"))
  expect(original.map((finding) => [finding.rule, finding.line, /调用了 ([\w(世界, …)]+)。/.exec(finding.message)?.[1]])).toEqual([
    ["load_reentry", 32, "getHeight"],
    ["load_reentry", 39, "getBiome"],
    ["load_reentry", 41, "getBlockState"],
    ["load_reentry", 41, "getBlockState"],
    ["load_reentry", 42, "setBlock"],
    ["load_reentry", 43, "spawn(世界, …)"],
  ])
  expect(findingLine(original[0]!)).toBe(
    "Main.java 第 32 行：在 ServerChunkEvents.CHUNK_LOAD 的回调里通过世界调用了 getHeight。这个回调是在这一格区块还没载入完的时候被叫到的。这时向世界要方块、高度、区块，或者往世界里放东西，游戏会回头等这格区块载入完，而它正等着你的回调结束：玩家进世界时会卡在载入画面不动（真实发生过）。要读这格区块里的东西，直接读回调交给你的那个区块，不经过世界：chunk.getHeight(类型, x, z) 给的是最高那块方块的 y（比 level.getHeight(类型, x, z) 小 1），chunk.getBlockState(pos) 读方块。要改世界（放方块、放生物），先把位置记进一个队列，等这一刻结束、在 ServerTickEvents.END_WORLD_TICK 里再做。server.execute(...) 不算推迟：在服务端主线程上它会当场执行。",
  )
  expect(original[1]!.message).toStartWith("在 ServerChunkEvents.CHUNK_LOAD 的回调里（回调调用到的方法里）通过世界调用了 getBiome。")
  expect(scan(await fixture("chunk-load-fixed.java"))).toEqual([])
})

test("the rule follows the shapes a callback is written in, and leaves alone what is not run inside it", () => {
  const rules = (content: string) => scan(content).map((finding) => `${finding.line}:${/调用了 ([\w(世界, …)]+)。/.exec(finding.message)?.[1]}`)
  // A method reference; a listener written out as an anonymous class; the world taken from the chunk.
  expect(rules(java("ServerChunkEvents.CHUNK_GENERATE.register(Probe::made);", "    static void made(ServerLevel w, LevelChunk c) {\n        w.getChunk(c.getPos().x + 1, c.getPos().z);\n    }"))).toEqual(["4:getChunk"])
  expect(rules(java("ServerChunkEvents.CHUNK_LOAD.register(new ServerChunkEvents.Load() {\n    public void onChunkLoad(ServerLevel world, LevelChunk chunk) {\n        world.addFreshEntity(null);\n    }\n});"))).toEqual(["7:addFreshEntity"])
  expect(rules(java("ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> chunk.getLevel().getBlockState(chunk.getPos().getWorldPosition()));"))).toEqual(["5:getBlockState"])
  expect(rules(java("ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> { var level = chunk.getLevel(); level.getBlockState(null); });"))).toEqual(["5:getBlockState"])
  // Entities and block entities: the world is the second parameter there.
  const entity = scan(java("ServerEntityEvents.ENTITY_LOAD.register((entity, world) -> { if (world.getBlockState(entity.blockPosition()).isAir()) entity.discard(); });"))
  expect(entity.map((finding) => finding.rule)).toEqual(["load_reentry"])
  expect(entity[0]!.message).toContain(LOAD_REENTRY.entity.why)
  expect(rules(java("ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.register((be, world) -> world.setBlock(be.getBlockPos().above(), null, 3));"))).toEqual(["5:setBlock"])
  // execute() runs at once on the server thread, so it is no way out; a lambda put in a queue waits there and is.
  expect(rules(java("ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> world.getServer().execute(() -> world.setBlock(null, null, 3)));"))).toEqual(["5:setBlock"])
  expect(rules(java("ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> LATER.add(() -> world.setBlock(null, null, 3)));"))).toEqual([])
  // Reading the chunk that was handed over, sounds and entity lists, the client's events of the same name, and the world anywhere else: all as before.
  expect(rules(java("ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> { chunk.getBlockState(null); chunk.getHeight(null, 0, 0); world.playSound(null, null, null, null, 1f, 1f); world.players(); });"))).toEqual([])
  expect(rules(java("ClientChunkEvents.CHUNK_LOAD.register((world, chunk) -> world.getBlockState(null));"))).toEqual([])
  expect(rules(java("ServerTickEvents.END_WORLD_TICK.register(world -> world.setBlock(null, world.getBlockState(null), 3));"))).toEqual([])
  expect(rules(java("// ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> world.getHeight(null, 0, 0));"))).toEqual([])
  // What it cannot see is said where the other limits are.
  expect(GAMEPLAY_SCAN_LIMITS.at(-1)).toContain("世界先存进字段再用")
  expect(rules(java("ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> { held = world; later(); });", "    static ServerLevel held;\n    static void later() { held.getHeight(null, 0, 0); }"))).toEqual([])
})

test("writers are told the rule with its reason, and reviewers hold it as blocking", () => {
  expect(GAMEPLAY_LOAD_WORDS).toContain("ServerChunkEvents.CHUNK_LOAD、ServerChunkEvents.CHUNK_GENERATE、ServerEntityEvents.ENTITY_LOAD、ServerBlockEntityEvents.BLOCK_ENTITY_LOAD")
  expect(GAMEPLAY_LOAD_WORDS).toContain(LOAD_REENTRY.chunk.why)
  expect(GAMEPLAY_LOAD_WORDS).toContain("ServerTickEvents.END_WORLD_TICK")
  ;[GAMEPLAY_DISCIPLINE, GAMEPLAY_WRITER_INSTRUCTIONS].forEach((words) => expect(words).toContain(GAMEPLAY_LOAD_WORDS))
  ;[GAMEPLAY_LOAD_REVIEW, GAMEPLAY_ALWAYS_REVIEW].forEach((words) => expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain(words))
  expect(GAMEPLAY_LOAD_REVIEW).toContain("写进 findings（必须改的）")
})

// ---- 2. what gameplay code places or hands out is a way to come by it ----

test("a block gameplay code places and an item it hands out are sources, said as read from the code", async () => {
  const main = { path: "Main.java", content: await fixture("chunk-load-fixed.java") }
  // Without its recipe 蓝晶块 had no source at all.
  const { project, asset, document } = await sample([main], () => ({ recipes: [] }))
  expect(checkGameplayReferences(project, document, asset.id)).toEqual([])
  expect(gameplayPuts(project, "azure_block")).toEqual([{ id: asset.id, title: "高处长出来", placed: true, given: false }])
  expect(gameplayPuts(project, "azure_shard")).toEqual([{ id: asset.id, title: "高处长出来", placed: false, given: true }])
  expect(gameplayPuts(project, "azure_ore")).toEqual([])
  const source = (facets: ReturnType<typeof blockFacets>) => facets.filter((facet) => facet.question === "source")
  expect(source(blockFacets(project.blocks.find((block) => block.identifier === "azure_block")!, project))).toEqual([
    { question: "source", answered: true, words: `玩法「高处长出来」的代码会把它放进世界（${READ_FROM_CODE}；什么时候放、放在哪儿，见那个玩法的说明）`, through: [asset.id] },
  ])
  expect(READ_FROM_CODE).toBe("Studio 是从代码里读出来的，没有运行过")
  expect(source(itemFacets(project.items.find((item) => item.identifier === "azure_shard")!, project)).map((facet) => facet.words)).toEqual([
    "挖掉「蓝晶矿石」会掉 1–2 个",
    "打败「晶石傀儡」会掉 1–3 个",
    `玩法「高处长出来」的代码会把它交给玩家或者掉在世界里（${READ_FROM_CODE}；什么时候给，见那个玩法的说明）`,
  ])
  // The machine reconciliation no longer says "creative only" about it, and a survival player gets to it.
  expect(playFindings(project).filter((finding) => finding.rule.startsWith("play_"))).toEqual([])
  expect(playability(projectThings(project)).things.find((thing) => thing.title === "蓝晶块")).toMatchObject({ reachable: true })

  // Code that only asks whether a block is this one, and clears it, places nothing: the question stays open, in words that do not claim more than was read.
  const asks = { path: "Main.java", content: `package ${PACKAGE};\npublic final class Main implements GameplayEntry {\n    public void onInitialize() {}\n    static void pick(ServerLevel world, BlockPos pos) {\n        boolean ours = world.getBlockState(pos).is(ProjectContent.block("azure_block"));\n        if (ours) world.setBlock(pos, Blocks.AIR.defaultBlockState(), 3);\n    }\n}\n` }
  const asking = await sample([asks], () => ({ recipes: [] }))
  expect(gameplayPuts(asking.project, "azure_block")).toEqual([])
  expect(source(blockFacets(asking.project.blocks.find((block) => block.identifier === "azure_block")!, asking.project))).toEqual([
    { question: "source", answered: false, words: "不会在世界里生成，没有配方，也没有方块或生物掉它：只能在创造模式物品栏里拿到；玩法「高处长出来」挂在它上面，但 Studio 没能从代码里读出是不是它把这样东西放进世界或交给玩家，要你自己进游戏看" },
  ])
})

// ---- 3. a goal over idling that can always start ----

const goal = (canUse: string, controls = "setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK));") =>
  `package ${PACKAGE};\nfinal class DriftGoal extends Goal {\n    private final PathfinderMob mob;\n    DriftGoal(PathfinderMob mob) {\n        this.mob = mob;\n        ${controls}\n    }\n    @Override\n    public boolean canUse() {\n        ${canUse}\n    }\n}\n`
const adding = (priority: number) => `package ${PACKAGE};\npublic final class Main implements GameplayEntry {\n    public void onInitialize() {\n        ProjectContent.addGoal("CREATURE_ID", ${priority}, mob -> new DriftGoal(mob));\n    }\n}\n`

test("a goal at 2 to 4 that holds the body and waits for nothing is told to the writer as advice, never as a refusal", async () => {
  const drifting = await sample([{ path: "Main.java", content: adding(2) }, { path: "DriftGoal.java", content: goal("return mob.getTarget() == null && !mob.isInWater();") }])
  const check = staticChecks(drifting.project, drifting.document, drifting.asset.id)
  expect(check.bounds).toEqual([])
  expect(check.references).toEqual([])
  expect(check.advice!.map(findingLine)).toEqual([
    `Main.java 第 4 行：DriftGoal 加在优先级 2、占着 MOVE 和 LOOK，而它的 canUse 只看生物自己当下的状态（没有目标、不在水里），没有任何要等的事：这只生物只要没在游泳、没在打架，它就一直上场，闲逛（5）、看向玩家（6）、张望（7）用的是同一副身体，就一直轮不到。（Studio 是从代码里读出来的，没有运行过；只看了 canUse 的写法。）${GOAL_ALWAYS_WORDS.fix}`,
  ])
  expect(GOAL_ALWAYS_WORDS.fix).toStartWith("这是提醒，不拦这一版。")
  // Advice is carried in the record of a check and never decides whether the version may be kept.
  const whole = { ...check, compile: { ok: true, findings: [], compiler: "javac", note: null } }
  expect(floorPassed(whole)).toBe(true)
  expect(GameplayCheckSchema.parse(whole).advice).toHaveLength(1)
  expect(GameplayCheckSchema.parse({ bounds: [], references: [], compile: null })).not.toHaveProperty("advice")

  const said = (content: string, priority = 2, controls?: string) => goalAdvice({ sources: [{ path: "Main.java", content: adding(priority) }, { path: "DriftGoal.java", content: goal(content, controls) }] }).length
  expect(said("return true;")).toBe(1)
  expect(said("return this.mob.getTarget() == null;", 4)).toBe(1)
  // A real condition, a goal after everything, a goal that holds nothing, and anything the pattern cannot read plainly: nothing is said.
  expect(said("return mob.getTarget() == null && mob.getRandom().nextInt(200) == 0;")).toBe(0)
  expect(said("return mob.getTarget() == null && mob.tickCount >= next;")).toBe(0)
  expect(said("return true;", 8)).toBe(0)
  expect(said("return true;", 2, "")).toBe(0)
  expect(said("if (mob.getTarget() != null) return false;\n        return ready();")).toBe(0)
  expect(GAMEPLAY_API_WORDS.join("")).toContain("一个只要闲着就能开始的行为")
})

test("编译能过、进游戏才坏的写法：当场写明的会被退回，写对的不会被误伤", () => {
  const source = `package x;
public final class Main implements ModInitializer {
  static final ResourceLocation A = ProjectContent.id("myPayload");
  static final ResourceLocation B = ResourceLocation.fromNamespaceAndPath("minecraft", "stone");
  static final ResourceLocation C = ResourceLocation.parse("Bad Name:thing");
  // ProjectContent.id("Also Bad") in a comment is not code
  private final EntityDataAccessor<Integer> T = SynchedEntityData.defineId(Main.class, EntityDataSerializers.INT);
  private static final EntityDataAccessor<Integer> U = SynchedEntityData.defineId(Player.class, EntityDataSerializers.INT);
  private static final EntityDataAccessor<Integer> V = SynchedEntityData.defineId(Main.class, EntityDataSerializers.INT);
  public void onInitialize() {
    ServerLifecycleEvents.SERVER_STARTING.register(server -> { var w = server.overworld(); });
    ServerLifecycleEvents.SERVER_STARTED.register(server -> { var w = server.overworld(); });
    ServerTickEvents.END_SERVER_TICK.register(server -> { Registry.register(BuiltInRegistries.ITEM, ProjectContent.id("late"), new Item(new Item.Properties())); });
    Registry.register(BuiltInRegistries.ITEM, ProjectContent.id("fine"), new Item(new Item.Properties()));
    ClientTickEvents.END_CLIENT_TICK.register(client -> { client.player.displayClientMessage(Component.literal("x"), false); });
    ClientTickEvents.END_CLIENT_TICK.register(client -> { if (client.player == null) return; client.player.displayClientMessage(Component.literal("x"), false); });
    ClientTickEvents.END_CLIENT_TICK.register((Minecraft mc) -> { mc.level.getGameTime(); });
  }
}`
  const found = scanStartup([{ path: "Main.java", content: source }])
  expect(found.map((finding) => [finding.line, finding.rule])).toEqual([[3, "bad_id"], [5, "bad_id"], [7, "tracked_owner"], [8, "tracked_owner"], [11, "early_world"], [13, "late_registration"], [15, "client_not_in_world"], [17, "client_not_in_world"]])
  expect(found.every((finding) => finding.fix.length > 0 && finding.file === "Main.java")).toBe(true)
  // A name that is put together at run time cannot be read: passed over, never guessed at.
  expect(scanStartup([{ path: "Main.java", content: 'class Main { ResourceLocation a = ProjectContent.id("x_" + NAME); ResourceLocation b = ResourceLocation.fromNamespaceAndPath(MOD, "y"); }' }])).toEqual([])
  // Each way the game makes a name from text: a path alone (withDefaultNamespace, or parse without a colon), or a namespace and a path. tryParse answers null instead of throwing.
  const names = 'class Main {\n  ResourceLocation a = ResourceLocation.withDefaultNamespace("Stone");\n  ResourceLocation b = ResourceLocation.parse("stone");\n  ResourceLocation c = ResourceLocation.withDefaultNamespace("a:b");\n  ResourceLocation d = ResourceLocation.parse("Mod:stone");\n  ResourceLocation e = ResourceLocation.tryParse("Bad Name");\n}'
  expect(scanStartup([{ path: "Main.java", content: names }]).map((finding) => [finding.line, finding.rule])).toEqual([[2, "bad_id"], [4, "bad_id"], [5, "bad_id"]])
})

test("a game class that shares a simple name with a refused JDK class is judged by its own package: the block and item Properties are fine, java.util.Properties is not", () => {
  const withImport = (name: string) => `package ${PACKAGE};\nimport ${name};\nfinal class Probe {\n    Object settings() { return Properties.of(); }\n}\n`
  expect(scan(withImport("net.minecraft.world.level.block.state.BlockBehaviour.Properties")).filter((finding) => finding.rule === "files")).toEqual([])
  expect(scan(java("Object settings = net.minecraft.world.level.block.state.BlockBehaviour.Properties.of();")).filter((finding) => finding.rule === "files")).toEqual([])
  expect(scan(java("Object settings = new net.minecraft.world.item.Item.Properties();")).filter((finding) => finding.rule === "files")).toEqual([])
  // The JDK's still is refused, imported, written out in full, or used bare from a wildcard.
  expect(scan(withImport("java.util.Properties")).map((finding) => finding.rule)).toContain("files")
  expect(scan(java("Object p = new java.util.Properties();")).map((finding) => finding.rule)).toContain("files")
  expect(scan(java("Object p = new Properties();")).map((finding) => finding.rule)).toContain("files")
  // A game class that is listed by its full name stays refused.
  expect(scan(java("Object io = net.minecraft.nbt.NbtIo.class;")).map((finding) => finding.rule)).toContain("files")
})

// ---- 4. a right-click callback is asked once for each hand (round 18) ----

test("a right-click callback that never looks at its hand is refused, whichever way it is written, and one that does is let through", () => {
  const hands = (body: string, members = "") => scan(java(body, members)).filter((finding) => finding.rule === "hand")
  // The faulty shapes of the retest: a message said and an item given for every click, once by each hand.
  const faulty = [
    "UseBlockCallback.EVENT.register((player, world, hand, hit) -> { player.displayClientMessage(null, false); return InteractionResult.SUCCESS; });",
    "UseBlockCallback.EVENT.register((Player player, Level world, InteractionHand hand, BlockHitResult hit) -> {\n        player.addItem(null);\n        return InteractionResult.PASS;\n    });",
    "UseItemCallback.EVENT.register((player, world, hand) -> { player.getCooldowns().addCooldown(null, 20); return InteractionResultHolder.pass(player.getMainHandItem()); });",
    "UseEntityCallback.EVENT.register((player, world, hand, entity, hit) -> { entity.hurt(null, 1f); return InteractionResult.PASS; });",
    "net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register((p, w, h, r) -> greet(p));",
  ]
  for (const body of faulty) expect([body, hands(body, "    static InteractionResult greet(Player p) { return InteractionResult.PASS; }").length]).toEqual([body, 1])
  // A method reference and a listener written out as a class are followed to the method that is called.
  expect(hands("UseBlockCallback.EVENT.register(Probe::onUse);", "    static InteractionResult onUse(Player player, Level world, InteractionHand hand, BlockHitResult hit) {\n        player.displayClientMessage(null, false);\n        return InteractionResult.PASS;\n    }").map((finding) => finding.line)).toEqual([8])
  expect(hands("UseItemCallback.EVENT.register(new UseItemCallback() {\n    public InteractionResultHolder<ItemStack> interact(Player player, Level world, InteractionHand hand) {\n        player.heal(1f);\n        return InteractionResultHolder.pass(null);\n    }\n});")).toHaveLength(1)
  // The finding names the callback and says why in the scan's own words, and it carries the way out.
  const [found] = hands(faulty[0]!)
  expect(found!.message).toContain("UseBlockCallback")
  expect(found!.message).toContain(HAND_WORDS.why)
  expect(found!.fix).toBe(HAND_WORDS.fix)
  expect(found!.line).toBe(5)
  // The correct shapes: the hand is tested, read from, or handed on.
  const correct = [
    "UseBlockCallback.EVENT.register((player, world, hand, hit) -> { if (hand != InteractionHand.MAIN_HAND) return InteractionResult.PASS; player.displayClientMessage(null, false); return InteractionResult.SUCCESS; });",
    "UseItemCallback.EVENT.register((player, world, hand) -> { ItemStack held = player.getItemInHand(hand); held.shrink(1); return InteractionResultHolder.success(held); });",
    "UseEntityCallback.EVENT.register((player, world, hand, entity, hit) -> handle(player, hand, entity));",
    "UseBlockCallback.EVENT.register((player, world, hand, hit) -> hand == InteractionHand.MAIN_HAND ? InteractionResult.SUCCESS : InteractionResult.PASS);",
    // A callback that only answers PASS cannot do anything twice.
    "UseBlockCallback.EVENT.register((player, world, hand, hit) -> InteractionResult.PASS);",
    "UseItemCallback.EVENT.register((player, world, hand) -> { return InteractionResultHolder.pass(null); });",
    "UseItemCallback.EVENT.register((player, world, hand) -> InteractionResultHolder.pass(player.getMainHandItem()));",
    // Other events have no hand to look at, and a name in a comment or a string is no callback.
    "AttackEntityCallback.EVENT.register((player, world, hand, entity, hit) -> { entity.hurt(null, 1f); return InteractionResult.PASS; });",
    "ServerTickEvents.END_WORLD_TICK.register(world -> world.players());",
    "// UseBlockCallback.EVENT.register((player, world, hand, hit) -> { player.displayClientMessage(null, false); return InteractionResult.PASS; });",
  ]
  for (const body of correct) expect([body, hands(body, "    static InteractionResult handle(Player p, InteractionHand h, Entity e) { return InteractionResult.PASS; }").length]).toEqual([body, 0])
  expect(hands("UseBlockCallback.EVENT.register(Probe::onUse);", "    static InteractionResult onUse(Player player, Level world, InteractionHand hand, BlockHitResult hit) {\n        if (hand != InteractionHand.MAIN_HAND) return InteractionResult.PASS;\n        player.displayClientMessage(null, false);\n        return InteractionResult.SUCCESS;\n    }")).toEqual([])
  // Every callback that is asked once for each hand is in the list, and the entry point is the one `scanGameplay` runs.
  expect(INTERACTION_CALLBACKS.map((callback) => callback.owner)).toEqual(["UseBlockCallback", "UseItemCallback", "UseEntityCallback"])
  expect(scanInteractionHands([{ path: "Main.java", content: java(faulty[0]!) }])).toHaveLength(1)
  expect(GAMEPLAY_SCAN_LIMITS.some((line) => line.includes("hand"))).toBe(true)
})

test("a callback that ignores its hand stops the code check, in plain words, and writers and reviewers are told the rule", async () => {
  const faulty = java("UseBlockCallback.EVENT.register((player, world, hand, hit) -> { player.displayClientMessage(null, false); return InteractionResult.SUCCESS; });")
  const { project, document } = await sample([{ path: "Main.java", content: faulty }])
  const checked = staticChecks(project, document, null)
  const found = checked.bounds.filter((finding) => finding.rule === "hand")
  expect(found).toHaveLength(1)
  expect(floorPassed({ ...checked, compile: null } as never)).toBe(false)
  // The person is not told the callback's name: the rule has a sentence of its own.
  const { plainFinding } = await import("../src/gameplay-plain")
  expect(plainFinding(found[0]!)).toContain("左右手")
  expect(plainFinding(found[0]!)).not.toMatch(/Callback|Hand|hand/)
  // The writer is told before writing, with the way out; the reviewer holds a hand that is read and not used as blocking.
  for (const words of [GAMEPLAY_DISCIPLINE, GAMEPLAY_WRITER_INSTRUCTIONS]) {
    expect(words).toContain(HAND_WORDS.why)
    expect(words).toContain(HAND_WORDS.fix)
    expect(words).toContain("UseBlockCallback、UseItemCallback、UseEntityCallback")
  }
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain(GAMEPLAY_HAND_REVIEW)
  expect(GAMEPLAY_HAND_REVIEW).toContain("写进 findings（必须改的）")
})

// ---- 5. a persistent projectile is never built with an empty stack as its weapon (round 19) ----

test("an arrow built with an empty stack as the weapon that shot it is refused wherever the empty stack is written out; null and a real weapon are let through", () => {
  const empty = (body: string, members = "") => scan(java(body, members)).filter((finding) => finding.rule === "empty_weapon")
  // The shape that crashed a world: a pressure plate fired a turret's arrow with ItemStack.EMPTY as the weapon (plate_trigger.Main.fire).
  const crashed = "Arrow arrow = new Arrow(world, turret, new ItemStack(Items.ARROW), ItemStack.EMPTY);"
  expect(empty(crashed)).toHaveLength(1)
  const faulty = [
    "new SpectralArrow(world, turret, new ItemStack(Items.SPECTRAL_ARROW), ItemStack.EMPTY);",
    "new Arrow(world, x, y, z, new ItemStack(Items.ARROW), ItemStack.EMPTY);",
    "new net.minecraft.world.entity.projectile.Arrow(world, turret, ammo, net.minecraft.world.item.ItemStack . EMPTY);",
    "new Arrow(world, turret, ammo, ItemStack.EMPTY.copy());",
    "new Arrow(world, turret, ammo, new ItemStack(Items.AIR));",
    "new Arrow(world, turret, ammo, Items.AIR.getDefaultInstance());",
    "((ArrowItem) Items.ARROW).createArrow(world, new ItemStack(Items.ARROW), turret, ItemStack.EMPTY);",
    // A local or a field that is only ever given an empty stack is the same thing.
    "ItemStack none = ItemStack.EMPTY;\n        new Arrow(world, turret, ammo, none);",
    "new Arrow(world, turret, ammo, NONE);",
  ]
  for (const body of faulty) expect([body, empty(body, "    static final ItemStack NONE = ItemStack.EMPTY;").length]).toEqual([body, 1])
  // A projectile of the gameplay's own that hands the weapon up.
  const own = `package ${PACKAGE};\nfinal class Bolt extends AbstractArrow {\n    Bolt(EntityType<? extends Bolt> type, LivingEntity owner, Level world, ItemStack ammo) {\n        super(type, owner, world, ammo, ItemStack.EMPTY);\n    }\n}\n`
  expect(scan(own, "Bolt.java").filter((finding) => finding.rule === "empty_weapon").map((finding) => finding.line)).toEqual([4])
  // The finding says where, why, and what to write instead.
  const [found] = empty(crashed)
  expect(found!.line).toBe(5)
  expect(found!.message).toContain(EMPTY_WEAPON_WORDS.why)
  expect(found!.fix).toBe(EMPTY_WEAPON_WORDS.fix)
  expect(found!.fix).toContain("null")
  expect(found!.fix).toContain("new ItemStack(Items.CROSSBOW)")
  // What the game accepts: no weapon, a real one, a stack that is not written as empty, a trident (it has no weapon argument), the short constructors.
  const fine = [
    "new Arrow(world, turret, new ItemStack(Items.ARROW), null);",
    "new Arrow(world, turret, new ItemStack(Items.ARROW), new ItemStack(Items.CROSSBOW));",
    "new Arrow(world, x, y, z, new ItemStack(Items.ARROW), shooter.getMainHandItem());",
    "new SpectralArrow(world, turret, new ItemStack(Items.SPECTRAL_ARROW), null);",
    "new Arrow(EntityType.ARROW, world);",
    "new ThrownTrident(world, turret, new ItemStack(Items.TRIDENT));",
    "((ArrowItem) Items.ARROW).createArrow(world, ammo, turret, null);",
    // An empty stack elsewhere than as the weapon is not this fault (the ammunition argument is judged by the game, not here).
    "new Arrow(world, turret, ItemStack.EMPTY, null);",
    "ItemStack held = ItemStack.EMPTY;\n        held = turret.getMainHandItem();\n        new Arrow(world, turret, ammo, held);",
    "new Arrow(world, turret, ammo, weapon);",
    // Words in a comment or a string are no code.
    "// new Arrow(world, turret, ammo, ItemStack.EMPTY);",
    'String note = "new Arrow(world, turret, ammo, ItemStack.EMPTY)";',
  ]
  for (const body of fine) expect([body, empty(body, "    static ItemStack weapon = null;").length]).toEqual([body, 0])
  expect(scanEmptyWeapon([{ path: "Main.java", content: java(crashed) }])).toHaveLength(1)
})

test("an arrow with an empty weapon stops the code check in plain words, and writers and reviewers are told the class of fault with this example", async () => {
  const { project, document } = await sample([{ path: "Main.java", content: java("Arrow arrow = new Arrow(null, null, null, ItemStack.EMPTY);") }])
  const checked = staticChecks(project, document, null)
  const found = checked.bounds.filter((finding) => finding.rule === "empty_weapon")
  expect(found).toHaveLength(1)
  expect(floorPassed({ ...checked, compile: null } as never)).toBe(false)
  const { plainFinding } = await import("../src/gameplay-plain")
  expect(plainFinding(found[0]!)).toContain("崩溃")
  expect(plainFinding(found[0]!)).not.toMatch(/ItemStack|Arrow|EMPTY/)
  // The writing discipline carries the line about runtime checks the compiler cannot see, with the real example and no template of any gameplay.
  for (const words of [GAMEPLAY_DISCIPLINE, GAMEPLAY_WRITER_INSTRUCTIONS]) expect(words).toContain(GAMEPLAY_RUNTIME_WORDS)
  expect(GAMEPLAY_RUNTIME_WORDS).toContain("Invalid weapon firing an arrow")
  expect(GAMEPLAY_RUNTIME_WORDS).toContain("null")
  expect(GAMEPLAY_RUNTIME_WORDS).toContain("编译器和 check_code 都看不见")
  expect(GAMEPLAY_RUNTIME_WORDS).not.toContain("empty_weapon")
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain(GAMEPLAY_RUNTIME_REVIEW)
  expect(GAMEPLAY_RUNTIME_REVIEW).toContain("写进 findings（必须改的）")
  expect(GAMEPLAY_SCAN_LIMITS.some((line) => line.includes("ItemStack.EMPTY"))).toBe(true)
})
