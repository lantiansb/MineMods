import { createProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "../src/workspace"

/**
 * 书 on one target: three books of three kinds, none of them a boss's lore, so the capability is shown general (开发通用规矩 第 1 条):
 * - 「齿轮工坊说明书」: a mod's manual, kraft paper (no colour of its own), with a 432×216 banner on page 3 and a page in English too;
 * - 「沼泽怪物图鉴」: a bestiary in green, its pages full to what the layout holds;
 * - 「北境任务手册」: a quest log in dark blue that is neither given on joining nor kept on death (the two switches off).
 *
 *   bun packages/mod-core/script/target-book-sample.ts <empty directory> [fabric-1.21.1|forge-1.20.1|neoforge-1.21.1]
 */
export const BOOK_IDS = {
  manual: "b0000000-0000-4000-8000-000000000001",
  bestiary: "b0000000-0000-4000-8000-000000000002",
  quests: "b0000000-0000-4000-8000-000000000003",
  banner: "b0000000-0000-4000-8000-0000000000a1",
} as const

/** A 432×216 banner of a workshop at dusk, drawn from a small palette: sky bands, hills, a roof and a gear. */
export function bannerTexture() {
  const width = 432, height = 216
  const palette = ["#1d2338", "#2e3557", "#4a4b78", "#7a5a7e", "#c47a6a", "#e8a86a", "#f3d08a", "#3c5a3a", "#2c4430", "#5b3a26", "#8a5a34", "#d8c49a", "#9aa4b0", "#6d7480"]
  const pixels = new Array<number>(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const band = Math.min(6, Math.floor((y / height) * 9))
      const hill = height * 0.62 + Math.sin(x / 37) * 14 + Math.sin(x / 11) * 4
      const far = height * 0.55 + Math.sin(x / 61 + 1) * 18
      const house = x > 250 && x < 350 && y > height * 0.42 && y < height * 0.7
      const roof = x > 240 && x < 360 && y > height * 0.3 && y <= height * 0.42 && Math.abs(x - 300) < (y - height * 0.3) * 2.6
      const gx = x - 140, gy = y - 70, r = Math.hypot(gx, gy), teeth = Math.cos(Math.atan2(gy, gx) * 10) > 0.3
      const gear = r < 26 + (teeth ? 6 : 0) && r > 9
      pixels[y * width + x] = gear ? (r < 20 ? 12 : 13) : roof ? 9 : house ? (x % 24 < 6 && y % 30 < 14 ? 6 : 10) : y > hill ? 8 : y > far ? 7 : band
    }
  return { kind: "texture" as const, width, height, palette, pixels }
}

const longBody = "沼泽深处的泥潭里住着许多看不见的东西。夜里它们会浮上来，在芦苇间慢慢游动，只留下一串气泡。".repeat(4).slice(0, 160)
export const BOOK_DOCUMENTS = {
  manual: {
    kind: "book",
    name: "齿轮工坊说明书",
    name_en: "Gearworks Manual",
    author: "工坊学徒",
    give_on_first_join: true,
    keep_on_death: true,
    pages: [
      { title: "写在前面", body: "这本书会一直跟着你。\n右键打开，左右键翻页。\n死了也不会掉。", margin: "第一次进世界时自动放进背包", title_en: "Before You Start", body_en: "This book stays with you.\nRight-click to open it and use the arrow keys to turn pages.", margin_en: "Given the first time you join a world" },
      { title: "齿轮", body: "齿轮用铁锭和木棍合成。把两个齿轮并排放下，转动其中一个，另一个会反着转。" },
      { title: "工坊全景", body: "傍晚的工坊。屋顶的烟囱冒烟时，说明炉子正热着，可以把矿石放进去。", image: BOOK_IDS.banner, margin: "图：工坊在山坡上，左边是一枚大齿轮" },
      { title: "安全须知", body: "不要在下雨天站在避雷针旁边。\n\n不要把手伸进转动的齿轮。", margin: "以上两条都是用血换来的" },
    ],
  },
  bestiary: {
    kind: "book",
    name: "沼泽怪物图鉴",
    author: "老猎人",
    cover_color: "#3c5a3a",
    give_on_first_join: true,
    keep_on_death: true,
    pages: [
      { title: "泥潭行者", body: "沼泽".repeat(160), margin: "满页：正文正好 320 字" },
      { title: "芦苇影子", body: longBody, image: BOOK_IDS.banner, margin: "有图的页：正文 160 字" },
    ],
  },
  quests: {
    kind: "book",
    name: "北境任务手册",
    cover_color: "#1d2338",
    give_on_first_join: false,
    keep_on_death: false,
    pages: [{ title: "第一章", body: "去北边的冰湖找到渔夫，问他湖底的事。" }],
  },
} as const

const asset = (id: string, title: string, module: "book" | "texture", document: unknown, dependencies: string[] = []) => WorkspaceAssetSchema.parse({
  id, module, title, revision: 1, created_at: "2026-11-20T00:00:00.000Z", updated_at: "2026-11-20T00:00:00.000Z",
  prompt: "书第一版样例", dependencies, document, provenance: { model: null, request_id: null }, status: "ready",
})

export async function createBookSample(directory: string, target: TargetId = "fabric-1.21.1") {
  const created = await createProject({ directory, name: "书样例", mod_id: "book_sample", target })
  const assets = [
    asset(BOOK_IDS.banner, "工坊横幅", "texture", bannerTexture()),
    asset(BOOK_IDS.manual, "齿轮工坊说明书", "book", BOOK_DOCUMENTS.manual, [BOOK_IDS.banner]),
    asset(BOOK_IDS.bestiary, "沼泽怪物图鉴", "book", BOOK_DOCUMENTS.bestiary, [BOOK_IDS.banner]),
    asset(BOOK_IDS.quests, "北境任务手册", "book", BOOK_DOCUMENTS.quests),
  ]
  return saveProject(directory, assets.reduce(applyWorkspaceAsset, created), created.revision)
}

if (import.meta.main) {
  const [directory, target] = process.argv.slice(2) as [string, TargetId | undefined]
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-book-sample.ts <empty directory> [target]")
  const project = await createBookSample(directory, target)
  console.log(`${project.name} (${project.target}): ${project.workspace.assets.length} assets`)
}
