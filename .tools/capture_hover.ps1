Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Hover {
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
$h = [Hover]::Main($p.Id)
if ($h -eq [IntPtr]::Zero) { 'no main window'; exit 1 }

[Hover]::ShowWindow($h, 9) | Out-Null
[Hover]::SetWindowPos($h, [IntPtr]0, 0, 0, 1040, 700, 0) | Out-Null
[Hover]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 600

# 鼠标移到第一张卡片中央（物理像素）
[Hover]::SetCursorPos(170, 380) | Out-Null
Start-Sleep -Milliseconds 250
[Hover]::SetCursorPos(175, 385) | Out-Null
Start-Sleep -Milliseconds 700

$bmp = New-Object System.Drawing.Bitmap 1600, 1100
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size 1600, 1100))
$bmp.Save('C:\Users\13066\dsh\bqb\.shots\hover.png')
$bmp.Dispose()
'saved'
