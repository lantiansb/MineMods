import type { Project } from "./project"
import { motionKnown } from "@minemods/studio-ai/making"
import { VANILLA_ITEM_NAMES } from "./fabric/content-vanilla"
import { mostlyCode, plainWords, sayPieces } from "./play-words"

/** Resolve the document's references once for a visible page. Two models can use the same bone or motion name. */
export function creatorWords(project: Project, modelId?: string | null, parts?: readonly {name: string; what: string}[]) {
  const names = new Map<string, string>()
  for (const item of [...project.items, ...project.blocks]) {
    names.set(item.identifier, item.name)
    names.set(project.mod_id + ":" + item.identifier, item.name)
  }
  for (const asset of project.workspace.assets) {
    names.set(asset.id, asset.title)
    const doc = asset.document
    if (doc.kind === "entity" && (!modelId || doc.model_asset_id === modelId)) {
      for (const move of [...doc.abilities ?? [], ...doc.combos ?? []]) names.set(move.id, move.name)
    }
    if (modelId && asset.id === modelId && doc.kind === "model") {
      const parts: Record<string, string> = {root:"整体", head:"头部", body:"身体", leg_r:"右腿", leg_l:"左腿", arm_right:"右臂", arm_left:"左臂"}
      doc.bones.forEach((bone, index) => names.set(bone.name, parts[bone.name] ?? "第 " + (index + 1) + " 个部件"))
    }
    if (doc.kind === "animation" && asset.dependencies.includes(modelId ?? "") && /[一-龥]/.test(asset.title)) names.set(doc.name, asset.title)
  }
  const model=project.workspace.assets.find(asset=>asset.id===modelId)?.document
  // (`?? []`: a model document saved by hand, or an older one, may carry no list of motions; naming things must never throw over it.)
  if(model?.kind==="model") for(const clip of model.animations ?? []) if(clip.display_name) names.set(clip.name,clip.display_name)
  for (const part of parts ?? []) if (part.what) names.set(part.name, part.what)
  const translate = (text: string, advanced: boolean) => {
    const resolved = plainWords(text).replace(/minecraft:[a-z0-9_./-]+|[a-z][a-z0-9_]*:[a-z0-9_./-]+|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}|\b[a-z][a-z\d_]*\b/gi, id => {
      const name = names.get(id) ?? (id.startsWith("minecraft:") ? VANILLA_ITEM_NAMES[id.slice(10)] : undefined) ?? motionKnown(id)
      return name && name !== id ? (advanced ? name + "（" + id + "）" : name) : id
    })
    if (advanced) return resolved
    // r29c: a name the game knows a thing of this mod by (`<mod_id>:name`, what /summon and /give take) that nothing here names is kept as it is: a clash of two such
    // names was said as 「指定的部分」 and the person could not find it. It is set aside while the code is hidden, so a game command around it is still hidden whole.
    const own: string[] = []
    const marked = resolved.replace(ownName, (name) => `\uE000${own.push(name) - 1}\uE001`)
    return sayPieces(marked).map(piece => {
      if (piece.command) return "游戏指令（见高级）"
      if (piece.code) return "指定的部分"
      return piece.text
    }).join("").replace(/「[a-z][a-z0-9_.:-]*」/g, "指定的部分").replace(/\uE000(\d+)\uE001/g, (_, index: string) => own[Number(index)]!)
  }
  const ownName = new RegExp(`\\b${project.mod_id}:[a-z0-9_./-]+`, "g")

  // Keep identifiers and quoted paths from build diagnostics intact, including the arguments of a shell command.
  const diagnostic = /(\x60(?!\/)[^\x60\r\n]+\x60|「(?:[A-Za-z]:[\\/]|\\\\|\/)[^」\r\n]+」|"(?:(?:[A-Za-z]:[\\/]|\\\\|\/)[^"\r\n]+)"|(?:[A-Za-z]:[\\/]|\\\\)[^\s。，、；」]+|\b(?:[A-Z][A-Z0-9_]*_HOME|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|PATH|CLASSPATH|JAVA_OPTS|GRADLE_OPTS)\b)/g
  return (text: string, advanced = false) => text.split(diagnostic).map((part, index) => index % 2 ? part : translate(part, advanced)).join("")
}

/** Generator findings also carry the technical repair instructions for an outside AI. */
export function buildWordsForCreator(project: Project, findings: readonly {text: string; fix: string}[]) {
  const say = creatorWords(project)
  return findings.map(issue => {
    const words = say(issue.text).replace(/（[a-z][a-z0-9_.,: ]*）/gi, "")
    const fix = say(issue.fix)
    return words + (/\b(?:bone|clip|seconds|abilities|combos|gesture|null|true|false|effect|texture|asset|id)\b/i.test(fix)
      ? "请让 AI 改好这样东西，再打包。"
      : fix)
  }).join("\n")
}

export function briefForCreator(brief: string) {
  if (/^[（(]?协调方转述/.test(brief.trim())) return ""
  const lines = brief.split(/(?<=[。；;！？])|\n/)
  return lines.flatMap(line => {
    const text = plainWords(line.trim())
      .replace(/(?:^|[，,：:\s])(?:background\s+["']|fill\s+#|drain\s+(?:left|right)|max_stack\s+\d|tool\s*\{|shaped\b|bar\.look\b|justified\b).*$/i, "")
      .trim()
    if (!text || /[{}]|"id" *:|请用户|协调方转述/.test(text) || mostlyCode(text) || !/[一-龥]/.test(text)) return []
    return [text.replace(/[a-z][\w.-]*（([^（）]*[一-龥][^（）]*)）/gi, "$1")]
  }).join("")
}
