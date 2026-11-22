import { execFile } from "node:child_process"
import path from "node:path"

type Holder = "studio" | "external" | "both" | "unknown"

export class ProjectRecordBusyError extends Error {
  constructor(readonly holder: Holder, cause: unknown) {
    const owner = {
      studio: "Windows 仍检测到当前 Studio 后台进程占用工程文件。",
      external: "Windows 检测到有其他程序打开了工程文件。请关闭占用它的程序后重试。",
      both: "Windows 检测到当前 Studio 后台进程和其他程序都打开了工程文件。请关闭其他占用程序后重试。",
      unknown: "Windows 未能确认有哪个进程占用该文件，请检查文件写入权限后重试。",
    }[holder]
    super("工程文件多次尝试后仍无法替换，原版本已保留。" + owner, { cause })
    this.name = "ProjectRecordBusyError"
  }
}

// Restart Manager samples the current holders. Only query after exhausting the retry budget.
// File names travel through the child environment as data, never as PowerShell source.
const lookup = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using FILETIME = System.Runtime.InteropServices.ComTypes.FILETIME;

public static class ProjectFileUsers {
  [StructLayout(LayoutKind.Sequential)]
  struct Identity { public int pid; public FILETIME started; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct User {
    public Identity process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string service;
    public int type;
    public uint status;
    public uint session;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint handle, int flags, StringBuilder key);
  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint handle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint handle, uint count, string[] files, uint apps, IntPtr appList, uint services, IntPtr serviceList);
  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] User[] users, ref uint reason);

  public static string Classify(string file, int self) {
    uint handle;
    if (RmStartSession(out handle, 0, new StringBuilder(33)) != 0) return "unknown";
    try {
      if (RmRegisterResources(handle, 1, new[] {file}, 0, IntPtr.Zero, 0, IntPtr.Zero) != 0) return "unknown";
      uint needed, count = 0, reason = 0;
      if (RmGetList(handle, out needed, ref count, null, ref reason) != 234 || needed > 1024) return "unknown";
      var users = new User[needed];
      count = needed;
      if (RmGetList(handle, out needed, ref count, users, ref reason) != 0 || count == 0) return "unknown";
      bool studio = false, other = false;
      for (int i = 0; i < count; i++) {
        if (users[i].process.pid == self) studio = true;
        else other = true;
      }
      return studio ? (other ? "both" : "studio") : "external";
    } finally { RmEndSession(handle); }
  }
}
"@
[ProjectFileUsers]::Classify($env:MINEMODS_RECORD_TARGET, [int]$env:MINEMODS_RECORD_WRITER)
`

export function windowsRecordHolder(target: string): Promise<Holder> {
  const powershell = path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  return new Promise(resolve => {
    execFile(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(lookup, "utf16le").toString("base64")], {
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, MINEMODS_RECORD_TARGET: target, MINEMODS_RECORD_WRITER: String(process.pid) },
    }, (error, stdout) => {
      const holder = stdout.trim()
      resolve(!error && (holder === "studio" || holder === "external" || holder === "both") ? holder : "unknown")
    })
  })
}
