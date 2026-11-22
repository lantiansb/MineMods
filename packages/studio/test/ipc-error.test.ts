import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { unwrappedIpcError, withoutIpcWrapping } from "../src/ipc-error"

test("Electron 的远程调用前缀被去掉，后面写给人的句子原样留下", () => {
  expect(withoutIpcWrapping("Error invoking remote method 'studio:invoke': Error: 方盒「头」放到了组外面。")).toBe("方盒「头」放到了组外面。")
  expect(withoutIpcWrapping("Error invoking remote method 'studio:invoke': TypeError: 这个文件打不开")).toBe("这个文件打不开")
  expect(withoutIpcWrapping("Error invoking remote method 'studio:invoke': 直接一句话")).toBe("直接一句话")
  // Only the transport prefix at the very start goes; the same words inside a sentence are the person's own text.
  expect(withoutIpcWrapping("原话里写了 Error: 这里")).toBe("原话里写了 Error: 这里")
})

test("被拒绝的调用交给界面的是同类错误：消息干净，已经干净的错误原样返回", () => {
  const wrapped = new Error("Error invoking remote method 'studio:invoke': Error: 导入失败了")
  const clean = unwrappedIpcError(wrapped) as Error
  expect(clean).toBeInstanceOf(Error)
  expect(clean.message).toBe("导入失败了")
  const already = new Error("本来就是一句话")
  expect(unwrappedIpcError(already)).toBe(already)
  expect((unwrappedIpcError("Error invoking remote method 'x': Error: 字符串形式") as Error).message).toBe("字符串形式")
})

test("窗口的每一次调用都经过同一个脱壳的入口，没有绕过它的第二条路", () => {
  const preload = readFileSync(path.join(import.meta.dir, "../src/main/preload.ts"), "utf8")
  expect(preload.match(/ipcRenderer\.invoke\(/g)?.length).toBe(1)
  expect(preload).toContain("unwrappedIpcError(cause)")
})
