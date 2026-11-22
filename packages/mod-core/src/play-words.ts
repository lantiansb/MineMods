/**
 * How a person is told to try their mod in the game, in words a non-programmer can follow (round 17): what happens
 * and when, in plain words and never as the game's own event or class names; and a command only as one line that
 * says what it does and how to type it. No Node APIs and no imports: the guide, the gameplay card and the build
 * panel all read it.
 *
 * Two conventions hold everywhere a sentence is generated:
 *  - a command is written between backticks, `like this`, and nowhere else: the window turns each into a line with
 *    a copy button, and the guide's markdown shows it as code. Everything outside the backticks is plain words.
 *  - an AI's own words (a gameplay's description, a reviewer's finding, a maker's reason) are written in plain words to begin with (the
 *    prompts and tools ask for that, with the technical detail in a part of its own). What still reaches a person with code in it (an older record, a
 *    tool's message) goes through `plainWords` (a game event is said as when it happens) and is then shown with its identifiers as code-styled
 *    tokens (`sayPieces`), or, when it is mostly code, kept for 高级 (`splitForPerson`). A placeholder is never put in the middle of a sentence:
 *    it cost the sentence its meaning (round 18: 「找不到类 游戏里的某个时刻」).
 */

/** The one sentence that says how to type a command in the game. */
export const TYPE_COMMAND = "按 T 打开聊天框，把这一行粘贴进去，再按回车"

/** A command as it is written into a sentence. */
export const command = (text: string) => `\`${text}\``

/** 「按 T 打开聊天框，粘贴 `…` 再按回车」: a command with how to type it, inside a longer sentence. */
export const typeIn = (text: string) => `按 T 打开聊天框，粘贴 ${command(text)} 再按回车`

