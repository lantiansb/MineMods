/**
 * Where a file can come from besides its official address. A mirror is a rewrite rule, never a separate list of
 * files: the manifest keeps the official address and the hash, and whatever a mirror sends is kept only if it hashes
 * the same. Mirrors are tried first (the person chose 镜像优先); the official address is always the last try.
 *
 * Checked 2026-11-14:
 * - BMCLAPI (bmclapi2.bangbang93.com) serves Mojang's version files, game jars and asset objects, and Maven
 *   libraries for Mojang, Forge, NeoForge and Fabric under `/maven/`. It redirects to volunteer nodes; some ignore
 *   Range, and the main host now and then sends nothing at all, so a source that stalls is left for the next one.
 *   It answers HEAD with 403 and wants a User-Agent.
 * - TUNA (mirrors.tuna.tsinghua.edu.cn/Adoptium) keeps only the newest build of each Java line, so an older pinned
 *   build is often missing there (404) and comes from Adoptium itself.
 * - Tencent (mirrors.cloud.tencent.com/gradle) keeps the Gradle distributions.
 */
export type SourceId = "bmclapi" | "tuna" | "tencent" | "official"

type Rule = { source: Exclude<SourceId, "official">; from: string; to: string }

const BMCLAPI = "https://bmclapi2.bangbang93.com"

const RULES: readonly Rule[] = [
  { source: "bmclapi", from: "https://piston-meta.mojang.com/", to: `${BMCLAPI}/` },
  { source: "bmclapi", from: "https://piston-data.mojang.com/", to: `${BMCLAPI}/` },
  { source: "bmclapi", from: "https://launchermeta.mojang.com/", to: `${BMCLAPI}/` },
  { source: "bmclapi", from: "https://launcher.mojang.com/", to: `${BMCLAPI}/` },
  { source: "bmclapi", from: "https://resources.download.minecraft.net/", to: `${BMCLAPI}/assets/` },
  { source: "bmclapi", from: "https://libraries.minecraft.net/", to: `${BMCLAPI}/maven/` },
  { source: "bmclapi", from: "https://maven.minecraftforge.net/", to: `${BMCLAPI}/maven/` },
  { source: "bmclapi", from: "https://maven.neoforged.net/releases/", to: `${BMCLAPI}/maven/` },
  { source: "bmclapi", from: "https://maven.fabricmc.net/", to: `${BMCLAPI}/maven/` },
  { source: "tencent", from: "https://services.gradle.org/distributions/", to: "https://mirrors.cloud.tencent.com/gradle/" },
]

// Adoptium's GitHub releases: …/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_windows_hotspot_17.0.21_9.zip
const ADOPTIUM = /^https:\/\/github\.com\/adoptium\/temurin(\d+)-binaries\/releases\/download\/[^/]+\/(OpenJDK\d+U-jdk_x64_windows_hotspot_[^/]+\.zip)$/

export type Candidate = { source: SourceId; url: string }

/** Every address to try for one file, mirrors first, the official one last; each address once. */
export function candidates(officialUrl: string, options: { mirrors?: boolean } = {}): Candidate[] {
  const mirrored: Candidate[] = []
  if (options.mirrors !== false) {
    for (const rule of RULES) if (officialUrl.startsWith(rule.from)) mirrored.push({ source: rule.source, url: rule.to + officialUrl.slice(rule.from.length) })
    const jdk = ADOPTIUM.exec(officialUrl)
    if (jdk) mirrored.push({ source: "tuna", url: `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${jdk[1]}/jdk/x64/windows/${jdk[2]}` })
  }
  const all = [...mirrored, { source: "official" as const, url: officialUrl }]
  return all.filter((candidate, index) => all.findIndex((other) => other.url === candidate.url) === index)
}

/** Plain words for the person: where a file came from. */
export const SOURCE_NAMES: Record<SourceId, string> = {
  bmclapi: "BMCLAPI 镜像",
  tuna: "清华大学镜像",
  tencent: "腾讯云镜像",
  official: "官方地址",
}
