import { CREATURE_BABY } from "./creature-capability"
import { GOAL_BAND, GOAL_BAND_WORDS } from "./creature-goals"
import { GAMEPLAY_API, gameplayRoot, type GameplayDocument, type GameplayFinding } from "./gameplay"
import { overlapAdvice } from "./gameplay-already"
import { GOAL_ALWAYS_WORDS, checkGameplayReferences, declaredGameplay, goalAdvice, hostileAdvice } from "./gameplay-references"
import { COMPILE_PLAIN, plainFindings } from "./gameplay-plain"
import { scanEntries, scanGameplay } from "./gameplay-scan"
import { DEFAULT_TARGET, type TargetId } from "./target/ids"
import { targetManifest } from "./target/manifests"
import { targetWords, type TargetWords } from "./target/words"

/**
 * The machine checks of gameplay code, without the game: stays in bounds, references are real, compiles.
 * The first two are read off the source and the project and are computed here; compiling needs a compiler
 * and is run by whoever has one (`gameplay-compile.ts`), which hands its output to `compilerFindings`.
 * No Node APIs: the acceptance card recomputes the first two in the app's window.
 */

type Project = import("./project").Project

/**
 * The two checks that need nothing but the document and the project, and beside them what Studio read off
 * the source that is worth telling the writer and is no refusal (`advice`; left out when there is none, so a
 * check with nothing to say is what it always was).
 */
export function staticChecks(project: Project, document: GameplayDocument, assetId: string | null): Pick<GameplayCheck, "bounds" | "references" | "advice"> {
  const advice = [...goalAdvice(document), ...hostileAdvice(project, document), ...overlapAdvice(project, document, assetId)]
  return {
    bounds: [...boundsOnTargets(project, document, assetId), ...scanEntries(document.sources)],
    references: checkGameplayReferences(project, document, assetId),
    ...(advice.length ? { advice } : {}),
  }
}

/**
 * The bounds on every target the project is built for (D 组): what one target refuses is refused for the project (Fabric API on Forge or NeoForge,
 * a direct registration there), each finding once. A project for Fabric alone is scanned exactly as before.
 */
function boundsOnTargets(project: Project, document: GameplayDocument, assetId: string | null): GameplayFinding[] {
  const declared = declaredGameplay(project, document, assetId)
  const found = [...new Set(project.targets ?? [project.target])].flatMap((target) => scanGameplay({ mod_id: project.mod_id, slug: document.slug, sources: document.sources, declared, target }))
  return found.filter((finding, index) => found.findIndex((other) => other.rule === finding.rule && other.file === finding.file && other.line === finding.line && other.message === finding.message) === index)
}

