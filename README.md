# Launchpad

One window to run any project locally and/or share it with a temporary public
link. Installs per-user, lives in the system tray, and **updates itself** from
GitHub Releases.

## Install & use

Run **`Launchpad-Setup-x.y.z.exe`** once — it installs for the current user (no
admin), adds a desktop + Start-menu shortcut, and launches. From then on open it
from the **Launchpad** shortcut.

- **Start** — run the project on this computer (localhost + Wi-Fi link for phones)
- **Share** — public `https://…trycloudflare.com` link to send to anyone (starts
  the project too; the first Share ever downloads the sharing engine once)
- **New link** — swap the public link for a fresh one
- **…** — show the technical output log
- **change** (top, next to the folder path) — pick which folder to scan for projects
- Checkboxes (or **All**) → a bar to start/share/stop several at once

Window & tray:

- **Tray icon — single-click** → quick panel of the running projects (open / copy
  link / fresh link / stop) · **double-click** → open the main window
- **Tray icon — right-click** → menu (Open, Stop all, Quit)
- **Titlebar ✕** → closes to the tray (everything keeps running)
- **Quit** (in-app, or tray menu) → stops everything and exits

New folders appear automatically. The projects folder is remembered.

## Auto-update

The install location is baked in, so updates are automatic — no links to resend:

1. On launch (and every few hours) it checks GitHub for a newer version.
2. If there is one, it downloads in the background and shows a green
   **“A new version is ready — Restart to update”** bar.
3. Click it, or just quit and reopen — the update applies on the next start.

To publish a new version (see **Development** below), you run one command; every
installed copy picks it up on its own.

## Sending it to someone

Send the **`Launchpad-Setup-x.y.z.exe`** file once. They run it, then click
**change** to point it at the folder where their projects live. After that they
get every future update automatically — you never send another file.

First run shows a Windows SmartScreen warning (unsigned): *More info → Run anyway*.
First **Start** shows a firewall prompt: *Allow* (needed for the Wi-Fi links).

Works out of the box for plain HTML/CSS/JS sites and for sharing. Projects that
need `npm`/`wrangler` only run if Node.js is installed (the buttons say so
otherwise).

## How projects are detected

| Project has | Served with |
|---|---|
| `overrides` entry with a `command` in config | your command (`{port}` is replaced) |
| `wrangler.toml` or `functions/` | `npx wrangler pages dev` (Pages Functions, D1, R2 work) |
| `package.json` with a `dev`/`start` script | `npm run dev` — its port is auto-detected |
| anything else | built-in static file server (uses `public/`, `dist/`, `build/`… if the root has no `index.html`) |

Ports are auto-assigned from 8101 and remembered. Folders starting with `_` or
`.` are skipped.

## config.json

Lives in the app's data folder (`%APPDATA%\launchpad\config.json`), written by
the app. You normally never edit it — use the **change** button and the in-app
controls. Shape:

```json
{
  "projectsDir": "C:/Users/you/Documents/My Projects",
  "overrides": {
    "Viktor Hekalow Website": { "port": 8788 },
    "Some Project": { "command": "npm run preview -- --port {port}", "port": 8200 }
  },
  "exclude": ["Some Folder To Hide"]
}
```

## Development

Source lives in `_Launchpad/`. The app is Electron; the work happens in `server.js`.

- `server.js` — control server (plain Node) · `public/index.html` — main UI ·
  `public/tray.html` — tray quick panel
- `electron-main.js` / `preload.js` — the Electron shell (frameless window, tray,
  auto-updater, single-instance)
- `npx electron .` — run the full app from source (no auto-update in dev)
- `launchpad.bat` — run just the server in a console + browser tab
- `python make-icon.py` — regenerate `icon.ico` + `public/icon-64.png`

### Publishing an update (the whole point)

```
node publish.mjs patch     # 1.3.1 -> 1.3.2, build, and release to GitHub
node publish.mjs minor     # 1.3.x -> 1.4.0
node publish.mjs           # release the current package.json version as-is
```

It builds the installer, uploads it plus `latest.yml` (the update feed) to a
GitHub Release via the `gh` CLI, and creates the tag. Every installed copy
updates within a few hours, or immediately on next launch.

- Repo / releases: <https://github.com/flodisterhoft-ops/launchpad>
- Requires `gh auth login` (already done on this machine).
- Startup errors on any machine are logged to
  `%APPDATA%\launchpad\launchpad-error.log`.
