import { z } from "zod"

export const SpeechInputSchema = z.strictObject({
  audio: z.string().min(4).max(28_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mime: z.enum(["audio/webm", "audio/ogg", "audio/wav", "audio/mp4"]),
})
export type SpeechInput = z.infer<typeof SpeechInputSchema>
