'use strict';
const $ = s => document.querySelector(s);
const list = $('#list');
const selected = new Set();
const openLogs = new Set();
let state = null;
let firstRender = true;
let filterText = '';

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

const ICON_FOLDER = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>';
const ICON_HIDE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.6"/><path d="M2.5 2.5l11 11"/></svg>';

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

async function api(path, body) {
  try {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  } catch (e) {
    toast(String(e.message || e), true);
    throw e;
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied: ' + text),
    () => toast('Could not copy', true));
}

function overallDot(p) {
  if (p.server.status === 'error' || p.tunnel.status === 'stale') return p.tunnel.status === 'stale' ? 'stale' : 'error';
  if (p.server.status === 'starting' || p.tunnel.status === 'starting') return 'starting';
  if (p.server.status === 'running') return 'running';
  return 'idle';
}

function statusWord(p) {
  if (p.server.status === 'error') return ['Problem — see log', ''];
  if (p.tunnel.status === 'stale') return ['Public link lost', ''];
  if (p.server.status === 'starting') return ['Starting…', 'busy'];
  if (p.tunnel.status === 'starting') return ['Getting your link…', 'busy'];
  if (p.server.status === 'running') return [p.tunnel.status === 'running' ? 'Running · shared' : 'Running', 'on'];
  return ['', ''];
}

function rowHTML(p, i) {
  const running = p.server.status === 'running';
  const busy = p.server.status === 'starting' || p.tunnel.status === 'starting';
  const tunnelUp = p.tunnel.status === 'running';
  const stale = p.tunnel.status === 'stale';
  const n = esc(p.name);
  const dis = p.needsNode ? 'disabled title="This project needs Node.js installed on this computer"' : '';

  let actions = '';
  if (running || busy) {
    if (!tunnelUp && p.tunnel.status !== 'starting' && !stale)
      actions += `<button class="btn blue" data-act="tunnel" data-p="${n}">Share</button>`;
    if (tunnelUp)
      actions += `<button class="btn blue" data-act="renew" data-p="${n}" title="Swap the public link for a fresh one">New link</button>`;
    actions += `<button class="btn red" data-act="stop" data-p="${n}">Stop</button>`;
  } else {
    actions =
      `<button class="btn green" data-act="server" data-p="${n}" ${dis}>Start</button>` +
      `<button class="btn blue" data-act="tunnel" data-p="${n}" ${dis}>Share</button>`;
  }
  actions += `<button class="btn ghost" data-act="log" data-p="${n}" title="Show technical output">…</button>`;

  let urls = '';
  if (running) {
    urls += `<span class="url local"><span class="tag">This PC</span><a href="${esc(p.localUrl)}" target="_blank">${esc(p.localUrl)}</a><button class="copy" data-copy="${esc(p.localUrl)}" title="Copy">⧉</button></span>`;
    if (p.lanUrl)
      urls += `<span class="url local"><span class="tag">Network</span><a href="${esc(p.lanUrl)}" target="_blank">${esc(p.lanUrl)}</a><button class="copy" data-copy="${esc(p.lanUrl)}" title="Copy">⧉</button></span>`;
  }
  if (tunnelUp)
    urls += `<span class="url public"><span class="tag">Public</span><a href="${esc(p.tunnel.url)}" target="_blank">${esc(p.tunnel.url)}</a><button class="copy" data-copy="${esc(p.tunnel.url)}" title="Copy">⧉</button></span>`;
  if (p.tunnel.status === 'starting')
    urls += `<span class="url public"><span class="tag">Public</span><a>getting your link…</a></span>`;
  if (stale)
    urls += `<span class="url dead">public link lost</span><button class="btn blue" data-act="renew" data-p="${n}">Get a new link</button> <button class="btn ghost" data-act="stop" data-p="${n}">Stop</button>`;
  if (p.server.status === 'starting')
    urls += `<span class="url local"><span class="tag">This PC</span><a>starting…</a></span>`;

  const err = p.server.status === 'error' && p.server.error ? `<div class="err">${esc(p.server.error)}</div>` : '';
  const note = p.needsNode && !running && !busy ? `<div class="note">Needs Node.js on this computer (nodejs.org) — the Start/Share buttons are disabled.</div>` : '';
  const open = openLogs.has(p.name);
  const tools = open ? `<div class="rowtools">
      <button data-act="reveal" data-p="${n}" title="Open this project's folder">${ICON_FOLDER} Open folder</button>
      <button class="danger" data-act="hide" data-p="${n}" title="Hide this from the list (restore via “show all”)">${ICON_HIDE} Hide</button>
    </div>` : '';
  const log = open ? `<div class="logbox" data-log="${n}">loading…</div>` : '';
  const [word, wcls] = statusWord(p);
  const kind = p.mode !== 'static' ? `<span class="sub">${esc(p.mode)}</span>` : '';

  return `<div class="row" style="animation-delay:${firstRender ? Math.min(i * 24, 380) : 0}ms">
    <input type="checkbox" data-sel="${n}" ${selected.has(p.name) ? 'checked' : ''}>
    <div class="row-main">
      <span class="dot ${overallDot(p)}" style="align-self:center"></span>
      <span class="name">${n}</span>
      ${kind}
      <span class="status ${wcls}">${word}</span>
    </div>
    <div class="row-actions">${actions}</div>
    ${urls ? `<div class="urls">${urls}</div>` : ''}${err}${note}${tools}${log}
  </div>`;
}

