import { expect, test } from "bun:test"
import { identifiersIn, sayPieces } from "@minemods/mod-core/play-words"
import { assetCheck } from "../src/renderer/features/asset-check"
import { BAD, IDS, sampleProject } from "../../mod-core/test/fixtures/gameplay/sample"

// Round 18: the acceptance card showed "Alarm.java … java.net.Socket" to a person. The card reads the sentence of the rule in its normal view and the quoted line under 高级.
const tile = { id: "thing", asset_id: IDS.box_guard, kind: "gameplay", brief: "", needs: [], preview: { source: "none" }, judged: undefined } as never

test("验收卡片：玩法没过的那一条，普通视图读的是讲规矩的一句话，带文件和类名的原话留给「高级」", () => {
  const check = assetCheck(sampleProject(), [{ id: "thing", asset_id: IDS.box_guard }], tile, { kind: "gameplay", document: BAD.opens_socket, progress: null })!
  const finding = check.criteria.flatMap((criterion) => criterion.findings)[0]!
  expect(finding.message).toContain("java.net.Socket")
  expect(finding.plain).toBe("代码越界了（1 处）：代码想连接网络，玩法不能联网。")
  expect(identifiersIn(finding.plain!)).toEqual([])
  // What the window sets from it: no piece of code at all in the normal view.
  expect(sayPieces(finding.plain!, false).some((piece) => piece.code)).toBe(false)
  // The quoted line still reads as a sentence with its names set as code tokens, so 高级 loses nothing.
  expect(sayPieces(finding.message, false).filter((piece) => piece.code).map((piece) => piece.text).join(" ")).toContain("java.net.Socket")
})
