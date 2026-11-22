import { expect, test } from "bun:test"
import { agreement, AMONG_MEASURES, BLOCK_FACES, faceEntries, facePick, measureWall, outlineOverlap, TextureNoteSchema, VARIANT_LIMITS } from "../src/texture-facts"
import { DRAWN_PICTURES } from "../src/script"
import { COPY_LIMITS, copied, copyFinding, differsReason, FAMILY_LIMITS, isRange, measureTexture, NO_WORLD_WORDS, OUTSIDE_MARGIN, OUTSIDE_WORDS, outsideFindings, outsideWorld, TEXTURE_GUIDE, TEXTURE_SEEN, textureLines, textureNote, texturePlain, WORLD_SHEET_NAME, type Picture } from "../src/texture-facts"
import { BLIND_FITS, BLIND_GUIDE, BLIND_INSTRUCTIONS, BLIND_KINDS, BLIND_REVIEW_RULE, BLIND_WORDS, BlindAnswerSchema, BlindReviewerAnswerSchema, blindFinding, LOOKED_KINDS, MAKING_DISCIPLINE, REVIEWER_INSTRUCTIONS, ReviewerAnswerSchema, SELF_REVIEW_INSTRUCTIONS } from "../src/making"
import { stormPick } from "./fixtures/look/storm-pick-r17"

// Pictures made here from arithmetic: nothing in this file is anyone's art.
const picture = (side: number, colour: (x: number, y: number) => [number, number, number] | null): Picture => ({
  width: side,
  height: side,
  pixels: Uint8Array.from({ length: side * side * 4 }, (_, index) => ((made) => (made ? (index % 4 === 3 ? 255 : made[index % 4]!) : 0))(colour(Math.floor(index / 4) % side, Math.floor(index / 4 / side)))),
})
const grain = (seed: number, tones: [number, number, number][]) => picture(16, (x, y) => tones[(x * 7 + y * 13 + ((x * y + seed) % 5)) % tones.length]!)
const greys: [number, number, number][] = [[104, 104, 104], [116, 116, 116], [127, 127, 127], [143, 143, 143]]
const rock = grain(1, greys)
// A few big rectangles of flat colour, the way the first ore was drawn.
const slabs = picture(16, (x, y) => (x < 8 && y < 4 ? [70, 110, 160] : x >= 8 && y < 8 ? [36, 52, 70] : y >= 12 ? [30, 44, 60] : [60, 76, 96]))

test("量的是看得见的东西：颜色、最大的一整块纯色、明暗、细碎程度、接缝；透明的不算", () => {
  const flat = measureTexture(picture(16, () => [58, 143, 208]))
  expect(flat).toMatchObject({ colours: 1, top: 1, flat: 1, contrast: 0, busy: 0, seam: null, opaque: 1, like: null })
  const fine = measureTexture(rock)
  expect(fine.colours).toBe(4)
  expect(fine.flat).toBeLessThan(0.05)
  expect(fine.busy).toBeGreaterThan(0.6)
  expect(fine.seam).toBeGreaterThan(0.5)
  expect(fine.seam).toBeLessThan(1.6)
  const big = measureTexture(slabs)
  expect(big.flat).toBe(0.25)
  expect(big.busy).toBeLessThan(0.15)
  // Its top row and bottom row are different slabs: laid edge to edge, the seam is far stronger than anything inside it.
  expect(big.seam).toBeGreaterThan(2)
  const icon = measureTexture(picture(16, (x, y) => (x === y ? [200, 200, 220] : null)))
  expect(icon).toMatchObject({ opaque: 0.063, colours: 1 })
  // How much of a picture could be the rock it sits in: all of the rock itself, none of something of other colours.
  expect(measureTexture(rock, rock).like).toBe(1)
  expect(measureTexture(slabs, rock).like).toBe(0)
})

test("屏幕上有多大是算出来的，不是按题材定的", () => {
  expect(TEXTURE_SEEN).toMatchObject({ distance: 8, texel: 6, block: 96, far: 48, gui: 4, icon: 64, small: 32, slot: 72 })
})

