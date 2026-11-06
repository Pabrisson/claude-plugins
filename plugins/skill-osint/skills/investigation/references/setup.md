# Setup, doctor, the dashboard server

Contents: doctor · setup · the dashboard server · .gitignore · setup geoint · the Mapillary token · verify-media tools.

## doctor

`osint.mjs doctor [--json]`: one line per need. `ok` fine; `MISSING` (Node 22, the dashboard build) stops everything: give the fix; `missing` (git, a type's optional tool) disables one feature, the line says which, with the install command for this OS; `info` keys (set or not, never their value), `gemini` and `google vision` (always off: the agent checks matches itself); `warning` a broken type manifest, an evidence file gone or changed since it was added (originals must stay intact), a `.gitignore` that would hide the cases.

`private: <id> (<folder>)` in the `types:` line is a type of this cases folder (`.osint-types/<id>/`); `private: <id> refused (<folder>)` comes with a warning that says why (a plugin type's id, an engine command's name, a link out of the folder, an `engine.js` that imports more than `node:` built-ins, a manifest that does not hold). `osint.mjs types` lists every type with its folder, what it lacks and its errors; it loads a private type's `engine.js` to check its commands (`types --no-load` does not), which `doctor` never does. Making a type: `references/types.md`.

`pdf export: <browser>` is the browser `export` prints with. `missing pdf export: …`: no Chrome, Chromium or Edge (or `OSINT_BROWSER` is not a file): `export` exits 3; the dashboard's Print view still prints from any browser. Give the install command from the line; installing a browser is the user's to do (no `setup` for it). `OSINT_BROWSER` forces the PDF export's browser (nothing else is tried); `OSINT_PDF_TIMEOUT` is the milliseconds before the browser is stopped (120000 by default).

`watch: 2 cases (acme-fr every 24h, next 06:00) · notifications on` is the watched cases and the soonest pass. `no dashboard server runs them` → run `osint.mjs dashboard`. `a click opens Script Editor, not the case: brew install terminal-notifier` (macOS) or the notify-send line (Linux) → give the user the command; the notifications still show. `paused` → `watch --resume` when the user wants it back.

`doctor --network`: one call per free service (RDAP, crt.sh, Wayback, RIPEstat, Shodan InternetDB); say which are down, the engine degrades by itself. Shodan InternetDB is free for non-commercial use.

Datasets: `ok      whatsmyname data: 692 sites, 2026-11-03 (245 KB)` (or `whatsmyname data: not downloaded yet — the first username case fetches it`) is a dataset kept for the whole folder in `.cache/datasets/` (WhatsMyName: 7 days). The first `username check` downloads it; delete `.cache/datasets/<id>` and `<id>.json` to fetch it again; offline, the copy is used even when old and the Journal says so. `uv` runs Maigret (the username type's option): without it, « Also run Maigret » is off (exit 3 for that option only) and WhatsMyName still runs; `osint.mjs setup uv`. `doctor --network` also has a `raw` line (raw.githubusercontent.com, where the datasets come from).

## setup

`osint.mjs setup <tool>`: shows the package-manager command and exits 2; after the user's yes, `setup <tool> --yes`. A command with `sudo` or a pipe is never run by the engine: give it to the user (in Claude Code, `! <command>`). If the tool is still not on the PATH, the user opens a new terminal. Exit 3: the tool is missing, work degraded.

## The dashboard server

`osint.mjs dashboard [-p <slug>] [--open]` starts, or finds, the server for this folder: `127.0.0.1:41387` or the next free port, one per folder. It stops once every agent that asked for it has quit — unless a case is watched (`references/follow-up.md`, Watch): it then stays on until « Stop server » in Settings or the end of the session, and the next `osint.mjs dashboard` starts it again. Heavy data lives in `$OSINT_DATA`, else `$CLAUDE_PLUGIN_DATA`, else `~/.skill-osint`.

## .gitignore

The first case writes the folder's `.gitignore`. Git keeps every case: notes, Evidence, the Journal, `.osint/case.json`, `analysis.json`, `events.jsonl`, views, snapshots. `.osint-types/` (the cases folder's own case types) is versioned with the cases, and `doctor` warns when a `.gitignore` hides it. It drops `.cache/`, `.trash/`, `.dashboard.log`, `.osint/cache|geoint|lock`, `Evidence/crops|frames`, `.obsidian/workspace*.json`.

## setup geoint

`osint.mjs setup geoint` shows its plan and exits 2; after the user's yes, `setup geoint --yes`. It clones https://github.com/marouane53/GeoINT at commit `18543326` (2026-10-29) into `<OSINT_DATA>/geoint/<sha>` (never modified), installs Chromium with `uv tool run playwright install chromium` only without Chrome, runs `doctor.py --models` (each model loaded once, the downloaded size shown every 15 s), runs the pack's tests, and writes `<OSINT_DATA>/geoint/<sha>.json` with the measured sizes. `--yes` again resumes an interrupted download. A modified pack folder is refused: delete it, run again. Heavy data under `$OSINT_DATA` (else `$CLAUDE_PLUGIN_DATA`, else `~/.skill-osint`): `geoint/`, `geoint-cache/`, `hf/`, `torch/`, `uv/`, `playwright/`.

Email lines: `holehe` (the email type's `account-probe` runs Holehe by `uv tool run holehe@latest`, on the user's yes only; GPLv3, unmaintained since 2024, never bundled; its hits are inferred clues; without `uv`, account-probe is off, exit 3). `disposable email domains: 10,123 domains, 2026-11-03 (143 KB)` (or `not downloaded yet — the first email case fetches it`) is the disposable-email-domains list (CC0) kept 7 days in `.cache/datasets/`. `xon` in `doctor --network`: XposedOrNot allows 25 calls an hour and 100 a day for the whole folder; the probe counts as one and is skipped when the quota is used. `gravatar` too (about 100 profiles an hour, no key).

More `doctor` lines: `geoint pack`, `browser for direct reverse search`, `uv`, `git`, `ffmpeg`, `exiftool`, `yt-dlp`, `cloudflared` with their version and use, the `MAPILLARY_TOKEN` key. `doctor --network` adds Nominatim, Open-Meteo, Hugging Face, Mapillary (the token goes in a header when set) and a test tunnel.

## The Mapillary token

Optional and free. It is the **client token** of an application registered at mapillary.com/dashboard/developers (Register Application, then copy its Client Token, `MLY|…`); no OAuth flow is needed to read open images. The agent sends it in the header `Authorization: OAuth <token>`, never in a URL. `/plugin configure skill-osint@pabrisson` keeps it in the plugin's `userConfig` and the session-start hook exports `MAPILLARY_TOKEN`; another agent sets it in the environment. Without it, KartaView, Panoramax and the other providers are still swept.

**Known limit of the pinned GeoINT pack**: its `pano.py` passes the token in the URL it gives to `curl`, so the token is visible in the process list (`ps`) of this machine while a Mapillary request runs. The pack is pinned and not modified here. The token is a free, read-only client token: on a shared machine, do not set it (Mapillary is then skipped), or revoke it at mapillary.com/dashboard/developers after the work.

## verify-media tools

More `doctor` lines: `missing exiftool: brew install exiftool — metadata limited to JPEG/PNG EXIF read by the GeoINT pack; video, XMP and IPTC unread` (without it `verify-media meta` reads no EXIF, XMP, IPTC nor embedded thumbnail); `missing c2patool: brew install c2patool (or https://github.com/contentauth/c2patool/releases/latest) — no C2PA manifest check (verify-media)`. `meta` ends with exit code 3 when one of the two is missing, after doing the rest. In the `types` line, `verify-media ready (no direct upload)` means the GeoINT pack is not installed: no direct upload to Yandex and Baidu, the tunnel's links still work.

