import { expect, test } from "bun:test"
import { inspectJavaClass } from "../src/class-inspect"

// Compiled with javac --release 17 -g:none on JDK 25 and checked against javap -c -verbose.
const fixture = [
  "yv66vgAAAD0AXQoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWCgAIAAkHAAoMAAsADAEAEGph",
  "dmEvbGFuZy9TdHJpbmcBAAZsZW5ndGgBAAMoKUkHAA4BAB5qYXZhL2xhbmcvTnVsbFBvaW50ZXJFeGNlcHRpb24LABAAEQcAEgwA",
  "EwAGAQASamF2YS9sYW5nL1J1bm5hYmxlAQADcnVuBwAVAQAQSW5zcGVjdG9yRml4dHVyZQURIhD0femBFRIAAAAZDAATABoBABco",
  "SSlMamF2YS9sYW5nL1J1bm5hYmxlOxIAAQAcDAAdAB4BABdtYWtlQ29uY2F0V2l0aENvbnN0YW50cwEAJihMamF2YS9sYW5nL1N0",
  "cmluZzspTGphdmEvbGFuZy9TdHJpbmc7CQAgACEHACIMACMAJAEAEGphdmEvbGFuZy9TeXN0ZW0BAANvdXQBABVMamF2YS9pby9Q",
  "cmludFN0cmVhbTsKACYAJwcAKAwAKQAqAQATamF2YS9pby9QcmludFN0cmVhbQEAB3ByaW50bG4BAAQoSSlWAQAEVEVYVAEAEkxq",
  "YXZhL2xhbmcvU3RyaW5nOwEADUNvbnN0YW50VmFsdWUIAC8BAA7kuK3mloftoL3tuIDAgAEABExPTkcBAAFKAQAGRE9VQkxFAQAB",
  "RAZACSH7VEQtGAEABENvZGUBAAZsb29rdXABAAQoSSlJAQANU3RhY2tNYXBUYWJsZQEABXRhYmxlAQAHZ3VhcmRlZAEAFShMamF2",
  "YS9sYW5nL1N0cmluZzspSQEABmludm9rZQEAFyhMamF2YS9sYW5nL1J1bm5hYmxlOylKAQAGbGFtYmRhAQAGY2hvb3NlAQAEd2lk",
  "ZQEAD2xhbWJkYSRsYW1iZGEkMAEAEEJvb3RzdHJhcE1ldGhvZHMQAAYPBgBGCgAUAEcMAEIAKggASQEAAgEhDwYASwoATABNBwBO",
  "DABPAFABACJqYXZhL2xhbmcvaW52b2tlL0xhbWJkYU1ldGFmYWN0b3J5AQALbWV0YWZhY3RvcnkBAMwoTGphdmEvbGFuZy9pbnZv",
  "a2UvTWV0aG9kSGFuZGxlcyRMb29rdXA7TGphdmEvbGFuZy9TdHJpbmc7TGphdmEvbGFuZy9pbnZva2UvTWV0aG9kVHlwZTtMamF2",
  "YS9sYW5nL2ludm9rZS9NZXRob2RUeXBlO0xqYXZhL2xhbmcvaW52b2tlL01ldGhvZEhhbmRsZTtMamF2YS9sYW5nL2ludm9rZS9N",
  "ZXRob2RUeXBlOylMamF2YS9sYW5nL2ludm9rZS9DYWxsU2l0ZTsPBgBSCgBTAFQHAFUMAB0AVgEAJGphdmEvbGFuZy9pbnZva2Uv",
  "U3RyaW5nQ29uY2F0RmFjdG9yeQEAmChMamF2YS9sYW5nL2ludm9rZS9NZXRob2RIYW5kbGVzJExvb2t1cDtMamF2YS9sYW5nL1N0",
  "cmluZztMamF2YS9sYW5nL2ludm9rZS9NZXRob2RUeXBlO0xqYXZhL2xhbmcvU3RyaW5nO1tMamF2YS9sYW5nL09iamVjdDspTGph",
  "dmEvbGFuZy9pbnZva2UvQ2FsbFNpdGU7AQAMSW5uZXJDbGFzc2VzBwBZAQAlamF2YS9sYW5nL2ludm9rZS9NZXRob2RIYW5kbGVz",
  "JExvb2t1cAcAWwEAHmphdmEvbGFuZy9pbnZva2UvTWV0aG9kSGFuZGxlcwEABkxvb2t1cAAhABQAAgABABAAAwAZACsALAABAC0A",
  "AAACAC4AGQAwADEAAQAtAAAAAgAWABkAMgAzAAEALQAAAAIANAALAAEABQAGAAEANgAAABEAAQABAAAABSq3AAGxAAAAAAABABMA",
  "BgABADYAAAANAAAAAQAAAAGxAAAAAAAJADcAOAABADYAAABEAAEAAQAAACwaqwAAAAAAKQAAAAP///+cAAAAIwAAAAMAAAAlAAAC",
  "vAAAACcErAWsBqwDrAAAAAEAOQAAAAYABCQBAQEACQA6ADgAAQA2AAAAQwABAAEAAAAqGqoAAAAAACcAAAAAAAAAAwAAAB8AAAAh",
  "AAAAIwAAACUErAWsBqwHrAOsAAAAAQA5AAAABwAFIAEBAQEACQA7ADwAAQA2AAAAKAABAAIAAAAIKrYAB6xMAqwAAQAAAAQABQAN",
  "AAEAOQAAAAYAAUUHAA0ACQA9AD4AAQA2AAAAFgACAAEAAAAKKrkADwEAFAAWrQAAAAAACQA/ABoAAQA2AAAAEwABAAEAAAAHGroA",
  "GAAAsAAAAAAACQBAADgAAQA2AAAAEAACAAEAAAAEGgRgrAAAAAAACQBAAB4AAQA2AAAAEwABAAEAAAAHKroAGwAAsAAAAAAACQBB",
  "AAwAAQA2AAAIJgACAQ4AAAgaAzsEPAU9Bj4HNgQINgUQBjYGEAc2BxAINggQCTYJEAo2ChALNgsQDDYMEA02DRAONg4QDzYPEBA2",
  "EBARNhEQEjYSEBM2ExAUNhQQFTYVEBY2FhAXNhcQGDYYEBk2GRAaNhoQGzYbEBw2HBAdNh0QHjYeEB82HxAgNiAQITYhECI2IhAj",
  "NiMQJDYkECU2JRAmNiYQJzYnECg2KBApNikQKjYqECs2KxAsNiwQLTYtEC42LhAvNi8QMDYwEDE2MRAyNjIQMzYzEDQ2NBA1NjUQ",
  "NjY2EDc2NxA4NjgQOTY5EDo2OhA7NjsQPDY8ED02PRA+Nj4QPzY/EEA2QBBBNkEQQjZCEEM2QxBENkQQRTZFEEY2RhBHNkcQSDZI",
  "EEk2SRBKNkoQSzZLEEw2TBBNNk0QTjZOEE82TxBQNlAQUTZREFI2UhBTNlMQVDZUEFU2VRBWNlYQVzZXEFg2WBBZNlkQWjZaEFs2",
  "WxBcNlwQXTZdEF42XhBfNl8QYDZgEGE2YRBiNmIQYzZjEGQ2ZBBlNmUQZjZmEGc2ZxBoNmgQaTZpEGo2ahBrNmsQbDZsEG02bRBu",
  "Nm4QbzZvEHA2cBBxNnEQcjZyEHM2cxB0NnQQdTZ1EHY2dhB3NncQeDZ4EHk2eRB6NnoQezZ7EHw2fBB9Nn0QfjZ+EH82fxEAgDaA",
  "EQCBNoERAII2ghEAgzaDEQCENoQRAIU2hREAhjaGEQCHNocRAIg2iBEAiTaJEQCKNooRAIs2ixEAjDaMEQCNNo0RAI42jhEAjzaP",
  "EQCQNpARAJE2kREAkjaSEQCTNpMRAJQ2lBEAlTaVEQCWNpYRAJc2lxEAmDaYEQCZNpkRAJo2mhEAmzabEQCcNpwRAJ02nREAnjae",
  "EQCfNp8RAKA2oBEAoTahEQCiNqIRAKM2oxEApDakEQClNqURAKY2phEApzanEQCoNqgRAKk2qREAqjaqEQCrNqsRAKw2rBEArTat",
  "EQCuNq4RAK82rxEAsDawEQCxNrERALI2shEAszazEQC0NrQRALU2tREAtja2EQC3NrcRALg2uBEAuTa5EQC6NroRALs2uxEAvDa8",
  "EQC9Nr0RAL42vhEAvza/EQDANsARAME2wREAwjbCEQDDNsMRAMQ2xBEAxTbFEQDGNsYRAMc2xxEAyDbIEQDJNskRAMo2yhEAyzbL",
  "EQDMNswRAM02zREAzjbOEQDPNs8RANA20BEA0TbREQDSNtIRANM20xEA1DbUEQDVNtURANY21hEA1zbXEQDYNtgRANk22REA2jba",
  "EQDbNtsRANw23BEA3TbdEQDeNt4RAN823xEA4DbgEQDhNuERAOI24hEA4zbjEQDkNuQRAOU25REA5jbmEQDnNucRAOg26BEA6Tbp",
  "EQDqNuoRAOs26xEA7DbsEQDtNu0RAO427hEA7zbvEQDwNvARAPE28REA8jbyEQDzNvMRAPQ29BEA9Tb1EQD2NvYRAPc29xEA+Db4",
  "EQD5NvkRAPo2+hEA+zb7EQD8NvwRAP02/REA/jb+EQD/Nv8RAQDENgEAEQEBxDYBAREBAsQ2AQIRAQPENgEDEQEExDYBBBEBBcQ2",
  "AQURAQbENgEGEQEHxDYBBxEBCMQ2AQgRAQnENgEJEQEKxDYBChEBC8Q2AQsRAQzENgEMEQENxDYBDRobYBxgHWAVBGAVBWAVBmAV",
  "B2AVCGAVCWAVCmAVC2AVDGAVDWAVDmAVD2AVEGAVEWAVEmAVE2AVFGAVFWAVFmAVF2AVGGAVGWAVGmAVG2AVHGAVHWAVHmAVH2AV",
  "IGAVIWAVImAVI2AVJGAVJWAVJmAVJ2AVKGAVKWAVKmAVK2AVLGAVLWAVLmAVL2AVMGAVMWAVMmAVM2AVNGAVNWAVNmAVN2AVOGAV",
  "OWAVOmAVO2AVPGAVPWAVPmAVP2AVQGAVQWAVQmAVQ2AVRGAVRWAVRmAVR2AVSGAVSWAVSmAVS2AVTGAVTWAVTmAVT2AVUGAVUWAV",
  "UmAVU2AVVGAVVWAVVmAVV2AVWGAVWWAVWmAVW2AVXGAVXWAVXmAVX2AVYGAVYWAVYmAVY2AVZGAVZWAVZmAVZ2AVaGAVaWAVamAV",
  "a2AVbGAVbWAVbmAVb2AVcGAVcWAVcmAVc2AVdGAVdWAVdmAVd2AVeGAVeWAVemAVe2AVfGAVfWAVfmAVf2AVgGAVgWAVgmAVg2AV",
  "hGAVhWAVhmAVh2AViGAViWAVimAVi2AVjGAVjWAVjmAVj2AVkGAVkWAVkmAVk2AVlGAVlWAVlmAVl2AVmGAVmWAVmmAVm2AVnGAV",
  "nWAVnmAVn2AVoGAVoWAVomAVo2AVpGAVpWAVpmAVp2AVqGAVqWAVqmAVq2AVrGAVrWAVrmAVr2AVsGAVsWAVsmAVs2AVtGAVtWAV",
  "tmAVt2AVuGAVuWAVumAVu2AVvGAVvWAVvmAVv2AVwGAVwWAVwmAVw2AVxGAVxWAVxmAVx2AVyGAVyWAVymAVy2AVzGAVzWAVzmAV",
  "z2AV0GAV0WAV0mAV02AV1GAV1WAV1mAV12AV2GAV2WAV2mAV22AV3GAV3WAV3mAV32AV4GAV4WAV4mAV42AV5GAV5WAV5mAV52AV",
  "6GAV6WAV6mAV62AV7GAV7WAV7mAV72AV8GAV8WAV8mAV82AV9GAV9WAV9mAV92AV+GAV+WAV+mAV+2AV/GAV/WAV/mAV/2DEFQEA",
  "YMQVAQFgxBUBAmDEFQEDYMQVAQRgxBUBBWDEFQEGYMQVAQdgxBUBCGDEFQEJYMQVAQpgxBUBC2DEFQEMYMQVAQ1grAAAAAAQCgBC",
  "ACoAAQA2AAAAFAACAAEAAAAIsgAfGrYAJbEAAAAAAAIAQwAAABIAAgBKAAMARABFAEQAUQABAEgAVwAAAAoAAQBYAFoAXAAZ",
].join("")
const classBytes = Buffer.from(fixture, "base64")
const inspect = (methodName?: string) =>
  JSON.parse(inspectJavaClass(classBytes, methodName).content) as {
    name: string
    class_version: { major: number; minor: number }
    fields: Array<{ name: string; descriptor: string; constant_value?: string }>
    methods: Array<{ name: string; descriptor: string; instructions?: string[] }>
    available_methods?: string[]
    dynamic_refs: Array<{ tag: number; value: string }>
    bootstrap_methods: Array<{ index: number; method: string; arguments: string[] }>
    string_constants: string[]
  }