test("照搬的才拒绝：同一个位置九成以上的像素一样；自己画的、改了色的、对着纯色的都不算", () => {
  expect(copied(rock, rock)).toBe(1)
  const touched = picture(16, (x, y) => (y === 0 ? [255, 0, 0] : ([rock.pixels[(y * 16 + x) * 4]!, rock.pixels[(y * 16 + x) * 4 + 1]!, rock.pixels[(y * 16 + x) * 4 + 2]!] as [number, number, number])))
  expect(copied(touched, rock)).toBeGreaterThanOrEqual(COPY_LIMITS.share)
  expect(copied(grain(2, greys.map((tone) => [tone[0] + 40, tone[1], tone[2]] as [number, number, number])), rock)).toBeNull()
  expect(copied(slabs, rock)).toBeNull()
  expect(copied(picture(16, () => [120, 120, 120]), picture(16, () => [122, 121, 120]))).toBeNull()
  expect(copied(picture(32, () => [1, 2, 3]), rock)).toBeNull()
  const note = textureNote(rock, [{ name: "stone", image: rock }])
  expect(note.copy).toBe("stone")
  expect(copyFinding("block", note)).toContain("和拿来对照的原版「stone」几乎一模一样")
  expect(copyFinding("block", textureNote(slabs, [{ name: "stone", image: rock }]))).toBeNull()
})

test("量出来的话一句一条，按六条标准里的名字说；有原版的就把原版的数放在旁边，没有就明说", () => {
  const world = [{ name: "stone", image: rock }, { name: "ore_a", image: grain(3, [...greys, [40, 200, 210]]) }, { name: "ore_b", image: grain(4, [...greys, [250, 200, 60]]) }]
  const note = textureNote(slabs, world, world[0]!)
  expect(note.world).toMatchObject({ names: ["stone", "ore_a", "ore_b"], colours: [4, 5] })
  expect(note.world!.like![0]).toBeGreaterThan(0.5)
  const lines = textureLines("block", note)
  expect(lines.slice(0, 4).map((line) => line.split("：")[0])).toEqual(["认得出", "有主次", "不机械", "配得上"])
  // The rest: one sentence for every measure outside the range of the game's own (the test below).
  expect(lines.slice(4).every((line) => line.startsWith(OUTSIDE_WORDS.mark))).toBe(true)
  expect(lines[1]).toContain("这张贴图用了 4 种颜色")
  expect(lines[1]).toContain("最大的一整块纯色（方方正正的一块）占 25%")
  expect(lines[1]).toContain("周围的原版方块（3 张）是 4 到 5 种颜色")
  expect(lines[2]).toMatch(/接缝两边的差别是图里面相邻像素的 [\d.]+ 倍/)
  expect(lines[3]).toContain("它长在「stone」里，贴图上有 0% 的像素和「stone」自己的颜色相近")
  // The person's version: a sentence or two, and the same comparison.
  expect(texturePlain("block", note).slice(0, 2)).toEqual([expect.stringContaining("这张贴图有 4 种颜色，最大的一整块纯色占了 25%；周围的原版方块有 4 到 5 种颜色"), expect.stringContaining("它长在「stone」里")])
  // Without the game on this machine: its own numbers only, and the person is told nothing was compared.
  const alone = textureNote(slabs)
  expect(alone.world).toBeNull()
  expect(textureLines("block", alone)).toHaveLength(3)
  expect(textureLines("block", alone).join("")).not.toContain("原版")
  expect(texturePlain("block", alone).at(-1)).toBe("这次没有原版的东西可以对照。")
  expect(NO_WORLD_WORDS).toContain("没有原版的东西可以放在旁边对照")
  // An item: how much of the slot it fills is said with the game's own beside it.
  expect(textureLines("item", textureNote(picture(16, (x, y) => (Math.abs(x - y) < 2 ? [200, 220, 240] : null)), [{ name: "blade", image: picture(16, (x, y) => (Math.abs(x - y) < 3 ? [90, 200, 190] : null)) }]))[0]).toMatch(/背包格子里图标只有 64×64 个屏幕像素.+填了格子的 18%（原版物品填了 29%）/)
})

