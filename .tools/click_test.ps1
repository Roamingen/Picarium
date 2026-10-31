Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class Clk {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
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
$h = [Clk]::Main($p.Id)

# 窗口放到左上角
[Clk]::SetWindowPos($h, [IntPtr]0, 0, 0, 1040, 700, 0) | Out-Null
Start-Sleep -Milliseconds 500

$r = New-Object Clk+RECT
[Clk]::GetWindowRect($h, [ref]$r) | Out-Null
"rect: $($r.L),$($r.T) -> $($r.R),$($r.B)"

# 物理坐标 = 虚拟坐标 * 1.5
function Click([double]$vx, [double]$vy, [bool]$ctrl) {
  $x = [int]($vx * 1.5); $y = [int]($vy * 1.5)
  [Clk]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 150
  [Clk]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [Clk]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}

# 第一张卡片
Click 135 170 $false
# 第三张卡片 + Ctrl
Click 330 170 $true

Start-Sleep -Milliseconds 600

$bmp = New-Object System.Drawing.Bitmap 1600, 1100
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size 1600, 1100))
$bmp.Save('C:\Users\13066\dsh\bqb\.shots\select.png')
$bmp.Dispose()
'saved'
