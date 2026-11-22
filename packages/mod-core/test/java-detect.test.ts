import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  detectJava,
  directorySize,
  freeSpace,
  javaMajor,
  judgeJava,
  parseJavaProperties,
  pickJava,
  type JavaFound,
} from "../src/java-detect"

const properties = (lines: Record<string, string>, banner: string) =>
  `Property settings:\n${Object.entries(lines)
    .map(([name, value]) => `    ${name} = ${value}`)
    .join("\n")}\n\n${banner}\n`

const temurin21 = properties(
  {
    "file.encoding": "UTF-8",
    "java.home": "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot",
    "java.vendor": "Eclipse Adoptium",
    "java.vendor.url": "https://adoptium.net/",
    "java.version": "21.0.5",
    "java.version.date": "2024-10-15",
    "os.arch": "amd64",
    "os.name": "Windows 11",
  },
  'openjdk version "21.0.5" 2024-10-15 LTS\nOpenJDK Runtime Environment Temurin-21.0.5+11 (build 21.0.5+11-LTS)',
).replaceAll("\n", "\r\n")
const oracle8 = properties(
  {
    "java.home": "C:\\Program Files (x86)\\Java\\jre1.8.0_402",
    "java.vendor": "Oracle Corporation",
    "java.version": "1.8.0_402",
    "os.arch": "x86",
  },
  'java version "1.8.0_402"\nJava(TM) SE Runtime Environment (build 1.8.0_402-b06)',
)
const microsoft17 = properties(
  { "java.vendor": "Microsoft", "java.vendor.url": "https://www.microsoft.com", "java.version": "17.0.11", "os.arch": "amd64" },
  'openjdk version "17.0.11" 2024-04-16 LTS\nOpenJDK Runtime Environment Microsoft-9388422 (build 17.0.11+9-LTS)',
)

test("读出 java -XshowSettings:properties 的版本、厂商和架构，别的输出不认", () => {
  expect(parseJavaProperties(temurin21)).toEqual({ version: "21.0.5", vendor: "Eclipse Adoptium", arch: "amd64" })
  expect(parseJavaProperties(oracle8)).toEqual({ version: "1.8.0_402", vendor: "Oracle Corporation", arch: "x86" })
  expect(parseJavaProperties(microsoft17)).toEqual({ version: "17.0.11", vendor: "Microsoft", arch: "amd64" })
  expect(parseJavaProperties("Error: could not find java.dll\nError: Could not find Java SE Runtime Environment.")).toBeNull()
  expect(parseJavaProperties('    java.version = \n    java.vendor = X\n    os.arch = amd64')).toBeNull()
  expect(parseJavaProperties("")).toBeNull()
})

test("Java 主版本：旧的 1.x 编号和新的编号", () => {
  expect(javaMajor("1.8.0_402")).toBe(8)
  expect(javaMajor("17.0.11")).toBe(17)
  expect(javaMajor("21")).toBe(21)
  expect(javaMajor("21.0.12.1")).toBe(21)
  expect(javaMajor("garbage")).toBe(0)
})

const java = (fields: Partial<JavaFound> & Pick<JavaFound, "home" | "version">): JavaFound => {
  const described = {
    major: javaMajor(fields.version),
    vendor: "Eclipse Adoptium",
    arch: "amd64",
    jdk: true,
    source: "installed" as const,
    ...fields,
  }
  return { ...described, ...judgeJava(described, { major: 21, arch: "x64" }) }
}

test("合适 = JDK、主版本对、架构是这台电脑的；不合适时说一句为什么", () => {
  const base = { home: "C:\\J", version: "21.0.5", major: 21, vendor: "V", arch: "amd64", jdk: true, source: "path" as const }
  expect(judgeJava(base, { major: 21, arch: "x64" })).toEqual({ fits: true, why: null })
  expect(judgeJava({ ...base, arch: "x86_64" }, { major: 21, arch: "x64" }).fits).toBe(true)
  expect(judgeJava({ ...base, arch: "aarch64" }, { major: 21, arch: "arm64" }).fits).toBe(true)
  expect(judgeJava({ ...base, version: "17.0.11", major: 17 }, { major: 21, arch: "x64" })).toEqual({
    fits: false,
    why: "这是 Java 17，这个版本的游戏要 Java 21。",
  })
  expect(judgeJava({ ...base, jdk: false }, { major: 21, arch: "x64" })).toEqual({
    fits: false,
    why: "只有运行环境（JRE），打包模组要完整的 JDK。",
  })
  expect(judgeJava({ ...base, arch: "x86" }, { major: 21, arch: "x64" })).toEqual({
    fits: false,
    why: "是 32 位的，这台电脑要 64 位的。",
  })
  expect(judgeJava({ ...base, arch: "aarch64" }, { major: 21, arch: "x64" }).fits).toBe(false)
})

