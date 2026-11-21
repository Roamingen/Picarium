param([int]$Count = 3000)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = 'C:/Users/13066/AppData/Local/PicariumBuild/target/debug/picarium.exe'
$tmp = Join-Path $env:TEMP 'picarium-perf'
$samples = Join-Path $tmp 'samples'
$lib = Join-Path $tmp 'lib'
$reportFile = Join-Path $lib 'selftest-report.json'
$python = (Get-Command python).Source

function Stop-App {
    Get-Process picarium -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 300
}

Write-Host "== 生成 $Count 张测试图 ==" -ForegroundColor Cyan
Stop-App
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $samples | Out-Null

$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $python (Join-Path $root '.tools\make_accept_samples.py') $samples $Count | Out-Null
Write-Host "生成耗时 $([int]$sw.Elapsed.TotalSeconds)s"

$env:PICARIUM_HOME = $lib
Write-Host "== 导入 ==" -ForegroundColor Cyan
$scan = & $exe scan $samples
Write-Host $scan
if ($LASTEXITCODE -ne 0) { throw "导入失败" }

Write-Host "== 构建 ==" -ForegroundColor Cyan
Push-Location $root
try {
    & cargo build -p picarium 2>&1 | Select-Object -Last 2 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "构建失败" }
} finally {
    Pop-Location
}

if (Test-Path $reportFile) { Remove-Item -Force $reportFile }
Set-Content -Path (Join-Path $lib 'settings.json') -Value '{"startHidden": true}' -Encoding UTF8

Write-Host "== 预热（生成缩略图缓存，不计入）==" -ForegroundColor Cyan
Remove-Item Env:PICARIUM_SELFTEST -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 10
Stop-App

$env:PICARIUM_SELFTEST = 'perf'
Write-Host "== 启动并测量 ==" -ForegroundColor Cyan
Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null

$deadline = (Get-Date).AddSeconds(240)
while (-not (Test-Path $reportFile) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
}
Stop-App
if (-not (Test-Path $reportFile)) { throw "240 秒内没有生成性能报告" }

$d = Get-Content $reportFile -Raw | ConvertFrom-Json
$d.checks | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "总耗时 $([int]$sw.Elapsed.TotalSeconds)s"

if ($d.failed -gt 0) {
    Write-Host "PERF: FAIL" -ForegroundColor Red
    exit 1
}
Write-Host "PERF: PASS" -ForegroundColor Green
exit 0
