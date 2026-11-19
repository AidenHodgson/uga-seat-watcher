// Seat Watcher on Athena's Register for Classes pages.
//
// - Colors search results: fits your rules and open, open but outside your rules, waitlist only
//   (with your odds), full, or yours. Shows when a full section reopened.
// - Reads the Summary panel and syncs what's Registered / Waitlisted / Deleted to Seat Watcher.
// - Warns before a risky drop (no replacement in the same submit, or people waiting for your seat).
// - Puts a CRN into the Enter CRNs box for you.
//
// It never clicks Submit or Add, never reads anything but these tables, and only talks to the
// Seat Watcher app on this computer (through background.js).

(() => {
  if (window.__seatWatcher) return;
  window.__seatWatcher = true;

  const api = (path, method, body) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'api', path, method, body }, (r) => resolve(r || { ok: false, status: 0, body: {} }));
      } catch {
        resolve({ ok: false, status: 0, body: {} }); // extension was reloaded; this page's script is orphaned
      }
    });

  const CRN = /^\d{5}$/;
  const COURSE = /\b([A-Z]{2,4})\s+(\d{4}[A-Z]?)\b/;
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el && el.offsetParent);

  // ---------- reading Athena's tables by their column headers ----------

  function headerLabels(table) {
    let ths = table.querySelectorAll(':scope > thead th, :scope > thead td');
    if (!ths.length) {
      const first = table.querySelector('tr');
      if (first && first.querySelector('th')) ths = first.querySelectorAll('th');
    }
    if (!ths.length) {
      // Some grids keep the header in a separate table just above the body.
      let el = table.parentElement;
      for (let i = 0; i < 4 && el && !ths.length; i++, el = el.parentElement) {
        const head = [...el.querySelectorAll('table thead')].find((h) => h.closest('table') !== table);
        if (head) ths = head.querySelectorAll('th, td');
      }
    }
    return [...ths].map((th) => norm(th.textContent).toLowerCase());
  }

  function readRow(tr, labels) {
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    if (cells.length < 3) return null;
    const get = (re) => {
      const i = labels.findIndex((l) => re.test(l));
      return i >= 0 ? cells[i] ?? null : null;
    };
    let crnCell = get(/^crn$/);
    let crn = crnCell ? norm(crnCell.firstChild?.textContent ?? crnCell.textContent) : '';
    if (!CRN.test(crn) && crnCell) crn = (norm(crnCell.textContent).match(/\b\d{5}\b/) || [''])[0];
    if (!CRN.test(crn)) {
      crnCell = cells.find((c) => CRN.test(norm(c.textContent)));
      crn = crnCell ? norm(crnCell.textContent) : '';
    }
    if (!CRN.test(crn)) return null;
    let course = null;
    const details = get(/^details$/);
    const m = details && COURSE.exec(norm(details.textContent));
    if (m) course = `${m[1]} ${m[2]}`;
    if (!course) {
      const subj = get(/subject/);
      const num = get(/course ?n/);
      const s = subj && /^([A-Z]{2,4})\b/.exec(norm(subj.textContent));
      const n = num && /^(\d{4}[A-Z]?)\b/.exec(norm(num.textContent));
      if (s && n) course = `${s[1]} ${n[1]}`;
    }
    if (!course) {
      const mm = COURSE.exec(norm(tr.textContent));
      if (mm) course = `${mm[1]} ${mm[2]}`;
    }
    if (!course) return null;
    const statusCell = get(/^status$/);
    const actionCell = get(/^action$/);
    return { tr, crn, crnCell, course, status: statusCell ? norm(statusCell.textContent) : '', select: (actionCell || tr).querySelector('select') };
  }

  function rowsWhere(test) {
    const out = [];
    for (const t of document.querySelectorAll('table')) {
      if (!visible(t)) continue;
      const labels = headerLabels(t);
      if (!test(labels)) continue;
      for (const tr of t.querySelectorAll('tbody tr')) {
        const r = readRow(tr, labels);
        if (r) out.push({ ...r, table: t });
      }
    }
    return out;
  }

  // The Summary panel has CRN, Status and Action columns. Search results have CRN but no Action.
  const summaryRows = () => rowsWhere((l) => l.includes('crn') && l.includes('status') && l.includes('action'));
  const resultRows = () => rowsWhere((l) => l.includes('crn') && !l.includes('action') && l.some((x) => /meeting|instructor|status/.test(x)));

  // ---------- asking Seat Watcher about a course ----------

  const lookups = new Map();
  function lookup(course) {
    const hit = lookups.get(course);
    if (hit && Date.now() - hit.at < 90_000) return hit.p;
    const p = api(`/api/lookup?course=${encodeURIComponent(course)}`).then((r) => (r.ok ? r.body : null));
    lookups.set(course, { at: Date.now(), p });
    return p;
  }

  function when(iso) {
    const d = new Date(iso);
    if ((Date.now() - d) / 86_400_000 < 6) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()}`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------- coloring search results ----------

  function mark(r, s) {
    const key = JSON.stringify([s.seats, s.waiting, s.fits, s.yours, s.reopened_at, s.odds?.text]);
    if (r.tr.dataset.sw === key) return;
    r.tr.dataset.sw = key;
    r.tr.classList.remove('sw-fit', 'sw-wait', 'sw-full', 'sw-nofit', 'sw-yours');
    r.crnCell.querySelectorAll('.sw-badge').forEach((b) => b.remove());
    const badges = [];
    let cls;
    if (s.yours) {
      cls = 'sw-yours';
      badges.push(['yours', s.yours === 'registered' ? 'Yours' : "You're on its waitlist"]);
    } else if (s.seats > 0 && s.fits) {
      cls = 'sw-fit';
      badges.push(['', `Fits your rules · ${s.seats} open`]);
    } else if (s.seats > 0) {
      cls = 'sw-nofit';
      badges.push(['nofit', `Open, but ${s.why?.length ? s.why.join(', ') : 'outside your rules'}`]);
    } else if (s.odds) {
      cls = 'sw-wait';
      badges.push(['wait', `Waitlist only. ${s.odds.text}`]);
    } else {
      cls = 'sw-full';
      badges.push(['full', 'Full']);
    }
    if (s.reopened_at) badges.push(['re', `Reopened ${when(s.reopened_at)}`]);
    r.tr.classList.add(cls);
    for (const [k, text] of badges) {
      const b = document.createElement('div');
      b.className = `sw-badge ${k}`;
      b.textContent = text;
      r.crnCell.appendChild(b);
    }
  }

  async function highlight() {
    const rows = resultRows();
    const courses = [...new Set(rows.map((r) => r.course))].slice(0, 8); // a page of results is one or two courses
    for (const course of courses) {
      const data = await lookup(course);
      if (!data) continue;
      for (const r of rows.filter((x) => x.course === course)) {
        const s = data.sections.find((x) => x.crn === r.crn);
        if (s) mark(r, s);
      }
    }
  }

  // ---------- syncing the Summary panel ----------

  let lastSync = '';
  async function sync() {
    const rows = summaryRows()
      .filter((r) => /registered|waitlisted|deleted|dropped/i.test(r.status) && !/error/i.test(r.status))
      .map((r) => ({ course: r.course, crn: r.crn, status: r.status }));
    const key = JSON.stringify(rows);
    if (!rows.length || key === lastSync) return;
    const res = await api('/api/import', 'POST', { rows });
    if (!res.ok) return;
    lastSync = key;
    lookups.clear();
    note(res.body.changed?.length ? `Synced to Seat Watcher: ${res.body.changed.join('; ')}` : 'Your schedule matches Seat Watcher.');
    refreshPanel();
  }

  // ---------- warning before a risky drop ----------

  const chosen = (sel) => norm(sel?.selectedOptions?.[0]?.textContent ?? '');

  async function dropCheck() {
    document.querySelectorAll('.sw-warn').forEach((w) => w.remove());
    const rows = summaryRows();
    const drops = rows.filter((r) => /registered|waitlisted/i.test(r.status) && /drop|delete/i.test(chosen(r.select)));
    for (const d of drops) {
      const adds = rows.filter((r) => r !== d && r.course === d.course && !/^(registered|waitlisted|deleted)/i.test(r.status) && /regist|waitlist/i.test(chosen(r.select)));
      const data = await lookup(d.course);
      const s = data?.sections.find((x) => x.crn === d.crn);
      const box = document.createElement('div');
      box.className = 'sw-warn';
      if (/waitlisted/i.test(d.status)) {
        box.innerHTML = `<b>Leaving the ${d.course} waitlist for ${d.crn}</b>`;
        box.append(`You lose your place in line${s?.waiting ? ` (${s.waiting} on it now)` : ''}. If you rejoin later, you go to the back.`);
      } else if (adds.length) {
        box.className = 'sw-warn ok';
        box.innerHTML = `<b>Good: adding ${adds.map((a) => a.crn).join(', ')} and dropping ${d.crn} in one submit</b>`;
        box.append(`If the add fails, Athena may still drop ${d.crn}. If you see a "Conditional Add and Drop" box, check it before you submit.`);
      } else {
        box.innerHTML = `<b>Careful: you're dropping ${d.course} ${d.crn} with nothing replacing it in this submit</b>`;
        const risk = s && (s.waiting > 0 || s.seats <= 0);
        box.append(
          risk
            ? `${s.waiting ? `${s.waiting} ${s.waiting === 1 ? 'person is' : 'people are'} waiting for it, so your seat goes to them` : "It's full, so your seat goes to whoever grabs it"} and you likely can't get back in. To switch sections, add the new CRN first and drop this one in the same submit.`
            : 'To switch sections, add the new CRN first and drop this one in the same submit, so you never end up with neither.',
        );
      }
      d.table.parentElement.insertBefore(box, d.table);
    }
  }

  document.addEventListener(
    'change',
    (e) => {
      if (e.target instanceof HTMLSelectElement && summaryRows().some((r) => r.select === e.target)) dropCheck();
    },
    true,
  );

  // ---------- the little panel ----------

  let panelEl;
  let move = null;
  function note(text) {
    const el = panelEl?.querySelector('.sw-note');
    if (el) el.textContent = text;
  }

  function crnInputs() {
    return [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(
      (i) => visible(i) && /crn/i.test(`${i.id} ${i.name} ${i.getAttribute('aria-label') ?? ''} ${i.closest('div')?.querySelector('label')?.textContent ?? ''}`),
    );
  }

  function fill(crns) {
    const inputs = crnInputs();
    if (!inputs.length) return note('Open the "Enter CRNs" tab first, then press this again.');
    const empty = inputs.filter((i) => !i.value.trim());
    const targets = (empty.length ? empty : inputs).slice(0, crns.length);
    targets.forEach((input, i) => {
      input.focus();
      input.value = crns[i];
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const left = crns.length - targets.length;
    note(`Filled ${crns.slice(0, targets.length).join(', ')}.${left > 0 ? ' Click "+ Add Another CRN" for the rest, then press this again.' : ''} Now click "Add to Summary" yourself.`);
  }

  async function refreshPanel() {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'sw-panel';
      panelEl.innerHTML = `<header><i></i>Seat Watcher<span class="sw-state">connecting</span></header><div class="body"><p class="sw-move">Checking...</p><div class="sw-btns"></div><p class="muted sw-note">Colors sections, syncs your schedule to Seat Watcher on this computer, and warns before a risky drop. Never clicks Submit.</p></div>`;
      document.body.appendChild(panelEl);
      const { swMin } = await chrome.storage.local.get('swMin').catch(() => ({}));
      if (swMin) panelEl.classList.add('min');
      panelEl.querySelector('header').onclick = () => {
        panelEl.classList.toggle('min');
        chrome.storage.local.set({ swMin: panelEl.classList.contains('min') });
      };
    }
    const r = await api('/api/week');
    const state = panelEl.querySelector('.sw-state');
    const text = panelEl.querySelector('.sw-move');
    const btns = panelEl.querySelector('.sw-btns');
    btns.textContent = '';
    if (!r.ok) {
      state.textContent = 'not running';
      text.textContent = "Seat Watcher isn't running on this computer. Start it with the Start Here launcher.";
      return;
    }
    state.textContent = 'connected';
    move = r.body.moves?.[0] ?? null;
    if (!move) {
      text.textContent = r.body.week.picks.length ? "Nothing to do right now. You're set unless something better opens." : 'Mark your sections in Seat Watcher (or open your Summary here and it syncs).';
      return;
    }
    text.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = move.title;
    text.append(b, document.createElement('br'), move.why);
    if (move.crns.length) {
      const f = document.createElement('button');
      f.textContent = `Put ${move.crns.join(', ')} in Enter CRNs`;
      f.onclick = () => fill(move.crns);
      btns.appendChild(f);
    }
    const steps = document.createElement('button');
    steps.className = 'alt';
    steps.textContent = 'Steps';
    steps.onclick = () => note(move.steps.map((s, i) => `${i + 1}. ${s}`).join('  '));
    btns.appendChild(steps);
  }

  // ---------- run, and run again when Athena redraws ----------

  let timer;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await highlight();
      await sync();
    }, 500);
  };
  new MutationObserver((list) => {
    // Ignore our own badges and boxes.
    if (list.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n.nodeType === 1 && (n.classList?.contains('sw-badge') || n.classList?.contains('sw-warn') || n.id === 'sw-panel' || n.closest?.('#sw-panel'))))) return;
    run();
  }).observe(document.body, { childList: true, subtree: true });
  refreshPanel();
  run();
  setInterval(refreshPanel, 60_000);
})();
