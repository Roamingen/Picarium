# 一键出包：升版本（可选）→ 构建 PC / 安卓 / 扩展 → 拷进固定 release 目录 → 记 versions.json
# 用法：
#   pwsh -NoProfile -File scripts/release.ps1 -Target all -Bump minor
#   pwsh -NoProfile -File scripts/release.ps1 -Target pc            # 只更新本机 PC，不升版本
#   pwsh -NoProfile -File scripts/release.ps1 -Target extension     # 只出扩展 zip
#   pwsh -NoProfile -File scripts/release.ps1 -DryRun                # 只打印计划
param(
    [ValidateSet('pc', 'android', 'extension', 'all')][string]$Target = 'all',
    [ValidateSet('minor', 'patch')][string]$Bump,
    [switch]$DryRun,
    [switch]$BumpOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pcConf = Join-Path $root 'src-tauri/tauri.conf.json'
$andConf = Join-Path $root 'src-tauri/tauri.android.conf.json'
$cargoToml = Join-Path $root 'src-tauri/Cargo.toml'
$extManifest = Join-Path $root 'extension/manifest.json'
$extPkg = Join-Path $root 'extension/package.json'
$releaseRoot = Join-Path $root 'release'
$metaPath = Join-Path $releaseRoot 'versions.json'

function Read-Version([string]$path) {
    return (Get-Content -Raw -Path $path | ConvertFrom-Json).version
}

function Next-Version([string]$v, [string]$kind) {
    if ($v -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "版本号不是 x.y.z 格式：$v" }
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]
    if ($kind -eq 'minor') { $minor++; $patch = 0 } else { $patch++ }
    return "$major.$minor.$patch"
}

function Get-VersionCode([string]$v) {
    $p = $v.Split('.')
    return ([int]$p[0]) * 1000000 + ([int]$p[1]) * 1000 + ([int]$p[2])
}

# 只改 version / versionCode 两个值，其余格式原样保留，避免 JSON 重排产生大 diff
function Write-Version([string]$path, [string]$version, [switch]$WithCode) {
    $raw = Get-Content -Raw -Path $path
    if ($raw -notmatch '"version"\s*:') { throw "配置里没有 version 字段：$path" }
    $raw = [regex]::Replace($raw, '"version"\s*:\s*"[^"]+"', '"version": "' + $version + '"')
    if ($WithCode) {
        $raw = [regex]::Replace($raw, '"versionCode"\s*:\s*\d+', '"versionCode": ' + (Get-VersionCode $version))
    }
    Set-Content -NoNewline -Encoding utf8 -Path $path -Value $raw
}

# Cargo.toml 的 version 同步到 PC 版本：设置页显示的版本号取自 CARGO_PKG_VERSION
function Write-CargoVersion([string]$version) {
    $raw = Get-Content -Raw -Path $cargoToml
    if ($raw -notmatch '(?m)^version = "') { throw "Cargo.toml 里没有 version 字段：$cargoToml" }
    $new = [regex]::Replace($raw, '(?m)^version = "[^"]+"', 'version = "' + $version + '"')
    Set-Content -NoNewline -Encoding utf8 -Path $cargoToml -Value $new
}

$pcVersion = Read-Version $pcConf
$andVersion = Read-Version $andConf
$extVersion = Read-Version $extManifest
$extVersionInPkg = Read-Version $extPkg
if ($extVersion -ne $extVersionInPkg) {
    throw "extension/manifest.json 的 version=$extVersion 与 package.json 的 $extVersionInPkg 不一致"
}
$doPc = $Target -in 'pc', 'all'
$doAndroid = $Target -in 'android', 'all'
$doExt = $Target -in 'extension', 'all'

if ($Bump) {
    if ($doPc) { $pcVersion = Next-Version $pcVersion $Bump }
    if ($doAndroid) { $andVersion = Next-Version $andVersion $Bump }
    if ($doExt) { $extVersion = Next-Version $extVersion $Bump }
}

if ($DryRun) {
    if ($doPc) { Write-Host "PC      $pcVersion  -> release/pc/Picarium-$pcVersion-win-x64.exe" }
    if ($doAndroid) { Write-Host "Android $andVersion (code $(Get-VersionCode $andVersion))  -> release/android/Picarium-$andVersion-arm64-v8a.apk" }
    if ($doExt) { Write-Host "Extension $extVersion  -> release/extension/Picarium-extension-$extVersion.zip" }
    Write-Host '（DryRun：未构建、未写文件）'
    return
}

