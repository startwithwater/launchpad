#!/usr/bin/env node
/*
 * Launchpad — local dev-server + Cloudflare quick-tunnel control center.
 *
 * Scans a projects folder, serves a dashboard UI on the control port, and
 * manages one local server and one cloudflared quick tunnel per project.
 *
 * Runs two ways:
 *  - packaged: required by electron-main.js, which calls start() and owns the window.
 *  - dev:      node server.js  (open http://localhost:7777 in a browser; via launchpad.bat)
 *
 * No runtime npm dependencies — plain Node built-ins only.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const IS_ELECTRON = !!process.versions.electron;

// DATA dir (config.json, cloudflared.exe, projects to scan): electron-main sets
// LAUNCHPAD_BASE_DIR (userData when installed); a plain checkout keeps
// everything beside server.js.
const LAUNCHPAD_DIR = process.env.LAUNCHPAD_BASE_DIR || __dirname;
const CONFIG_FILE = path.join(LAUNCHPAD_DIR, 'config.json');

// ASSET dir (index.html, app.js, tray.html, icon) ships WITH the code — inside
// the Electron app.asar, so it must resolve from __dirname, not the data dir.
const PUBLIC_DIR = path.join(__dirname, 'public');

const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

let APP_VERSION = 'dev';
try { APP_VERSION = require('./package.json').version; } catch (e) {}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.wasm': 'application/wasm', '.map': 'application/json', '.kml': 'application/vnd.google-earth.kml+xml',
  '.webmanifest': 'application/manifest+json', '.manifest': 'application/manifest+json',
};

// ---------------------------------------------------------------- config ---

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Could not save config.json:', e.message);
  }
}

const config = Object.assign({
  controlPort: 7777,
  portBase: 8101,
  exclude: [],
  overrides: {},
  ports: {},
}, loadConfig());

// Which folder to scan for projects. Priority: an explicit user choice saved
// in config, else the default the launcher passes in, else a sensible guess.
function resolveProjectsDir() {
  if (config.projectsDir) return path.resolve(config.projectsDir);
  if (process.env.LAUNCHPAD_DEFAULT_PROJECTS_DIR) return path.resolve(process.env.LAUNCHPAD_DEFAULT_PROJECTS_DIR);
  return path.resolve(LAUNCHPAD_DIR, IS_ELECTRON ? '.' : '..');
}
let PROJECTS_DIR = resolveProjectsDir();

// Point the launcher at a different projects folder (from the in-app picker).
function setProjectsDir(dir) {
  stopAll();
  config.projectsDir = path.resolve(dir);
  saveConfig();
  PROJECTS_DIR = config.projectsDir;
  projects.clear();
  scanProjects(true);
}

// wrangler/npm projects shell out to the machine's own Node install
const HAS_NODE_TOOLS = (() => {
  try { return spawnSync('where.exe', ['npx'], { windowsHide: true }).status === 0; } catch (e) { return false; }
})();

// ---------------------------------------------------------------- state ----

/** name -> project record */
const projects = new Map();

function ringPush(buf, chunk) {
  const lines = String(chunk).split(/\r?\n/).filter(l => l.trim().length);
  for (const l of lines) {
    buf.push(l.length > 400 ? l.slice(0, 400) + ' …' : l);
    if (buf.length > 250) buf.shift();
  }
}

function assignPort(name) {
  const override = config.overrides[name];
  if (override && override.port) return override.port;
  if (config.ports[name]) return config.ports[name];
  const used = new Set(Object.values(config.ports));
  for (const o of Object.values(config.overrides)) if (o.port) used.add(o.port);
  let p = config.portBase;
  while (used.has(p) || (p >= config.controlPort && p <= config.controlPort + 9)) p++;
  config.ports[name] = p;
  saveConfig();
  return p;
}

