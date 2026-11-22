import { BrowserWindow, session } from "electron"
import { lookQueue, type LookPictures, type LookRenderer } from "./look-job"

/** How long one look may take before it is given up, window and all. */
export const LOOK_TIMEOUT_MS = 45_000

/**
 * Draws looks in a window that is never shown, never focusable and absent from the taskbar: the person
 * must not see it or lose their place because of it. It renders offscreen, in a session of its own that
 * may load nothing but local files, and is created on the first look. Looks are drawn one after
 * another; one that fails or takes too long loses its window, so the next starts clean. `render` always answers.
 */
export function createLookWindow(page: string): { render: LookRenderer; close(): void } {
  const state: { current?: { window: BrowserWindow; loaded: Promise<void> } } = {}

  const drop = () => {
    const current = state.current
    state.current = undefined
    if (current && !current.window.isDestroyed()) current.window.destroy()
  }

  const open = async () => {
    if (!state.current) {
      const partition = session.fromPartition("minemods-look")
      partition.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data|blob|devtools):/.test(details.url) }))
      partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      const window = new BrowserWindow({
        show: false,
        focusable: false,
        skipTaskbar: true,
        width: 1600,
        height: 1100,
        webPreferences: { offscreen: true, backgroundThrottling: false, session: partition, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
      })
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      window.webContents.on("will-navigate", (event) => event.preventDefault())
      const opened = { window, loaded: window.loadFile(page) }
      state.current = opened
      window.webContents.on("render-process-gone", () => {
        if (state.current === opened) drop()
      })
    }
    const opened = state.current
    await opened.loaded
    return opened.window
  }

  return {
    render: lookQueue(async (job, progress) => {
      const { webContents } = await open()
      if (!progress) return webContents.executeJavaScript(`window.renderLook(${JSON.stringify(job)})`) as Promise<LookPictures>
      await webContents.executeJavaScript(`window.openLook(${JSON.stringify(job)})`)
      const pictures: Extract<LookPictures, { ok: true }>["pictures"] = []
      try {
        for (const [index] of job.sheets.entries()) {
          pictures.push(await webContents.executeJavaScript(`window.drawLookSheet(${index})`))
          progress(pictures.length, job.sheets.length)
        }
        return { ok: true, pictures }
      } catch (error) {
        return { ok: false, reason: /webgl/i.test(String(error)) ? "这台电脑现在画不出三维预览（没有可用的图形加速）。" : "预览图没有画出来。" }
      } finally {
        if (!webContents.isDestroyed()) await webContents.executeJavaScript("window.closeLook()").catch(() => undefined)
      }
    }, { timeoutMs: LOOK_TIMEOUT_MS, giveUp: drop }),
    close: drop,
  }
}
