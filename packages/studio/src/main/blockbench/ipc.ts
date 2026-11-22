import { BlockbenchCommandSchema, BlockbenchEnvelopeSchema, BLOCKBENCH_CHANNEL, type BlockbenchCommand, type BlockbenchEnvelope } from "./protocol"

export type BlockbenchMessageContext = {
  origin: string
  sessionId: string
  nonce: string
}

export const isBlockbenchOrigin = (origin: string, allowedOrigin: string) => origin === allowedOrigin

export function parseBlockbenchEnvelope(value: unknown, eventOrigin: string, context: BlockbenchMessageContext): BlockbenchEnvelope {
  if (!isBlockbenchOrigin(eventOrigin, context.origin)) throw new Error("Rejected Blockbench message origin")
  const envelope = BlockbenchEnvelopeSchema.parse(value)
  if (envelope.channel !== BLOCKBENCH_CHANNEL || envelope.sessionId !== context.sessionId || envelope.nonce !== context.nonce)
    throw new Error("Rejected Blockbench message session")
  if (envelope.kind === "request" && !envelope.command) throw new Error("Blockbench request is missing a command")
  if (envelope.kind !== "request" && envelope.command) throw new Error("Only request messages may contain commands")
  return envelope
}

export function parseBlockbenchCommand(value: unknown): BlockbenchCommand {
  const command = BlockbenchCommandSchema.parse(value)
  const serialized = JSON.stringify(command)
  if (serialized.length > 24_000_000) throw new Error("Blockbench command is too large")
  return command
}

export function makeBlockbenchEnvelope(input: Omit<BlockbenchEnvelope, "channel">): BlockbenchEnvelope {
  return BlockbenchEnvelopeSchema.parse({ ...input, channel: BLOCKBENCH_CHANNEL })
}

export function createBlockbenchMessageHandler(options: {
  context: BlockbenchMessageContext
  onRequest: (command: BlockbenchCommand, envelope: BlockbenchEnvelope) => Promise<Pick<BlockbenchEnvelope, "ok" | "revision" | "snapshot" | "error">>
  send: (message: BlockbenchEnvelope) => void
}) {
  return async (event: { origin: string; data: unknown }) => {
    const envelope = parseBlockbenchEnvelope(event.data, event.origin, options.context)
    if (envelope.kind !== "request" || !envelope.command) return
    const result = await options.onRequest(parseBlockbenchCommand(envelope.command), envelope)
    options.send(makeBlockbenchEnvelope({
      nonce: options.context.nonce,
      sessionId: options.context.sessionId,
      requestId: envelope.requestId,
      kind: "response",
      ...result,
    }))
  }
}