function parseWranglerOutputDir(dir) {
  try {
    const toml = fs.readFileSync(path.join(dir, 'wrangler.toml'), 'utf8');
    const m = toml.match(/^\s*pages_build_output_dir\s*=\s*"([^"]*)"/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch (e) { /* no toml */ }
  return '.';
}

function detectProject(name, dir) {
  const override = config.overrides[name] || {};
  const has = f => fs.existsSync(path.join(dir, f));
  let mode, detail = '', docroot = dir;

  if (override.command) {
    mode = 'custom';
    detail = override.command;
  } else if (has('wrangler.toml') || has('functions')) {
    mode = 'wrangler';
    detail = parseWranglerOutputDir(dir);
  } else if (has('package.json')) {
    let scripts = {};
    try { scripts = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts || {}; } catch (e) {}
    if (scripts.dev || scripts.start) {
      mode = 'npm';
      detail = scripts.dev ? 'dev' : 'start';
    }
  }
  if (!mode) {
    if (has('index.html')) {
      mode = 'static';
    } else {
      for (const sub of ['public', 'dist', 'build', 'site', 'www', 'out', 'app']) {
        if (fs.existsSync(path.join(dir, sub, 'index.html'))) { mode = 'static'; docroot = path.join(dir, sub); detail = sub; break; }
      }
    }
  }
  // nothing runnable or servable here — this folder is not a project
  if (!mode) return null;
  return { mode, detail, docroot };
}

// Git stores a primary checkout's metadata in a .git directory. Linked
// worktrees instead have a .git file pointing into <repo>/.git/worktrees/.
// Other .git files, such as submodule pointers, still count as primary here.
function gitCheckoutKind(dir) {
  const marker = path.join(dir, '.git');
  let stat;
  try { stat = fs.statSync(marker); } catch (e) { return null; }
  if (stat.isDirectory()) return 'primary';
  if (!stat.isFile()) return null;

  let contents = '';
  try { contents = fs.readFileSync(marker, 'utf8'); } catch (e) { return null; }
  const match = contents.match(/^\s*gitdir:\s*(.+?)\s*$/im);
  if (!match) return null;

  const gitDir = path.resolve(dir, match[1]);
  const parts = path.normalize(gitDir).split(path.sep);
  const linked = parts.some((part, i) =>
    part.toLowerCase() === 'worktrees'
    && i > 0
    && parts[i - 1].toLowerCase().endsWith('.git')
    && i < parts.length - 1);
  return linked ? 'linked' : 'primary';
}

// Walk the projects folder looking for things that can actually be previewed:
// wrangler/npm apps and static sites, at any depth (up to SCAN_MAX_DEPTH). A
// folder that detects as a project is listed and not descended into further;
// anything else is just a container and we keep looking inside it. Nested
// projects are named by their relative path ("clients/acme-site") so names
// stay unique and top-level projects keep their old one-segment names.
const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_DIRS = 4000;
const SCAN_INTERVAL_MS = 5000;
let lastScanAt = 0;

function findProjects(rootDir) {
  const found = [];
  // pointing the picker directly at a single project should still work
  const rootDet = detectProject(path.basename(rootDir), rootDir);
  if (rootDet) {
    return [{
      name: path.basename(rootDir),
      dir: rootDir,
      det: rootDet,
      isWorktree: gitCheckoutKind(rootDir) === 'linked',
    }];
  }
  let visited = 0;
  (function walk(dir, rel, depth, inheritedWorktree) {
    if (depth > SCAN_MAX_DEPTH) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {}
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const base = ent.name;
      if (base.startsWith('.') || base.startsWith('_') || base === 'node_modules') continue;
      const name = rel ? rel + '/' + base : base;
      if (config.exclude.includes(base) || config.exclude.includes(name)) continue;
      if (++visited > SCAN_MAX_DIRS) return;
      const sub = path.join(dir, base);
      const checkoutKind = gitCheckoutKind(sub);
      const isWorktree = checkoutKind ? checkoutKind === 'linked' : inheritedWorktree;
      const det = detectProject(name, sub);
      if (det) found.push({ name, dir: sub, det, isWorktree });
      else walk(sub, name, depth + 1, isWorktree);
    }
  })(rootDir, '', 1, gitCheckoutKind(rootDir) === 'linked');
  return found;
}

