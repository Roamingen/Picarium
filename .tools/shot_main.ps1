Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Shot4 {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  public static List<IntPtr> Find(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h, out p); if (p==pid) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowTextW(h, sb, 256); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassNameW(h, sb, 256); return sb.ToString(); }
}
'@

# 静默截图：程序用 --tray 启动（窗口隐藏），这里把窗口挪到屏幕外
# 用 SW_SHOWNOACTIVATE 显示再抓图 —— 不抢前台焦点、不占用户可见区域。
# 优先走 CDP（.tools/shot_cdp.mjs，需要启动时带 --remote-debugging-port=9222），
# CDP 不可用时退回 PrintWindow（尺寸按窗口真实 rect，尽量不裁）。
# 用法：pwsh -NoProfile -File .tools/shot_main.ps1 <out.png> [cdpPort]
$out = $args[0]
$port = if ($args.Count -gt 1) { $args[1] } else { '9222' }
if (-not $out) { 'usage: shot_main.ps1 <out.png> [cdpPort]'; exit 1 }

$p = Get-Process stickerbox -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'no process'; exit 1 }

# 只挑主窗口：class 必须是 Tauri Window，且有标题栏（快贴面板无边框）
$best = [IntPtr]0
$bestArea = 0
foreach ($h in [Shot4]::Find($p.Id)) {
  if ([Shot4]::Cls($h) -ne 'Tauri Window') { continue }
  if ((([int64][Shot4]::GetWindowLongPtr($h, -16)) -band 0x00C00000) -eq 0) { continue }
  $r = New-Object Shot4+RECT
  [Shot4]::GetWindowRect($h, [ref]$r) | Out-Null
  $area = ($r.R - $r.L) * ($r.B - $r.T)
  if ($area -gt $bestArea) { $bestArea = $area; $best = $h }
}
if ($best -eq [IntPtr]0) { 'no main window found'; exit 1 }

$fg0 = [Shot4]::GetForegroundWindow()
$r0 = New-Object Shot4+RECT
[Shot4]::GetWindowRect($best, [ref]$r0) | Out-Null
$wasHidden = -not [Shot4]::IsWindowVisible($best)

if ($wasHidden) { [Shot4]::ShowWindow($best, 4) | Out-Null }                   # SW_SHOWNOACTIVATE
# 0x0001 NOSIZE | 0x0004 NOZORDER | 0x0010 NOACTIVATE | 0x0040 SHOWWINDOW
[Shot4]::SetWindowPos($best, [IntPtr]0, -4000, -4000, 0, 0, 0x0055) | Out-Null
Start-Sleep -Milliseconds 900

$ok = $false
try {
  $res = & node .tools/shot_cdp.mjs $out $port
  if ($LASTEXITCODE -eq 0) { $ok = $true; $res }
} catch {
  'cdp failed: ' + $_.Exception.Message
}

if (-not $ok) {
  # 回退：PrintWindow。注意本机 DPI 不匹配时右侧可能被裁一点，仅作兜底
  $r1 = New-Object Shot4+RECT
  [Shot4]::GetWindowRect($best, [ref]$r1) | Out-Null
  $ww = $r1.R - $r1.L; $hh = $r1.B - $r1.T
  $bmp = New-Object System.Drawing.Bitmap([int]$ww, [int]$hh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $dc = $g.GetHdc()
  [Shot4]::PrintWindow($best, $dc, [uint32]2) | Out-Null
  $g.ReleaseHdc($dc)
  $bmp.Save($out)
  $bmp.Dispose()
  "fallback printwindow saved $out ${ww}x${hh}"
}

# 还原窗口位置/尺寸；启动时是隐藏的就不再用 SHOWWINDOW 把它闪出来
if ($wasHidden) {
  [Shot4]::SetWindowPos($best, [IntPtr]0, $r0.L, $r0.T, ($r0.R - $r0.L), ($r0.B - $r0.T), 0x0014) | Out-Null  # NOZORDER|NOACTIVATE
  [Shot4]::ShowWindow($best, 0) | Out-Null
} else {
  [Shot4]::SetWindowPos($best, [IntPtr]0, $r0.L, $r0.T, ($r0.R - $r0.L), ($r0.B - $r0.T), 0x0054) | Out-Null
}
if ([Shot4]::GetForegroundWindow() -eq $fg0) { 'foreground-unchanged' }
else { 'foreground-changed -> ' + [Shot4]::Title([Shot4]::GetForegroundWindow()) }
