import { z } from "zod"
import { BlockbenchImportError } from "@minemods/mod-core/blockbench"

const PART_WORDS: Record<string, string> = { elements: "方块", outliner: "骨骼", groups: "骨骼", textures: "贴图", animations: "动作", resolution: "贴图尺寸" }

/** Which part of the file a malformed record belongs to, in the person's words: "第 3 个方块" rather than `elements.2.from`. */
function whereInFile(path: readonly PropertyKey[]) {
  const part = typeof path[0] === "string" ? PART_WORDS[path[0]] : undefined
  if (!part) return "文件里有些记录"
  return typeof path[1] === "number" ? `第 ${path[1] + 1} 个${part.replace("骨骼", "骨骼（组）")}` : part
}

/**
 * What to tell a person whose .bbmodel could not be taken in.
 *
 * Importing runs two steps in mod-core (reading the file into a design, then checking the design still describes the
 * file). Each refuses with a code or with words of its own; the generic "操作未完成" line must never be what a person sees
 * for a file they can fix, so this turns each refusal into a sentence that names the group or box at fault.
 *
 * Returns `{ words }` when the refusal can be said here, `{ code }` when it is a plain `MODEL_*` code that arrived with a
 * detail after a colon (the service's table of sentences knows the bare code only), and null for anything else.
 */
export function modelImportFailure(error: unknown): { words: string } | { code: string } | null {
  if (error instanceof BlockbenchImportError) return { words: error.message }
  if (!(error instanceof Error)) return null
  // The saved-model check reads the file with its own schema; a record missing something it needs is named by where it sits.
  if (error instanceof z.ZodError) return { words: `这个模型文件的格式不完整：${whereInFile(error.issues[0]?.path ?? [])}缺了必要的内容。请在 Blockbench 里重新保存这个文件，再导入。` }
  const [code, ...rest] = error.message.split(":")
  if (code === "MODEL_HIERARCHY_DESIGN_MISMATCH") {
    const [kind, ...name] = rest.join(":").split(":")
    const group = name.join(":")
    const what =
      kind === "bone"
        ? `骨骼「${group}」在文件里有，可是 Studio 记下的骨骼表里找不到对应的那一根。`
        : kind === "parent"
          ? `骨骼「${group}」挂在哪一根骨骼下面，文件里和 Studio 记下的不一样。`
          : kind === "cubes"
            ? `骨骼「${group}」里的方块个数，文件里和 Studio 记下的不一样。`
            : "Studio 记下的骨骼个数和文件里的不一样。"
    return { words: `这个模型的骨骼没有对上：${what}已有模型保持不变。请在 Blockbench 里重新保存这个文件再导入一次；如果还是这样，请把这句话告诉开发者。` }
  }
  if (code && code.startsWith("MODEL_") && rest.length) return { code }
  return null
}
