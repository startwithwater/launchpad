# Launchpad

One window to run any project in this folder locally and/or share it with a
temporary public link.

## Use

Double-click **`Launchpad.exe`** — a window opens with every project folder listed.
No console, nothing installed. It also sits in the system tray:

- **Tray icon, left-click** — quick panel with the running projects (open / copy
  link / fresh link / stop), plus Open Launchpad and Stop all
- **Tray icon, right-click** — menu (Open, Stop all, Quit)
- **Titlebar ⤓ button** — hide the window to the tray; everything keeps running
- **Titlebar ✕ button** — quit: stops all projects and links

- **Start** — run the project on this computer (localhost + Wi-Fi link for phones)
- **Share** — get a public `https://…trycloudflare.com` link to send to anyone
  (starts the project too; the first Share ever downloads the sharing engine once)
- **New link** — swap the public link for a fresh one
- **…** — show the technical output log
- Checkboxes (or the **All** box at the top) → a bar appears to start/share/stop
  the selected projects at once
- **Quit** — stops everything and closes Launchpad
- Double-clicking the exe while it's running brings the window back

New folders appear in the list automatically — no restart needed.

## Sending it to someone

Send just `Launchpad.exe`. They put it **inside the folder that contains their
project folders** and double-click. Everything works without installing anything:

- Plain HTML/CSS/JS sites: fully, out of the box
- Sharing: works after the automatic one-time engine download
- Projects needing `npm`/`wrangler`: only if Node.js is installed (the buttons
  say so otherwise)

Windows will show a SmartScreen warning the first time (unsigned exe):
*More info → Run anyway*. The firewall prompt on first Start: *Allow* (needed
for the Wi-Fi links).

## How projects are detected

| Project has | Served with |
|---|---|
| entry in `config.json` `overrides` with `command` | your command (`{port}` is replaced) |
| `wrangler.toml` or `functions/` | `npx wrangler pages dev` (Pages Functions, D1, R2 work) |
| `package.json` with a `dev`/`start` script | `npm run dev` — its port is auto-detected |
| anything else | built-in static file server (uses `public/`, `dist/`, `build/`… if the root has no `index.html`) |

Ports are auto-assigned from 8101 and remembered in `config.json` (created next
to the exe). Folders starting with `_` or `.` are skipped.

## config.json (optional)

```json
{
  "projectsDir": "..",
  "overrides": {
    "Viktor Hekalow Website": { "port": 8788 },
    "Some Project": { "command": "npm run preview -- --port {port}", "port": 8200 }
  },
  "exclude": ["Some Folder To Hide"]
}
```

`projectsDir` is relative to the exe. This copy uses `".."` because the exe
lives in `_Launchpad` inside the projects folder; a shared exe scans its own
folder by default.

## Development

- `server.js` — control server (plain Node, no runtime dependencies)
- `public/index.html` — main UI · `public/tray.html` — tray quick panel
- `electron-main.js` / `preload.js` — the Electron shell (frameless window,
  tray, single-instance)
- `launchpad.bat` — run the server from source in a console + browser tab
  (no shell, no tray)
- `npx electron .` — run the full app from source
- `npx electron-builder --win portable` — rebuild the single-file
  `dist/Launchpad.exe`, then copy it over `Launchpad.exe` (quit the running
  app first)
- `python make-icon.py` — regenerate `icon.ico` + `public/icon-64.png`
