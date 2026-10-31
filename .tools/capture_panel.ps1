Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Cap {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
  public static List<IntPtr> Find(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h, out p); if (p==pid) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
'@

# 触发全局热键 Ctrl+Alt+Space
[Cap]::keybd_event(0x11,0,0,[UIntPtr]::Zero)
[Cap]::keybd_event(0x12,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Cap]::keybd_event(0x20,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Cap]::keybd_event(0x20,0,2,[UIntPtr]::Zero)
[Cap]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
[Cap]::keybd_event(0x11,0,2,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 900

$p = Get-Process stickerbox -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'no process'; exit 1 }

$done = $false
foreach ($h in [Cap]::Find($p.Id)) {
  if (-not [Cap]::IsWindowVisible($h)) { continue }
  $r = New-Object Cap+RECT
  [Cap]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = [int]($r.R - $r.L)
  if ($w -lt 820 -and $w -gt 600) {
    $dpi = [int][Cap]::GetDpiForWindow($h)
    $s = $dpi / 96.0
    $ww = [int]($w * $s); $hh = [int](($r.B - $r.T) * $s)
    $bmp = New-Object System.Drawing.Bitmap([int]$ww, [int]$hh)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $dc = $g.GetHdc()
    [Cap]::PrintWindow($h, $dc, [uint32]2) | Out-Null
    $g.ReleaseHdc($dc)
    $bmp.Save('C:\Users\13066\dsh\bqb\.shots\panel.png')
    $bmp.Dispose()
    "saved ${ww}x${hh}"
    $done = $true
  }
}
if (-not $done) { 'panel not visible' }