test("方块和物品也是看着做的，说明里讲的是在哪里看、每次给什么、原版只用来对照；没有画法", () => {
  expect(LOOKED_KINDS).toEqual(["model", "texture", "animation", "gesture", "block", "item", "effect"])
  for (const words of [MAKING_DISCIPLINE, SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS]) expect(words).toContain(TEXTURE_GUIDE)
  for (const phrase of ["游戏里的实际大小", "砌成一面墙", "背包格子里的实际大小", "texture_facts", `「${WORLD_SHEET_NAME}」`, "不是让你照着画", "几乎一样的贴图会被拒绝", "这些是事实不是判决"]) expect(TEXTURE_GUIDE).toContain(phrase)
  // Three sentences on judging; not one on how to draw anything.
  expect(TEXTURE_GUIDE).not.toMatch(/描边|高光要|先画|抖动|配色方案|矿石|剑|石头|ore|sword/i)
})

// One figure of another colour on fine grey grain, the same on every block; and the same grain with small flecks scattered over it.
const striped = picture(16, (x, y) => (Math.abs(x - y) < 2 && x > 2 && x < 13 ? [37, 157, 209] : greys[(x * 7 + y * 13 + ((x * y + 1) % 5)) % greys.length]!))
const flecked = (seed: number, tone: [number, number, number]) => picture(16, (x, y) => ((x * 5 + y * 11 + seed) % 23 === 0 || ((x + 1) * 5 + y * 11 + seed) % 23 === 0 ? tone : greys[(x * 7 + y * 13 + ((x * y + seed) % 5)) % greys.length]!))

test("砌成墙以后的重复量得出来：显眼的图案有几处、最大的一处多大", () => {
  expect(measureTexture(striped)).toMatchObject({ marks: 1, motif: 0.117 })
  const scattered = measureTexture(flecked(3, [40, 200, 210]))
  expect(scattered.marks).toBeGreaterThan(5)
  expect(scattered.motif).toBeLessThan(0.02)
  // One colour, or grain with nothing standing out: no figure to repeat.
  expect(measureTexture(picture(16, () => [58, 143, 208]))).toMatchObject({ marks: 0, motif: 0 })
  expect(textureLines("block", textureNote(striped))[2]).toContain("显眼的图案（和底色差得远、连在一起的像素）有 1 处，最大的一处占整张图的 12%")
})

test("量出来落在原版范围以外一截的，成了要回应的事实；在范围以内、没有对照、声明了理由的都不是", () => {
  const world = [{ name: "stone", image: rock }, { name: "ore_a", image: flecked(3, [40, 200, 210]) }, { name: "ore_b", image: flecked(4, [250, 200, 60]) }]
  const note = textureNote(striped, world, world[0]!)
  expect(outsideWorld("block", note).map((found) => found.measure)).toEqual(["motif"])
  const findings = outsideFindings("block", null, note)
  expect(findings).toHaveLength(1)
  expect(findings[0]).toStartWith("不机械：这张贴图上显眼的图案有 1 处，最大的一处占整张图的 12%，周围的原版方块有")
  for (const phrase of ["砌成墙以后同一个图案在每一块的同一个位置原样出现", OUTSIDE_WORDS.mark, `超过 ${OUTSIDE_MARGIN * 100}%`, "「砌成一面墙」", `{"measure":"motif","reason":"……"}`]) expect(findings[0]).toContain(phrase)
  // Said with the facts and to the person, in the same words without the instruction.
  expect(textureLines("block", note).at(-1)).toStartWith(`${OUTSIDE_WORDS.mark}（墙上的重复）：`)
  expect(texturePlain("block", note).at(-1)).toBe("和原版放在一起看，砌成墙以后同一个图案在每一块的同一个位置原样出现，比原版的重复显眼一截。")
  // Declared in the sheet, by the measure's id or its plain name: no longer a finding, and the reason travels with the fact.
  const sheet = { differs: [{ measure: "墙上的重复", reason: "这是一块刻着同一个符文的砖" }] }
  expect(differsReason(sheet, { measure: "motif", name: "墙上的重复" })).toBe("这是一块刻着同一个符文的砖")
  expect(outsideFindings("block", sheet, note)).toEqual([])
  expect(outsideFindings("block", { differs: [{ measure: "motif", reason: "同上" }] }, note)).toEqual([])
  expect(textureLines("block", note, sheet).at(-1)).toContain(`部件说明里声明了「${OUTSIDE_WORDS.meant}」（这是一块刻着同一个符文的砖）`)
  expect(texturePlain("block", note, sheet).at(-1)).toContain("AI 说它本来就该和原版不一样：这是一块刻着同一个符文的砖")
  // Inside the range, or just past an end, is nothing: one of the neighbours' own kind.
  expect(outsideFindings("block", null, textureNote(flecked(5, [220, 60, 60]), world, world[0]!))).toEqual([])
  // Nothing to compare with: nothing changes.
  expect(outsideFindings("block", null, textureNote(striped))).toEqual([])
  expect(outsideFindings("block", null, undefined)).toEqual([])
  // A record from before this was measured has neither number: it still reads, and nothing is held against it.
  const { motif: _motif, marks: _marks, ...old } = note
  expect(outsideWorld("block", { ...old, world: { ...old.world!, motif: undefined, marks: undefined } }).map((found) => found.measure)).toEqual([])
})

