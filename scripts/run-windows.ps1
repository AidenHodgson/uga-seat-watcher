# Keeps the watcher running on Windows: starts node, and if it ever exits, waits 30 seconds and
# starts it again. Task Scheduler runs this hidden at logon (set up by "node setup.mjs").
param([string]$Node, [string]$Script)
$ErrorActionPreference = 'Continue'
if (-not $Node) { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
$log = Join-Path $env:LOCALAPPDATA 'uga-seat-watcher\watcher.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
while ($true) {
    & $Node $Script
    Add-Content -Path $log -Value "$((Get-Date).ToUniversalTime().ToString('o')) watcher exited with $LASTEXITCODE, restarting in 30s"
    Start-Sleep -Seconds 30
}