# 只把新版本号写进配置（给「功能落地先升号、过几天再打包装机」用）
if ($BumpOnly) {
    if (-not $Bump) { throw '-BumpOnly 需要搭配 -Bump minor|patch' }
    if ($doPc) {
        Write-Version $pcConf $pcVersion
        Write-CargoVersion $pcVersion
        Write-Host "PC 版本已写为 $pcVersion（tauri.conf.json + Cargo.toml，未构建）"
    }
    if ($doAndroid) {
        Write-Version $andConf $andVersion -WithCode
        Write-Host "安卓版本已写为 $andVersion / code $(Get-VersionCode $andVersion)（未构建）"
    }
    if ($doExt) {
        Write-Version $extManifest $extVersion
        Write-Version $extPkg $extVersion
        Write-Host "扩展版本已写为 $extVersion（manifest.json + package.json，未出包）"
    }
    return
}

$pcFile = $null
$apkFile = $null
$extFile = $null

# ---------- PC ----------
if ($doPc) {
    if ($Bump) { Write-Version $pcConf $pcVersion }
    Write-CargoVersion $pcVersion
    Write-Host '== PC: cargo build --release ==' -ForegroundColor Cyan
    Push-Location $root
    try {
        & cargo build --release -p picarium
        if ($LASTEXITCODE -ne 0) { throw 'release 构建失败' }
    } finally {
        Pop-Location
    }

    $exe = Join-Path $env:LOCALAPPDATA 'PicariumBuild/target/release/picarium.exe'
    if (-not (Test-Path $exe)) { throw "找不到 release 产物：$exe" }
    $dstDir = Join-Path $env:LOCALAPPDATA 'Picarium'
    $oldDstDir = Join-Path $env:LOCALAPPDATA 'StickerBox'
    $oldDst = Join-Path $oldDstDir 'StickerBox.exe'
    $dst = Join-Path $dstDir 'Picarium.exe'
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    Get-Process -Name picarium, Picarium -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 400
    Copy-Item -Force $exe $dst
    Write-Host "已安装：$dst" -ForegroundColor Green

    # 桌面和旧安装目录里的快捷方式改成新目录的 Picarium.exe
    $sh = New-Object -ComObject WScript.Shell
    $links = @()
    foreach ($dir in @([Environment]::GetFolderPath('Desktop'), $dstDir, $oldDstDir)) {
        if (Test-Path $dir) { $links += @(Get-ChildItem $dir -Filter *.lnk -ErrorAction SilentlyContinue) }
    }
    foreach ($lnk in $links) {
        $sc = $sh.CreateShortcut($lnk.FullName)
        $oldPicarium = Join-Path $oldDstDir 'Picarium.exe'
        if ($sc.TargetPath -ne $oldDst -and $sc.TargetPath -ne $oldPicarium) { continue }
        $sc.TargetPath = $dst
        $sc.WorkingDirectory = $dstDir
        $sc.Save()
        if ($lnk.DirectoryName -eq [Environment]::GetFolderPath('Desktop')) {
            $newLnk = Join-Path $lnk.DirectoryName 'Picarium.lnk'
            if ($lnk.FullName -ne $newLnk) {
                if (Test-Path $newLnk) { Remove-Item -Force $lnk.FullName } else { Move-Item -Force $lnk.FullName $newLnk }
            }
        } else {
            Remove-Item -Force $lnk.FullName -ErrorAction SilentlyContinue
        }
    }
    # 旧安装目录：删旧 exe 和上一版装进去的 Picarium.exe，空了再删目录
    foreach ($old in @($oldDst, (Join-Path $oldDstDir 'Picarium.exe'))) {
        if (Test-Path $old) { Remove-Item -Force $old -ErrorAction SilentlyContinue }
    }
    if (Test-Path $oldDstDir) {
        $left = Get-ChildItem $oldDstDir -Force -ErrorAction SilentlyContinue
        if (-not $left) {
            Remove-Item -Force $oldDstDir -ErrorAction SilentlyContinue
            Write-Host "已清理旧安装目录：$oldDstDir" -ForegroundColor Green
        } else {
            Write-Host "旧安装目录还有文件，未删除：$oldDstDir" -ForegroundColor Yellow
        }
    }

    # 旧 Run 键迁到 Picarium，避免继续拉旧 exe
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $oldRun = Get-ItemProperty -Path $runKey -Name StickerBox -ErrorAction SilentlyContinue
    $newRun = Get-ItemProperty -Path $runKey -Name Picarium -ErrorAction SilentlyContinue
    if ($oldRun) {
        Set-ItemProperty -Path $runKey -Name Picarium -Value "`"$dst`" --tray"
        Remove-ItemProperty -Path $runKey -Name StickerBox -ErrorAction SilentlyContinue
        Write-Host '开机自启已从 StickerBox 迁到 Picarium' -ForegroundColor Green
    } elseif ($newRun) {
        Set-ItemProperty -Path $runKey -Name Picarium -Value "`"$dst`" --tray"
        Write-Host '开机自启已指向 release 版本' -ForegroundColor Green
    }

    $pcOut = Join-Path $releaseRoot 'pc'
    New-Item -ItemType Directory -Force -Path $pcOut | Out-Null
    $pcFile = Join-Path $pcOut "Picarium-$pcVersion-win-x64.exe"
    Copy-Item -Force $exe $pcFile
}

