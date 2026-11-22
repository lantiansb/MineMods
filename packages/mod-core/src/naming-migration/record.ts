import { readFile } from "node:fs/promises"
import { z } from "zod"
import { storagePath } from "../project"

/**
 * What the conversion of a project's gameplay code to Mojang's names did (`naming-migration.ts`), kept beside the project and never exported. The code
 * check reads it to tell whoever fixes a converted gameplay that its names were changed by a machine. Apart from the conversion itself, so that the code
 * check does not load Studio's download and process code to read it.
 */
export const NAMING_RECORD = [".minemods", "naming-migration.json"]

const FileSchema = z.strictObject({ asset_id: z.uuid(), title: z.string(), path: z.string() })
export const NamingRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  at: z.iso.datetime(),
  state: z.literal("migrated"),
  converted: z.array(FileSchema),
  unchanged: z.array(FileSchema),
  unknownWildcards: z.array(FileSchema.extend({ package: z.string() })),
  revisions: z.array(z.strictObject({ asset_id: z.uuid(), title: z.string(), from: z.number().int(), to: z.number().int() })),
  failures: z.array(z.string()).max(0),
})

/** The gameplay assets whose code a conversion changed; empty when the project was never converted (or the record is gone or unreadable). */
export async function convertedGameplay(projectDirectory: string): Promise<Set<string>> {
  const text = await readFile(await storagePath(projectDirectory, NAMING_RECORD), "utf8").catch(() => null)
  if (text === null) return new Set()
  const parsed = (() => {
    try {
      return NamingRecordSchema.safeParse(JSON.parse(text)).data
    } catch {
      return undefined
    }
  })()
  return new Set(parsed?.revisions.map((entry) => entry.asset_id) ?? [])
}

/** Added to what the compiler found in a gameplay whose code the conversion changed. */
export const CONVERTED_HINT =
  "这个玩法的代码原来是按旧的 Yarn 命名写的，Studio 已经用 Loom 自动换成了 Mojang 官方命名；这里多半是自动转换没改到的旧名字（方法、字段或类名），请照 Mojang 官方命名改，不要改回 Yarn 的名字。"
