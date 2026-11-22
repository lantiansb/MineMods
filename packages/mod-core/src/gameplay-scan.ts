import { GAMEPLAY_API, gameplayPackage, gameplayRoot, modPackage, sourcePackage, type GameplayFinding } from "./gameplay"
import { DEFAULT_TARGET, type TargetId } from "./target/ids"
import { targetManifest } from "./target/manifests"
import { targetWords } from "./target/words"

/**
 * The bounds of gameplay code, checked on its source. A built mod is handed to other players, so code an
 * AI wrote may do anything inside the game and nothing to the machine it runs on: no files, no network,
 * no processes, no reflection, no class loading, no native code, no threads. Imports are held to a list
 * of what is allowed rather than a list of what is not; names that reach the host without any import
 * (`Runtime`, `Thread`, `toFile` …) are refused wherever they stand.
 *
 * A source scan is a guard rail, not a proof: `GAMEPLAY_SCAN_LIMITS` says what it cannot catch.
 * No Node APIs: the app's window runs it too.
 */

/** Package prefixes (ending in a dot) and whole class names a gameplay may import or name in full. */
export const GAMEPLAY_ALLOWED = [
  "net.minecraft.",
  "net.fabricmc.api.",
  "net.fabricmc.fabric.api.",
  "com.mojang.brigadier.",
  "com.mojang.serialization.",
  "com.mojang.datafixers.",
  "com.mojang.blaze3d.",
  "com.mojang.authlib.GameProfile",
  "com.mojang.logging.LogUtils",
  "org.slf4j.Logger",
  "org.slf4j.LoggerFactory",
  "org.joml.",
  "org.jetbrains.annotations.",
  "org.lwjgl.glfw.GLFW",
  "javax.annotation.",
  "it.unimi.dsi.fastutil.",
  "io.netty.buffer.",
  "com.google.common.collect.",
  "com.google.common.base.",
  "com.google.common.math.",
  "com.google.common.primitives.",
  "com.google.gson.",
  "software.bernie.geckolib.",
  "java.lang.",
  "java.math.",
  "java.time.",
  "java.text.",
  "java.util.",
  "java.nio.charset.",
  "java.io.IOException",
  "java.io.UncheckedIOException",
] as const

/**
 * What a gameplay may import on one target (D 组). Fabric: the list above, Fabric API included, as it always was. Forge and NeoForge: the same without
 * Fabric's packages; a loader's API is reached only through Studio's own `ProjectPlatform` and `ProjectClient` (`LOADER_API_REFUSAL`).
 */
export function gameplayAllowed(target: TargetId = DEFAULT_TARGET): readonly string[] {
  return onFacade(target) ? GAMEPLAY_ALLOWED.filter((name) => !name.startsWith("net.fabricmc.")) : GAMEPLAY_ALLOWED
}

/** Whether a target's mods are generated through the facade (Forge, NeoForge): there gameplay code names no loader at all. */
const onFacade = (target: TargetId) => targetManifest(target).loader.kind !== "fabric"

const PLATFORM = GAMEPLAY_API.platform
const CLIENT = GAMEPLAY_API.client_platform

/**
 * For a Fabric API class gameplay code names on Forge or NeoForge: what of Studio's own API does the same, matched on the name as written (longest
 * first). Said in the refusal, so the writer can change the one line and nothing else.
 */
export const FABRIC_EQUIVALENTS: readonly { match: RegExp; use: string }[] = [
  { match: /\bServerTickEvents\b/, use: `${PLATFORM}.onServerTick(server -> …)（每一刻服务器走完以后），或 ${PLATFORM}.onLevelTick(level -> …)（每一刻里每个世界一次）` },
  { match: /\bServerLifecycleEvents\b/, use: `${PLATFORM}.onServerStarted(server -> …)（服务器把世界载入好以后）` },
  { match: /\bUseBlockCallback\b/, use: `${PLATFORM}.onUseBlock((player, level, hand, hit) -> …)，返回 InteractionResult` },
  { match: /\bUseItemCallback\b/, use: `${PLATFORM}.onUseItem((player, level, hand) -> …)，返回 InteractionResult（不是 InteractionResultHolder）` },
  { match: /\bUseEntityCallback\b/, use: `${PLATFORM}.onUseEntity((player, level, hand, entity) -> …)，返回 InteractionResult` },
  { match: /\bServerLivingEntityEvents\b/, use: `${PLATFORM}.onEntityDeath((entity, source) -> …)（生物死了以后）` },
  { match: /\bServerPlayConnectionEvents\b/, use: `${PLATFORM}.onPlayerJoin(player -> …)（玩家进服以后）` },
  { match: /\bCommandRegistrationCallback\b/, use: `${PLATFORM}.onCommands(dispatcher -> dispatcher.register(Commands.literal(…)))` },
  { match: /\bnetworking\b|\bPayloadTypeRegistry\b|PlayNetworking\b|\bPlayerLookup\b/, use: `${PLATFORM}.s2c("名字", 包的类.class, 写, 读) / ${PLATFORM}.c2s(…, (player, 包) -> …) 建一个包（每种包一个自己的类，带 write 和 read），服务端用它的 sendTo / sendTracking / sendNear 发；client/ 里用 ${CLIENT}.onReceive(包, 包 -> …) 收、${CLIENT}.send(包, 值) 发` },
  { match: /\bKeyBindingHelper\b/, use: `${CLIENT}.keyMapping(new KeyMapping(…))，在 onInitializeClient 里` },
  { match: /\bClientTickEvents\b/, use: `${CLIENT}.onClientTick(() -> …)（标题画面也会跑：先判断 Minecraft.getInstance().player 是不是空的）` },
  { match: /\bHudRenderCallback\b/, use: `${CLIENT}.onHud((graphics, partialTick) -> …)` },
  { match: /\bClientModInitializer\b/, use: `client/ClientMain.java 写成 implements ${GAMEPLAY_API.client_entry}` },
  { match: /\bModInitializer\b/, use: `Main.java 写成 implements ${GAMEPLAY_API.entry}` },
  { match: /\battachment\b/i, use: "Studio 没有对应的“数据附件”：整个世界要记的东西用 Minecraft 自己的 SavedData；只关乎一只你自己写的生物的，写进它自己的存档数据（addAdditionalSaveData / readAdditionalSaveData）；做不到的写进 not_doing" },
  { match: /\bregistry\b|\bFabric\w*Settings\b|\bFabricDefaultAttributeRegistry\b/, use: `${PLATFORM}.register(Registries.ITEM, "名字", () -> new Item(…))（别的注册表照样），它给回一个 Supplier，用到时再 .get()` },
]

/** The refusal of a loader's own class in gameplay code on a facade target, with the line of Studio's API that does the same where there is one. */
function loaderApiRefusal(name: string, target: TargetId): Pick<GameplayFinding, "rule" | "message" | "fix"> {
  const t = targetWords(target)
  const fabric = name.startsWith("net.fabricmc.")
  const equivalent = fabric ? FABRIC_EQUIVALENTS.find((entry) => entry.match.test(name)) : undefined
  return {
    rule: "loader_api",
    message: fabric
      ? `用到了 Fabric 的 ${name}，可这个工程是给 ${t.loader} ${t.minecraft} 做的，那里没有 Fabric 的类。`
      : `直接用到了加载器的 ${name}。玩法代码不直接碰加载器（Forge、NeoForge、Fabric 都一样），这样换一个加载器也能照样编译。`,
    fix: equivalent
      ? `改用 Studio 生成的 ${equivalent.use}。`
      : `事件、注册、网络包、按键、HUD 都经 Studio 生成的 ${PLATFORM}（两端）和 ${CLIENT}（只在 client/ 里）：${PLATFORM}.onServerTick、onLevelTick、onServerStarted、onPlayerJoin、onEntityDeath、onUseBlock、onUseItem、onUseEntity、onCommands、register、s2c、c2s，${CLIENT}.keyMapping、onClientTick、onHud、onReceive、send。这里面没有的，这个玩法现在做不了，请在 not_doing 里如实写明。`,
  }
}

type Ban = { rule: string; names: readonly string[]; what: string; fix: string }

const NO_FILES = "玩法要存东西，用 Minecraft 自己的存档办法：SavedData、实体或物品上的数据组件、Fabric 的 data attachment。"
const NO_NETWORK = "玩法要在客户端和服务端之间传消息，用 Fabric 的 networking API（自定义 payload）；不能连游戏以外的任何地址。"
const NO_THREADS = "所有事情都放在游戏自己的节拍上做：ServerTickEvents / ClientTickEvents 里数 tick，或者 server.execute(...)。"
const NO_REFLECTION = "直接用公开的类和方法。碰不到的私有成员在这一版里就是碰不到：不开放反射、mixin 和 access widener。"