/** What the compiler said in plain words, for the messages seen most. The compiler's own line is always kept beside it. A fix names the facts of the project's target (`t`). */
const PLAIN: readonly [RegExp, (found: RegExpExecArray, detail: string, t: TargetWords) => { message: string; fix: string; plain: string }][] = [
  [/^cannot find symbol/, (_, detail, t) => {
    const symbol = /symbol:\s+(\w+)\s+(.+)/.exec(detail)
    const where = /location:\s+(.+)/.exec(detail)
    return { plain: COMPILE_PLAIN.symbol(symbol?.[1] === "class" ? "class" : symbol?.[1] === "method" ? "method" : "name"), message: `找不到${symbol ? `${symbol[1] === "class" ? "类" : symbol[1] === "method" ? "方法" : "名字"} ${symbol[2]!.trim()}` : "这个名字"}${where ? `（在 ${where[1]!.trim()} 里）` : ""}。`, fix: `这个名字在 Minecraft ${t.minecraft}（${t.naming.names}）或 ${gameplayApiName(t)} 里不存在，或者少了 import。核对拼写、参数和 import；不确定的接口不要凭印象写。` }
  }],
  [/^package ([\w.]+) does not exist/, (found, _, t) => ({ plain: COMPILE_PLAIN.package, message: `包 ${found[1]} 不存在。`, fix: `核对 import 的包名：用的是 Minecraft ${t.minecraft} 的 ${t.naming.names}（net.minecraft.…），不是 ${t.naming.other}，也不是别的版本。` })],
  [/^incompatible types: (.+)/, (found, _, t) => ({ plain: COMPILE_PLAIN.types, message: `类型对不上：${found[1]}。`, fix: `按这个方法在 ${t.minecraft} 里真正的参数和返回类型来写。` })],
  [/^(?:method|constructor) (\w+) in (?:class|interface|record|enum) ([\w.<>?, ]+) cannot be applied to given types/, (found, _, t) => ({ plain: COMPILE_PLAIN.arguments, message: `${found[2]} 的 ${found[1]} 不接受这样的参数。`, fix: `核对这个方法在 ${t.minecraft} 里的参数个数和类型。` })],
  [/^no suitable (?:method|constructor) found for (\w+)/, (found, _, t) => ({ plain: COMPILE_PLAIN.arguments, message: `${found[1]} 没有接受这些参数的写法。`, fix: `核对这个方法在 ${t.minecraft} 里的参数个数和类型。` })],
  [/^(.+) is not abstract and does not override abstract method (.+) in (.+)/, (found) => ({ plain: COMPILE_PLAIN.abstract, message: `${found[1]} 没有实现 ${found[3]} 要求的方法 ${found[2]}。`, fix: "把这个方法按原样的名字和参数实现出来。" })],
  [/^method does not override or implement a method from a supertype/, (_, __, t) => ({ plain: COMPILE_PLAIN.override, message: "这里写了 @Override，但父类或接口里没有这样一个方法。", fix: `核对方法名和参数类型是不是和 ${t.minecraft} 里的一样。` })],
  [/^class (\w+) is public, should be declared in a file named (.+)/, (found) => ({ plain: COMPILE_PLAIN.file_name, message: `公开类 ${found[1]} 必须放在名为 ${found[2]} 的文件里。`, fix: "让文件名和里面的公开类同名。" })],
  [/^unreported exception ([\w.]+)/, (found) => ({ plain: COMPILE_PLAIN.exception, message: `这里可能抛出 ${found[1]}，但没有处理。`, fix: "用 try/catch 处理它，或者换一个不抛这种异常的写法。" })],
  [/^(.+) has (?:private|protected) access in (.+)/, (found) => ({ plain: COMPILE_PLAIN.access, message: `${found[2]} 的 ${found[1]} 不是公开的，玩法代码碰不到。`, fix: "换成公开的方法。这一版不开放反射、mixin 和 access widener；没有公开入口的事情现在做不了，请在 not_doing 里如实写明。" })],
  [/^missing return statement/, () => ({ plain: COMPILE_PLAIN.missing_return, message: "这个方法有的路径没有返回值。", fix: "让每条路径都 return。" })],
  [/^variable (\w+) might not have been initialized/, (found) => ({ plain: COMPILE_PLAIN.unset, message: `变量 ${found[1]} 可能还没有赋值就被用了。`, fix: "先给它一个值。" })],
  [/^variable (\w+) is already defined/, (found) => ({ plain: COMPILE_PLAIN.twice, message: `变量 ${found[1]} 定义了两次。`, fix: "删掉一个，或者改名。" })],
  [/^(?:'(.+)'|(\S+)) expected/, (found) => ({ plain: COMPILE_PLAIN.syntax, message: `语法不对：这里应该有 ${found[1] ?? found[2]}。`, fix: "检查这一行和上一行的括号、分号和引号。" })],
  [/^(?:illegal start of|not a statement|class, interface, enum, or record expected|reached end of file while parsing|unclosed)/, () => ({ plain: COMPILE_PLAIN.syntax, message: "语法不对：括号、分号或引号没有配上。", fix: "检查这一行附近的括号、分号和引号。" })],
]

export type CompilerOutput = {
  /** Findings in this gameplay's own files. */
  own: GameplayFinding[]
  /** Errors anywhere else in the generated project, as the compiler printed them: not this gameplay's to fix. */
  elsewhere: string[]
}

/**
 * javac's errors (Gradle prints them unchanged) as findings on this gameplay's own files, by the path each
 * file has in the document. `output` may use either slash and absolute or relative paths. `target`: the project's, whose facts a fix names.
 */
