// Dev-only: capture product screenshots of the real UI for the README.
// Point a server at a demo projects folder, then `npx electron capture.js`.
// Saves PNGs into assets/. Not shipped in the build.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const PORT = process.env.CAP_PORT || 7777;
const OUT = path.join(__dirname, 'assets');
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

// demo projects to show as running / shared (must exist in the scanned folder)
const RUN = ['Chat Demo', 'Countdown Timer', 'Landing Page'];
const SHARE = 'Photo Gallery';

async function shot(win, name) {
  win.webContents.invalidate();
  await wait(400);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('saved', name, img.getSize().width + 'x' + img.getSize().height);
}
const js = (win, code) => win.webContents.executeJavaScript(code);
const post = (win, url, body) => js(win, `fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}}).then(()=>1).catch(()=>0)`);

function makeWin(w, h) {
  return new BrowserWindow({
    width: w, height: h, show: false, frame: false, backgroundColor: '#f5f6f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: true },
  });
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = makeWin(800, 980);
  win.webContents.setFrameRate(30);
  await win.loadURL(`http://127.0.0.1:${PORT}/`);
  await wait(2600);

  // start a few projects running, and share one (public link) for the "shared" badge
  for (const n of RUN) await post(win, '/api/start', { name: n, server: true });
  await post(win, '/api/start', { name: SHARE, tunnel: true });
  // wait for servers + the tunnel URL to appear (best effort)
  for (let i = 0; i < 20; i++) {
    await wait(2000);
    const ready = await js(win, `fetch('/api/state').then(r=>r.json()).then(s=>{const p=s.projects.find(x=>x.name===${JSON.stringify(SHARE)});return !!(p&&p.tunnel&&p.tunnel.url)}).catch(()=>false)`);
    if (ready) break;
  }
  await js(win, `window.scrollTo(0,0)`);
  await wait(600);
  await shot(win, 'dashboard.png');

  // "What's new" update popup
  await js(win, `(() => { umPhase=null; umDismissed=null; syncUpdateUI({status:'available',version:'1.4.0',notes:[
    'New About page with version + Check for updates',
    'Update popup now shows a changelog',
    'Progress bar and a confetti celebration',
    'Smarter Wi-Fi links and security hardening']}); })()`);
  await wait(800);
  await shot(win, 'update.png');

  // About panel
  await js(win, `(() => { document.querySelector('#upmodal').classList.remove('show'); openAbout(); })()`);
  await wait(600);
  await shot(win, 'about.png');
  await js(win, `document.querySelector('#aboutmodal').classList.remove('show')`);

  // Tray quick panel (separate small page) — shows the running/shared projects
  const tray = makeWin(336, 452);
  tray.webContents.setFrameRate(30);
  await tray.loadURL(`http://127.0.0.1:${PORT}/tray`);
  await wait(2000);
  await shot(tray, 'tray.png');

  await post(win, '/api/stopall', {});
  await wait(900);
  app.quit();
});
