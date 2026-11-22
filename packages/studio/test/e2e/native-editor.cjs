const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../../../..');
const studio = path.join(root, 'packages/studio');
const config = path.join(root, '.artifacts/studio/native-editor-current.config.cjs');
fs.mkdirSync(path.dirname(config), { recursive: true });
// The embedded Blockbench RPC, native transaction bridge and per-face UV fields were removed.
// Current live contracts are covered without recreating that removed integration:
// model-core-preview: actual canvas/picking, UV display, explosion, motion/pause, no iframe.
// studio: synchronized parts, transform/discard, scoped palette save, Ctrl-S/dirty navigation,
// compact layout, security and model/gameplay persistence after full restart.
fs.writeFileSync(config, `module.exports={testDir:${JSON.stringify(__dirname)},testMatch:'studio.spec.ts',timeout:90000,expect:{timeout:10000},workers:1,reporter:'list',outputDir:${JSON.stringify(path.join(root, '.artifacts/studio/native-editor-current-results'))}}`);
const run = (args, cwd) => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true, timeout: 180000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
run([path.join(__dirname, 'model-core-preview.cjs')], root);
run([path.join(studio, 'node_modules/@playwright/test/cli.js'), 'test', '--config', config], studio);
console.log('PASS: surviving native viewport, part controls, scoped paint, transform/discard and full restart contracts');
console.log('RETIRED: embedded Blockbench RPC/transaction and direct per-face UV editing; no claim these features pass');
