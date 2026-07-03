# Roadmap

Where Launchpad is headed. These are directions and ideas, not promises or
dates — but the top item is the one most likely to be built next.

## Next: Pinned links (permanent URLs that don't change)

Some projects get worked on a lot, and a link you can **bookmark once and reuse**
is far more useful than a fresh Share URL every time. Today's **Share** links are
Cloudflare Quick Tunnels, which are designed to change on every run — great for a
one-off, not for a link you keep.

The plan is a **Pin link** action beside Share, in two levels:

- [ ] **Local pinned link** — *no account, ship first.*
  A stable address like `http://localhost:7777/p/my-project` that always maps to
  the same project and **auto-starts it** if it isn't running. Perfect for your
  own bookmarks and projects you open every day.

- [ ] **Public permanent link** — *advanced, opt-in.*
  A stable public URL like `https://my-project.yourdomain.com` using a Cloudflare
  **named tunnel** and your own domain, so it survives restarts (unlike Quick
  Tunnel Share links). Needs a one-time Cloudflare domain + API-token setup, which
  Launchpad would walk you through.

## Ideas / later

- [ ] **Hide / exclude projects** — one-click hide for noisy nested folders (a
  buried `help`/`docs` site), writing to the config `exclude` list.
- [ ] **Cross-platform** — macOS / Linux support (currently Windows-only; needs
  the `taskkill` / PowerShell bits replaced with portable equivalents).
- [ ] **Faster scanning on huge folders** — throttle or cache the project scan so
  very large or deeply-nested folders stay snappy.
- [ ] **Per-project notes / favourites** — pin the projects you touch most to the
  top of the list.

---

Have an idea? Open an issue or a discussion on
[GitHub](https://github.com/flodisterhoft-ops/launchpad).
