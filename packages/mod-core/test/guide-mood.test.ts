import { expect, test } from "bun:test"
import { mood } from "../src/guide"

const project = { blocks: [], items: [] }

// broad9 w4b: a wolf that growls first and a boss asleep until somebody comes near were both summed up as "goes for any player it sees".
test("先警告的、先睡着的敌对生物，说明书先说它开打以前做什么，用的是游戏里的数", () => {
  expect(mood(project, { behavior: "hostile", engagement: "any_player" })).toBe("看见玩家就上去打（最近的那个）")
  expect(mood(project, { behavior: "hostile", engagement: "any_player", habits: { alert: { distance: 10, attack_distance: 3 } } })).toBe("玩家走到 10 格以内先警告，靠到 3 格以内才扑上来；扑上来以后看见玩家就上去打（最近的那个）")
  expect(mood(project, { behavior: "hostile", engagement: "any_player", boss: { intro: { wake_distance: 12 } } })).toBe("平时睡着，有人走到 12 格以内才醒，醒了以后看见玩家就上去打（最近的那个）")
  // A warning with no nearer attack distance only looks; how it fights is unchanged, and so are the words.
  expect(mood(project, { behavior: "hostile", habits: { alert: { distance: 10 } } })).toBe("看见生存模式的玩家就会追上来攻击")
  expect(mood(project, { behavior: "passive", habits: { alert: { distance: 10, attack_distance: 3 } } })).toBe("不会主动攻击玩家")
})
