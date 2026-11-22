const { _electron, expect } = require('@playwright/test')
const { createServer } = require('node:http')
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

async function main() {
  const root = path.resolve(__dirname, '../../../..')
  const studioDir = path.join(root, 'packages/studio')
  const artifacts = path.join(root, '.artifacts/studio')
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, 'model-stream-preview-'))

  let releaseGate
  const gate = new Promise(resolve => { releaseGate = resolve })
  let requestSeen = false
  let fixtureDesign
  const fixture = createServer(async (request, response) => {
    if (request.url !== '/v1/responses') { response.writeHead(404); response.end(); return }
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    const text = input.input?.[0]?.content?.[0]?.text ?? ''
    if (!text.trimStart().startsWith('{')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: input.model, status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ colour: 'red' }) }] }] }))
      return
    }
    requestSeen = true
    const requestData = JSON.parse(text)
    const content = JSON.parse(requestData.content ?? '{}')
    const design = content.previous_design ?? fixtureDesign
    if (!design?.bones?.length) throw new Error('fixture request did not include a usable model design')
    const json = JSON.stringify(design)
    const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
    const firstBone = JSON.stringify(design.bones[0])
    const cut = json.indexOf(firstBone) + firstBone.length
    const send = value => response.write(`data: ${JSON.stringify(value)}\n\n`)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    send({ type: 'response.created', response: { id: 'resp_stream', model: 'gpt-6-astra', status: 'in_progress' } })
    send({ type: 'response.output_text.delta', delta: json.slice(0, cut) })
    await gate
    send({ type: 'response.output_text.delta', delta: json.slice(cut) })
    send({ type: 'response.completed', response: { id: 'resp_stream', model: 'gpt-6-astra', status: 'completed', usage, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: json }] }] } })
    response.end()
  })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const port = fixture.address().port
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studioDir, 'node_modules/electron/dist/electron.exe'),
    args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studioDir]), `--user-data-dir=${path.join(directory, 'electron')}`],
    env: { ...process.env, OPENAI_API_KEY: 'fixture-key', OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`, STUDIO_AI_URL: '', STUDIO_SERVICE_TOKEN: '', MINEMODS_STUDIO_TEST: '1', MINEMODS_STUDIO_WORKSPACE: path.join(directory, 'projects'), MINEMODS_STUDIO_RUNTIME: path.join(directory, 'runtime') },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => console.error('renderer-error', error.message))
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    const sourceFixture = JSON.parse(await readFile(path.join(root, 'packages/studio/test/fixtures/model-quality/forest-creeper.painted.design.json'), 'utf8'))
    const target = await page.evaluate(async sourceFixture => {
      const source = await window.studio.createProject({ name: '流式来源', description: 'local fixture source', empty: false })
      const example = await window.studio.useExample({ projectId: source.project.id, expectedRevision: source.project.revision })
      const sourceView = await window.studio.saveModel({ projectId: example.project.id, expectedRevision: example.project.revision, entityId: example.entity_id, model: sourceFixture })
      const project = await window.studio.createProject({ name: '流式验收', description: 'local streaming fixture', empty: true })
      const view = await window.studio.addEntity({ projectId: project.project.id, expectedRevision: project.project.revision, name: '流式生物' })
      return { projectId: view.project.id, entityId: view.entity_id, sourceModel: sourceView.model }
    }, sourceFixture)
    fixtureDesign = target.sourceModel
    expect(target.sourceModel?.bones?.length).toBeGreaterThan(0)
    await page.reload()
    await page.getByRole('button', { name: /流式验收/ }).click()
    await page.getByRole('navigation', { name: '工程里的东西', exact: true }).getByRole('region', { name: '生物', exact: true }).locator('.inv-slot:not(.inv-empty)').filter({ hasText: '流式生物' }).first().click()
    await expect(page.getByLabel('跟 AI 说这个模型', { exact: true })).toBeVisible()
    await page.getByLabel('跟 AI 说这个模型', { exact: true }).fill('保留结构，验证流式模型制作。')
    await page.getByRole('button', { name: '开始制作', exact: true }).click()
    await expect.poll(() => requestSeen).toBe(true)
    await expect(page.locator('.model-build-events li').filter({ hasText: '搭建' }).first()).toBeVisible({ timeout: 30000 })
    await expect(page.locator('.model-canvas canvas, .model-panel canvas').first()).toBeVisible({ timeout: 30000 })
    await expect(page.locator('iframe')).toHaveCount(0)
    expect((await page.evaluate(id => window.studio.openProject(id), target.projectId)).model).toBeNull()
    await page.screenshot({ path: path.join(directory, 'stream-before-completion.png'), fullPage: true })
    releaseGate()
    await expect(page.getByRole('button', { name: '修改模型', exact: true })).toBeVisible({ timeout: 30000 })
    await expect.poll(async () => (await page.evaluate(id => window.studio.openProject(id), target.projectId)).model?.bones.length ?? 0, { timeout: 30000 }).toBe(target.sourceModel.bones.length)
    await expect.poll(async () => (await page.evaluate(id => window.studio.openProject(id), target.projectId)).model?.animations.length ?? 0, { timeout: 30000 }).toBeGreaterThan(0)
    await page.getByLabel('跟 AI 说这个模型', { exact: true }).fill('确认生成按钮恢复可用。')
    await expect(page.getByRole('button', { name: '修改模型', exact: true })).toBeEnabled()
    await page.screenshot({ path: path.join(directory, 'stream-after-completion.png'), fullPage: true })
    console.log(JSON.stringify({ result: 'passed', directory, iframeCount: await page.locator('iframe').count(), canvasCount: await page.locator('canvas').count(), sourceBones: target.sourceModel.bones.length }))
  } catch (error) {
    await writeFile(path.join(directory, 'failure-body.txt'), await page.locator('body').innerText())
    await page.screenshot({ path: path.join(directory, 'failure.png') })
    throw error
  } finally {
    releaseGate()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
    await app.close().catch(() => {})
    await new Promise(resolve => fixture.close(resolve))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
