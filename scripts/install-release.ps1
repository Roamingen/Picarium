# 只更新本机的 release 版 exe（不升版本、不出安卓包）。
# 完整出包用 scripts/release.ps1。
& (Join-Path $PSScriptRoot 'release.ps1') -Target pc
