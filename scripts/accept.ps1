# 一键验收：构建 -> 单测 -> 后端/前端自测 -> 截图 -> 汇总
# 用法：pwsh -File scripts/accept.ps1

param([switch]$Shots)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$exe = 'C:\Users\13066\AppData\Local\StickerBoxBuild\target\debug\stickerbox.exe'
$python = 'python'
$report = @()
$failed = $false

function Step($name, [scriptblock]$body) {
    Write-Host ""
    Write-Host "== $name ==" -ForegroundColor Cyan
    try {
        & $body
        $script:report += [pscustomobject]@{ Step = $name; Ok = $true; Detail = '' }
    } catch {
        $script:report += [pscustomobject]@{ Step = $name; Ok = $false; Detail = "$_" }
        $script:failed = $true
        Write-Host "FAIL: $_" -ForegroundColor Red
    }
}

function Stop-App {
    Get-Process stickerbox -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
}

Step '停止旧进程' { Stop-App }

Step '构建' {
    cargo build -p stickerbox 2>&1 | Out-String | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "cargo build 失败（退出码 $LASTEXITCODE）" }
    if (-not (Test-Path $exe)) { throw "找不到可执行文件：$exe" }
}

Step '核心单测' {
    $out = cargo test -p stickerbox-core 2>&1 | Out-String
    Write-Host $out
    if ($LASTEXITCODE -ne 0) { throw "cargo test 失败" }
    if ($out -notmatch 'test result: ok') { throw "测试输出里没有 test result: ok" }
}

$temp = Join-Path $env:TEMP 'stickerbox-accept'
$lib = Join-Path $temp 'lib'
$samples = Join-Path $temp 'samples'
$reportFile = Join-Path $lib 'selftest-report.json'

Step '准备临时库' {
    if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
    New-Item -ItemType Directory -Path $temp | Out-Null
    & $python (Join-Path $root '.tools\make_accept_samples.py') $samples 240 | Out-Null
    # 一个自定义主题，验证 themes/*.json 能被读到
    $themeDir = Join-Path $lib 'themes'
    New-Item -ItemType Directory -Force -Path $themeDir | Out-Null
    '{"name":"验收主题","dark":true,"colors":{"--bg":"#123456","--surface":"#101820","--fg":"#eeeeee","--accent":"#ff8800"}}' |
        Set-Content -Path (Join-Path $themeDir 'accept-theme.json') -Encoding UTF8
    if (-not (Test-Path (Join-Path $samples 'accept-1.png'))) { throw "示例图片生成失败" }
}

Step '导入示例' {
    $env:STICKERBOX_HOME = $lib
    $scan = & $exe scan $samples 2>&1 | Out-String
    Write-Host $scan
    if (-not (Test-Path (Join-Path $lib 'index.json'))) { throw "扫描后没有生成 index.json" }
}

Step '前端自测' {
    if (Test-Path $reportFile) { Remove-Item -Force $reportFile }
    $env:STICKERBOX_HOME = $lib
    $env:STICKERBOX_SELFTEST = 'accept'
    # 自测时隐藏窗口，避免抢走用户的活动窗口
    Set-Content -Path (Join-Path $lib 'settings.json') -Value '{"startHidden": true}' -Encoding UTF8
    Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $reportFile)) {
        Start-Sleep -Milliseconds 500
    }
    Stop-App
    Remove-Item Env:STICKERBOX_SELFTEST -ErrorAction SilentlyContinue
    if (-not (Test-Path $reportFile)) { throw "60 秒内没有生成 selftest-report.json" }
    $j = Get-Content $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host ("通过 {0}，失败 {1}" -f $j.passed, $j.failed)
    $j.checks | Where-Object { -not $_.ok } | ForEach-Object { Write-Host ("  FAIL {0} ({1})" -f $_.name, $_.detail) -ForegroundColor Red }
    if ($j.failed -gt 0) { throw "前端自测有 $($j.failed) 项失败" }
    if ($j.passed -lt 20) { throw "断言数量不足（$($j.passed) < 20）" }
}

function Shot($state, $outFile) {
    Stop-App
    if (Test-Path $outFile) { Remove-Item -Force $outFile }
    # 截图时必须让窗口可见（自测那一步把 startHidden 打开了）
    Set-Content -Path (Join-Path $lib 'settings.json') -Value '{}' -Encoding UTF8
    if ($state) { $env:STICKERBOX_UI_STATE = $state } else { Remove-Item Env:STICKERBOX_UI_STATE -ErrorAction SilentlyContinue }
    $env:STICKERBOX_HOME = $lib
    Start-Process -FilePath $exe | Out-Null
    Start-Sleep -Seconds 5
    $shotOut = pwsh -NoProfile -File (Join-Path $root '.tools\shot_main.ps1') $outFile
    Write-Host $shotOut
    Stop-App
    Remove-Item Env:STICKERBOX_UI_STATE -ErrorAction SilentlyContinue
    if (-not (Test-Path $outFile)) { throw "截图失败：$outFile" }
    if ((Get-Item $outFile).Length -lt 10KB) { throw "截图疑似空白：$outFile" }
}

if ($Shots) {
    Step '截图：主界面' { Shot '' (Join-Path $root 'docs\accept-main.png') }
    Step '截图：设置/按键' { Shot 'settings:keys' (Join-Path $root 'docs\accept-settings.png') }
    Step '截图：设置/外观' { Shot 'settings:appearance' (Join-Path $root 'docs\accept-appearance.png') }
    Step '截图：which-key' { Shot 'whichkey' (Join-Path $root 'docs\accept-whichkey.png') }
    Step '截图：筛选面板' { Shot 'filters' (Join-Path $root 'docs\accept-filters.png') }
}

Write-Host ""
Write-Host "================ 验收结果 ================" -ForegroundColor Cyan
$report | Format-Table -AutoSize | Out-String | Write-Host

if ($failed) {
    Write-Host "RESULT: FAIL" -ForegroundColor Red
    exit 1
}
Write-Host "ALL PASS" -ForegroundColor Green
exit 0
