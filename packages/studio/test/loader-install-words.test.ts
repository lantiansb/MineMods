import { expect, test } from "bun:test"
import { publicError } from "../src/main/service"

/** What the person reads when a Forge or NeoForge install fails (mod-core `store/instance.ts` sets `code`): the network, or the installer itself; never the generic sentence. */
test("a loader install that lost the network says so and to try again; one that failed otherwise points at the installer's last lines", () => {
  const failed = (code: string) => Object.assign(new Error("LOADER_INSTALL_FAILED: mirror: exit 1 (network): javax.net.ssl.SSLHandshakeException"), { code })
  const network = publicError(failed("LOADER_INSTALL_NETWORK"))
  expect(network).toContain("网络断了")
  expect(network).toContain("再点一次")
  expect(network).not.toContain("操作未完成")
  const own = publicError(failed("LOADER_INSTALL_FAILED"))
  expect(own).toContain("安装器最后几行")
  expect(own).not.toContain("操作未完成")
})
