import { spawn } from "node:child_process"
import path from "node:path"
import { createInterface } from "node:readline"

const CPU_PROBE_TIMEOUT_MS = 3_000
// An occasional JVM timer or housekeeping tick should not renew the stall window.
const CPU_PROGRESS_MS = 100
const WINDOWS_CPU_QUERY = `
$ProgressPreference = 'SilentlyContinue'
while ($null -ne [Console]::ReadLine()) {
  try {
    $rows = foreach ($p in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,KernelModeTime,UserModeTime -ErrorAction Stop) {
      if ($null -ne $p.CreationDate) {
        "$($p.ProcessId) $($p.ParentProcessId) $(([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds()) $([int64]$p.KernelModeTime + [int64]$p.UserModeTime)"
      }
    }
    [Console]::WriteLine(($rows -join ';'))
  } catch {
    [Console]::WriteLine('')
  }
}
`

export type ProcessTreeCpu = { rootStarted: number; processes: ReadonlyMap<string, number> }
export type ProcessCpuWatch = { read: (pid: number) => Promise<ProcessTreeCpu | null>; close?: () => void }

function ownedCpu(pid: number, line: string) {
  const rows = line.split(";").flatMap((line) => {
    const match = /^(\d+) (\d+) (\d+) (\d+)$/.exec(line.trim())
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), started: Number(match[3]), cpu: Number(match[4]) / 10_000 }] : []
  })
  const root = rows.find((row) => row.pid === pid)
  if (!root) return null
  const processes = new Map<string, number>()
  const tree = [root]
  for (const entry of tree) {
    processes.set(`${entry.pid}:${entry.started}`, entry.cpu)
    for (const child of rows) {
      // An older process with this parent PID may belong to a previous owner of the number.
      if (child.parent === entry.pid && child.started >= entry.started && !tree.includes(child)) tree.push(child)
    }
  }
  return { rootStarted: root.started, processes }
}

/** Keep one hidden sampler for this build. Repeated PowerShell starts can be slower than the probes themselves. */
export function watchWindowsProcessTreeCpu(): ProcessCpuWatch | undefined {
  const windows = process.env.SystemRoot
  if (process.platform !== "win32" || !windows) return undefined
  const executable = path.join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  const start = () => {
    const worker = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_CPU_QUERY], { windowsHide: true })
    worker.stderr.resume()
    worker.stdin.on("error", () => complete(""))
    worker.on("error", () => complete(""))
    createInterface({ input: worker.stdout }).on("line", complete).on("close", () => complete(""))
    return worker
  }
  let worker: ReturnType<typeof start> | undefined
  let request: ReturnType<typeof Promise.withResolvers<string>> | undefined
  const complete = (line: string) => {
    const pending = request
    request = undefined
    pending?.resolve(line)
  }
  return {
    async read(pid) {
      if (request || (worker && worker.exitCode !== null)) return null
      worker ??= start()
      const answer = (request = Promise.withResolvers<string>())
      worker.stdin.write("\n")
      const timeout = { timer: undefined as ReturnType<typeof setTimeout> | undefined }
      const line = await Promise.race([answer.promise, new Promise<string>((resolve) => (timeout.timer = setTimeout(() => resolve(""), CPU_PROBE_TIMEOUT_MS)))]).finally(() => clearTimeout(timeout.timer))
      return line ? ownedCpu(pid, line) : null
    },
    close() {
      complete("")
      worker?.kill()
    },
  }
}

export function cpuAdvanced(before: ProcessTreeCpu | null, after: ProcessTreeCpu | null) {
  if (!before || !after || before.rootStarted !== after.rootStarted) return false
  const time = [...after.processes].reduce((sum, [key, cpu]) => sum + Math.max(0, cpu - (before.processes.get(key) ?? 0)), 0)
  return time >= CPU_PROGRESS_MS
}
