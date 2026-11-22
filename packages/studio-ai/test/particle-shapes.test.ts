import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { SHAPES, shapePixels } from "../src/particle-shapes"

const frozen = {
  dot: "4838e287a6ad9b6ac8cabb075b80de313299fc1d9539a57d939dc3cf105c846c",
  glint: "c6495b847e2a0a25a7d1a1b4f18c7fce3b6fd3bc5032f6bcf1db14563c11fdab",
  spark: "11a621119ea8af84dfc05efbabdbe9fb53717a7261b254f54570319329e78ee9",
  ember: "b2e34000dc9551d19e4afc47517b3ed14ae2959bccc485c45ef7ee842c0e792f",
  mist: "eae0330db5015f682933f4b715828114aaca86e6274e98b6c179d25e8cb805aa",
  puff: "3868b9476acc0ede556f51ef0a492f65ee15a52d3c4fe25fbe6a467f6486fc1a",
  wisp: "4765b27413eadadc0e0b76f75dce37dcc063d4883a1bdef91634bd8749ae2475",
  streak: "61f85c194b2324df1d76c4631c2f99d963b8efabfcfd99ab8a9448c0b615fb3f",
  shard: "f9cc1ba6c06507bfa5a8d0438650489b31f8e9fc936a717cbf0b6edfabf7ff05",
  ring: "8e4ecf2a637a72f1f6d1694d11a55e3ce200ff03860475e03095e74bc6a4d66f",
  drop: "725d124993b911dae4238318fbd2f9f246fd32ee4d8a4743ba93a450f97ca371",
  flake: "0adc4464421930923e693d468c94e74b534fb19db08a4ce83b1bcad3430bda8d",
  bolt: "6f7308b77982a89ba7e3e76f650f5ee5d0e39bae0418aea6b6e56dbac01a6bc5",
  arc: "4f1393469b5f65511e98ea5644fed7154be271ed65b565f09b35cd99cb8d563f",
}
for (const shape of SHAPES)
  test(shape, () => {
    const { pixels } = shapePixels({ shape, seed: 3 })
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(frozen[shape])
    if (shape === "mist") expect(new Set(pixels.filter((_,i)=>i%4===3)).size).toBeGreaterThan(32)
    else expect(pixels.every((v, i) => i % 4 !== 3 || [0, 85, 170, 255].includes(v))).toBe(true)
  })
