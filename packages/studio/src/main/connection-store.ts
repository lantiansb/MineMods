import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ConnectionSettingsSchema, type ConnectionSettings } from "../connection"

const StoredConnectionSchema = z.strictObject({
  settings: ConnectionSettingsSchema,
  encryptedApiKey: z.string().min(1).optional(),
})
export type StoredConnection = z.infer<typeof StoredConnectionSchema>

export type ConnectionStore = {
  load(): Promise<{ settings: ConnectionSettings; apiKey?: string } | null>
  save(value: { settings: ConnectionSettings; apiKey?: string }): Promise<void>
}

export function createConnectionStore(
  filename: string,
  crypto: {
    encrypt(value: string): string | Promise<string>
    decrypt(value: string): string | Promise<string>
  },
): ConnectionStore {
  return {
    async load() {
      const stored = await readFile(filename, "utf8")
        .then((value) => StoredConnectionSchema.parse(JSON.parse(value) as unknown))
        .catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
          throw error
        })
      if (!stored) return null
      return {
        settings: stored.settings,
        apiKey: stored.encryptedApiKey ? await crypto.decrypt(stored.encryptedApiKey) : undefined,
      }
    },
    async save(value) {
      const stored = StoredConnectionSchema.parse({
        settings: value.settings,
        encryptedApiKey: value.apiKey ? await crypto.encrypt(value.apiKey) : undefined,
      })
      await mkdir(path.dirname(filename), { recursive: true })
      const temporary = `${filename}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 })
      await rename(temporary, filename)
    },
  }
}