// Round 9: a block with more faces than one.
const flecked9 = (seed: number, tone: [number, number, number], count = 6) => picture(16, (x, y) => (Array.from({ length: count }, (_, index) => [(seed * 7 + index * 5) % 16, (seed * 3 + index * 11) % 16]).some((at) => at[0] === x && at[1] === y) ? tone : greys[(x * 7 + y * 13 + ((x * y + seed) % 5)) % greys.length]!))

test("游戏在每个位置用哪一张，照的是游戏自己的算法：和 1.21.1 的类算出来的一模一样；名单的顺序是原版 blockstate 的写法", () => {
  // Printed by the game's own MathHelper.hashCode, Random.setSeed and WeightedBakedModel's arithmetic, x from -2 to 7.
  const game = [
    { count: 3, y: 64, z: 0, picks: [0, 2, 0, 1, 1, 0, 1, 1, 2, 2] },
    { count: 6, y: 65, z: 0, picks: [0, 1, 1, 2, 2, 0, 4, 1, 0, 1] },
    { count: 16, y: -12, z: -7, picks: [2, 9, 6, 15, 6, 8, 6, 3, 9, 8] },
    { count: 2, y: 300, z: 1000, picks: [0, 0, 1, 1, 0, 1, 0, 1, 1, 1] },
  ]
  game.forEach((row) => expect(row.picks.map((_, index) => facePick(index - 2, row.y, row.z, row.count))).toEqual(row.picks))
  expect(facePick(5, 64, 0, 1)).toBe(0)
  expect(faceEntries(1)).toEqual([{ picture: 0, mirror: false, turn: 0 }])
  expect(faceEntries(2, { mirror: true }).map((entry) => `${entry.picture}${entry.mirror ? "m" : ""}`)).toEqual(["0", "0m", "1", "1m"])
  expect(faceEntries(1, { turn: true }).map((entry) => entry.turn)).toEqual([0, 1, 2, 3])
  expect(faceEntries(BLOCK_FACES.extra + 1, { mirror: true, turn: true })).toHaveLength(32)
  // A drawing script may hand back exactly as many pictures as a block can carry.
  expect(DRAWN_PICTURES).toBe(BLOCK_FACES.extra + 1)
})