export function compilerFindings(output: string, modId: string, slug: string, target: TargetId = DEFAULT_TARGET): CompilerOutput {
  const words = targetWords(target)
  const folder = `${gameplayRoot(modId).replaceAll(".", "/")}/`
  const lines = output.replaceAll("\r\n", "\n").split("\n")
  const errors = lines.flatMap((line, index) => {
    // A Windows path has a drive letter and backslashes; the file name is whatever stands before ":<line>: error:".
    const match = /^(.*\.java):(\d+): error: (.*)$/.exec(line.trim().replaceAll("\\", "/"))
    if (!match) return []
    // What follows up to the next error: the source line, the caret, and "symbol:" / "location:" notes.
    const rest = lines.slice(index + 1, index + 8)
    const end = rest.findIndex((value) => /\.java:\d+: (?:error|warning):|^\d+ errors?$|^FAILURE:|^> Task/.test(value.trim()))
    return [{ path: match[1]!, line: Number(match[2]), text: match[3]!, detail: (end < 0 ? rest : rest.slice(0, end)).join("\n") }]
  })
  const inside = (path: string) => (path.includes(folder) ? path.slice(path.indexOf(folder) + folder.length) : null)
  const own = errors.flatMap((error): GameplayFinding[] => {
    const local = inside(error.path)
    if (!local?.startsWith(`${slug}/`)) return []
    const plain = PLAIN.flatMap(([pattern, say]) => ((found) => (found ? [say(found, error.detail, words)] : []))(pattern.exec(error.text)))[0]
    return [{ rule: "compile", file: local.slice(slug.length + 1), line: error.line, message: `编译不过：${plain?.message ?? "编译器在这一行报了错。"}（编译器原话：${error.text}）`, fix: plain?.fix ?? "照编译器的原话改这一行。", plain: plain?.plain ?? COMPILE_PLAIN.other }]
  })
  const elsewhere = errors.filter((error) => !inside(error.path)?.startsWith(`${slug}/`)).map((error) => `${inside(error.path) ?? error.path.split("/").slice(-2).join("/")}:${error.line}: ${error.text}`)
  return { own, elsewhere }
}

/** What one run of the three machine checks found. The same shape whoever ran it and whichever compiler was used. */
export type GameplayCheck = {
  bounds: GameplayFinding[]
  references: GameplayFinding[]
  /** Null when the compiler was not run: the source did not get that far, or there is no compiler here. */
  compile: { ok: boolean; findings: GameplayFinding[]; compiler: string; note: string | null; /** What the note leaves out for the person: the files and the compiler's own lines. Absent in records from before. */ detail?: string | null } | null
  /** Read off the source and told to the writer; never part of the floor. Absent when there is none, and in checks from before it existed. */
  advice?: GameplayFinding[]
}

/**
 * What a check found, as sentences a person can read: one line for each of the three results that failed, with a sentence of its own for every rule that fired and no name of
 * code in it (`plainFindings`). `checkLines` (gameplay-loop.ts) is the same list for the AI that has to fix the code, quoting it.
 */
export function plainCheckLines(check: GameplayCheck): string[] {
  return [
    ...(check.bounds.length ? [`${CHECK_WORDS.bounds.bad}：${plainFindings(check.bounds)}`] : []),
    ...(check.references.length ? [`${CHECK_WORDS.references.bad}：${plainFindings(check.references)}`] : []),
    ...(check.compile && !check.compile.ok ? [`${CHECK_WORDS.compile.bad}：${check.compile.findings.length ? plainFindings(check.compile.findings) : (check.compile.note ?? "编译器报了错。")}`] : []),
  ]
}

/** The deterministic floor: in bounds, references real, and compiled. A version that is not all three is never saved. */
export const floorPassed = (check: GameplayCheck) => !check.bounds.length && !check.references.length && check.compile?.ok === true

/** The four checks as the person reads them. `said` is the review of description against code, when there is one for this version. */
export const CHECK_WORDS = {
  compile: { ok: "能编译", bad: "编译不过", none: "还没有编译过" },
  bounds: { ok: "没有越界", bad: "代码越界了" },
  references: { ok: "引用都对得上", bad: "引用对不上" },
  said: { ok: "说明和代码一致", bad: "说明和代码不一致", none: "说明和代码还没有核对过" },
} as const

/**
 * How to tell an enemy, in the game's official names (every target's): `Enemy` is the interface every vanilla enemy has, and the hostile
 * creatures Studio generates implement it too; `Monster` is a class, which slimes, ghasts, phantoms and shulkers are not, and which the
 * project's own creatures cannot extend.
 */
const ENEMY_WORDS =
  "判断一个实体是不是敌人，用 instanceof Enemy（net.minecraft.world.entity.monster.Enemy），它同时覆盖原版的怪和这个工程里的敌对生物（包括 Boss）；不要用 Monster 类（net.minecraft.world.entity.monster.Monster），它不是所有敌人共有的：史莱姆、恶魂、幻翼、潜影贝都不是它的子类，工程里的生物也不是。"

