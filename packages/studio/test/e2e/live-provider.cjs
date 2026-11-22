// Opt-in only. Makes one paid request, or reopens an existing workspace without generation.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { _electron, expect } = createRequire(path.resolve('packages/studio/package.json'))('@playwright/test');

(async () => {
  const reopen = process.argv[2] === '--reopen' ? process.argv[3] : undefined;
  if (!reopen && (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL)) throw new Error('Local provider credentials are required');
  const directory = await fs.mkdtemp(path.resolve('.artifacts/studio/live-provider-'));
  console.log('Live provider check artifacts:', directory);
  // Diagnostic recovery: reuse an already-paid response, then allow at most one
  // live repair through the normal app requester. Never used by the application.
  const replay = !reopen && process.env.STUDIO_LIVE_REPLAY_RESPONSE;
  const replayState = { replayed: 0, forwarded: 0 };
  const replayBytes = replay ? await fs.readFile(path.resolve(replay)) : null;
  const replayCorrection = replay && process.env.STUDIO_LIVE_REPLAY_CORRECTION;
  const replayResponses = replayBytes ? [replayBytes, ...(replayCorrection ? [await fs.readFile(path.resolve(replayCorrection))] : [])] : [];
  const providerTransport = replay ? createRequire(path.resolve('packages/ai-service/package.json'))('undici') : null;
  const providerAgent = providerTransport ? new providerTransport.Agent({ headersTimeout: 610000, bodyTimeout: 610000 }) : null;
  const proxy = replayBytes ? require('node:http').createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses' || request.headers.authorization !== `Bearer ${process.env.OPENAI_API_KEY}`) { response.writeHead(403).end(); return; }
    const chunks = [];
    for await (const chunk of request) { chunks.push(chunk); if (chunks.reduce((size, value) => size + value.length, 0) > 1048576) { response.writeHead(413).end(); return; } }
    if (replayState.replayed < replayResponses.length) { const bytes = replayResponses[replayState.replayed++]; response.writeHead(200, { 'Content-Type': 'application/json' }).end(bytes); return; }
    if (replayCorrection) { response.writeHead(429).end(); return; }
    if (replayState.forwarded) { response.writeHead(429).end(); return; }
    replayState.forwarded++;
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    await providerTransport.fetch(`${process.env.OPENAI_BASE_URL.replace(/\/+$/, '')}/responses`, { dispatcher: providerAgent, method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: Buffer.concat(chunks), signal: controller.signal, redirect: 'error' })
      .then(async upstream => { response.writeHead(upstream.status, { 'Content-Type': 'application/json' }).end(Buffer.from(await upstream.arrayBuffer())); })
      .catch(async error => { await fs.writeFile(path.join(directory, 'transport-error.json'), JSON.stringify({ code: error.code, cause_code: error.cause?.code, at: new Date().toISOString() })); response.writeHead(502).end(); });
  }) : null;
  if (proxy) await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const app = await _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.resolve('packages/studio/node_modules/electron/dist/electron.exe'), args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [path.resolve('packages/studio')]), `--user-data-dir=${path.join(directory, 'electron')}`], env: { ...process.env, OPENAI_BASE_URL: proxy ? `http://127.0.0.1:${proxy.address().port}/v1` : process.env.OPENAI_BASE_URL, STUDIO_AI_URL: '', STUDIO_SERVICE_TOKEN: '', MINEMODS_STUDIO_DEBUG_MODEL_DIR: path.join(directory, 'diagnostics'), MINEMODS_STUDIO_TEST: '1', MINEMODS_STUDIO_WORKSPACE: reopen ? path.resolve(reopen) : path.join(directory, 'projects') } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  try {
    const environment = await page.evaluate(() => window.studio.environment());
    if (!reopen) expect(environment.aiConfigured).toBe(true);
    expect(environment.model).toBe('gpt-6-astra');
    if (process.env.OPENAI_API_KEY) expect(JSON.stringify(environment)).not.toContain(process.env.OPENAI_API_KEY);
    if (!reopen) {
    await page.getByRole('button', { name: '开始做', exact: true }).first().click();
    await page.getByLabel('工程名称', { exact: true }).fill('GPT-6 铜羽工坊');
    await page.locator('.create-advanced .fold-summary').click();
    await page.getByLabel('模组 ID', { exact: true }).fill('copper_bird');
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('button', { name: '生物', exact: true }).click();
    await page.getByLabel('生物名称').fill('铜羽小鸟');
    await page.getByRole('button', { name: '开始制作', exact: true }).click();
    await page.getByLabel('跟 AI 说这个模型', { exact: true }).fill(process.env.STUDIO_LIVE_PROMPT || '制作一只可以直接放入 Minecraft 模组的铜羽机械猫头鹰。轮廓圆润而有层次，胸腹分段，眼眶有结构，双翼具有能展开的分节羽片，尾羽、脚掌和爪子完整。像素贴图体现铜片接缝、边缘磨损和克制的铜绿斑纹。动作表现安静观察、行走、受击、起飞、飞行和降落，各动作要有对应的身体协调。保持 Minecraft 体素语言。');
    await page.getByRole('button', { name: '生成模型', exact: true }).click();
    }
    if (reopen) {
      await page.locator('.project-card').filter({ hasText: 'GPT-6 铜羽工坊' }).click();
      await page.getByRole('button', { name: /^铜羽小鸟/ }).click();
    }
    const project = (await page.evaluate(() => window.studio.listProjects()))[0];
    const jobsDirectory = path.join(project.directory, '.minemods/jobs');
    const jobFiles = async () => (await fs.readdir(jobsDirectory).catch(() => [])).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    await expect.poll(async () => (await jobFiles()).length).toBe(1);
    const jobId = (await jobFiles())[0].replace('.json', '');
    await expect.poll(async () => (await page.evaluate(input => window.studio.getJob(input), { projectId: project.project.id, jobId })).state, { timeout: 670000, intervals: [1200] }).toMatch(/completed|failed|canceled|interrupted/);
    const job = await page.evaluate(input => window.studio.getJob(input), { projectId: project.project.id, jobId });
    if (job.state !== 'completed') {
      await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify({ verified_at: new Date().toISOString(), endpoint: process.env.OPENAI_BASE_URL, job_id: jobId, result: job.state, error: job.error }, null, 2));
      throw new Error(`Modeling job ${job.state}: ${job.error}`);
    }
    const view = await page.evaluate(id => window.studio.openProject(id), project.project.id);
    expect(view.model_origin).toBe('gpt-6-astra');
    const asset = view.project.assets.find(asset => asset.id === view.project.entities[0].model_asset_id);
    const stored = JSON.parse(await fs.readFile(path.join(view.directory, '.minemods/assets', asset.id, `${asset.revision}.json`), 'utf8'));
    const data = stored.data;
    expect(data.provenance.model).toBe('gpt-6-astra');
    expect(data.provenance.response_id).toBeTruthy();
    expect(data.usage.total_tokens).toBeGreaterThan(0);
    expect(data.transaction_id).toBe(jobId);
    expect(data.blockbench.elements.length).toBeGreaterThan(3);
    if (process.env.STUDIO_LIVE_QUALITY === '1') {
      expect(data.blockbench.elements.length).toBeGreaterThanOrEqual(24);
      expect(data.design.bones.length).toBeGreaterThanOrEqual(10);
      expect(data.design.animations.length).toBeGreaterThanOrEqual(6);
      expect(data.design.bones.flatMap(bone => bone.cubes).reduce((count, cube) => count + (cube.surface_details?.length ?? 0), 0)).toBeGreaterThanOrEqual(12);
      // Transitions need distinct phases; periodic walk/flight motion is checked
      // against actual native bone poses by verify-generated-motion.cjs.
      expect(data.design.animations.filter(animation => !animation.loop && animation.channels.filter(channel => channel.keyframes.length >= 4 && new Set(channel.keyframes.map(frame => JSON.stringify(frame.rotation))).size > 2).length >= 3).length).toBeGreaterThanOrEqual(3);
    }
    expect(data.blockbench.textures[0].source).toMatch(/^data:image\/png;base64,/);
    if (process.env.OPENAI_API_KEY) expect(JSON.stringify(stored)).not.toContain(process.env.OPENAI_API_KEY);
    await expect(page.getByRole('button', { name: '保存模型', exact: true })).toBeEnabled({ timeout: 30000 });
    await expect(page.frameLocator('iframe').locator('#loading_error_message')).toBeHidden();
    await expect.poll(async () => {
      const native = page.frames().find(frame => frame.url().includes('sessionId='));
      return native ? native.evaluate(() => ({ cubes: window.Cube?.all.length ?? 0, rendered: window.Blockbench?.Preview?.all.some(preview => preview.canvas.isConnected && preview.renderer.info.render.triangles > 100) ?? false })).catch(() => null) : null;
    }, { timeout: 30000 }).toEqual({ cubes: data.blockbench.elements.length, rendered: true });
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeHidden();
    const framing = await page.frames().find(frame => frame.url().includes('sessionId=')).evaluate(() => {
      const preview = Blockbench.Preview.all.filter(preview => preview.canvas.isConnected).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      preview.camera.updateMatrixWorld();
      const projected = Cube.all.flatMap(cube => {
        const box = new THREE.Box3().setFromObject(cube.mesh);
        return [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => new THREE.Vector3(x, y, z).project(preview.camera))));
      });
      return { x: Math.max(...projected.map(point => Math.abs(point.x))), y: Math.max(...projected.map(point => Math.abs(point.y))) };
    });
    expect(framing.x).toBeLessThan(0.95); expect(framing.y).toBeLessThan(0.95);
    await page.screenshot({ path: path.join(directory, 'gpt6-model.png') });
    const report = { verified_at: new Date().toISOString(), verification_mode: reopen ? 'reopen_saved_generation' : 'live_generation', quality_check: process.env.STUDIO_LIVE_QUALITY === '1', endpoint: process.env.OPENAI_BASE_URL, response_model: data.provenance.model, response_id: data.provenance.response_id, usage: data.usage, project_id: view.project.id, directory: view.directory, asset_id: asset.id, native_elements: data.blockbench.elements.length, bones: data.design.bones.length, surface_details: data.design.bones.flatMap(bone => bone.cubes).reduce((count, cube) => count + (cube.surface_details?.length ?? 0), 0), keyframes: data.design.animations.flatMap(animation => animation.channels).reduce((count, channel) => count + channel.keyframes.length, 0), animations: data.blockbench.animations.map(animation => animation.name), result: 'passed' };
    expect(errors).toEqual([]);
    report.framing = framing;
    if (replay) { report.verification_mode = replayCorrection ? 'saved_upstream_responses_compile_recovery' : 'saved_upstream_response_with_live_repair'; report.replay = { source: path.resolve(replay), correction: replayCorrection ? path.resolve(replayCorrection) : undefined, ...replayState }; expect(replayState).toEqual({ replayed: replayCorrection ? 2 : 1, forwarded: replayCorrection ? 0 : 1 }); }
    await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const safe = String(error.stack ?? error).split(process.env.OPENAI_API_KEY).join('[redacted]');
    console.error(safe);
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await app.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    if (providerAgent) await providerAgent.close();
  }
})();