/** Inside allowed prefixes, the parts that are not allowed. Longest match wins, so these override `GAMEPLAY_ALLOWED`. */
const BANNED_PACKAGES: readonly Ban[] = [
  { rule: "reflection", names: ["java.lang.reflect.", "java.lang.invoke.", "java.lang.module.", "java.lang.foreign.", "java.lang.ref."], what: "反射、方法句柄或本机内存", fix: NO_REFLECTION },
  { rule: "instrument", names: ["java.lang.instrument.", "java.lang.management."], what: "改写或监视 Java 虚拟机", fix: "玩法不需要碰虚拟机本身，删掉这一段。" },
  { rule: "threads", names: ["java.util.concurrent.", "java.util.Timer", "java.util.TimerTask"], what: "线程、线程池或定时器", fix: NO_THREADS },
  { rule: "class_loading", names: ["java.util.ServiceLoader", "java.util.spi.", "java.util.jar.", "java.util.zip."], what: "加载别的类或者读写压缩包", fix: "玩法的类都写在自己的包里，直接用。" },
  { rule: "files", names: ["java.util.logging.", "java.util.prefs.", "java.util.Scanner", "java.util.Properties", "net.minecraft.nbt.NbtIo", "net.minecraft.FileUtil", "net.minecraft.util.FileZipper", "net.minecraft.world.level.storage.", "net.minecraft.util.eventlog.", "net.minecraft.server.dedicated.", "net.minecraft.server.packs.PathPackResources", "net.minecraft.server.packs.FilePackResources", "net.minecraft.client.Screenshot", "com.mojang.blaze3d.platform.NativeImage"], what: "读写电脑上的文件", fix: NO_FILES },
  { rule: "network", names: ["net.minecraft.util.HttpUtil", "net.minecraft.network.Connection", "net.minecraft.client.multiplayer.resolver.", "net.minecraft.client.multiplayer.ServerStatusPinger", "net.minecraft.client.server.LanServerDetection", "net.minecraft.client.gui.screens.ConnectScreen", "net.minecraft.client.gui.screens.multiplayer.", "com.mojang.realmsclient.", "net.minecraft.server.rcon.", "net.minecraft.client.User", "net.minecraft.client.multiplayer.ProfileKeyPairManager", "net.minecraft.client.multiplayer.AccountProfileKeyPairManager", "net.minecraft.client.multiplayer.chat.report.", "net.minecraft.client.telemetry."], what: "连接游戏以外的地址，或者碰玩家的登录凭据", fix: NO_NETWORK },
]

/** Allowed `java.util.concurrent` names: collections and counters, nothing that starts a thread. */
const CONCURRENT_OK = ["java.util.concurrent.atomic.", "java.util.concurrent.locks.", "java.util.concurrent.ConcurrentHashMap", "java.util.concurrent.ConcurrentLinkedQueue", "java.util.concurrent.ConcurrentLinkedDeque", "java.util.concurrent.CopyOnWriteArrayList", "java.util.concurrent.CopyOnWriteArraySet", "java.util.concurrent.TimeUnit", "java.util.concurrent.ThreadLocalRandom", "java.util.concurrent.CompletableFuture"]

/** Class names refused wherever they stand, because `java.lang` or a wildcard import brings them in without being named in full. */
const BANNED_WORDS: readonly Ban[] = [
  { rule: "process", names: ["Runtime", "ProcessBuilder", "Process", "ProcessHandle"], what: "启动或操纵电脑上的别的程序", fix: "玩法只能在游戏里起作用，删掉这一段。" },
  { rule: "threads", names: ["Thread", "ThreadGroup", "Timer", "TimerTask", "Executors", "ExecutorService", "ScheduledExecutorService", "ForkJoinPool", "Executor"], what: "线程、线程池或定时器", fix: NO_THREADS },
  { rule: "class_loading", names: ["ClassLoader", "URLClassLoader", "ServiceLoader", "MethodHandles", "MethodHandle", "Unsafe", "Instrumentation", "Compiler"], what: "加载、定义或改写类", fix: NO_REFLECTION },
  { rule: "scripting", names: ["ScriptEngine", "ScriptEngineManager"], what: "脚本引擎", fix: "玩法的逻辑直接写成 Java。" },
  { rule: "serialization", names: ["ObjectInputStream", "ObjectOutputStream", "Serializable", "Externalizable"], what: "Java 自带的对象序列化", fix: "要存数据用 Codec 或 NBT，它们只认你写明的字段。" },
  { rule: "files", names: ["File", "Files", "Paths", "FileSystem", "FileSystems", "RandomAccessFile", "FileChannel", "NbtIo", "FileUtil", "FileZipper", "LevelResource", "LevelStorageSource", "NativeImage", "Screenshot", "Scanner", "Properties"], what: "读写电脑上的文件", fix: NO_FILES },
  { rule: "network", names: ["Socket", "ServerSocket", "DatagramSocket", "URL", "URI", "URLConnection", "HttpURLConnection", "HttpClient", "InetAddress", "HttpUtil", "Connection", "ConnectScreen", "ServerAddress"], what: "连接游戏以外的地址", fix: NO_NETWORK },
  { rule: "host", names: ["FabricLoader", "SecurityManager", "Desktop", "Robot", "Toolkit"], what: "探查或操纵游戏所在的电脑", fix: "玩法只读游戏里的东西：世界、玩家、实体、物品。" },
]

/** Method and field names refused on whatever they are called on: with `var`, a host object needs no import to be used. */
const BANNED_MEMBERS: readonly Ban[] = [
  { rule: "reflection", names: ["forName", "getMethod", "getMethods", "getDeclaredMethod", "getDeclaredMethods", "getField", "getFields", "getDeclaredField", "getDeclaredFields", "getConstructor", "getConstructors", "getDeclaredConstructor", "getDeclaredConstructors", "newInstance", "setAccessible", "trySetAccessible", "getProtectionDomain", "getResource", "getResourceAsStream"], what: "反射", fix: NO_REFLECTION },
  { rule: "class_loading", names: ["getClassLoader", "loadClass", "defineClass", "findClass", "getContextClassLoader"], what: "加载或定义类", fix: NO_REFLECTION },
  { rule: "files", names: ["toFile", "toPath", "getFileSystem", "getServerDirectory", "gameDirectory", "getWorldPath", "getGameDir", "getConfigDir", "getResourcePackDirectory", "newInputStream", "newOutputStream", "newByteChannel", "newBufferedReader", "newBufferedWriter", "createNewFile", "deleteOnExit", "deleteIfExists", "mkdirs", "mkdir", "listFiles", "renameTo", "setExecutable", "setWritable", "getAbsolutePath", "getCanonicalPath", "toAbsolutePath", "toRealPath"], what: "电脑上的文件和文件夹", fix: NO_FILES },
  { rule: "network", names: ["openConnection", "openStream", "toURL", "toUri", "getAccessToken", "getSessionId", "getUser", "getSessionService", "getMinecraftSessionService"], what: "网络连接或玩家的登录凭据", fix: NO_NETWORK },
  { rule: "host", names: ["getPlatform", "getClipboard", "setClipboard", "getenv", "getProperties", "halt", "addShutdownHook"], what: "游戏所在的电脑（系统、剪贴板、环境变量）", fix: "玩法只读游戏里的东西：世界、玩家、实体、物品。" },
  { rule: "threads", names: ["supplyAsync", "runAsync", "thenApplyAsync", "thenAcceptAsync", "thenRunAsync", "thenComposeAsync", "handleAsync", "whenCompleteAsync", "parallel", "parallelStream", "ioPool", "backgroundExecutor", "nonCriticalIoPool", "commonPool", "ofVirtual", "ofPlatform", "startVirtualThread"], what: "在游戏主线程以外干活", fix: NO_THREADS },
]

const KEEP_LIFE = `生物平常就会的事（游泳、闲逛、看向玩家、追击）要留着：玩法是在这些之上加行为，不是把它们换掉。用 ${GAMEPLAY_API.content}.addGoal("生物的资产 id", 优先级, mob -> new 你的Goal(mob)) 给它加一个带优先级的 Goal（数字越小越优先：游泳 0、追击 1、闲逛 5、看玩家 6、张望 7；放在 2 到 4 就会压过闲逛、又不挡住游泳）。你的 Goal 不运行的时候，它原来的行为自己会接上。`

/**
 * Calls that take away everything a mob does at once, by their 1.21.1 official names (read off the jar:
 * Mob.removeFreeWill / removeAllGoals / setNoAi, GoalSelector.removeAllGoals / getAvailableGoals,
 * Brain.removeAllBehaviors / clearMemories / stopAll). Such code is inside the game and harms nothing outside it, but
 * it leaves a creature standing still, which is never what a description asks for: refused with what to
 * write instead. A single goal may still be taken off again with GoalSelector.removeGoal.
 */