# ---------- Android ----------
if ($doAndroid) {
    if ($Bump) { Write-Version $andConf $andVersion -WithCode }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    if (-not $env:NDK_HOME) { $env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk/28.2.13676358' }
    if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr' }

    Write-Host '== Android: tauri android build (aarch64, release) ==' -ForegroundColor Cyan
    Push-Location $root
    try {
        & npx tauri android build --apk --target aarch64 --ci
        if ($LASTEXITCODE -ne 0) { throw '安卓构建失败' }
    } finally {
        Pop-Location
    }

    $apkDir = Join-Path $root 'src-tauri/gen/android/app/build/outputs/apk'
    $apk = Get-ChildItem -Path $apkDir -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'release' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $apk) { throw "找不到 release APK：$apkDir" }

    # Tauri 的 aarch64 release 目前产在 universal/ 下，但只含 arm64-v8a；必须核对 ABI，避免把 universal 包当 arm64 发出去。
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($apk.FullName)
    try {
        $abis = @()
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -match '^lib/([^/]+)/') { $abis += $matches[1] }
        }
        $abis = @($abis | Sort-Object -Unique)
    } finally {
        $zip.Dispose()
    }
    if ($abis.Count -ne 1 -or $abis[0] -ne 'arm64-v8a') {
        throw "release APK 必须只含 arm64-v8a，实际：$($abis -join ', ')"
    }

    $andOut = Join-Path $releaseRoot 'android'
    New-Item -ItemType Directory -Force -Path $andOut | Out-Null
    $apkFile = Join-Path $andOut "Picarium-$andVersion-arm64-v8a.apk"
    Copy-Item -Force $apk.FullName $apkFile
}

# ---------- 扩展 ----------
if ($doExt) {
    if ($Bump) {
        Write-Version $extManifest $extVersion
        Write-Version $extPkg $extVersion
    }
    Write-Host '== Extension: npm run build + zip ==' -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot 'pack-extension.ps1')
    $extFile = Join-Path $releaseRoot "extension/Picarium-extension-$extVersion.zip"
    if (-not (Test-Path $extFile)) { throw "扩展产物不存在：$extFile" }
}

# ---------- 记录 ----------
$meta = @{}
if (Test-Path $metaPath) {
    $old = Get-Content -Raw -Path $metaPath | ConvertFrom-Json -AsHashtable
    if ($old) { $meta = $old }
}
$now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
if ($pcFile) {
    $meta['pc'] = @{
        version = $pcVersion
        file    = "pc/Picarium-$pcVersion-win-x64.exe"
        built   = $now
        sha256  = (Get-FileHash -Path $pcFile -Algorithm SHA256).Hash.ToLower()
    }
}
if ($apkFile) {
    $meta['android'] = @{
        version = $andVersion
        file    = "android/Picarium-$andVersion-arm64-v8a.apk"
        built   = $now
        sha256  = (Get-FileHash -Path $apkFile -Algorithm SHA256).Hash.ToLower()
    }
}
if ($extFile) {
    $meta['extension'] = @{
        version = $extVersion
        file    = "extension/Picarium-extension-$extVersion.zip"
        built   = $now
        sha256  = (Get-FileHash -Path $extFile -Algorithm SHA256).Hash.ToLower()
    }
}
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$meta | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path $metaPath

Write-Host ''
Write-Host '== 出包完成 ==' -ForegroundColor Green
if ($pcFile) { Write-Host "PC      $pcVersion  $pcFile" }
if ($apkFile) { Write-Host "Android $andVersion  $apkFile" }
if ($extFile) { Write-Host "Extension $extVersion  $extFile" }
Write-Host "记录：$metaPath"
if ($apkFile) {
    Write-Host '提示：首次出安卓包后跑 aapt2 dump badging 核对 versionName/versionCode。' -ForegroundColor Yellow
}
