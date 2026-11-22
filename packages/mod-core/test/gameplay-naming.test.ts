import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import { expandGameWildcards, gameWildcards, jarClassIndex } from "../src/gameplay-naming"

const index = new Map([
  ["net.minecraft.entity", new Set(["Entity", "LivingEntity", "EntityType", "Unused"])],
  ["net.minecraft.util.math", new Set(["MathHelper", "Vec3d", "BlockPos"])],
])

test("通配 import 换成文件里真用到的类；没用到的整行去掉；游戏里没有的包原样留下并报出来", () => {
  const source = [
    "package com.minemods.content_x.gameplay.guard;",
    "",
    "import net.minecraft.entity.*;",
    "import net.minecraft.util.math.*;",
    "import net.minecraft.made.up.*;",
    "import java.util.*;",
    "",
    "// Entity in a comment does not count, nor \"EntityType\" in a string.",
    "class Guard { LivingEntity target; Vec3d at = Vec3d.ZERO; String name = \"EntityType\"; }",
  ].join("\n")
  expect(gameWildcards(source)).toEqual(["net.minecraft.entity", "net.minecraft.util.math", "net.minecraft.made.up"])
  const result = expandGameWildcards(source, index)
  expect(result.content).toContain("import net.minecraft.entity.LivingEntity;\nimport net.minecraft.util.math.Vec3d;")
  expect(result.content).not.toContain("net.minecraft.entity.*")
  expect(result.content).not.toContain("net.minecraft.entity.EntityType;")
  expect(result.content).not.toContain("net.minecraft.entity.Entity;")
  expect(result.content).toContain("import net.minecraft.made.up.*;")
  expect(result.content).toContain("import java.util.*;")
  expect(result).toMatchObject({ expanded: 2, unknown: ["net.minecraft.made.up"] })
  const unused = expandGameWildcards("import net.minecraft.util.math.*;\n\nclass A {}\n", index)
  expect(unused.content).toBe("\nclass A {}\n")
})

test("从游戏包里读出每个包有哪些顶层类，内部类不算", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-命名-"))
  try {
    const jar = path.join(directory, "game.jar")
    const empty = new Uint8Array(0)
    await writeFile(jar, zipSync({ "net/minecraft/entity/Entity.class": empty, "net/minecraft/entity/Entity$Removal.class": empty, "net/minecraft/util/math/Vec3d.class": empty, "META-INF/MANIFEST.MF": empty }))
    const read = await jarClassIndex(jar)
    expect([...read.get("net.minecraft.entity")!]).toEqual(["Entity"])
    expect([...read.get("net.minecraft.util.math")!]).toEqual(["Vec3d"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
