# claude-plugins

**`pabrisson`** marketplace for Claude Code. Each plugin holds a single type of component (mod, hook, agent, command, skill or MCP server) for one domain, and is enabled on its own. A plugin that mixes several types goes under [Plugins](#plugins).

## Contents

- [Installation](#installation)
- [Catalog](#catalog)
  - [Mods](#mods)
  - [Hooks](#hooks)
  - [Agents](#agents)
  - [Commands](#commands)
  - [Skills](#skills)
  - [MCP servers](#mcp-servers)
  - [Plugins](#plugins)
- [Plugin documentation](#plugin-documentation)
  - [mod-hud](#mod-hud) · [mod-ports](#mod-ports) · [mod-code-fence](#mod-code-fence)
  - [hook-notify](#hook-notify)
  - [command-docs](#command-docs) · [command-toolbox](#command-toolbox)
  - [skill-laravel](#skill-laravel) · [skill-video](#skill-video) · [skill-immo](#skill-immo)
  - [requesty](#requesty) · [dbeaver](#dbeaver)
- [Plugin anatomy](#plugin-anatomy)
- [Development](#development)

## Installation

```bash
claude plugin marketplace add Pabrisson/claude-plugins
claude plugin install command-docs@pabrisson
```

The `/plugin` menu does the same from inside a session.

### Update

```bash
claude plugin marketplace update pabrisson && claude plugin update <plugin>@pabrisson
```

then restart the session.

### Uninstall

```bash
claude plugin uninstall <plugin>@pabrisson
```

## Catalog

### Mods

Mods change the Claude Code interface. They are active as soon as they are installed, nothing to call.

| Plugin | Role | Trigger |
|---|---|---|
| [`mod-hud`](#mod-hud) | Band above the prompt: model, effort, folder, branch, tools, usage, context, cost, update | always on |
| [`mod-ports`](#mod-ports) | Right pane listing what runs for the project (Docker, Kubernetes, processes), with links, restart and stop | HUD's `⇄` icon |
| [`mod-code-fence`](#mod-code-fence) | Wraps code pasted into the prompt in a ```` ```lang ```` fence | paste into the prompt (terminal) |

### Hooks

| Plugin | Role | Events |
|---|---|---|
| [`hook-notify`](#hook-notify) | Desktop notification (macOS, Linux, Windows) when a task ends or Claude waits for a permission, each prompt's duration logged to SQLite | `UserPromptSubmit`, `Stop`, `Notification` |

### Agents

No `agent-*` plugin yet.

### Commands

| Command | Plugin | Arguments | Role |
|---|---|---|---|
| `/command-docs:add-readme` | [`command-docs`](#command-docs) | — | Creates a professional README.md suited to the project type |
| `/command-docs:add-changelog` | [`command-docs`](#command-docs) | `[version] \| [entry-type] [description]` | Maintains CHANGELOG.md in the Keep a Changelog format |
| `/command-docs:summarize-implementation` | [`command-docs`](#command-docs) | — | Summarizes the conversation's last implementation for reuse elsewhere |
| `/command-toolbox:fork-sync` | [`command-toolbox`](#command-toolbox) | `[upstream-branch] \| --rebase \| --merge` | Syncs a fork with its upstream while keeping local changes |

### Skills

A skill triggers on its own when the request matches its description, or is called like a command.

| Skill | Plugin | Arguments | Role |
|---|---|---|---|
| `/skill-laravel:laravel-upgrade` | [`skill-laravel`](#skill-laravel) | `<target version>` | Upgrades Laravel one major version at a time, with a test pause between each |
| `/skill-video:video-editor` | [`skill-video`](#skill-video) | `setup \| <videos or URLs> \| apply this feedback … \| variations \| preview \| rules …` | Edits a video of any genre (short, YouTube, interview, tutorial, montage, brand film, motion design), rendered locally with captions, sound and a review studio |
| `/skill-immo:property-search` | [`skill-immo`](#skill-immo) | `setup \| <adresse, rue ou quartier> [type] [critères] \| add <url \| texte> \| refresh \| alert … \| dashboard \| apply this feedback …` | Finds property for sale in France (flats, houses, plots, parkings, premises) around an address, a street or a neighborhood, weighs each against the real sales of its type, its building, its neighborhood, the rent and the buyer's budget, writes offer letters, in a local dashboard |

### MCP servers

MCP servers have no prefix. Their settings are asked at install time and can be changed later in `/config`.

| Plugin | Server | Tools |
|---|---|---|
| [`requesty`](#requesty) | HTTP `https://router.requesty.ai/v1/mcp` | `mcp__plugin_requesty_requesty__*` (Sentry, Context7) |
| [`dbeaver`](#dbeaver) | stdio `npx -y omnisql-mcp@2.0.1` | `mcp__plugin_dbeaver_dbeaver__*` |

### Plugins

Plugins that bundle several types of components. None yet.

## Plugin documentation

### `mod-hud`

`claude plugin install mod-hud@pabrisson`

Band above the prompt, in the terminal as well as in the desktop app. Text colors follow `/theme`.

- **Line 1**: model (`Opus 5.5`) • effort (`○ Low` to `◈ Max`) | folder • git branch • `⚡` number of tools run, then the running tool ("Bash running 3s") or the last one used.
- **Agent line**: when an agent's transcript is opened from the task list, a line `▸ name ● status • ◷ time since spawned • Σ tokens generated • ⧉ its position among agents • ✎ its task`, and lines 1 and 2 show its model, effort, tools and context.
- **Line 2**: 5h and 7d usage gauges, each with its reset time then its gap to an even pace until the reset (`+5%`: used faster than the window runs out, `-5%` slower, `±0%` on pace: Agent Burn's gap, signed on usage), context (percentage and tokens), session cost (hidden while it is $0.00). In a narrow window, the line drops the reset times and pace gaps first, then the cost, then the tokens.
- **Line 3**: a new Claude Code version is available, with an **Update** button (brew, winget, mise, otherwise `claude update`). Once installed: "restart Claude to use it".
- **Alerts**: a toast when the context goes over 85% ("consider /compact") and when 5h usage goes over 90%, once per crossing.
- **`⇄` icon**: opens and closes the [`mod-ports`](#mod-ports) pane; without it, a toast says so.

On the desktop, the app already shows the model and effort: the HUD only shows folder, branch, tools and gauges there, with no update line.

### `mod-ports`

`claude plugin install mod-ports@pabrisson` (opened from [`mod-hud`](#mod-hud))

"Ports" pane on the right, opened by the HUD's `⇄` icon and rescanned every 5 s while open. The project is the git repository: a session started in a subfolder still sees the project's compose and cluster.

| Section | What is listed | Restart `⟳` | Stop `⏹` |
|---|---|---|---|
| Docker | Swarm services mounting the project (replicas, Traefik hosts, published ports), the project's running containers, stopped compose containers | `docker service update --force` / `docker restart` | — |
| Kubernetes | Services of the project's cluster (its `.kube/config`, set by direnv), state from ready replicas, ingress hosts | `kubectl rollout restart` | — |
| Process | Processes listening on TCP whose working directory is inside the project (`lsof`) | — | `kill` |

- Dot: green = up, orange = partial, red = down, grey = unknown.
- Links: `localhost:<port>` and Traefik or ingress hosts (https with TLS) open in the browser; database ports (3306, 5432, 6379, 27017) are copied with their scheme (`mysql://…`).
- `⟳` and `⏹` need two presses within 3 s.
- `docker`, `kubectl` and `lsof` are used when present; a section whose tool is missing stays empty.

### `mod-code-fence`

`claude plugin install mod-code-fence@pabrisson`

Code pasted into the prompt (terminal only) lands wrapped in a ```` ```lang ```` fence.

- Detection: shebang, JSON, YAML, then PHP, HTML, XML, Dockerfile, SQL, Python, Go, Rust, Java, TypeScript, JavaScript, CSS and Bash. Code of an unknown language: a fence with no language. Prose: left as is.
- Never touched: typing, a single-line paste, text that already contains ```` ``` ````, a paste inside an open fence.

### `hook-notify`

`claude plugin install hook-notify@pabrisson` — requires `python3`.

Adapted from [CCNotify](https://github.com/dazuiba/CCNotify).

| Event | Effect |
|---|---|
| `UserPromptSubmit` | Records the prompt (session, text, folder) |
| `Stop` | Records the end and notifies "`<project> · job#<n> ✓ <duration>`", with the start of the prompt and of the answer |
| `Notification` | Notifies a permission request ("Permission Required") or an action request; "waiting for input" is only timestamped, the `Stop` notification is enough |

- **macOS**: `terminal-notifier` (`brew install terminal-notifier`) with sound and icon; a click opens the project in VS Code if `code` is in the `PATH`. Otherwise `osascript`.
- **Linux**: `notify-send`. **Windows / WSL**: PowerShell toast.
- **Data**: `ccnotify.db` (table `prompt`: `session_id`, `prompt`, `cwd`, `seq`, `created_at`, `stoped_at`, `lastWaitUserAt`) and `ccnotify.log` (daily rotation) in `~/.claude/plugins/data/hook-notify-pabrisson/`, kept across updates.

```bash
sqlite3 ~/.claude/plugins/data/hook-notify-pabrisson/ccnotify.db \
  "select cwd, seq, created_at, stoped_at from prompt order by id desc limit 10"
```

### `command-docs`

`claude plugin install command-docs@pabrisson`

- **`add-readme`**: analyzes the project (type, technologies, purpose) and writes a README.md: badges, description, prerequisites, installation, configuration, usage, structure, scripts, tests, deployment. Tailored for Laravel, frontend (React/Vue), Node.js and Python.
- **`add-changelog [version] | [entry-type] [description]`**: reads the existing CHANGELOG.md and the last 10 commits, then adds the entry in the Keep a Changelog format. Runs on Sonnet.
- **`summarize-implementation`**: a reusable, project-agnostic summary of the conversation's last implementation: problem, approach, logic, components, technical decisions, dependencies, adaptation notes. Runs on Sonnet.

### `command-toolbox`

`claude plugin install command-toolbox@pabrisson`

**`fork-sync [upstream-branch] | --rebase | --merge`**: syncs a fork with its upstream without losing local work. Checks the repository state, backs up the branch, sets up the `upstream` remote, fetches its changes, analyzes the divergence, picks merge or rebase, resolves conflicts, verifies, pushes and cleans up. Runs on Sonnet.

### `skill-laravel`

`claude plugin install skill-laravel@pabrisson`

**`laravel-upgrade <target version>`**, for example `/skill-laravel:laravel-upgrade 12` from Laravel 9. The skill builds the path 9 → 10 → 11 → 12, then for each version:

1. reads the official upgrade guide and compares with the Laravel skeleton on GitHub;
2. updates `composer.json` and runs `composer update` until it succeeds;
3. syncs `config/` and `.env.example`, keeping custom values;
4. applies the code changes and replaces deprecated code;
5. clears every cache and checks `php artisan`;
6. **stops** so the user can test before the next version.

At each step it adopts the new structure, even when optional, with no backward-compatibility shims. A final report sums up the changes.

### `skill-video`

`claude plugin install skill-video@pabrisson` — requires Node ≥ 22, `ffmpeg`/`ffprobe`, Google Chrome, `uv`; transcription (mlx-whisper) needs an Apple Silicon Mac, or ElevenLabs. The skill runs `doctor` at the start of each conversation and gives the install command for anything missing.

Claude becomes a video editor for any genre: one or several rushes (files or URLs) plus B-roll become a short, a long YouTube video, an interview, a tutorial, a montage on music or a brand film, with graphics that carry the video or serve the footage; or a brief becomes a motion-design video with no footage.

| Arguments | Mode |
|---|---|
| `setup` | Style interview: name, language, audience, CTA, palette, font, music, the names the transcript must spell right; or the identity of a site (`site <url>`) |
| `<videos or URLs> [sources…] [studio]` | New video: several rushes are joined end to end (`file.mp4#t=12:30,14:10` keeps only a range), B-roll plays with its own sound, a second camera is synced by its sound; `studio` opens the review from the rough cut |
| `apply this feedback …` | Applies the feedback pasted from the studio (cuts, comments, word fixes, sound, visuals), then renders the new version |
| `variations <element>` | Numbered variants of one element, then keeps the choice |
| `preview` | Live debug page of the scene in Chrome |
| `rules list \| show \| use \| set \| new \| edit` | Editing rule packs, one per genre (see below), and the project's overrides |

Rule packs: one per video, chosen at the start (none by default). A pack in `.rules/` with the same name overrides the plugin's; with `extends: <name>` it only adds its own lines and keeps the plugin's updates. `video.mjs check` measures the pack's numbers on the edit (length, hook, CTA, stretches without a change, cuts inside a word, cuts on the beat, YouTube chapters), then the layout of every format (texts in the platforms' zones, too small for a phone, cut by the frame, over a face) before each review of the stills.

| Pack | For | Graphics |
|---|---|---|
| `shorts` | TikTok, Reels, YouTube Shorts: aggressive cuts, speed-up, captions, hook, CTA, music bed | lead |
| `motion-design` | Motion design carries the visuals: every idea gets an animated element, nothing stays static | lead |
| `youtube` | Long-form YouTube (8 to 30 min): hook then chapters, jump cuts that breathe, B-roll and lower thirds, end screen | support |
| `interview` | Interviews, podcasts, testimonials and talks: the words lead, natural pauses, names and quotes on screen, B-roll on the topics | support |
| `podcast-clip` | Vertical clips cut from a podcast or a long interview: one self-contained moment, the speaker on screen, captions, a link to the full episode | support |
| `tutorial` | Tutorials, screen recordings and courses: every step kept and clear, zooms on the action, callouts, chapters | support |
| `montage` | Montages carried by music (travel, vlog, event, aftermovie, sport, product shots): cuts on the beat, natural sound moments, few words | support |
| `corporate` | Corporate and brand films (presentation, product demo, recruitment, case study): calm pace, polished, the brand on every frame | support |
| `ad` | Social ads (6, 15 or 30 s on Meta, TikTok, YouTube): hook in the first second, the product before 3 s, one offer, one CTA, made to work muted | lead |

Graphics: `lead`, the motion design carries the video; `support`, the footage carries it and the graphics serve it.

- **Render**: 9:16, 16:9, 1:1 and 4:5 formats, 4K, 2K, 1080p and 720p resolutions, H.264, HEVC, AV1 and VP9 codecs, captions, synthesized music and sound effects. About 10 s for a 75 s video (40 s with motion blur), unchanged chunks cached; a 720p draft of the main format on request.
- **Delivery**: the videos, a poster per format, subtitles (SRT, WebVTT), a description with YouTube's chapters, and a 1280×720 thumbnail for YouTube.
- **Sound**: the voice is levelled from one rush to the next, cleaned (rumble, light denoise) and compressed; the music's beats are measured on a given track (any format) or laid out from a tempo.
- **Sound effects**: a catalog of 18 ready-made kinds (whoosh, riser, impact, pop, click, tick, chime…) for the common events, and one library per projects folder (`.sound/`) that all its videos play; a video's `assets/sound/` overrides it. The catalog is a base, not a limit: Claude designs every other sound the video needs, in its `sound.py` or as a sound of the project's own in the library. `sounds` lists what a video's cues need and what is missing, `sfx` makes only that: with ElevenLabs, or synthesized by the kit (`--local`: three takes each, designed after measures of ElevenLabs' effects: stereo width, short dry tails, each kind in its own band). A project's own designs and sounds live in `.sound/sfx.py`, under any name.
- **Git**: `init` writes the projects folder's `.gitignore` when there is none, which keeps the rushes, the music and the effects and leaves out what the engine makes again; `doctor` warns when a `.gitignore` would leave one of them out.
- **Studio**: local review on `127.0.0.1`, from port 41187, one server per projects folder, open from the start of each video: until the first version it shows what is being done (Claude's steps, the engine's, the renders' progress) and reloads by itself on the video. Feedback goes back to Claude as a prompt to paste. The Transcript tab's download menu gives the version's raw transcript (.txt) and its subtitles (.srt, .vtt).
- **Folders**: the current folder (or `$VIDEO_EDITOR_DIR`) holds one folder per video (`<slug>/`), the project's style (`.style/`) and its own rule packs (`.rules/`).
- **Learning**: stated preferences go into the style (`style set`, `style note`) or into the active pack's personal lines (`.rules/<name>.md` with `extends: <name>`).
- **ElevenLabs** (optional): with the plugin's secret `ElevenLabs API key` (asked when the plugin is enabled, or `/plugin configure skill-video@pabrisson`, kept in the Keychain; restart the session after setting it) or `ELEVENLABS_API_KEY` in the environment, each new video asks what ElevenLabs makes for it: Scribe v2 for the transcript, or a voice-over read by a voice of the account for a video without speech, the music, the sound effects. Every ElevenLabs option shows its estimated credits (`credits`), and Claude gives the estimate, with the credits left on the account, again before a change that goes through ElevenLabs. The answers live in the video's `source/elevenlabs.json` (`elevenlabs set`); the engine sends nothing it leaves off, and a video made before is asked when it first needs it. The local tools stay the first option; what the key may not make (permission, plan, credits) is synthesized as before.
- **First runs**: the first transcription downloads the Whisper model (~1.5 GB), the first render installs `playwright-core`.

The ElevenLabs key needs these permissions (as ElevenLabs names them in its API and its errors), and a restricted key only those the videos use:

| Permission | Used by |
|---|---|
| `voices_read` | `voices`: the voices offered for a voice-over |
| `text_to_speech` | `voice`: the voice-over |
| `speech_to_text` | `prepare`: the transcript by Scribe v2 |
| `music_generation` | `music`: the music, on a paid plan only (the Music API refuses free accounts) |
| `sound_generation` | `sfx`: the sound effects |
| `user_read` | `credits`: the credits left on the account, given with each estimate |

A request the key may not make is refused at no cost: the music and the effects then fall back to the synthesized kit, and for the transcript and the voice-over Claude relays ElevenLabs' message.

Everything stays on the machine, except what the video's `source/elevenlabs.json` turns on: the source's sound for Scribe v2, the narration's text for a voice-over, the prompts of the music and the effects.

### `skill-immo`

`claude plugin install skill-immo@pabrisson` — requires Node ≥ 22. The skill runs `doctor` once per conversation: Node, the dashboard build, the Stream Estate key (`stream-estate: on/off`) and the credits spent over 30 days.

Claude helps buy property in France: a flat, a house, a plot, a parking or a box, a shop or an office. A search starts from an address, a street or a neighborhood, for one or several types:
- the zone is a polygon: a band along the whole street (300 m on each side by default), a circle around an address, the commune or arrondissement, or its IRIS;
- each search has a mode, **Stream Estate** (listings from every portal, paid) or **OpenData** (open data and listings Claude finds, free);
- the engine weighs every listing against the real sales of its type (DVF: a house against houses, a parking on its price), its building, its neighborhood, the rent of the same home (carte des loyers) and the buyer's budget;
- each listing gets a review (strong points, points to watch, questions to ask, each with its source) and a score out of 100 weighted by the buyer's priorities;
- each listing keeps its conversation with the agent or the seller (replies pasted in the dossier, calls summed up): Claude reads it, then writes the offers, the replies, the reminders, the questions, the requests for documents and the visit requests. It gives the text and never sends anything;
- a local dashboard (`http://127.0.0.1:41287/<search>/`, dark by default) shows it all: the map and the cards (the zone stands out, the layers docked on its left, the listings on its right, both a bit see-through), a kanban by status (« Écarté » folded), a list to filter and sort, a dossier per listing, market, comparison, follow-up and API costs. Each status tints its cards, the same in every tab, and a star marks the favorites (in the dossier or on a card; « Favoris » filters them);
- the map's « DPE récents » layer (off by default) shows the zone's DPE of the last 3, 6 or 12 months in their class's color, and rings those no listing matches: a DPE comes before a sale, so the home may soon be for sale. A click puts « Chercher l'annonce » in the prompt for Claude; `refresh` counts the new ones and adds them to the news;
- the market tab follows the price trend and the number of sales, what the budget buys (prices by rooms, the spread of the sold prices), the listings' follow-up week by week, the prices street by street, and the commune's context (DPE classes of the zone, property tax rate, homes authorised);
- while the dashboard server runs, it watches every search, free: at its start, then every 6 h (`IMMO_WATCH_HOURS`, 0 turns it off), the zone's new DPE that no listing matches and, in Stream Estate mode, the count of the new listings. The news go to `<search>/feed.json` with a desktop notification (macOS: a click opens the search, with `terminal-notifier`; Linux `notify-send`; Windows a toast). The dashboard's bell counts what is not read yet and opens the latest (a listing's opens its dossier, the others the « Suivi » tab on them). « Suivi » lists them all day by day, one color per kind, with the listings' changes (new, drops, expiries), filters, « Chercher l'annonce » for a DPE and « Récupérer » for the listings, through the usual credits dialog;
- the dashboard starts nothing paid or new by itself: a new search, a wider zone or a message go through the prompt it copies for Claude, and a bar offers « Recharger » once Claude or the watch has changed the search.

| Arguments | Mode |
|---|---|
| `setup` | The buyer's profile, kept on the machine (`.profile.json`): down payment, net income, rate, length, notary fees, key places (work, school…), price of a credit, monthly credit cap |
| `<adresse \| rue \| quartier> [type] [critères]` | New search: types, zone, real sales, rent, neighborhood, listings, then the dashboard |
| `add <url \| texte>` | Adds a listing: one WebFetch of the page, or the pasted text |
| `refresh [<slug>]` | What changed: new listings, price drops, offers, expiries (Stream Estate pays only for what changed) |
| `alert …` | A Stream Estate alert (a saved search) for new listings and price changes, pushed to the phone through a random ntfy.sh topic |
| `dashboard [<slug>]` | Reopens the dashboard |
| `apply this feedback …` | Applies the prompt copied from the dashboard: refine, widen (zone, criteria, types), analyse, compare, write a message, add, look for a DPE's listing, question |

**Open data** (free, no key): Géoplateforme geocoding and isochrones, geo-DVF sales of every type (5 years; none in Moselle, Bas-Rhin, Haut-Rhin), the carte des loyers, ADEME DPE (of an address, of a zone, and the zone's last 12 months), the DGFiP's property tax rates, Sitadel's homes authorised, Géorisques, the national condominium register, OSM Overpass, SSMSI crime, INSEE Filosofi income, IGN vector tiles. When a data.gouv.fr MCP server is connected, Claude may use it for a dataset the engine does not cover. The answers are cached in the searches folder's `.cache/`. See `skills/property-search/references/data-sources.md`.

**Listings**:
- **With Stream Estate** (API v1, `api.stream.estate`; `stream_estate_api_key`, the plugin's secret, asked when the plugin is enabled or with `/plugin configure skill-immo@pabrisson`, kept in the Keychain): listings of every portal, with their price history, fees and agency. Also the zone's asking price per m² month by month, and alerts. A listing counts as online when it is not expired and was updated within 90 days (the API leaves most of what left the portals unexpired). The API has no filter on the floor, the elevator or an outdoor space: those are sorted out once fetched.
- **Without it**: Claude finds listings with WebSearch and reads one listing page at a time (WebFetch), or takes the text the user pastes. The portals' search pages are never scraped: their terms forbid it.

**Costs**: Stream Estate bills each item a call returns, 0.01 € pay as you go (the engine calls it a credit). A fetch costs 1 credit per listing returned, never one more than agreed, and a count (`itemsPerPage=0`) returns no item, so it is free (the server's watch counts that way). The asking prices and the alerts have no known price yet.
- Before every paid call, Claude, or the dashboard in a dialog, gives the estimate in credits and euros with what is left of the monthly cap, and waits for a yes (`--spend`). In Stream Estate mode, each paid button of the dashboard shows its credits in a badge: the listings a fetch would bring (up to the search's max), `≤ max` for a refresh (what changed is counted when it runs), `?` while a route's price is unknown.
- A route whose price is not measured yet says « coût inconnu » and asks too (`--accept-unknown`).
- The engine never goes over the monthly cap without the user's explicit agreement (`--force`).
- A 402 (no credits left) falls back to the assisted mode.
- The API v1 reports no cost: every call is logged in `.cache/api-usage.json` at its route's price for the items it returned. A price read off Stream Estate's console goes in with `costs set`.

**Git**: the first search writes the searches folder's `.gitignore`. Git keeps the searches, the listings with the user's statuses, notes and messages, and the credits log. It leaves out the cache, what the engine computes again, and the profile, which holds the income.

### `requesty`

`claude plugin install requesty@pabrisson`

HTTP MCP server of the [Requesty](https://requesty.ai) router (`https://router.requesty.ai/v1/mcp`), exposing Sentry tools (issues, errors, traces, logs, replays, Seer analysis…) and Context7 (library documentation).

| Setting | Description |
|---|---|
| `api_key` | Requesty API key (`rqsty-sk-…`), sent as a Bearer token. Required, stored in the Keychain, never in the repo |

### `dbeaver`

`claude plugin install dbeaver@pabrisson`

[`omnisql-mcp`](https://www.npmjs.com/package/omnisql-mcp) MCP server run through `npx` (independent of the active Node version), querying the connections of the local DBeaver workspace: list connections and tables, read a schema, run or explain a query, compare schemas, export, statistics.

| Setting | Default | Description |
|---|---|---|
| `read_only` | `true` | Disables every write |
| `allowed_connections` | empty (all) | Comma-separated DBeaver connection IDs or names |
| `timeout` | `30000` | Query timeout, in ms |
| `debug` | `false` | Debug logging |

## Plugin anatomy

```
.claude-plugin/marketplace.json      # the marketplace's plugin list
plugins/<plugin>/
├── .claude-plugin/plugin.json       # name, version, description, userConfig, mcpServers
├── agents/<name>.md                 # agents
├── commands/<name>.md               # commands    → /<plugin>:<name>
├── skills/<name>/SKILL.md           # skills      → /<plugin>:<name>
├── hooks/hooks.json                 # hooks, or {"modules": ["./register.tsx"]} for a mod
├── types/index.d.ts                 # a mod's types (declared by "types" in plugin.json)
└── tests/                           # a mod's tests (claude plugin test)
plugins-src/<plugin>/                # sources to build before publishing (skill-video's studio, skill-immo's dashboard)
```

Naming: `<type>-<domain>`.

| Prefix | Type | Files |
|---|---|---|
| `mod-` | mod | `hooks/hooks.json` → `{"modules": [...]}` |
| `hook-` | hook | `hooks/hooks.json` |
| `agent-` | agent | `agents/*.md` |
| `command-` | command | `commands/*.md` |
| `skill-` | skill | `skills/<name>/SKILL.md` |
| none | MCP server | `mcpServers` in `plugin.json` |

For a future theme, output style, monitor or executable: `theme-*` (`themes/*.json`), `output-style-*` (`output-styles/*.md`), `monitor-*` (`monitors/monitors.json`) or `bin/` in the plugin concerned.

**Marketplace entry**: `{"name": "<plugin>", "source": "./plugins/<plugin>", "description": "…"}` in `.claude-plugin/marketplace.json`.

**Settings**: `userConfig` in `plugin.json` declares the settings asked at install time and editable in `/config`. A `"sensitive": true` setting goes to the Keychain. They are read through `${user_config.<key>}`. The commands a skill runs don't see them: a `SessionStart` hook gets each one as `$CLAUDE_PLUGIN_OPTION_<KEY>` and writes it to `$CLAUDE_ENV_FILE`, which every later Bash command of the session loads (`skill-video`'s ElevenLabs key, `skill-immo`'s Stream Estate key).

**Paths**: `${CLAUDE_PLUGIN_ROOT}` is the plugin's folder (replaced on every update), `$CLAUDE_PLUGIN_DATA` its data folder (kept), `${CLAUDE_SKILL_DIR}` a skill's folder.

## Development

- Plugins installed from the marketplace are **copied** to `~/.claude/plugins/cache/pabrisson/<plugin>/<version>/`. After a change, bump `version` in `plugins/<plugin>/.claude-plugin/plugin.json`, push to `main`, then run `claude plugin marketplace update pabrisson && claude plugin update <plugin>@pabrisson` and restart the session.
- Try a change without publishing it: `claude --plugin-dir plugins/<plugin>` (current session only, replaces the installed version of the same name).
- Validate: `claude plugin validate .` (marketplace) or `claude plugin validate plugins/<plugin>`.
- Test a mod: `claude plugin test plugins/mod-hud`.
- `skill-video` studio: after changing the studio, run `npm run build` in `plugins-src/skill-video/studio/` before bumping the version (only the build, `engine/studio/dist/`, ships in the plugin).
- `skill-immo` dashboard: after changing it, run `npm run typecheck && npm run lint && npm run build` in `plugins-src/skill-immo/dashboard/` before bumping the version (only the build, `engine/dashboard/dist/`, ships in the plugin). `npm run dev` proxies `/api/` to a running `immo.mjs dashboard`.
- `skill-immo` engine: `node --test test/*.test.js` in `plugins/skill-immo/skills/property-search/engine/` runs offline, against recorded fixtures and a fake Stream Estate API v1. `IMMO_LIVE=1` adds the network smoke test on rue Paul Bert (Lyon 3e): the open data, and with `STREAM_ESTATE_API_KEY` (a v1 key) a free count and one listing (1 credit).
- Add a plugin: create `plugins/<type>-<domain>/.claude-plugin/plugin.json`, add its entry to `.claude-plugin/marketplace.json`, then add it to the [Catalog](#catalog) and the [Plugin documentation](#plugin-documentation).
