import { z } from "zod"
import { GestureDocumentSchema, resolveGesture, type GestureResolved } from "../gesture"
import { GESTURE_BONE_NAMES, GESTURE_FORMAT, GESTURE_RUNTIME_VERSION, type GestureBoneName, type GestureEasing } from "../gesture-rig"
import { GESTURE_FACADE, gestureFacadeSources, gestureRuntimeSources } from "./gesture-runtime"
import { resolveGestureLibraries } from "./profile"
import type { GenTarget } from "../platform/adapter"

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  projectName: z.string().min(1),
  /** The mod's English name, when it has one: the key category in an English-language game is named with it. */
  projectNameEn: z.string().min(1).nullable().optional(),
  profileId: z.string(),
  gestures: z.array(z.strictObject({ id: z.uuid(), document: GestureDocumentSchema })).min(1),
})

/**
 * Each easing of a cast action and the curve of the same shape in the animation library. The build bakes
 * the curves itself, so the runtime never looks these up; the table is what a JVM check compares, number by
 * number, to prove the two sets really are one to one.
 */
export const GESTURE_LIBRARY_EASE: Record<GestureEasing, string> = {
  linear: "LINEAR",
  in_sine: "INSINE",
  out_sine: "OUTSINE",
  in_out_sine: "INOUTSINE",
  in_quad: "INQUAD",
  out_quad: "OUTQUAD",
  in_out_quad: "INOUTQUAD",
  in_cubic: "INCUBIC",
  out_cubic: "OUTCUBIC",
  in_out_cubic: "INOUTCUBIC",
  in_back: "INBACK",
  out_back: "OUTBACK",
  in_out_back: "INOUTBACK",
}

const MIT = (copyright: string) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

function replaceOnce(text: string, anchor: string, replacement: string, file: string) {
  if (text.split(anchor).length !== 2) throw new Error(`GESTURE_TEMPLATE_ANCHOR_MISSING:${file}`)
  return text.replace(anchor, () => replacement)
}

// A template checked out on Windows arrives with CRLF line endings. Every edit works on LF text, so its
// anchors match either way, and the file gets its own line endings back afterwards.
const patch = (edit: (text: string) => string) => (text: string) => {
  const edited = edit(text.replaceAll("\r\n", "\n"))
  return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
}

const round = (digits: number) => (value: number) => Number(value.toFixed(digits)) + 0

/**
 * One cast action as the runtime reads it: every moving body part's rotation (degrees) and pivot offset
 * (pixels) at every tick, already resolved, in the vanilla player model's own axes. Nothing in it names a
 * loader or a library. A part or channel that never leaves rest is left out, which leaves it to the game:
 * legs an action does not touch keep walking.
 */
export function gestureRuntimeData(resolved: GestureResolved) {
  const timeline = resolved.timeline
  const acting = timeline.frames.slice(0, timeline.ticks.windup + timeline.ticks.hold + timeline.ticks.release + 1)
  const moved = (bone: GestureBoneName, channel: "rotation" | "position") => acting.some((frame) => frame[bone][channel].some((value) => Math.abs(value) > (channel === "rotation" ? 0.01 : 0.001)))
  const parts = GESTURE_BONE_NAMES.filter((bone) => moved(bone, "rotation") || moved(bone, "position"))
  const phase = (start: number, ticks: number) =>
    Object.fromEntries(
      parts.map((bone) => [
        bone,
        {
          ...(moved(bone, "rotation") ? { rotation: acting.slice(start + 1, start + 1 + ticks).map((frame) => frame[bone].rotation.map(round(2))) } : {}),
          ...(moved(bone, "position") ? { position: acting.slice(start + 1, start + 1 + ticks).map((frame) => frame[bone].position.map(round(3))) } : {}),
        },
      ]),
    )
  // A looping hold is written as one cycle and a frozen one as far as it plays; the runtime repeats or freezes it for hold_ticks.
  const cycle = Math.min(timeline.ticks.hold, resolved.motion.hold?.ticks ?? 1)
  return {
    hold_ticks: timeline.ticks.hold,
    windup: { ticks: timeline.ticks.windup, parts: phase(0, timeline.ticks.windup) },
    hold: timeline.ticks.hold ? { ticks: cycle, loop: resolved.motion.hold?.loop ?? false, parts: phase(timeline.ticks.windup, cycle) } : null,
    release: { ticks: timeline.ticks.release, parts: phase(timeline.ticks.windup + timeline.ticks.hold, timeline.ticks.release) },
  }
}

/**
 * Everything a project's cast actions add to the mod: the fixed runtime, the loader-neutral data file the
 * runtime reads, key names in two languages, the animation library's licence and the edits to the
 * scaffolded build files. Only called when there is a cast action, so a project without one is untouched.
 */
/**
 * The animation library on a facade target (D 组), from its manifest, in the shape Fabric's profile gives it. A target whose manifest names none
 * cannot build cast actions, and says so.
 */
