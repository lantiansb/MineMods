# 第三方组件和许可证 / Third-party notices

MineMods Studio 自己的代码用 MIT 许可证（见 `LICENSE`）。下面这些东西不是我们写的，或者是从别人的代码改来的，各自保留原来的许可证。

**打包出来的桌面软件**里编进了 Blockbench 和从它改编的两个文件（GPL-3.0-or-later），所以软件作为一个整体按 GPL-3.0-or-later 分发，完整源码就是这个仓库。单独拿走 MIT 的那些文件，仍然按 MIT 用。

| 组件 | 在哪 | 许可证 | 说明 |
|---|---|---|---|
| [Blockbench](https://github.com/JannisX11/blockbench) 5.1.6 | `packages/studio/vendor/blockbench/` | **GPL-3.0-or-later** | 软件里改模型用的建模器，离线版。完整源码在 `source/blockbench-5.1.6/`，许可证原文在 `LICENSE.MD`。我们加的桥接脚本、启动脚本和改动，逐条写在 `runtime/SOURCE-NOTICE.md`。Blockbench 单独运行在自己的页面里，和软件之间只靠一条固定格式的消息通道交流。 |
| 从 Blockbench 改编的模型预览核心 | `packages/studio/src/renderer/model-core/blockbench-uv.ts`、`blockbench-animation.ts` | **GPL-3.0-or-later** | 软件自己的三维预览用的 UV 映射和动画插值，改编自 Blockbench 5.1.6 源码，文件里带着 GPL 声明；来源行号见同目录 `README.md` |
| 方舟像素字体 [Ark Pixel Font](https://github.com/TakWolf/ark-pixel-font) | `packages/studio/src/renderer/assets/fonts/` | SIL OFL 1.1 | 和俐方体合并成界面字体 MineMods Pixel，许可证原文 `ArkPixel-OFL.txt` |
| 俐方体 11 号 [Cubic 11](https://github.com/ACh-K/Cubic-11) | 同上 | SIL OFL 1.1 | 许可证原文 `Cubic11-OFL.txt` |
| SIL Open Font License 1.1 原文 | `packages/mod-core/src/ofl.ts` | — | 打包时补生僻字：从你电脑上确认是 OFL 许可的字体里画出像素字，随模组带上这份许可证原文。这个功能用的字体不放进仓库 |
| [opencode](https://github.com/sst/opencode) | `patches/solid-js@1.9.10.patch` 等少量工程配置 | MIT（Copyright (c) 2025 opencode） | 项目最早的工作台是从 opencode 改来的；公开版已经去掉了那套工作台，只剩一些沿用下来的工程配置 |
| npm 依赖（Electron、three.js、Solid、zod、MCP SDK 等） | 安装时下载，不在仓库里 | 都是 MIT、Apache-2.0、ISC、BSD 这类宽松许可证 | 装好以后可以在 `node_modules` 里看到各自的许可证 |
| Fabric / Forge / NeoForge、Gradle | 打包模组时按 `templates/` 里的配置下载 | 各自的许可证 | 不在仓库里 |

**Minecraft** 是 Mojang Studios 的商标。MineMods Studio 是非官方工具，与 Mojang、微软没有任何关系。仓库里不放 Mojang 的原版贴图；界面上的材料小图标是我们自己画的（`tools/art/draw_item_icons.py`）。
