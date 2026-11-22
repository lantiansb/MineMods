import { beforeEach, expect, test } from "bun:test"
import { forgetMissingPictureRoutes, IMAGE_MODEL, pictureCanBeAsked, pictureModel, pictureRoute, requestPicture } from "../src/image-request"

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

test("画图的模型名：连接里写了就用它，没写（以前存下的设置）就用 gpt-image-1", async () => {
  expect(pictureModel()).toBe(IMAGE_MODEL)
  expect(pictureModel("  ")).toBe("gpt-image-1")
  expect(pictureModel(" my-image-model ")).toBe("my-image-model")
  const bodies: Record<string, unknown>[] = []
  const transport = async (_url: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>), Response.json({ data: [{ b64_json: PIXEL }] }))
  const signal = AbortSignal.timeout(5000)
  expect(await requestPicture({ baseUrl: "https://example.test/v1", apiKey: "key", model: "my-image-model", prompt: "x", signal, transport })).toBe(`data:image/png;base64,${PIXEL}`)
  expect(await requestPicture({ baseUrl: "https://example.test/v1", apiKey: "key", prompt: "x", signal, transport })).not.toBeNull()
  expect(bodies.map((body) => body.model)).toEqual(["my-image-model", IMAGE_MODEL])
})

test("能不能画，事先说的和真去画的是同一条规则：Codex 路线和不安全的地址画不了", async () => {
  expect(pictureRoute("https://example.test/v1/")).toBe("https://example.test/v1/images/generations")
  expect(pictureRoute("https://chatgpt.com/backend-api/codex")).toBeNull()
  expect(pictureRoute("http://example.test/v1")).toBeNull()
  expect(pictureRoute("not a url")).toBeNull()
  // No address: the default provider, as every other request of the connection.
  expect(pictureRoute("")).toMatch(/\/images\/generations$/)
  let called = 0
  const transport = async () => (called++, Response.json({ data: [{ b64_json: PIXEL }] }))
  expect(await requestPicture({ baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "key", prompt: "x", signal: AbortSignal.timeout(5000), transport })).toBeNull()
  expect(called).toBe(0)
})

beforeEach(() => forgetMissingPictureRoutes())

/** A connection whose provider answers with `status` to every picture request, and how many times it was asked. */
const answering = (status: number) => {
  const asked: string[] = []
  const transport = async (url: string, init: RequestInit) => (asked.push(`${url} ${(JSON.parse(String(init.body)) as { model: string }).model}`), new Response("", { status }))
  return { asked, transport }
}
const draw = (transport: (url: string, init: RequestInit) => Promise<Response>, options: { baseUrl?: string; model?: string } = {}) =>
  requestPicture({ baseUrl: options.baseUrl ?? "https://api.deepseek.test/v1", apiKey: "key", model: options.model, prompt: "x", signal: AbortSignal.timeout(5000), transport })

test("接口明确回了「不存在」（404/405/501）：本次运行里记住，后面的任务不再请求画图", async () => {
  for (const status of [404, 405, 501]) {
    forgetMissingPictureRoutes()
    const { asked, transport } = answering(status)
    expect(pictureCanBeAsked("https://api.deepseek.test/v1")).toBe(true)
    expect(await draw(transport)).toBeNull()
    expect(asked).toHaveLength(1)
    // The next task: nothing is asked again, and beforehand it is said that the route cannot draw.
    expect(pictureCanBeAsked("https://api.deepseek.test/v1")).toBe(false)
    expect(await draw(transport)).toBeNull()
    expect(await draw(transport)).toBeNull()
    expect(asked).toHaveLength(1)
  }
})

test("换了地址或画图模型，重新判断：记住的只是原来那个地址加那个模型", async () => {
  const { asked, transport } = answering(404)
  await draw(transport)
  await draw(transport, { baseUrl: "https://api.deepseek.test/v1/" })
  expect(asked).toEqual(["https://api.deepseek.test/v1/images/generations gpt-image-1"])
  await draw(transport, { baseUrl: "https://other.test/v1" })
  await draw(transport, { model: "my-image-model" })
  expect(asked).toEqual([
    "https://api.deepseek.test/v1/images/generations gpt-image-1",
    "https://other.test/v1/images/generations gpt-image-1",
    "https://api.deepseek.test/v1/images/generations my-image-model",
  ])
  expect(pictureCanBeAsked("https://other.test/v1", "another-model")).toBe(true)
})

test("401、429、5xx 不算「不支持」：下次照样请求", async () => {
  for (const status of [401, 403, 429, 500, 502, 503]) {
    const { asked, transport } = answering(status)
    await draw(transport)
    await draw(transport)
    expect(asked).toHaveLength(2)
    expect(pictureCanBeAsked("https://api.deepseek.test/v1")).toBe(true)
  }
  // A connection that was offline is no evidence either.
  let attempts = 0
  const offline = async () => (attempts++, Promise.reject(new Error("offline")))
  await draw(offline)
  await draw(offline)
  expect(attempts).toBe(2)
})