test("有几张图的方块：重复是在一面墙上量的，每张图各有一句，颜色不是一套的、和别的一样的会被指出来，可以在 differs 里声明", () => {
  const [first, second, third] = [flecked9(1, [40, 150, 220]), flecked9(2, [40, 150, 220]), flecked9(3, [40, 150, 220])]
  // One picture, nothing random: the wall says what the picture says, and the note is what it always was.
  const single = measureTexture(first)
  expect(measureWall([first])).toMatchObject({ pictures: 1, same: 1, marks: single.marks, motif: single.motif })
  expect(textureNote(first)).not.toHaveProperty("wall")
  expect(textureNote(first)).not.toHaveProperty("variants")
  expect(textureLines("block", textureNote(first))[2]).toContain("variants")
  const note = textureNote(first, [], null, [second, third])
  expect(note.wall).toMatchObject({ pictures: 3, mirror: false, turn: false, blocks: BLOCK_FACES.wall ** 2 })
  expect(note.wall!.same).toBeLessThan(0.6)
  expect(note.wall!.motif).toBeLessThan(single.motif)
  expect(note.variants).toHaveLength(2)
  expect(note.among).toEqual({ agree: 1, drawn: 1, twin: null })
  expect(outsideFindings("block", null, note)).toEqual([])
  const lines = textureLines("block", note)
  expect(lines[2]).toContain("从这个方块的 3 种样子里随机用一种")
  expect(lines[2]).toContain("只有一种样子时是 100%")
  expect(lines.filter((line) => line.includes("variants 的第"))).toHaveLength(2)
  expect(texturePlain("block", note).at(-2)).toContain("这个方块在游戏里有 3 种样子")
  // A mirror alone is a mix too; a turn does not show on a wall.
  expect(textureNote(first, [], null, [], { mirror: true }).wall).toMatchObject({ pictures: 1, mirror: true })
  expect(measureWall([first], { turn: true }).same).toBe(1)
  // Another thing's colours drawn on the same ground, and the first picture over again.
  const odd = flecked9(2, [220, 60, 50])
  expect(agreement(odd, [first]).all).toBeGreaterThan(0.9)
  expect(agreement(odd, [first]).drawn).toBeLessThan(VARIANT_LIMITS.agree)
  const mixed = textureNote(first, [], null, [odd, first])
  expect(outsideWorld("block", mixed).map((found) => found.measure)).toEqual([AMONG_MEASURES.agree.id, AMONG_MEASURES.twin.id])
  const told = outsideFindings("block", null, mixed)
  expect(told[0]).toContain("第 2 张图（variants 的第 1 张）")
  expect(told[0]).toContain(`{"measure":"${AMONG_MEASURES.agree.id}"`)
  expect(told[1]).toContain("和第 1 张几乎一模一样")
  expect(told.join("")).not.toContain(OUTSIDE_WORDS.mark)
  expect(outsideFindings("block", { differs: [{ measure: AMONG_MEASURES.agree.id, reason: "两种矿混生" }, { measure: AMONG_MEASURES.twin.name, reason: "故意" }] }, mixed)).toEqual([])
  // A copy of one of the game's own is a copy whichever of the block's pictures it is.
  expect(textureNote(first, [{ name: "stone", image: rock }], null, [rock]).copy).toBe("stone")
  // Each picture is held to the world's range by itself, named.
  const world = [{ name: "stone", image: rock }, { name: "a", image: flecked9(5, [250, 200, 60]) }, { name: "b", image: flecked9(6, [40, 200, 210]) }]
  expect(outsideWorld("block", textureNote(first, world, world[0]!, [slabs])).filter((found) => found.plain.startsWith("第 2 张图：")).map((found) => found.measure)).toContain("flat")
  expect(TEXTURE_GUIDE).toContain("variants")
})

// ---- J2 (round 10): a range made of near-identical pictures is a point ----

// An icon as a share of a slot: a diagonal bar `wide` pixels thick in `tones`, drawn from arithmetic.
const bar = (wide: number, tones: [number, number, number][], seed = 0) => picture(16, (x, y) => (Math.abs(x - y) < wide && x > 1 && x < 14 ? tones[(x * 3 + y * 5 + seed) % tones.length]! : null))
const metals: [number, number, number][][] = [[[200, 220, 240], [120, 150, 180], [60, 80, 110]], [[240, 210, 90], [190, 150, 40], [110, 80, 20]], [[150, 150, 150], [100, 100, 100], [60, 60, 60]], [[90, 220, 200], [40, 160, 150], [20, 90, 90]], [[150, 110, 70], [110, 80, 50], [70, 50, 30]]]
// Five of one kind: the same drawing in five colours. And the broad family: the same five drawings in three thicknesses, fifteen pictures.
const same = metals.map((tones, index) => ({ name: `kind_${index}`, image: bar(2, tones) }))
const broad = { label: "原版里所有拿在手里用的工具和武器的图标", pictures: [1, 2, 3].flatMap((wide) => metals.map((tones, index) => ({ name: `tool_${wide}_${index}`, image: bar(wide, tones, wide) }))) }