function scanProjects(force = false) {
  const now = Date.now();
  if (!force && now - lastScanAt < SCAN_INTERVAL_MS) return;
  lastScanAt = now;

  const seen = new Set();
  for (const { name, dir, det, isWorktree } of findProjects(PROJECTS_DIR)) {
    seen.add(name);
    let p = projects.get(name);
    if (!p) {
      p = {
        name, dir,
        server: { status: 'stopped', pid: null, child: null, httpServer: null, log: [] },
        tunnel: { status: 'stopped', pid: null, child: null, url: null, log: [], wantStop: false },
      };
      projects.set(name, p);
    }
    p.mode = det.mode;
    p.detail = det.detail;
    p.docroot = det.docroot;
    p.isWorktree = !!isWorktree;
    p.port = assignPort(name);
  }
  // drop projects whose folder disappeared (only if nothing is running)
  for (const [name, p] of projects) {
    if (!seen.has(name) && p.server.status === 'stopped' && p.tunnel.status === 'stopped') projects.delete(name);
  }
  // prune remembered ports for projects that no longer exist, so config.json
  // doesn't accumulate stale entries as folders come and go
  let prunedPorts = false;
  for (const name of Object.keys(config.ports)) {
    if (!projects.has(name)) { delete config.ports[name]; prunedPorts = true; }
  }
  if (prunedPorts) saveConfig();
}

// ------------------------------------------------------- static serving ----

// Is filePath contained within root? A plain string-prefix check is unsafe: it
// lets "/root/../root-secret" through whenever the sibling folder's name starts
// with the root's name. path.relative gives an answer that survives that case.
function isInsideRoot(root, filePath) {
  const rel = path.relative(path.normalize(root), path.normalize(filePath));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function serveStaticFile(root, urlPath, res) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch (e) { rel = urlPath.split('?')[0]; }
  let filePath = path.normalize(path.join(root, rel));
  if (!isInsideRoot(root, filePath)) { res.writeHead(403); res.end('Forbidden'); return; }

  let stat = null;
  try { stat = fs.statSync(filePath); } catch (e) {}
  if (stat && stat.isDirectory()) {
    const idx = path.join(filePath, 'index.html');
    if (fs.existsSync(idx)) { filePath = idx; stat = fs.statSync(idx); }
    // no index.html here — don't expose a directory listing of the folder
    else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); return; }
  }
  if (!stat) {
    // extensionless routes -> try .html (matches Cloudflare Pages behaviour)
    if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) { filePath += '.html'; }
    else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404 — ' + rel); return; }
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(filePath).on('error', () => { try { res.end(); } catch (e) {} }).pipe(res);
}

// ------------------------------------------------------ process helpers ----

function killTree(pid) {
  if (!pid) return;
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); } catch (e) {}
}

function waitForPort(port, timeoutMs, cb) {
  const deadline = Date.now() + timeoutMs;
  (function tryOnce() {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); cb(true); });
    sock.once('error', () => {
      sock.destroy();
      if (Date.now() > deadline) return cb(false);
      setTimeout(tryOnce, 700);
    });
  })();
}

/** Find listening ports owned by a process tree (for npm dev servers). */
function sniffTreePorts(rootPid, cb) {
  const ps = `
$root=${rootPid}; $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId;
$tree=@($root); do { $n=$tree.Count; $tree=@($root)+@($all | Where-Object { $tree -contains $_.ParentProcessId } | ForEach-Object ProcessId) | Select-Object -Unique } while ($tree.Count -ne $n);
(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $tree -contains $_.OwningProcess } | ForEach-Object LocalPort | Sort-Object -Unique) -join ','`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', ps.replace(/\n/g, ' ')], { windowsHide: true });
  let out = '';
  child.stdout.on('data', d => out += d);
  child.on('close', () => {
    const ports = out.trim().split(',').map(s => parseInt(s, 10)).filter(n => n > 0 && n !== boundPort);
    cb(ports);
  });
  child.on('error', () => cb([]));
}

