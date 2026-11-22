/**
 * The proxy the computer is set to use, as Chromium resolved it for a URL ("PROXY host:port; DIRECT"), in the form the
 * downloads and Gradle read from HTTPS_PROXY. Round 27: on a machine whose way out is a proxy set in the system (not in
 * an environment variable), every download of the game's files went out directly and was reset, while the browser and
 * the launcher on the same machine worked. Only an HTTP(S) proxy can be passed on; a SOCKS one or none gives null and
 * nothing changes.
 */
export function systemProxy(resolved: string): string | null {
  for (const entry of resolved.split(";").map((value) => value.trim()).filter(Boolean)) {
    const [kind, address] = entry.split(/\s+/, 2)
    if (kind === "DIRECT") return null
    if ((kind === "PROXY" || kind === "HTTPS") && address && /^[\w.-]+:\d{1,5}$/.test(address)) return `${kind === "HTTPS" ? "https" : "http"}://${address}`
  }
  return null
}
