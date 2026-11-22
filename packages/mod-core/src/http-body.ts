import type { Readable } from "node:stream"

/** Undici emits an asynchronous AbortError when a response is discarded. Handle that cancellation before destroying
 * the stream; the caller still reports its original HTTP or size error. Unhandled stream errors terminate Node workers. */
export function discardBody(body: Readable) {
  body.once("error", () => {})
  body.destroy()
}
