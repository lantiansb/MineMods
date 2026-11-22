import { buildMcpHandoff, type McpHandoffInput } from "../src/main/mcp-handoff"
import { GUIDE_TOPIC_IDS } from "../src/main/mcp-guide-topics"
import { guideText } from "../src/main/mcp-guide"

/**
 * Everything an outside AI can be given to read about the work, in one string a test can look into: the start-up text the person copies and every
 * topic of `get_guide`. The start-up text used to be all of it; a test that asked "does the hand-off say this" asks "can the AI read this when it
 * needs it" instead. Where a test is about what the start-up text itself says (the connection, the project, the rules for everything) it uses
 * `buildMcpHandoff`; where it is about what comes with a claimed task it uses `claim_task` (`mcp-guide.test.ts`).
 */
export const everythingToRead = (input: McpHandoffInput) =>
  [buildMcpHandoff(input), ...GUIDE_TOPIC_IDS.map((topic) => guideText(topic, { review: input.review !== false, complexity: input.complexity }))].join("\n\n")

export const CONFIGURATION = JSON.stringify(
  {
    mcpServers: {
      "minemods-studio": {
        command: "C:\\Program Files\\MineMods Studio\\electron.exe",
        args: ["C:\\Users\\alice\\AppData\\Local\\Programs\\MineMods Studio\\resources\\app.asar\\out\\main\\mcp-stdio.js", "--mcp-stdio", "--connection", "C:\\Users\\alice\\AppData\\Roaming\\MineMods Studio\\mcp\\connection.json"],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    },
  },
  null,
  2,
)
export const PROJECT = { id: "01a0ed3c-5a27-7119-95ca-301d63b60b9f", name: "蓝晶矿洞的探险与冒险", revision: 42 }
