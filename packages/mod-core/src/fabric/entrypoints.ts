import { z } from "zod"
import { constructorIssue, stripJava } from "../gameplay-scan"

/**
 * The last check before a generated project goes to Gradle: every class the game will create by name can be
 * created. Fabric builds each class listed under `entrypoints` in fabric.mod.json with
 * `getDeclaredConstructor().newInstance()` and no `setAccessible`, so a class that is not public, is abstract,
 * or has a no-argument constructor that is not public compiles and then crashes the game at launch (this
 * happened with a generated mod). The generated boot code creates each gameplay's entry class with `new`, and
 * the same rule is applied to those.
 *
 * It is a reading of the source, not a compiler. What it does not see: an interface reached only through a
 * superclass or another interface (it wants the interface named after `implements`), an entry written as
 * `Class::member`, and a class nested in another. No generator writes any of the three; the first and the
 * third are refused, the second is passed over. No Node APIs.
 */

/** The interface Fabric casts each kind of entrypoint to. Other kinds (another mod's own) are only checked for being creatable. */
export const ENTRYPOINT_INTERFACES: Readonly<Record<string, string>> = { main: "net.fabricmc.api.ModInitializer", client: "net.fabricmc.api.ClientModInitializer", server: "net.fabricmc.api.DedicatedServerModInitializer" }

export type CreatedClass = {
  /** The class by its full name, as fabric.mod.json or the boot code names it. */
  class: string
  /** The interface it is used through, by its full name; null when nothing is known about that. */
  implements: string | null
  /** Who creates it: the game from fabric.mod.json, or Studio's boot code for a gameplay's entry (code an AI wrote). */
  by: "fabric" | "boot"
}

const Entrypoints = z.looseObject({ entrypoints: z.record(z.string(), z.array(z.union([z.string(), z.looseObject({ value: z.string() })]))).default({}) })

/** Every class fabric.mod.json asks the game to create. */
export function entrypointClasses(metadata: string): CreatedClass[] {
  return Object.entries(Entrypoints.parse(JSON.parse(metadata)).entrypoints).flatMap(([kind, values]) =>
    values
      .map((value) => (typeof value === "string" ? value : value.value))
      .filter((value) => !value.includes("::"))
      .map((value) => ({ class: value, implements: ENTRYPOINT_INTERFACES[kind] ?? null, by: "fabric" as const })),
  )
}

/** Where a class's source lies in a generated project. */
export const classFile = (name: string) => `src/main/java/${name.replaceAll(".", "/")}.java`

/** Why the game could not create this class, in plain words, or null when it can. `source` is the file at `classFile`, null when there is none. */
export function createdClassIssue(created: CreatedClass, source: string | null) {
  if (source === null) return `找不到它的源文件（${classFile(created.class)}）`
  const code = stripJava(source).code
  const name = created.class.split(".").at(-1)!
  const packageName = created.class.split(".").slice(0, -1).join(".")
  if (/^\s*package\s+([\w.\s]+);/.exec(code)?.[1]?.replace(/\s+/g, "") !== packageName) return `文件里写的包名不是 ${packageName}`
  const declared = new RegExp(`((?:\\b(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\\s+)*)(class|interface|enum|record)\\s+${name}\\b([^{]*)\\{`).exec(code)
  if (!declared) return `文件里没有名叫 ${name} 的类`
  const modifiers = declared[1]!.split(/\s+/)
  if (declared[2] !== "class") return "它不是一个普通的类（class），游戏没法创建它"
  if (!modifiers.includes("public")) return "它不是 public 的类"
  if (modifiers.includes("abstract")) return "它是 abstract 的，游戏没法创建它"
  const wanted = created.implements?.split(".").at(-1)
  if (wanted && !new RegExp(`\\bimplements\\b[^{]*(?<![\\w.])(?:${created.implements!.replaceAll(".", "\\.")}|${wanted})\\b`).test(declared[3]!)) return `它没有写 implements ${wanted}`
  const built = constructorIssue(code, name)
  if (built === "not_public") return "它的无参数构造方法不是 public 的"
  if (built === "needs_arguments") return "它的构造方法都带参数，缺一个 public 的无参数构造方法"
  return null
}

/** What the person is told when the build stops. The class is named in full so the sentence can be passed on as it is. */
export function createdClassWords(created: CreatedClass, issue: string) {
  return created.by === "fabric"
    ? `打包停下了：模组的启动类 ${created.class} 进了游戏会创建失败，游戏一启动就会崩溃——${issue}。这是 Studio 自己生成的代码出了问题，不是你做的内容有问题；请把这句话原样反馈给我们。`
    : `打包停下了：玩法的入口类 ${created.class} 进了游戏会创建失败，这个玩法启动不了——${issue}。这段玩法代码是 AI 写的：请让它把这个类改成 public 的类、构造方法不带参数并且是 public 的（或者不写构造方法），重新检查通过后再打包。`
}

/** Thrown by the build when a class the game creates cannot be created. The message is the plain sentence to show. */
export class EntrypointError extends Error {
  constructor(
    readonly created: CreatedClass,
    readonly issue: string,
  ) {
    super(createdClassWords(created, issue))
    this.name = "EntrypointError"
  }
}

/** Reads every class named and throws on the first that cannot be created. `read` answers null for a file that does not exist. */
export async function assertCreatable(classes: readonly CreatedClass[], read: (file: string) => Promise<string | null>) {
  const checked = await Promise.all(classes.map(async (created) => ({ created, issue: createdClassIssue(created, await read(classFile(created.class))) })))
  const failed = checked.find((entry) => entry.issue !== null)
  if (failed?.issue) throw new EntrypointError(failed.created, failed.issue)
  return checked.map((entry) => entry.created.class)
}
