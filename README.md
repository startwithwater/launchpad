<div align="center">

<img src="assets/icon-256.png" width="96" alt="Launchpad">

# Launchpad

**Run any project on your computer with one click — or share it with a live link in seconds.**

A tiny desktop app that finds every project in a folder and lets you preview it
locally, on your phone over Wi‑Fi, or on the public internet with a temporary
link you can send to anyone. It lives in your system tray and keeps itself up to
date.

<img src="assets/dashboard.png" width="720" alt="Launchpad dashboard">

</div>

---

## Why

Spinning up a local server or a tunnel for every little project gets old fast —
different commands, different ports, remembering which is running. Launchpad
turns all of it into one list of buttons.

- **▶ Start** — runs the project on your computer, with a `localhost` link and a
  Wi‑Fi link your phone can open on the same network.
- **⇗ Share** — creates a public `https://…trycloudflare.com` link you can text
  to anyone. Great for showing a client, or testing camera/GPS on a real phone.
- Handles plain HTML sites, `npm` dev servers, and Cloudflare Pages/Wrangler
  projects — it detects which and does the right thing.

## Features

|  |  |
|---|---|
| 🗂️ **Every project, one list** | Point it at a folder; it finds every previewable project inside — top-level or nested — and remembers your choices. New projects appear automatically. |
| 📱 **Phone-ready** | Local + Wi‑Fi links out of the box; public HTTPS links for anything that needs a real device. |
| 🔗 **One-click sharing** | Public links via Cloudflare quick tunnels — one click, fresh link, no account. |
| 🎯 **Smart detection** | Static sites, `npm run dev`, and `wrangler pages dev` all just work. |
| 🖥️ **Lives in the tray** | Close the window and it keeps running; a tray panel gives you quick controls. |
| 🚀 **Auto-updates** | Checks for new versions, shows a changelog, updates itself. |

## Screenshots

<div align="center">

<table>
<tr>
<td width="50%"><img src="assets/update.png" alt="Update popup with changelog"><br><sub><b>Auto-update</b> — a “What’s new” popup, a progress bar, then a little celebration.</sub></td>
<td width="50%"><img src="assets/about.png" alt="About panel"><br><sub><b>About</b> — version, one-click “Check for updates”, and your projects folder.</sub></td>
</tr>
</table>

<img src="assets/tray.png" width="300" alt="Tray quick panel">

<sub><b>Tray panel</b> — see what’s running and open, copy a link, or stop it without opening the window.</sub>

</div>

## Install

> **Windows only.** Launchpad ships as a Windows installer and relies on
> Windows tools under the hood (`taskkill`, PowerShell, the Windows build of
> `cloudflared`), so it does not run on macOS or Linux today.

1. Download the latest **`Launchpad-Setup.exe`** from
   [Releases](https://github.com/flodisterhoft-ops/launchpad/releases/latest).
2. Run it — it installs just for you (no admin) and adds a **Launchpad** shortcut.
3. Open Launchpad and click **change** to point it at the folder where your
   projects live.

> First run shows a Windows SmartScreen notice (the app isn’t code-signed):
> **More info → Run anyway**. The first time you **Start** a project, allow the
> firewall prompt so phones on your Wi‑Fi can reach it.

Plain HTML/CSS/JS projects and sharing work out of the box. Projects that use
`npm` or `wrangler` need [Node.js](https://nodejs.org) installed — Launchpad
tells you when that’s the case.

## Using it

- **Start / Share** per project, or tick several (or **All**) and act on them at once.
- **New link** swaps a public link for a fresh one.
- **…** shows the raw server output if something misbehaves.
- Closing the window keeps everything running in the tray. **Single-click** the
  tray icon for the quick panel, **double-click** to reopen the window.
- **Quit** (in-app or the tray menu) stops everything.

## Auto-update

Launchpad keeps itself current — you never re-download it:

1. It checks for a new version on launch and every few hours (or on demand from
   **About → Check for updates**).
2. A **What’s new** popup lists the changes.
3. **Update now** → progress bar → 🎉 → it restarts on the new version.

---

## For developers

The app is [Electron](https://www.electronjs.org/); the logic lives in a small
plain-Node control server (`server.js`) that also serves the dashboard.

```bash
npm install
npx electron .          # run the app from source
node server.js          # or just the server, opened in a browser tab
npm test                # run the unit tests (Node's built-in runner)
```

| File | Role |
|---|---|
| `server.js` | Control server — scans projects, runs servers/tunnels, serves the UI & API |
| `public/index.html` | The dashboard (single file) |
| `public/tray.html` | The tray quick panel |
| `electron-main.js` / `preload.js` | Electron shell — window, tray, auto-updater |
| `publish.mjs` | Build + release to GitHub with a changelog |
| `make-icon.py` / `capture.js` | Regenerate the icon / the screenshots above |

### Publishing an update

```bash
node publish.mjs patch                      # 1.3.x -> 1.3.(x+1), build + release
node publish.mjs minor                      # -> 1.4.0
node publish.mjs patch "Fixed X" "Added Y"  # with an explicit changelog
```

It bumps the version, builds the installer, bakes a **changelog** into the
update feed (auto from your commit messages, or the notes you pass) and the
GitHub release, uploads everything via the `gh` CLI, and tags it. Every
installed copy shows that changelog and updates on its own.

## Tech

Electron · Node (no runtime dependencies beyond the updater) · Cloudflare quick
tunnels · electron-builder + electron-updater · GitHub Releases as the update feed.

## Support

Launchpad is free and open source. If it saves you time, you can support it:

- ☕ [**Buy me a coffee**](https://buymeacoffee.com/flodisterhoft)
- 💛 [**GitHub Sponsors**](https://github.com/sponsors/flodisterhoft-ops)

## License

[MIT](LICENSE) © Florian Disterhoft

<div align="center"><sub>Built for quickly previewing and sharing side projects. 🚀</sub></div>