test("自动挑选：Studio 自己装的 > JAVA_HOME > 其余按版本从高到低；指定的只在合适时用", () => {
  const newest = java({ home: "C:\\Program Files\\Zulu\\zulu-21", version: "21.0.6" })
  const older = java({ home: "C:\\Program Files\\Microsoft\\jdk-21.0.2", version: "21.0.2" })
  const fromHome = java({ home: "C:\\Java\\21", version: "21.0.1", source: "java_home" })
  const studio = java({ home: "D:\\Studio\\java-21", version: "21.0.0", source: "studio" })
  const jre = java({ home: "C:\\JRE", version: "21.0.9", jdk: false })
  expect(pickJava([older, newest, jre], { chosen: null })).toBe(newest)
  expect(pickJava([older, newest, fromHome], { chosen: null })).toBe(fromHome)
  expect(pickJava([older, fromHome, studio, newest], { chosen: null })).toBe(studio)
  expect(pickJava([jre], { chosen: null })).toBeNull()
  expect(pickJava([java({ home: "C:\\a", version: "21.0.10" }), java({ home: "C:\\b", version: "21.0.9" })], { chosen: null })!.home).toBe("C:\\a")
  expect(pickJava([older, newest], { chosen: "c:/program files/microsoft/JDK-21.0.2/" })).toBe(older)
  expect(pickJava([older, newest, jre], { chosen: "C:\\JRE" })).toBeNull()
  expect(pickJava([older], { chosen: "C:\\Elsewhere" })).toBeNull()
})

