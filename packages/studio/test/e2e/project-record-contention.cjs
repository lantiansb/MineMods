/** Two real stdio MCP clients share the real Electron NodeService. Pass a fresh fixture directory. */
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { setTimeout: sleep } = require("node:timers/promises")
const { launch, close } = require("./desktop-fixture.cjs")

const texture = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAvUlEQVR4nJVTqxFCQRDbYugERQMYJAKBYwaFQz6BoABqoovXwzPHRGQnB9m5h9iJuNsk+4v94dhO50sjIq63eyJiejwTEfhLDE0GajJQk4GaDAxNnualbV/vttn94SCV5qUjQKiivqloUEkJGFR05CRJB3ywDgx5OtAalYA1Ihw5nceoy1RSAp1SjLo82pOoFN1I3V6EU3Rdr/bCOnBdLx24GquRuoUqb0EJOtvi7OcW1lyjEne3sPb6vh1/ABwPaVuyZ52PAAAAAElFTkSuQmCC"

async function main(directory, duration) {
  process.env.MINEMODS_STUDIO_LOOKS = "off"
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const projects = path.join(directory, "source/projects")
  await fs.mkdir(projects, { recursive: true })
  await fs.writeFile(path.join(projects, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
  const fixture = await launch("manifest-load-", "source", directory)
  const clients = []
  try {
    const config = await fixture.page.evaluate(async () => {
      const project = await window.studio.createProject({ name: "并发保存验证", modId: "record_load", description: "", empty: true })
      const seeded = await window.studio.saveContent({
        projectId: project.project.id, expectedRevision: project.project.revision,
        content: {
          blocks: Array.from({ length: 80 }, (_, index) => ({
            id: crypto.randomUUID(), name: "并发样本 " + index, identifier: "load_" + index, hardness: 1,
            luminance: 0, tool: "pickaxe", drop: "self", color: "#668877", texture: "x".repeat(5700),
          })),
          items: [], logic: [], recipes: [],
        },
      })
      const { hasApiKey, source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp", review: true })
      const { configuration } = await window.studio.getMcpStatus()
      return { projectId: seeded.project.id, directory: seeded.directory, configuration }
    })
    const server = JSON.parse(config.configuration).mcpServers["minemods-studio"]
    const connect = async name => {
      const client = new Client({ name, version: "1" })
      clients.push(client)
      await client.connect(new StdioClientTransport({ ...server, stderr: "pipe" }))
      return async (name, args) => {
        const result = await client.callTool({ name, arguments: args })
        const content = result.content.find(item => item.type === "text")?.text
        if (result.isError || !content) throw new Error(name + ": " + content)
        return JSON.parse(content)
      }
    }
    const maker = await connect("fixture-maker")
    const reviewer = await connect("fixture-reviewer")
    const projectId = config.projectId
    const file = path.join(config.directory, "minemods.project.json")
    const original = JSON.parse(await fs.readFile(file, "utf8"))
    const stats = { commits: 0, inspections: 0, reviewerReads: 0, errors: [] }
    console.log(JSON.stringify({ duration, bytes: (await fs.stat(file)).size, originalRevision: original.revision }))
    const start = Date.now()
    const keepGoing = () => Date.now() < start + duration
    await Promise.all([
      (async () => {
        for (let i = 0; keepGoing(); i++) {
          try {
            const opened = await maker("open_project", { projectId })
            const title = "验证方块 " + i
            const document = { kind: "block", identifier: "saved_" + i, name: title, hardness: 2, luminance: 0, tool: "pickaxe", drop: "self", color: "#526d4d", texture }
            const { run } = await maker("plan_run", {
              projectId, expectedRevision: opened.project.revision, prompt: "制作" + title,
              plan: { summary: title, questions: [], tasks: [{ key: "block", module: "block", title, prompt: "制作" + title, source: title, dependencies: [], target_id: null }] },
            })
            const ids = { projectId, runId: run.id, taskId: run.tasks[0].id }
            await maker("claim_task", ids)
            const saved = await maker("commit_task", { ...ids, document, provenance: { client: "load-fixture", verified: false } })
            assert.equal(saved.state, "completed")
            stats.commits++
          } catch (error) {
            stats.errors.push(String(error))
            console.error(String(error))
          }
          await sleep(Math.min(4000, Math.max(0, start + duration - Date.now())))
        }
      })(),
      (async () => {
        while (keepGoing()) {
          try {
            await reviewer("next_inspection", { projectId, wait_seconds: 0 })
            if (++stats.inspections % 5 === 0) {
              await reviewer("open_project", { projectId, detail: "summary" })
              stats.reviewerReads++
            }
          } catch (error) {
            stats.errors.push(String(error))
            console.error(String(error))
            await sleep(500)
          }
        }
      })(),
    ])
    const final = JSON.parse(await fs.readFile(file, "utf8"))
    console.log(JSON.stringify({ elapsed: Date.now() - start, ...stats, revision: final.revision, assets: final.workspace.assets.length }))
    assert(stats.commits > 0 && stats.inspections > 0)
    assert.equal(final.revision, original.revision + stats.commits)
    assert.equal(final.workspace.assets.length, original.workspace.assets.length + stats.commits)
    assert.deepEqual(stats.errors, [])
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await close(fixture)
  }
}

main(process.argv[2], Number(process.argv[3] ?? 600000)).catch(error => {
  console.error(error)
  process.exitCode = 1
})
