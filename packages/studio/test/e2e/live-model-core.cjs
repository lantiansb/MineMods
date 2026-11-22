// Opt-in real-provider test. One modeling job, with the production limit of one
// schema correction. Credentials are environment-only and never written to evidence.
const { _electron, expect } = require('@playwright/test')
const fs = require('node:fs/promises')
const path = require('node:path')

// The project tree lists each creature once under 生物.
async function openCreature(page, name) {
  await page
    .getByRole('navigation', { name: '工程里的东西', exact: true })
    .getByRole('region', { name: '生物', exact: true })
    .locator(".tree-entry[data-kind='entity']")
    .filter({ hasText: name })
    .click()
  await expect(page.getByRole('region', { name: '做模型', exact: true })).toBeVisible()
}

// Structural signals worth a human look: symmetry of paired parts, detail density, motion coverage.
function qualitySummary(model) {
  const cubes = model.bones.flatMap(bone => bone.cubes.map(cube => ({ bone: bone.name, ...cube })))
  const paired = model.bones.filter(bone => /left|right|_l$|_r$/i.test(bone.name))
  const mirrorOf = name => name.replace(/left/g, 'right').replace(/Left/g, 'Right')
  const asymmetric = paired
    .filter(bone => /left/.test(bone.name) || /Left/.test(bone.name))
    .map(bone => [bone, model.bones.find(other => other.name === mirrorOf(bone.name))])
    .filter(([left, right]) => !right || Math.abs(left.pivot[0] + right.pivot[0]) > 0.5 || left.pivot[1] !== right.pivot[1])
    .map(([left]) => left.name)
  const animated = new Set(model.animations.flatMap(animation => animation.channels.map(channel => channel.bone)))
  return {
    cubes_per_bone_max: Math.max(...model.bones.map(bone => bone.cubes.length)),
    empty_bones: model.bones.filter(bone => !bone.cubes.length).map(bone => bone.name),
    detailed_cubes: cubes.filter(cube => cube.surface_details.length).length,
    details_total: cubes.reduce((sum, cube) => sum + cube.surface_details.length, 0),
    distinct_face_colors: new Set(cubes.flatMap(cube => Object.values(cube.faces))).size,
    paired_bones: paired.length,
    asymmetric_pairs: asymmetric,
    bones_never_animated: model.bones.filter(bone => !animated.has(bone.name) && bone.parent !== null).map(bone => bone.name),
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL) throw new Error('Real provider credentials are required.')
  const root = path.resolve(__dirname, '../../../..')
  const studio = path.join(root, 'packages/studio')
  await fs.mkdir(path.join(root, '.artifacts/studio'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.artifacts/studio/live-model-core-'))
  const started = Date.now()
  const report = { started_at: new Date().toISOString(), endpoint: process.env.OPENAI_BASE_URL, directory, result: 'running', samples: [] }
  console.log(JSON.stringify({ event: 'started', directory, endpoint: report.endpoint }))
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studio, 'node_modules/electron/dist/electron.exe'),
    args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studio]), `--user-data-dir=${path.join(directory, 'electron')}`],
    env: { ...process.env, STUDIO_AI_URL: '', STUDIO_SERVICE_TOKEN: '', MINEMODS_STUDIO_TEST: '1', MINEMODS_STUDIO_WORKSPACE: path.join(directory, 'projects'), MINEMODS_STUDIO_RUNTIME: path.join(root, '.artifacts/toolchains'), MINEMODS_STUDIO_DEBUG_MODEL_DIR: path.join(directory, 'diagnostics') },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  const persist = () => fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2).replaceAll(process.env.OPENAI_API_KEY, '[REDACTED]'))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    const target = await page.evaluate(async () => {
      const created = await window.studio.createProject({ name: 'GPT-6 实测 · 苔岩狐', modId: 'moss_fox', description: '真实服务联调的隔离工程', empty: true })
      const view = await window.studio.addEntity({ projectId: created.project.id, expectedRevision: created.project.revision, name: '苔岩狐' })
      return { projectId: view.project.id, directory: view.directory, entityId: view.entity_id }
    })
    report.project_id = target.projectId
    await page.reload()
    await page.locator('.project-card').filter({ hasText: 'GPT-6 实测 · 苔岩狐' }).click()
    await openCreature(page, '苔岩狐')
    await page.getByLabel('跟 AI 说这个模型', { exact: true }).fill('制作一只苔岩狐：四足，清晰的吻部、尖耳、胸腹和分节的大尾巴。矿岩灰与克制的苔绿像素斑纹，腹部较浅。尾巴至少三节，四肢关节能分别运动；头部、耳朵和尾部附属几何绑定到正确骨骼。设计 idle、walk、hurt、run、sniff、pounce 六组姿态可辨的动画，行走四足错相，嗅闻低头甩耳，扑击含蓄力与恢复。保持 Minecraft 体素语言，正立站在地面上，面向 -Z。约 36–48 个有用体块、14–20 根骨骼，不要堆无意义小块，贴图细节保持在面边界内。')
    await page.getByRole('button', { name: '开始制作', exact: true }).click()
    const jobsDirectory = path.join(target.directory, '.minemods/jobs')
    await expect.poll(async () => (await fs.readdir(jobsDirectory).catch(() => [])).filter(value => value.endsWith('.json')).length).toBe(1)
    const jobId = (await fs.readdir(jobsDirectory)).find(value => value.endsWith('.json')).replace('.json', '')
    report.job_id = jobId
    let sequence = -1
    let firstDraft = false
    let terminal
    while (Date.now() - started < 660000) {
      const job = await page.evaluate(input => window.studio.getJob(input), { projectId: target.projectId, jobId })
      const progress = await page.evaluate(input => window.studio.getModelProgress(input), { projectId: target.projectId, jobId })
      if (progress && progress.sequence !== sequence) {
        sequence = progress.sequence
        const sample = { elapsed_ms: Date.now() - started, state: job.state, sequence, bones: progress.draft.bones.length, cubes: progress.draft.bones.reduce((sum, bone) => sum + bone.cubes.length, 0), animations: progress.draft.animations.length, complete: progress.complete }
        report.samples.push(sample)
        console.log(JSON.stringify({ event: 'progress', ...sample }))
        await persist()
      }
      if (!firstDraft && job.state === 'running' && progress?.draft.bones.some(bone => bone.cubes.length)) {
        await expect(page.locator('.model-canvas canvas')).toBeVisible()
        await page.screenshot({ path: path.join(directory, 'building.png') })
        firstDraft = true
        report.visible_draft_before_completion = true
      }
      if (['completed', 'failed', 'canceled', 'interrupted'].includes(job.state)) { terminal = job; break }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!terminal) {
      await page.evaluate(input => window.studio.cancelJob(input), { projectId: target.projectId, jobId })
      throw new Error('Real-provider test exceeded its deadline; job canceled.')
    }
    report.job_state = terminal.state
    if (terminal.state !== 'completed') {
      const progress = await page.evaluate(input => window.studio.getModelProgress(input), { projectId: target.projectId, jobId })
      await fs.writeFile(path.join(directory, 'unaccepted-draft.json'), JSON.stringify(progress?.draft ?? null, null, 2))
      throw new Error(terminal.error || `Job ${terminal.state}`)
    }
    await expect(page.getByRole('button', { name: '修改模型', exact: true })).toBeVisible()
    const view = await page.evaluate(id => window.studio.openProject(id), target.projectId)
    expect(['gpt-6-astra', 'ai']).toContain(view.model_origin)
    const assetId = view.project.entities.find(value => value.id === target.entityId).model_asset_id
    const asset = view.project.assets.find(value => value.id === assetId)
    const stored = JSON.parse(await fs.readFile(path.join(target.directory, '.minemods/assets', assetId, `${asset.revision}.json`), 'utf8'))
    expect(typeof stored.data.provenance.model).toBe('string')
    expect(stored.data.provenance.reasoning_effort).toBeTruthy()
    expect(stored.data.usage.total_tokens).toBeGreaterThan(0)
    report.provenance = stored.data.provenance
    report.usage = stored.data.usage
    report.model = { bones: view.model.bones.length, cubes: view.model.bones.reduce((sum, bone) => sum + bone.cubes.length, 0), texture_size: view.model.texture_size, surface_details: view.model.bones.flatMap(bone => bone.cubes).reduce((sum, cube) => sum + cube.surface_details.length, 0), animations: view.model.animations.map(animation => ({ name: animation.name, channels: animation.channels.length, frames: animation.channels.reduce((sum, channel) => sum + channel.keyframes.length, 0) })) }
    report.quality = qualitySummary(view.model)
    await fs.writeFile(path.join(directory, 'model.json'), JSON.stringify(view.model, null, 2))
    await persist()
    await page.screenshot({ path: path.join(directory, 'model.png') })
    await page.getByRole('navigation', { name: '生物制作流程', exact: true }).getByRole('button', { name: '动画' }).click()
    await page.getByLabel('选择动画', { exact: true }).selectOption('walk')
    await page.screenshot({ path: path.join(directory, 'animation.png') })
    // One still per motion so the poses can be reviewed side by side.
    for (const name of report.model.animations.map(value => value.name)) {
      await page.getByLabel('选择动画', { exact: true }).selectOption(name)
      await page.getByRole('slider', { name: '动作时间', exact: true }).click({ position: { x: 60, y: 10 } })
      await page.screenshot({ path: path.join(directory, `pose-${name}.png`) })
    }
    await page.getByRole('navigation', { name: '生物制作流程', exact: true }).getByRole('button', { name: '外观' }).click()
    await page.getByRole('button', { name: 'UV', exact: true }).click()
    await expect(page.locator('.model-canvas-uv img')).toBeVisible()
    await page.screenshot({ path: path.join(directory, 'uv.png') })
    await page.reload()
    await page.locator('.project-card').filter({ hasText: 'GPT-6 实测 · 苔岩狐' }).click()
    await openCreature(page, '苔岩狐')
    await expect(page.locator('.model-canvas canvas')).toBeVisible()
    expect((await page.evaluate(id => window.studio.openProject(id), target.projectId)).project.entities[0].model_asset_id).toBe(assetId)
    await page.screenshot({ path: path.join(directory, 'reopened.png') })
    report.result = 'passed'
    report.reopened = true
  } catch (error) {
    report.result = 'failed'
    report.error = String(error.message).replaceAll(process.env.OPENAI_API_KEY, '[REDACTED]')
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {})
    process.exitCode = 1
  } finally {
    report.elapsed_ms = Date.now() - started
    await persist()
    console.log(JSON.stringify({ event: 'finished', ...report, samples: report.samples.length }))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
    await app.close()
  }
}

main().catch(error => { console.error(String(error.message).replaceAll(process.env.OPENAI_API_KEY || 'NO_CREDENTIAL', '[REDACTED]')); process.exitCode = 1 })
