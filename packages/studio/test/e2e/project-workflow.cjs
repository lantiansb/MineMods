const { _electron, expect } = require('@playwright/test')
const { createServer } = require('node:http')
const { mkdir, mkdtemp, readdir, readFile } = require('node:fs/promises')
const path = require('node:path')

const plan = { name: '月雾百科', worldview: '月雾森林由潮湿的银色树冠覆盖，夜间会回应玩家的脚步。', questions: ['月界是否需要独立天空？'], entries: [
  { key: 'moon_deer', kind: 'entity', title: '月鹿', brief: '温和跟随玩家的森林生物。', relationships: ['moon_bark'] },
  { key: 'moon_bark', kind: 'block', title: '呼吸树皮', brief: '夜间微光并回应脚步的方块。', relationships: ['moon_deer'] },
  { key: 'moon_sap', kind: 'item', title: '银色树液', brief: '从树皮获得的自由设计材料。', relationships: [] },
  { key: 'moon_brew', kind: 'recipe', title: '月光酿造', brief: '自由描述的酿造流程。', relationships: ['moon_sap'] },
  { key: 'moon_mist', kind: 'biome', title: '雾林', brief: '低矮月雾覆盖的群系。', relationships: [] },
  { key: 'moon_realm', kind: 'dimension', title: '月界', brief: '森林之外的银色维度。', relationships: [] },
] }

async function waitForReview(directory) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const projectDirectory = path.join(directory, 'projects', (await readdir(path.join(directory, 'projects')))[0] ?? '')
    try {
      const project = JSON.parse(await readFile(path.join(projectDirectory, 'minemods.project.json'), 'utf8'))
      if (project.conception?.review?.entries?.some(entry => entry.key === 'moon_deer')) return project
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('AI review was not persisted within 30 seconds')
}
async function readProject(directory) {
  const projectDirectory = path.join(directory, 'projects', (await readdir(path.join(directory, 'projects')))[0] ?? '')
  return JSON.parse(await readFile(path.join(projectDirectory, 'minemods.project.json'), 'utf8'))
}

