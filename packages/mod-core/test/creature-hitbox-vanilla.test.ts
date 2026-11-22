import { expect, test } from "bun:test"
import { ABILITY_REVIEWER_INSTRUCTIONS, ABILITY_SELF_REVIEW_INSTRUCTIONS, abilityScope, HITBOX_FAULT_MARK } from "@minemods/studio-ai/making"
import { HITBOX_FIT, hitboxFault, hitboxFit, hitboxLines, proposedCore } from "../src/creature-hitbox"
import { VANILLA_SHAPES, vanillaDesign } from "./vanilla-shapes"

/**
 * The thresholds of the collision-box check against the game's own creatures: a threshold that the game's own creatures fail is too strict, and one a long way past the
 * most any of them reaches checks nothing. Each creature is measured in the box it really has (`VANILLA_SHAPES`, read off the 1.21.1 client).
 */
const names = Object.keys(VANILLA_SHAPES)
const own = (name: string) => hitboxFit({ core: { width: VANILLA_SHAPES[name]!.box[0], height: VANILLA_SHAPES[name]!.box[1] } }, vanillaDesign(name))
const standsClear = (fit: ReturnType<typeof own>) => Math.max(...fit.clear.flatMap((entry) => (entry.clear ? [entry.clear.side, entry.clear.ends, entry.clear.top, entry.clear.bottom] : [])))

test("none of the game's own creatures is called a misfit in its own box", () => {
  expect(names).toHaveLength(25)
  names.forEach((name) => {
    const fit = own(name)
    expect({ name, faults: fit.faults }).toEqual({ name, faults: [] })
    expect(hitboxLines(fit).some(hitboxFault)).toBe(false)
  })
})

test("the thresholds sit just above what the game's own creatures reach, not far past it and not under it", () => {
  const fits = names.map(own)
  const clear = Math.max(...fits.map(standsClear))
  const out = Math.max(...fits.map((fit) => Math.max(fit.rest.far, fit.moving?.far ?? 0)))
  // Above the most any of them stands clear or reaches out, by less than the quarter block they are rounded up to.
  expect(HITBOX_FIT.air).toBeGreaterThanOrEqual(clear)
  expect(HITBOX_FIT.air - clear).toBeLessThan(0.25)
  expect(HITBOX_FIT.out).toBeGreaterThanOrEqual(out)
  expect(HITBOX_FIT.out - out).toBeLessThan(0.25)
  // The half block this started with failed more than a quarter of them.
  const failed = fits.filter((fit) => standsClear(fit) > 0.5 || Math.max(fit.rest.far, fit.moving?.far ?? 0) > 0.5)
  expect(failed.length / names.length).toBeGreaterThan(0.25)
})

test("how much of a box is empty is a fact, not a fault: the game's own creatures are half empty, and no size of box brings it down", () => {
  const empty = names.map((name) => own(name).rest.empty).sort((a, b) => a - b)
  expect(empty[Math.floor(names.length / 2)]).toBeGreaterThan(0.5)
  // A chicken in a box of 0.6 by 0.9 (what a maker settled on, and a reviewer kept turning back for 44% empty) is a fit one, with that said as a fact.
  const chicken = hitboxFit({ core: { width: 0.6, height: 0.9 } }, vanillaDesign("chicken"))
  expect(chicken.faults).toEqual([])
  expect(chicken.rest.empty).toBeGreaterThan(0.4)
  const lines = hitboxLines(chicken)
  expect(lines.some(hitboxFault)).toBe(false)
  expect(lines.join("")).toContain("只是事实，不算不合身")
})

test("the box the tool suggests for a shape is one it does not fault, unless it says that parts are needed", () => {
  names.forEach((name) => {
    const design = vanillaDesign(name)
    const suggested = proposedCore(design)
    const fit = hitboxFit({ core: { width: suggested.width, height: suggested.height } }, design)
    expect({ name, split: suggested.split, faults: suggested.split ? [] : fit.faults }).toEqual({ name, split: suggested.split, faults: [] })
  })
})

test("a box far past what the game's own creatures have is still a misfit, with the way out said", () => {
  const wide = hitboxFit({ core: { width: 3, height: 0.7 } }, vanillaDesign("chicken"))
  expect(wide.faults.map((found) => found.fault)).toEqual(["air"])
  // A box a golem hardly shows in leaves most of it a block out.
  const tiny = hitboxFit({ core: { width: 0.1, height: 0.1 } }, vanillaDesign("iron_golem"))
  expect(tiny.faults.map((found) => found.fault)).toContain("out")
  expect(hitboxLines(tiny).filter(hitboxFault).join("")).toContain("hitbox.justified")
})

test("whoever judges a creature's boxes is told to hold only the measured misfit, and to set no number of its own", () => {
  // Both the AI that made it and the one that reviews it: the unmeasured numbers are facts, the head, wings and tail are the model's.
  for (const instructions of [ABILITY_REVIEWER_INSTRUCTIONS, ABILITY_SELF_REVIEW_INSTRUCTIONS]) {
    expect(instructions).toContain(`「${HITBOX_FAULT_MARK}」开头的句子`)
    expect(instructions).toContain("不要自己另定一个数")
    expect(instructions).toContain("头、翅膀、尾巴")
    // The judgement it used to be asked for by eye, with no number to hold it to.
    expect(instructions).not.toContain("大出一大截")
  }
  expect(abilityScope("彩虹小鸡", [], { abilities: false, hitbox: true }).judging).not.toContain("大出一截")
})
