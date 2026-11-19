// Talks to the Seat Watcher app running on this computer. Content scripts can't reach 127.0.0.1
// themselves (the Athena page's rules would block it), so they ask this worker to.

const DEFAULT_PORT = 4830;

async function port() {
  const { port } = await chrome.storage.local.get('port');
  return Number(port) || DEFAULT_PORT;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'api') return false;
  (async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${await port()}${msg.path}`, {
        method: msg.method || 'GET',
        headers: msg.body ? { 'Content-Type': 'application/json' } : undefined,
        body: msg.body ? JSON.stringify(msg.body) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      reply({ ok: res.ok, status: res.status, body });
    } catch {
      reply({ ok: false, status: 0, body: { error: 'Seat Watcher is not running on this computer.' } });
    }
  })();
  return true; // answering asynchronously
});
