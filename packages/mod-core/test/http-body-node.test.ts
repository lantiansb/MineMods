import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

test("Node: HEAD metadata and rejected downloads keep the worker alive without unhandled stream errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-http-node-"))
  try {
    await writeFile(path.join(root, "entry.ts"), `
      import assert from 'node:assert/strict'
      import { createServer } from 'node:http'
      import { javaDownloadSize, downloadVerifiedFile } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/runtime.ts"))}
      import { modrinthJson } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/modrinth.ts"))}
      const server = createServer((req,res) => {
        res.statusCode = req.url === '/ok' ? 200 : 404
        res.setHeader('Content-Length', '1234')
        if (req.method === 'HEAD') return res.end()
        res.flushHeaders()
        const timer = setTimeout(() => res.end('x'.repeat(1234)), 100)
        res.on('close', () => clearTimeout(timer))
      })
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
      const url = 'http://127.0.0.1:' + server.address().port
      try {
        assert.equal(await javaDownloadSize({url:url+'/ok'}),1234)
        assert.equal(await javaDownloadSize({url:url+'/missing'}),null)
        await assert.rejects(downloadVerifiedFile({url:url+'/missing',sha256:'0'.repeat(64),destination:${JSON.stringify(path.join(root, "download.zip"))}}), e => e.message === 'DOWNLOAD_FAILED' && e.cause.message === 'HTTP 404')
        await assert.rejects(modrinthJson(url+'/missing'), /MODRINTH_NOT_FOUND/)
        await new Promise(resolve => setTimeout(resolve,150))
        console.log('Node HTTP regression passed')
      } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve))}
    `)
    const built = await Bun.build({ entrypoints: [path.join(root, "entry.ts")], outdir: root, target: "node", format: "esm" })
    expect(built.success).toBe(true)
    const result = await promisify(execFile)("node", [path.join(root, "entry.js")], { windowsHide: true, timeout: 10000 })
    expect(result.stderr).toBe("")
    expect(result.stdout.trim()).toBe("Node HTTP regression passed")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
