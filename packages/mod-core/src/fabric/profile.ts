const fabric = "https://maven.fabricmc.net"
const gradle = "https://raw.githubusercontent.com/gradle/gradle/v8.8.0"
const geckolib = "https://dl.cloudsmith.io/public/geckolib3/geckolib/maven/"

const profile = {
  id: "fabric-1.21.1",
  minecraft: "1.21.1",
  java: {
    major: 21,
    version: "21.0.12.1+1",
    distribution: "temurin",
    downloads: {
      "windows-x64": {
        url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip",
        sha256: "f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e",
      },
    },
  },
  loader: "0.17.2",
  fabricApi: "0.116.6+1.21.1",
  yarn: "1.21.1+build.3",
  loom: "1.7.4",
  gradle: {
    version: "8.8",
    distribution: {
      url: "https://services.gradle.org/distributions/gradle-8.8-bin.zip",
      sha256: "a4b4158601f8636cdeeab09bd76afb640030bb5b144aafe261a5e8af027dc612",
    },
    wrapper: {
      url: `${gradle}/gradle/wrapper/gradle-wrapper.jar`,
      sha256: "cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8",
    },
    scripts: {
      unix: {
        url: `${gradle}/gradlew`,
        sha256: "9647c972efcd020ea8aa71deec05f78e7bb01f3ceb623e3662cae6890ffae619",
      },
      windows: {
        url: `${gradle}/gradlew.bat`,
        sha256: "e54283c0f86074fa408c1161d08ef8f63992323a8c940c66f3626e8abc5bd8cc",
      },
    },
  },
  geckolib: {
    version: "4.8.3",
    coordinate: "software.bernie.geckolib:geckolib-fabric-1.21.1:4.8.3",
    repository: geckolib,
    download: {
      url: `${geckolib}software/bernie/geckolib/geckolib-fabric-1.21.1/4.8.3/geckolib-fabric-1.21.1-4.8.3.jar`,
      sha256: "8787e90e26f68dc9101685c010b3d65a92dbca6c6f5c533c7e4650d2ec1f721a",
    },
  },
  downloads: {
    minecraftMetadata: {
      url: "https://piston-meta.mojang.com/v1/packages/214714852d81730a2fda6641da4a49b65766ff36/1.21.1.json",
      sha1: "214714852d81730a2fda6641da4a49b65766ff36",
    },
    minecraftClient: {
      url: "https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar",
      sha1: "30c73b1c5da787909b2f73340419fdf13b9def88",
    },
    minecraftServer: {
      url: "https://piston-data.mojang.com/v1/objects/59353fb40c36d304f2035d51e7d6e6baa98dc05c/server.jar",
      sha1: "59353fb40c36d304f2035d51e7d6e6baa98dc05c",
    },
    loader: {
      url: `${fabric}/net/fabricmc/fabric-loader/0.17.2/fabric-loader-0.17.2.jar`,
      sha256: "868dd7d2366f0b6b700395efe1e6606c21bb2147c75071c6abe16ed9f21aa26f",
    },
    fabricApi: {
      url: `${fabric}/net/fabricmc/fabric-api/fabric-api/0.116.6+1.21.1/fabric-api-0.116.6+1.21.1.jar`,
      sha256: "cc531256ecce945b65b179bcedc45ca40b69d7364b95448d255270bb6fccaac8",
    },
    yarn: {
      url: `${fabric}/net/fabricmc/yarn/1.21.1+build.3/yarn-1.21.1+build.3-v2.jar`,
      sha256: "4ec570889585cb958b7d3c9dd94ce4064b16ab797dffec152bc8486c59a4010b",
    },
    loom: {
      url: `${fabric}/net/fabricmc/fabric-loom/1.7.4/fabric-loom-1.7.4.jar`,
      sha256: "1cf5532bfd825543e5c8a5f85eda49304104a79274560b2f53dc7c0b9c6755ce",
    },
  },
  verification: { build: "passed", client: "passed", server: "pending" },
} as const

export type FabricProfile = typeof profile

const kosmx = "https://maven.kosmx.dev/"

/**
 * Libraries only a project with cast actions (asset kind `gesture`) pulls in, pinned like everything above.
 * Kept beside the profile, not inside it: the profile is copied into every build manifest, and a project
 * without cast actions must build exactly as it did before they existed.
 */
const gestureLibraries = {
  "fabric-1.21.1": {
    playerAnimator: {
      version: "2.0.1+1.21.1",
      coordinate: "dev.kosmx.player-anim:player-animation-lib-fabric:2.0.1+1.21.1",
      repository: kosmx,
      mod_id: "playeranimator",
      license: "MIT",
      copyright: "Copyright (c) 2022 KosmX",
      download: {
        url: `${kosmx}dev/kosmx/player-anim/player-animation-lib-fabric/2.0.1+1.21.1/player-animation-lib-fabric-2.0.1+1.21.1.jar`,
        sha256: "21745a2ba2cb41ff6e59f8a8453d14c887c02c1b1205b4d5e073d8aee5f61b6a",
      },
    },
  },
} as const

export type GestureLibraries = (typeof gestureLibraries)["fabric-1.21.1"]

export function resolveGestureLibraries(id: string): GestureLibraries {
  if (id !== profile.id) throw new Error(`Cast actions are not supported on profile: ${id}`)
  return structuredClone(gestureLibraries[profile.id])
}

export function listSupportedProfiles(): readonly FabricProfile[] {
  return [structuredClone(profile)]
}

export function assertSupportedEnvironment(input: {
  javaMajor: number
  minecraft: string
  loader: string
  loaderVersion: string
}) {
  if (
    input.javaMajor !== profile.java.major ||
    input.minecraft !== profile.minecraft ||
    input.loader !== "fabric" ||
    input.loaderVersion !== profile.loader
  )
    throw new Error(
      `UNSUPPORTED_ENVIRONMENT: Java ${input.javaMajor}, Minecraft ${input.minecraft}, ${input.loader} ${input.loaderVersion}`,
    )
  return structuredClone(profile)
}

export function resolveProfile(id: string): FabricProfile {
  if (id !== profile.id) throw new Error(`Unsupported Fabric profile: ${id}`)
  return structuredClone(profile)
}
