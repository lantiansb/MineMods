import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, lstat, mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { assertNoReverseSymlink, listReverseArchiveEntries, reverseFilePath } from "./reverse-archive"

export const ReverseDependencyFileSchema = z.strictObject({
  path: z.string().regex(/^dependencies\/[a-f0-9]{64}\.jar$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  filename: z.string().min(1).max(512),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(1024 ** 3),
})
export type ReverseDependencyFile = z.infer<typeof ReverseDependencyFileSchema>

async function hash(filename: string) {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest("hex")
}

/** Copies user-selected compile dependencies into the portable project. Never loads their code. */
export async function prepareReverseDependencies(input: {
  root: string
  previous: ReverseDependencyFile[]
  filenames?: string[]
  signal?: AbortSignal
}) {
  const entries = input.previous.map((entry) => ReverseDependencyFileSchema.parse(entry))
  if ((input.filenames?.length ?? 0) > 256) throw new Error("Too many reverse dependency files")
  if (entries.length > 512 || entries.reduce((sum, entry) => sum + entry.size, 0) > 8 * 1024 ** 3)
    throw new Error("Reverse compile dependency budget exceeded")
  await assertNoReverseSymlink(input.root, "dependencies", true)
  await mkdir(path.join(input.root, "dependencies"), { recursive: true })
  for (const entry of entries) {
    input.signal?.throwIfAborted()
    if (entry.path !== `dependencies/${entry.sha256}.jar`) throw new Error("Reverse dependency identity is invalid")
    await assertNoReverseSymlink(input.root, entry.path)
    const target = reverseFilePath(input.root, entry.path)
    const info = await lstat(target)
    if (!info.isFile() || info.size !== entry.size || (await hash(target)) !== entry.sha256)
      throw new Error(`Reverse dependency changed: ${entry.filename}`)
  }
  for (const filename of input.filenames ?? []) {
    input.signal?.throwIfAborted()
    if (!path.isAbsolute(filename) || path.extname(filename).toLowerCase() !== ".jar")
      throw new Error("Choose an absolute dependency JAR path")
    const info = await lstat(filename)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 ** 3)
      throw new Error("Invalid reverse dependency file")
    await listReverseArchiveEntries(filename)
    const sha256 = await hash(filename)
    if (entries.some((entry) => entry.sha256 === sha256)) continue
    if (entries.length >= 512 || entries.reduce((sum, entry) => sum + entry.size, 0) + info.size > 8 * 1024 ** 3)
      throw new Error("Reverse compile dependency budget exceeded")
    const relative = `dependencies/${sha256}.jar`
    await assertNoReverseSymlink(input.root, relative, true)
    const target = reverseFilePath(input.root, relative)
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? null : Promise.reject(error),
    )
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || (await hash(target)) !== sha256))
      throw new Error("Reverse dependency cache changed")
    if (!existing) {
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await copyFile(filename, temporary)
        if ((await hash(temporary)) !== sha256) throw new Error("Dependency changed while copying")
        input.signal?.throwIfAborted()
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    entries.push(
      ReverseDependencyFileSchema.parse({ path: relative, sha256, filename: path.basename(filename), size: info.size }),
    )
  }
  return { entries, classpath: entries.map((entry) => reverseFilePath(input.root, entry.path)) }
}
