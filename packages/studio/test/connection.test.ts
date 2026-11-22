import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createStudioService, publicError } from "../src/main/service"
import { createConnectionStore } from "../src/main/connection-store"
import { ConnectionSettingsSchema, PublicConnectionSchema } from "../src/connection"
import { startChatOnlyProvider } from "./fixtures/chat-only-provider"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("connection schemas expose settings and never require a renderer API key", () => {
  const settings = ConnectionSettingsSchema.parse({
    mode: "api",
    baseUrl: "http://127.0.0.1:4319/v1",
    model: "fixture-model",
    routerModel: "fixture-router",
    moduleModel: "fixture-module",
    transcriptionModel: "fixture-transcribe",
  })
  expect(PublicConnectionSchema.parse({ ...settings, hasApiKey: true, source: "saved" })).not.toHaveProperty("apiKey")
})

test("connection store encrypts API keys before writing and restores them through injected crypto", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-connection-"))
  directories.push(directory)
  const filename = path.join(directory, "connection.json")
  const store = createConnectionStore(filename, {
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  })
  const settings = ConnectionSettingsSchema.parse({
    mode: "api",
    baseUrl: "",
    model: "fixture",
    routerModel: "fixture",
    moduleModel: "fixture",
    transcriptionModel: "fixture",
  })
  await store.save({ settings, apiKey: "private-key" })
  expect(await readFile(filename, "utf8")).not.toContain("private-key")
  expect(await store.load()).toEqual({ settings, apiKey: "private-key" })
})

test("service tests a configured Responses endpoint and saves dynamic API settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-service-connection-"))
  directories.push(directory)
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "GET") return Response.json({ data: [{ id: "fixture-model" }, { id: "fixture-router" }] })
      const body = (await request.json()) as { model?: string; input?: unknown }
      expect(request.method).toBe("POST")
      expect(body.input).toBeDefined()
      if (body.model === "gpt-4.1") return Response.json({ model: "gpt-4.1-2025-04-14", status: "completed" })
      expect(body.model).toBe("fixture-model")
      return Response.json({ model: "fixture-model", status: "completed" })
    },
  })
  const settings = {
    mode: "api" as const,
    baseUrl: `${server.url.origin}/v1`,
    model: "fixture-model",
    routerModel: "fixture-router",
    moduleModel: "fixture-module",
    transcriptionModel: "fixture-transcribe",
  }
  const service = await createStudioService({
    workspaceDirectory: path.join(directory, "projects"),
    runtimeDirectory: path.join(directory, "runtime"),
    templateDirectory: path.join(directory, "templates"),
    ai: { ...settings, apiKey: "private-key" },
  })
  try {
    expect(await service.getConnection()).toMatchObject({ ...settings, hasApiKey: true, source: "environment" })
    await expect(service.testConnection()).resolves.toEqual({ ok: true, model: "fixture-model", status: "completed" })
    await expect(
      service.testConnection({
        ...settings,
        model: "gpt-4.1",
        routerModel: "gpt-4.1",
        moduleModel: "gpt-4.1",
        transcriptionModel: "gpt-4.1",
      }),
    ).resolves.toEqual({ ok: true, model: "gpt-4.1-2025-04-14", status: "completed" })
    await expect(service.listConnectionModels({ baseUrl: settings.baseUrl })).resolves.toEqual([
      "fixture-model",
      "fixture-router",
    ])
    await expect(service.testConnection({ ...settings, baseUrl: "http://127.0.0.1:1/v1" })).rejects.toThrow(
      "NO_API_KEY",
    )
    const saved = await service.saveConnection({ ...settings, apiKey: undefined })
    expect(saved.hasApiKey).toBe(true)
    const mcp = await service.saveConnection({ ...settings, mode: "mcp", apiKey: undefined })
    expect(mcp.hasApiKey).toBe(true)
    await expect(service.testConnection()).rejects.toThrow("SERVICE_UNAVAILABLE")
    await expect(service.testConnection({ ...settings, mode: "api" })).resolves.toEqual({
      ok: true,
      model: "fixture-model",
      status: "completed",
    })
    await expect(service.listConnectionModels({ baseUrl: settings.baseUrl })).resolves.toEqual([
      "fixture-model",
      "fixture-router",
    ])
    expect((await service.saveConnection({ ...settings, clearApiKey: true })).hasApiKey).toBe(false)
  } finally {
    await service.dispose()
    server.stop(true)
  }
})

