Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Hv {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  public static List<IntPtr> Find(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h, out p); if (p==pid) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static IntPtr Main(uint pid) {
    foreach (var h in Find(pid)) {
      if (!IsWindowVisible(h)) continue;
      RECT r; GetWindowRect(h, out r);
      if ((r.R - r.L) > 900) return h;
    }
    return IntPtr.Zero;
  }
}
'@

$p = Get-Process stickerbox -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'no process'; exit 1 }
$h = [Hv]::Main($p.Id)
if ($h -eq [IntPtr]::Zero) { 'no main window'; exit 1 }

[Hv]::ShowWindow($h, 9) | Out-Null
[Hv]::SetWindowPos($h, [IntPtr]0, 0, 0, 1040, 700, 0) | Out-Null
[Hv]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 800

# 卡片一在窗口内大约 (35..210, 225..400) 物理像素
1..6 | ForEach-Object { [Hv]::SetCursorPos(80 + $_ * 10, 260 + $_ * 10); Start-Sleep -Milliseconds 120 }
Start-Sleep -Milliseconds 700

'title: ' + (Get-Process -Id $p.Id).MainWindowTitle

$bmp = New-Object System.Drawing.Bitmap 620, 620
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size 620, 620))
$bmp.Save('C:\Users\13066\dsh\bqb\.shots\hover3.png')
$bmp.Dispose()
'saved'
