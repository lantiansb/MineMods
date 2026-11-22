import type { CodeCompiler } from "../src/gameplay-compile"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * The compiler stand-in for machines without Gradle and the game: javac alone, on the class path of Fabric with Mojang's
 * names (`target-javac.ts`), which the generated support code and the gameplay compiled with it are written in. It
 * compiles the gameplay folder only — the generated support code and every gameplay — which is all gameplay code may
 * depend on. Where that class path is absent the tests that need it are skipped.
 */
export const HAS_OFFICIAL_JAVAC = hasTargetJavac("fabric-1.21.1-official")

export const officialJavacCompiler: CodeCompiler = {
  name: "javac (stand-in, Mojang's names)",
  run: (_source, gameplay) => targetJavac("fabric-1.21.1-official", gameplay),
}