let lastSig = null;
function render() {
  if (!state) return;
  $('#path').textContent = state.projectsDir;
  const ps = state.projects;
  const up = ps.filter(p => p.server.status === 'running').length;
  const tn = ps.filter(p => p.tunnel.status === 'running').length;
  $('#counts').textContent = `${ps.length} projects · ${up} running · ${tn} shared`;

  const cf = state.cf || {};
  const banner = $('#cfbanner');
  if (cf.status === 'downloading') {
    banner.classList.add('show');
    $('#cfmsg').textContent = 'Setting up sharing (one-time download)…';
    $('#cfbar').style.width = (cf.pct || 2) + '%';
  } else if (cf.status === 'error') {
    banner.classList.add('show');
    $('#cfmsg').textContent = 'Could not set up sharing — check the internet connection and try Share again.';
    $('#cfbar').style.width = '0%';
  } else banner.classList.remove('show');

  syncUpdateUI(state.update);
  refreshAbout();
  updateHiddenNote();

  const q = filterText.trim().toLowerCase();
  const visible = q ? ps.filter(p => p.name.toLowerCase().includes(q)) : ps;

  // Rebuild the list only when something it shows actually changed — a
  // constant repaint flickers and can swallow a click mid-press.
  const sig = JSON.stringify(visible.map(p =>
    [p.name, p.mode, p.port, p.needsNode, p.server.status, p.server.error, p.tunnel.status, p.tunnel.url, p.localUrl, p.lanUrl]))
    + '|' + [...openLogs].join(',') + '|' + q;
  if (sig !== lastSig) {
    lastSig = sig;
    list.innerHTML = visible.length
      ? visible.map((p, i) => rowHTML(p, i)).join('')
      : (ps.length
          ? `<div class="empty">No projects match “${esc(q)}”.</div>`
          : '<div class="empty">No projects found yet.<br>Click <b>change</b> at the top to pick your projects folder.</div>');
    firstRender = false;
  }

  $('#bulk').classList.toggle('show', selected.size > 0);
  $('#bulkn').textContent = selected.size;
  syncSelAll();
  refreshOpenLogs();
}

function syncSelAll() {
  if (!state) return;
  const ps = state.projects;
  const picked = ps.filter(p => selected.has(p.name)).length;
  const sa = $('#selall');
  sa.checked = ps.length > 0 && picked === ps.length;
  sa.indeterminate = picked > 0 && picked < ps.length;
}

async function refreshOpenLogs() {
  for (const name of openLogs) {
    const box = document.querySelector(`.logbox[data-log="${CSS.escape(name)}"]`);
    if (!box) continue;
    try {
      const d = await fetch('/api/log?name=' + encodeURIComponent(name)).then(r => r.json());
      const text = ['— server —', ...d.server.slice(-60), '', '— share link —', ...d.tunnel.slice(-30)].join('\n');
      if (box.textContent !== text) { box.textContent = text; box.scrollTop = box.scrollHeight; }
    } catch (e) {}
  }
}