// ------------------------------------------------------------- servers -----

function startServer(p, cb) {
  if (p.server.status === 'running' || p.server.status === 'starting') return cb && cb(null);
  p.server.log = [];
  p.server.status = 'starting';
  p.server.error = null;

  if (p.mode === 'static') {
    const srv = http.createServer((req, res) => serveStaticFile(p.docroot, req.url, res));
    srv.on('error', err => {
      p.server.status = 'error';
      p.server.error = err.code === 'EADDRINUSE' ? `Port ${p.port} is already in use by another program` : err.message;
      p.server.httpServer = null;
    });
    srv.listen(p.port, '0.0.0.0', () => {
      p.server.status = 'running';
      p.server.startedAt = Date.now();
      p.actualPort = p.port;
      ringPush(p.server.log, `Static server on http://127.0.0.1:${p.port} (root: ${p.docroot})`);
      cb && cb(null);
    });
    p.server.httpServer = srv;
    return;
  }

  // child-process modes need the machine's own Node/npm
  if (!HAS_NODE_TOOLS) {
    p.server.status = 'error';
    p.server.error = 'This project needs Node.js installed (nodejs.org)';
    return cb && cb(p.server.error);
  }

  let command;
  const override = config.overrides[p.name] || {};
  if (p.mode === 'custom') {
    command = override.command.replace(/\{port\}/g, String(p.port));
  } else if (p.mode === 'wrangler') {
    const dirArg = p.detail === '.' ? '.' : `"${p.detail}"`;
    command = `npx -y wrangler@latest pages dev ${dirArg} --ip 0.0.0.0 --port ${p.port}`;
  } else { // npm
    command = `npm run ${p.detail}`;
  }

  ringPush(p.server.log, `> ${command}`);
  // shell:true passes the command string to cmd verbatim — explicit cmd.exe
  // spawning re-escapes inner quotes and breaks paths/args containing them
  const child = spawn(command, {
    cwd: p.dir,
    shell: true,
    windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(p.port), BROWSER: 'none', NO_COLOR: '1' }),
  });
  p.server.child = child;
  p.server.pid = child.pid;
  child.stdout.on('data', d => ringPush(p.server.log, d));
  child.stderr.on('data', d => ringPush(p.server.log, d));
  child.on('exit', code => {
    if (p.server.child !== child) return;   // superseded by a newer start — ignore the old exit
    const wasStopping = p.server.status === 'stopping';
    p.server.child = null;
    p.server.pid = null;
    p.server.status = wasStopping ? 'stopped' : (p.server.status === 'running' ? 'stopped' : 'error');
    if (p.server.status === 'error') p.server.error = `The project's server quit (code ${code}) — see the log`;
  });

  if (p.mode === 'npm') {
    // dev script picks its own port — sniff the process tree for it
    let tries = 0;
    (function sniff() {
      if (p.server.status !== 'starting') return;
      sniffTreePorts(child.pid, ports => {
        if (p.server.status !== 'starting') return;
        if (ports.length) {
          p.actualPort = ports.includes(p.port) ? p.port : ports[0];
          p.server.status = 'running';
          p.server.startedAt = Date.now();
          ringPush(p.server.log, `Detected dev server on port ${p.actualPort}`);
          return cb && cb(null);
        }
        if (++tries > 40) {
          p.server.status = 'error';
          p.server.error = 'Started, but no local address was found — set an override in config.json';
          return cb && cb(p.server.error);
        }
        setTimeout(sniff, 1500);
      });
    })();
  } else {
    waitForPort(p.port, 120000, ok => {
      if (p.server.status !== 'starting') return;
      if (ok) {
        p.actualPort = p.port;
        p.server.status = 'running';
        p.server.startedAt = Date.now();
        cb && cb(null);
      } else {
        p.server.status = 'error';
        p.server.error = `Never opened port ${p.port} — see the log`;
        killTree(child.pid);
        cb && cb(p.server.error);
      }
    });
  }
}