test("clearing a saved key survives restart even when an environment key is present", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-service-connection-restart-"))
  directories.push(directory)
  const store = createConnectionStore(path.join(directory, "connection.json"), {
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  })
  const options = {
    workspaceDirectory: path.join(directory, "projects"),
    runtimeDirectory: path.join(directory, "runtime"),
    templateDirectory: path.join(directory, "templates"),
    connectionStore: store,
    ai: { apiKey: "environment-key", baseUrl: "", model: "fixture" },
  }
  const first = await createStudioService(options)
  await first.saveConnection({
    mode: "api",
    baseUrl: "",
    model: "fixture",
    routerModel: "fixture",
    moduleModel: "fixture",
    transcriptionModel: "fixture",
    clearApiKey: true,
  })
  await first.dispose()
  const restarted = await createStudioService(options)
  expect((await restarted.getConnection()).hasApiKey).toBe(false)
  expect((await restarted.getConnection()).source).toBe("saved")
  await restarted.dispose()
})

test("failed connection persistence leaves the active configuration untouched", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-service-connection-failure-"))
  directories.push(directory)
  const store = {
    load: async () => null,
    save: async () => {
      throw new Error("storage unavailable")
    },
  }
  const service = await createStudioService({
    workspaceDirectory: path.join(directory, "projects"),
    runtimeDirectory: path.join(directory, "runtime"),
    templateDirectory: path.join(directory, "templates"),
    connectionStore: store,
    ai: { apiKey: "active-key", baseUrl: "", model: "active-model" },
  })
  await expect(
    service.saveConnection({
      mode: "api",
      baseUrl: "",
      model: "new-model",
      routerModel: "new-model",
      moduleModel: "new-model",
      transcriptionModel: "new-model",
    }),
  ).rejects.toThrow("storage unavailable")
  expect((await service.getConnection()).model).toBe("active-model")
  expect((await service.getConnection()).hasApiKey).toBe(true)
  await service.dispose()
})

test("service connects to a Chat-Completions-only provider that has no model catalogue", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-service-connection-chat-"))
  directories.push(directory)
  const provider = await startChatOnlyProvider(() => ({ reply: "pong" }), { model: "qwen-plus-latest" })
  const settings = {
    mode: "api" as const,
    baseUrl: provider.baseUrl,
    model: "qwen-plus",
    routerModel: "qwen-plus",
    moduleModel: "qwen-plus",
    transcriptionModel: "fixture-transcribe",
  }
  const service = await createStudioService({
    workspaceDirectory: path.join(directory, "projects"),
    runtimeDirectory: path.join(directory, "runtime"),
    templateDirectory: path.join(directory, "templates"),
    ai: { ...settings, apiKey: "private-key" },
  })
  try {
    await expect(service.testConnection()).resolves.toEqual({ ok: true, model: "qwen-plus-latest", status: "completed" })
    expect(provider.calls.map((call) => call.path)).toEqual(["/v1/responses", "/v1/chat/completions"])
    expect(provider.calls[1]!.body).toMatchObject({ model: "qwen-plus", messages: [{ role: "user", content: "ping" }] })
    const listing = await service.listConnectionModels({ baseUrl: settings.baseUrl }).catch((error: unknown) => error)
    expect(listing).toBeInstanceOf(Error)
    expect(publicError(listing)).toBe("当前服务没有提供模型列表。")
    // A typed model name still saves and tests without a catalogue.
    const saved = await service.saveConnection({ ...settings, model: "qwen-max", apiKey: undefined })
    expect(saved.model).toBe("qwen-max")
    await expect(service.testConnection()).resolves.toMatchObject({ ok: true, status: "completed" })
  } finally {
    await service.dispose()
    provider.close()
  }
})
