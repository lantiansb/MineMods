/**
 * Makes `geckolib-4.8.3.json` again: exports the fixture as the build does, plays the two files through
 * GeckoLib's own classes (GeckoProbe.java) and keeps what came out, with the hash of what went in.
 * Needs a JDK and a folder holding the Minecraft 1.21.1 (Yarn-named), Fabric and GeckoLib 4.8.3 jars:
 *   GECKO_CP=/path/to/jars bun test/fixtures/animation-contract/regenerate.ts
 * where the folder has mc/, mods/, lib/ and deps/ as /home/claude/fabric-cp does.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { compileModel } from "../../../src/model"
import { CONTRACT_TIMES, contractHash, contractMachine } from "./machine"

const here = import.meta.dir
const jars = process.env.GECKO_CP ?? "/home/claude/fabric-cp"
const classpath = ["mc", "mods", "lib", "deps"].map((part) => `${jars}/${part}/*`).join(":")
const work = mkdtempSync(path.join(tmpdir(), "gecko-probe-"))
const compiled = compileModel(contractMachine(), "contract_machine")
const geometry = JSON.stringify(compiled.geometry)
const animation = JSON.stringify(compiled.animation)
await Bun.write(path.join(work, "geo.json"), geometry)
await Bun.write(path.join(work, "animation.json"), animation)
const run = (command: string[]) => execFileSync(command[0]!, command.slice(1), { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] })
run(["javac", "-nowarn", "-proc:none", "-d", path.join(work, "out"), "-cp", classpath, path.join(here, "GeckoProbe.java")])
const played = JSON.parse(run(["java", "-cp", `${path.join(work, "out")}:${classpath}`, "GeckoProbe", path.join(work, "geo.json"), path.join(work, "animation.json"), CONTRACT_TIMES.join(",")]))
// GeckoLib computes in single precision: four decimals of a pixel and six of a radian are all it has.
const rounded = (value: unknown, digits: number): unknown => (typeof value === "number" ? Number(value.toFixed(digits)) + 0 : Array.isArray(value) ? value.map((part) => rounded(part, digits)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, part]) => [key, rounded(part, key === "tracks" ? 6 : digits)])) : value)
await Bun.write(
  path.join(here, "geckolib-4.8.3.json"),
  JSON.stringify({
    made_with: "geckolib-fabric-1.21.1-4.8.3.jar, Minecraft 1.21.1 (Yarn 1.21.1+build.3), GeckoProbe.java",
    made_from: contractHash(compiled),
    times: CONTRACT_TIMES,
    played: rounded(played, 4),
  }),
)
console.log("written", Object.keys(played).length, "animations")
