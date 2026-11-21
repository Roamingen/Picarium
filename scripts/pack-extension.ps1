# 扩展出包：构建 extension/dist → 打成可直接分发/解压加载的 zip → release/extension/
#   pwsh -NoProfile -File scripts/pack-extension.ps1
#   pwsh -NoProfile -File scripts/pack-extension.ps1 -NoBuild   # 用现有 dist，不重跑 npm build
# 产物：release/extension/Picarium-extension-<manifest.version>.zip（zip 根目录即扩展内容，
# 解压后把**解压出来的目录**加载进 chrome://extensions，不是 extension/dist）。
param(
    [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $root 'extension'
$dist = Join-Path $ext 'dist'
$releaseRoot = Join-Path $root 'release'
$manifestPath = Join-Path $ext 'manifest.json'

if (-not (Test-Path $manifestPath)) { throw "找不到 $manifestPath" }

# 版本真源是 extension/manifest.json（Chrome 读的就是它）；package.json 必须跟它一致，否则包内版本说不清。
$srcManifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$pkg = Get-Content -Raw -Path (Join-Path $ext 'package.json') | ConvertFrom-Json
if ($srcManifest.version -ne $pkg.version) {
    throw "extension/manifest.json 的 version=$($srcManifest.version) 与 package.json 的 $($pkg.version) 不一致"
}
$version = $srcManifest.version

if (-not $NoBuild) {
    Write-Host '== 构建扩展 (npm run build) ==' -ForegroundColor Cyan
    Push-Location $ext
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败（exit $LASTEXITCODE）" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $dist 'manifest.json'))) {
    throw "缺少 $dist/manifest.json，先跑 npm run build（或去掉 -NoBuild）"
}

# 包内 manifest 必须就是源码那份：build 只做 copy，但手改过 dist 时要拦住，免得发错版本。
$distManifest = Get-Content -Raw -Path (Join-Path $dist 'manifest.json') | ConvertFrom-Json
if ($distManifest.version -ne $version) {
    throw "dist/manifest.json 版本 $($distManifest.version) 与源 $version 不一致，先重新构建"
}

$outDir = Join-Path $releaseRoot 'extension'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipName = "Picarium-extension-$version.zip"
$zipPath = Join-Path $outDir $zipName
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

Add-Type -AssemblyName System.IO.Compression.FileSystem
# includeBaseDirectory=$false：manifest.json 必须落在 zip 根，否则解压后多一层目录
[System.IO.Compression.ZipFile]::CreateFromDirectory($dist, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# 回读校验：条目名、大小、sha256 与 dist 一致，且没有嵌套前缀
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    if ($entries.Count -eq 0) { throw 'zip 是空的' }
    foreach ($e in $entries) {
        if ($e.FullName -match '/') { throw "zip 条目不该带目录层级：$($e.FullName)" }
        $srcFile = Join-Path $dist $e.FullName
        if (-not (Test-Path $srcFile)) { throw "zip 里有 dist 不存在的文件：$($e.FullName)" }
        if ((Get-Item $srcFile).Length -ne $e.Length) { throw "大小不一致：$($e.FullName)" }
    }
} finally {
    $zip.Dispose()
}
foreach ($name in @('manifest.json', 'background.js', 'content.js')) {
    if (-not ($entries | Where-Object { $_.FullName -eq $name })) { throw "zip 缺少 $name" }
}

$sha = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $zipPath).Length

Write-Host ''
Write-Host '== 扩展出包完成 ==' -ForegroundColor Green
Write-Host "版本    $version"
Write-Host "产物    $zipPath"
Write-Host "大小    $size B"
Write-Host "sha256  $sha"
Write-Host '解压后把解压目录加载进 chrome://extensions（不是 extension/dist）。'