export const LIFE_ERASERS: readonly { pattern: RegExp; what: string; fix: string }[] = [
  { pattern: /(?<!\b(?:goalSelector|targetSelector)\s*)\.\s*(removeFreeWill|removeAllGoals)\s*\(/, what: "把生物的全部行为清空了", fix: KEEP_LIFE },
  { pattern: /\b(goalSelector|targetSelector)\s*\.\s*(removeAllGoals)\s*\(/, what: "把生物的全部行为清空了", fix: KEEP_LIFE },
  { pattern: /\.\s*getAvailableGoals\s*\(\s*\)\s*\.\s*(clear|removeIf|removeAll|retainAll)\s*\(/, what: "把生物的行为列表直接清掉了", fix: KEEP_LIFE },
  { pattern: /\.\s*getBrain\s*\(\s*\)\s*\.\s*(removeAllBehaviors|clearMemories|stopAll)\s*\(/, what: "把生物的大脑（记忆和正在做的事）整个清空了", fix: KEEP_LIFE },
  { pattern: /\.\s*(setNoAi)\s*\(\s*true\s*\)/, what: "把生物的 AI 整个关掉了，它会变成一动不动的摆设", fix: "要让它停一会儿，停掉这一次的移动（getNavigation().stop()）或者给它一个缓慢效果；要它一直不走动，在生物自己的文档里写 stationary 和原因。" },
]

/** What of `System` is harmless. Everything else of it (exit, load, getenv, getProperty, setOut …) is refused. */
const SYSTEM_OK = ["currentTimeMillis", "nanoTime", "arraycopy", "identityHashCode", "lineSeparator", "out", "err"]
/** Classes of `java` a static import may bring members of into scope. A static import hides whose method a bare call is. */
const STATIC_OK = ["java.lang.Math.", "java.util.Objects."]
const CLIENT_ONLY = ["net.minecraft.client.", "net.fabricmc.fabric.api.client.", "net.fabricmc.api.ClientModInitializer", "com.mojang.blaze3d.", "org.lwjgl."]
/** The first part of a name written out in full. A variable called one of these would read as a package. */
const ROOTS = "java|javax|jdk|sun|com|org|net|io|it|dev|software|kotlin|groovy|scala|oshi"

/** What the scan cannot catch, said as plainly as what it can. The spec, the hand-off text and the card read this list. */
export const GAMEPLAY_SCAN_LIMITS = [
  "它读的是源码，不是运行起来的程序：它拦住的是写明了的越界，证明不了代码一定没有越界。",
  "允许用的 Minecraft 和 Fabric 接口本身能做的事它不管。清单是人手写的，游戏里如果还有别的接口能碰到电脑上的文件或网络、而清单里没列，就拦不住。",
  "游戏里面的破坏它不管：炸掉地形、清空背包、刷出大量生物、让游戏卡死或崩溃、执行游戏命令。这些都在游戏之内，要靠人读说明、读代码和试玩来发现。",
  "通过游戏自己的通道（聊天、发给所在服务器的数据包）往外带信息，它拦不住。",
  "代码写得对不对、和说明是不是一回事，不归它管：那是编译检查、说明核对和人自己试玩的事。",
  "“启动、进世界时才会坏”的那几条（名字里的非法字符、回调里注册、给别的类登记同步数据、SERVER_STARTING 里碰世界、客户端每刻回调里不判空），它只认得出当场写明的：名字是拼出来的、事情是放在别的方法里做的，它看不出来。",
  "“右键回调要分左右手”这一条，它只看回调的代码里有没有出现过 hand 这个参数：只要用到了（哪怕只是原样传给别的方法），就当作处理过左右手，不再往下追；它也不判断判断得对不对。回调写在别的类里再被引用进来，或者用变量存着再注册的，它也看不到。",
  "“箭的发射武器不能是空物品栈”这一条，它只认得出最后一个参数当场写的是 ItemStack.EMPTY（或者一个整个文件里只被赋过空物品栈的变量）：经过别的方法、条件表达式或者先拼出来再传的，它看不出来。同类的、编译能过运行才炸的写法还有很多，它不可能认全，所以进游戏试一次不能省。",
  "“载入回调里不能通过世界读写”这一条，它只认得出写在这个玩法自己文件里的回调（lambda、指到自己某个方法的 类名::方法名、当场写的匿名类），以及回调把世界当参数传下去的自己的方法。世界先存进字段再用、交给 Minecraft 自己的类去读写（例如让一个地物自己生成）、从别的入口绕回载入过程，它都看不出来；别的会让游戏卡住的写法（死循环、每一刻做很重的事）它也不管。",
] as const

/**
 * Fabric callbacks that run while the thing they announce is still being brought into the world, by their
 * names and parameter order in Fabric API 0.116.6 for 1.21.1, in the game's official names (read off the jar with javap:
 * ServerChunkEvents.Load.onChunkLoad(ServerLevel, LevelChunk), Generate.onChunkGenerate(ServerLevel, LevelChunk),
 * ServerEntityEvents.Load.onLoad(Entity, ServerLevel), ServerBlockEntityEvents.Load.onLoad(BlockEntity, ServerLevel)).
 * CHUNK_LOAD is fired from LevelChunk.setLoaded inside the chunk map's own promotion of that chunk
 * (Fabric's ChunkMap mixin), before the chunk counts as loaded: asking the LEVEL for it there waits
 * for a load that is itself waiting for the callback to return. A real mod froze at 51% of world creation on
 * `world.getTopY(...)` (Yarn's name of `level.getHeight(...)`) in exactly that place. The entity and block-entity callbacks are also fired while a
 * chunk is being loaded (and at other, harmless times the source cannot tell apart), so they are held to
 * the same rule. `world` and `given` are the positions of the world and of the thing handed to the callback.
 */
export const LOAD_CALLBACKS = [
  { owner: "ServerChunkEvents", event: "CHUNK_LOAD", method: "onChunkLoad", world: 0, given: 1, kind: "chunk" },
  { owner: "ServerChunkEvents", event: "CHUNK_GENERATE", method: "onChunkGenerate", world: 0, given: 1, kind: "chunk" },
  { owner: "ServerEntityEvents", event: "ENTITY_LOAD", method: "onLoad", world: 1, given: 0, kind: "entity" },
  { owner: "ServerBlockEntityEvents", event: "BLOCK_ENTITY_LOAD", method: "onLoad", world: 1, given: 0, kind: "block_entity" },
] as const

/**
 * What of a world may not be called from such a callback, by 1.21.1 official names (each confirmed on Level,
 * ServerLevel or the interfaces they implement: LevelReader, BlockGetter, LevelWriter, LevelAccessor…): everything that looks a block, a height, a chunk, a biome or
 * light up through the level's chunk source, and everything that changes the world. Entity lists, sounds
 * and particles do not go through a chunk and are left alone.
 */
export const WORLD_THROUGH_CHUNKS = {
  reads: ["getHeight", "getHeightmapPos", "getBlockState", "getFluidState", "getBlockEntity", "getChunk", "getChunkAt", "getBiome", "isEmptyBlock", "isWaterAt", "loadedAndEntityCanStandOn", "getMaxLocalRawBrightness", "getBrightness", "getRawBrightness", "getLightEmission", "isStateAtPosition", "clip"],
  writes: ["setBlock", "setBlockAndUpdate", "destroyBlock", "removeBlock", "setBlockEntity", "addFreshEntity", "tryAddFreshEntityWithPassengers", "addFreshEntityWithPassengers", "explode", "scheduleTick", "blockUpdated", "updateNeighborsAt"],
} as const

const LATER = "要改世界（放方块、放生物），先把位置记进一个队列，等这一刻结束、在 ServerTickEvents.END_WORLD_TICK 里再做。server.execute(...) 不算推迟：在服务端主线程上它会当场执行。"
/** The refusal for one call, in the words whoever wrote the code can act on. Exported so the words given to writers and reviewers quote the same reason. */
export const LOAD_REENTRY = {
  chunk: {
    why: "这个回调是在这一格区块还没载入完的时候被叫到的。这时向世界要方块、高度、区块，或者往世界里放东西，游戏会回头等这格区块载入完，而它正等着你的回调结束：玩家进世界时会卡在载入画面不动（真实发生过）",
    fix: `要读这格区块里的东西，直接读回调交给你的那个区块，不经过世界：chunk.getHeight(类型, x, z) 给的是最高那块方块的 y（比 level.getHeight(类型, x, z) 小 1），chunk.getBlockState(pos) 读方块。${LATER}`,
  },
  entity: {
    why: "这个回调在实体或方块实体刚进世界的那一刻被叫到，区块载入到一半时也会叫到。这时通过世界读方块或者改世界，可能要等一格还没载入完的区块，游戏会卡住",
    fix: `这个回调里只记下是谁、在哪儿，不碰世界。${LATER}`,
  },
} as const

/**
 * Fabric's right-click callbacks, by their names and parameter order in Fabric API 0.116.6 for 1.21.1, in the game's official names (read off the jar with javap:
 * UseBlockCallback.interact(Player, Level, InteractionHand, BlockHitResult), UseItemCallback.interact(Player, Level, InteractionHand),
 * UseEntityCallback.interact(Player, Level, InteractionHand, Entity, EntityHitResult)). The game asks every one of them once per hand: a
 * single right-click calls the callback with InteractionHand.MAIN_HAND and, unless the first call ended the interaction with a result other than PASS, again with
 * InteractionHand.OFF_HAND. A callback that does something and never looks at which hand it was called for therefore does it twice per click (round 18:
 * a message said twice, an item given twice). The attack callbacks are not in this list: an attack is asked once, for the main hand only.
 * `hand` is the position of the hand among the parameters.
 */
export const INTERACTION_CALLBACKS = [
  { owner: "UseBlockCallback", method: "interact", hand: 2 },
  { owner: "UseItemCallback", method: "interact", hand: 2 },
  { owner: "UseEntityCallback", method: "interact", hand: 2 },
] as const

/** Studio's own right-click members of `ProjectPlatform` (D 组), the hand third as in Fabric's. A method reference is matched by `method` like Fabric's `interact`. */
export const STUDIO_INTERACTIONS = [
  { owner: GAMEPLAY_API.platform, method: "onUseBlock", hand: 2 },
  { owner: GAMEPLAY_API.platform, method: "onUseItem", hand: 2 },
  { owner: GAMEPLAY_API.platform, method: "onUseEntity", hand: 2 },
] as const

/** The refusal for a right-click callback that never looks at its hand, in the words whoever wrote the code can act on. */
export const HAND_WORDS = {
  why: "游戏对每一次右键，会把这个回调叫两遍：一遍是主手，一遍是副手（第一遍如果已经返回了不是 PASS 的结果，第二遍才不会叫）。回调里没有看过是哪只手，同一件事就会做两次",
  fix: "回调里先看 hand 参数，只在你要的那只手上做事：多数情况是开头写 if (hand != InteractionHand.MAIN_HAND) return InteractionResult.PASS;（UseItemCallback 要返回 InteractionResultHolder.pass(player.getItemInHand(hand))）。如果是要看某只手里拿的东西，就用 player.getItemInHand(hand) 取，别用 getMainHandItem()。确实要两只手都响应，就在做完事以后返回 InteractionResult.SUCCESS（或 CONSUME），让游戏不再叫第二遍，并在说明里写明。",
} as const

export type ScannedSource = {
  /** The source with comments blanked and the inside of every string and character literal blanked: same length, same lines. */
  code: string
  /** Every string literal, as written between its quotes, with where it starts. */
  strings: { value: string; offset: number }[]
}

/** Blank out what is not code. A scan of the result cannot be fooled by words in a comment or a string, nor hidden from by a comment between two parts of a name. */
export function stripJava(source: string): ScannedSource {
  const strings: ScannedSource["strings"] = []
  const blank = (text: string) => text.replace(/[^\n]/g, " ")
  // Left to right, whichever starts first wins: a quote inside a comment is comment, a slash inside a string is string.
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"""[\s\S]*?(?:"""|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/g, (found: string, offset: number) => {
    if (found.startsWith("/")) return blank(found)
    const quote = found.startsWith('"""') ? '"""' : found[0]!
    const closed = found.length >= quote.length * 2 && found.endsWith(quote)
    const inside = found.slice(quote.length, closed ? found.length - quote.length : found.length)
    if (quote !== "'") strings.push({ value: inside, offset })
    // One quote mark at each end stays, so what is left still reads as an (empty) literal.
    return `${quote[0]}${blank(found.slice(1, closed ? -1 : found.length))}${closed ? quote[0] : ""}`
  })
  return { code, strings }
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length
// A dotted name may be written with spaces and line breaks around its dots; once comments are gone that is the only disguise left.
const dotted = (name: string) => name.replace(/\s+/g, "")
const starts = (name: string, prefixes: readonly string[]) => prefixes.find((prefix) => (prefix.endsWith(".") ? name.startsWith(prefix) : name === prefix || name.startsWith(`${prefix}.`)))

/**
 * A wildcard import of a package of the game (`import net.minecraft.world.entity.*;`). Allowed as code, refused all the same: which class a
 * simple name means then depends on what the game has in that package, and a name the game moves to another package, or names differently
 * in another naming scheme, can no longer be told apart or renamed by machine (`gameplay-naming.ts` spells such imports out once for code
 * written before this rule). Each class is imported by its own line.
 */
const GAME_WILDCARD = (name: string): Pick<GameplayFinding, "rule" | "message" | "fix"> => ({
  rule: "wildcard_import",
  message: `用了通配导入 ${name}，一次把游戏的整个包都导了进来。`,
  fix: "游戏的类要一个一个写出来导入，每个类一行，例如 import net.minecraft.world.entity.Mob;；不要用 .* 一次导入整个包。",
})

/** Why mixins are closed, with what is open instead on the target. */
const MIXIN_FIX = (target: TargetId) =>
  onFacade(target)
    ? `这一版不开放 mixin：玩法只用 Studio 生成的 ${PLATFORM} / ${CLIENT} 提供的事件和注册接口。那里没有的事，这个玩法现在做不了，请在 not_doing 里如实写明。`
    : "这一版不开放 mixin：玩法只用 Fabric API 提供的事件和注册接口。Fabric 没有事件的地方，这个玩法现在做不了，请在 not_doing 里如实写明。"

/** Why a name written in full (an import or an inline use) is not allowed, or null. `name` ends in `.*` for a wildcard import. */
function refusedName(name: string, own: { mod: string; root: string; self: string; declared: readonly string[]; target: TargetId }): Pick<GameplayFinding, "rule" | "message" | "fix"> | null {
  const bare = name.replace(/\.\*$/, ".")
  const facade = onFacade(own.target)
  // Forge and NeoForge (D 组): no loader's own class at all, Fabric's included; Studio's API stands in for them.
  if (facade && /^net\.(?:fabricmc|minecraftforge|neoforged)\./.test(bare)) return loaderApiRefusal(name, own.target)
  if (bare.startsWith(`${own.self}.`) || bare === own.self || `${bare}` === `${own.self}.`) return null
  if (bare.startsWith(`${own.root}.${GAMEPLAY_API.package}.`)) return null
  if (bare.startsWith(`${own.root}.`)) {
    const other = bare.slice(own.root.length + 1).split(".")[0]!
    if (own.declared.includes(other)) return null
    return { rule: "other_gameplay", message: `用到了另一个玩法「${other}」的代码（${name}），但没有声明依赖它。`, fix: "每个玩法只动自己的包。确实要用另一个玩法，就把那个玩法的资产 id 写进 uses，这样删掉它之前 Studio 会提醒；否则把需要的逻辑写在自己这里。" }
  }
  if (bare.startsWith(`${own.mod}.`) || bare === own.mod)
    return { rule: "studio_internals", message: `直接用了 Studio 生成的内部类（${name}）。这些类的名字和结构会随模板变。`, fix: `读工程里的物品、方块、生物，只通过 ${GAMEPLAY_API.content}：${GAMEPLAY_API.content}.item("标识符")、.block("标识符")、.entity("资产 id")。` }
  const banned = BANNED_PACKAGES.find((ban) => starts(bare, ban.names) && !(ban.rule === "threads" && starts(bare, CONCURRENT_OK)))
  if (banned) return { rule: banned.rule, message: `用到了 ${name}：${banned.what}。`, fix: banned.fix }
  // A class refused by its bare name is refused by its full name too: `java.lang.Runtime` is still Runtime. The bare names are the
  // JDK's (and the few the game's own that are listed in full above); a game or library class that only shares the simple name, such
  // as the block-state `net.minecraft.state.property.Properties`, is a different class and is judged by its package like any other.
  const borrowed = starts(bare, GAMEPLAY_ALLOWED) && !/^javax?\./.test(bare)
  const word = borrowed ? undefined : BANNED_WORDS.find((ban) => ban.names.includes(bare.split(".").find((part) => /^[A-Z]/.test(part)) ?? ""))
  if (word) return { rule: word.rule, message: `用到了 ${name}：${word.what}。`, fix: word.fix }
  // A wildcard may not open a package of which only single classes are allowed.
  if (name.endsWith(".*") && !gameplayAllowed(own.target).some((allowed) => allowed.endsWith(".") && bare.startsWith(allowed)))
    return { rule: "import", message: `用了通配导入 ${name}，这个包里只有个别类可以用。`, fix: "把要用的类一个一个写出来导入。" }
  if (starts(bare, gameplayAllowed(own.target))) return null
  const why =
    /^java\.(?:io|nio)\./.test(bare) ? { rule: "files", what: "读写电脑上的文件", fix: NO_FILES }
    : /^(?:java\.net|javax\.net|java\.rmi|javax\.naming|io\.netty|com\.mojang\.authlib|org\.apache\.http)\./.test(bare) ? { rule: "network", what: "网络连接", fix: NO_NETWORK }
    : /^(?:sun|jdk|com\.sun)\./.test(bare) ? { rule: "class_loading", what: "Java 虚拟机的内部接口", fix: NO_REFLECTION }
    : /^javax\.script\./.test(bare) ? { rule: "scripting", what: "脚本引擎", fix: "玩法的逻辑直接写成 Java。" }
    : /^(?:org\.spongepowered|org\.objectweb\.asm|net\.fabricmc\.fabric\.mixin|net\.fabricmc\.fabric\.impl|net\.fabricmc\.loader)\./.test(bare) ? { rule: "mixin", what: "mixin、字节码改写或加载器内部", fix: MIXIN_FIX(own.target) }
    : /^org\.lwjgl\./.test(bare) ? { rule: "native", what: "直接调用本机库", fix: "键位常量用 org.lwjgl.glfw.GLFW 里的 GLFW_KEY_*；画东西用 Minecraft 自己的渲染接口。" }
    : /^(?:java\.awt|javax\.swing|java\.applet)\./.test(bare) ? { rule: "host", what: "桌面窗口、剪贴板或用系统程序打开东西", fix: "界面用 Minecraft 的 Screen 和 HUD；颜色直接写成 ARGB 整数。" }
    : null
  return why
    ? { rule: why.rule, message: `用到了 ${name}：${why.what}。`, fix: why.fix }
    : { rule: "import", message: `用到了 ${name}，它不在玩法可以用的范围里。`, fix: facade ? `玩法可以用 Minecraft（net.minecraft）、Studio 生成的 ${PLATFORM} 和 ${CLIENT}、Brigadier、Codec、JOML、fastutil、Guava 的集合、Gson、GeckoLib，以及 java.lang / java.util / java.math / java.time 里不碰电脑的部分。` : "玩法可以用 Minecraft（net.minecraft）、Fabric API（net.fabricmc.fabric.api）、Brigadier、Codec、JOML、fastutil、Guava 的集合、Gson、GeckoLib，以及 java.lang / java.util / java.math / java.time 里不碰电脑的部分。" }
}

/**
 * Scan one gameplay's Java for anything that reaches outside the game or outside its own package.
 * `declared` are the slugs of the other gameplay it lists under `uses`.
 */
export function scanGameplay(input: { mod_id: string; slug: string; sources: readonly { path: string; content: string }[]; declared?: readonly string[]; /** The target whose rules apply (D 组); left out, Fabric 1.21.1's, as before. */ target?: TargetId }): GameplayFinding[] {
  const target = input.target ?? DEFAULT_TARGET
  return [...scanBounds(input), ...scanLoadCallbacks(input.sources), ...scanInteractionHands(input.sources), ...scanEmptyWeapon(input.sources), ...scanStartup(input.sources, target), ...(onFacade(target) ? scanRegistration(input.sources) : [])]
}

function scanBounds(input: { mod_id: string; slug: string; sources: readonly { path: string; content: string }[]; declared?: readonly string[]; target?: TargetId }): GameplayFinding[] {
  const own = { mod: modPackage(input.mod_id), root: gameplayRoot(input.mod_id), self: gameplayPackage(input.mod_id, input.slug), declared: input.declared ?? [], target: input.target ?? DEFAULT_TARGET }
  return input.sources.flatMap((file) => {
    const found: GameplayFinding[] = []
    const add = (offset: number, finding: Pick<GameplayFinding, "rule" | "message" | "fix">) => found.push({ ...finding, file: file.path, line: lineAt(file.content, offset) })
    // Java reads \uXXXX as the character itself before anything else, so a name can be spelled with it and slip past every check below.
    const escape = /\\u+[0-9a-fA-F]{4}/.exec(file.content)
    if (escape) add(escape.index, { rule: "unicode_escape", message: `用了 Unicode 转义（${escape[0]}）。`, fix: "直接写这个字符本身；要显示给玩家的文字放进 lang 里。" })
    const scanned = stripJava(file.content)
    const code = scanned.code
    const client = file.path.startsWith("client/")

    const expected = sourcePackage(input.mod_id, input.slug, file.path)
    const packages = [...code.matchAll(/\bpackage\s+([\w\s.]+?)\s*;/g)]
    if (packages.length !== 1 || dotted(packages[0]![1]!) !== expected)
      add(packages[0]?.index ?? 0, { rule: "package", message: packages.length ? `包声明是 ${dotted(packages[0]![1]!)}，不是这个文件该在的包。` : "没有包声明。", fix: `这个文件的第一句必须是 package ${expected};` })

    const imports = [...code.matchAll(/\bimport\s+(static\s+)?([\w\s.]+?(?:\.\s*\*)?)\s*;/g)].map((match) => ({ offset: match.index, fixed: Boolean(match[1]), name: dotted(match[2]!) }))
    imports.forEach((entry) => {
      const refused = refusedName(entry.name, own)
      if (refused) return add(entry.offset, refused)
      if (!entry.fixed && entry.name.startsWith("net.minecraft.") && entry.name.endsWith(".*")) return add(entry.offset, GAME_WILDCARD(entry.name))
      if (entry.fixed && /^javax?\./.test(entry.name) && !STATIC_OK.some((allowed) => entry.name.startsWith(allowed)))
        add(entry.offset, { rule: "import", message: `静态导入了 ${entry.name}。`, fix: "java 自带的类里只有 Math 和 Objects 可以静态导入；别的写成 类名.方法名(...)，这样看得出调的是谁的方法。" })
    })
    // Names written out in full where they are used. The import lines were judged above and are skipped here.
    const lines = new Set(imports.map((entry) => lineAt(code, entry.offset)))
    ;[...code.matchAll(new RegExp(`(?<![\\w.])(?:${ROOTS})(?:\\s*\\.\\s*[a-z_][a-z0-9_]*)*\\s*\\.\\s*[A-Z]\\w*`, "g"))].forEach((match) => {
      if (lines.has(lineAt(code, match.index)) || /^\s*package\b/.test(code.slice(code.lastIndexOf("\n", match.index) + 1, match.index))) return
      const refused = refusedName(dotted(match[0]), own)
      if (refused) add(match.index, refused)
    })
    // Its own mod's packages named in full without a class at the end of the match above (a wildcard, a nested package).
    ;[...code.matchAll(new RegExp(`(?<![\\w.])${own.mod.replaceAll(".", "\\s*\\.\\s*")}((?:\\s*\\.\\s*\\w+)*)`, "g"))].forEach((match) => {
      if (lines.has(lineAt(code, match.index)) || /^\s*package\b/.test(code.slice(code.lastIndexOf("\n", match.index) + 1, match.index))) return
      const refused = refusedName(dotted(match[0]), own)
      if (refused && !found.some((finding) => finding.line === lineAt(code, match.index) && finding.rule === refused.rule)) add(match.index, refused)
    })

    if (!client)
      imports
        .filter((entry) => starts(entry.name.replace(/\.\*$/, "."), CLIENT_ONLY) || entry.name.startsWith(`${own.self}.client.`) || entry.name === `${own.root}.${GAMEPLAY_API.package}.${CLIENT}`)
        .forEach((entry) => add(entry.offset, { rule: "client_only", message: `在两端共用的文件里导入了只有客户端才有的类（${entry.name}）。装在专用服务器上会直接崩溃。`, fix: `画面、按键、HUD、粒子这些只属于客户端的代码放进 client/ 文件夹，从 ${GAMEPLAY_API.client_main} 进入。` }))

    // A simple name this file imports from an allowed class of the game or a library means that class, not the JDK's: Java's
    // single-type import wins over java.lang and over wildcards. (The import itself was judged above.)
    const imported = new Set(imports.filter((entry) => !entry.fixed && !entry.name.endsWith(".*") && !refusedName(entry.name, own)).map((entry) => entry.name.split(".").at(-1)!))
    BANNED_WORDS.forEach((ban) =>
      ban.names.forEach((name) => {
        if (imported.has(name)) return
        // As a type, a call target or a constructor; not as part of a longer name or a member of something else.
        const match = new RegExp(`(?<![\\w.])${name}(?!\\w)`).exec(code)
        if (match) add(match.index, { rule: ban.rule, message: `用到了 ${name}：${ban.what}。`, fix: ban.fix })
      }),
    )
    BANNED_MEMBERS.forEach((ban) =>
      ban.names.forEach((name) => {
        const match = new RegExp(`\\.\\s*${name}\\b|::\\s*${name}\\b`).exec(code)
        if (match) add(match.index, { rule: ban.rule, message: `调用了 ${name}：${ban.what}。`, fix: ban.fix })
      }),
    )
    LIFE_ERASERS.forEach((eraser) => {
      const match = eraser.pattern.exec(code)
      if (match) add(match.index, { rule: "erases_life", message: `调用了 ${match[1] === "goalSelector" || match[1] === "targetSelector" ? `${match[1]}.${match[2]}` : match[1]}：${eraser.what}。`, fix: eraser.fix })
    })
    ;[...code.matchAll(/(?<![\w.])System\s*\.\s*(\w+)/g)]
      .filter((match) => !SYSTEM_OK.includes(match[1]!))
      .forEach((match) => add(match.index, { rule: match[1] === "exit" ? "exit" : /^load/.test(match[1]!) ? "native" : "host", message: `调用了 System.${match[1]}。`, fix: match[1] === "exit" ? "玩法不能关掉游戏。出了错就记一条日志然后返回。" : "System 里只能用计时（currentTimeMillis、nanoTime）、arraycopy 和 out / err。" }))
    const native = /(?<![\w.])native\s+[\w<>\[\], ]+\s+\w+\s*\(/.exec(code)
    if (native) add(native.index, { rule: "native", message: "声明了 native 方法（本机代码）。", fix: "玩法只能是 Java 代码。" })
    const glfw = /(?<![\w])glfw[A-Z]\w*\s*\(/.exec(code)
    if (glfw) add(glfw.index, { rule: "native", message: `直接调用了 GLFW 的函数（${glfw[0].replace(/\s*\($/, "")}）。`, fix: onFacade(own.target) ? `GLFW 只用来取键位常量（GLFW_KEY_*）；按键用 ${CLIENT}.keyMapping 注册。` : "GLFW 只用来取键位常量（GLFW_KEY_*）；按键用 Fabric 的 KeyBindingHelper 注册。" })
    const mixin = /@\s*(?:Mixin|Inject|Redirect|Overwrite|Accessor|Invoker|ModifyVariable|ModifyArg|ModifyConstant|Shadow)\b/.exec(code)
    if (mixin) add(mixin.index, { rule: "mixin", message: `用了 mixin 注解（${dotted(mixin[0])}）。`, fix: MIXIN_FIX(own.target) })
    // One line may trip a rule twice (a type and its constructor): said once.
    return found.filter((finding, index) => found.findIndex((other) => other.rule === finding.rule && other.line === finding.line && other.message === finding.message) === index)
  })
}

/** Where the bracket opened at `open` closes, in text that has no strings or comments left. */
export function closing(code: string, open: number) {
  const level = { depth: 0 }
  const close = [...code.slice(open).matchAll(code[open] === "(" ? /[()]/g : /[{}]/g)].find((mark) => (level.depth += mark[0] === code[open] ? 1 : -1) === 0)
  return close ? open + close.index : code.length
}
/** Where each argument of the call whose bracket opens at `open` stands (`start` to `end`), cut at the commas that are its own: a call or a bracket inside an argument does not split it. */
export function callArgumentSpans(code: string, open: number) {
  const base = open + 1
  const inside = code.slice(base, closing(code, open))
  const level = { depth: 0 }
  const cuts = [...inside.matchAll(/[()[\]{},]/g)].flatMap((mark) => {
    if (mark[0] !== ",") level.depth += "([{".includes(mark[0]) ? 1 : -1
    return mark[0] === "," && level.depth === 0 ? [mark.index] : []
  })
  return [-1, ...cuts].map((cut, index) => ({ start: base + cut + 1, end: base + (cuts[index] ?? inside.length) }))
}
/** What an argument is when it is one string literal on its own (not `"a" + b`, not a call): the text between the quotes. Otherwise undefined. */
export function argumentLiteral(scanned: ScannedSource, span: { start: number; end: number }) {
  const written = scanned.code.slice(span.start, span.end)
  return /^"\s*"$/.test(written.trim()) ? scanned.strings.find((value) => value.offset === span.start + written.length - written.trimStart().length)?.value : undefined
}
/**
 * What an argument spells out: one string literal on its own, or a constant of the same file that stands for one (`static final String NAME = "…"`), as the name written alone.
 * Otherwise undefined: a sum of strings, a variable, a call.
 */
export function argumentText(scanned: ScannedSource, span: { start: number; end: number }) {
  const literal = argumentLiteral(scanned, span)
  if (literal !== undefined) return literal
  const constant = /^(?:[\w.]*\.)?([A-Z][A-Z0-9_]*)$/.exec(scanned.code.slice(span.start, span.end).trim())?.[1]
  const declared = constant ? new RegExp(`\\bString\\s+${constant}\\s*=\\s*"`).exec(scanned.code) : null
  return declared ? scanned.strings.find((value) => value.offset === declared.index + declared[0].length - 1)?.value : undefined
}
/** The arguments of the call whose bracket opens at `open`, cut at the commas that are its own. */
function callArguments(code: string, open: number) {
  return callArgumentSpans(code, open).map((span) => code.slice(span.start, span.end))
}
const NOT_METHODS = new Set(["if", "for", "while", "switch", "catch", "synchronized", "try", "return", "new", "else", "throw", "do"])
/** The last word of each parameter: its name, with or without a type before it. */
const parameterNames = (list: string) => (list.trim() ? list.split(",").map((part) => /(\w+)\s*$/.exec(part)?.[1] ?? "") : [])

type Declared = { file: string; name: string; parameters: string[]; start: number; end: number }
/** Every method a file declares with a body: its name, its parameter names, and where the body stands. Best effort on source text. */
function declaredMethods(file: string, code: string): Declared[] {
  return [...code.matchAll(/([\w.<>\[\]?]+)\s+(\w+)\s*\(([^()]*)\)\s*(?:throws\s+[\w.,\s]+?)?\{/g)].flatMap((match) =>
    NOT_METHODS.has(match[1]!) || NOT_METHODS.has(match[2]!) ? [] : [{ file, name: match[2]!, parameters: parameterNames(match[3]!), start: match.index + match[0].length - 1, end: closing(code, match.index + match[0].length - 1) }],
  )
}

/**
 * Reads and changes made through the world from inside a callback that runs while a chunk, an entity or a
 * block entity is still being loaded (`LOAD_CALLBACKS`). The callback is followed into the gameplay's own
 * methods as far as the world is handed on as an argument. A lambda put into a collection is not run there
 * and is skipped; one given to `execute` is run on the spot by the server thread (BlockableEventLoop.execute
 * runs it at once when called on its own thread) and is read like the rest.
 */
export function scanLoadCallbacks(sources: readonly { path: string; content: string }[]): GameplayFinding[] {
  const files = sources.map((file) => ({ path: file.path, content: file.content, code: stripJava(file.content).code }))
  const methods = files.flatMap((file) => declaredMethods(file.path, file.code))
  const classes = new Set(files.map((file) => file.path.split("/").at(-1)!.replace(/\.java$/, "")))
  const hazards = [...WORLD_THROUGH_CHUNKS.reads, ...WORLD_THROUGH_CHUNKS.writes].join("|")
  const found: (GameplayFinding & { offset: number })[] = []
  const seen = new Set<string>()

  const walk = (callback: (typeof LOAD_CALLBACKS)[number], file: (typeof files)[number], start: number, end: number, world: string | undefined, depth: number) => {
    const key = `${callback.event}:${file.path}:${start}:${world}`
    if (seen.has(key) || depth > 4) return
    seen.add(key)
    // A lambda handed to a collection waits there: what it does is not done inside the callback.
    const body = [...file.code.slice(start, end).matchAll(/\.\s*(?:add|addLast|addFirst|offer|offerLast|push|put|enqueue)\s*\(/g)].reduce((text, call) => {
      const open = call.index + call[0].length - 1
      const close = closing(text, open)
      return text.slice(open, close).includes("->") ? `${text.slice(0, open + 1)}${text.slice(open + 1, close).replace(/[^\n]/g, " ")}${text.slice(close)}` : text
    }, file.code.slice(start, end))
    // The world by the name the callback gives it, and any local it is read into from the thing it was handed.
    const worlds = [...(world ? [world] : []), ...[...body.matchAll(/\b(\w+)\s*=\s*(?:\(\s*\w+\s*\)\s*)?\w+\s*\.\s*(?:level|getLevel)\s*\(\s*\)\s*;/g)].map((match) => match[1]!)]
    const through = [
      ...(worlds.length ? [...body.matchAll(new RegExp(`(?<![\\w.])(?:${worlds.join("|")})\\s*\\.\\s*(${hazards})\\s*\\(`, "g"))] : []),
      ...body.matchAll(new RegExp(`\\.\\s*(?:level|getLevel)\\s*\\(\\s*\\)\\s*\\.\\s*(${hazards})\\s*\\(`, "g")),
      // EntityType.spawn(world, …) puts the entity into the world it is given.
      ...(worlds.length ? [...body.matchAll(new RegExp(`\\.\\s*(spawn)\\s*\\(\\s*(?:${worlds.join("|")})\\s*[,)]`, "g"))] : []),
    ]
    through.forEach((match) => {
      const offset = start + match.index
      const words = LOAD_REENTRY[callback.kind === "chunk" ? "chunk" : "entity"]
      const called = match[1] === "spawn" ? "spawn(世界, …)" : match[1]!
      if (found.some((other) => other.file === file.path && other.offset === offset)) return
      found.push({ rule: "load_reentry", file: file.path, line: lineAt(file.content, offset), offset, message: `在 ${callback.owner}.${callback.event} 的回调里${depth ? "（回调调用到的方法里）" : ""}通过世界调用了 ${called}。${words.why}。`, fix: words.fix })
    })
    if (!world) return
    // Its own methods the world is handed to: followed with the name the world has there.
    methods.forEach((method) => {
      ;[...body.matchAll(new RegExp(`(?<![\\w.])(?:(?:this|${[...classes].join("|")})\\s*\\.\\s*)?${method.name}\\s*\\(`, "g"))].forEach((call) => {
        const index = callArguments(body, call.index + call[0].length - 1).findIndex((argument) => new RegExp(`^\\s*(?:\\(\\s*\\w+\\s*\\)\\s*)?${world}\\s*$`).test(argument))
        const target = files.find((value) => value.path === method.file)!
        if (index >= 0 && method.parameters[index] && !(method.file === file.path && method.start === start)) walk(callback, target, method.start, method.end, method.parameters[index], depth + 1)
      })
    })
  }

  files.forEach((file) => {
    ;[...file.code.matchAll(/(?<![\w.])(?:(\w+)\s*\.\s*)?(CHUNK_LOAD|CHUNK_GENERATE|ENTITY_LOAD|BLOCK_ENTITY_LOAD)\s*\.\s*register\s*\(/g)].forEach((match) => {
      // The client's events of the same names announce chunks and entities the server already sent whole.
      const callback = LOAD_CALLBACKS.find((value) => value.event === match[2] && (!match[1] || match[1] === value.owner))
      if (!callback) return
      const open = match.index + match[0].length - 1
      const close = closing(file.code, open)
      const written = file.code.slice(open + 1, close)
      const lambda = /^\s*(?:\(([^()]*)\)|(\w+))\s*->/.exec(written)
      const reference = /^\s*(?:[\w.]+)\s*::\s*(\w+)\s*$/.exec(written)
      if (lambda) return walk(callback, file, open + 1 + lambda[0].length, close, parameterNames(lambda[1] ?? lambda[2]!)[callback.world], 0)
      // A method reference, or a listener written out as a class: the method that will be called, wherever this gameplay declares it.
      const name = reference?.[1] ?? callback.method
      methods
        .filter((method) => method.name === name && method.parameters.length === 2 && (reference || (method.file === file.path && method.start > open && method.end < close)))
        .forEach((method) => walk(callback, files.find((value) => value.path === method.file)!, method.start, method.end, method.parameters[callback.world], 0))
    })
  })
  return found.sort((a, b) => (a.file === b.file ? a.offset - b.offset : 0)).map((finding) => ({ rule: finding.rule, file: finding.file, line: finding.line, message: finding.message, fix: finding.fix }))
}

/**
 * Right-click callbacks (`INTERACTION_CALLBACKS`) that never look at the hand they were called for. The callback is read where this gameplay writes
 * it: a lambda, a method reference to a method this gameplay declares, or a listener written out as an anonymous class. It counts as looking at the hand
 * when the hand parameter appears anywhere in its body, even only handed on to another method: what that method does with it is not followed, so
 * what is refused is certain. A callback whose body does nothing but answer PASS is left alone: it cannot do anything twice.
 */
export function scanInteractionHands(sources: readonly { path: string; content: string }[]): GameplayFinding[] {
  const files = sources.map((file) => ({ path: file.path, content: file.content, code: stripJava(file.content).code }))
  const methods = files.flatMap((file) => declaredMethods(file.path, file.code))
  const owners = INTERACTION_CALLBACKS.map((callback) => callback.owner).join("|")
  // Studio's own right-click members (D 组) are asked once per hand on every loader too, with the hand in the same place.
  const studio = STUDIO_INTERACTIONS.map((callback) => callback.method).join("|")
  return files.flatMap((file) =>
    [
      ...file.code.matchAll(new RegExp(`(?<![\\w.])(?:[a-z]\\w*\\s*\\.\\s*)*(${owners})\\s*\\.\\s*EVENT\\s*\\.\\s*register\\s*\\(`, "g")),
      ...file.code.matchAll(new RegExp(`(?<![\\w.])(?:[a-z]\\w*\\s*\\.\\s*)*${PLATFORM}\\s*\\.\\s*(${studio})\\s*\\(`, "g")),
    ].flatMap((match): GameplayFinding[] => {
      const callback = [...INTERACTION_CALLBACKS, ...STUDIO_INTERACTIONS].find((value) => value.owner === match[1] || value.method === match[1])!
      const open = match.index + match[0].length - 1
      const close = closing(file.code, open)
      const written = file.code.slice(open + 1, close)
      const lambda = /^\s*(?:\(([^()]*)\)|(\w+))\s*->/.exec(written)
      const reference = /^\s*[\w.]+\s*::\s*(\w+)\s*$/.exec(written)
      // Each way of writing it gives the name the hand has there and the text of the body that may look at it.
      const listeners: { hand: string | undefined; body: string }[] = lambda
        ? [{ hand: parameterNames(lambda[1] ?? lambda[2]!)[callback.hand], body: written.slice(lambda[0].length) }]
        : methods
            .filter((method) => method.parameters.length > callback.hand && (reference ? method.name === reference[1] : method.file === file.path && method.name === callback.method && method.start > open && method.end < close))
            .map((method) => ({ hand: method.parameters[callback.hand], body: files.find((value) => value.path === method.file)!.code.slice(method.start, method.end + 1) }))
      return listeners.flatMap((listener) => {
        if (!listener.hand) return []
        // A body that only answers PASS (with the stack the typed result carries, one call deep) does nothing, so doing it twice changes nothing.
        if (!listener.body.replace(/\breturn\b|\bInteractionResult(?:Holder)?\s*\.\s*(?:PASS\b|pass\s*\((?:[^()]|\([^()]*\))*\))|[\s;{}()]/g, "").length) return []
        if (new RegExp(`(?<![\\w.])${listener.hand}(?!\\w)`).test(listener.body)) return []
        return [{ rule: "hand", file: file.path, line: lineAt(file.content, match.index), message: `${callback.owner === PLATFORM ? `${PLATFORM}.${callback.method}` : `${callback.owner}.EVENT`} 的回调从来没有看过 ${listener.hand} 参数（它是哪只手）。${HAND_WORDS.why}。`, fix: HAND_WORDS.fix }]
      })
    }),
  )
}

/**
 * A persistent projectile built with an empty stack as the weapon it was shot from. Read off the 1.21.1 jar with javap, in its official names
 * (Loom's officialMojangMappings): the constructor `AbstractArrow(EntityType, double, double, double, Level, ItemStack pickup, ItemStack firedFromWeapon)` and
 * the one taking a LivingEntity both end in "if firedFromWeapon != null and the level is a ServerLevel: if firedFromWeapon.isEmpty() throw new
 * IllegalArgumentException("Invalid weapon firing an arrow")". `Arrow` (Level, LivingEntity, pickup, firedFromWeapon / Level, x, y, z, pickup, firedFromWeapon)
 * and `SpectralArrow` pass the weapon straight on, and so does `ArrowItem.createArrow(Level, ammo, shooter, weapon)`. `ThrownTrident`'s
 * constructors take no weapon (they pass null themselves). So the weapon must be null or a real stack; `ItemStack.EMPTY` compiles, passes review,
 * and takes the whole server world down the first time the arrow is made (round 19: a pressure plate that fired a crossbow turret crashed the
 * world on the first step). The scan sees the empty stack where it is written as the last argument, or in a local or field that is only ever
 * given an empty stack; one reached through a method or a conditional is not seen (`GAMEPLAY_SCAN_LIMITS`).
 */
export const EMPTY_WEAPON_WORDS = {
  why: "游戏在服务器上创建一支箭时，要求“发射它的武器”要么不给（null），要么是一件真的物品；给一个空物品栈（ItemStack.EMPTY）游戏会当场抛出 IllegalArgumentException（Invalid weapon firing an arrow），整个世界跟着崩溃。编译和读代码都看不出来，真实发生过",
  fix: "不是哪件武器射出去的箭（机关、炮塔、踏板）：这个参数直接写 null。要让箭带上某件武器的附魔，就传一件真的物品，例如 new ItemStack(Items.CROSSBOW)。箭本身的那个物品参数照常传 new ItemStack(Items.ARROW)。",
} as const

/** The expressions that are an empty stack, written without spaces. `copy()` and `copyWithCount(n)` of an empty stack are empty too. */
const EMPTY_STACK = /^(?:\(ItemStack\))?(?:(?:net\.minecraft\.world\.item\.)?ItemStack\.EMPTY(?:\.copy(?:WithCount\(\d+\))?\(\))?|newItemStack\((?:net\.minecraft\.world\.item\.)?Items\.AIR(?:,\d+)?\)|(?:net\.minecraft\.world\.item\.)?Items\.AIR\.getDefaultInstance\(\))$/

export function scanEmptyWeapon(sources: readonly { path: string; content: string }[]): GameplayFinding[] {
  return sources.flatMap((file) => {
    const code = stripJava(file.content).code
    const isEmpty = (written: string) => EMPTY_STACK.test(dotted(written))
    // A local or field that every declaration and assignment in the file gives an empty stack: the same as writing it out.
    const alwaysEmpty = (name: string) => {
      const declared = [...code.matchAll(new RegExp(`\\bItemStack\\s+${name}\\b\\s*([=,);:])`, "g"))]
      const assigned = [...code.matchAll(new RegExp(`(?<![\\w.])(?:this\\s*\\.\\s*)?${name}\\s*=(?!=)\\s*([^;]*);`, "g"))]
      return assigned.length > 0 && declared.every((match) => match[1] === "=") && assigned.every((match) => isEmpty(match[1]!))
    }
    const weaponIsEmpty = (written: string) => isEmpty(written) || (/^(?:this\s*\.\s*)?\w+$/.test(written.trim()) && alwaysEmpty(written.trim().replace(/^this\s*\.\s*/, "")))
    const calls = [
      // `new Arrow(Level, LivingEntity, stack, weapon)` / `(Level, x, y, z, stack, weapon)`; the (type, level) form has no weapon and fewer arguments.
      ...[...code.matchAll(/(?<![\w.])new\s+(?:[a-z]\w*\s*\.\s*)*(Arrow|SpectralArrow)\s*\(/g)].map((match) => ({ at: match.index, open: match.index + match[0].length - 1, called: `new ${match[1]}(…)` })),
      ...[...code.matchAll(/\.\s*createArrow\s*\(/g)].map((match) => ({ at: match.index, open: match.index + match[0].length - 1, called: "createArrow(…)" })),
      // A projectile of the gameplay's own, built on one of the three: its constructor hands the weapon up through super.
      ...(/\bextends\s+(?:[\w.]+\s*\.\s*)?(?:AbstractArrow|Arrow|SpectralArrow)\b/.test(code) ? [...code.matchAll(/(?<![\w.])super\s*\(/g)].map((match) => ({ at: match.index, open: match.index + match[0].length - 1, called: "super(…)" })) : []),
    ]
    return calls.flatMap((call): GameplayFinding[] => {
      const spans = callArgumentSpans(code, call.open)
      if (spans.length < 4) return []
      const last = spans[spans.length - 1]!
      if (!weaponIsEmpty(code.slice(last.start, last.end))) return []
      return [{ rule: "empty_weapon", file: file.path, line: lineAt(file.content, call.at), message: `${call.called} 的最后一个参数（发射它的武器）是空物品栈。${EMPTY_WEAPON_WORDS.why}。`, fix: EMPTY_WEAPON_WORDS.fix }]
    })
  })
}

/**
 * What compiles and then breaks when the game starts, a world loads or the thing is first used (10-07): the
 * class of fault that a private entry constructor and a chunk callback that waited on its own chunk belonged
 * to. Each rule is a fact of the game or of Fabric read off the 1.21.1 jars (in the game's official names), about any gameplay whatever it
 * is for, and is matched only where the source says it outright (a literal, a call written in the callback
 * itself), so that what it refuses is certain; what is spread over helper methods is not seen (`GAMEPLAY_SCAN_LIMITS`).
 *
 * `bad_id`: `ResourceLocation` (fromNamespaceAndPath, parse, withDefaultNamespace) throws ResourceLocationException for a namespace outside [a-z0-9_.-] or a path
 *   outside [a-z0-9/._-]; in a static field of the entry class that is the game not starting.
 * `late_registration`: the registries freeze when every mod's initializer has returned; `Registry.register`
 *   written inside an event callback runs after that ("Registry is already frozen").
 * `tracked_owner`: `SynchedEntityData.defineId` numbers a value by the class it is registered for; registered
 *   for a class that is not the one declaring the field (a vanilla entity, another class) every such entity
 *   fails when it is created ("has not defined synched data value"), and a field that is not static registers
 *   one more with every entity made.
 * `early_world`: ServerLifecycleEvents.SERVER_STARTING is fired before the server has loaded its worlds or
 *   made its player list: `overworld()`, `getLevel(...)`, `getAllLevels()` and `getPlayerList()` give null there.
 * `client_not_in_world`: the client's tick events fire on the title screen too, where `client.player` and
 *   `client.level` are null.
 */
export const STARTUP_RULES = {
  bad_id: { fix: "名字只用小写字母、数字、下划线、点、短横线，路径里还可以用斜杠；不用大写、空格和中文。要给人看的名字放进 lang。" },
  late_registration: { fix: `注册（物品、方块、实体类型、声音、粒子……）只能在入口的 onInitialize 里、或者 onInitialize 用到的类的 static 字段里做。事件回调里只用已经注册好的东西。` },
  tracked_owner: { fix: "同步数据只能给自己写的实体类登记：写成那个类自己的 private static final 字段，defineId 的第一个参数就是这个类自己。要给玩家或原版生物记数据，用 Fabric 的 data attachment。" },
  early_world: { fix: "要用世界或玩家列表的事，放到 ServerLifecycleEvents.SERVER_STARTED 里做（那时世界已经载入）。SERVER_STARTING 里只做不碰世界的准备。" },
  client_not_in_world: { fix: "回调开头先判断：if (client.player == null || client.level == null) return;（参数叫什么名字就写什么）。" },
} as const

/** The same two fixes on Forge and NeoForge, where there is no Fabric data attachment and registering goes through ProjectPlatform. */
const TRACKED_OWNER_FACADE = "同步数据只能给自己写的实体类登记：写成那个类自己的 private static final 字段，defineId 的第一个参数就是这个类自己。要给玩家或原版生物记数据，整个世界的事用 SavedData；做不到的写进 not_doing。"
const LATE_REGISTRATION_FACADE = `注册（物品、方块、实体类型、声音、粒子……）只用 ${GAMEPLAY_API.platform}.register(Registries.XXX, "名字", () -> …)，在 onInitialize 里、或者 onInitialize 用到的类的 static 字段里调用。事件回调里只用已经注册好的东西。`

/**
 * Forge and NeoForge (D 组): `Registry.register` straight into one of the game's registries. Both loaders keep the game's registries locked
 * while a mod is constructed (where onInitialize runs) and open them only in their own registry event, so the call compiles and the game
 * stops starting with "Registry is already frozen". ProjectPlatform.register hands the thing to the loader to register at the right time.
 */
export function scanRegistration(sources: readonly { path: string; content: string }[]): GameplayFinding[] {
  return sources.flatMap((file) => {
    const { code } = stripJava(file.content)
    return [...code.matchAll(/(?<![\w.])(?:net\s*\.\s*minecraft\s*\.\s*core\s*\.\s*)?Registry\s*\.\s*(register|registerForHolder)\s*\(/g)].map((match) => ({
      rule: "registry_direct",
      file: file.path,
      line: lineAt(file.content, match.index),
      message: `直接调用了 Registry.${match[1]}：Forge 和 NeoForge 在模组启动时把游戏的注册表锁着，只在它们自己的注册时机打开，这样写编译能过，游戏一启动就报 Registry is already frozen。`,
      fix: LATE_REGISTRATION_FACADE,
    }))
  })
}

const ID_PART = { namespace: /^[a-z0-9_.-]+$/, path: /^[a-z0-9/._-]+$/ }

export function scanStartup(sources: readonly { path: string; content: string }[], target: TargetId = DEFAULT_TARGET): GameplayFinding[] {
  return sources.flatMap((file) => {
    const { code, strings } = stripJava(file.content)
    const found: (GameplayFinding & { offset: number })[] = []
    const fixOf = (rule: keyof typeof STARTUP_RULES) => (rule === "tracked_owner" && onFacade(target) ? TRACKED_OWNER_FACADE : rule === "late_registration" && onFacade(target) ? LATE_REGISTRATION_FACADE : STARTUP_RULES[rule].fix)
    const add = (rule: keyof typeof STARTUP_RULES, offset: number, message: string) => found.push({ rule, file: file.path, line: lineAt(file.content, offset), offset, message, fix: fixOf(rule) })
    /** The arguments of the call opened at `open` that are one string literal and nothing else: what the literal says, or null for anything else. */
    const literals = (open: number) => {
      const at = { offset: open + 1 }
      return callArguments(code, open).map((argument) => {
        const start = at.offset
        at.offset += argument.length + 1
        return /^\s*"[^"]*"\s*$/.test(argument) ? (strings.find((value) => value.offset === start + argument.indexOf('"'))?.value ?? null) : null
      })
    }
    const body = (open: number) => ({ start: open + 1, text: code.slice(open + 1, closing(code, open)) })

    ;[...code.matchAll(new RegExp(`(?<![\\w.])(?:(${GAMEPLAY_API.content})\\s*\\.\\s*id|ResourceLocation\\s*\\.\\s*(fromNamespaceAndPath|parse|withDefaultNamespace))\\s*\\(`, "g"))].forEach((match) => {
      const written = literals(match.index + match[0].length - 1)
      // One literal: a path (ProjectContent.id, withDefaultNamespace) or "namespace:path" (parse; without a colon it is a path). Two: namespace, path (fromNamespaceAndPath).
      const parts = written.length === 2 ? [{ part: "namespace" as const, value: written[0] }, { part: "path" as const, value: written[1] }]
        : written.length === 1 && written[0] !== null && match[2] === "parse" && written[0].includes(":") ? [{ part: "namespace" as const, value: written[0].slice(0, written[0].indexOf(":")) }, { part: "path" as const, value: written[0].slice(written[0].indexOf(":") + 1) }]
        : written.length === 1 ? [{ part: "path" as const, value: written[0] }]
        : []
      const wrong = parts.find((value) => value.value !== null && !ID_PART[value.part].test(value.value))
      if (wrong) add("bad_id", match.index, `名字「${wrong.value}」里有游戏不认的字符：游戏一读到它就报错，写在入口类的 static 字段里时游戏根本启动不了。`)
    })

    ;[...code.matchAll(/(?<![\w])([A-Z][A-Z0-9_]*)\s*\.\s*register\s*\(/g)].forEach((match) => {
      const inside = body(match.index + match[0].length - 1)
      if (!inside.text.includes("->")) return
      const late = /(?<![\w.])Registry\s*\.\s*register\s*\(/.exec(inside.text)
      if (late) add("late_registration", inside.start + late.index, `在 ${match[1]} 的回调里调用了 Registry.register：回调运行的时候游戏的注册表已经锁上，会报 Registry is already frozen。`)
      if (match[1] === "SERVER_STARTING") {
        const early = /\.\s*(overworld|getAllLevels|getLevel|getPlayerList)\s*\(/.exec(inside.text)
        if (early) add("early_world", inside.start + early.index, `在 SERVER_STARTING 的回调里调用了 ${early[1]}：这时服务器还没有载入世界、也没有玩家列表，拿到的是空的，进世界时会出错。`)
      }
      if (match[1] === "END_CLIENT_TICK" || match[1] === "START_CLIENT_TICK") {
        const lambda = /^\s*(?:\(\s*(?:[\w.]+\s+)?(\w+)\s*\)|(\w+))\s*->/.exec(inside.text)
        const client = lambda?.[1] ?? lambda?.[2]
        const used = client ? new RegExp(`(?<![\\w.])${client}\\s*\\.\\s*(player|level)\\s*\\.`).exec(inside.text) : null
        if (client && used && !new RegExp(`(?<![\\w.])${client}\\s*\\.\\s*${used[1]}\\s*[!=]=\\s*null`).test(inside.text))
          add("client_not_in_world", inside.start + used.index, `在 ${match[1]} 的回调里直接用了 ${client}.${used[1]}，没有先判断它是不是空的：这个回调在标题画面也会运行，那时还没有玩家和世界，游戏一启动就会出错。`)
      }
    })

    const declared = new Set([...code.matchAll(/\b(?:class|record|enum)\s+(\w+)/g)].map((match) => match[1]!))
    ;[...code.matchAll(/(?<![\w])SynchedEntityData\s*\.\s*defineId\s*\(\s*([\w.]+)\s*\.\s*class/g)].forEach((match) => {
      const owner = match[1]!.split(".").at(-1)!
      // The declaration this call is the value of: from the end of the statement or block before it.
      const before = code.slice(Math.max(code.lastIndexOf(";", match.index), code.lastIndexOf("{", match.index), code.lastIndexOf("}", match.index)) + 1, match.index)
      if (!declared.has(owner)) add("tracked_owner", match.index, `给 ${owner} 登记了同步数据，可它不是这个文件里自己写的类：游戏里每一个 ${owner} 创建时都会出错（原版的玩家、生物都在内）。`)
      else if (!/\bstatic\b/.test(before)) add("tracked_owner", match.index, `登记同步数据的这个字段不是 static 的：每创建一个实体就多登记一次，很快就会超出上限报错。`)
    })
    return found.sort((a, b) => a.offset - b.offset).map(({ offset: _offset, ...finding }) => finding)
  })
}

/**
 * Whether `new Name()` works from another package, read off source that `stripJava` has blanked: null when it
 * does. A class that writes no constructor has Java's own public one. Fabric creates each class named in
 * fabric.mod.json this way and so does the generated boot code with each gameplay's entry; a constructor that
 * is not public compiles (for Fabric's reflection) and then fails when the game starts.
 */
export function constructorIssue(code: string, name: string): "not_public" | "needs_arguments" | null {
  // `new Name(...) { ... }` is an anonymous subclass, not a constructor.
  const written = [...code.matchAll(new RegExp(`(?<!\\bnew\\s+)(?<![\\w.])((?:(?:public|protected|private)\\s+)?)${name}\\s*\\(([^)]*)\\)\\s*(?:throws\\b[^{;]*)?\\{`, "g"))]
  const bare = written.filter((match) => !match[2]!.trim())
  if (!written.length) return null
  if (!bare.length) return "needs_arguments"
  return bare.every((match) => match[1]!.trim() === "public") ? null : "not_public"
}

/** The entry files have the shape the generated boot code calls: checked here so the refusal names the file, not a compile error in Studio's own code. */
export function scanEntries(sources: readonly { path: string; content: string }[]): GameplayFinding[] {
  const entry = (path: string, type: string, method: string) => {
    const file = sources.find((value) => value.path === path)
    if (!file) return []
    const code = stripJava(file.content).code
    const name = path.split("/").at(-1)!.replace(/\.java$/, "")
    const shaped = new RegExp(`\\bpublic\\s+(?:final\\s+)?class\\s+${name}\\b[^{]*\\bimplements\\b[^{]*\\b${type}\\b`).test(code) && new RegExp(`\\bpublic\\s+void\\s+${method}\\s*\\(\\s*\\)`).test(code)
    const built = constructorIssue(code, name)
    if (shaped && !built) return []
    if (shaped)
      return [{ rule: "entry", file: path, line: null, message: `${path} 的${built === "not_public" ? "无参数构造方法不是 public 的" : "构造方法都带参数"}，Studio 启动这个玩法时创建不了它。`, fix: `Studio 用 new ${name}() 来创建这个类：把构造方法写成 public ${name}() { … }，或者干脆不写构造方法（Java 会自动给一个公开的）。要准备的东西放进 ${method}() 里。` }]
    return [{ rule: "entry", file: path, line: null, message: `${path} 不是 Studio 能启动的入口。`, fix: `写成 public final class ${name} implements ${type}，带一个 public void ${method}()，不要写带参数的构造方法。${type} 在 ${GAMEPLAY_API.package} 包里，Studio 会生成。` }]
  }
  return [...entry(GAMEPLAY_API.main, GAMEPLAY_API.entry, "onInitialize"), ...entry(GAMEPLAY_API.client_main, GAMEPLAY_API.client_entry, "onInitializeClient")]
}