/** Whether gameplay on a target reaches the loader only through Studio's ProjectPlatform (Forge, NeoForge), or may use Fabric API too (Fabric). */
const throughStudio = (t: TargetWords) => targetManifest(t.id).loader.kind !== "fabric"

/** What gameplay code may use beside the game, as a sentence names it: Fabric API on Fabric; Studio's own API on Forge and NeoForge, which gameplay code never names. */
export const gameplayApiName = (t: TargetWords) => (throughStudio(t) ? `Studio 生成的 ${GAMEPLAY_API.platform} / ${GAMEPLAY_API.client_platform}` : t.api)

/** What gameplay may use and how, said with the facts of the project's target. */
const freelyUsed = (t: TargetWords) =>
  throughStudio(t)
    ? `Minecraft ${t.minecraft}（${t.naming.names}）可以自由使用；加载器（${t.loader}）的事只经 ${GAMEPLAY_API.platform} / ${GAMEPLAY_API.client_platform}。不能用 mixin、access widener 和反射。游戏的类一个一个写出来导入，不用 .* 通配导入。${ENEMY_WORDS}`
    : `Minecraft ${t.minecraft}（${t.naming.names}）和 ${t.api} 可以自由使用。不能用 mixin、access widener 和反射。游戏的类一个一个写出来导入，不用 .* 通配导入。${ENEMY_WORDS}`

/** What gameplay reaches the loader through (D 组): the same members on every target; on Fabric beside Fabric API, on Forge and NeoForge the only way. */
const platformWords = (t: TargetWords) =>
  `加载器的事（事件、注册、网络包、按键、HUD）通过 <模组包>.gameplay.${GAMEPLAY_API.package}.${GAMEPLAY_API.platform}（两端都能用）和 ${GAMEPLAY_API.client_platform}（只在 client/ 里用）：` +
  `${GAMEPLAY_API.platform}.onServerTick(server -> …)、onLevelTick(level -> …)（每一刻里每个世界一次，在所有世界都走完以后）、onServerStarted(server -> …)、onPlayerJoin(player -> …)、onEntityDeath((entity, source) -> …)、` +
  `onUseBlock((player, level, hand, hit) -> …)、onUseItem((player, level, hand) -> …)、onUseEntity((player, level, hand, entity) -> …)（这三个返回 InteractionResult，PASS 让游戏照常往下走；每次右键对两只手各问一次）、onCommands(dispatcher -> …)、` +
  `register(Registries.ITEM, "名字", () -> new Item(…))（任何注册表都行，名字在这个模组的命名空间里；给回 Supplier，用到时再 .get()）、` +
  `s2c("名字", 包的类.class, 写, 读) 和 c2s("名字", 包的类.class, 写, 读, (player, 包) -> …)（每种包一个自己的类，写是 (包, FriendlyByteBuf) -> void、读是 FriendlyByteBuf -> 包；给回的 Channel 在服务端用 sendTo(玩家, 包) / sendTracking(实体, 包) / sendNear(世界, x, y, z, 半径, 包) 发）；` +
  `${GAMEPLAY_API.client_platform}.keyMapping(new KeyMapping(…))、onClientTick(() -> …)（标题画面也会跑）、onHud((graphics, partialTick) -> …)、onReceive(Channel, 包 -> …)、send(Channel, 包)。` +
  `这些都只在 onInitialize（${GAMEPLAY_API.client_platform} 的在 onInitializeClient）里各调用一次。` +
  (throughStudio(t)
    ? `这个工程是 ${t.loader} ${t.minecraft} 的：加载器自己的类（net.minecraftforge、net.neoforged、net.fabricmc）一律不能直接用，check_code 会退回并告诉你该换成上面哪一个；` +
      `onInitialize 运行时游戏的注册表是锁着的，不能直接 Registry.register，要注册就用 ${GAMEPLAY_API.platform}.register；${GAMEPLAY_API.content}.item、block、entity 也要等用到的时候（事件、Goal、规则里）再取，在 onInitialize 里取会报“还没注册”。` +
      `这里面没有的事（例如 Fabric 的 data attachment、Fabric 才有的事件），这个玩法现在做不了：整个世界要记的东西用 Minecraft 自己的 SavedData，其余如实写进 not_doing。`
    : `这一套在 Fabric、Forge、NeoForge 上写法一样；这个工程是 Fabric 的，也可以直接用 Fabric API，但只用这一套（加上游戏自己的类）的代码换到别的加载器也能照样编译。`)