async function poll() {
  try {
    state = await fetch('/api/state').then(r => r.json());
    render();
  } catch (e) {
    list.innerHTML = '<div class="empty">Launchpad is closed — start it again to reconnect.</div>';
  }
}

list.addEventListener('click', e => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) return copyText(copyBtn.dataset.copy);
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const name = btn.dataset.p, act = btn.dataset.act;
  btn.disabled = true;
  const done = () => setTimeout(poll, 250);
  if (act === 'server') api('/api/start', { name, server: true }).finally(done);
  if (act === 'tunnel') api('/api/start', { name, tunnel: true }).finally(done);
  if (act === 'stop') api('/api/stop', { name, server: true, tunnel: true }).finally(done);
  if (act === 'renew') { api('/api/renew', { name }).finally(done); toast('Getting a fresh link…'); }
  if (act === 'reveal') { api('/api/reveal', { name }).catch(() => {}); btn.disabled = false; }
  if (act === 'hide') { openLogs.delete(name); selected.delete(name); api('/api/hide', { name }).finally(done); toast('Hidden — restore from “show all”'); }
  if (act === 'log') {
    openLogs.has(name) ? openLogs.delete(name) : openLogs.add(name);
    btn.disabled = false;
    lastSig = null;
    render();
  }
});

list.addEventListener('change', e => {
  const cb = e.target.closest('[data-sel]');
  if (!cb) return;
  cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel);
  $('#bulk').classList.toggle('show', selected.size > 0);
  $('#bulkn').textContent = selected.size;
  syncSelAll();
});

$('#selall').addEventListener('change', e => {
  selected.clear();
  if (e.target.checked && state) state.projects.forEach(p => selected.add(p.name));
  lastSig = null;
  render();
});

$('#bulk').addEventListener('click', e => {
  const btn = e.target.closest('[data-bulk]');
  if (!btn) return;
  const names = [...selected];
  const kind = btn.dataset.bulk;
  const done = () => setTimeout(poll, 250);
  if (kind === 'clear') { selected.clear(); lastSig = null; render(); return; }
  if (!names.length) return;
  if (kind === 'server') api('/api/start', { names, server: true }).finally(done);
  if (kind === 'tunnel') api('/api/start', { names, tunnel: true }).finally(done);
  if (kind === 'stop') api('/api/stop', { names, server: true, tunnel: true }).finally(done);
});

$('#stopall').addEventListener('click', () => api('/api/stopall').then(() => { toast('Everything stopped'); poll(); }));
$('#quit').addEventListener('click', async () => {
  if (!confirm('Stop all local servers and public links, then close Launchpad?')) return;
  // In the desktop app, ask the shell to quit directly — it stops every
  // project and closes this window itself. Going through the HTTP API and
  // waiting for the server to come back down here would just leave the
  // window sitting open with nothing left to close it (no browser chrome —
  // the shell's own titlebar controls disappear with the rest of the page).
  if (window.shell && window.shell.isShell) { window.shell.quit(); return; }
  await api('/api/quit').catch(() => {});
  document.body.innerHTML = '<div class="empty" style="padding-top:40vh">Launchpad closed — you can close this window.</div>';
});

// Electron shell: show the custom titlebar and wire the window buttons
if (window.shell && window.shell.isShell) {
  document.body.classList.add('shell');
  $('#tb-min').addEventListener('click', () => window.shell.minimize());
  $('#tb-close').addEventListener('click', () => window.shell.hideToTray());
  $('#changedir').addEventListener('click', () => window.shell.chooseFolder());
}

// ---------------- update: changelog popup → progress → restart -------------
let umPhase = null;        // null | available | downloading | installing | ready | done
let umDismissed = null;    // version the user clicked "Later" on
let umVersion = null;      // version currently shown in the modal
let umLast = null;         // last non-empty update object seen (for the reopener)