function stopServer(p) {
  if (p.server.httpServer) {
    try { p.server.httpServer.close(); } catch (e) {}
    p.server.httpServer = null;
  }
  if (p.server.child) {
    p.server.status = 'stopping';
    killTree(p.server.pid);
  }
  if (!p.server.child) p.server.status = 'stopped';
  p.server.lanReachable = false;
  p.actualPort = null;
}

// --------------------------------------------------- cloudflared install ---

let cloudflaredPath = fs.existsSync(path.join(LAUNCHPAD_DIR, 'cloudflared.exe'))
  ? path.join(LAUNCHPAD_DIR, 'cloudflared.exe') : null;

const cfState = { status: cloudflaredPath ? 'ready' : 'missing', pct: 0 };
const pendingTunnels = new Set();

function downloadFile(url, dest, redirects, cb) {
  if (redirects > 5) return cb(new Error('too many redirects'));
  let done = false;
  const finish = err => { if (done) return; done = true; cb(err); };
  const req = https.get(url, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return downloadFile(res.headers.location, dest, redirects + 1, finish);
    }
    if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let got = 0;
    const out = fs.createWriteStream(dest);
    res.on('data', d => { got += d.length; if (total) cfState.pct = Math.round(got / total * 100); });
    res.pipe(out);
    out.on('finish', () => out.close(() => finish(null)));
    out.on('error', err => finish(err));
    res.on('error', err => finish(err));
  });
  req.on('error', err => finish(err));
  // abort if the connection stalls with no bytes for 30s (a genuine slow
  // download keeps the socket active, so this only trips on a real hang)
  req.setTimeout(30000, () => req.destroy(new Error('download timed out')));
}

function ensureCloudflared() {
  if (cfState.status === 'ready' || cfState.status === 'downloading') return;
  cfState.status = 'downloading';
  cfState.pct = 0;
  const dest = path.join(LAUNCHPAD_DIR, 'cloudflared.exe');
  const tmp = dest + '.partial';
  downloadFile(CLOUDFLARED_URL, tmp, 0, err => {
    if (err) {
      console.error('cloudflared download failed:', err.message);
      try { fs.unlinkSync(tmp); } catch (e) {}
      cfState.status = 'error';
      for (const name of pendingTunnels) {
        const p = projects.get(name);
        if (p && p.tunnel.status === 'starting') { p.tunnel.status = 'stopped'; ringPush(p.tunnel.log, 'Sharing setup failed: ' + err.message); }
      }
      pendingTunnels.clear();
      return;
    }
    try { fs.renameSync(tmp, dest); } catch (e) { cfState.status = 'error'; return; }
    cloudflaredPath = dest;
    cfState.status = 'ready';
    cfState.pct = 100;
    const queued = [...pendingTunnels];
    pendingTunnels.clear();
    for (const name of queued) {
      const p = projects.get(name);
      if (p) { p.tunnel.status = 'stopped'; startTunnel(p, () => {}); }
    }
  });
}

// ------------------------------------------------------------- tunnels -----