/** The entry line: who starts the entries, said for the target's loader. */
const entryWords = (t: TargetWords) =>
  `入口固定：${GAMEPLAY_API.main} 里写 public final class Main implements ${GAMEPLAY_API.entry}，带一个 public void onInitialize()；需要客户端代码时再加 ${GAMEPLAY_API.client_main}，写 public final class ClientMain implements ${GAMEPLAY_API.client_entry}，带一个 public void onInitializeClient()。` +
  (throughStudio(t) ? `Studio 生成启动它们的代码，不用也不能自己写 @Mod 或去 ${t.loader === "Forge" ? "mods.toml" : "neoforge.mods.toml"} 里登记。` : "Studio 生成启动它们的代码，不用也不能自己去 fabric.mod.json 里登记。")

/**
 * Said to whoever writes gameplay: what the generated support code offers. One list, so the hand-off text, the task context and the spec cannot disagree.
 * Said with the facts of the project's target (`target`, left out: the default): who starts the entries, what reaches the loader, what of the game may be used.
 */
export const gameplayApiWords = (target: TargetId = DEFAULT_TARGET): readonly string[] => {
  const t = targetWords(target)
  return [GAMEPLAY_SUPPORT_WORDS[0], entryWords(t), ...GAMEPLAY_SUPPORT_WORDS.slice(2), platformWords(t), freelyUsed(t)]
}

