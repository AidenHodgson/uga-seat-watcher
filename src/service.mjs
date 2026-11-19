// Starts the watcher by itself every time you log in, and keeps it running.
//   Windows: a Task Scheduler task for your user (no admin), hidden, restarted if it ever stops.
//   Mac: a launchd agent in ~/Library/LaunchAgents with KeepAlive.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA, ROOT } from './paths.mjs';

const TASK = 'UGA Seat Watcher';
const LABEL = 'com.ugaseatwatcher.agent';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true });
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function install(port) {
  const node = process.execPath;
  const script = path.join(ROOT, 'watcher.mjs');
  if (process.platform === 'win32') {
    const wrapper = path.join(ROOT, 'scripts', 'run-windows.ps1');
    const shortcut = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Seat Watcher.url');
    ps(`
$ErrorActionPreference = 'Stop'
$name = ${psq(TASK)}
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
$user = "$env:USERDOMAIN\\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\\System32\\conhost.exe" -Argument ('--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + ${psq(wrapper)} + '" -Node "' + ${psq(node)} + '" -Script "' + ${psq(script)} + '"') -WorkingDirectory ${psq(ROOT)}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Watches Athena for open class seats.' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Set-Content -Path ${psq(shortcut)} -Value "[InternetShortcut]\`r\`nURL=http://127.0.0.1:${port}/\`r\`n"
`);
    return `Installed. It starts by itself whenever you log in to Windows. Start menu: "Seat Watcher".`;
  }
  if (process.platform === 'darwin') {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.writeFileSync(
      PLIST,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(DATA, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(DATA, 'launchd.err.log'))}</string>
</dict>
</plist>
`,
    );
    const uid = process.getuid();
    try {
      execFileSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
    } catch {
      // wasn't loaded
    }
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST]);
    return 'Installed. It starts by itself whenever you log in to your Mac.';
  }
  throw new Error('Automatic start is set up for Windows and Mac only. On Linux, run "node watcher.mjs" from a systemd user service.');
}

export function uninstall() {
  if (process.platform === 'win32') {
    ps(`
Stop-ScheduledTask -TaskName ${psq(TASK)} -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName ${psq(TASK)} -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like ('*' + ${psq(path.join(ROOT, 'watcher.mjs'))} + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Seat Watcher.url') -ErrorAction SilentlyContinue
`);
    return 'Removed. It no longer starts with Windows.';
  }
  if (process.platform === 'darwin') {
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
    } catch {
      // not loaded
    }
    fs.rmSync(PLIST, { force: true });
    return 'Removed. It no longer starts with your Mac.';
  }
  return 'Nothing to remove on this system.';
}

export function installed() {
  try {
    if (process.platform === 'win32') return ps(`(Get-ScheduledTask -TaskName ${psq(TASK)} -ErrorAction SilentlyContinue) -ne $null`).trim() === 'True';
    if (process.platform === 'darwin') return fs.existsSync(PLIST);
  } catch {
    // fall through
  }
  return false;
}