function startTunnel(p, cb) {
  if (p.tunnel.status === 'running' || p.tunnel.status === 'starting') return cb && cb(null);

  if (!cloudflaredPath) {
    // mark as starting, queue behind the one-time engine download
    p.tunnel.log = [];
    p.tunnel.status = 'starting';
    p.tunnel.url = null;
    ringPush(p.tunnel.log, 'Downloading the sharing engine (one-time)…');
    pendingTunnels.add(p.name);
    if (p.server.status !== 'running' && p.server.status !== 'starting') startServer(p, () => {});
    ensureCloudflared();
    return cb && cb(null);
  }

  const go = () => {
    const target = p.actualPort || p.port;
    p.tunnel.log = [];
    p.tunnel.status = 'starting';
    p.tunnel.url = null;
    p.tunnel.wantStop = false;
    ringPush(p.tunnel.log, `> cloudflared tunnel --url http://127.0.0.1:${target}`);
    const child = spawn(cloudflaredPath, ['tunnel', '--url', `http://127.0.0.1:${target}`], { windowsHide: true });
    p.tunnel.child = child;
    p.tunnel.pid = child.pid;
    const onData = d => {
      ringPush(p.tunnel.log, d);
      if (!p.tunnel.url) {
        const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) {
          p.tunnel.url = m[0];
          p.tunnel.status = 'running';
          p.tunnel.startedAt = Date.now();
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => {
      if (p.tunnel.child !== child) return;   // superseded by a renew — the old exit must not touch new state
      p.tunnel.child = null;
      p.tunnel.pid = null;
      p.tunnel.status = p.tunnel.wantStop ? 'stopped' : 'stale';
    });
    child.on('error', err => {
      p.tunnel.status = 'stale';
      ringPush(p.tunnel.log, 'spawn error: ' + err.message);
    });
    cb && cb(null);
  };

  // a tunnel needs a local server behind it
  if (p.server.status === 'running') return go();
  startServer(p, err => err ? (cb && cb(err)) : go());
}

function stopTunnel(p) {
  pendingTunnels.delete(p.name);
  p.tunnel.wantStop = true;
  if (p.tunnel.child) killTree(p.tunnel.pid);
  else p.tunnel.status = 'stopped';
  p.tunnel.url = null;
}

function renewTunnel(p, cb) {
  p.tunnel.wantStop = true;
  const pid = p.tunnel.pid;
  if (pid) killTree(pid);
  p.tunnel.child = null;
  p.tunnel.pid = null;
  p.tunnel.status = 'stopped';
  setTimeout(() => startTunnel(p, cb), 400);
}

// ---------------------------------------------------------------- LAN IP ---

let lanIp = null;
function detectLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (/vEthernet|WSL|Hyper-V|Loopback|VirtualBox|VMware/i.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      candidates.push({ name, address: a.address, wifi: /Wi-?Fi|WLAN|Wireless/i.test(name) });
    }
  }
  candidates.sort((a, b) => (b.wifi - a.wifi));
  lanIp = candidates.length ? candidates[0].address : null;
}
detectLanIp();
setInterval(detectLanIp, 60000).unref();

// Whether each running server is actually reachable over the LAN. We can't
// assume it: static/wrangler servers bind 0.0.0.0 (reachable), but an npm dev
// server picks its own bind address and many (Vite, Next) listen on localhost
// only unless told otherwise. Probing the LAN IP from here is the honest test —
// it connects only if the server really bound to the network — and lets the UI
// show a Wi-Fi link exactly when one will work, for every project mode.
function checkLanReach() {
  if (!lanIp) return;
  for (const p of projects.values()) {
    if (p.server.status !== 'running') { p.server.lanReachable = false; continue; }
    const sock = net.connect({ host: lanIp, port: p.actualPort || p.port, timeout: 1200 });
    const done = ok => { p.server.lanReachable = ok; sock.destroy(); };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  }
}
setInterval(checkLanReach, 4000).unref();

// ------------------------------------------------------------------ API ----

function projectJson(p) {
  return {
    name: p.name,
    mode: p.mode,
    detail: p.detail,
    isWorktree: !!p.isWorktree,
    port: p.actualPort || p.port,
    needsNode: (p.mode === 'wrangler' || p.mode === 'npm' || p.mode === 'custom') && !HAS_NODE_TOOLS,
    localUrl: p.server.status === 'running' ? `http://localhost:${p.actualPort || p.port}/` : null,
    lanUrl: p.server.status === 'running' && lanIp && p.server.lanReachable ? `http://${lanIp}:${p.actualPort || p.port}/` : null,
    server: { status: p.server.status, error: p.server.error || null, startedAt: p.server.startedAt || null },
    tunnel: { status: p.tunnel.status, url: p.tunnel.url, startedAt: p.tunnel.startedAt || null },
  };
}