test("五张几乎一样的图量出来的范围是一个点：只按它们量，一张老实画的图也进不去；按同一大类量就进得去", () => {
  const made = bar(1, [[80, 200, 230], [40, 120, 160], [20, 60, 90]], 2)
  const narrow = textureNote(made, same)
  // The five agree on how much of the slot they fill to the pixel: the "range" is one number, and the thinner bar is "outside" it.
  expect(narrow.world!.opaque[0]).toBe(narrow.world!.opaque[1])
  expect(outsideWorld("item", narrow).map((found) => found.measure)).toContain("opaque")
  // Held against the family the same picture is inside; what it is put beside has not changed, and both are said.
  const wide = textureNote(made, same, null, [], {}, broad)
  expect(wide.world).toMatchObject({ names: same.map((value) => value.name), opaque: narrow.world!.opaque, family: { label: broad.label, count: 15 } })
  expect(wide.world!.family!.opaque[1]).toBeGreaterThan(wide.world!.family!.opaque[0] * 2)
  expect(outsideFindings("item", null, wide)).toEqual([])
  const line = textureLines("item", wide).find((value) => value.startsWith("对照的范围"))!
  expect(line).toContain("摆在旁边的 5 张是和它最像的几样，只用来对着看")
  expect(line).toContain(`按${broad.label}（15 张）量出来的范围算`)
  expect(textureLines("item", wide)[0]).toContain("原版物品填了")
  expect(texturePlain("item", wide)[0]).toContain(broad.label)
  // Something really unlike the whole family is still found, against the family's own numbers.
  const blob = textureNote(picture(16, (x, y) => (x > 0 && x < 15 && y > 0 && y < 15 ? [200, 60, 60] : null)), same, null, [], {}, broad)
  const found = outsideWorld("item", blob)
  expect(found.map((value) => value.measure)).toContain("opaque")
  expect(found[0]!.words).toContain(`${broad.label}（15 张）`)
})

test("同一大类里彼此几乎一样的那一项只当事实；读到的张数太少时所有的数都只当事实", () => {
  expect(FAMILY_LIMITS.least).toBe(12)
  expect(isRange([0.8, 0.917], 30)).toBe(false)
  expect(isRange([0.036, 0.074], 30)).toBe(true)
  expect(isRange([0.036, 0.074], 11)).toBe(false)
  expect(isRange(null, 30)).toBe(false)
  // A family of one drawing in fifteen colours is a point on every measure but its colours: nothing of a picture unlike it is called outside.
  const clones = { label: "同一张图换了十五种颜色", pictures: Array.from({ length: 15 }, (_, index) => ({ name: `clone_${index}`, image: bar(2, metals[index % 5]!.map((tone) => tone.map((value) => Math.min(255, value + index)) as [number, number, number])) })) }
  const thin = textureNote(bar(1, metals[0]!), same, null, [], {}, clones)
  expect(outsideWorld("item", thin).map((found) => found.measure)).not.toContain("opaque")
  expect(textureLines("item", thin).find((value) => value.startsWith("对照的范围"))).toContain("是一个点不是一个范围：只当事实说，不拿来要求它")
  // Too few: said in so many words, and nothing is held.
  const few = textureNote(picture(16, (x, y) => (x > 0 && x < 15 && y > 0 && y < 15 ? [200, 60, 60] : null)), same, null, [], {}, { label: "只有五张", pictures: broad.pictures.slice(0, 5) })
  expect(outsideFindings("item", null, few)).toEqual([])
  expect(textureLines("item", few).find((value) => value.startsWith("对照的范围"))).toContain("这一类只读到 5 张，不到 12 张")
})

test("差不到一个像素不算在范围以外；以前的记录没有这一大类，照以前的办法；照搬这一大类里的任何一张都是照搬", () => {
  // The family's flattest shape is three pixels of a twenty-pixel bar; one that has two is a quarter less and one pixel less.
  const family = { label: "十五张", pictures: broad.pictures }
  const note = textureNote(bar(1, [[80, 200, 230]]), same, null, [], {}, family)
  const low = { ...note, flat: Number((note.world!.family!.flat[0] * 0.7).toFixed(3)) }
  expect(note.world!.family!.flat[0] - low.flat).toBeLessThan(1 / (note.opaque * 256))
  expect(outsideWorld("item", low).map((found) => found.measure)).not.toContain("flat")
  // A record from before families were measured is read as it was written: held against the few beside it.
  const old = textureNote(bar(1, [[80, 200, 230], [40, 120, 160]], 2), same)
  expect(old.world).not.toHaveProperty("family")
  expect(textureLines("item", old).some((value) => value.startsWith("对照的范围"))).toBe(false)
  expect(outsideWorld("item", old).map((found) => found.measure)).toContain("opaque")
  // One of the family, over again, is a copy although it was not among the few put beside.
  expect(textureNote(slabs, same, null, [], {}, { label: "一张", pictures: [{ name: "lone", image: slabs }] }).copy).toBe("lone")
  expect(TEXTURE_GUIDE).toContain("同一大类的几十张量出来的")
})

