<#
.SYNOPSIS
  一键起安卓模拟器（复用已在跑的），可选装 debug 包、拉起 StickerBox、截图。

.EXAMPLE
  pwsh -NoProfile -File scripts/android-emu.ps1

.EXAMPLE
  pwsh -NoProfile -File scripts/android-emu.ps1 -Apk src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk -Shot .demo/emu.png

.NOTES
  只用这一条命令，别再去手动翻 adb / AVD 路径（见 docs/26-安卓模拟器速查.md）。
  不会碰真机：只认出 emulator- 开头的设备。
#>
param(
  [string]$Avd = "Medium_Phone_API_35",
  [string]$Apk = "",
  [string]$Shot = "",
  [int]$TimeoutSec = 300,
  [int]$ShotDelaySec = -1,
  [switch]$NoLaunch,
  [switch]$Fresh,
  [string]$Package = "dev.stickerbox.desktop"
)

$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Step($msg) { Write-Host "· $msg" }
function Die($msg) { Write-Host "FAIL: $msg"; exit 1 }

$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emu = Join-Path $sdk "emulator\emulator.exe"
if (-not (Test-Path $adb)) { Die "找不到 adb：$adb（设 ANDROID_HOME 或装 platform-tools）" }
if (-not (Test-Path $emu)) { Die "找不到 emulator：$emu" }

# 只在仓库根跑，截图目录才有意义
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-EmuSerial {
  $out = & $adb devices 2>$null
  foreach ($line in $out) {
    if ($line -match "^(\S+)\s+device$" -and $Matches[1] -like "emulator-*") { return $Matches[1] }
  }
  return ""
}

if ($Fresh) {
  $old = Get-EmuSerial
  if ($old) {
    Step "关闭旧模拟器 $old"
    & $adb -s $old emu kill 2>$null | Out-Null
    # 必须等设备真的消失：否则会拿刚杀掉的 serial 继续用，白等到超时
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-EmuSerial) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
    if (Get-EmuSerial) { Die "旧模拟器 $old 关不掉；手动 taskkill /IM qemu-system-x86_64.exe /F" }
  }
}

$serial = Get-EmuSerial
if (-not $serial) {
  Step "启动 AVD $Avd（首次或冷启动约 20–40 秒）"
  $logDir = Join-Path $root ".demo"
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  Start-Process -FilePath $emu -ArgumentList @(
    "-avd", $Avd, "-no-boot-anim", "-gpu", "swiftshader_indirect"
  ) -RedirectStandardOutput (Join-Path $logDir "emulator.out.log") `
    -RedirectStandardError (Join-Path $logDir "emulator.err.log") | Out-Null

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while (-not $serial -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $serial = Get-EmuSerial
  }
  if (-not $serial) { Die "等不到模拟器设备；看 .demo/emulator.err.log，或先 emulator -list-avds 确认 AVD 名" }
} else {
  Step "复用已运行的模拟器 $serial"
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$booted = ""
while ((Get-Date) -lt $deadline) {
  $booted = (& $adb -s $serial shell getprop sys.boot_completed 2>$null | Select-Object -First 1)
  if ($booted -and $booted.Trim() -eq "1") { break }
  Start-Sleep -Seconds 2
}
if (-not $booted -or $booted.Trim() -ne "1") { Die "模拟器 $serial 在 ${TimeoutSec}s 内没启动完成" }
Step "系统已启动（$serial）"

if ($Apk) {
  if (-not (Test-Path $Apk)) { Die "APK 不存在：$Apk" }
  Step "安装 $(Split-Path -Leaf $Apk)"
  $installOut = & $adb -s $serial install -r $Apk 2>&1
  $installOut | Select-Object -Last 2 | ForEach-Object { Write-Host "  $_" }
  if (-not ($installOut -join "`n" -match "Success")) { Die "安装失败（看上面 adb 输出）" }
}

$launched = $false
if (-not $NoLaunch) {
  Step "拉起 $Package"
  & $adb -s $serial shell monkey -p $Package -c android.intent.category.LAUNCHER 1 2>$null | Out-Null
  $deadline = (Get-Date).AddSeconds(60)
  $focus = ""
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $focus = (& $adb -s $serial shell dumpsys window 2>$null | Select-String -Pattern "mCurrentFocus" | Select-Object -First 1)
    if ($focus -and $focus.ToString() -match [regex]::Escape($Package)) { break }
  }
  if (-not $focus -or $focus.ToString() -notmatch [regex]::Escape($Package)) { Die "App 没到前台；试 adb logcat -d | Select-String -Pattern 'FATAL|panic'" }
  Step "App 已在前台（首次进图库约 8–9 秒白屏属正常）"
  $launched = $true
}

if ($Shot) {
  # 冷启动时 WebView 还要 ~8-9s 才渲染出内容，直接截会是白屏
  $delay = if ($ShotDelaySec -ge 0) { $ShotDelaySec } elseif ($launched) { 9 } else { 1 }
  if ($delay -gt 0) { Step "等界面渲染 ${delay}s" ; Start-Sleep -Seconds $delay }
  Step "截图 $Shot"
  $shotDir = Split-Path -Parent $Shot
  if ($shotDir -and -not (Test-Path $shotDir)) { New-Item -ItemType Directory -Path $shotDir | Out-Null }
  Start-Process -FilePath $adb -ArgumentList @("-s", $serial, "exec-out", "screencap", "-p") `
    -RedirectStandardOutput $Shot -NoNewWindow -Wait | Out-Null
  if (-not (Test-Path $Shot)) { Die "截图失败：$Shot" }
}

Write-Host ""
Write-Host "OK  serial=$serial  关闭: adb -s $serial emu kill"
exit 0
