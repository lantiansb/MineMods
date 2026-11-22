import { afterEach, expect, test } from "bun:test"
import { createModelingClient } from "../src/client"
import { designFixture } from "./fixture"

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => servers.splice(0).forEach((server) => server.stop(true)))
const input = { step: "model" as const, content: "Create a forest creature", revision: "r0" }

function server(handler: (request: Request) => Response | Promise<Response>) {
  const instance = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  servers.push(instance)
  return instance.url.toString()
}

function result() {
  return {
    design: designFixture(),
    revision: "r0",
    usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    provenance: {
      provider: "openai",
      model: "gpt-6-astra",
      reasoning_effort: "high",
      response_id: "resp_fixture",
      task_id: "t1",
      user_id: "developer-preview",
      created_at: new Date().toISOString(),
      attempt: 1,
    },
  }
}

test("trusted main-process client validates result and revision over the authenticated route", async () => {
  const url = server(async (request) => {
    expect(new URL(request.url).pathname).toBe("/v1/modeling")
    expect(request.headers.get("authorization")).toBe("Bearer local-service-token")
    expect(await request.json()).toEqual(input)
    return Response.json(result())
  })
  expect(
    (await createModelingClient({ url, token: "local-service-token" }).requestModelingStep(input)).design.name,
  ).toBe("Mossling")
})

test("client rejects invalid provenance and stale revision responses", async () => {
  for (const value of [
    { ...result(), revision: "other" },
    { ...result(), provenance: { ...result().provenance, model: "" } },
  ]) {
    const url = server(() => Response.json(value))
    await expect(createModelingClient({ url, token: "token" }).requestModelingStep(input)).rejects.toThrow(
      "INVALID_OUTPUT",
    )
  }
})

test("client validates input and cancellation before dispatch, and never leaks service errors", async () => {
  const url = server(() => {
    throw new Error("Must not dispatch")
  })
  const client = createModelingClient({ url, token: "token" })
  await expect(client.requestModelingStep({ ...input, aiModel: "other" })).rejects.toThrow("INVALID_INPUT")
  const controller = new AbortController()
  controller.abort("private-token")
  await expect(client.requestModelingStep(input, { signal: controller.signal })).rejects.toThrow("CANCELLED")
  const errors = createModelingClient({
    url: server(() => Response.json({ error: { code: "private-token" } }, { status: 502 })),
    token: "token",
  })
  await expect(errors.requestModelingStep(input)).rejects.toThrow("SERVICE_UNAVAILABLE")
})

test("client disallows cleartext remote addresses and unauthenticated configuration", () => {
  expect(() => createModelingClient({ url: "http://example.com", token: "token" })).toThrow("SERVICE_UNAVAILABLE")
  expect(() => createModelingClient({ url: "http://127.0.0.1:4319", token: "" })).toThrow("SERVICE_UNAVAILABLE")
})

test("client rejects oversized streamed success and error bodies before accepting a result", async () => {
  for (const status of [200, 502]) {
    const url = server(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const whitespace = new TextEncoder().encode(" ".repeat(65536))
              Array.from({ length: 33 }).forEach(() => controller.enqueue(whitespace))
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify(status === 200 ? result() : { error: { code: "UPSTREAM_UNAVAILABLE" } }),
                ),
              )
              controller.close()
            },
          }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
    )
    await expect(
      createModelingClient({ url, token: "local-service-token" }).requestModelingStep(input),
    ).rejects.toThrow("INVALID_OUTPUT")
  }
})
