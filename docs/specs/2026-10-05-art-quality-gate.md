# 模型表面怎么画：材质和特征（2026-10-05）

这份文档只讲**做法**：AI 怎么描述一个模型的表面，Studio 怎么把它画出来。

**规则不在这里。** 什么样的模型和贴图会被退回，只有一个出处：[验收标准](2026-10-05-acceptance-standard.md)。这里以前有过一份模型和贴图专用的规则表，已经并进那份标准，不再单独维护。

## 为什么要有这套画法

一只由 AI 做的生物「蓝晶守卫」曾经通过了旧的检查。它的贴图每个面都是同一种斜线，模型上每个方块都贴了同一条凑数的细节。旧检查只数数，数量够了就过。

原因之一是 AI 当时只能给每个面填一个颜色，再一条条贴矩形，或者逐个像素去填。这样填出来的只会是机械图案。所以现在让 AI 说“这是什么材质、上面有什么”，像素由 Studio 来画。

那只守卫的原件留在 `packages/studio-ai/test/fixtures/look/bad/lanjing-guard.json`，永远不改。它是验收标准的一件样品。

## 不让 AI 填像素：材质和特征

以前 AI 只能给每个面一个颜色，再一条条贴矩形，或者逐像素填一张贴图，所以填出来的是机械图案。现在模型文档里可以直接说“这是什么材质、上面有什么”，像素由 Studio 来画。没有这些字段的旧文档，画出来和以前逐字节一样（`packages/mod-core/test/model.test.ts` 用蓝晶守卫的原件锁住了这一点）。

- **`paint`**（写在骨骼或方块上）：`{ material, base, secondary }`。`material` 是 skin、fur、feather、scales、shell、stone、crystal、metal、wood、cloth、bone、slime、leaf 之一；`base` 是底色；`secondary` 是可选的第二种颜色。写在骨骼上的会传给它和它下面所有骨骼的方块，方块自己写了就用自己的。
- 画法：每种材质有自己的成块纹理（毛是竖向的短簇，鳞是错开的小片，石头是两三格的色块，晶体是斜向的切面，金属是上亮下暗的横带……），只用底色的两三个深浅；顶面亮一点，侧面居中，背面和底面暗；侧面的上沿亮、下沿暗；深色往蓝偏，浅色往黄偏。图案由“骨骼名/方块名”算出来，同一个文档每次画出来都一样。
- **`features`**（写在方块上，最多 12 条）：`type` 是 eyes、brows、mouth、nose、belly、stripes、spots、cracks、veins、band、claws、gem 之一；可选 `face`（画在哪个面，不写用常用的面）、`shape`、`color`、`color2`、`x`、`y`（0–1 的位置）、`size`、`count`、`glow`、`mirror`。眼睛和眉毛默认左右成对。
- `surface_details` 还在，画在最上面，留给个别像素。
- 单独的逐像素贴图仍然可以交，但它是例外，而且同样要贴到模型上按验收标准检查。

一个完整的例子（四足石头守卫的头）：

```json
{"name":"head","parent":"body","pivot":[0,11,-8],"rotation":[0,0,0],
 "paint":{"material":"stone","base":"#3E6285","secondary":"#4C5F6E"},
 "cubes":[
  {"name":"skull","origin":[-5,8,-15],"size":[10,8,7],"faces":{…都填 #3E6285…},"surface_details":[],
   "features":[
    {"type":"eyes","shape":"square","size":2,"x":0.56,"y":0.36,"color":"#8FF0FF","glow":true},
    {"type":"brows","shape":"angry","size":2,"x":0.56,"y":0.36,"color":"#18232B"},
    {"type":"cracks","face":"up","count":1}]},
  {"name":"muzzle","origin":[-4,8,-17],"size":[8,4,2],"faces":{…},"surface_details":[],
   "paint":{"material":"stone","base":"#46657F"},
   "features":[
    {"type":"nose","y":0.2,"size":2,"color":"#1D2830"},
    {"type":"mouth","shape":"fangs","y":0.7,"size":6,"color":"#18232B","color2":"#D5F4FA"}]},
  {"name":"horn_left","origin":[-6,15,-13],"size":[2,4,2],"faces":{…},"surface_details":[],"paint":{"material":"bone","base":"#C9DCE2"}},
  {"name":"horn_right","origin":[4,15,-13],"size":[2,4,2],"faces":{…},"surface_details":[],"paint":{"material":"bone","base":"#C9DCE2"}}]}
```

整只守卫在 `packages/studio-ai/test/fixtures/look/good/crystal-guardian.json`，是按蓝晶守卫的同一句需求重新写的。给 AI 的说明（`MODEL_ART_DIRECTION`）里带着这个例子的完整 JSON。

## 代码在哪里

- 画图：`packages/studio-ai/src/model-paint.ts`。预览、导出和进游戏用的是同一个画图函数，所以三处是同一张贴图。
- 给 AI 的画法说明：`packages/studio-ai/src/model-quality.ts` 里的画法指南，带着上面这个例子的完整内容。
- 没有材质和特征字段的旧文档，画出来和以前一个字节都不差，`packages/mod-core/test/model.test.ts` 用蓝晶守卫的原件锁住了这一点。

## 这套画法做不到的

- 游戏里的光照会在这张贴图上再叠一层明暗。
- 图案是按“骨骼名/方块名”算出来的。改了名字，同一个方块画出来的图案会变。
- 它只保证画出来不是机械图案。好不好看、像不像你要的，仍然要人自己看。