// Round 17: an icon that passed every measure here and could not be recognised. What is measured of shape, and why it stays a fact.
test("轮廓：两张图都填了的格子 ÷ 至少一张填了的格子，只当事实；盲认的问题和判断的界线里没有任何一样具体的东西", () => {
  const bar = picture(16, (x, y) => (x + y === 15 || x + y === 16 ? [120, 90, 60] : null))
  const other = picture(16, (x, y) => (x + y === 15 || x + y === 16 ? [200, 200, 210] : null))
  const dot = picture(16, (x, y) => (x === 0 && y === 0 ? [0, 0, 0] : null))
  // Colour plays no part; nothing in common is nothing; sizes that differ are not compared.
  expect(outlineOverlap(bar, other)).toBe(1)
  expect(outlineOverlap(bar, dot)).toBe(0)
  expect(outlineOverlap(bar, picture(8, () => [1, 1, 1]))).toBeNull()
  // The hook's handle lies on the same slant as the bar; its head lies elsewhere.
  expect(outlineOverlap(stormPick(), bar)).toBe(0.04)
  // The owner's icon as measured: six colours on 57 of 256 pixels. Nothing about it is refused by a count.
  expect(measureTexture(stormPick())).toMatchObject({ width: 16, height: 16, colours: 6, opaque: 0.223 })
  // A note from before outlines were measured reads as it did.
  expect(TextureNoteSchema.safeParse(textureNote(stormPick())).success).toBe(true)
  expect("outline" in textureNote(stormPick())).toBe(false)
  // The question, the rule and the gate: general words only. The answer of a blind naming is three fields; a reviewer told afterwards adds one.
  expect([...BLIND_KINDS]).toEqual(["item", "block"])
  expect(Object.keys(BlindAnswerSchema.shape)).toEqual(["sees", "also", "because"])
  expect(Object.keys(BlindReviewerAnswerSchema.shape)).toEqual([...Object.keys(ReviewerAnswerSchema.shape), "fits"])
  expect(BlindReviewerAnswerSchema.shape.fits.options).toEqual([...BLIND_FITS])
  // Round 18: the reviewer and the maker are told the same reason and the same question for a doubt; neither is told a subject.
  for (const text of [BLIND_REVIEW_RULE, BLIND_GUIDE]) for (const phrase of ["它的名字多半就在旁边", "一种材料，或者别的东西身上的一部分", "不能被当成另一样具体的东西", "玩家在箱子里一堆别的物品中间看到它，会不会把它当成那另一样东西"]) expect(text).toContain(phrase)
  for (const fit of BLIND_FITS) expect(BLIND_REVIEW_RULE).toContain(`"${fit}"`)
  expect(BLIND_REVIEW_RULE).toContain(`在 with_name 和 no 之间拿不准的时候`)
  expect(BLIND_GUIDE).toContain("由这样东西自己决定")
  expect(MAKING_DISCIPLINE).toContain(BLIND_GUIDE)
  expect(BLIND_INSTRUCTIONS).toContain("没有名字，没有任何说明")
  expect(BLIND_INSTRUCTIONS).toContain(`sees 就写「${BLIND_WORDS.lost}」`)
  expect(BLIND_REVIEW_RULE).toContain("只按 sees 判断，不按 also")
  expect(BLIND_REVIEW_RULE).toContain(BLIND_WORDS.gate)
  expect(blindFinding("某样东西", { sees: "另一样东西", also: [], because: "形状像" })).toContain("这一项是硬门槛：只能把图改到认得出，写理由不算。")
  expect(MAKING_DISCIPLINE).toContain("一个不知道名字的人会把它叫成什么")
  expect(REVIEWER_INSTRUCTIONS).not.toContain(BLIND_WORDS.name)
})
