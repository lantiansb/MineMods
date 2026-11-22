/**
 * The plainest base shapes of the game's model format, written out here so a mod's blocks and
 * items can still be previewed in 3D on a computer that has no copy of the game's own files.
 * Only the generic cube family and the flat-item marker are covered; anything more specific
 * (stairs, fences, doors…) still needs the game's files and is reported as such.
 */
const face = (texture: string, cull: string) => ({ texture, cullface: cull })
const cube = {
  parent: "block/block",
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        down: face("#down", "down"),
        up: face("#up", "up"),
        north: face("#north", "north"),
        south: face("#south", "south"),
        west: face("#west", "west"),
        east: face("#east", "east"),
      },
    },
  ],
}
const sides = (textures: Record<string, string>) => ({ parent: "block/cube", textures })
const models: Record<string, unknown> = {
  "block/block": {},
  "block/cube": cube,
  "block/cube_all": sides({ particle: "#all", down: "#all", up: "#all", north: "#all", east: "#all", south: "#all", west: "#all" }),
  "block/cube_column": sides({ particle: "#side", down: "#end", up: "#end", north: "#side", east: "#side", south: "#side", west: "#side" }),
  "block/cube_bottom_top": sides({ particle: "#side", down: "#bottom", up: "#top", north: "#side", east: "#side", south: "#side", west: "#side" }),
  "block/cube_top": sides({ particle: "#side", down: "#side", up: "#top", north: "#side", east: "#side", south: "#side", west: "#side" }),
  "block/orientable": sides({ particle: "#front", down: "#top", up: "#top", north: "#front", east: "#side", south: "#side", west: "#side" }),
  "block/leaves": sides({ particle: "#all", down: "#all", up: "#all", north: "#all", east: "#all", south: "#all", west: "#all" }),
  "item/generated": { parent: "builtin/generated" },
  "item/handheld": { parent: "item/generated" },
}

/** The stand-in for `assets/minecraft/models/<name>.json`, or null when this file has none. */
export function baseModelFallback(resourcePath: string) {
  const name = resourcePath.match(/^assets\/minecraft\/models\/(.+)\.json$/)?.[1]
  const model = name ? models[name] : undefined
  return model ? new TextEncoder().encode(JSON.stringify(model)) : null
}
