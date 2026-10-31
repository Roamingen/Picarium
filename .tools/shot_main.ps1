Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Shot2 {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  public static List<IntPtr> Find(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h, out p); if (p==pid) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
'@

$out = $args[0]
$p = Get-Process stickerbox -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'no process'; exit 1 }

foreach ($h in [Shot2]::Find($p.Id)) {
  if (-not [Shot2]::IsWindowVisible($h)) { continue }
  $r = New-Object Shot2+RECT
  [Shot2]::GetWindowRect($h, [ref]$r) | Out-Null
  if (($r.R - $r.L) -lt 900) { continue }

  # 挪到左上角并改成安全尺寸，避免窗口超出屏幕导致 WebView2 只渲染可见部分
  [Shot2]::SetWindowPos($h, [IntPtr]0, 0, 0, 1000, 660, 0) | Out-Null
  Start-Sleep -Milliseconds 800

  $s = [Shot2]::GetDpiForWindow($h) / 96.0
  $ww = [int](1000 * $s); $hh = [int](660 * $s)
  $bmp = New-Object System.Drawing.Bitmap([int]$ww, [int]$hh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $dc = $g.GetHdc()
  [Shot2]::PrintWindow($h, $dc, [uint32]2) | Out-Null
  $g.ReleaseHdc($dc)
  $bmp.Save($out)
  $bmp.Dispose()
  "saved ${ww}x${hh}"
}
