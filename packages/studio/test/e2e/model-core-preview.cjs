const { _electron, expect } = require('@playwright/test');
const { mkdir, mkdtemp } = require('node:fs/promises');
const path = require('node:path');

// Local, no-AI regression helper for the native Three.js ModelCanvas.
// It deliberately asserts that the model page contains no Blockbench iframe.
async function main() {
  const root = path.resolve(__dirname, '../../../..');
  const studio = path.join(root, 'packages/studio');
  const artifacts = path.join(root, '.artifacts/studio');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(path.join(artifacts, 'model-core-preview-'));
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studio, 'node_modules/electron/dist/electron.exe'),
    args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studio]), `--user-data-dir=${path.join(directory, 'electron')}`],
    env: { ...process.env, OPENAI_API_KEY: '', STUDIO_AI_URL: '', STUDIO_SERVICE_TOKEN: '', MINEMODS_STUDIO_TEST: '1', MINEMODS_STUDIO_WORKSPACE: path.join(directory, 'projects'), MINEMODS_STUDIO_RUNTIME: path.join(directory, 'runtime') },
  });
  const page = await app.firstWindow();
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await page.evaluate(async () => {
      const created = await window.studio.createProject({ name: '核心验收', description: 'local viewport', empty: false });
      return window.studio.useExample({ projectId: created.project.id, expectedRevision: created.project.revision });
    });
    await page.reload();
    await page.getByRole('button', { name: /核心验收/ }).click();
    await page.getByRole('navigation', { name: '工程里的东西', exact: true }).getByRole('region', { name: '生物', exact: true }).locator('.inv-slot:not(.inv-empty)').first().click();
    const canvas = page.locator('.model-canvas canvas, .model-panel canvas').first();
    await expect(canvas).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    const triangles = await canvas.evaluate((canvas) => canvas.width > 0 && canvas.height > 0);
    expect(triangles).toBe(true);
    await expect(page.locator('label.model-import')).toBeVisible();
    await expect(page.getByLabel('导入模型', { exact: true })).toHaveAttribute('type', 'file');
    await expect(page.getByRole('button', { name: '导出模型', exact: true })).toBeVisible();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    for (const point of [[0.5, 0.5], [0.45, 0.55], [0.6, 0.55], [0.5, 0.65]]) {
      await canvas.click({ position: { x: bounds.width * point[0], y: bounds.height * point[1] } });
      if (await page.locator('.model-selection').getByText(/已选中/).count()) break;
    }
    await expect(page.locator('.model-selection')).toContainText('已选中');
    await page.getByRole('button', { name: 'UV', exact: true }).click();
    await expect(page.locator('.model-canvas-uv img')).toBeVisible();
    await page.getByRole('button', { name: '展开模型', exact: true }).click();
    await expect(page.getByRole('button', { name: '收拢模型', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收拢模型', exact: true }).click();
    await page.getByRole('navigation', { name: '生物制作流程', exact: true }).getByRole('button', { name: '动作' }).click();
    await expect(page.getByLabel('选择动画', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(directory, 'model-core-preview.png') });
    console.log(JSON.stringify({ result: 'passed', directory, iframeCount: await page.locator('iframe').count(), canvasCount: await page.locator('canvas').count() }));
  } finally {
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
