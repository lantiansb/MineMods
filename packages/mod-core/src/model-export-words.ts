// No Node APIs: the MCP tool list says these without loading the writer.
/**
 * r29b: a model's files as the game reads them (the geometry, the motions and the picture a build puts in the jar), written into a folder of the project for
 * whoever wants them outside Studio: another tool, a renderer, a second mod. Nothing of the project changes. A creature's are its jar's own files, named by its
 * registry name; a model no creature wears yet is compiled as it is drawn, named `model_<its id>`.
 */
export const MODEL_EXPORT = { folder: "exports/models", own: [".minemods", "generated"] } as const

/** Said to the outside AI by `export_model`. */
export const MODEL_EXPORT_WORDS = {
  folder: MODEL_EXPORT.folder,
  files: "<名字>.geo.json（GeckoLib 和基岩版实体用的几何，format_version 1.12.0，几何名 geometry.<名字>）、<名字>.animation.json（GeckoLib 动画，format_version 1.8.0，动作名 animation.<名字>.<动作名>）和 <名字>.png（贴图；模型有发光部分时多一张 <名字>_glowmask.png）；<名字> 是生物的注册名，还没有生物用的模型是 model_ 加编号，生物的这几个文件和打进模组的一样",
} as const