/** A sentence cut at its commands: `command` is set on the pieces that are one. */
export function commandPieces(text: string): { text: string; command?: true }[] {
  return text
    .split(/(`[^`\n]+`)/)
    .filter((piece) => piece.length)
    .map((piece) => (piece.length > 2 && piece.startsWith("`") && piece.endsWith("`") ? { text: piece.slice(1, -1), command: true as const } : { text: piece }))
}

/** The sentence without its commands' backticks, for a place that cannot make them a line of their own. */
export const withoutMarks = (text: string) => text.replaceAll("`", "")

/**
 * What sets off one of a creature's rules (the three kinds `content.ts` offers), said as when it happens. `item` is the thing the player holds, already said by name.
 * One table, so a new kind of trigger cannot be added without its words (the type fails).
 */
export const TRIGGER_WORDS: Record<"hurt" | "player_near" | "holding_item", (item: string) => string> = {
  hurt: () => "被打的时候",
  player_near: () => "有玩家走到 8 格以内的时候",
  holding_item: (item) => `有玩家拿着${item}走到 8 格以内的时候`,
}

/**
 * When the game itself does something, said the way a player would. Each row is a way the game names such a moment
 * (the part after the dot is enough: an AI may write it with or without the class in front) and what a player sees of it.
 * One table, so the same moment is said the same way in the guide, on the card and in a finding.
 */
export const EVENT_WORDS: readonly (readonly [RegExp, string])[] = [
  [/(?:\w+\.)?END_(?:WORLD|SERVER)_TICK/, "游戏每走一小步（每秒 20 次）的时候"],
  [/(?:\w+\.)?START_(?:WORLD|SERVER)_TICK/, "游戏每走一小步开始的时候"],
  [/(?:\w+\.)?END_CLIENT_TICK/, "你的游戏每走一小步的时候"],
  [/(?:\w+\.)?START_CLIENT_TICK/, "你的游戏每走一小步开始的时候"],
  [/(?:\w+\.)?CHUNK_GENERATE/, "一块新的地图刚生成出来的时候"],
  [/(?:\w+\.)?CHUNK_LOAD/, "一块地图载入进来的时候"],
  [/(?:\w+\.)?CHUNK_UNLOAD/, "一块地图离开视野被收起来的时候"],
  [/(?:\w+\.)?BLOCK_ENTITY_LOAD/, "箱子、熔炉这类带内容的方块载入的时候"],
  [/(?:\w+\.)?BLOCK_ENTITY_UNLOAD/, "箱子、熔炉这类带内容的方块被收起来的时候"],
  [/(?:\w+\.)?ENTITY_LOAD/, "一个生物或掉落物进入世界的时候"],
  [/(?:\w+\.)?ENTITY_UNLOAD/, "一个生物或掉落物离开世界的时候"],
  [/(?:\w+\.)?SERVER_STARTING/, "世界刚开始启动的时候"],
  [/(?:\w+\.)?SERVER_STARTED/, "世界启动完成以后"],
  [/(?:\w+\.)?SERVER_STOPPING/, "世界要关闭的时候"],
  [/(?:\w+\.)?SERVER_STOPPED/, "世界关闭以后"],
  [/(?:\w+\.)?AFTER_DEATH/, "生物死掉以后"],
  [/(?:\w+\.)?ALLOW_DEATH/, "生物快要死掉的时候"],
  [/(?:\w+\.)?ALLOW_DAMAGE/, "生物受伤之前"],
  [/(?:\w+\.)?AFTER_DAMAGE/, "生物受伤以后"],
  [/ServerPlayConnectionEvents\.JOIN|ClientPlayConnectionEvents\.JOIN/, "玩家进入世界的时候"],
  [/ServerPlayConnectionEvents\.DISCONNECT|ClientPlayConnectionEvents\.DISCONNECT/, "玩家离开世界的时候"],
  [/PlayerBlockBreakEvents\.AFTER/, "玩家挖掉一个方块以后"],
  [/PlayerBlockBreakEvents\.BEFORE/, "玩家挖掉一个方块之前"],
  [/PlayerBlockBreakEvents\.CANCELED/, "玩家挖方块被拦下的时候"],
  [/UseBlockCallback(?:\.EVENT)?/, "玩家右键一个方块的时候"],
  [/UseItemCallback(?:\.EVENT)?/, "玩家拿着东西右键的时候"],
  [/UseEntityCallback(?:\.EVENT)?/, "玩家右键一个生物的时候"],
  [/AttackEntityCallback(?:\.EVENT)?/, "玩家攻击一个生物的时候"],
  [/AttackBlockCallback(?:\.EVENT)?/, "玩家开始挖一个方块的时候"],
]

/**
 * Names that are written in capitals-and-lowercase like a class name but are product names a person knows: words, not code.
 * Anything else written as two or more capitalised words run together (`SpawnRestriction`, `ProjectContent`, `HabitAlertGoal`) is a class name:
 * a person has never met it, and it is how an AI quotes the code (round 18).
 */
export const PRODUCT_NAMES: ReadonlySet<string> = new Set(["GeckoLib", "MineMods", "MineMods Studio", "BlockBench", "CurseForge", "NeoForge", "JavaScript", "TypeScript", "GitHub", "OpenAI", "ChatGPT", "PowerShell", "YouTube", "OneDrive", "IntelliJ", "PlayStation", "OptiFine", "FabricMC"])

/**
 * What reads as a piece of code in words meant for a person: an event or constant (`END_WORLD_TICK`), a name with a dot
 * and a call (`world.getTopY(...)`, `Main::tick`), a camelCase name or a call (`getTopY`, `tick()`), a snake_case name
 * (`moon_dew`, `minecraft:iron_ingot`), a class name (`HabitAlertGoal`), a class written with its package (`java.net.Socket`) and a Java source file (`Main.java`).
 * A file name a person must find (`xxx.jar`, `模组说明.md`) is not code either.
 */
export const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/,
  /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*::[A-Za-z_]\w*/,
  /\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\(/,
  /\b[A-Z][A-Za-z0-9]*(?:Events?|Callback|Manager|Registry|Handler|Listener)\b/,
  /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/,
  /\b[A-Za-z_]\w*\(\)/,
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/,
  /\b[a-z][a-z0-9_]*:[a-z][a-z0-9_/]*\b/,
  // Two or more capitalised words run together: a class name, unless it is a product name (filtered where the matches are read).
  /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/,
  // A class written with its package (`java.net.Socket`, `net.minecraft.world.World`): lower-case words joined by dots, ending in a capitalised class name.
  /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+\.[A-Z][A-Za-z0-9]*\b/,
  // A source file of the code, which a person never has to find (unlike the .jar they run).
  /\b[A-Za-z_]\w*\.(?:java|class|gradle)\b/,
]
const FILE_NAME = /[\w.-]+\.(?:jar|md|bbmodel|json|png)\b/g

/** The text with everything that is not a candidate for code blanked to spaces (same length, so positions carry over): commands, 「names」 and file names a person knows. */
const masked = (text: string) => text.replace(/`[^`\n]*`/g, (found) => " ".repeat(found.length)).replace(/「[^」\n]*」/g, (found) => " ".repeat(found.length)).replace(FILE_NAME, (found) => " ".repeat(found.length))

/**
 * Where the pieces of code stand in a text (`start` to `end`, in order): every pattern's matches, a call taken through its closing bracket, and
 * touching pieces joined (`ServerTickEvents.END_WORLD_TICK` is one name, not two). Product names are not code.
 */
function codeSpans(text: string): { start: number; end: number }[] {
  const rest = masked(text)
  const found = IDENTIFIER_PATTERNS.flatMap((pattern) =>
    [...rest.matchAll(new RegExp(pattern.source, "g"))]
      .filter((match) => !PRODUCT_NAMES.has(match[0]))
      .map((match) => {
        const start = match.index
        let end = start + match[0].length
        // A call is the name and its arguments: followed to the bracket that closes it, on the same line.
        if (match[0].endsWith("(")) {
          const level = { depth: 1 }
          let at = end
          while (at < rest.length && rest[at] !== "\n" && level.depth > 0) {
            if (rest[at] === "(") level.depth += 1
            if (rest[at] === ")") level.depth -= 1
            at += 1
          }
          if (level.depth === 0) end = at
        }
        return { start, end }
      }),
  )
  const joined: { start: number; end: number }[] = []
  for (const span of found.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = joined.at(-1)
    // Overlapping, or only a dot, `::` or `()` apart: the same name.
    if (last && (span.start <= last.end || /^(?:\.|::|\(\))$/.test(rest.slice(last.end, span.start)))) last.end = Math.max(last.end, span.end)
    else joined.push({ ...span })
  }
  return joined
}

/** The pieces of code left in a sentence once its commands (between backticks) and file names are taken out; empty when it is all words. */
export function identifiersIn(text: string): string[] {
  return codeSpans(text).map((span) => text.slice(span.start, span.end))
}

/**
 * A description an AI wrote, made safe to read: a game event it named becomes what a player sees of that moment. Nothing else is
 * replaced: a name that is not a known moment stays in the sentence exactly as written, so the sentence keeps its meaning
 * (`sayPieces` then shows it as code, and `splitForPerson` moves a sentence that is mostly code under 高级). Commands between backticks are left as they are.
 */
export function plainWords(text: string): string {
  return text
    .split(/(`[^`\n]*`)/)
    .map((piece) => {
      if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 1) return piece
      return EVENT_WORDS.reduce((words, [pattern, said]) => words.replace(new RegExp(`(?:\\b[A-Z][A-Za-z]*\\.)?${pattern.source}`, "g"), said), piece)
    })
    .join("")
}