function renderNotes(notes) {
  const ul = $('#up-notes');
  if (notes && notes.length) {
    ul.innerHTML = notes.map(n => `<li>${esc(n)}</li>`).join('');
  } else {
    ul.innerHTML = '<li class="plain">Small improvements and fixes.</li>';
  }
}

function openModal() { $('#upmodal').classList.add('show'); }
function closeModal() { $('#upmodal').classList.remove('show'); }

function syncUpdateUI(up) {
  const ub = $('#upbanner');

  // check-only statuses (from the About panel) never drive the popup/banner
  const popupStatuses = ['available', 'downloading', 'installing', 'ready', 'error'];
  if (!up || !popupStatuses.includes(up.status)) { ub.classList.remove('show'); return; }
  const ver = up.version;
  umVersion = ver;
  umLast = up;

  // AVAILABLE — pop the changelog once per version (unless dismissed)
  if (up.status === 'available') {
    if (umDismissed === ver) {
      ub.classList.add('show');
      $('#upmsg').textContent = `Update available (${ver})`;
      if (umPhase !== 'available-dismissed') umPhase = 'available-dismissed';
    } else if (umPhase !== 'available' && umPhase !== 'downloading' && umPhase !== 'ready') {
      umPhase = 'available';
      ub.classList.remove('show');
      $('#up-title').textContent = "What's new";
      $('#up-sub').textContent = `Version ${ver}`;
      renderNotes(up.notes);
      $('#up-progwrap').hidden = true;
      $('#up-actions').hidden = false;
      $('#up-doing').hidden = true;
      $('#up-now').textContent = 'Update now';
      $('#uprocket').classList.remove('launch');
      openModal();
    }
    return;
  }

  // DOWNLOADING — progress bar
  if (up.status === 'downloading') {
    ub.classList.remove('show');
    if (umPhase !== 'downloading') {
      umPhase = 'downloading';
      $('#up-title').textContent = 'Updating…';
      $('#up-sub').textContent = `Version ${ver}`;
      $('#up-actions').hidden = true;
      $('#up-doing').hidden = false;
      $('#up-doing').textContent = 'Updating...';
      $('#up-progwrap').hidden = false;
      $('#uprocket').classList.add('launch');
      openModal();
    }
    const pct = up.pct || 0;
    $('#up-bar').style.width = pct + '%';
    $('#up-pct').textContent = pct + '%';
    return;
  }

  // INSTALLING — the main process owns quitAndInstall so pressing Update now
  // flows straight into an automatic install and restart.
  if (up.status === 'installing') {
    ub.classList.remove('show');
    if (umPhase !== 'installing' && umPhase !== 'done') {
      umPhase = 'installing';
      $('#up-progwrap').hidden = false;
      $('#up-bar').style.width = '100%';
      $('#up-pct').textContent = '100%';
      $('#up-title').textContent = 'Installing update';
      $('#up-sub').textContent = `Version ${ver}`;
      $('#up-actions').hidden = true;
      $('#up-doing').hidden = false;
      $('#up-doing').textContent = 'Restarting Launchpad...';
      $('#uprocket').classList.add('launch');
      openModal();
    }
    return;
  }

  // READY — fallback for a downloaded update that was not user-started here.
  if (up.status === 'ready') {
    if (umPhase !== 'ready' && umPhase !== 'done') {
      umPhase = 'ready';
      $('#up-progwrap').hidden = false;
      $('#up-bar').style.width = '100%';
      $('#up-pct').textContent = '100%';
      $('#up-title').textContent = 'Ready to restart';
      $('#up-actions').hidden = true;
      $('#up-doing').hidden = false;
      $('#up-doing').textContent = 'Restarting Launchpad...';
      openModal();
      setTimeout(() => { umPhase = 'done'; if (window.shell) window.shell.installUpdate(); }, 350);
    }
    return;
  }

  // ERROR — let them close and try later
  if (up.status === 'error') {
    umPhase = null;
    $('#up-title').textContent = 'Update failed';
    $('#up-sub').textContent = 'Please try again later.';
    $('#up-progwrap').hidden = true;
    $('#up-doing').hidden = true;
    $('#up-actions').hidden = false;
    $('#up-now').textContent = 'Close';
    openModal();
  }
}

