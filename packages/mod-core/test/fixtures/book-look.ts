import { createProject, saveProject } from "../../src/project"
import type { TargetId } from "../../src/target/ids"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "../../src/workspace"

/**
 * 书的外观 on a book that is not the main project's (开发通用规矩 第 1 条): a spell book with a dark leather cover, parchment pages (a gutter on
 * the side of the spine, so odd and even pages differ), a gold frame laid over them, deep brown ink and an icon of its own; and a ship's log
 * whose cover picture has its title drawn in, so nothing is printed on it. Every picture is a placeholder drawn here from a few colours.
 */
export const LOOK_IDS = {
  spells: "c0000000-0000-4000-8000-000000000001",
  log: "c0000000-0000-4000-8000-000000000002",
  cover: "c0000000-0000-4000-8000-0000000000a1",
  paper: "c0000000-0000-4000-8000-0000000000a2",
  paper_even: "c0000000-0000-4000-8000-0000000000a3",
  frame: "c0000000-0000-4000-8000-0000000000a4",
  icon: "c0000000-0000-4000-8000-0000000000a5",
  log_cover: "c0000000-0000-4000-8000-0000000000a6",
} as const

type Texture = { kind: "texture"; width: number; height: number; palette: string[]; pixels: number[] }
const W = 604, H = 460
/** A fixed noise in 0..1 per pixel, so the same pictures are drawn every time. */
const noise = (x: number, y: number) => (((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 1000) / 1000
const paint = (width: number, height: number, palette: string[], pick: (x: number, y: number) => number): Texture => {
  const pixels = new Array<number>(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = pick(x, y)
  return { kind: "texture", width, height, palette, pixels }
}

/** Dark leather with a gold rule around it and a gold sigil low in the middle; the title's band is left plain and dark. */
export const leatherCover = () => paint(W, H, ["#2a1410", "#33191a", "#3d1f1c", "#c9a24a", "#8a6a2a", "#1a0c0a"], (x, y) => {
  const edge = Math.min(x, y, W - 1 - x, H - 1 - y)
  if (edge < 8) return 5
  if (edge >= 18 && edge < 22) return 3
  if (edge >= 26 && edge < 28) return 4
  const r = Math.hypot(x - (W / 2 + 14), y - 300)
  if ((r > 52 && r < 58) || (r < 40 && Math.abs(Math.atan2(y - 300, x - (W / 2 + 14)) % (Math.PI / 3)) < 0.08)) return 3
  const n = noise(x, y)
  return n < 0.33 ? 0 : n < 0.8 ? 1 : 2
})

/** Parchment: speckled cream, browner towards scorched edges, and a shadow down the spine's side (left on odd pages, right on even). */
export const parchment = (spine: "left" | "right") => paint(W, H, ["#efe0b8", "#e8d6a8", "#e0cb96", "#d2b67c", "#b8925a", "#8a6438", "#5e3e20"], (x, y) => {
  const edge = Math.min(x, y, W - 1 - x, H - 1 - y)
  const gutter = spine === "left" ? x : W - 1 - x
  const burn = edge < 6 ? 6 : edge < 12 ? 5 : edge < 20 ? 4 : 0
  if (burn && noise(x, y) < 0.85) return burn
  if (gutter < 20) return gutter < 8 ? 4 : 3
  const n = noise(x, y)
  return n < 0.45 ? 0 : n < 0.85 ? 1 : 2
})

/**
 * A gold frame: a double rule just inside the page and a diamond at each corner; the rest is magenta, which the book draws see-through. The
 * rules keep to the outer 3 GUI pixels: the page number sits 4 above the bottom (the first run in the game drew the rule across it, at 5 to 8).
 */
export const goldFrame = (inset = 2) => paint(W, H, ["#ff00ff", "#c9a24a", "#8a6a2a"], (x, y) => {
  const edge = Math.min(x, y, W - 1 - x, H - 1 - y)
  if (edge >= inset && edge < inset + 3) return 1
  if (edge >= inset + 4 && edge < inset + 5) return 2
  const corner = Math.min(Math.abs(x - 13) + Math.abs(y - 13), Math.abs(W - 14 - x) + Math.abs(y - 13), Math.abs(x - 13) + Math.abs(H - 14 - y), Math.abs(W - 14 - x) + Math.abs(H - 14 - y))
  return corner < 12 ? 1 : corner < 14 ? 2 : 0
})

/** A 16×16 icon: the spell book closed, dark purple with a gold clasp. */
export const spellIcon = () => {
  const rows = [
    "................",
    "...DDDDDDDDDD...",
    "..DLLLLLLLLLLD..",
    "..DLPPPPPPPPLD..",
    "..DLPGGGGGGPLD..",
    "..DLPGPPPPGPLD..",
    "..DLPGPGGPGPGG..",
    "..DLPGPGGPGPGG..",
    "..DLPGPPPPGPLD..",
    "..DLPGGGGGGPLD..",
    "..DLPPPPPPPPLD..",
    "..DLLLLLLLLLLD..",
    "..DDDDDDDDDDDDW.",
    "...WWWWWWWWWWWW.",
    "....WWWWWWWWWW..",
    "................",
  ]
  const palette = ["#ff00ff", "#1e1028", "#2e1a40", "#4a2a66", "#c9a24a", "#e8dcc0"]
  const index: Record<string, number> = { ".": 0, D: 1, L: 2, P: 3, G: 4, W: 5 }
  // "." is magenta, the colour the book draws see-through (a texture asset has no alpha of its own).
  return { kind: "texture" as const, width: 16, height: 16, palette, pixels: rows.flatMap((row) => [...row].map((cell) => index[cell]!)) }
}

/** A ship's log cover with its title drawn in as a lit name plate (bars for letters), on dark steel. */
export const logCover = () => paint(W, H, ["#1b2330", "#232d3d", "#5fd0e0", "#2a8a9a", "#0e141c"], (x, y) => {
  const edge = Math.min(x, y, W - 1 - x, H - 1 - y)
  if (edge < 10) return 4
  const plate = x > 120 && x < 484 && y > 120 && y < 210
  if (plate) return (x - 140) % 36 < 24 && y > 140 && y < 190 && x < 464 ? 2 : 3
  return (y % 40 < 2) ? 1 : 0
})

export const LOOK_DOCUMENTS = {
  spells: {
    kind: "book",
    name: "灰烬法典",
    name_en: "Codex of Ashes",
    author: "第七学徒",
    cover_color: "#2a1410",
    give_on_first_join: true,
    keep_on_death: true,
    look: { cover: LOOK_IDS.cover, paper: LOOK_IDS.paper, paper_even: LOOK_IDS.paper_even, frame: LOOK_IDS.frame, body_color: "#3a2412", title_color: "#6a1e0c", margin_color: "#7a5636", icon: LOOK_IDS.icon },
    pages: [
      { title: "火之符文", body: "在掌心画一个圆，再从圆心向外画三道线。\n念出它的名字时，指尖会先热起来，然后才看得见火光。\n\n初学者一天只练三次，多了会烫伤自己。", margin: "页边小字原大：这一行和正文一样大，只是颜色淡一些，读起来不会糊" },
      { title: "霜之符文", body: "霜的符文和火相反：圆画在手背上，线向圆心收拢。\n冬天练它最容易，夏天要先把手放进冷水里。", margin: "双数页：底图的书脊阴影在右边" },
      { title: "禁忌", body: "不要在书页上直接画符文。\n这本书已经烧坏过两次，第三次就补不回来了。", margin: "批注：上一任主人在这里留下了一块焦痕，至今没人敢擦掉它" },
    ],
  },
  log: {
    kind: "book",
    name: "远航者号航行日志",
    author: "大副",
    cover_color: "#1b2330",
    give_on_first_join: false,
    keep_on_death: true,
    look: { cover: LOOK_IDS.log_cover, title_in_cover: true, body_color: "#1b2330" },
    pages: [{ title: "第 1 天", body: "引擎点火正常。舰桥的灯闪了三次，然后稳定下来。", margin: "记录人：大副" }],
  },
} as const

const asset = (id: string, title: string, module: "book" | "texture", document: unknown, dependencies: string[] = []) => WorkspaceAssetSchema.parse({
  id, module, title, revision: 1, created_at: "2026-11-21T00:00:00.000Z", updated_at: "2026-11-21T00:00:00.000Z",
  prompt: "书的外观样例", dependencies, document, provenance: { model: null, request_id: null }, status: "ready",
})

export async function createBookLookSample(directory: string, target: TargetId = "fabric-1.21.1") {
  const created = await createProject({ directory, name: "书外观样例", mod_id: "book_look", target })
  const assets = [
    asset(LOOK_IDS.cover, "皮面封面", "texture", leatherCover()),
    asset(LOOK_IDS.paper, "羊皮纸·单数页", "texture", parchment("left")),
    asset(LOOK_IDS.paper_even, "羊皮纸·双数页", "texture", parchment("right")),
    asset(LOOK_IDS.frame, "金色边框", "texture", goldFrame()),
    asset(LOOK_IDS.icon, "法典图标", "texture", spellIcon()),
    asset(LOOK_IDS.log_cover, "日志封面（画了书名）", "texture", logCover()),
    asset(LOOK_IDS.spells, "灰烬法典", "book", LOOK_DOCUMENTS.spells, [LOOK_IDS.cover, LOOK_IDS.paper, LOOK_IDS.paper_even, LOOK_IDS.frame, LOOK_IDS.icon]),
    asset(LOOK_IDS.log, "远航者号航行日志", "book", LOOK_DOCUMENTS.log, [LOOK_IDS.log_cover]),
  ]
  return saveProject(directory, assets.reduce(applyWorkspaceAsset, created), created.revision)
}
