import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { strToU8, unzipSync, zipSync } from "fflate"
import { previewFaceUV } from "../../studio/src/renderer/model-core/blockbench-uv"
import { loadImportedModel } from "../src/imported-model"
import { hasTargetJavac, targetJdkTool } from "./target-javac"

const fixture = fileURLToPath(new URL("./fixtures/face-uv/", import.meta.url))
const faces = ["east", "west", "up", "down", "south", "north"] as const
// Coordinates along the horizontal and downward axes of each box face as seen from outside.
const axes = [
  [-3, -2],
  [3, -2],
  [1, 3],
  [1, -3],
  [1, -2],
  [-1, -2],
] as const
for (const target of ["fabric-1.21.1-official", "forge-1.20.1", "neoforge-1.21.1"]) {
  test.skipIf(!hasTargetJavac(target))(
    `六面四角与游戏实际烘焙的顶点一致 ${target}`,
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "face-uv-"))
      try {
        const jars = (await readFile(path.join(process.env.MINEMODS_TARGET_CLASSPATH!, target + ".txt"), "utf8"))
          .trim()
          .split(/\r?\n/)
        if (target === "forge-1.20.1") {
          const library = jars.find((p) => /geckolib.*\.jar$/i.test(p))!
          const embedded = unzipSync(await readFile(library), { filter: (f) => f.name === "META-INF/jarjar/mclib-20.jar" })
          const nested = path.join(dir, "math.jar")
          await writeFile(nested, embedded["META-INF/jarjar/mclib-20.jar"]!)
          jars.push(nested)
        }
        // A manifest carries the full classpath, including non-ASCII paths, past the Windows command length limit.
        const urls = "Class-Path: " + jars.map((p) => pathToFileURL(p).href).join(" ")
        const manifest = "Manifest-Version: 1.0\r\n" + urls.match(/.{1,64}/g)!.join("\r\n ") + "\r\n\r\n"
        const classpath = path.join(dir, "classpath.jar")
        await writeFile(classpath, zipSync({ "META-INF/MANIFEST.MF": strToU8(manifest) }))
        const run = Bun.spawnSync(
          [
            targetJdkTool(target, "java"),
            "-cp",
            classpath,
            path.join(fixture, "ReadCorners.java"),
            path.join(fixture, "faces.geo.json"),
          ],
          { cwd: dir },
        )
        if (run.exitCode !== 0) throw new Error(run.stderr.toString())
        const lines = run.stdout
          .toString()
          .trim()
          .split(/\r?\n/)
          .filter((line) => line.startsWith("tile_"))
        expect(lines.length).toBe(144)
        const scene = await loadImportedModel({
          entryPath: "faces.geo.json",
          paths: ["faces.geo.json", "faces.png"],
          texturePath: "faces.png",
          readFile: (p) => readFile(path.join(fixture, p)),
        })
        const editor = await loadImportedModel({
          entryPath: "faces.bbmodel",
          paths: ["faces.bbmodel"],
          readFile: (p) => readFile(path.join(fixture, p)),
        })
        const reference = editor.preview!.geometry["minecraft:geometry"][0]!
        const model = scene.preview!.geometry["minecraft:geometry"][0]!
        for (let start = 0; start < lines.length; start += 4) {
          const vertices = lines.slice(start, start + 4).map((line) => line.split(" "))
          const bone = model.bones.find((b) => b.name === vertices[0]![0])!
          const cube = bone.cubes[0]!
          const points = vertices.map((row) => row.slice(2, 5).map(Number))
          const axis = [0, 1, 2].find((a) => points.every((p) => p[a] === points[0]![a]))!
          const center = ((cube.origin[axis]! + cube.size[axis]! / 2) * (axis === 0 ? -1 : 1)) / 16
          const faceIndex = axis * 2 + (points[0]![axis]! > center ? 0 : 1)
          const face = faces[faceIndex]!,
            rect = cube.uv[face]
          const expected = previewFaceUV(face, rect, [256, 256], scene.preview!.faceUvSpace)
          const editorCube = reference.bones.find((b) => b.name === bone.name)!.cubes[0]!
          expect(editorCube.origin).toEqual(cube.origin)
          expect(previewFaceUV(face, editorCube.uv[face], [256, 256], editor.preview!.faceUvSpace)).toEqual(expected)
          const [horizontal, vertical] = axes[faceIndex]!
          const component = (row: string[], a: number) => Number(row[1 + Math.abs(a)]) * Math.sign(a)
          vertices.sort(
            (a, b) => component(a, vertical) - component(b, vertical) || component(a, horizontal) - component(b, horizontal),
          )
          expect(vertices.map((row) => [Number(row[5]), 1 - Number(row[6])])).toEqual(expected)
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    60000,
  )
}