function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body || '{}')); } catch (e) { cb({}); } });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// Read a bundled asset and send it, headers written only after a successful
// read — a missing file returns a readable 500, never a hung/blank response.
function sendAsset(res, file, type) {
  fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
    if (err) {
      console.error('asset read failed:', file, err.message);
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end('Launchpad could not load "' + file + '".\n' + err.message +
        '\n\nExpected in: ' + PUBLIC_DIR);
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  });
}

function stopAll() {
  for (const p of projects.values()) { stopTunnel(p); stopServer(p); }
}

const ui = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const route = `${req.method} ${u.pathname}`;

  // The control API is for the local dashboard only. Reject requests whose
  // Host/Origin point anywhere else, so a malicious website can't fire
  // cross-site requests at localhost to start/stop projects or open tunnels.
  const reqHost = String(req.headers.host || '').replace(/:\d+$/, '');
  const origin = req.headers.origin;
  if ((reqHost !== 'localhost' && reqHost !== '127.0.0.1')
    || (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (route === 'GET /' || route === 'GET /index.html') {
    return sendAsset(res, 'index.html', 'text/html; charset=utf-8');
  }

  if (route === 'GET /tray') return sendAsset(res, 'tray.html', 'text/html; charset=utf-8');
  if (route === 'GET /app.js') return sendAsset(res, 'app.js', 'text/javascript; charset=utf-8');
  if (route === 'GET /icon-64.png') return sendAsset(res, 'icon-64.png', 'image/png');

  if (route === 'GET /api/ping') return json(res, 200, { launchpad: true });

  if (route === 'GET /api/state') {
    scanProjects();
    const list = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
    return json(res, 200, {
      projectsDir: PROJECTS_DIR,
      lanIp,
      version: module.exports.appVersion || APP_VERSION,
      repoUrl: 'https://github.com/flodisterhoft-ops/launchpad',
      cf: cfState,
      update: module.exports.updateInfo || null,
      hidden: config.exclude.slice(),
      projects: list.map(projectJson),
    });
  }

  if (route === 'GET /api/log') {
    const p = projects.get(u.searchParams.get('name') || '');
    if (!p) return json(res, 404, { error: 'unknown project' });
    return json(res, 200, { server: p.server.log, tunnel: p.tunnel.log });
  }

  if (req.method === 'POST') {
    return readBody(req, body => {
      const act = u.pathname;
      if (act === '/api/stopall') { stopAll(); return json(res, 200, { ok: true }); }
      if (act === '/api/quit') {
        json(res, 200, { ok: true });
        try { stopAll(); } catch (e) {}
        setTimeout(() => {
          if (module.exports.onQuit) module.exports.onQuit();
          else process.exit(0);
        }, 400);
        return;
      }
      // open a project's folder in the system file manager
      if (act === '/api/reveal') {
        const p = projects.get(body.name);
        if (p) { try { spawn('explorer.exe', [p.dir], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {} }
        return json(res, 200, { ok: true });
      }
      // hide a project from the list (adds its name to config.exclude)
      if (act === '/api/hide') {
        const nm = body.name;
        const p = projects.get(nm);
        if (p) { stopTunnel(p); stopServer(p); projects.delete(nm); }
        if (nm && !config.exclude.includes(nm)) { config.exclude.push(nm); saveConfig(); }
        return json(res, 200, { ok: true });
      }
      // un-hide one project, or all of them, then rescan so they reappear
      if (act === '/api/unhide') {
        if (body.all) config.exclude = [];
        else if (body.name) config.exclude = config.exclude.filter(x => x !== body.name);
        saveConfig();
        scanProjects(true);
        return json(res, 200, { ok: true });
      }
      const names = body.names || (body.name ? [body.name] : []);
      const targets = names.map(n => projects.get(n)).filter(Boolean);
      if (!targets.length) return json(res, 400, { error: 'no matching projects' });

      if (act === '/api/start') {
        for (const p of targets) {
          if (body.tunnel) startTunnel(p, () => {});
          else if (body.server) startServer(p, () => {});
        }
        return json(res, 200, { ok: true });
      }
      if (act === '/api/stop') {
        for (const p of targets) {
          if (body.tunnel && !body.server) stopTunnel(p);
          else { stopTunnel(p); stopServer(p); }
        }
        return json(res, 200, { ok: true });
      }
      if (act === '/api/renew') {
        for (const p of targets) renewTunnel(p, () => {});
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'unknown action' });
    });
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('404');
});

// ------------------------------------------------------- window / launch ---

// try the control port, walk up if taken; if a Launchpad already owns it,
// just pop another window at the running instance and bow out
const CANDIDATE_PORTS = Array.from({ length: 10 }, (_, i) => config.controlPort + i);
let boundPort = config.controlPort;

function probeLaunchpad(port, cb) {
  const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 900 }, res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => { try { cb(JSON.parse(body).launchpad === true); } catch (e) { cb(false); } });
  });
  req.on('timeout', () => { req.destroy(); cb(false); });
  req.on('error', () => cb(false));
}

