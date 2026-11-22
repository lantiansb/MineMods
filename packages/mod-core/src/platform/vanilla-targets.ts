import { MISSING_ON_TARGET } from "./vanilla-targets-data"

/**
 * Why a vanilla item or item tag a project names (already held to Minecraft 1.21.1 and Fabric's convention tags by
 * `vanillaIssue`) cannot be written for this target, in plain words, or null when the target has it. A recipe that names
 * something the game does not have is dropped whole when the game loads; a tool's repair, never matched. The lists are
 * read out of each target's own jars (`script/vanilla-targets.ts`). A target with no list (Fabric 1.21.1) has everything.
 */
export function targetVanillaIssue(reference: string, targetId: string) {
  const missing = MISSING_ON_TARGET[targetId]
  if (!missing) return null
  const tag = reference.startsWith("#")
  const [namespace, name] = (tag ? reference.slice(1) : reference).split(":") as [string, string]
  if (tag && namespace === "c" && (missing.conventionTags === "all" || missing.conventionTags.includes(name)))
    return missing.conventionTags === "all"
      ? `${targetId} 没有通用标签 ${reference}（c: 开头的标签它都没有）。换成原版的标签（例如 #minecraft:planks），或者直接写物品 id。`
      : `${targetId} 没有通用标签 ${reference}。换成原版的标签（例如 #minecraft:planks），或者直接写物品 id。`
  if (tag && namespace === "minecraft" && missing.minecraftTags.includes(name)) return `${targetId} 的 Minecraft 里还没有物品标签 ${reference}。换成别的标签，或者直接写物品 id。`
  if (!tag && namespace === "minecraft" && missing.items.includes(name)) return `${targetId} 的 Minecraft 里还没有 ${reference} 这个物品（它是更新的版本才加的）。写错的原版物品会让这条配方在游戏里整条作废：换一样这个版本有的东西。`
  return null
}
