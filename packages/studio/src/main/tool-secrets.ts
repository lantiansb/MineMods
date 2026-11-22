import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

/**
 * 工具资产: the keys the person saved for tools (an online service's key a tool's `{secret:NAME}` asks for). Kept encrypted with the system's key store (Electron's
 * `safeStorage`, in the app's main process only) in the runtime's store folder; decrypted only to hand to a run, never shown to an outside AI, never logged.
 */

const SecretsSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,59}$/), z.string().min(1))
const secretsPath = (runtimeDirectory: string) => path.join(runtimeDirectory, "store", "tool-secrets.json")

async function readStored(runtimeDirectory: string) {
  const text = await readFile(secretsPath(runtimeDirectory), "utf8").catch(() => null)
  if (text === null) return {}
  const parsed = SecretsSchema.safeParse((() => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })())
  return parsed.success ? parsed.data : {}
}

/** Every saved key, decrypted (a key that cannot be decrypted, as after the system's key store changed, is left out: the tool then says it lacks it). */
export async function readToolSecrets(runtimeDirectory: string, decrypt: (value: string) => string) {
  const stored = await readStored(runtimeDirectory)
  return Object.fromEntries(
    Object.entries(stored).flatMap(([name, value]) => {
      try {
        return [[name, decrypt(value)]]
      } catch {
        return []
      }
    }),
  )
}

/** The names of the saved keys, never their values: what the storage page shows. */
export async function toolSecretNames(runtimeDirectory: string) {
  return Object.keys(await readStored(runtimeDirectory)).sort()
}

/** Saves a key (encrypted), or removes it when `value` is empty. */
export async function saveToolSecret(runtimeDirectory: string, name: string, value: string, encrypt: (value: string) => string) {
  const stored = await readStored(runtimeDirectory)
  const next = { ...stored }
  if (value.trim()) next[z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,59}$/).parse(name)] = encrypt(value.trim())
  else delete next[name]
  const file = secretsPath(runtimeDirectory)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`)
  await rename(temporary, file)
}
