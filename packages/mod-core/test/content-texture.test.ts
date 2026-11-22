import { expect, test } from "bun:test"
import { decodeTextureDataUrl } from "../src/content-texture"
import { compileContent } from "../src/content"

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

test("accepts a real PNG and preserves its source bytes", () => {
  const bytes = decodeTextureDataUrl(png)
  expect(bytes.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(bytes.length).toBe(68)
})

test("rejects a PNG with a broken CRC", () => {
  const bytes = Uint8Array.from(atob(png.split(",")[1]), (value) => value.charCodeAt(0))
  bytes[bytes.length - 5] ^= 1
  const broken = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
  expect(() => decodeTextureDataUrl(broken)).toThrow("校验失败")
})

test("compileContent emits the uploaded PNG bytes unchanged", () => {
  const bytes = decodeTextureDataUrl(png)
  const files = compileContent({ mod_id: "demo", package_name: "com.example", blocks: [{ id: "11111111-1111-4111-8111-111111111111", identifier: "lamp", name: "灯", hardness: 1, luminance: 0, tool: "none", drop: "self", color: "#70a5a2", texture: png }], items: [], recipes: [], logic: [] })
  expect(files["src/main/resources/assets/demo/textures/block/lamp.png"]).toEqual(bytes)
})

test("rejects trailing bytes and a PNG without IDAT", () => {
  const bytes = Uint8Array.from(atob(png.split(",")[1]), (value) => value.charCodeAt(0))
  const trailing = `data:image/png;base64,${btoa(String.fromCharCode(...bytes, 1))}`
  expect(() => decodeTextureDataUrl(trailing)).toThrow()
  const idatStart = 8 + 12 + 13
  const idatLength = new DataView(bytes.buffer).getUint32(idatStart)
  const withoutIdat = new Uint8Array([...bytes.slice(0, idatStart), ...bytes.slice(idatStart + 12 + idatLength)])
  expect(() => decodeTextureDataUrl(`data:image/png;base64,${btoa(String.fromCharCode(...withoutIdat))}`)).toThrow("缺少必要区块")
})
