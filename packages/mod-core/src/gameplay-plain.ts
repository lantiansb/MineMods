import type { GameplayFinding } from "./gameplay"

/**
 * What a check of gameplay code found, in one sentence a person can read (round 18). The machine checks write for whoever fixes the code, so a
 * finding quotes the code: 「找不到类 SpawnRestriction」. A person reading the acceptance card or the failure card was shown those quotes, then
 * (the round before) a placeholder where a name had been, which kept neither the name nor the meaning. Each rule therefore has a sentence of its own that says
 * what is wrong and why it matters with no name of code in it; the quoted finding stays beside it for 高级 and for the AI. No Node APIs.
 */

/**
 * One sentence for every rule the checks can raise. The type of `RULE_IDS` is the list: a rule added to a check without its sentence here
 * is a failing test (the rules found in the scan and reference sources are compared with this table).
 */
export const PLAIN_RULES = {
  // The bounds scan.
  reflection: "代码用了一种能绕开游戏规则的写法（反射），玩法不能这样做。",
  instrument: "代码想改写或监视游戏程序本身，玩法不能这样做。",
  threads: "代码自己开了后台线程或定时器，玩法不能这样做；要定时，只能按游戏的节拍来数。",
  class_loading: "代码想自己加载或改写程序里的类，玩法不能这样做。",
  files: "代码想读写电脑上的文件，玩法只能在游戏里面起作用。",
  network: "代码想连接网络，玩法不能联网。",
  process: "代码想启动电脑上的别的程序，玩法不能这样做。",
  scripting: "代码用了脚本引擎，玩法的逻辑要直接写成 Java。",
  serialization: "代码用了 Java 自带的存取对象的办法，玩法要用游戏自己的存数据办法。",
  host: "代码想探查或操纵游戏所在的电脑，玩法只能碰游戏里的东西。",
  native: "代码想直接调用电脑上的本机程序库，玩法不能这样做。",
  mixin: "代码想改写游戏本体的内部（mixin），这一版不开放。",
  exit: "代码想把游戏关掉，玩法不能这样做。",
  other_gameplay: "代码用到了另一个玩法里的东西，却没有在说明里声明依赖它。",
  studio_internals: "代码直接用了 Studio 生成的内部部分，这些部分随时可能变，玩法只能通过 Studio 提供的入口读工程里的东西。",
  import: "代码引用了玩法不允许使用的东西。",
  wildcard_import: "代码一次导入了游戏的一整个包，要把用到的类一个一个写出来导入。",
  unicode_escape: "代码里用转义的写法写了字符，要把这个字直接写出来。",
  package: "代码文件声明的位置不对，不在这个玩法自己的范围里。",
  client_only: "两端共用的文件里用了只有玩家自己的电脑上才有的东西，装在专用服务器上游戏会直接崩溃。",
  erases_life: "代码清掉或关掉了生物原有的行为，生物会呆在原地不动。",
  load_reentry: "代码在地图或生物还在载入的时候，回头向世界要东西，玩家进世界时可能卡在载入画面。",
  entry: "玩法的启动文件写得不符合要求，Studio 启动不了它。",
  bad_id: "代码里有游戏不认的名字写法，游戏一读到就会报错，甚至启动不起来。",
  late_registration: "代码在游戏已经启动完以后才去注册新东西，游戏会报错。",
  // D 组: on Forge and NeoForge.
  loader_api: "代码直接用了加载器自己的接口（Fabric、Forge 或 NeoForge 的），换成 Studio 提供的通用接口才能在这个工程的加载器上运行。",
  registry_direct: "代码绕过 Studio 直接往游戏里注册东西，在这个工程的加载器上游戏一启动就会报错。",
  tracked_owner: "代码给生物登记同步数据的方式不对，这种生物一出现游戏就会报错。",
  early_world: "代码在世界还没有载入的时候就去用世界，拿到的是空的，进世界时会出错。",
  client_not_in_world: "代码在标题画面也会运行的地方直接用了玩家和世界，那时它们还不存在，游戏一启动就会出错。",
  hand: "代码处理玩家右键时没有分左右手：游戏一次点击会处理两遍（主手和副手各一遍），同一件事会做两次。",
  empty_weapon: "代码给射出去的箭填了一件“空手”当发射它的武器：编译能过，可游戏在服务器上一造出这支箭就会报错，整个世界跟着崩溃。",
  // The references.
  unknown_use: "说明里写的“挂在哪些东西上”，有一样在这个工程里找不到。",
  slug_taken: "这个玩法的标识和另一个玩法重复了。",
  unknown_accessor: "代码调用了一个 Studio 没有提供的读取工程内容的方法。",
  goal_priority: "代码给生物加行为时，优先级没有直接写成允许范围内的整数，Studio 没法核对它不会盖住生物原有的行为。",
  accessor_argument: "代码读取工程里的东西时，名字不是直接写出来的，Studio 没法核对它存不存在。",
  unknown_content: "代码要用的东西，这个工程里没有。",
  undeclared_use: "代码用到了工程里的某样东西，却没有在说明里写明玩法挂在它上面。",
  target_unused: "代码给一只不会主动攻击的生物定了要打的目标，它不会动手，这段代码不会起作用。",
  missing_text: "代码要显示一段文字，两种语言的文字表里都没有这一条。",
  data_namespace: "有一个数据文件放在了不允许的位置。",
  data_folder: "有一个数据文件放在了旧版本游戏用的文件夹里，这个版本的游戏读不到它，也不会报错。",
  shadows_generated: "有一个文件或一段文字和 Studio 自己生成的撞在了一起，会把它顶掉。",
  file_taken: "另一个玩法已经在用同一个数据文件了。",
  text_taken: "游戏里的一段文字已经被另一个玩法用了。",
  data_json: "有一个数据文件的格式不对，游戏读不了。",
  unknown_reference: "数据文件里写了一样工程里没有的东西。",
  ability_action_name: "代码给招式登记的入口，名字的写法不符合要求。",
  ability_action_taken: "代码给招式登记的入口，名字和另一处重复了，游戏一启动就会报错。",
  ability_action_missing: "生物有一个招式要交给这个玩法去做，可是代码里没有接这一招的入口。",
  goal_always: "代码加的生物行为一直都会上场，生物平时的闲逛和张望会被它顶掉。",
  goal_twice: "另一个玩法也给同一只生物加了行为，两处如果做的是同一件事，就会做两遍。",
  hostile_missed: "代码用原版“敌对怪物”这个类认敌人，这个工程里自己做的敌对生物和 Boss 不是它，会被漏掉。",
  velocity_twice: "玩法挂着的方块自己已经会弹人，代码里又有直接改速度的写法，如果做的是同一件事，就是重复。",
  // The compiler.
  compile: "编译器在这一行报了错，代码写得通不过。",
} as const satisfies Record<string, string>

