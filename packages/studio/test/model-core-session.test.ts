import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createModelCoreSession } from "../src/main/model-core-session"
import { createStudioService } from "../src/main/service"
import { designFixture } from "../../studio-ai/test/fixture"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { blockbenchFaceUV } from "../src/renderer/model-core/blockbench-uv"
import { blockbenchInterpolate } from "../src/renderer/model-core/blockbench-animation"

test("portable MCP tools stage edits without changing the previous asset and lock on completion", () => {
  const previous = designFixture()
  const session = createModelCoreSession(previous)
  const call = (name: string, args: unknown) =>
    session.call({
      jsonrpc: "2.0",
      id: session.read().sequence,
      method: "tools/call",
      params: { name, arguments: args },
    })
  call("model.begin", { name: "Tail edit", texture_size: 128 })
  call("model.upsert_bone", { ...previous.bones[0], pivot: [1, 2, 3] })
  expect(previous.bones[0].pivot).not.toEqual([1, 2, 3])
  expect(session.read().draft.bones.find((bone) => bone.name === previous.bones[0].name)?.pivot).toEqual([1, 2, 3])
  expect(() => call("model.finish", { ...previous, bones: [] })).toThrow()
  expect(session.read().complete).toBe(false)
  call("model.finish", previous)
  expect(() => call("model.begin", { name: "again", texture_size: 64 })).toThrow("complete")
  expect(() => call("eval", { script: "anything" })).toThrow()
})

test("extracted UV kernel preserves mirrored rectangles and quarter turns", () => {
  expect(blockbenchFaceUV([16, 0, 0, 8], [32, 32])).toEqual([
    [0.5, 1],
    [0, 1],
    [0.5, 0.75],
    [0, 0.75],
  ])
  expect(blockbenchFaceUV([0, 0, 16, 8], [32, 32], 90)).toEqual([
    [0, 0.75],
    [0, 1],
    [0.5, 0.75],
    [0.5, 1],
  ])
  expect(
    blockbenchInterpolate(
      [
        { time: 0, value: [0, 0, 0] },
        { time: 1, value: [20, 0, 0] },
      ],
      2,
    ),
  ).toEqual([20, 0, 0])
  expect(
    blockbenchInterpolate(
      [
        { time: 0, value: [0, 0, 0], interpolation: "step" },
        { time: 1, value: [20, 0, 0] },
      ],
      0.5,
    ),
  ).toEqual([0, 0, 0])
})

for (const cancel of [false, true])
  test(`real SSE → portable MCP → draft ${cancel ? "cancels safely" : "commits only after completion"}`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-model-stream-"))
    // What the fixture AI answers has to pass the look gate, like any AI answer.
    const design = ModelDesignSchema.parse({ ...slime.model, name: "SSE 修订模型" })
    const json = JSON.stringify(design)
    const cut = json.indexOf(JSON.stringify(design.bones[0])) + JSON.stringify(design.bones[0]).length
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async () => {
        let closed = false
        return new Response(
          new ReadableStream({
            async start(controller) {
              const send = (event: unknown) => {
                if (!closed) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
              }
              send({ type: "response.created", response: { model: "gpt-6-astra" } })
              send({ type: "response.output_text.delta", delta: json.slice(0, cut) })
              await gate
              if (closed) return
              send({ type: "response.output_text.delta", delta: json.slice(cut) })
              send({
                type: "response.completed",
                response: {
                  id: "fixture-response",
                  model: "gpt-6-astra",
                  status: "completed",
                  usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
                  output: [
                    {
                      type: "message",
                      role: "assistant",
                      status: "completed",
                      content: [{ type: "output_text", text: json }],
                    },
                  ],
                },
              })
              controller.close()
            },
            cancel() {
              closed = true
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        )
      },
    })
    const service = await createStudioService({
      workspaceDirectory: path.join(directory, "projects"),
      runtimeDirectory: path.join(directory, "runtime"),
      templateDirectory: path.join(directory, "templates"),
      ai: { apiKey: "local-fixture", baseUrl: `${server.url.origin}/v1` },
    })
    try {
      const created = await service.createProject({ name: "尾巴修改", description: "保留模型" })
      const before = await service.useExample({
        projectId: created.project.id,
        expectedRevision: created.project.revision,
      })
      const task = {
        projectId: before.project.id,
        ...(await service.generateModel({
          projectId: before.project.id,
          expectedRevision: before.project.revision,
          prompt: "尾巴加粗",
        })),
      }
      for (
        let attempt = 0;
        attempt < 100 &&
        !(await service.getModelProgress(task))?.events.some((event) => event.tool === "model.upsert_bone");
        attempt += 1
      )
        await Bun.sleep(20)
      expect((await service.getModelProgress(task))?.events.some((event) => event.tool === "model.upsert_bone")).toBe(
        true,
      )
      expect((await service.openProject(before.project.id)).project.revision).toBe(before.project.revision)
      if (cancel) await service.cancelJob(task)
      release!()
      for (
        let attempt = 0;
        attempt < 100 && ["queued", "running"].includes((await service.getJob(task)).state);
        attempt += 1
      )
        await Bun.sleep(20)
      const after = await service.openProject(before.project.id)
      expect((await service.getJob(task)).state).toBe(cancel ? "canceled" : "completed")
      expect(after.project.revision).toBe(cancel ? before.project.revision : before.project.revision + 1)
      expect(after.model?.name).toBe(cancel ? before.model?.name : design.name)
    } finally {
      release?.()
      await service.dispose()
      server.stop(true)
      await rm(directory, { recursive: true, force: true })
    }
  }, 15000)