test("class parser emits bounded structural evidence and preserves modified UTF-8 and wide constants", () => {
  const evidence = inspect()
  expect(evidence.name).toBe("InspectorFixture")
  expect(evidence.class_version.major).toBe(61)
  expect(evidence.fields.map((field) => field.name)).toEqual(["TEXT", "LONG", "DOUBLE"])
  expect(evidence.fields.find((field) => field.name === "TEXT")?.constant_value).toBe("中文😀\0")
  expect(evidence.fields.find((field) => field.name === "LONG")?.constant_value).toBe("1234567890123456789")
  expect(evidence.fields.find((field) => field.name === "DOUBLE")?.constant_value).toBe("3.141592653589793")
  expect(evidence.string_constants).toContain("中文😀\0")
  expect(evidence.available_methods).toContain("wide")
  expect(evidence.methods.every((method) => method.instructions === undefined)).toBe(true)
  const defaultContent = inspectJavaClass(classBytes).content
  expect(defaultContent.length).toBeLessThan(24_000)
  expect(defaultContent.indexOf("string_constants")).toBeLessThan(defaultContent.indexOf("fields"))
  expect(inspectJavaClass(classBytes).content).toContain("method bodies are omitted")
})

test("selected methods expose javap-confirmed switches, handlers, calls, lambda and wide locals", () => {
  const selected = (name: string) =>
    inspect(name)
      .methods.find((method) => method.name === name)
      ?.instructions?.join("\n") ?? ""
  // javap -c -verbose reports these mnemonics for the same release-17 fixture.
  expect(selected("lookup")).toContain("lookupswitch")
  expect(selected("table")).toContain("tableswitch")
  expect(selected("guarded")).toContain("invokevirtual")
  expect(JSON.stringify(inspect("guarded").methods.find((method) => method.name === "guarded"))).toContain(
    "java/lang/NullPointerException",
  )
  expect(selected("invoke")).toContain("invokeinterface")
  expect(selected("invoke")).toContain("java/lang/Runnable.run:()V")
  expect(selected("lambda")).toContain("invokedynamic")
  expect(inspect("lambda").bootstrap_methods.some((reference) => reference.method.includes("LambdaMetafactory"))).toBe(
    true,
  )
  expect(
    inspect("choose").bootstrap_methods.some(
      (reference) =>
        reference.method.includes("makeConcatWithConstants") &&
        reference.arguments.some((value) => value.includes("\u0001")),
    ),
  ).toBe(true)
  expect(selected("wide")).toContain("wide iload 010d")
  expect(
    inspect("choose")
      .methods.filter((method) => method.name === "choose")
      .map((method) => method.descriptor)
      .sort(),
  ).toEqual(["(I)I", "(Ljava/lang/String;)Ljava/lang/String;"])
  expect(inspect("lookup").methods.map((method) => method.name)).toEqual(["lookup"])
  expect((inspect("lookup") as { available_methods?: string[] }).available_methods).toBeUndefined()
  expect(() => inspectJavaClass(classBytes, "absent")).toThrow("Java method not found")
  const narrow = JSON.parse(inspectJavaClass(classBytes, "wide", { maxInstructions: 1 }).content) as {
    methods: { instructions?: string[]; truncated?: boolean }[]
  }
  expect(narrow.methods[0]?.instructions).toHaveLength(1)
  expect(narrow.methods[0]?.truncated).toBe(true)
  expect(() => inspectJavaClass(classBytes, "wide", { maxInstructions: 4097 })).toThrow(
    "Invalid Java instruction evidence limit",
  )
})

test("malformed classes, invalid modified UTF-8 and oversized input are rejected", () => {
  expect(() => inspectJavaClass(new Uint8Array([0, 1, 2, 3]))).toThrow("Invalid Java class magic")
  expect(() => inspectJavaClass(classBytes.subarray(0, classBytes.length - 1))).toThrow()
  const invalidUtf8 = Buffer.from(classBytes)
  const chinese = invalidUtf8.indexOf(Buffer.from([0xe4, 0xb8, 0xad]))
  expect(chinese).toBeGreaterThan(0)
  invalidUtf8[chinese] = 0xf0
  expect(() => inspectJavaClass(invalidUtf8)).toThrow("Invalid class UTF-8")
  expect(() => inspectJavaClass(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow("exceeds 8 MiB")
})