/** A pretend computer: files that exist, folder listings, links and what each java prints. */
function computer(input: {
  files: string[]
  folders: Record<string, string[]>
  links?: Record<string, string>
  outputs: Record<string, string | Error>
  windows: boolean
}) {
  const fold = (file: string) => (input.windows ? file.toLowerCase() : file)
  const files = new Set(input.files.map(fold))
  const runs: string[] = []
  return {
    runs,
    exists: async (file: string) => files.has(fold(file)),
    listDirectory: async (dir: string) => {
      const found = Object.entries(input.folders).find(([key]) => fold(key) === fold(dir))
      if (!found) throw Object.assign(new Error("missing"), { code: "ENOENT" })
      return found[1]
    },
    realpath: async (file: string) => {
      const link = Object.entries(input.links ?? {}).find(([key]) => fold(key) === fold(file))
      if (link) return link[1]
      if (!files.has(fold(file)) && !Object.keys(input.folders).some((key) => fold(key) === fold(file)))
        throw Object.assign(new Error("missing"), { code: "ENOENT" })
      return file
    },
    run: async (command: string, args: string[]) => {
      runs.push([command, ...args].join(" "))
      const output = Object.entries(input.outputs).find(([key]) => fold(key) === fold(command === "reg.exe" ? args[1] : command))?.[1]
      if (output instanceof Error) throw output
      if (output === undefined) return { code: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value." }
      return command === "reg.exe" ? { code: 0, stdout: output, stderr: "" } : { code: 0, stdout: "", stderr: output }
    },
  }
}

test("Windows：各处找到的 Java 去重、跑一次判断，坏的不出现，JAVA_HOME 优先", async () => {
  const temurin = "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot"
  const microsoft = "C:\\Program Files\\Microsoft\\jdk-17.0.11.9-hotspot"
  const oracle = "C:\\Program Files (x86)\\Java\\jre1.8.0_402"
  const broken = "C:\\Program Files\\Java\\jdk-21-broken"
  const launcher = "C:\\Users\\a\\AppData\\Roaming\\.minecraft\\runtime\\java-runtime-delta\\windows-x64\\java-runtime-delta"
  const zulu = "D:\\Java\\zulu21"
  const pc = computer({
    windows: true,
    files: [
      ...[temurin, microsoft, broken, zulu].flatMap((home) => [`${home}\\bin\\java.exe`, `${home}\\bin\\javac.exe`]),
      `${oracle}\\bin\\java.exe`,
      `${launcher}\\bin\\java.exe`,
      "C:\\Windows\\System32\\reg.exe",
    ],
    folders: {
      "C:\\Program Files\\Eclipse Adoptium": ["jdk-21.0.5.11-hotspot"],
      "C:\\Program Files\\Microsoft": ["jdk-17.0.11.9-hotspot", "Edge"],
      "C:\\Program Files\\Java": ["jdk-21-broken"],
      "C:\\Program Files (x86)\\Java": ["jre1.8.0_402"],
      "C:\\Users\\a\\AppData\\Roaming\\.minecraft\\runtime": ["java-runtime-delta"],
      "C:\\Users\\a\\AppData\\Roaming\\.minecraft\\runtime\\java-runtime-delta\\windows-x64": ["java-runtime-delta"],
    },
    outputs: {
      [`${temurin}\\bin\\java.exe`]: temurin21,
      [`${microsoft}\\bin\\java.exe`]: microsoft17,
      [`${oracle}\\bin\\java.exe`]: oracle8,
      [`${broken}\\bin\\java.exe`]: new Error("spawn UNKNOWN"),
      [`${launcher}\\bin\\java.exe`]: properties({ "java.vendor": "Microsoft", "java.version": "21.0.3", "os.arch": "amd64" }, ""),
      [`${zulu}\\bin\\java.exe`]: properties({ "java.vendor": "Azul Systems, Inc.", "java.version": "21.0.4", "os.arch": "amd64" }, ""),
      "HKLM\\SOFTWARE\\Azul Systems\\Zulu": [
        "",
        "HKEY_LOCAL_MACHINE\\SOFTWARE\\Azul Systems\\Zulu\\zulu-21",
        "    InstallationPath    REG_SZ    D:\\Java\\zulu21\\",
        "    CurrentVersion    REG_SZ    21.0.4",
        "",
        "End of search: 2 match(es) found.",
      ].join("\r\n"),
      "HKLM\\SOFTWARE\\JavaSoft": [
        "",
        "HKEY_LOCAL_MACHINE\\SOFTWARE\\JavaSoft\\JDK\\21",
        "    JavaHome    REG_SZ    %ProgramFiles%\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot",
        "",
      ].join("\r\n"),
    },
  })
  const report = await detectJava({
    major: 21,
    runtimeDirectory: "C:\\Users\\a\\AppData\\Roaming\\MineMods Studio\\runtime",
    installDirectory: "D:\\MineMods",
    platform: "win32",
    arch: "x64",
    env: {
      JAVA_HOME: temurin,
      // The same Java again on PATH, in other case: one entry, kept as JAVA_HOME.
      Path: `c:\\program files\\eclipse adoptium\\jdk-21.0.5.11-hotspot\\bin;C:\\Windows\\System32`,
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
      APPDATA: "C:\\Users\\a\\AppData\\Roaming",
    },
    ...pc,
  })
  expect(report.found.map((found) => [found.home, found.source, found.version, found.jdk, found.fits])).toEqual([
    [temurin, "java_home", "21.0.5", true, true],
    [zulu, "registry", "21.0.4", true, true],
    [launcher, "launcher", "21.0.3", false, false],
    [microsoft, "installed", "17.0.11", true, false],
    [oracle, "installed", "1.8.0_402", false, false],
  ])
  expect(report.found.find((found) => found.home === oracle)!.why).toBe("这是 Java 8，这个版本的游戏要 Java 21。")
  expect(report.found.find((found) => found.home === launcher)!.why).toBe("只有运行环境（JRE），打包模组要完整的 JDK。")
  expect(report.using!.home).toBe(temurin)
  expect(pc.runs.filter((run) => run.startsWith(temurin)).length).toBe(1)
  expect(pc.runs).toContain(`${broken}\\bin\\java.exe -XshowSettings:properties -version`)
  expect(pc.runs).toContain("reg.exe query HKLM\\SOFTWARE\\Microsoft\\JDK /s")

  const chosen = await detectJava({
    major: 21,
    runtimeDirectory: "C:\\Users\\a\\AppData\\Roaming\\MineMods Studio\\runtime",
    chosen: "d:\\java\\ZULU21",
    platform: "win32",
    arch: "x64",
    env: { JAVA_HOME: temurin },
    ...pc,
  })
  expect(chosen.using!.home).toBe(path.win32.resolve("d:\\java\\ZULU21"))
  expect(chosen.using!.source).toBe("chosen")
  const unfit = await detectJava({ major: 21, runtimeDirectory: "C:\\r", chosen: microsoft, platform: "win32", arch: "x64", env: {}, ...pc })
  expect(unfit.using).toBeNull()
  expect(unfit.found.map((found) => [found.home, found.source])).toEqual([
    [zulu, "registry"],
    [microsoft, "chosen"],
  ])
})

test("Linux：PATH 里的链接追到真正的 JDK，sdkman 的 current 不重复，Studio 自己装的优先", async () => {
  const runtime = "/home/a/.config/MineMods Studio/runtime"
  const openjdk = "/usr/lib/jvm/java-21-openjdk-amd64"
  const openjdk17 = "/usr/lib/jvm/java-17-openjdk-amd64"
  const sdkman = "/home/a/.sdkman/candidates/java/21.0.5-tem"
  const studio = `${runtime}/java-21`
  const pc = computer({
    windows: false,
    files: [openjdk, openjdk17, sdkman, studio].flatMap((home) => [`${home}/bin/java`, `${home}/bin/javac`]).concat("/usr/bin/java"),
    folders: {
      "/usr/lib/jvm": ["java-21-openjdk-amd64", "java-17-openjdk-amd64", "default-java"],
      "/home/a/.sdkman/candidates/java": ["21.0.5-tem", "current"],
    },
    links: {
      "/usr/bin/java": `${openjdk}/bin/java`,
      "/usr/lib/jvm/default-java": openjdk,
      "/home/a/.sdkman/candidates/java/current": sdkman,
    },
    outputs: {
      [`${openjdk}/bin/java`]: properties({ "java.vendor": "Ubuntu", "java.version": "21.0.4", "os.arch": "amd64" }, ""),
      [`${openjdk17}/bin/java`]: properties({ "java.vendor": "Ubuntu", "java.version": "17.0.12", "os.arch": "amd64" }, ""),
      [`${sdkman}/bin/java`]: properties({ "java.vendor": "Eclipse Adoptium", "java.version": "21.0.5", "os.arch": "amd64" }, ""),
      [`${studio}/bin/java`]: properties({ "java.vendor": "Eclipse Adoptium", "java.version": "21.0.2", "os.arch": "amd64" }, ""),
    },
  })
  const report = await detectJava({
    major: 21,
    runtimeDirectory: runtime,
    platform: "linux",
    arch: "x64",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/a" },
    ...pc,
  })
  expect(report.found.map((found) => [found.home, found.source, found.fits])).toEqual([
    [sdkman, "installed", true],
    [openjdk, "path", true],
    [studio, "studio", true],
    [openjdk17, "installed", false],
  ])
  expect(report.using!.home).toBe(studio)
  expect(pc.runs.filter((run) => run.startsWith(openjdk)).length).toBe(1)
  expect(pc.runs.filter((run) => run.startsWith(sdkman)).length).toBe(1)
})

test("硬盘剩余空间读最近一个存在的上级，文件夹大小不跟随链接", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-java-detect-"))
  try {
    expect(await freeSpace(path.join(root, "not", "yet", "made"))).toBeGreaterThan(0)
    await mkdir(path.join(root, "jdk", "bin"), { recursive: true })
    await writeFile(path.join(root, "jdk", "bin", "java"), "x".repeat(1000))
    await writeFile(path.join(root, "jdk", "release"), "y".repeat(24))
    await mkdir(path.join(root, "outside"))
    await writeFile(path.join(root, "outside", "big"), "z".repeat(5000))
    await symlink(path.join(root, "outside"), path.join(root, "jdk", "linked"), process.platform === "win32" ? "junction" : "dir")
    expect(await directorySize(path.join(root, "jdk"))).toBe(1024)
    expect(await directorySize(path.join(root, "missing"))).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
