import { findTargetManifest } from "./target/manifests"

/** One game version × mod loader, and whether Studio can really make a mod for it now (and if not, why, in plain words). */
export type GameTarget = {
  id: string
  minecraft: string
  loader: "fabric" | "forge" | "neoforge" | "quilt"
  loaderVersion: string | null
  java: number
  ready: boolean
  why: string | null
}

export const DEFAULT_TARGET = "fabric-1.21.1"

const notYet = "这个组合 Studio 还生成不了代码：还没有为它写好并在游戏里验证过生成模板。"

// The Java each game release itself requires: 1.20.5 moved to Java 21, 1.18 to Java 17, 1.17 to Java 16; older ones run on Java 8.
function javaFor(minecraft: string) {
  const [, minor = 0, patch = 0] = minecraft.split(".").map(Number)
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21
  if (minor >= 18) return 17
  if (minor === 17) return 16
  return 8
}

// Which loaders exist for each listed release: Fabric from 1.14 (so not 1.12.2), Quilt from 1.18.2, NeoForge from
// 1.20.1 (that one is its first release, forked from Forge), Forge for all of them.
const releases: [string, GameTarget["loader"][]][] = [
  ["1.21.1", ["fabric", "forge", "neoforge", "quilt"]],
  ["1.21.4", ["fabric", "forge", "neoforge", "quilt"]],
  ["1.20.6", ["fabric", "forge", "neoforge", "quilt"]],
  ["1.20.4", ["fabric", "forge", "neoforge", "quilt"]],
  ["1.20.1", ["fabric", "forge", "neoforge", "quilt"]],
  ["1.19.2", ["fabric", "forge", "quilt"]],
  ["1.18.2", ["fabric", "forge", "quilt"]],
  ["1.16.5", ["fabric", "forge"]],
  ["1.12.2", ["forge"]],
]

/**
 * The catalogue is static on purpose: a project is created without the network, and a combination becomes ready only
 * when its generator, build and test scene have been verified in the real game, which is a change to its manifest.
 */
export const TARGETS: readonly GameTarget[] = releases.flatMap(([minecraft, loaders]) =>
  loaders.map((loader): GameTarget => {
    const id = `${loader}-${minecraft}`
    // A combination with a manifest has its versions pinned and checked; its own words say why it is not ready yet.
    const manifest = findTargetManifest(id)
    return {
      id,
      minecraft,
      loader,
      loaderVersion: manifest?.loader.version ?? null,
      java: manifest?.java.major ?? javaFor(minecraft),
      ready: manifest?.ready ?? false,
      why: manifest ? manifest.why : notYet,
    }
  }),
)

export function targetById(id: string): GameTarget | undefined {
  return TARGETS.find((target) => target.id === id)
}