$('#up-later').addEventListener('click', () => {
  umDismissed = umVersion;
  umPhase = null;
  closeModal();
});
$('#up-now').addEventListener('click', () => {
  if ($('#up-now').textContent === 'Close') { closeModal(); umPhase = null; return; }
  umPhase = 'downloading';
  $('#up-title').textContent = 'Updating…';
  $('#up-actions').hidden = true;
  $('#up-doing').hidden = false;
  $('#up-doing').textContent = 'Updating...';
  $('#up-progwrap').hidden = false;
  $('#up-bar').style.width = '3%';
  $('#up-pct').textContent = '0%';
  $('#uprocket').classList.add('launch');
  if (window.shell) window.shell.downloadUpdate();
});
$('#upreview').addEventListener('click', () => { umDismissed = null; umPhase = null; syncUpdateUI(umLast); });

// ---------------- About panel: version + check for updates ----------------
let aboutOpen = false;
let abChecking = false;

function refreshAbout() {
  if (!aboutOpen || !state) return;
  $('#ab-version').textContent = 'Version ' + (state.version || '—');
  $('#ab-folder').textContent = state.projectsDir || '—';
  if (!abChecking) return;
  const st = state.update && state.update.status;
  const el = $('#ab-status'), btn = $('#ab-check-btn');
  if (st === 'checking') { el.textContent = 'Checking…'; el.className = 'ab-status'; btn.disabled = true; return; }
  btn.disabled = false; abChecking = false;
  if (st === 'none') { el.textContent = "You're on the latest version ✓"; el.className = 'ab-status ok'; }
  else if (st === 'available') { el.textContent = ''; closeAbout(); }   // the "What's new" popup takes over
  else if (st === 'dev') { el.textContent = 'Updates work in the installed app.'; el.className = 'ab-status warn'; }
  else if (st === 'check-failed') { el.textContent = "Couldn't check — try again later."; el.className = 'ab-status warn'; }
}

function openAbout() {
  aboutOpen = true; abChecking = false;
  $('#ab-status').textContent = ''; $('#ab-status').className = 'ab-status';
  $('#ab-check-btn').disabled = false;
  refreshAbout();
  $('#aboutmodal').classList.add('show');
}
function closeAbout() { aboutOpen = false; $('#aboutmodal').classList.remove('show'); }

$('#about').addEventListener('click', openAbout);
$('#ab-close').addEventListener('click', closeAbout);
$('#aboutmodal').addEventListener('click', e => { if (e.target.id === 'aboutmodal') closeAbout(); });
$('#ab-repo').addEventListener('click', e => {
  e.preventDefault();
  const url = (state && state.repoUrl) || 'https://github.com/flodisterhoft-ops/launchpad';
  if (window.shell) window.shell.openExternal(url); else window.open(url, '_blank');
});
$('#ab-check-btn').addEventListener('click', () => {
  if (!window.shell) {
    abChecking = false;
    $('#ab-status').textContent = 'Updates work in the installed app.';
    $('#ab-status').className = 'ab-status warn';
    return;
  }
  abChecking = true;
  $('#ab-status').textContent = 'Checking…'; $('#ab-status').className = 'ab-status';
  $('#ab-check-btn').disabled = true;
  window.shell.checkUpdates();
});

// ---------------- filter, hide/unhide, keyboard -----------------------------
$('#filter').addEventListener('input', e => { filterText = e.target.value; lastSig = null; render(); });

function updateHiddenNote() {
  const el = $('#unhide-all');
  const n = (state && state.hidden && state.hidden.length) || 0;
  if (n > 0) { el.hidden = false; el.textContent = `${n} hidden — show all`; }
  else el.hidden = true;
}
$('#unhide-all').addEventListener('click', () => api('/api/unhide', { all: true }).finally(() => setTimeout(poll, 200)));

// Esc closes the About panel, or dismisses the update popup when it's just an offer
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (aboutOpen) { closeAbout(); return; }
  if ($('#upmodal').classList.contains('show') && umPhase === 'available') {
    umDismissed = umVersion; umPhase = null; closeModal();
  }
});

poll();
setInterval(poll, 2000);
