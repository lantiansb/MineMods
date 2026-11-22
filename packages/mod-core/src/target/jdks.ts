import { resolveProfile } from "../fabric/profile"
import type { RemoteFile } from "./manifest"

/**
 * The Java builds Studio manages, one per major version, shared by every target that needs it.
 * Eclipse Temurin from Adoptium; the SHA-256 is the one Adoptium's API publishes (api.adoptium.net, read 2026-11-14),
 * so a copy from any mirror is accepted only if it is byte-for-byte the official build.
 */
export type ManagedJdk = { major: number; version: string; distribution: "temurin"; downloads: { "windows-x64": RemoteFile } }

const java21 = resolveProfile("fabric-1.21.1").java

const jdks: ManagedJdk[] = [
  {
    major: 17,
    version: "17.0.21+9",
    distribution: "temurin",
    downloads: {
      "windows-x64": {
        url: "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_windows_hotspot_17.0.21_9.zip",
        sha256: "98518ecf554465057ee5509462631deeee374bc368c12a411d225cd29381f84b",
        size: 191117380,
      },
    },
  },
  { major: 21, version: java21.version, distribution: "temurin", downloads: { "windows-x64": { ...java21.downloads["windows-x64"] } } },
]

export function managedJdk(major: number): ManagedJdk {
  const found = jdks.find((jdk) => jdk.major === major)
  if (!found) throw new Error(`UNSUPPORTED_JAVA: ${major}`)
  return structuredClone(found)
}

export function listManagedJdks(): readonly ManagedJdk[] {
  return jdks.map((jdk) => structuredClone(jdk))
}
