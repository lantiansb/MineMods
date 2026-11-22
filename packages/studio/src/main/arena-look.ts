import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { ARENA_LIMITS, abilityLeave, arenaHits, arenaPlan, arenaReviewIssues, arenaWords, bossArena, fogStages, returnPlaceWords, type Arena } from "@minemods/mod-core/arena"
import { arenaMapPicture, fogShare, foggedTexture, zhuoluPicture } from "@minemods/mod-core/arena-picture"
import type { Ability, Boss } from "@minemods/mod-core/entity-runtime"

/**
 * Boss 能力 12 and 13 in a creature's look: its arena from above (home, its fixtures and the ground each clears, the fight's range), each ability that leaves the field or strikes
 * the whole arena from above with its time (`zhuoluPicture`), and 「雾里看它」: its model at three distances in its fog, drawn with the texture the fog leaves it (what glows stays).
 * The pictures are mod-core's (`arena-picture.ts`), from the plan the generated Java runs on; this file lays them out as the look's cells. Nothing for a creature without an arena.
 */

type Vector = [number, number, number]
type Scene = { design: ModelDesign; preview: { geometry: unknown; textureDataUrl: string; animation?: unknown } | null }
type Cell = { kind: "flat"; label: string; url: string } | { kind: "view"; label: string; scene: number; view: "front" | "quarter"; camera?: { position: Vector; target: Vector; fov: number } }
type Sheet = { label: string; columns: number; cell: [number, number]; cells: Cell[] }

/** The names of the arena's two sheets, as a reviewer is told them. */
export const ARENA_SHEET = "Boss 场地（俯视，上方是它醒来时的朝向）：家（红叉）、物件（金色方块）和它们点亮后清掉雾的范围（白圈）、战斗范围（外圈）；离场和打整个场地的招式：红色是打到的地方，绿色是安全区，橙色是天上落下的东西，蓝色三角是它落回来的地方，下面一条是时间（灰：不在场上，黄：预警，红：出手）"
export const FOG_SHEET = "雾里看它：不同距离的模型混色示意"

const seconds = (value: number) => `${Number(value.toFixed(2))} 秒`
const BACK_WORDS = { home: "家", center: "场地正中", near_target: "目标身边" } as const

export function arenaLookSheets(input: {
  document: { name: string; behavior: string; boss?: Boss | null; abilities?: readonly Ability[] | null; combos?: readonly { id: string; steps: readonly string[] }[] | null }
  /** The model as the build paints it: its geometry, its texture and its glow mask (null: it does not glow). */
  compiled: { design: ModelDesign; geometry: unknown; png: Uint8Array; glow: Uint8Array | null; animation: unknown } | null
  first: number
  tile: [number, number]
  dataUrl: (png: Uint8Array) => string
}): { scenes: Scene[]; sheets: Sheet[]; notes: string[]; findingDetails?: ReturnType<typeof arenaReviewIssues> } {
  const document = input.document
  const boss = document.behavior === "hostile" ? (document.boss ?? null) : null
  const abilities = document.behavior === "hostile" ? (document.abilities ?? []) : []
  if (!boss || !bossArena(boss, abilities)) return { scenes: [], sheets: [], notes: [] }
  const arena: Arena = boss.arena ?? { fixtures: [], fog: null }
  const plan = arenaPlan(arena)
  const cells: Cell[] = []
  const notes: string[] = []
  const map = arenaMapPicture(arena)
  cells.push({ kind: "flat", label: `场地俯视（${map.blocks}×${map.blocks} 格）：${plan.fixtures.length ? `${plan.fixtures.length} 座物件，清晰区半径 ${[...new Set(plan.fixtures.map((fixture) => fixture.clear.radius))].join("、")} 格` : "没有物件"}，战斗范围 ${ARENA_LIMITS.radius} 格`, url: input.dataUrl(map.png) })
  for (const ability of abilities) {
    if (cells.length >= 3) break
    const picture = zhuoluPicture(arena, ability)
    if (!picture) continue
    const leave = abilityLeave(ability)
    const struck = arenaHits(ability)
    cells.push({
      kind: "flat",
      label: `「${ability.name}」俯视和时间（0–${seconds(picture.seconds)}）${leave ? `：第 ${seconds(leave.at)}–${seconds(leave.back.at)} 不在场上，落回${typeof leave.back.place === "string" ? BACK_WORDS[leave.back.place] : returnPlaceWords(leave.back.place) + "。白色小圈为示意目标，朝向图上方；蓝框为可选范围"}` : ""}${struck.length ? `；打整个场地 ${struck.map(({ hit }) => `第 ${seconds(hit.at)}`).join("、")}，安全区 ${picture.safe} 处` : ""}`,
      url: input.dataUrl(picture.png),
    })
  }
  const sheets: Sheet[] = [{ label: ARENA_SHEET, columns: Math.min(3, cells.length), cell: input.tile, cells }]
  notes.push(arenaWords(arena))
  if (safeOnFixtures(abilities) && plan.fixtures.length) notes.push("图上安全区按物件全都亮着画：游戏里只有那一刻亮着的物件周围才安全。")
  // 「雾里看它」: the model at three distances in its fog.
  const scenes: Scene[] = []
  const fog = arena.fog
  if (fog && input.compiled) {
    const compiled = input.compiled
    const end = fog.fade_end ?? fog.visibility
    const distances = [0, (fog.visibility * 0.2 + end) / 2, end * 1.2]
    const fogCells = distances.map((distance, index): Cell => {
      const share = fogShare(distance, fog.visibility, end)
      scenes.push({ design: compiled.design, preview: { geometry: compiled.geometry, textureDataUrl: input.dataUrl(foggedTexture(compiled.png, compiled.glow, share)), animation: compiled.animation } })
      const said = index === 0 ? "不在雾里（或者站在亮着的物件旁边）" : `雾里离它 ${Number(distance.toFixed(1))} 格（${fog.fade_end === undefined ? "能见度" : "完全遮挡距离"} ${end} 格，雾占 ${Math.round(share * 100)}%）`
      return { kind: "view", label: said, scene: input.first + index, view: "front" }
    })
    sheets.push({ label: FOG_SHEET, columns: 3, cell: input.tile, cells: fogCells })
    notes.push(
      compiled.glow
        ? `图用贴图混色示意雾到 ${end} 格完全遮挡时，只剩发光的部分。实机里发光部位的可辨程度还和大小、距离、遮挡及启用的发光层有关。地面预警圈、效果和粒子会随雾变淡。`
        : `模型贴图没有发光的部分（features 的 glow）。超过 ${end} 格，模型表面会混入雾色。想让较远的轮廓和预警更容易分辨，可提高 fade_end。`,
    )
    const stages = fogStages(boss, abilities, document.combos ?? [])
    notes.push(stages.length ? `起雾的招式在${stages.map((stage) => (stage === 0 ? "第一阶段" : `第 ${stage + 1} 阶段`)).join("、")}能出。` : "没有一个它能出的招式会起雾。")
  }
  const findingDetails = arenaReviewIssues({ ...document, boss, abilities })
  notes.push(...findingDetails.map((issue) => `${issue.text}${issue.fix}`))
  return { scenes, sheets, notes, ...(findingDetails.length ? { findingDetails } : {}) }
}

const safeOnFixtures = (abilities: readonly Ability[]) => abilities.some((ability) => arenaHits(ability).some(({ hit }) => hit.safe?.around === "lit_fixtures"))
