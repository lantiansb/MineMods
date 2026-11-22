# Studio 后台验收

所有命令在 `packages/studio` 内运行，先执行 `bun run build`。测试使用隐藏 Electron 窗口、隔离工程和本地模型 fixture，不需要真实 API Key。

## 当前回归入口（2026-09-29）

```powershell
# API 向导、官方本机配置导入、加密持久化、MCP 切换：2 项
bun x playwright test --config playwright.connections.config.ts

# 工程并行任务、统一内容树、模型工作区、构建抽屉：2 项
bun x playwright test --config playwright.workbench.config.ts

# 低中高复杂度、真实 MCP 拒绝过简模型、保存与预览、折叠目录搜索：1 项
bun x playwright test --config playwright.quality.config.ts
```

界面只有一套固定外观（Minecraft 物品栏风格），没有主题切换：`settings.theme` 恒为 `craft`，`<html>` 不带 `data-theme`，截图不再按主题分别保存。单元测试用 `bun run test`，类型检查用 `bun typecheck`。详细审核与验证见 [2026-09-29 审核记录](../../../../docs/studio-redesign/review-2026-09-29.md)。

## 产物与复测

截图、日志和隔离工程位于 `.artifacts/studio/`，不提交运行产物。连接和模型质量测试可以通过 `STUDIO_PACKAGED_EXECUTABLE` 指定完整的已打包 EXE 路径；必须保留整个 `win-unpacked` 文件夹。

```powershell
bun run package
$env:STUDIO_PACKAGED_EXECUTABLE = (Resolve-Path 'release/win-unpacked/MineMods Studio.exe').Path
bun x playwright test --config playwright.connections.config.ts
```

这些测试验证软件流程和固定样例，不证明真实云端模型的美术质量或 Minecraft 游戏内的最终效果。

## 历史场景

`playwright.glass.config.ts`、`playwright.mcp.config.ts` 以及默认 `playwright.config.ts` 下的旧测试保留为历史场景，其中包含旧导航选择器，不作为当前回归入口；原先按主题循环的截图步骤已改为单次截图。旧报告中的三款玻璃主题、93 项单元测试及历史截图不代表当前版本。

历史设计参考：[GPT 设计板](../../../../docs/studio-redesign/connections-themes/gallery.html)、[旧界面画廊](../../../../docs/studio-redesign/connections-themes/actual.html)。
