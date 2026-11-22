const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron, expect } = require('@playwright/test');

async function launch(prefix, suffix = 'source', directory, appDirectory, options = {}) {
  const root = path.resolve(__dirname, '../../../..');
  await fs.mkdir(path.join(root, '.artifacts/studio'), { recursive: true });
  directory ||= await fs.mkdtemp(path.join(root, '.artifacts/studio', prefix));
  const studio = path.join(root, 'packages/studio');
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studio, 'node_modules/electron/dist/electron.exe'),
    args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [appDirectory || studio]), `--user-data-dir=${path.join(directory, suffix, 'electron')}`],
    env: { ...process.env, OPENAI_API_KEY: '', OPENAI_BASE_URL: '', STUDIO_AI_URL: '', STUDIO_SERVICE_TOKEN: '', MINEMODS_STUDIO_TEST: '1', MINEMODS_STUDIO_WORKSPACE: path.join(directory, suffix, 'projects'), MINEMODS_STUDIO_RUNTIME: process.env.MINEMODS_E2E_RUNTIME || path.join(directory, 'runtime') },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForURL('**/index.html');
  if (!options.fresh) await page.evaluate(async () => {
    const { hasApiKey, source, ...settings } = await window.studio.getConnection();
    await window.studio.saveConnection({ ...settings, mode: 'api' });
  });
  await page.reload();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible() && !window.isFocused()))).toBe(true);
  return { app, page, directory, root, errors };
}

async function create(page, name, modId) {
  await page.getByRole('button', { name: '开始做', exact: true }).first().click();
  await page.getByLabel('工程名称', { exact: true }).fill(name);
  await page.locator('.create-advanced .fold-summary').click();
  await page.getByLabel('模组 ID', { exact: true }).fill(modId);
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await page.getByRole('button', { name: '高级', exact: true }).click();
}

async function blank(page, kind, name) {
  await page.getByRole('button', { name: '加一样东西', exact: true }).click();
  await page.getByRole('button', { name: kind, exact: true }).click();
  await page.getByLabel(`${kind}的名字`, { exact: true }).fill(name);
  await page.getByRole('button', { name: '从空白开始', exact: true }).click();
}

async function close(fixture) {
  await fs.writeFile(path.join(fixture.directory, 'renderer-errors.json'), JSON.stringify(fixture.errors, null, 2));
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
  await fixture.app.close();
}

module.exports = { launch, create, blank, close };
