const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { expect } = require('@playwright/test');
const { launch, create, blank, close } = require('./desktop-fixture.cjs');
const { unzipSync } = createRequire(path.resolve(__dirname, '../../../mod-core/package.json'))('fflate');

(async () => {
  const fixture = await launch('build-share-current-');
  const { app, page, directory, root } = fixture;
  const archive = path.join(directory, '像素工坊.minemods');
  const texturePath = path.join(root, 'packages/studio/src/renderer/assets/minecraft/1.21.1/block/cobblestone.png');
  let saved;
  try {
    await create(page, '像素工坊', 'pixel_workshop');
    await blank(page, '方块', '试作石灯');
    await page.getByLabel('标识符', { exact: true }).fill('stone_lamp');
    await page.getByLabel('发光', { exact: true }).fill('12');
    await page.locator('.ae-picture input[type=file]').setInputFiles(texturePath);
    await expect(page.getByAltText('现在的图案')).toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.studio.listProjects()))[0].project.blocks.length).toBe(1);
    saved = await page.evaluate(async () => {
      const view = (await window.studio.listProjects())[0];
      const recipes = ['minecraft:cobblestone', 'minecraft:stone'].map(material => ({ id: crypto.randomUUID(), name: material, pattern: [material, null, null, null, null, null, null, null, null], result: 'pixel_workshop:stone_lamp', count: 1 }));
      return window.studio.saveContent({ projectId: view.project.id, expectedRevision: view.project.revision, content: { blocks: view.project.blocks, items: [], recipes, logic: [] } });
    });
    expect(Buffer.from(saved.project.blocks[0].texture.split(',')[1], 'base64')).toEqual(await fs.readFile(texturePath));
    await page.reload();
    await page.locator('.project-card').filter({ hasText: '像素工坊' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html')).webContents.send('studio:command', 'export'));
    await page.getByRole('button', { name: '打包，不打开游戏', exact: true }).click();
    const jobDirectory = path.join(saved.directory, '.minemods/jobs');
    await expect.poll(async () => (await fs.readdir(jobDirectory).catch(() => [])).length).toBe(1);
    const jobId = (await fs.readdir(jobDirectory))[0].replace('.json', '');
    await expect.poll(async () => (await page.evaluate(input => window.studio.getJob(input), { projectId: saved.project.id, jobId })).state, { timeout: 240000, intervals: [1000] }).toMatch(/completed|failed|canceled/);
    const job = await page.evaluate(input => window.studio.getJob(input), { projectId: saved.project.id, jobId });
    await fs.writeFile(path.join(directory, 'build-job.json'), JSON.stringify(job, null, 2));
    expect(job.state, job.error).toBe('completed');
    const zip = unzipSync(await fs.readFile(job.output.jarPath));
    expect(Object.keys(zip).filter(name => name.startsWith('data/pixel_workshop/recipe/') && name.endsWith('.json'))).toHaveLength(2);
    expect(zip['data/pixel_workshop/loot_table/blocks/stone_lamp.json']).toBeTruthy();
    expect(zip['data/minecraft/tags/block/mineable/pickaxe.json']).toBeTruthy();
    expect(Buffer.from(zip['assets/pixel_workshop/textures/block/stone_lamp.png'])).toEqual(await fs.readFile(texturePath));
    expect(JSON.parse(Buffer.from(zip['assets/pixel_workshop/lang/zh_cn.json']).toString())['block.pixel_workshop.stone_lamp']).toBe('试作石灯');
    console.log('PASS: real Gradle JAR recipes, loot, mining tags, names and original PNG bytes');
    await app.evaluate(({ dialog }, archive) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: archive }); }, archive);
    await page.getByRole('button', { name: /工程文件 .minemods/ }).click();
    await expect.poll(() => fs.stat(archive).then(value => value.size).catch(() => 0)).toBeGreaterThan(100);
    await expect(page.getByRole('button', { name: '打开开发环境的游戏', exact: true })).toBeEnabled();
    await page.screenshot({ path: path.join(directory, 'build.png') });
    if (process.env.STUDIO_E2E_PLAYTEST === '1') {
      await page.getByRole('button', { name: '打开开发环境的游戏', exact: true }).click();
      const clientLog = path.join(job.output.sourceDirectory, 'run/logs/latest.log');
      await expect.poll(async () => { const log = await fs.readFile(clientLog, 'utf8').catch(() => ''); return log.includes('OpenAL initialized') && /Created:.*textures\/atlas\/blocks\.png-atlas/.test(log); }, { timeout: 150000, intervals: [1000] }).toBe(true);
      await fs.copyFile(clientLog, path.join(directory, 'client-initialized.log'));
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByRole('button', { name: '打开开发环境的游戏', exact: true })).toBeEnabled({ timeout: 20000 });
    }
    expect(fixture.errors).toEqual([]);
  } catch (error) {
    console.error(error.stack, await page.locator('body').innerText());
    await page.screenshot({ path: path.join(directory, 'failure.png') });
    process.exitCode = 1;
  } finally { await close(fixture); }
  if (process.exitCode) { console.log('artifacts', directory); return; }
  const imported = await launch('build-share-current-', 'imported', directory);
  try {
    await imported.app.evaluate(({ dialog }, archive) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] }); }, archive);
    await imported.page.getByRole('button', { name: /^导入工程/ }).click();
    await expect(imported.page.getByRole('button', { name: '导入工程', exact: true })).toBeEnabled();
    await imported.page.getByRole('button', { name: '导入工程', exact: true }).click();
    await expect(imported.page.getByText('工程已导入', { exact: true })).toBeVisible();
    await expect.poll(async () => (await imported.page.evaluate(() => window.studio.listProjects())).length).toBe(1);
    await expect(imported.page.getByRole('button', { name: '像素工坊', exact: true })).toBeVisible();
    const restored = (await imported.page.evaluate(id => window.studio.openProject(id), saved.project.id)).project;
    expect(restored).toEqual(saved.project);
    expect(imported.errors).toEqual([]);
    await imported.page.screenshot({ path: path.join(directory, 'import.png') });
    console.log('PASS: .minemods export/import into fresh workspace preserves all project data');
  } catch (error) { console.error(error.stack, await imported.page.locator('body').innerText()); process.exitCode = 1; }
  finally { await close(imported); console.log('artifacts', directory); }
})();
