Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Tray {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public static List<IntPtr> Find(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h, out p); if (p==pid) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static IntPtr MainWindow(uint pid) {
    foreach (var h in Find(pid)) {
      if (!IsWindowVisible(h)) continue;
      RECT r; GetWindowRect(h, out r);
      int w = r.R - r.L;
      if (w > 900) return h;   // 主窗口比面板宽
    }
    return IntPtr.Zero;
  }
}
'@

$p = Get-Process stickerbox -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'no process'; exit 1 }

$main = [Tray]::MainWindow($p.Id)
if ($main -eq [IntPtr]::Zero) { 'main window not found'; exit 1 }

# 模拟点右上角 X
[Tray]::PostMessageW($main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 1200

$alive = Get-Process stickerbox -ErrorAction SilentlyContinue
if (-not $alive) { 'FAIL: 进程退出了（应该缩到托盘）'; exit 1 }
$visible = [Tray]::IsWindowVisible($main)
"process alive: $($alive.Id)"
"main window visible: $visible"
if (-not $visible) { 'PASS: 关闭主窗口后隐藏，进程仍在' } else { 'FAIL: 主窗口仍然可见' }
