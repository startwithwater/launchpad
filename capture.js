// Dev-only: capture product screenshots of the real UI for the README.
// Usage: start `node server.js` (or the app), then `npx electron capture.js`.
// Saves PNGs into assets/. Not shipped in the build.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const PORT = process.env.CAP_PORT || 7777;
const OUT = path.join(__dirname, 'assets');
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

async function shot(win, name) {
  // nudge offscreen compositor, then grab the last painted frame
  win.webContents.invalidate();
  await wait(400);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('saved', name, img.getSize().width + 'x' + img.getSize().height);
}
const js = (win, code) => win.webContents.executeJavaScript(code);

function makeWin(w, h) {
  return new BrowserWindow({
    width: w, height: h, show: false, frame: false, backgroundColor: '#f5f6f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: true },
  });
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = makeWin(800, 960);
  win.webContents.setFrameRate(30);
  await win.loadURL(`http://127.0.0.1:${PORT}/`);
  await wait(2600);

  // 1) Dashboard with one project running (real static server -> real links)
  await js(win, `fetch('/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Julias Website',server:true})}).then(()=>1).catch(()=>0)`);
  await wait(3800);
  await js(win, `window.scrollTo(0,0)`);
  await shot(win, 'dashboard.png');

  // 2) "What's new" update popup
  await js(win, `(() => { umPhase=null; umDismissed=null; syncUpdateUI({status:'available',version:'1.3.4',notes:[
    'New About page with version + Check for updates',
    'Update popup now shows a changelog',
    'Progress bar and a confetti celebration',
    'Fixed a bug that could blank the project list']}); })()`);
  await wait(800);
  await shot(win, 'update.png');

  // 3) About panel
  await js(win, `(() => { document.querySelector('#upmodal').classList.remove('show'); openAbout(); })()`);
  await wait(600);
  await shot(win, 'about.png');

  // 4) Tray quick panel (separate small page)
  await js(win, `document.querySelector('#aboutmodal').classList.remove('show')`);
  const tray = makeWin(336, 424);
  tray.webContents.setFrameRate(30);
  await tray.loadURL(`http://127.0.0.1:${PORT}/tray`);
  await wait(1800);
  await shot(tray, 'tray.png');

  await js(win, `fetch('/api/stopall',{method:'POST',body:'{}'}).catch(()=>0)`);
  await wait(900);
  app.quit();
});