/**
 * An AI's description as it goes into the mod guide, the handout a player who never made the mod reads. Unlike a card in Studio the handout has no 高级
 * view to keep a name in and no token styling in its markdown, so a name that is not a known moment cannot stay in it: it becomes a plain
 * "某个部分", and a bracket holding only code goes. The sentence keeps its claim around the gap; the original stays in the saved description.
 */
export function handoutWords(text: string): string {
  return text
    .split(/(`[^`\n]*`)/)
    .map((piece) => {
      if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 1) return piece
      const words = plainWords(piece.replace(/（([^（）「」]{1,60})）/g, (whole, inner: string) => (!/[一-鿿]/.test(inner) && identifiersIn(inner).length ? "" : whole)))
      const spans = codeSpans(words)
      return spans.reduceRight((rest, span) => rest.slice(0, span.start) + "游戏里的某个部分" + rest.slice(span.end), words)
    })
    .join("")
}

/** A sentence cut for showing: plain words, a command (a line of its own with a copy button), or a piece of code (an inline token). */
export type SaidPiece = { text: string; command?: true; code?: true }

/** The sentence as `plainWords` says it (or as written, with `events` off, for 高级), cut into its words, its commands and its pieces of code, so a window can set each in its own way. */
export function sayPieces(text: string, events = true): SaidPiece[] {
  return commandPieces(events ? plainWords(text) : text).flatMap((piece): SaidPiece[] => {
    if (piece.command) return [piece]
    const spans = codeSpans(piece.text)
    const cut = spans.flatMap((span, index) => [...(span.start > (spans[index - 1]?.end ?? 0) ? [{ text: piece.text.slice(spans[index - 1]?.end ?? 0, span.start) }] : []), { text: piece.text.slice(span.start, span.end), code: true as const }])
    const after = spans.at(-1)?.end ?? 0
    return [...cut, ...(after < piece.text.length || !spans.length ? [{ text: piece.text.slice(after) }] : [])].filter((value) => value.text.length)
  })
}

/**
 * Whether a sentence is code with a few words around it, which a person cannot read as a sentence. It has a piece of code in it and fewer than
 * three Chinese characters for every Latin word (a piece of code counts as one word, however long). A Chinese word is about two characters, so at that
 * ratio more than a third of the sentence's words are Latin: it is a developer's note ("…schema和compileModel，但MCP look…"), and there is no claim around the
 * names that a person could use. Above it the Chinese carries the claim and the code is a name inside it, which `sayPieces` sets as a token; below it the
 * sentence belongs under 高级.
 */
export function mostlyCode(text: string): boolean {
  const words = masked(plainWords(text))
  const spans = codeSpans(words)
  if (!spans.length) return false
  const outside = spans.reduce((rest, span) => rest.slice(0, span.start) + " ".repeat(span.end - span.start) + rest.slice(span.end), words)
  const latin = spans.length + (outside.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []).length
  const chinese = (outside.match(/[\u4e00-\u9fff]/g) ?? []).length
  return chinese < 3 * latin
}

/** What stands in the normal view where lines were kept for 高级. */
export const technicalHidden = (count: number) => `另有 ${count} 条是写给懂代码的人看的技术说明，打开「高级」能看到原文。`

/**
 * Lines an AI or a tool wrote, divided for a person: `shown` are the lines to read (a game event said as when it happens, any other name left in the
 * sentence), `technical` are the lines that are mostly code, as written, for 高级. Their order is kept within each.
 */
export function splitForPerson(lines: readonly string[]): { shown: string[]; technical: string[] } {
  const technical = lines.filter((line) => mostlyCode(line))
  return { shown: lines.filter((line) => !mostlyCode(line)).map(plainWords), technical }
}

/**
 * A finding of the machine check as a person reads it: the text and what to do were written for the person and for whoever fixes the file, so they
 * name the field in brackets after the plain words (「…的最远距离（start.max_distance）」). The plain words stay; a bracket holding only such a name goes.
 */
export const plainFix = (text: string) => plainWords(text).replace(/（[\x20-\x7e]+）/g, "")