async function main() {
  const root = path.resolve(__dirname, '../../../..')
  const studioDir = path.join(root, 'packages/studio')
  const artifacts = path.join(root, '.artifacts/studio')
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, 'project-workflow-'))
  let responseCount = 0
  const fixture = createServer((request, response) => {
    console.log(`fixture ${request.method} ${request.url}`)
    if (request.url?.endsWith('/responses')) {
      const buffers = []
      request.on('data', chunk => buffers.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(buffers).toString())
        const first = String(body.input?.[0]?.content?.[0]?.text ?? '')
        const fields = body.text?.format?.schema?.properties ?? {}
        const output = !first.trimStart().startsWith('{') ? { colour: 'red' } : ('entries' in fields ? plan : { summary: '配方意图清晰，材料与产出仍由玩家决定。', sections: [{ title: '容器', body: '保留自由输入输出名称。' }], questions: ['是否需要消耗容器？'] })
        responseCount += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ model: body.model ?? 'gpt-6-astra', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }))
      })
      return
    }
    response.writeHead(404); response.end()
  })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const app = await _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studioDir, 'node_modules/electron/dist/electron.exe'), args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studioDir]), `--user-data-dir=${path.join(directory, 'electron')}`], env: { ...process.env, OPENAI_API_KEY: 'fixture-key', OPENAI_BASE_URL: `http://127.0.0.1:${fixture.address().port}/v1`, STUDIO_AI_URL: '', STUDIO_SERVICE_TOKEN: '', MINEMODS_STUDIO_TEST: '1', MINEMODS_STUDIO_WORKSPACE: path.join(directory, 'projects'), MINEMODS_STUDIO_RUNTIME: path.join(directory, 'runtime') } })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => console.error('renderer-error', error.message))
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    await page.getByRole('button', { name: '开始做', exact: true }).first().click()
    await page.getByLabel('工程名称').fill('月雾模组')
    await page.locator('.create-advanced .fold-summary').click()
    await page.getByLabel('模组 ID').fill('moon_mist')
    await page.getByRole('button', { name: '创建工程', exact: true }).click()
    await expect(page.getByRole('navigation', { name: '工程里的东西', exact: true })).toBeVisible()
    const legacyId = await page.evaluate(async () => {
      const current = (await window.studio.listProjects())[0]
      await window.studio.saveConception({ projectId: current.project.id, expectedRevision: current.project.revision, conception: { ...current.project.conception, brief: 'Legacy compatibility specimen' } })
      return current.project.id
    })
    await page.reload()
    await page.locator('.project-card').filter({ hasText: '月雾模组' }).click()
    await page.getByRole('button', { name: '高级', exact: true }).click()
    await page.getByRole('button', { name: '旧的构想（不会进游戏）', exact: true }).click()
    await page.screenshot({ path: path.join(directory, 'after-create.png'), fullPage: true })
    await expect(page.getByRole('button', { name: '旧的构想（不会进游戏）', exact: true })).toBeVisible()
    await page.getByLabel('工程构想描述').fill('一座会呼吸的月光森林，月鹿跟随玩家。')
    await page.getByRole('button', { name: 'AI 整理构想', exact: true }).click()
    await waitForReview(directory)
    const jobFiles = await readdir(path.join(directory, 'projects', (await readdir(path.join(directory, 'projects')))[0], '.minemods', 'jobs'))
    const job = JSON.parse(await readFile(path.join(directory, 'projects', (await readdir(path.join(directory, 'projects')))[0], '.minemods', 'jobs', jobFiles[0]), 'utf8'))
    expect(job.state).toBe('completed'); expect(job.error).toBeNull(); expect(job.output.entries).toBe(6)
    await expect(page.getByRole('heading', { name: '世界设定文档', exact: true })).toBeVisible({ timeout: 30000 })
    await expect(page.getByLabel('生物名称', { exact: true })).toHaveValue('月鹿', { timeout: 30000 })
    await page.getByLabel('百科名称').fill('月雾世界百科')
    await page.getByLabel('世界观', { exact: true }).fill('编辑后的月雾森林世界观。')
    await page.locator('.category-nav button').filter({ hasText: '配方' }).click()
    await expect(page.getByLabel('配方名称', { exact: true })).toHaveValue('月光酿造')
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await expect.poll(async () => (await readProject(directory)).entities.length).toBe(1)
    const imported = await readProject(directory)
    expect(imported.entities).toHaveLength(1); expect(imported.conception.entries).toHaveLength(6)
    await page.screenshot({ path: path.join(directory, 'conception-review.png'), fullPage: true })
    await page.getByRole('button', { name: '旧的构想（不会进游戏）', exact: true }).click()
    await page.getByRole('navigation', { name: '构想分类', exact: true }).getByRole('button', { name: /配方/ }).click()
    await page.locator('.encyclopedia-entry').filter({ has: page.getByLabel('配方名称', { exact: true }) }).getByRole('button', { name: '打开草稿', exact: true }).click()
    await expect(page.getByRole('region', { name: '配方工作台' })).toBeVisible()
    for (const index of [1, 3, 5, 7, 9]) await page.getByLabel(`材料格 ${index}`, { exact: true }).fill(`未知材料${index}`)
    await expect(page.locator('datalist, input[list]')).toHaveCount(0)
    await page.getByLabel('合成产物', { exact: true }).fill('自定义月光晶体')
    await page.getByRole('button', { name: '保存设计', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存设计', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '交给 AI 整理', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.studio.listProjects())).some(item => item.project.conception.entries.some(entry => entry.kind === 'recipe' && entry.review)), { timeout: 30000 }).toBe(true)
    await expect(page.getByRole('heading', { name: '整理结果', exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(directory, 'crafting-recipe.png'), fullPage: true })
    const recipeEntry = (await readProject(directory)).conception.entries.find(entry => entry.kind === 'recipe')
    expect(recipeEntry.recipe.input_names).toEqual(['未知材料1', '', '未知材料3', '', '未知材料5', '', '未知材料7', '', '未知材料9'])
    await page.getByLabel('类型', { exact: true }).selectOption('furnace')
    await page.getByLabel('输入', { exact: true }).fill('含月矿石')
    await page.getByLabel('燃料', { exact: true }).fill('冷焰')
    await page.getByLabel('时间', { exact: true }).fill('12 秒')
    await page.getByLabel('合成产物', { exact: true }).fill('月银锭')
    await page.getByRole('button', { name: '保存设计', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存设计', exact: true })).toBeDisabled()
    expect((await readProject(directory)).conception.entries.find(entry => entry.kind === 'recipe').recipe.fuel).toBe('冷焰')
    await page.screenshot({ path: path.join(directory, 'furnace-recipe.png'), fullPage: true })
    await page.getByLabel('类型', { exact: true }).selectOption('custom')
    await page.getByLabel('容器说明', { exact: true }).fill('魔法图书馆。投入空白书和月银墨水，产出记忆书和空瓶；消耗夜间月光。')
    await page.getByLabel('输入 1', { exact: true }).fill('空白书')
    await page.getByRole('button', { name: '+ 添加输入', exact: true }).click()
    await page.getByLabel('输入 2', { exact: true }).fill('月银墨水')
    await page.getByLabel('输出 1', { exact: true }).fill('记忆书')
    await page.getByRole('button', { name: '+ 添加输出', exact: true }).click()
    await page.getByLabel('输出 2', { exact: true }).fill('空瓶')
    await page.getByRole('button', { name: '保存设计', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存设计', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: /返回/ }).first().click()
    await page.getByRole('button', { name: 'MineMods Studio 首页', exact: true }).click()
    await page.locator('.project-card').filter({ hasText: '月雾世界百科' }).click()
    await page.getByRole('button', { name: '旧的构想（不会进游戏）', exact: true }).click()
    await page.getByRole('navigation', { name: '构想分类', exact: true }).getByRole('button', { name: /配方/ }).click()
    await page.locator('.encyclopedia-entry').filter({ has: page.getByLabel('配方名称', { exact: true }) }).getByRole('button', { name: '打开草稿', exact: true }).click()
    await expect(page.getByLabel('输入 2', { exact: true })).toHaveValue('月银墨水')
    await expect(page.getByLabel('输出 2', { exact: true })).toHaveValue('空瓶')
    await page.screenshot({ path: path.join(directory, 'project-workflow.png'), fullPage: true })
    await page.getByRole('navigation', { name: '工程里的东西', exact: true }).getByRole('region', { name: '生物', exact: true }).locator('.inv-slot:not(.inv-empty)').filter({ hasText: '月鹿' }).first().click()
    await page.getByRole('button', { name: '打开它', exact: true }).click()
    // The preview-only example is deliberately never saved. Seed the real example through the supported API before confirming it.
    await page.evaluate(async () => {
      const view = (await window.studio.listProjects())[0];
      await window.studio.useExample({projectId:view.project.id,expectedRevision:view.project.revision});
    })
    await page.reload()
    await page.getByRole('button', { name: 'MineMods Studio 首页', exact: true }).click()
    await page.locator('.project-card').filter({hasText:'月雾世界百科'}).click()
    await page.getByRole('navigation', { name:'工程里的东西',exact:true }).getByRole('region',{name:'生物',exact:true}).locator('.inv-slot:not(.inv-empty)').filter({hasText:'月鹿'}).first().click()
    await expect(page.getByRole('button', { name: '查看生物规则', exact:true })).toBeEnabled()
    await page.getByRole('button', { name: '查看生物规则', exact:true }).click()
    await page.getByLabel('想让它怎么行动', { exact: true }).fill('夜晚跟随玩家，受到攻击时逃跑；停下后播放 idle。')
    await page.getByRole('button', { name: '交给 AI 整理', exact: true }).click()
    await expect(page.getByRole('heading', { name: '整理结果', exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(directory, 'entity-behavior.png'), fullPage: true })
    await page.getByRole('button', { name: /返回/ }).click()
    await expect(page.getByRole('region', { name: '做模型', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '月鹿', exact: true })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html')).setSize(1100, 800))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.screenshot({ path: path.join(directory, 'model-narrow.png'), fullPage: true })
    console.log(JSON.stringify({ result: 'passed', directory, fixture: true, screenshot: path.join(directory, 'project-workflow.png') }))
  } catch (error) { console.error((await page.locator('body').innerText()).slice(0, 14000)); await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }); throw error }
  finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); await new Promise(resolve => fixture.close(resolve)) }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