export const RULE_IDS = Object.keys(PLAIN_RULES)

/** For a rule this table does not know (a record from a later version, a rule added without its sentence): nothing about the code is guessed. */
export const PLAIN_UNKNOWN = "代码检查在这里发现了一个问题，具体写法在「高级」里。"

/** A finding as one sentence a person can read, with where it is when the finding names a file. Its own `plain` first, else the rule's. */
export function plainFinding(finding: Pick<GameplayFinding, "rule" | "plain">): string {
  return finding.plain?.trim() || (PLAIN_RULES as Record<string, string>)[finding.rule] || PLAIN_UNKNOWN
}

/** Findings as the sentence of a defect: each rule's sentence once however many places it was found in, in the order they were found. */
export function plainFindings(findings: readonly Pick<GameplayFinding, "rule" | "plain">[], limit = 4): string {
  const said = [...new Set(findings.map(plainFinding))]
  return `${said.slice(0, limit).join("")}${said.length > limit ? `（还有 ${said.length - limit} 类问题）` : ""}`
}

/** What each way the compiler reports a fault means, for the compile findings. The compiler's own line is kept beside it for 高级. */
export const COMPILE_PLAIN = {
  symbol: (kind: "class" | "method" | "name") => `代码里用到了一个游戏里没有的${kind === "class" ? "类" : kind === "method" ? "方法" : "名字"}（可能写错了，也可能这个版本的游戏里没有它），所以编译不过。`,
  package: "代码引用了一个游戏里没有的程序包，所以编译不过。",
  types: "代码里有两处数据的类型对不上，所以编译不过。",
  arguments: "代码调用一个方法时给的参数不对，所以编译不过。",
  abstract: "代码里有一个类没有把必须有的方法写出来，所以编译不过。",
  override: "代码里有一个方法标成了重写，可游戏里并没有这个方法可以重写，所以编译不过。",
  file_name: "代码里有一个公开的类和它所在的文件名对不上，所以编译不过。",
  exception: "代码里有一处可能出错却没有处理，所以编译不过。",
  access: "代码想用游戏里不对外开放的东西，所以编译不过。",
  missing_return: "代码里有一个方法，有的情况下没有给出结果，所以编译不过。",
  unset: "代码里有一个变量还没有赋值就被用了，所以编译不过。",
  twice: "代码里同一个名字定义了两次，所以编译不过。",
  syntax: "代码的写法有语法错误（括号、分号或引号没有配上），所以编译不过。",
  other: "编译器在这一行报了错，代码写得通不过。",
} as const

/** Said on the compile row when the project's other code is what does not compile: the files and the compiler's lines stay in `detail`. */
export const COMPILE_ELSEWHERE_NOTE = "工程里别的代码编译不过，不是这个玩法自己的文件，这一版玩法的代码改不了它。具体是哪个文件，在「高级」里。"
