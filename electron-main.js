// Launchpad Electron shell — frameless main window, system tray with a
// quick-controls popup, single-instance. The actual work happens in
// server.js, which this process embeds (Electron's main process is Node).
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Log any startup failure to a file so a blank/dead window on someone else's
// machine is diagnosable (there's no console in a packaged app). Registered
// before the heavy requires so even a bad require gets recorded.
function crashLog(msg) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'launchpad-error.log'), new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) {}
}
process.on('uncaughtException', err => crashLog('uncaught: ' + (err && err.stack || err)));
process.on('unhandledRejection', err => crashLog('unhandledRejection: ' + (err && err.stack || err)));

const { autoUpdater } = require('electron-updater');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // DATA dir (config.json, cloudflared.exe, logs):
  //   portable build  -> next to the exe (dropped among the projects)
  //   installed build -> Electron userData (writable, survives updates)
  //   dev             -> the source folder
  process.env.LAUNCHPAD_BASE_DIR = process.env.PORTABLE_EXECUTABLE_DIR
    || (app.isPackaged ? app.getPath('userData') : __dirname);

  // Default PROJECTS folder when the user hasn't chosen one yet:
  //   portable -> the exe's own folder (it's dropped among the projects)
  //   installed -> the user's Documents (they pick their real folder in-app)
  //   dev -> the parent of the source folder
  let defProjects;
  if (process.env.PORTABLE_EXECUTABLE_DIR) defProjects = process.env.PORTABLE_EXECUTABLE_DIR;
  else if (app.isPackaged) {
    const docs = path.join(os.homedir(), 'Documents');
    defProjects = fs.existsSync(docs) ? docs : os.homedir();
  } else defProjects = path.resolve(__dirname, '..');
  process.env.LAUNCHPAD_DEFAULT_PROJECTS_DIR = defProjects;

  const srv = require('./server.js');

  let mainWin = null;
  let popup = null;
  let tray = null;
  let port = null;
  let quitting = false;

  const iconPath = () => [
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(__dirname, 'icon.ico'),
  ].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

  function quitApp() {
    if (quitting) return;
    quitting = true;
    try { srv.stopAll(); } catch (e) {}
    if (tray) { try { tray.destroy(); } catch (e) {} }
    app.quit();
  }
  srv.onQuit = quitApp;

  function createMain() {
    mainWin = new BrowserWindow({
      width: 680, height: 940, minWidth: 430, minHeight: 520,
      frame: false, backgroundColor: '#f5f6f8', show: false,
      icon: iconPath(),
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    mainWin.loadURL(`http://127.0.0.1:${port}/`);
    mainWin.once('ready-to-show', () => mainWin && mainWin.show());
    // belt-and-braces: never leave the window invisible if ready-to-show is missed
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed() && !mainWin.isVisible() && !quitting) mainWin.show(); }, 2500);
    // closing the window does NOT quit — Launchpad lives in the tray.
    // Quit via the tray menu or the in-app Quit button.
    mainWin.on('close', e => {
      if (quitting) return;
      e.preventDefault();
      mainWin.hide();
    });
    mainWin.on('closed', () => { mainWin = null; });
    // a hidden/idle window's renderer can be reaped by Chromium — a dead
    // renderer shows as a white window, so revive instead
    mainWin.webContents.on('render-process-gone', () => {
      if (mainWin && !quitting) mainWin.webContents.reload();
    });
    mainWin.webContents.on('did-fail-load', () => {
      if (mainWin && !quitting) setTimeout(() => mainWin && mainWin.loadURL(`http://127.0.0.1:${port}/`), 800);
    });
  }

  function showMain() {
    if (popup) popup.hide();
    if (mainWin) {
      if (mainWin.webContents.isCrashed()) mainWin.webContents.reload();
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    } else {
      createMain();
    }
  }

  function createPopup() {
    popup = new BrowserWindow({
      width: 336, height: 424,
      frame: false, transparent: true, resizable: false, movable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    popup.loadURL(`http://127.0.0.1:${port}/tray`);
    popup.on('blur', () => popup.hide());
    popup.webContents.on('render-process-gone', () => {
      if (popup && !quitting) popup.webContents.reload();
    });
  }

  function togglePopup() {
    if (!popup) return;
    if (popup.isVisible()) return popup.hide();
    const w = 336, h = 424;
    const tb = tray.getBounds();
    const wa = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).workArea;
    let x = Math.round(tb.x + tb.width / 2 - w / 2);
    x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
    // taskbar at the bottom vs top of the work area
    const y = tb.y > wa.y + wa.height / 2 ? wa.y + wa.height - h - 6 : wa.y + 6;
    popup.setBounds({ x, y, width: w, height: h });
    popup.show();
    popup.focus();
  }

  function createTray() {
    tray = new Tray(nativeImage.createFromPath(iconPath()));
    tray.setToolTip('Launchpad');
    // single left-click = quick panel, double left-click = main window.
    // 'click' fires before 'double-click', so debounce it briefly.
    let clickTimer = null;
    tray.on('click', () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => { clickTimer = null; togglePopup(); }, 320);
    });
    tray.on('double-click', () => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      if (popup) popup.hide();
      showMain();
    });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Launchpad', click: showMain },
      { label: 'Stop all projects', click: () => { try { srv.stopAll(); } catch (e) {} } },
      { type: 'separator' },
      { label: 'Quit Launchpad', click: quitApp },
    ]));
  }

  ipcMain.on('shell', (e, cmd, arg) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (cmd === 'minimize' && win) win.minimize();
    if (cmd === 'hideToTray' && win) win.hide();
    if (cmd === 'quit') quitApp();
    if (cmd === 'showMain') showMain();
    if (cmd === 'openExternal' && typeof arg === 'string' && /^https?:\/\//.test(arg)) shell.openExternal(arg);
    if (cmd === 'installUpdate') {
      quitting = true; // let the app actually exit so the updater can swap files
      try { srv.stopAll(); } catch (e2) {}
      try { autoUpdater.quitAndInstall(); } catch (e2) { console.error('quitAndInstall', e2 && e2.message); }
    }
    if (cmd === 'chooseFolder') {
      const picked = dialog.showOpenDialogSync(win || mainWin, {
        title: 'Choose your projects folder',
        properties: ['openDirectory'],
        defaultPath: srv.projectsDir,
      });
      if (picked && picked[0]) { try { srv.setProjectsDir(picked[0]); } catch (e2) {} }
    }
  });

  // ---- auto-update (packaged builds only; dev has no feed) ----
  function setupUpdates() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;   // apply on next quit even if ignored
    autoUpdater.on('update-available', info => {
      srv.updateInfo = { status: 'downloading', version: info.version, pct: 0 };
    });
    autoUpdater.on('download-progress', p => {
      const v = srv.updateInfo && srv.updateInfo.version;
      srv.updateInfo = { status: 'downloading', version: v, pct: Math.round(p.percent || 0) };
    });
    autoUpdater.on('update-downloaded', info => {
      srv.updateInfo = { status: 'ready', version: info.version };
      if (tray) tray.setToolTip('Launchpad — update ready (restart to apply)');
    });
    autoUpdater.on('error', err => console.error('updater:', err && err.message));
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(check, 5000);                    // shortly after launch
    setInterval(check, 3 * 60 * 60 * 1000);     // and every 3 hours
  }

  app.on('second-instance', showMain);
  app.on('window-all-closed', () => { /* tray keeps us alive; quit flows through quitApp */ });
  app.on('will-quit', () => { try { srv.stopAll(); } catch (e) {} });

  app.whenReady().then(async () => {
    try {
      port = await srv.start();
    } catch (err) {
      dialog.showErrorBox('Launchpad', 'Could not start: ' + (err && err.message || err));
      app.quit();
      return;
    }
    createTray();
    createPopup();
    createMain();
    if (app.isPackaged) setupUpdates();
  });
}
