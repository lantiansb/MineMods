import path from "node:path"
import { RELEASE_DEFAULTS } from "../release"
import type { JavaHomes, Toolchain } from "./toolchain"

/** The jar a build of this version of a mod is called: `<mod id>-<version>.jar`, as `release.ts`'s `jarName`. */
export const builtJarPath = (projectDirectory: string, mod: { modId: string; version?: string }) =>
  path.join(projectDirectory, "build", "libs", `${mod.modId}-${mod.version ?? RELEASE_DEFAULTS.version}.jar`)

/** The JDK of each major, or a refusal naming the first missing one. */
export function requireJavaHomes(toolchain: Pick<Toolchain, "javaMajors">, javaHomes: JavaHomes) {
  return toolchain.javaMajors.map((major) => {
    const home = javaHomes.get(major)
    if (!home || !path.isAbsolute(home)) throw new Error(`JAVA_${major}_REQUIRED`)
    return { major, home }
  })
}
