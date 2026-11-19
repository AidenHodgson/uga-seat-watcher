// Sends an alert everywhere it's set up: a desktop notification (Windows or Mac), and optionally
// your phone through ntfy (free app, no account) or a Discord channel through a webhook.

import { execFile } from 'node:child_process';

const run = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 20_000 }, (err) => resolve(err ? err.message.split('\n')[0] : null)));

function windowsToast(title, body, link, statusUrl) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, "''");
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast scenario="reminder" activationType="protocol" launch="${esc(link)}"><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(body)}</text></binding></visual><audio src="ms-winsoundevent:Notification.Looping.Alarm" loop="false"/><actions><action content="Register" activationType="protocol" arguments="${esc(link)}"/><action content="Seat Watcher" activationType="protocol" arguments="${esc(statusUrl)}"/><action content="Dismiss" activationType="system" arguments="dismiss"/></actions></toast>')
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show((New-Object Windows.UI.Notifications.ToastNotification $xml))
`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
}

function macNotification(title, body) {
  // AppleScript strings: escape backslashes and quotes.
  const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return run('osascript', ['-e', `display notification ${q(body)} with title ${q(title)} sound name "Glass"`]);
}

function linuxNotification(title, body) {
  return run('notify-send', ['-u', 'critical', title, body]);
}

async function ntfy(topic, title, body, link) {
  try {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      // ntfy reads headers as Latin-1, so keep the title plain.
      headers: { Title: title.replace(/[^\x20-\x7e]/g, ''), Priority: 'high', Tags: 'rotating_light', Click: link },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? null : `ntfy answered ${r.status}`;
  } catch (e) {
    return `ntfy: ${e.message}`;
  }
}

async function discord(url, title, body, link) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `**${title}**\n${body}\n${link}` }),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? null : `Discord answered ${r.status}`;
  } catch (e) {
    return `Discord: ${e.message}`;
  }
}

/** Returns a list of problems (empty when everything went out). */
export async function notify(config, title, body, statusUrl) {
  const link = config.school?.register_url || 'https://athena.uga.edu';
  const a = config.alerts ?? {};
  const jobs = [];
  if (a.desktop !== false) {
    if (process.platform === 'win32') jobs.push(windowsToast(title, body, link, statusUrl));
    else if (process.platform === 'darwin') jobs.push(macNotification(title, body));
    else jobs.push(linuxNotification(title, body));
  }
  if (a.ntfy_topic) jobs.push(ntfy(a.ntfy_topic, title, body, link));
  if (a.discord_webhook) jobs.push(discord(a.discord_webhook, title, body, link));
  return (await Promise.all(jobs)).filter(Boolean);
}
