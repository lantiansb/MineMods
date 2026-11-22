import { BUILD_STAGES, buildStageWords } from "../build-stages"
import { resolveProfile } from "../fabric/profile"
import { fabricPlaceholders, scaffoldProject } from "../fabric/scaffold"
import { gradleWrapperArguments } from "../runtime"
import type { TargetManifest } from "../target/manifest"
import { builtJarPath, requireJavaHomes } from "./common"
import type { Toolchain } from "./toolchain"

/**
 * Fabric Loom: what Studio has always done, reached through the toolchain interface. Every part hands over to the code
 * that already does it (`scaffoldProject`, `runGradle`'s own argument list, `BUILD_STAGES`), so a Fabric project comes
 * out file for file and flag for flag as before.
 */
export function loomToolchain(manifest: TargetManifest): Toolchain {
  if (manifest.toolchain.kind !== "loom") throw new Error(`NOT_A_LOOM_TARGET: ${manifest.id}`)
  // The Fabric profile is what the template and the dependency lock were pinned to; the manifest is copied from it.
  const profile = resolveProfile(manifest.id)
  const toolchain: Toolchain = {
    kind: "loom",
    target: manifest,
    template: "fabric-1.21",
    javaMajors: [manifest.java.major, ...manifest.java.alsoForBuild],
    // `runGradle`'s closed list: the development server is not something Studio starts through Loom.
    tasks: ["build", "compileJava", "runClient"],
    gameCache: "fabric-loom",
    modFile: manifest.data.modFile,
    stages: BUILD_STAGES,
    chinesePaths: {
      runs: "classpath-bootstrap",
      why:
        "Loom 1.7 cannot hand the development game a class path through an argument file when it has non-ASCII characters in it, and Gradle may shorten it to a " +
        "manifest-only jar that Fabric Loader does not expand. The template's `studioDev` source set adds `ClasspathBootstrap`, which reads the real class path " +
        "from a UTF-8 file and starts the game with the original arguments. Building is not affected.",
    },
    placeholders: (input) => fabricPlaceholders(input, profile),
    scaffold: async (input) => {
      const result = await scaffoldProject({ ...input, profileId: manifest.id })
      return { directory: result.directory, files: result.files }
    },
    gradle: (task, javaHomes) => {
      if (!toolchain.tasks.includes(task)) throw new Error("UNSUPPORTED_GRADLE_TASK")
      const [game] = requireJavaHomes(toolchain, javaHomes)
      return { javaHome: game!.home, args: gradleWrapperArguments(task), env: {} }
    },
    jarPath: builtJarPath,
    stageWords: (text) => buildStageWords(text, BUILD_STAGES),
  }
  return toolchain
}