function facadeLibrary(target: GenTarget) {
  const artifact = target.manifest.dependencies.playerAnimator
  if (!artifact?.file.sha256) throw new Error(`Cast actions are not supported on profile: ${target.manifest.id}`)
  return { version: artifact.version, coordinate: artifact.coordinate, repository: artifact.repository, mod_id: "playeranimator", license: "MIT", copyright: "Copyright (c) 2022 KosmX", download: { url: artifact.file.url, sha256: artifact.file.sha256 } }
}

/**
 * Forge and NeoForge (D 组): the library in the build (ModDevGradle's own `jarJar` puts it inside the mod's jar, as Fabric's `include` does; on
 * Forge 1.20.1 `modImplementation` maps it to the names the mod is compiled in, and the jar inside stays the published one), the same check of its
 * hash before compiling, and the dependency in the mod's metadata.
 */
function facadePatch(target: GenTarget, modId: string, library: ReturnType<typeof facadeLibrary>) {
  const forge = target.loader.kind === "forge"
  const compile = forge ? "modImplementation" : "implementation"
  const metadata = target.loader.modFile
  return {
    "build.gradle": patch(
      (text) =>
        `${replaceOnce(
          replaceOnce(text, "repositories {\n", `repositories {\n    maven {\n        name = 'KosmX'\n        url = '${library.repository}'\n        content { includeGroup('dev.kosmx.player-anim') }\n    }\n`, "build.gradle"),
          `    ${compile} project.geckolib_coordinate\n`,
          `    ${compile} project.geckolib_coordinate\n    // Bundled inside this mod's jar (jar-in-jar): players install nothing extra for cast actions.\n    ${compile} project.player_animator_coordinate\n    jarJar project.player_animator_coordinate\n`,
          "build.gradle",
        )}
// The bundled playerAnimator jar must be the pinned one; a different file stops the build.
def pinnedPlayerAnimator = configurations.detachedConfiguration(
    dependencies.create("\${project.player_animator_coordinate}@jar")
)
def pinnedPlayerAnimatorSha256 = project.player_animator_sha256
tasks.register('verifyPlayerAnimator') {
    doLast {
        def digest = java.security.MessageDigest.getInstance('SHA-256').digest(pinnedPlayerAnimator.singleFile.bytes).encodeHex().toString()
        if (digest != pinnedPlayerAnimatorSha256) {
            throw new GradleException("playerAnimator checksum mismatch: expected \${pinnedPlayerAnimatorSha256}, got \${digest}")
        }
    }
}
tasks.named('compileJava') { dependsOn 'verifyPlayerAnimator' }
`,
    ),
    "gradle.properties": patch((text) => `${text}${text.endsWith("\n") ? "" : "\n"}player_animator_coordinate=${library.coordinate}\nplayer_animator_sha256=${library.download.sha256}\n`),
    [metadata]: patch(
      (text) =>
        `${text}${text.endsWith("\n") ? "" : "\n"}
[[dependencies.${modId}]]
modId = "${library.mod_id}"
${forge ? "mandatory = true" : 'type = "required"'}
versionRange = "[${library.version},)"
ordering = "NONE"
side = "BOTH"
`,
    ),
  }
}

export function compileGestures(input: unknown, target?: GenTarget) {
  const data = Input.parse(input)
  // A facade target (Forge, NeoForge) takes the library from its manifest; Fabric (and a call that names no target) from the Fabric profile, as before.
  const facade = target?.loader.facade ? target : null
  const library = facade ? facadeLibrary(facade) : resolveGestureLibraries(data.profileId).playerAnimator
  // Sorted by asset id so the network index of an action does not depend on the order assets were saved in.
  const gestures = [...data.gestures]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((gesture) => ({ ...gesture, name: `gesture_${gesture.id.replaceAll("-", "")}` }))
  const duplicate = gestures.find((gesture, index) => gestures.slice(0, index).some((earlier) => earlier.document.trigger.key === gesture.document.trigger.key))
  if (duplicate) throw new Error(`GESTURE_KEY_CONFLICT:${duplicate.id}`)
  const files: Record<string, string | Uint8Array> = {
    ...(facade ? gestureFacadeSources(data.packageName, data.modId, (source) => facade.version.rewriteJava(source)) : gestureRuntimeSources(data.packageName, data.modId)),
    [`src/main/resources/data/${data.modId}/studio/gestures.json`]: `${JSON.stringify({
      format: GESTURE_FORMAT,
      runtime: GESTURE_RUNTIME_VERSION,
      gestures: gestures.map((gesture) => ({
        id: gesture.name,
        name: gesture.document.name,
        trigger: gesture.document.trigger,
        aim: gesture.document.aim,
        mirror_for_left_handed: gesture.document.mirror_for_left_handed,
        first_person: gesture.document.first_person,
        ...gestureRuntimeData(resolveGesture(gesture.document)),
      })),
    })}\n`,
    // The upstream jar carries no licence text, so the mod that bundles it has to.
    "src/main/resources/META-INF/licenses/playerAnimator-LICENSE.txt": MIT(library.copyright),
  }
  return {
    files,
    gestures: gestures.map((gesture, index) => ({ id: gesture.id, index, name: gesture.name, key: gesture.document.trigger.key })),
    language: {
      zh_cn: {
        [`category.${data.modId}.gestures`]: `${data.projectName}·施法动作`,
        ...Object.fromEntries(gestures.map((gesture) => [`key.${data.modId}.gesture.${gesture.document.trigger.key}`, `施法：${gesture.document.name}`])),
      },
      en_us: {
        [`category.${data.modId}.gestures`]: `${data.projectNameEn || data.projectName} cast actions`,
        ...Object.fromEntries(gestures.map((gesture) => [`key.${data.modId}.gesture.${gesture.document.trigger.key}`, `Cast: ${gesture.document.english_name}`])),
      },
    },
    manifest: { version: GESTURE_RUNTIME_VERSION, data_format: GESTURE_FORMAT, player_animator: library },
    /** Forge and NeoForge: the runtime's two classes the common and the client entry run (`addEntryCalls`). Empty on Fabric, whose entry points are in fabric.mod.json. */
    entries: facade
      ? { common: [`${data.packageName}.${GESTURE_FACADE.package}.${GESTURE_FACADE.common}`], client: [`${data.packageName}.${GESTURE_FACADE.package}.${GESTURE_FACADE.client}`] }
      : { common: [] as string[], client: [] as string[] },
    /** Where the runtime's loader part is in the jar, for the build's check that it went in. */
    loaderClass: `${data.packageName.replaceAll(".", "/")}/gesture/${facade ? "platform" : "fabric"}/GestureMod.class`,
    /** Edits to files the scaffold wrote. Each throws if the template no longer has the line it hooks onto. */
    patch: facade ? facadePatch(facade, data.modId, library) : {
      "build.gradle": patch(
        (text) =>
          `${replaceOnce(
            replaceOnce(text, "repositories {\n", `repositories {\n    maven {\n        name = 'KosmX'\n        url = '${library.repository}'\n    }\n`, "build.gradle"),
            '    modImplementation "software.bernie.geckolib:geckolib-fabric-1.21.1:${project.geckolib_version}"\n',
            '    modImplementation "software.bernie.geckolib:geckolib-fabric-1.21.1:${project.geckolib_version}"\n    // Bundled inside this mod\'s jar (jar-in-jar), not shadowed: players install nothing extra for cast actions.\n    include modImplementation("dev.kosmx.player-anim:player-animation-lib-fabric:${project.player_animator_version}")\n',
            "build.gradle",
          )}
// The bundled playerAnimator jar must be the pinned one; a different file stops the build.
def pinnedPlayerAnimator = configurations.detachedConfiguration(
    dependencies.create("dev.kosmx.player-anim:player-animation-lib-fabric:\${project.player_animator_version}@jar")
)
def pinnedPlayerAnimatorSha256 = project.player_animator_sha256
tasks.register('verifyPlayerAnimator') {
    doLast {
        def digest = java.security.MessageDigest.getInstance('SHA-256').digest(pinnedPlayerAnimator.singleFile.bytes).encodeHex().toString()
        if (digest != pinnedPlayerAnimatorSha256) {
            throw new GradleException("playerAnimator checksum mismatch: expected \${pinnedPlayerAnimatorSha256}, got \${digest}")
        }
    }
}
tasks.named('compileJava') { dependsOn 'verifyPlayerAnimator' }
`,
      ),
      "gradle.properties": patch((text) => `${text}${text.endsWith("\n") ? "" : "\n"}player_animator_version=${library.version}\nplayer_animator_sha256=${library.download.sha256}\n`),
      // Parsed twice on purpose: the record keeps the template's key order, the shape check guards the fields edited here.
      "src/main/resources/fabric.mod.json": patch((text) => {
        const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
        const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
        return `${JSON.stringify(
          {
            ...metadata,
            entrypoints: { ...entrypoints, main: [...entrypoints.main, `${data.packageName}.gesture.fabric.GestureMod`], client: [...entrypoints.client, `${data.packageName}.gesture.fabric.client.GestureClient`] },
            depends: { ...z.record(z.string(), z.string()).parse(metadata.depends), [library.mod_id]: `>=${library.version.split("+")[0]}` },
            // Where to look up which cast-action runtime a built mod carries.
            custom: { ...z.record(z.string(), z.unknown()).default({}).parse(metadata.custom), "minemods:gesture_runtime": { version: GESTURE_RUNTIME_VERSION, data_format: GESTURE_FORMAT } },
          },
          null,
          2,
        )}\n`
      }),
    },
  }
}
