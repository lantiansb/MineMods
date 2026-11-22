import { BuildStop } from "./build-stop"
import type { FindingTarget } from "./reconcile"

/**
 * A build that stops on one thing of the project throws a code and the id of that thing (`SAVED_MODEL_REQUIRED:<id>`). The code alone was
 * mapped to a plain sentence, but with the id after it the message matched nothing, and the person read the generic 「操作未完成」 for a
 * problem the build knew exactly: which creature has no model. Here the code and the id are split, and the sentence names the thing.
 */
export type CodedThing = { kind: "entity" | "gameplay"; name: string }

/** `say` is given who it is about, already worded: 「苔叶鹿」, or "有一个生物" when the project cannot say which. */
type Words = { thing: CodedThing["kind"]; say: (who: string) => string }

/**
 * The codes of the generator layer whose payload is not the id of a thing but the very name that clashed (a file, a text key, a template file): the sentence is given that name. Before, each of these
 * matched nothing, and whoever was building was told only that the operation had not finished.
 */
const LOOSE: Readonly<Record<string, (detail: string) => string>> = {
  GAMEPLAY_FILE_CONFLICT: (file) => `两段玩法写了同一个文件（${file}，大小写不算），所以没有打包。让 AI 把其中一段玩法的文件换个名字，再打包。`,
  GAMEPLAY_TEXT_CONFLICT: (key) => `两段玩法用了同一个文字的名字（${key}），所以没有打包。让 AI 把其中一段玩法的这个名字改掉，再打包。`,
  GESTURE_KEY_CONFLICT: () => "两个手势动作用了同一个触发的按键，所以没有打包。打开其中一个手势，换一个不一样的键，再打包。",
  GESTURE_TEMPLATE_ANCHOR_MISSING: (file) => `Studio 自带的模板文件（${file}）和手势要改它的地方对不上，所以没有打包。这不是你做的内容有问题；请把这句话原样反馈给我们。`,
}

const WORDS: Readonly<Record<string, Words>> = {
  SAVED_MODEL_REQUIRED: { thing: "entity", say: (who) => `${who}还没有模型，所以没有打包：生物要先有模型才能做进模组。打开它的卡片，让 AI 给它做模型，或者自己做一个，再打包。` },
  ENTITY_LOOT_UNKNOWN_ITEM: { thing: "entity", say: (who) => `${who}掉落里有一样东西，在这个模组里已经找不到了（可能被删掉了），所以没有打包。打开它，把那一项改掉或者去掉，再打包。` },
  ENTITY_TEMPT_UNKNOWN_ITEM: { thing: "entity", say: (who) => `${who}会被一样东西吸引，那样东西在这个模组里已经找不到了（可能被删掉了），所以没有打包。打开它，改掉或者去掉那一项，再打包。` },
  ENTITY_LAIR_UNKNOWN_BLOCK: { thing: "entity", say: (who) => `${who}的巢穴地面用的方块，在这个模组里已经找不到了（可能被删掉了），所以没有打包。打开它，改掉或者去掉那一项，再打包。` },
  ENTITY_STRUCTURE_UNKNOWN: { thing: "entity", say: (who) => `${who}要守在一只 Boss 的巢边上（spawn.near 或 garrison），可是那只 Boss 在这个模组里找不到了，或者它已经没有巢，所以没有打包。打开它，改掉或者去掉那一项，再打包。` },
  ENTITY_EFFECT_MISSING: { thing: "entity", say: (who) => `${who}的技能用到一个特效，它已经不在工程里了，所以没有打包。打开它，换一个特效或者去掉那个技能，再打包。` },
  ENTITY_PARTICLE_MISSING: { thing: "entity", say: (who) => `${who}的技能用到一个自己做的粒子，它已经不在工程里了，所以没有打包。打开它，换一个粒子或者去掉那个技能，再打包。` },
  INVALID_ENTITY_TEXTURE: { thing: "entity", say: (who) => `${who}用的贴图找不到了，或者那不是一张贴图，所以没有打包。打开它，重新给它一张贴图，再打包。` },
  ENTITY_TEXTURE_DIMENSIONS: { thing: "entity", say: (who) => `${who}的贴图大小和它的模型对不上，所以没有打包。让 AI 重新画一张合适大小的贴图，再打包。` },
  GAMEPLAY_SLUG_CONFLICT: { thing: "gameplay", say: (who) => `${who}和另一段玩法用了同一个代号（slug），所以没有打包。让 AI 把其中一段的代号改成不一样的，再打包。` },
  GAMEPLAY_OUT_OF_BOUNDS: { thing: "gameplay", say: (who) => `${who}的代码在检查里越过了允许碰的范围，所以没有打包。让 AI 改一版，再打包。` },
  GAMEPLAY_BROKEN_REFERENCE: { thing: "gameplay", say: (who) => `${who}的代码里有引用对不上工程里的东西，所以没有打包。让 AI 改一版，再打包。` },
}

/** The code and the name out of a message like `GAMEPLAY_FILE_CONFLICT:<file>`; null for any other message. */
const looseParts = (message: string) => {
  const found = /^([A-Z][A-Z0-9_]+):(.{1,200})$/s.exec(message)
  return found && Object.hasOwn(LOOSE, found[1]!) ? { code: found[1]!, detail: found[2]! } : null
}

/** The code and the id out of a message like `SAVED_MODEL_REQUIRED:<uuid>`; null for any other message. */
export function codedParts(message: string) {
  if (looseParts(message)) return null
  const found = /^([A-Z][A-Z0-9_]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(message)
  return found && Object.hasOwn(WORDS, found[1]!) ? { code: found[1]!, id: found[2]! } : null
}

/**
 * The plain sentence for a coded message, naming the thing when `find` knows it (it reads the project), and the way to its card as a
 * finding target (`FindingTarget`, with no field: the card itself is the place). Null when the message is not one of these.
 */
export function codedWords(message: string, find: (id: string, kind: CodedThing["kind"]) => CodedThing | null): { text: string; target: FindingTarget | null } | null {
  const loose = looseParts(message)
  if (loose) return { text: LOOSE[loose.code]!(loose.detail), target: null }
  const parts = codedParts(message)
  if (!parts) return null
  const words = WORDS[parts.code]!
  const thing = find(parts.id, words.thing)
  return {
    text: words.say(thing ? (words.thing === "entity" ? `「${thing.name}」` : `玩法「${thing.name}」`) : words.thing === "entity" ? "有一个生物" : "有一段玩法"),
    target: thing ? { about: { kind: thing.kind, id: parts.id, name: thing.name }, field: "", label: `打开「${thing.name}」` } : null,
  }
}

/**
 * The sentence for any stop of the generator layer: a `BuildStop` says its own words; a coded message (`codedWords`) is worded with the name of the thing in `project`. Null for any other failure, whose message is
 * never shown (it may carry a key or a private path). Read by whoever must tell the person and an outside AI why the project could not be put together, so both get the same sentence.
 */
export function stopWords(error: unknown, project: { entities: readonly { id: string; name: string }[]; workspace: { assets: readonly { id: string; title: string }[] } }): string | null {
  if (error instanceof BuildStop) return error.message
  if (!(error instanceof Error)) return null
  return (
    codedWords(error.message, (id, kind) => {
      if (kind === "entity") return project.entities.filter((entity) => entity.id === id).map((entity) => ({ kind, name: entity.name }))[0] ?? null
      return project.workspace.assets.filter((asset) => asset.id === id).map((asset) => ({ kind, name: asset.title }))[0] ?? null
    })?.text ?? null
  )
}
