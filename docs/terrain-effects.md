# 通用临时地形

适用 Fabric 1.21.1、Forge 1.20.1、NeoForge 1.21.1。招式和玩法代码共用一套服务端运行层，不依赖特定生物、模型或 Boss。只有真实使用新字段或新公共接口时才加入支持代码。

## 制作 AI 可写的招式字段

三个事件都沿用 `at`（秒）、`where:self|target|hit`、`hit`（self/target 写 null）、`forward`、`left`。伤害和推开不能早于蓄力结束；引用出手的落点必须在当时已知。

- `shockwave.pop_blocks:{height,every,max}`：高度 0.1–4 格，间隔 1–20 tick，每道波最多 1–128 块。环扫过时复制真实实心地面的方块外观，弹起落回；跳过方块实体、非完整碰撞方块、上方非空气和未加载区块。原方块始终保留。投射物落地的 `impact.ground` 同样支持。
- `terrain_rise:{shape,width,height,rise_seconds,stay_seconds,lifts,damage?,knockback?,shatter}`：column/spike/wall，宽 0.5–8 格、高 0.5–12 格，0.1–5 秒长出，停留 0–30 秒。伤害 0–100、推开 0–4。草、菌丝、灰化土归一为土；矿石归一为石头或深板岩；沙归一为砂岩；砂砾归一为石头。显示方块分节长出，同步碰撞箱；lifts 决定是否主动抬升站在上面的人。shatter 为 true 时结束产生方块碎片和方块粒子。全程不放置世界方块，不掉物品。
- `block_swap:{block,area:{shape,radius,height},restore_after,only_replace?}`：circle/square/sphere，半径 0.5–8 格，高 1–8 格。区域从落点下方一格向上数，sphere 按指定高度裁切；0.1–120 秒后逐块还原。only_replace 为 air/liquid/soft/solid，默认 soft 和 liquid。目标使用 schema 中的普通方块清单，包括冰、蛛网、黑曜石等；拒绝容器、不可破坏方块、传送门、液体目标和未知名称。mobGriefing 为 false 时不换，已经欠下的还原仍继续。

通用例子：大地巨人砸地给 shockwave 加 `{height:1.5,every:2,max:48}`；冰法师在雪地使用 column；蛛网陷阱使用 `block:"minecraft:cobweb",area:{shape:"square",radius:2,height:2},only_replace:["air"]`；守护石像使用 wall。完整可解析样例见 `packages/mod-core/script/target-terrain-sample.ts`。

## 石刺、掩体和离场还原

石刺每半格高收窄一次，至少三节。写 `shape:"spike",material:"minecraft:stone"` 可从草地升起石刺。`taper:0` 保留原先各列平顶的形状。冰用 `minecraft:packed_ice`，工程自制方块填写注册名。

`terrain_rise.blocks` 中的 `beam`、`area` 和 `projectile` 分别决定是否截断光束、遮蔽写了 `blocked_by_walls:true` 的范围出手和拦住投射物，默认均关闭。`lifts` 控制升起时是否承托人。地形硬度 `hardness` 从 0 到 50，省略后无法打碎。破块事件、冲刺、范围出手分别用 `hardness`、`break_hardness`、`break_terrain` 与它比较，达到硬度时整组提前碎裂。

循环段的 `end.collision` 逐条判断碰撞。条件 `{if:"collision",with:"own_terrain"}` 可配 `{shatter_terrain:3}` 继续冲锋。`other_terrain` 指其他来源创建的地形。`world` 可配 `{interrupt:true}` 或 `{stagger:"硬直标识符"}`。

Boss 的柱和临时换块都建议写 `restore_on_exit:true`。脱战重置以后场地里不该还立着上一场的柱子。还原时只移除属于该来源的层，保留其他来源和玩家的修改。未加载区块等加载后处理。省略字段时按原有停留时间和换块期限处理。

## 物品、陷阱、竞技场的玩法接口

制作 AI 的玩法说明、代码作者和评审都拿到中文接口说明。通过 `ProjectContent` 调用，生成器检查实际 Java 调用并自动加入支持代码；注释、字符串、自己的同名方法不触发。

```java
ProjectContent.terrainRise(world, at, yaw, "wall", 4, 3,
    20, 60, true, 0f, 0, true, source);
ProjectContent.blockSwap(world, at, "minecraft:ice", "circle",
    3, 1, 80, "solid");
ProjectContent.popBlocks(world, at, 0, 8, 40, 1.5, 2, 48);
```

这里时间为 tick，20 tick 为一秒。接口接受普通 Level、Vec3 和可空来源 Entity；可从物品使用、踩陷阱和竞技场回调调用，服务端检查和预算与招式共用。`createTargetTerrainGameplaySample` 创建一个没有任何生物招式的工程：原版木棍长柱、雪球铺冰、烈焰棒掀地，三端均编译验证。

## 预算和还原

每世界最多 2048 个临时地形显示块；单次换块最多 512 格、每世界最多 4096 个位置、每位置最多 16 层。到期每 tick 最多处理 128 个位置。超过预算跳过，不加载额外区块。

换块使用每个维度自己的 SavedData 账本，保存原始完整方块状态和每层到期的游戏时间。重叠按层处理：上层先到期露出仍有效的下层，下层先到期则保留上层，最后回到最初状态。重启后继续处理；区块未加载时等待其加载。玩家或其他系统把当前方块改为与账本顶部不同的状态时，保留新改动并撤销该位置的还原，避免覆盖玩家。写入不触发邻居连锁更新或掉落。

显示实体不保存，临时柱墙在读档时自然消失。掀块使用真实地面外观；升起时优先使用指定方块的外观，未指定时取归一后的地面外观。旧工程的生成输出对照 313c5e5 固定摘要，新增能力缺省时保持字节一致。
