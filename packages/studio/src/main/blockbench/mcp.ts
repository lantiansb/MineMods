import { z } from "zod"
import { parseBlockbenchCommand } from "./ipc"
import type { BlockbenchSession } from "./session"
import type { BlockbenchCommand, BlockbenchSnapshot } from "./protocol"

export const BlockbenchMcpRequestSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
  expectedRevision: z.number().int().min(0),
  command: z.unknown(),
}).strict()
export type BlockbenchMcpRequest = z.infer<typeof BlockbenchMcpRequestSchema>

export async function dispatchBlockbenchCommand(session: BlockbenchSession, request: BlockbenchMcpRequest): Promise<BlockbenchSnapshot> {
  const input = BlockbenchMcpRequestSchema.parse(request)
  if (input.sessionId !== session.sessionId) throw new Error("Unknown Blockbench session")
  const command = parseBlockbenchCommand(input.command)
  return session.request(command, input.expectedRevision)
}

export async function dispatchInternalMcp(session: BlockbenchSession, command: BlockbenchCommand, expectedRevision = session.revision) {
  return dispatchBlockbenchCommand(session, { sessionId: session.sessionId, expectedRevision, command })
}