const GAMEPLAY_SUPPORT_WORDS = [
  `每个玩法的 Java 都在自己的包里：<模组包>.gameplay.<slug>（文件路径里的文件夹接在后面）。只有 client/ 文件夹里的文件可以用客户端的类。`,
  `入口固定：${GAMEPLAY_API.main} 里写 public final class Main implements ${GAMEPLAY_API.entry}，带一个 public void onInitialize()；需要客户端代码时再加 ${GAMEPLAY_API.client_main}，写 public final class ClientMain implements ${GAMEPLAY_API.client_entry}，带一个 public void onInitializeClient()。Studio 生成启动它们的代码，不用也不能自己去 fabric.mod.json 里登记。`,
  `读这个工程自己的东西只通过 <模组包>.gameplay.${GAMEPLAY_API.package}.${GAMEPLAY_API.content}：item("标识符")、block("标识符")、blockItem("标识符")、entity("资产 id")、isEntity(实体, "资产 id")，以及 id("路径")（在这个模组的命名空间里起一个名字）。things 里一只生物只有一行，also_read_as 是读同一只生物的另外的资产 id，用哪个都是它自己，不是另一只。名字要直接写成字符串或同文件里的 static final String 常量，Studio 会逐个核对它存在，并且要求它列在 uses 里。`,
  `给这个工程的生物加行为也通过它：${GAMEPLAY_API.content}.addGoal("资产 id", 优先级, mob -> new 你的Goal(mob)) 加一个行为，addTargetGoal("资产 id", 优先级, mob -> …) 加一个“盯上谁”的行为（mob 是 PathfinderMob，返回 net.minecraft.world.entity.ai.goal.Goal）。在 onInitialize 里各调用一次，以后每一只这种生物出现时都会带上。${GOAL_BAND_WORDS.baseline}。${GOAL_BAND_WORDS.band}；优先级要直接写成一个整数，别的写法 check_code 会退回（${GOAL_BAND_WORDS.why}）。放在 ${GOAL_BAND.over_idle[0]} 到 ${GOAL_BAND.over_idle[1]} 的行为只要 canUse 答应就上场，它上场的时候${GOAL_ALWAYS_WORDS.means}。所以 canUse 要写真正要等的事；一个只要闲着就能开始的行为（canUse 直接回答 true，或者只看“没有目标”这一类它平时一直成立的状态），等于把它闲着时的生活整个换掉了——确实要这样，说明里必须如实写它不再自己闲逛和张望，否则评审会退回。`,
  `敌对生物打谁和它不打的时候做什么是两件事，分开写。打谁：${GAMEPLAY_API.content}.targetRule("资产 id", (mob, 候选) -> 可不可以打) 登记一条规则（mob 是 PathfinderMob，候选是 LivingEntity，返回 boolean）。生物自己选目标之前、以及有目标的每一刻都会问它；一答 false，它当刻放掉这个目标、停止追打，身体空出来给别的行为。要它去打它自己不会选的对象，用 addTargetGoal 加一个选目标的行为（在里面 mob.setTarget(...)）。规则里只做判断，要快，不要在里面改动世界。不打的时候做什么：用 addGoal 加在上面说的优先级里，条件写成它没有目标（mob.getTarget() == null）时才上场。不要自己再写一套追人和出手去和它自带的抢，也不要在全局 tick 里反复 setTarget。被 targetRule 或 addTargetGoal 管着的生物，生成出来只对它的目标动手：没有目标就不打，目标死了、走远了、看不见了或规则不答应了就放掉。`,
  `指挥这个工程里会飞的生物也通过它：${GAMEPLAY_API.content}.flyTo(creature, x, y, z) 请求这只生物现在飞到那个位置（creature 是 Mob，x、y、z 是它的脚要到的地方）——在地上就先起飞，飞到以后在附近悬停或盘旋几秒，被下一次 flyTo 换掉，或者几秒后它自己的闲逛接着来；不会飞的生物只是沿地面走过去，可能走不到。${GAMEPLAY_API.content}.isFlying(creature) 问它是不是离了地（起飞和落地中也算），${GAMEPLAY_API.content}.land(creature) 请它就地落下。这三个只在服务端起作用，名字里不用写生物的资产 id。flyTo 只是一个临时的目的地，不是新的状态：它的目标、原有的 Goal、战斗都照旧（在天上打架的生物继续打）。要做“它在某些地方之间飞来飞去”这类事：用 addGoal 加一个 Goal（canUse 写它没有目标、也没有别的事），在里面找到一个目标点（例如附近某种方块的位置、某个玩家头顶上方），隔几十刻或者到了再调一次 flyTo；不要每一刻都换点。生成的飞行内部（flightGo 一类）是私有的，玩法代码碰不到，也不要去碰。`,
  `让这个工程里的生物做出它模型里的动作也通过它：${GAMEPLAY_API.content}.${GAMEPLAY_API.motionMethod}(creature, "动作名") 在服务端把这只生物（Mob）模型里这个名字的动作从头播一遍，附近的玩家同时看到；动作盖在它正在做的事上，不会让它停下或转向，在玩家自己的游戏里不起作用。动作名要直接写成字符串，是模型里动作的名字：things 里每只生物的 motions 列出了它们，played 是 false 的就是现在没有任何别的东西会播的。说明里写了生物在某一刻要做出某个动作（下蛋、吼叫、蓄力……），就在那一刻调用它；只改生物的姿势或别的状态不会播放模型里的动作。名字拼错或模型里没有那个动作，什么也不会播，只在日志里说一次。`,
  `${CREATURE_BABY.capability}`,
  `工程里做好的效果（出现一下就消失的小模型）也通过它放出来：${GAMEPLAY_API.content}.spawnEffect("效果的资产 id", level, pos, yaw) 在服务端把它放在 pos（Vec3），正面转到 yaw；再加第五个参数 owner（一个 Entity）时，它按自己的设定跟着 owner、或者随 owner 死亡而消失。它只给人看，不伤人、不存盘、到时间自己消失；在客户端调用什么都不会发生。id 要直接写出来，并且列在 uses 里。`,
  `生物的招式有一种出手是交给玩法的（招式里 hits 写 {type:"gameplay", at, gameplay:"这个玩法的 slug", action:"入口名"}）：招式本身——名字、动作、蓄力、冷却、什么时候能用、Boss 的阶段、晃屏——都是生物那边的，到那一刻由你的代码做事。你的代码在 onInitialize 里用 ${GAMEPLAY_API.content}.${GAMEPLAY_API.abilityMethod}("入口名", (creature, target) -> { … }) 登记同名的入口（实现 ${GAMEPLAY_API.ability}：void run(Mob creature, LivingEntity target)，creature 是在放招的生物，target 是它正在打的，只在服务端、每放一次招跑一次）；也可以 new 一个实现了 ${GAMEPLAY_API.ability} 的类交给它。入口名要直接写成字符串，和招式里的 action 一字不差，整个工程里不能重名。这一刻做什么由你写（例如在 creature 身边生成几只小生物）：招式不会因此被打断或改变，也不要在这里再数冷却、再自己决定什么时候放——什么时候放是招式的事。入口里抛出的异常会被记进日志、招式照常往下走，但仍然要写稳，别指望它兜底。招式里写了、代码里没有登记的入口，check_code 会退回。`,
] as const

/** The words for the default target, as every text without a project at hand says them. */
export const GAMEPLAY_API_WORDS = gameplayApiWords()
