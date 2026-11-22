import { expect, test } from "bun:test"
import { systemProxy } from "../src/main/system-proxy"

test("the system's proxy is passed on as an address when it is one downloads and Gradle can use", () => {
  expect(systemProxy("PROXY 127.0.0.1:7890")).toBe("http://127.0.0.1:7890")
  expect(systemProxy("PROXY proxy.corp.local:8080; DIRECT")).toBe("http://proxy.corp.local:8080")
  expect(systemProxy("HTTPS secure.example:443")).toBe("https://secure.example:443")
  // Nothing set, or a kind neither undici nor the JVM's http proxy can speak: nothing is changed.
  expect(systemProxy("DIRECT")).toBeNull()
  expect(systemProxy("SOCKS5 127.0.0.1:1080")).toBeNull()
  expect(systemProxy("")).toBeNull()
  expect(systemProxy("PROXY not a host")).toBeNull()
})
