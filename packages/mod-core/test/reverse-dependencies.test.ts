import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync, strToU8 } from "fflate"
import { prepareReverseDependencies } from "../src/reverse-dependencies"

test("copies compile dependencies into the project and verifies them after the source is removed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reverse-dependencies-"))
  const root = path.join(directory, "project")
  const source = path.join(directory, "selected.jar")
  await mkdir(root)
  await writeFile(source, zipSync({ "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0\r\n\r\n") }))
  try {
    const first = await prepareReverseDependencies({ root, previous: [], filenames: [source, source] })
    expect(first.entries).toHaveLength(1)
    await rm(source)
    const again = await prepareReverseDependencies({ root, previous: first.entries })
    expect(again.classpath).toEqual(first.classpath)
    expect(again.classpath[0]!.startsWith(`${root}${path.sep}`)).toBe(true)
    await writeFile(again.classpath[0]!, "changed")
    await expect(prepareReverseDependencies({ root, previous: first.entries })).rejects.toThrow(
      "Reverse dependency changed",
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
