const $ = (s) => document.querySelector(s);
async function refresh() {
  const { port } = await chrome.storage.local.get('port');
  const p = Number(port) || 4830;
  $('#port').value = p;
  $('#open').href = `http://127.0.0.1:${p}`;
  try {
    const r = await fetch(`http://127.0.0.1:${p}/api/week`);
    const w = await r.json();
    $('#status').className = 'ok';
    $('#status').textContent = w.moves?.[0] ? `Connected. Next: ${w.moves[0].title}` : 'Connected. Nothing to do right now.';
  } catch {
    $('#status').className = 'bad';
    $('#status').textContent = 'Seat Watcher isn’t running. Start it with the Start Here launcher.';
  }
}
$('#port').onchange = async (e) => { await chrome.storage.local.set({ port: Number(e.target.value) || 4830 }); refresh(); };
$('#open').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: $('#open').href }); };
refresh();