function start() {
  return new Promise((resolve, reject) => {
    function bindNext(idx) {
      if (idx >= CANDIDATE_PORTS.length) {
        console.error('No free control port found (' + CANDIDATE_PORTS[0] + '–' + CANDIDATE_PORTS[CANDIDATE_PORTS.length - 1] + ')');
        if (IS_ELECTRON) return reject(new Error('no free control port'));
        process.exit(1);
      }
      const port = CANDIDATE_PORTS[idx];
      const onErr = err => {
        if (err.code !== 'EADDRINUSE') return reject(err);
        probeLaunchpad(port, isLp => {
          if (isLp && !IS_ELECTRON) {
            // dev mode: another Launchpad already owns this port
            console.log(`Launchpad already running on port ${port}.`);
            process.exit(2);
          } else {
            // electron has its own single-instance lock; a foreign launchpad
            // on this port just means we take the next one
            bindNext(idx + 1);
          }
        });
      };
      ui.once('error', onErr);
      ui.listen(port, '127.0.0.1', () => {
        ui.removeListener('error', onErr);
        boundPort = port;
        onReady(port);
        resolve(port);
      });
    }
    bindNext(0);
  });
}

function onReady(port) {
  scanProjects(true);
  console.log('');
  console.log('  Launchpad running:  http://localhost:' + port + '/');
  console.log('  Projects folder:    ' + PROJECTS_DIR);
  console.log('  Projects found:     ' + projects.size);
  console.log('  Sharing engine:     ' + (cloudflaredPath || 'downloads automatically on first Share'));
  console.log('');
  console.log('  Keep this window open (minimized is fine). Ctrl+C stops everything.');
}

// standalone (node server.js) starts immediately; under Electron the shell
// requires this module and calls start() itself
if (require.main === module) start();

module.exports = {
  start, stopAll, setProjectsDir, onQuit: null, updateInfo: null, appVersion: null,
  // exported for the test suite
  detectProject, findProjects, gitCheckoutKind, isInsideRoot,
  get port() { return boundPort; },
  get projectsDir() { return PROJECTS_DIR; },
};

// ---------------------------------------------------------------- cleanup --

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const p of projects.values()) {
    if (p.tunnel.pid) killTree(p.tunnel.pid);
    if (p.server.pid) killTree(p.server.pid);
    if (p.server.httpServer) try { p.server.httpServer.close(); } catch (e) {}
  }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => { cleanup(); process.exit(0); });
}
process.on('uncaughtException', err => {
  console.error('Uncaught:', err && err.stack || err);
});
