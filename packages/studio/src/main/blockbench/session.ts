import { parseBlockbenchCommand } from "./ipc"
import { BlockbenchSnapshotSchema } from "./protocol"
import type { BlockbenchCommand, BlockbenchEnvelope, BlockbenchSnapshot } from "./protocol"

export type BlockbenchTransport = {
  request: (envelope: BlockbenchEnvelope) => Promise<BlockbenchEnvelope>
}

export type BlockbenchSession = {
  sessionId: string
  nonce: string
  projectId: string
  assetId: string
  revision: number
  request: (command: BlockbenchCommand, expectedRevision?: number) => Promise<BlockbenchSnapshot>
}

const token = () => crypto.randomUUID().replaceAll("-", "")

export function createBlockbenchSession(options: {
  projectId: string
  assetId: string
  transport: BlockbenchTransport
  initialRevision?: number
  sessionId?: string
  nonce?: string
}): BlockbenchSession {
  const sessionId = options.sessionId ?? token()
  const nonce = options.nonce ?? token()
  const session: BlockbenchSession = {
    sessionId,
    nonce,
    projectId: options.projectId,
    assetId: options.assetId,
    revision: options.initialRevision ?? 0,
    request: async (value: BlockbenchCommand, expectedRevision?: number) => {
      const command = parseBlockbenchCommand(value)
      const requestedRevision = expectedRevision ?? session.revision
      if (requestedRevision !== session.revision) throw new Error(`Blockbench revision conflict: expected ${requestedRevision}, current ${session.revision}`)
      const envelope: BlockbenchEnvelope = {
        channel: "minemods:blockbench:v1",
        nonce,
        sessionId,
        requestId: token(),
        kind: "request",
        command,
      }
      const response = await options.transport.request(envelope)
      if (response.kind !== "response" || response.requestId !== envelope.requestId || response.sessionId !== sessionId || response.nonce !== nonce || response.channel !== envelope.channel) throw new Error("Invalid Blockbench response")
      if (!response.ok) throw new Error(response.error ?? "Blockbench command failed")
      if (!response.snapshot) throw new Error("Blockbench response is missing a snapshot")
      const snapshot = BlockbenchSnapshotSchema.parse(response.snapshot)
      if (response.revision !== snapshot.revision) throw new Error("Invalid Blockbench snapshot revision")
      session.revision = response.revision ?? snapshot.revision
      if (!Number.isInteger(session.revision) || session.revision < 0) throw new Error("Invalid Blockbench revision")
      return snapshot
    },
  } satisfies BlockbenchSession
  return session
}
