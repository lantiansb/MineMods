import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { CAST_SAMPLE_IDS, fireball, frostBreath } from "../script/target-cast-sample"
import { compileAbilityCast } from "../src/fabric/ability-cast"
import { genTarget } from "../src/platform/target"

// Captured from d5089a8: cancelling a recast must not rewrite projects that do not use recasts.
const hashes = {
  "fabric-1.21.1": "ac7f7ecf0058fe9f855b088fd44260d296c3d04c8138e7221c1f84a3acc95066",
  "forge-1.20.1": "350c216eeb8b316e784d680fca41a8b0a259a9469726eebfb0c20c55c7db3aaf",
  "neoforge-1.21.1": "b5aab6e5a4f99353f6f5dbf1e4cf3a0a985125320016bba1d25660bc3dfd02e1",
} as const

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: channel and instant assets without recasts retain the baseline generated files byte for byte`, () => {
    const made = compileAbilityCast({ modId: "frost_hearth", packageName: "com.minemods.content_frost_hearth", abilities: [{ id: CAST_SAMPLE_IDS.frost, document: frostBreath }, { id: CAST_SAMPLE_IDS.fireball, document: fireball }], gestures: [], sounds: {} }, genTarget(target))
    expect(createHash("sha256").update(JSON.stringify(made.files)).digest("hex")).toBe(hashes[target])
  })
}
