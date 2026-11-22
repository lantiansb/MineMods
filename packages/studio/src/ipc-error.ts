/**
 * Electron wraps every rejection of an `ipcRenderer.invoke` call as "Error invoking remote method '<channel>': Error: <message>"
 * (the second error name is whatever the main process threw, e.g. TypeError). That wrapping is transport noise: the sentence
 * after it is the one written for the person. It is removed once, where the window's bridge turns a rejected call into the error
 * the renderer sees (`main/preload.ts`), so no screen has to remember to do it; the renderer's older local replaces stay harmless.
 */
const WRAPPING = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/

export const withoutIpcWrapping = (message: string) => message.replace(WRAPPING, "")

/** The error a renderer should see for a failed bridge call: the same kind of value, with the transport wrapping off its message. */
export function unwrappedIpcError(cause: unknown): unknown {
  if (cause instanceof Error) {
    const message = withoutIpcWrapping(cause.message)
    return message === cause.message ? cause : new Error(message)
  }
  if (typeof cause === "string") return new Error(withoutIpcWrapping(cause))
  return cause
}
