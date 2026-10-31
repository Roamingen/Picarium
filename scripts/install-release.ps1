$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = 'C:/Users/13066/AppData/Local/StickerBoxBuild/target/release/stickerbox.exe'
$dstDir = Join-Path $env:LOCALAPPDATA 'StickerBox'
$dst = Join-Path $dstDir 'StickerBox.exe'

Push-Location $root
try {
    Write-Host '== cargo build --release ==' -ForegroundColor Cyan
    & cargo build --release -p stickerbox
    if ($LASTEXITCODE -ne 0) { throw 'release 构建失败' }
} finally {
    Pop-Location
}

if (-not (Test-Path $exe)) { throw "找不到 release 产物：$exe" }
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Get-Process stickerbox -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400
Copy-Item -Force $exe $dst
Write-Host "已安装：$dst" -ForegroundColor Green

# 如果之前开过开机自启，把注册表指向 release，而不是 debug
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$cur = Get-ItemProperty -Path $runKey -Name StickerBox -ErrorAction SilentlyContinue
if ($cur) {
    Set-ItemProperty -Path $runKey -Name StickerBox -Value "`"$dst`" --tray"
    Write-Host '开机自启已指向 release 版本' -ForegroundColor Green
}
Write-Host '完成。之后请使用安装目录里的 StickerBox.exe（或直接跑本脚本更新）。'
