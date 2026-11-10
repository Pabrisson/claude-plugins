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
  - [skill-laravel](#skill-laravel) · [skill-video](#skill-video) · [skill-immo](#skill-immo) · [skill-osint](#skill-osint) · [skill-security](#skill-security)
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

### Other agents

The skills are plain `SKILL.md` folders, so any agent that loads skills runs them (Codex, Gemini CLI, Cursor, OpenCode…): copy or link `plugins/<plugin>/skills/<skill>/` into that agent's skills folder (skill-video's two skills side by side), and export the keys as environment variables (`STREAM_ESTATE_API_KEY`; `KIE_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MANAGEMENT_KEY`, `ELEVENLABS_API_KEY`), which Claude Code's plugin settings export by themselves. Their dashboards say « Agent » whatever the agent. Mods, hooks and commands are Claude Code's only.

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
| `/skill-video:media-generator` | [`skill-video`](#skill-video) | `studio \| setup \| credits \| <what to generate, with files> \| <a prompt copied from the dashboard>` | Generates and edits images, videos, voices, music and sounds through model routers (Kie.ai or OpenRouter: ElevenLabs, Suno, Lyria among their models), in a local dashboard or from prompts, every cost shown first |
| `/skill-immo:property-search` | [`skill-immo`](#skill-immo) | `setup \| <adresse, rue ou quartier> [type] [critères] \| add <url \| texte> \| refresh \| alerte … \| dashboard \| apply this feedback …` | Finds property for sale in France (flats, houses, plots, parkings, premises) around an address, a street or a neighborhood, weighs each against the real sales of its type, its building, its neighborhood, the rent and the buyer's budget, writes offer letters, in a local dashboard |
| `/skill-osint:investigation` | [`skill-osint`](#skill-osint) | `<domain, URL, email, phone number or IP> [question] \| <image or video path> [question] \| resume <case> \| refresh <case> \| dashboard [<case>] \| setup [geoint] \| <a prompt copied from the dashboard>` | Investigates a domain or a website as an OSINT case, an Obsidian vault shown live in a local dashboard: archived sources, graded clues, hypotheses with an ACH matrix, a red team, one answer with its confidence, refresh and pivots |
| `/skill-security:security-audit` | [`skill-security`](#skill-security) | `<question \| path \| audit request> [output folder]` | Answers security questions and reviews code, or runs a full six-phase audit whose findings are each checked by a separate agent |

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

`claude plugin install skill-video@pabrisson` — runs on macOS, Linux and Windows; requires Node ≥ 22, `ffmpeg`/`ffprobe`, Google Chrome, `uv`; transcription by Whisper (mlx-whisper on Apple Silicon, faster-whisper on the CPU elsewhere, slower) or ElevenLabs. The skill runs `doctor` at the start of each conversation and gives the install command for anything missing.

Your agent becomes a video editor for any genre: one or several rushes (files or URLs) plus B-roll become a short, a long YouTube video, an interview, a tutorial, a montage on music or a brand film, with graphics that carry the video or serve the footage; or a brief becomes a motion-design video with no footage.

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
- **Sound effects**: a catalog of 18 ready-made kinds (whoosh, riser, impact, pop, click, tick, chime…) for the common events, and one library per projects folder (`.sound/`) that all its videos play; a video's `assets/sound/` overrides it. The catalog is a base, not a limit: the agent designs every other sound the video needs, in its `sound.py` or as a sound of the project's own in the library. `sounds` lists what a video's cues need and what is missing, `sfx` makes only that: synthesized by the kit (`--local`: three takes each, designed after measures of ElevenLabs' effects: stereo width, short dry tails, each kind in its own band). A project's own designs and sounds live in `.sound/sfx.py`, under any name; an effect generated by media-generator joins the library with `sfx <kind> --from <file>`.
- **Git**: `init` writes the projects folder's `.gitignore` when there is none, which keeps the rushes, the music and the effects and leaves out what the engine makes again; `doctor` warns when a `.gitignore` would leave one of them out.
- **Studio**: local review on `127.0.0.1`, from port 41187, one server per projects folder, open from the start of each video: until the first version it shows what is being done (the agent's steps, the engine's, the renders' progress) and reloads by itself on the video. Feedback goes back to the agent as a prompt to paste. The Transcript tab's download menu gives the version's raw transcript (.txt) and its subtitles (.srt, .vtt).
- **Folders**: the current folder (or `$VIDEO_EDITOR_DIR`) holds one folder per video (`<slug>/`), the project's style (`.style/`) and its own rule packs (`.rules/`).
- **Learning**: stated preferences go into the style (`style set`, `style note`) or into the active pack's personal lines (`.rules/<name>.md` with `extends: <name>`).
- **Generation** (optional, with one of media-generator's keys): what the video needs that a model makes (a transcript, a voice-over for a video told rather than shown, the music, the sound effects, images, clips) goes through media-generator, into the video's folder (`--out`), in no workspace and with no dashboard. Each new video asks only about the media it needs, the local way first and each generated option with its estimate; that yes covers those generations, and any new or dearer one later is estimated and asked again. video-editor names none of media-generator's tools: it searches them, so a new one is usable at once. The engine takes the files in: `voice <file>` (a voice-over becomes the source, then transcribed), `prepare --words <words.json>` (a generated transcript instead of Whisper's), `sfx <kind> --from <file>` (an effect into the library). The generations are kept like media-generator's own in the projects folder (`media/`, `ledger.jsonl`). What a generation may not make (permission, plan, credits) falls back to the local way.
- **First runs**: the first transcription downloads the Whisper model (~1.5 GB), the first render installs `playwright-core`.

The ElevenLabs key (media-generator's, for video-editor too) needs these permissions (as ElevenLabs names them in its API and its errors), and a restricted key only those used:

| Permission | Used by |
|---|---|
| `voices_read` | `voices`: the voices offered for a voice-over or Change voice |
| `text_to_speech` | Voice and dialogues, video-editor's voice-overs |
| `models_read` | media-generator's list of ElevenLabs voice models (without it, the engine's copy of the list) |
| `speech_to_text` | Transcribe, video-editor's generated transcripts |
| `music_generation` | Eleven Music, on a paid plan only (the Music API refuses free accounts) |
| `sound_generation` | the sound effects |
| `user_read` | `credits`: the credits left on the account |
| `speech_to_speech` | Change voice |
| `voices_write` | `voice-clone`: a voice cloned from recordings, a voice of the Library put on the account |
| `dubbing_write`, `dubbing_read` | Translate |
| `audio_isolation` | Isolate voice |

A request the key may not make is refused at no cost: the agent relays ElevenLabs' message, and in a video the music and the effects fall back to the kit, the transcript to Whisper.

#### media-generator

The plugin's second skill: a local, Higgsfield-like workshop to generate and edit images, videos, voices, music and sounds with AI models, from its dashboard or from a prompt to your agent, on macOS, Linux and Windows (`doctor` gives each missing tool's install command for the OS: brew, apt or its download page, winget). The models sit behind a router, one active at a time and picked in Settings › Router, Kie.ai by default, whatever keys are set: OpenRouter (one key for Google, OpenAI, ByteDance, Kling, Black Forest Labs, Runway, ElevenLabs…) or Kie.ai (one key too, billed in credits, often cheaper; Seedance 2.5 edits a video there in 1080p, Kling 3.0 goes to 4K, plus Kling 4.0, Veo 3.1 Lite and Quality, Topaz, OmniHuman…), another router being one more file in the engine. ElevenLabs never goes through a router while its key is set: its voice models (Eleven v4 by default, v3, Multilingual v2, Flash, Turbo), with dialogues on v4 and v3, audio tags and every voice setting, come straight from its API, and the voice change and dubbing go through video-editor's engine. Without its key, the routers' ElevenLabs voices stand in (Eleven v4, v3, Multilingual v2, Flash, Turbo on OpenRouter; Eleven v3 Dialogue, Multilingual v2, Turbo 2.5 on Kie, its 67 voices with their samples); Isolate voice always goes to ElevenLabs' Voice Isolator, whichever router (Kie discontinued its own). Suno comes by Kie (music, sounds, extend, cover, vocals, instrumental, section, mashup, stems, WAV, timed lyrics, music video, MIDI, singers) and Lyria by OpenRouter (songs). Every model shows all it can do: its own settings in an Options block (negative prompt, prompt rewrite, web search, last frame, file format, palette, temperature…, each model those its API lists, the others left out with their reason and checked by the live tests), and editors for Kling's shots, the middle frames of Kling 4.0 and Grok, Grok's loop, OmniHuman's mask of who speaks, Kling 4.0's voices of the Library, Seedance 2.5's draft then its final, and Gemini's two-voice dialogues.

| Arguments | Mode |
|---|---|
| `studio` | Opens the dashboard (Image, Video, Audio, Library, Credits, Settings) |
| `setup` | The confirmation thresholds, monthly caps, ElevenLabs plan and default models |
| `credits` | The balances (OpenRouter in USD, Kie in credits and USD, ElevenLabs in credits) and this month's spending |
| `<what to generate, with files>` | A generation: the tool and model, the price, the user's yes, then the file |
| `<a prompt copied from the dashboard>` | « Copy prompt »: the agent writes the best prompt for the chosen model into the composer, without generating; « Send to edit »: the file goes to video-editor |
| « remplis le composer » | The agent fills the open dashboard's composer as you watch (tool, model, fields, files, settings, its words typed in) and says its price; on your yes it submits it: the page clicks Generate on what the composer holds, your changes kept, within that price |

- **Tools, not pages**: Image and Video have a Create / Edit mode and a searchable tool picker. Image: custom (your own prompt, with an optional style), cinematic camera, references (character, outfit, object, location, pose), product shot, restyle, relight, inpaint, upscale, face swap, character swap, expand, new angle, edit text, remove background. Video: custom (an optional style too), cinematic camera, animate, first & last frame, camera moves (dolly zoom, crash zoom, earth zoom out, FPV drone, orbit, handheld, static), VFX (fire, disintegration, freeze, metal, explosion), talking avatar, custom edit with a sketch, extend (sequel or prequel), restyle, upscale, relight, recolor, object swap, face swap, inpaint, clean up, and done locally for free: reframe, remove background (transparent WebM and ProRes 4444, or a flat color), depth map, FPS boost (30 to 120 fps, or a ×2 / ×4 slow motion) and SDR to HDR (HDR10). Audio has the same Create / Edit mode: voice (a preset or cloned voice, a dialogue), singer (Suno sings a short song in the voice described, its voice then taken apart; « Make a singer » keeps it), change voice, translate (no lip-sync), music (describe it, or write its title, style and lyrics; Suno writes lyrics and boosts a style), sound effect; extend music, cover, add vocals, add instrumental, replace section, mashup, stems, isolate voice; a Suno song's viewer adds its WAV, timed lyrics, a music video, MIDI and a singer of the Library, and « All in WAV » converts every track of a result at once (a song's takes, a Stems' tracks), its price shown first. Video also has speech to video (an image moved by a voice or a song) and lip sync (Volcengine, Seedance 2.0, or a talking head from a frame of the video). Each tool is an entry in `engine/tools/<kind>.json`: a template filled from its fields, its inputs, its recommended models.
- **Editors** (after Higgsfield's): **cinematic camera** (image and video) sets a camera body, lens, focal length and aperture in searchable selects, grouped, a line on each, then shot size, angle, lighting, grade, era and genre, with some 25 setups by genre (drama, action, genre, commercial, documentary and vintage…) in a searchable list that fills them at once; the video one adds camera moves in order (dolly in, then pan left…), the pacing, and an optional first and last frame. **Relight** places one to three lights around the subject on a stage, dragged or set with six quick directions, each with its softness, brightness and color, or a preset, or the light described in words; the image presets are photo lighting (softbox, Rembrandt, butterfly, split, clamshell, rim, golden hour, window, overcast, noon sun, product top light, neon, moonlight, candlelight, silhouette), the video ones film light (golden hour, window, silhouette, contre-jour, practicals, overhead, soft cross, moonlight, neon). **Inpaint** (image and video), **object swap** and **clean up** paint a mask (brush, eraser, lasso, brush size, undo, invert; on a frame picked along the video), « Put there » written in the same dialog; an image inpaint keeps the painted area in black and white locally, never sent, and lays the model's result back on the original inside it, so the rest keeps its pixels. A video sent to Seedance (video object swap, face swap, inpaint) goes to Seedance 2.0 Mini, 4 s or longer (Seedance 2.5, offered among the other models, edits no video until OpenRouter accepts its duration -1): it remakes the shot at the source's length, so a painted area says what changes more than exactly where. **Keyframe** (Aleph 2): Object swap, Face swap and video Inpaint, and Clean up, Custom edit, Restyle, Relight and Recolor when Aleph 2 is picked, first edit one frame as an image (« Swap on the frame », Seedream 5.0 Flash, about $0.02; Redo until it is right), then « Apply to the shot » carries it through the whole video ($0.28 a second, $1.40 at least): the video is kept, only the subject changes, characters included. **New angle** drags a camera around the subject and up or down, closer or farther, or takes a quick angle. **Recolor** sets a grade from a list, warmer or cooler, saturation, contrast, exposure, and new colors for up to three items. **Object swap**, **character swap**, **face swap** (video) and the inpaints take an Element of the Library in a field of their own. **Expand** opens a frame to drag wider or taller, its picture slid inside, with ratios and margins typed. **Extend** picks its side on cards showing the frame it hooks on, its added length, a timeline of the result and a seamless or new-shot join. **Restyle** (image and video, after Higgsfield's Genjutsu) redraws the source in a style, what is in it, its motion and framing kept: a gallery of 24 presets by group (2D animation, 3D, handmade, painting & illustration, pixel & retro), searchable, each card painted from its palette until you have a result in that style, which then shows on it; and « Yours », the styles of the Library. Custom takes a style too, optional. Every prompt shows read-only what the tool builds, with a box of your own words added to it; a **batch** of 1 to 4 runs the same generation that many times, one result and one cost each, the button showing the total.
- **References**: most edit tools take optional reference images beside their source (Restyle's characters, the light to match, what to paint, other views, the lettering, what lies beyond the frame, several photos of a face, a new object from several sides), the prompt naming each by its place. Each input of several counts against what the chosen model takes (« 2 / 13 », a Library style's images included); past it, the files left out are said, the count turns red and Generate asks to remove some. The video models' counts come from their providers' docs (null when unknown: Kling 3.0, Wan 2.6); a video with a first or last frame takes none, as OpenRouter keeps the frames and drops the references.
- **The form follows the model**: durations, resolutions, ratios, frames, sound and references come from the engine's own list of the router's models, `engine/providers/openrouter-models.json`, normalized (resolutions low to high, ratios tall to wide, durations in seconds) and kept by hand: a model is fixed there (measured prices, references, minimum sizes). The models OpenRouter adds to its catalog join it by themselves, read (free) at each start of the dashboard's server and once a day, or on Settings › Router › « Update the list », which previews them (lab, what each takes, price at its cheapest settings); they show « New » among the other models of the tools that create, priced as OpenRouter lists them, their reference count unknown; a new video model with no length of its own counts as an edit model and stays out of the create tools. Kie.ai has its own list, `engine/providers/kie-models.json`, each model read from its page of Kie's docs (its own resolutions, durations, inputs, never OpenRouter's), a tool's list for Kie in its `kie` key where it differs; the models Kie adds join it from its docs, priced by `engine/providers/kie-catalog-prices.json` (Kie's price rows name no model: each is matched there by hand, checked against Kie's list by the free live test; one Kie adds later stays unpriced until it is), and the estimates come from Kie's public price API. **Rate limits**: Kie takes 20 new generations every 10 s for the account, the next ones wait their turn and a 429 is retried; OpenRouter has no cap on paid models, a model's own 429 is retried after the time it asks.
- **Costs**: every paying button shows its estimate, in USD (Kie's credits beside), ElevenLabs in credits, plus their USD once the plan is chosen in Settings (Starter, Creator, Pro, Scale, Business). Settings save themselves at each change (a « Settings saved » toast), an amount turned on only once it is typed. Settings › Development turns on a developer mode (`setup set developer.on=on|off`; unset, on for a server started on fake APIs: `OPENROUTER_BASE`, `ELEVENLABS_BASE`, `KIE_BASE`…): it copies a prompt for your agent that checks every model of both routers, Kie.ai and OpenRouter, against its docs and wires what each takes (omni references, edits, avatars, shots, elements…) into each router's model list and the tools; on a server started on fake APIs it also shows the header's « Fake API » switch, the fakes turned on with it (off: the real APIs, the switch hidden). The header shows the active router's balance and ElevenLabs' credits (hidden on the fake APIs, their amounts made up); the Credits page a card per router and one for ElevenLabs (balance, spend, a chart by medium, the cap's gauge, Top up) and the ledger with each action's router. The agent asks before every spend (`--spend`, exit code 2 otherwise). Confirmation thresholds and monthly caps per provider, unset by default. The real cost of each action goes to `ledger.jsonl`, shown in the Credits page. A 402 can also come from videos still running: OpenRouter holds their price until they end.
- **Elements**: the Library's first tab keeps what comes back from one prompt to the next, two images at least each (« Open <References tool> » in the New element dialog makes the missing view; the agent makes it itself), sent on Kling (Kie) as Kling's own named elements; each has a type that tells the model what its images are: character, outfit, object, location, pose, brand (a logo kept exact, its colors and typeface), voice (1 to 3 clips of speech) and singer (1 to 3 sung clips, Music's singer once Suno has it). Typing `@` in any image or video prompt opens them, filtered as you type, the highlighted one shown large; each one cited shows as a badge in the words, its images counted against what the model takes, and the prompt names each by what it is and where its images are (« Lulu (the character in images 2 to 3, …) »). A voice is picked in Audio › Voice (« Your voices »), and put on the ElevenLabs account for Change voice; a singer (made by the Singer tool, from a song, or one's own singing, cleaned by the Voice Isolator, then its phrase sung in the browser for Suno) is picked in the Singer field of Music, Extend, Cover, Mashup and Replace section, a searchable list with its cover and its clip to hear. Its dialog ticks the workspaces it is linked to (one whose generations cite it stays ticked). New elements come from files or the library, by hand or by the agent (« Ask Agent », or `media.mjs elements add <name> <files…> --type character --words "…"`); « Make an element » on a result starts one.
- **References tools** (Image › Create): character, outfit, object, location and pose sheets (a turnaround and a face close-up, front and back with details, six views, a wide shot and coverage, a pose on a faceless mannequin), from photos or words. They only make images in your results: each sheet is its own job at its own ratio, the first one sets the look and the others follow it, and a remix redoes one sheet alone.
- **Styles**: the Library has three tabs, Elements, Visuals (visual styles) and Sounds (sound styles) (every chip of the dashboard carries its icon). Visual styles shows the 82 presets (2D animation, 3D, handmade, painting and illustration, pixel and retro, photographic with 29 film, print and camera looks, graphic), each with a sample image of its own scene made by Nano Banana Pro, and your own in one gallery, by group and searchable; one opens to restyle an image or a video or create with it, and yours to change its images and words. A style of your own comes from 1 to 5 images of a look and a few words on it, uploaded or picked in the library (`media.mjs styles add <name> <images…> --words "…"` from the agent). Picked in Restyle or Custom, its images go with the request as the last references and the prompt names them: the model copies their medium, palette, line and texture, never their subject. In Custom image, Recraft V4 Styles (and Pro) is made for such a style; it makes a new image rather than keeping a source, so Restyle keeps its own models.
- **Sound styles**: 47 music styles (pop, electronic, hip-hop, rock, metal and its 16 subgenres, acoustic and jazz, cinematic and game, content), 18 voice deliveries (narration, energy, soft, character) and 15 sound-effect styles (realistic, cinematic, stylized), each with a sample to play from its card (in the picker, the Library and beside the chosen style), filtered by what they are for, and your own: a name, its family and a few words (`media.mjs styles add <name> --for music|voice|sound --words "…"`). Each audio tool picks one in a style row like the image tools': Music (Write sends it as Suno's style, Describe after the description), Singer, Extend, Cover, Add vocals, Add instrumental, Replace section, Mashup, Voice's « How it sounds » (on ElevenLabs v3 and v4, which take no such words, a preset goes as its audio tags before the text) and Sound effect (after its words). A style opens to Make music, Cover, Extend, Speak with it or Make a sound, and plays the last result made in it.
- **Workspaces**: a project's media, Elements and timeline, on the Workspace page above the Library; « Default workspace » is there from the start, empty. The current one shows beside the folder in the header, where it switches: every new generation (the dashboard's, the agent's, a dropped file) and every new Element joins it (New element picks another, or none), the viewer's « Add to workspace » puts any result in others, and every asset picker shows its results first, with a search and a select for another workspace or the whole library. The spaces' results and Credits filter on it; the Workspace page and the Library's Elements list the workspaces, « All workspaces » first, the current one picked on each arrival (on the Workspace page a click on another makes it the current one, « All workspaces » shows every result without changing it). Two views: **Assets** (its media, filtered by medium, tool, provider and favorites; its Elements are in the Library) and **Timeline**, an editing table across the page under its bin and its preview, its height dragged from the bar between. The main track V1 holds the shots end to end, numbered #1, #2…: a shot dragged into another cut takes its place, the others making room; the video tracks above overlay it, the audio tracks mix, a clip there staying where it is put and pushing the ones it would cover. Clips show their frames or their waveform; they move, trim (snapping to the others and the playhead), split (S), duplicate (⌘D), mute or hide per track, take a volume, and right-click for the same; ↑ ↓ jump between cuts, ⌘ and the wheel zoom, ⌘Z undoes; a drag from the bin shows where it lands, below the last track it makes a new one. The bin filters by medium, then by that medium's own filters only (none under All): ratio and resolution for videos and images (measured once from the files), type (voice, music, sound effect, imported) and file format (MP3, WAV…) for sounds, each sound named by its words or else its file (a WAV, a stem); another medium starts its filters afresh, and every asset picker filters the same way. A ✦ on a cut makes a **Bridge shot** (First & last frame, Cinematic camera or Custom from the last frame before to the first after, laid in the cut once done). A clip's **Generate** menu (right-click or the toolbar) lists every tool that takes it, sent as it is cut: « Edit this shot / image / sound » (Restyle, Upscale, Relight, Inpaint, Face swap, Reframe, FPS boost, Change voice, Translate…, the result in its place at its own length), « From the frame at the playhead » (Animate, camera moves, VFX: what follows that frame replaced, seamless; its last frame makes a next shot after it), « Animate this image » for a still; **Extend after / before** make a shot of their own beside it; **Freeze frame** (free) lays a 2 s still of the frame at the playhead; a talking avatar says the voice under its shot, in sync; a clip not in the edit's format shows a badge that fits it (Reframe, free, for a video, Expand for a still); **Voice here** lays a new voice at the playhead. **Remix** and **Swap take** come back in its place; a result on the timeline shows its place there (« #2 ») instead of « Add to timeline ». Two windows on one timeline never write over each other. « Download » gives a .zip of its files by medium and its Elements, « With the edit » adds `timeline.json` and `EDIT.md` (the edit in words, nothing rendered); « Copy prompt for video-editor » (on Timeline) copies the exact edit (each clip's times, source range and sound). The agent: `media.mjs workspaces [new|use|add|drop|show|remove]`, `--workspace <slug>` on a generation or an Element.
- **Folder**: the current folder (or `$MEDIA_GENERATOR_DIR`) holds `media/` (one folder per generation, inputs copied in for a remix), `elements/`, `styles/`, `workspaces/`, `ledger.jsonl` and `settings.json`, kept by git; `.cache/` and `.trash/` are ignored (the engine writes the `.gitignore`). `--out <folder>` on a generation puts its files in another folder too (hard links, named after the job), in no workspace and with no dashboard: the way video-editor generates into a video's folder.
- **Dashboard**: on `127.0.0.1` from port 41287, one per folder; it stops once every agent app that opened it has quit (Claude Desktop or Claude Code itself, not one of its sessions). In English, or in French from Settings › Language (this browser; the prompts sent to the models stay as written). A generation started there runs in its own process and survives a closed page. Each space takes its medium's color; results show at their own shape, grouped by day, and a click opens a viewer: the model's logo and lab, the cost, the file's size, length and weight, how long it took, the prompt, the settings, the inputs by role, the next steps as a list, download (its arrow gives every file of the result in one .zip: a Stems' tracks, a song's takes and covers), ← →. Its « Compare » sets the result (A) against a B you choose: one of the result's inputs (before and after), another result of the same medium, or a file from your computer; images and videos with a slider or side by side, at their real sizes; videos and sounds play as one (the shorter waits on its last frame), `A` and `B` switching the sound you hear at the same moment. `⌘↵` generates, the ⋮ menu beside it copies the prompt for the agent or clears the composer (the tool and model kept, « Undo » in its toast), `⌘V` or a drop puts a file in the tool (a video sent opens « Edit reference »: cut it and crop it freely into a new file, the original stays; the scissors on its tile reopen it); dropped anywhere else on the page, an image, a video or a sound joins the current workspace as « Imported », free (a video through « Edit reference » first), and the page stays in the URL (`#video`, `#credits`…). The tool and model pickers open beside the composer, searchable: tools by group, each with its last result and price; models filtered by length, resolution, sound, last frame or seed, each with its lab's logo and its price on the current settings.
- **Keys**: `OpenRouter API key` and the optional `OpenRouter management key` (the account's balance), asked when the plugin is enabled or with `/plugin configure skill-video@pabrisson`, then a session restart; the ElevenLabs key above.
- **Videos and voices sent to OpenRouter** (video edits, upscale, talking avatar): OpenRouter takes them by HTTPS only, never inlined. The engine serves the file from the machine at a random address through a Cloudflare quick tunnel (`cloudflared`: brew, winget or its release page, no account), opened when the job is submitted (about 20 s, until its name answers on the public DNS) and closed when it ends. `doctor` says when cloudflared is missing; everything else works without it. Images are inlined.

Everything stays on the machine, except what the user said yes to generate: media-generator sends its prompt and the files it takes to its router or ElevenLabs.

### `skill-immo`

`claude plugin install skill-immo@pabrisson` — runs on macOS, Linux and Windows; requires Node ≥ 22. The skill runs `doctor` once per conversation: Node, the dashboard build, the Stream Estate key (`stream-estate: on/off`) and the credits spent over 30 days.

Your agent helps buy property in France: a flat, a house, a plot, a parking or a box, a shop or an office. A search starts from an address, a street or a neighborhood, for one or several types:
- the zone is a polygon: a band along the whole street that follows its bends (its line in IGN's BD TOPO, 300 m on each side by default), a circle around an address, the commune or arrondissement, its IRIS, or an outline you draw on the dashboard's map (60 corners at most, what Stream Estate takes);
- each search has a mode, **Stream Estate** (listings from every portal, paid) or **OpenData** (open data and listings the agent finds, free);
- the engine weighs every listing against the real sales of its type (DVF: a house against houses, a parking on its price), its building, its neighborhood, the rent of the same home (carte des loyers) and the buyer's budget;
- each listing gets a review (strong points, points to watch, questions to ask, each with its source) and a score out of 100 weighted by the buyer's priorities;
- each listing keeps its conversation with the agency or the seller (replies pasted in the dossier, calls summed up): the agent reads it, then writes the offers, the replies, the reminders, the questions, the requests for documents and the visit requests. It gives the text and never sends anything;
- a local dashboard (`http://127.0.0.1:41287/<search>/`, dark by default) shows it all: « Annonces », the map and the cards (the zone stands out, « Modifier la zone » drags its corners or redraws it, then the agent applies it; the layers docked on its left, the listings on its right, both a bit see-through; a search of several types filters them, map and cards together), « Prospection », a kanban by status (« Écarté » folded), a list to filter and sort, a dossier per listing (with the asking price's history in a chart when it changed, against the sold price of the market for its surface), market, comparison, alerts, follow-up and API costs. Each status tints its cards, the same in every tab, and a star marks the favorites (in the dossier or on a card; « Favoris » filters them);
- the « Prospection » tab has the same layout: a search for a street or a town above the layers, « Type de bien » (flats, houses, the search's others: its DPE, audits and listings), the map, its figures on the right. Wherever the map stops (zoom 14 or closer), it loads the IRIS on screen, free, and colors them by the odds that a home goes on sale within 12 months (the homes DVF sold a year over the census's homes), or by the sales a year that successions and separations make likely (people living alone by age, couples, owners' share, France's rates), by their vacant homes or their sold price per m². Its IRIS card adds the second homes, the homes built before 1946, heated with oil, and whose household moved in 10 years ago or more. It adds the recent DPE, energy audits and building permits, and shows the search's listings already loaded. Its « Estimations » hide all the rest and give each address of the map, in the search's zone or not, its odds of going on sale soon, red to green: its DPE, energy audits and permits of the last 12 months together, a DPE weighed by its quarter's sales against its tenants moving out (a G more, since it can no longer be let), the DPE of one day counted once (a whole building diagnosed, a home diagnosed twice), all fading with their age; in the zone, a DPE that already has its listing does not count. The addresses ranked on the right; one clicked there or on the map opens its block: the quarter's figures behind the chances, then each signal with its chance, a home's value at its quarter's median price and « Chercher l'annonce ». Only public figures per IRIS and commune: no person is identified;
- its « DPE récents » layer shows the DPE of the last 3, 6 or 12 months in their class's color, and rings those of the zone no listing matches: a DPE comes before a sale, so the home may soon be for sale. A click puts « Chercher l'annonce » in the prompt for the agent; `refresh` counts the new ones and adds them to the news;
- its « Audits énergétiques » layer shows ADEME's energy audits of the last 3, 6 or 12 months as squares in their class's color with a clipboard: an audit is due before selling a house or a whole building rated E, F or G, so it often comes before a sale (« Chercher l'annonce » too). Its « Permis » layer shows Sitadel's building, demolition and plot permits authorised in the last 3, 6 or 12 months as discs with a building, a hammer or a plot, placed at their address (never the applicant; Sitadel comes about 6 months late for homes built, 1 for the others). Both have their list in the column, and their own alerts;
- the market tab follows the price trend and the number of sales, what the budget buys (prices by rooms, the spread of the sold prices), the listings' follow-up week by week, the prices street by street, and the commune's context (DPE classes of the zone, property tax rate, homes authorised);
- while the dashboard server runs, it watches every search, free: at its start, then as « Réglages » says (off, 30 min, 1 h, 6 h by default, 12 h, 24 h; the header counts down to the next one and pauses or resumes it, the period kept, « Vérifier maintenant » runs one), the zone's new DPE that no listing matches, its new energy audits and building permits, the same at the places of your alerts, and, in Stream Estate mode, the counts of the listings not fetched yet and of the fetched ones changed on the portals since the last refresh. Those your alerts take get a desktop notification (macOS: a click opens the search, with `terminal-notifier`; Linux `notify-send`; Windows a toast; « Réglages »: off, sound, quiet hours). The bell counts what is not read and opens the latest. « Suivi » shows the API's counts in a bar (« Récupérer », « Actualiser », through the credits dialog), then the news day by day, unread or all, by kind, those of one watch folded into one row, each with its alerts; « Carte » shows a DPE on the « Prospection » map, « Chercher l'annonce » asks the agent, opening one marks it read; on its right the watch, your alerts and your selection by status;
- the « Alertes » tab picks what reaches « Suivi », the bell and the notifications (`<search>/alerts.json`, free, local). The default alerts keep the zone's follow-up as it was (new DPE within the criteria, new listings, price drops and rises, statuses), each on until turned off. Your own take one event and conditions all true (a street, a DPE class, a surface, a price, a drop of 5 % or more, a favorite, your status…), from a blank or a model. A new DPE is watched anywhere in France — the zone, a street, around an address, a commune, shown with a globe — and the editor previews its DPE of the last 12 months (ADEME); the listings' events stay in the zone (a hexagon). Their news carry their name in « Suivi » and in the notification;
- « Réglages »: the watch's period, the API on or off for every search (off: the open data and the listings the agent finds), the automatic fetch (off by default: the watch refreshes the searches in Stream Estate mode within a monthly budget of credits you set), the Stream Estate account as its billing console (https://stream.estate/console/billing) shows it — the € deposited and the total requests (« API items returned »), asked at the dashboard's start when a key is set — less what the log spent since, with « J'ai rajouté … € » for a top-up and « Recaler sur la console », the credits (cap, price of a credit, most listings a fetch takes), the notifications, a news read once opened, how long the news are kept, the theme, the open data cache (its size, emptied once confirmed);
- « Coûts API »: the month against your cap; what the next fetch would cost per search, from the watch's counts; the forecast to the month's end at the pace of the last 30 days (when the cap would be reached); per search and month, each route's price, the last calls;
- the « Annonces » map's legend is clickable: a price level or a status (« Écarté »…) takes its listings off the map, or back;
- the dashboard starts nothing paid or new by itself: a new search, a wider zone, new listings (the header's « Annonces »: at the API and on the web, or on the web only) or a message go through the prompt it copies for the agent, and a bar offers « Recharger » once the agent or the watch has changed the search. A listing seen elsewhere (a shop window, a visit, a tip) is typed in « Ajouter » → « Ou saisir l'annonce à la main »: it joins the search at once, free, with its building data.

| Arguments | Mode |
|---|---|
| `setup` | The buyer's profile, kept on the machine (`.profile.json`): down payment, net income, rate, length, notary fees, key places (work, school…), price of a credit, monthly credit cap |
| `<adresse \| rue \| quartier> [type] [critères]` | New search: types, zone, real sales, rent, neighborhood, listings, then the dashboard |
| `add <url \| texte>` | Adds a listing: one WebFetch of the page, or the pasted text |
| `refresh [<slug>]` | What changed: new listings, price drops, offers, expiries (Stream Estate pays only for what changed) |
| `alerte …` | The search's alerts, as in the dashboard's « Alertes » tab: the agent lists, makes, changes or turns one off (« préviens-moi d'un nouveau DPE rue Garibaldi »). `alert delete` deletes a Stream Estate alert made by 1.6 or before (pushed to ntfy.sh) |
| `dashboard [<slug>]` | Reopens the dashboard |
| `apply this feedback …` | Applies the prompt copied from the dashboard: refine, widen (zone, criteria, types), a zone drawn on the map, analyse, compare, write a message, add, look for a DPE's listing, question |

**Open data** (free, no key): Géoplateforme geocoding and isochrones, geo-DVF sales of every type (5 years; none in Moselle, Bas-Rhin, Haut-Rhin), the carte des loyers, ADEME DPE (of an address, of a zone, and the zone's last 12 months) and energy audits, IGN's BD TOPO (a street's line), Sitadel's building permits, the DGFiP's property tax rates, Sitadel's homes authorised, Géorisques, the national condominium register, OSM Overpass, SSMSI crime, INSEE Filosofi income, IGN vector tiles, and for « Prospection » INSEE's census per IRIS (Melodi). When a data.gouv.fr MCP server is connected, the agent may use it for a dataset the engine does not cover. The answers are cached in the searches folder's `.cache/`. See `skills/property-search/references/data-sources.md`.

**Listings**:
- **With Stream Estate** (API v1, `api.stream.estate`; `stream_estate_api_key`, the plugin's secret, asked when the plugin is enabled or with `/plugin configure skill-immo@pabrisson`, kept in the Keychain): listings of every portal, with their price history, fees and agency. Also the zone's asking price per m² month by month, and the free counts of the dashboard server's watch. A listing counts as online when it is not expired and was updated within 90 days (the API leaves most of what left the portals unexpired). The API has no filter on the floor, the elevator or an outdoor space: those are sorted out once fetched.
- **Without it**: the agent finds listings with a web search (WebSearch) and reads one listing page at a time (WebFetch), or takes the text the user pastes. The portals' search pages are never scraped: their terms forbid it.

**Costs**: Stream Estate bills each item a call returns, 0.01 € pay as you go (the engine calls it a credit). A fetch costs 1 credit per listing returned, never one more than agreed, and a count (`itemsPerPage=0`) returns no item, so it is free (the server's watch counts that way). The asking prices and the alerts have no known price yet.
- Before every paid call, the agent, or the dashboard in a dialog, gives the estimate in credits and euros with what is left of the monthly cap, and waits for a yes (`--spend`). In Stream Estate mode, each paid button of the dashboard shows its credits in a badge: the listings a fetch would bring (up to the search's max), `≤ max` for a refresh (what changed is counted when it runs), `?` while a route's price is unknown.
- A route whose price is not measured yet says « coût inconnu » and asks too (`--accept-unknown`).
- The engine never goes over the monthly cap without the user's explicit agreement (`--force`).
- A 402 (no credits left) falls back to the assisted mode.
- The API v1 reports no cost: every call is logged in `.cache/api-usage.json` at its route's price for the items it returned. A price read off Stream Estate's console goes in with `costs set`.

**Git**: the first search writes the searches folder's `.gitignore`. Git keeps the searches, the listings with the user's statuses, notes and messages, and the credits log. It leaves out the cache, what the engine computes again, and the profile, which holds the income.

### `skill-osint`

`claude plugin install skill-osint@pabrisson` — runs on macOS, Linux and Windows; requires Node ≥ 22. The skill runs `doctor` once per conversation: Node, the dashboard build, git, the free services.

- **A case is an Obsidian vault** (one folder per case, in the folder the agent runs in): notes the user edits, a Journal with an id per action (`^j042`), a canvas graph. What the engine computes lives in `.osint/`. Open the folder in Obsidian, or follow the case live in the dashboard on `127.0.0.1:41387` (the next free port per folder).
- **The cycle**: a frame (question, purpose, `noisy`, a GDPR basis when a person is the subject), sources archived and hashed, Admiralty grading, entities and clues, hypotheses written with what would refute them, likelihood ratios capped by what a clue rests on, an ACH matrix, a red team, one answer with its confidence per level; then refresh (what changed), next actions and pivots to linked child cases.
- **Case types** are folders (`types/<type>/`). The first, `domain`, uses free sources without a key: RDAP, DNS, certificate transparency (crt.sh), the Wayback Machine, RIPEstat, Shodan InternetDB (free for non-commercial use), the home page and its legal notice.
- **Passive by default**: nothing is sent to the target. Reading the site itself (the `domain` home page and legal notice) is a noisy step: skipped with `noisy=never`, the user's yes with `noisy=ask`. A noisy probe needs the user's yes, and no password reset, SMTP probe or contact is ever made.
- **Git**: the first case writes the folder's `.gitignore`: git keeps the cases and leaves out the cache and the trash.
- **PDF export**: `export -p <slug> [--journal]` prints the case as an A4 PDF: the question and the frame, the report (the answer and the confidence of each level with its criteria), the hypotheses and the ACH matrix, the sources (URL, date, archive, SHA-256, Admiralty grade), the evidence as thumbnails with their hashes, and the Journal as an appendix with `--journal`. The file is `<case>/Exports/<case>-<date>.pdf` (`-2`, `-3`… the same day, never overwritten), kept by git, its SHA-256 in the Journal. It is printed by a Chromium-family browser found on the machine (Chrome, Chromium, Edge, then the Chromium of the GeoINT pack; `OSINT_BROWSER=<path>` forces one; `OSINT_PDF_TIMEOUT` sets the delay in milliseconds, 120 s by default): no npm dependency. The page it prints is a static print view (no script, a strict Content-Security-Policy: nothing but the case's own images loads) that the dashboard also serves at `http://127.0.0.1:41387/print/<slug>`; without a browser `export` exits 3 and « Print view » prints it from any browser. The dashboard's « Export PDF » and « Print view » buttons sit in the case header.

#### `geolocate-image`

- **What it does**: a photo, a video (file or link) or a Street View capture becomes a case. The gut call is written first, then GeoINT's first pass is imported (metadata, text read by OCR, the world prior of local models, the camera, detections, direct reverse search on Yandex and Baidu), street-level sweeps follow, then one answer with its radius, the true location and a scoreboard. The dashboard adds a map, an evidence gallery (tunnel for Lens, Bing, TinEye and « Paste results ») and a calibration tab.
- **The GeoINT pack**: cloned by `setup geoint` at commit `18543326` (about 6.8 GB of models plus the Python environments, under `$OSINT_DATA`). **StreetCLIP's weights are CC BY-NC 4.0: non-commercial use only.** No Gemini and no Google Vision: no key reaches the scripts, `compare.py` always runs `--no-check`, `net.js` refuses the hosts, and a test proves it.
- **Free services and their terms**: Nominatim (1 request a second at most, a real User-Agent, results cached), Open-Meteo (CC BY 4.0, free for non-commercial use without a key), Mapillary (an optional free token; the pinned GeoINT pack's `pano.py` puts it in a `curl` URL, visible in `ps` — see `references/setup.md`), the OpenFreeMap base map (© OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors), Cloudflare quick tunnels (no account).
- **Attributions**: [GeoINT](https://github.com/marouane53/GeoINT) (MIT, Copyright (c) 2026 GeoInt contributors and Oldcircle), which extends [geo-sleuth](https://github.com/Oldcircle/geo-sleuth) (MIT, Oldcircle); MegaLoc's MIT notice (Copyright (c) 2024 Gabriele Berton, Carlo Masone) stays in the pack's `scripts/_megaloc.py`; the pack's data (Wikipedia tables CC BY-SA 4.0, GeoNames `countries.json` CC BY 4.0); Open-Meteo (CC BY 4.0); the test and demo photo « Roman Temple of Évora 1.jpg » by Dudva (CC BY-SA 4.0, Wikimedia Commons).

#### `verify-media`

- **What it checks**: an image or a video (file or link) and what is said about it, on three levels: `origin` (its first appearance: every page found becomes a dated source on the timeline, the earliest dated is the candidate), `claim` (the caption against the evidence: place, date, event, with the weather and the sun of that day) and `integrity` (signs of editing or generation). Commands: `intake` (the original, key frames, yt-dlp), `meta` (exiftool EXIF, XMP, IPTC, embedded thumbnail; C2PA by c2patool), `first-seen` (pages dated by their own metadata, the post date the agent read and their first Wayback capture) and `direct` (Yandex and Baidu by direct upload, the GeoINT pack's `revimg.py`).
- **Signs are clues, never a verdict**: an AI marker, a C2PA manifest or a missing EXIF is a clue, and `integrity` never goes above medium unless a signed and valid C2PA manifest **of the original** says so (the engine refuses more at `conclude`).
- **`--unmasked`**: for this type only (it looks for exact copies), when the frame lets the image leave; the Journal says that people visible went out unmasked and to which engines. The dashboard's gallery offers « Open unmasked » with a confirmation.
- **Tools** (all optional, the missing one is named by `doctor` and the rest still works): exiftool (EXIF, XMP, IPTC, thumbnail), c2patool (C2PA), yt-dlp (videos by link), ffmpeg (key frames), cloudflared (Lens, Bing, TinEye by link), the GeoINT pack (direct Yandex and Baidu).
- **Attributions**: exiftool (Phil Harvey, Artistic License or GPL, same terms as Perl; run, never bundled); c2patool (Content Authenticity Initiative, MIT or Apache-2.0; run, never bundled); the C2PA reports of the tests come from [contentauth/example-assets](https://github.com/contentauth/example-assets) (MIT); the demo photo « Roman Temple of Évora 1.jpg » by Dudva (CC BY-SA 4.0, Wikimedia Commons), whose false caption in the demo is made up; Open-Meteo (CC BY 4.0, free for non-commercial use without a key).

#### `username`

- **What it does**: the public accounts that carry a username (or the profile URL that ends with it). WhatsMyName's list of sites is read with GET only (8 sites at once, one per host, 10 s each); sites that need a POST or a login, sites WhatsMyName marks broken, and the NSFW category (unless asked) are skipped. Maigret runs as an option through `uv` (`uv tool run maigret@0.6.6`, never with `--ai`, with no key in its environment). The Accounts table shows site, category, state, link and tool; a site that answers with a bot wall stays `unknown`, never « found ».
- **Candidate accounts, not identities**: the same name on two sites proves nothing. `same-person` is high only with two independent links (profiles that cite each other, the same avatar checked full size, the same unique email), medium for a consistent name, bio and avatar, low for the same username only. The subject is always a person: a legal basis is required; harassment and any minor are refused.
- **Licences and attributions**: **WhatsMyName** data, CC BY-SA 4.0, Copyright Micah Hoffman and contributors (https://github.com/WebBreacher/WhatsMyName), downloaded into `.cache/datasets/`, never bundled; the tests' reduced copy (`engine/test/fixtures/raw/WebBreacher/WhatsMyName/main/wmn-data.json`) keeps the file's licence and authors and stays under CC BY-SA 4.0. **Maigret** (soxoj, MIT), run through `uv`, never bundled. The tests use a fake `uv` (`OSINT_UV=test/fixtures/maigret/uv.mjs`).

#### `company-fr`

- **What it does**: a French company from its name, SIREN or SIRET, read without a key: Recherche d'entreprises (`recherche-entreprises.api.gouv.fr`, the open API of the Annuaire des Entreprises, 7 requests a second per IP) and BODACC (`bodacc-datadila.opendatasoft.com`, the DILA's legal notices). The case shows the identity (NAF, legal form, creation, state, finances), the establishments on the map (100 at most), the officers and their other companies with a level (high: same name and same month of birth; medium: same year; low: a namesake, left out of the graph), and the BODACC notices on the timeline (changes, insolvency proceedings, strike-offs, filed accounts; the 100 latest, a notice reduced to its first sentence). A name that matches several companies stops with their list: the user chooses.
- **People**: the officers are people, kept to their name, role and month and year of birth (never a day, a nationality or an address). The frame always has a person as subject; the type proposes the legal basis « Legitimate interest — public registry data », which the user may change.
- **Pivots**: from the SIREN a `domain` case reads, to the official website's domain, to an officer's other company. Refresh: state, head office, officers, new notices, the officers' new companies.
- **Licences and attributions**: Recherche d'entreprises (DINUM, from INSEE's Sirene and INPI's RNE, Licence Ouverte 2.0); BODACC (DILA, Licence Ouverte). Nothing is bundled; the tests and the demo use invented companies and officers (SIREN that pass the Luhn check and are absent from the registry), and records of the same shape for a large company.

#### `email`

- **What it does**: `email collect` reads, passively and for free: the address (Gmail's dots and +tags noted as aliases, role addresses such as contact@), the MX, SPF and DMARC of its domain and the provider they name, the [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) list (CC0), the public [Gravatar](https://docs.gravatar.com/) profile found by the SHA-256 of the address (API v3, about 100 profiles an hour without a key: name, place, company, verified accounts, avatar; the address itself never leaves), and the names of the breaches [XposedOrNot](https://xposedornot.com/) knows (names only, free for personal and low-volume use: 25 calls an hour and 100 a day, counted for the whole cases folder; this API takes the address itself in its URL). The frame always has a person as subject (a legal basis is required).
- **`email account-probe`** is noisy and runs only after the user's yes, each time (exit 2 without `--yes`, refused with `noisy=never`, never part of `refresh`): [Holehe](https://github.com/megadose/holehe) (GPLv3, unmaintained since 2024, run by `uv tool run holehe@latest`, never bundled) asks the sign-up forms of about 120 sites, always with `-NP` (never a password reset, which would email the target) and without `-C` (its CSV export crashes as soon as one site fails, holehe issue #330: the printed list is read instead); its hits are `inferred` clues.
- **Never the mail server**: the skill does not probe the address's mail server (SMTP `RCPT TO`, `VRFY`, a connection to the MX), and `net.js` refuses the ports 25, 465, 587 and 2525; a test proves it. Have I Been Pwned is not used: it has no free lookup by address.
- **Licences and attributions**: disposable-email-domains (CC0 1.0), downloaded into `.cache/datasets/`, never bundled; Holehe (GPLv3, megadose), run by `uv`, never bundled. The tests and the demo use fake APIs, a fake `uv` (`OSINT_UV=test/fixtures/holehe/uv.mjs`) and an invented address on the reserved domain `.example`.

#### `phone`

- **What it does**: `phone collect` reads a phone number passively and for free: its E.164 form, country and line type from [libphonenumber](https://github.com/google/libphonenumber)'s metadata (read without a dependency; a country code several territories share, as +1 or +44, goes to the territory whose own patterns match) and, in the French plan, the operator the ARCEP's register attributed the number's block to. That operator is the block's original holder, not always today's (numbers are ported): it is recorded as an `inferred` clue. It prints every way a page may write the number, which the agent searches the web for, in quotes; each page that shows it is recorded as a mention. A number written without its country code is read in the case's country (`--in country=GB`, France by default) and the clue says so.
- **Fiction blocks**: the ARCEP keeps 01 99 00, 02 61 91, 03 53 01, 04 65 71, 05 36 49 and 06 39 98 for works of fiction (decision 2019-0954): such a number reaches nobody, and the case says so.
- **Hard refusals**: never a call, a text or a presence check in a messaging app (WhatsApp, Telegram or Signal by number): no command offers them, `net.js` refuses `wa.me/<number>`, `t.me/+<number>` and `signal.me/#p/` links, even behind a redirection, and `source` refuses to record them; tests prove each one. No paid service either: no reverse directory that charges, no HLR or CNAM query.
- **Datasets**: downloaded and kept a week in `.cache/datasets/` of the working folder (`PhoneNumberMetadata.xml` about 1 MB, `MAJNUM.csv` about 1.2 MB, `identifiants_CE.csv` about 170 KB); a file whose columns changed is refused and the old copy stays; the ARCEP unreachable fails only that step.
- **Licences and attributions**: libphonenumber metadata (Apache-2.0, Google), downloaded, never bundled; the tests' reduced copy (`engine/test/fixtures/raw/google/libphonenumber/master/resources/PhoneNumberMetadata.xml`) keeps the licence header. ARCEP numbering register and electronic communications identifiers (Licence Ouverte / Open Licence, Etalab), downloaded, never bundled; the tests use extracts. The demo's number is the placeholder of an invented website theme, in a fiction block.

#### `ip`

- **What it does**: `ip collect` reads, for one IPv4 or IPv6 address, who holds the range (RDAP, RIPEstat `whois` and `abuse-contact-finder`), who announces it (RIPEstat `network-info` and `prefix-overview`), its reverse name (RIPEstat `reverse-dns-ip`, confirmed when the name resolves back), a coarse location (RIPEstat `maxmind-geo-lite`: always an inferred estimate, drawn as a 50 km circle around a city or 500 km around a country, never a street), what Shodan's own scans saw (Shodan InternetDB: ports, hostnames, CPE and CVE ids, noted and never tested; free for non-commercial use), whether the Tor Project lists it as an exit, and whether AWS, Google Cloud or Cloudflare publish it in their ranges (Azure has no stable list and is left out). A private, loopback, link-local or carrier-grade NAT address, a prefix, a port or a typo is refused before any request. Refresh replays InternetDB, the reverse name, the prefix and the Tor list; a step without change adds nothing.
- **Never the address itself**: no scan, no ping, no connection of any kind to the address under study, only registries and published lists; the frame is `noisy` and no step of this type is. A test proves it (a whole case and a refresh open no connection but to the fake APIs) and the type's code opens no socket. A residential address (a reverse or network name such as `dsl`, `pool`, `broadband`) is personal data: the case says so in an inferred clue and a warning asks the agent to review the frame (`person=true` and its legal basis) before going on.
- **Datasets**: the Tor bulk exit list (kept an hour) and the cloud range files (a day) are kept in `.cache/datasets/` of the working folder, one `doctor` line each; a download that is not a list (an error page) is refused and the old copy stays.
- **Licences and attributions**: Shodan InternetDB is free for non-commercial use. RIPEstat's data API is free and asks for a `sourceapp` (`skill-osint`). GeoLite2 data created by MaxMind, available from https://www.maxmind.com (through RIPEstat): check MaxMind's licence before any non-internal use. The Tor bulk exit list (check.torproject.org) and the range files of Amazon Web Services, Google and Cloudflare are published by their owners; nothing is bundled. The tests' fixtures hold real public registry records of 1.1.1.1 and 2606:4700:4700::1111 (APNIC, ARIN, RIPEstat, InternetDB) and invented ones on the documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).

#### `place`

- **What it does**: `place collect` starts from an address, coordinates (`48.8565, 2.352`, or as copied from a map, `48°51'23.4"N 2°21'07.2"E`) or the place a case was opened from, and reads, within 150 m: what OpenStreetMap maps there (the building that contains the point, the places with a name, a website or a phone, whose sites and phones become entities to pivot from), the ground images with their date and bearing (Mapillary with a free token, Panoramax, KartaView; only a thumbnail link and the photo's page are kept, never the picture), the companies registered near the point in France (Recherche d'entreprises; a sole trader is a person and is recorded only with a legal basis for people), and the imagery: in France, IGN orthophotos on the case's map (the current one and the national mosaics from 1950-1965 to 2021-2023, chosen in the map's Background menu); everywhere, links to Esri's Wayback viewer at the last release of each year. Geocoding uses Nominatim everywhere and the Géoplateforme (France's official address base) in France; when the two disagree, the case says so and keeps one point, never a midpoint. A city is not a place case: give an address or coordinates. A home is personal data: without `person: true` its own phone and site are not recorded and the agent is told to ask for the frame. Refresh replays the ground images, the companies and OpenStreetMap; the watch replays the first two only. Nobody at the place is ever contacted.
- **Licences and attributions**: OpenStreetMap data © OpenStreetMap contributors (ODbL), read through Nominatim (one request a second, its usage policy) and Overpass (one query at a time; its public endpoint is meant for tools run by people, so the watch never calls it). The Géoplateforme's geocoding and the IGN orthophotos: Licence Ouverte (IGN). Panoramax photos: each photo's own licence, shown with its author. Mapillary photos: CC BY-SA (Mapillary's terms), a free token (`/plugin configure skill-osint@pabrisson`). KartaView photos: see KartaView's terms (its API gives no licence). Esri World Imagery and Wayback: links to Esri's viewer only, no tile loaded (their terms outside ArcGIS are unclear). Nothing is bundled; the tests record real answers about a public building (the Hôtel de Ville of Paris, with one sole trader replaced by an invented one) and the demo uses an invented square.

<details><summary>GeoINT's MIT license</summary>

```
MIT License

Copyright (c) 2026 GeoInt contributors
Copyright (c) 2026 Oldcircle

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

#### `person`

- **What it does**: from a name and the identifiers the user already has (usernames, emails, phone numbers, domains, the employer, the town, one per line), `person plan` records each with the reason the purpose needs it (or drops it) and proposes one child case per identifier; the user chooses which to open. `person consolidate` reads the parent and the child cases and writes `Profile.md` (identifiers by kind, each with its case, source, confidence) and an Identifiers table. « The subject's » is a share computed from the likelihood ratios of the children's clues (`person lr`), capped by each clue's status. It aggregates only what the user gave: no new collection, and a link between two accounts is a sourced hypothesis, never a fact.
- **Hard refusals**: data of GDPR article 9 (health, religion or belief, sex life or orientation, political opinions, racial or ethnic origin, trade-union membership, genetic or biometric data), a street address, a request to find, contact or follow a private person (an ex, « where she lives »), a minor. The engine refuses them in `new`, `entity`, `clue`, `note` and `hyp`, and withholds them from a child type's collection (Journal `withheld`, never the value); `--yes`, a pivot, a refresh or the dashboard do not get around it. The limit: a word list in English and French, not a classifier; the capture of a page, the views and the snapshots keep what the page showed; Maigret keeps its own site labels (what it finds there is withheld).
- **Services**: none of its own (the libphonenumber metadata the `phone` type caches aside); its children call theirs.
- **Refresh**: each child's Refresh (without its noisy steps, said in the Journal), then `consolidate`.

#### Watch

A case can be watched every 6 h, 12 h, 24 h or 7 days (the case header's « Watch » switch and its period chips, or `osint.mjs watch -p <slug> --every 24h`). The dashboard server then runs the case type's free engine refresh steps on that period — only the steps a type declares `watch: true`, never a noisy step, one that sends an image or one that costs, never the agent's own steps; `domain`'s watch never reads the site itself; a pass never has the user's yes — one case at a time, each host's limits kept (XposedOrNot's daily limit included). A `person` case is watched only within its frame (purpose, legal basis, no GDPR article 9 category, no pursuit of a private person). Each pass writes the usual « What changed » (Journal and Case.md, by `watch`), lights the « N new » badge and shows a desktop notification (« acme.fr: 3 new certificates »; a click opens the case: macOS with `terminal-notifier` — `brew install terminal-notifier`, else `osascript` without the click —, Linux `notify-send` 0.7.10 or later, Windows a toast); what a case or a web page says never reaches a shell or an interpreter. While a case is watched the server stays on after the agents have quit, until « Stop server » in Settings or the end of the session; the next `osint.mjs dashboard` starts it again and a missed pass runs once. Settings has the folder's switch, the notifications and the watched cases with their last and next pass (`.osint-settings.json`, versioned).

#### Private case types

A cases folder can carry case types of its own in `.osint-types/<type>/`, with the structure of a plugin type (`type.json`, `method.md`, `engine.js`, `labels.json`, `templates/`). They load after the plugin's types and never replace one (a folder named like a plugin type, an engine command or a prompt tag, spelled in any case or Unicode form, a Windows reserved name or a link out of the folder is refused, and `doctor` says why); they are versioned with the cases. Ask the agent for one (« crée-moi un type d'enquête privé pour … »): it tells you that the type is code that will run on your machine, follows `references/types.md` from a copy of the closest type and writes only inside `.osint-types/`, then `osint.mjs types` lists every type with its folder and what it lacks (`types --no-load` without loading any private code). A private type's `engine.js` runs with the engine's rights: the engine refuses one that imports more than a few `node:` built-ins or reaches the network without `ctx.fetch` (a guard against mistakes, not a sandbox: read the code), `doctor`, `list` and the dashboard never load it, the dashboard server never makes, changes nor runs one (its Refresh is the agent's), a watch runs it only after your yes (`osint.mjs watch --every 24h -p <slug> --yes`, for the code you read: a change stops it), and the dashboard marks it « Private ». The demo has one, `shop-audit`.

### `skill-security`

`claude plugin install skill-security@pabrisson` — requires Node (for the skill's validators).

Cloudflare's [`security-audit`](https://github.com/cloudflare/security-audit-skill) skill (MIT), **not copied here**: the entry is a `github` source on their repo, with no `version`, so the installed copy follows their latest commit on `main`. `claude plugin marketplace update pabrisson && claude plugin update skill-security@pabrisson` fetches it, or `"autoUpdate": true` on `extraKnownMarketplaces.pabrisson` in `~/.claude/settings.json` updates it at every session start. To hold a version, add `"sha": "<commit>"` to the entry's `source`.

**`security-audit`**: a security question or a focused review (`find security vulnerabilities in ./src`) gets an answer in guidance mode. An explicit audit or pen-test request (`security audit this codebase`) runs the full workflow:

1. reconnaissance: architecture, trust boundaries, input surfaces, in `architecture.md` and `coverage-ledger.json`;
2. hunting by isolated agents, one per ledger unit, with critics looking for coverage gaps;
3. each candidate handed to a fresh agent that tries to disprove it;
4. `confirmed`, `needs_validation` and `rejected` records in `findings.json`, checked against `report-schema.json`;
5. fresh agents check each record's claims against the source;
6. `REPORT.md`, `FINDINGS-DETAIL.md` and `NEEDS-VALIDATION.md`.

Output goes to `~/security-audit-skill/<repo-name>/run-<N>` unless another folder is given. Later runs build on the previous ledgers and findings. Without an OS sandbox (no network, writes limited to scratch folders), the skill never runs the target's code and keeps those leads as `needs_validation`.

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

**Settings**: `userConfig` in `plugin.json` declares the settings asked at install time and editable in `/config`. A `"sensitive": true` setting goes to the Keychain. They are read through `${user_config.<key>}`. The commands a skill runs don't see them: a `SessionStart` hook gets each one as `$CLAUDE_PLUGIN_OPTION_<KEY>` and writes it to `$CLAUDE_ENV_FILE`, which every later Bash command of the session loads (`skill-video`'s ElevenLabs and OpenRouter keys, `skill-immo`'s Stream Estate key).

**Paths**: `${CLAUDE_PLUGIN_ROOT}` is the plugin's folder (replaced on every update), `$CLAUDE_PLUGIN_DATA` its data folder (kept), `${CLAUDE_SKILL_DIR}` a skill's folder.

## Development

- Plugins installed from the marketplace are **copied** to `~/.claude/plugins/cache/pabrisson/<plugin>/<version>/`. After a change, bump `version` in `plugins/<plugin>/.claude-plugin/plugin.json`, push to `main`, then run `claude plugin marketplace update pabrisson && claude plugin update <plugin>@pabrisson` and restart the session.
- Try a change without publishing it: `claude --plugin-dir plugins/<plugin>` (current session only, replaces the installed version of the same name).
- Validate: `claude plugin validate .` (marketplace) or `claude plugin validate plugins/<plugin>`.
- Test a mod: `claude plugin test plugins/mod-hud`.
- `skill-video` studio: after changing the studio, run `npm run build` in `plugins-src/skill-video/studio/` before bumping the version (only the build, `engine/studio/dist/`, ships in the plugin). The same for media-generator's dashboard in `plugins-src/skill-video/media-studio/`.
- `skill-immo` dashboard: after changing it, run `npm run typecheck && npm run lint && npm run build` in `plugins-src/skill-immo/dashboard/` before bumping the version (only the build, `engine/dashboard/dist/`, ships in the plugin). `npm run dev` proxies `/api/` to a running `immo.mjs dashboard`.
- `skill-immo` engine: `node --test test/*.test.js` in `plugins/skill-immo/skills/property-search/engine/` runs offline, against recorded fixtures and a fake Stream Estate API v1. `node test/demo.mjs <searches folder>` runs the dashboard (port 41890) against that fake API (port 41899): no real call nor credit, an amber « API test » in its header. `IMMO_LIVE=1` adds the network smoke test on rue Paul Bert (Lyon 3e): the open data, and with `STREAM_ESTATE_API_KEY` (a v1 key) a free count and one listing (1 credit).
- `skill-osint` dashboard: `npm run typecheck && npm run lint && npm run build` in `plugins-src/skill-osint/dashboard/` before bumping the version (only the build, `engine/dashboard/dist/`, ships in the plugin).
- `skill-osint` engine: `npm test` (`node --test test/*.test.js`) in `plugins/skill-osint/skills/investigation/engine/` runs offline, against fixtures, a single fake server and fake `uv`, `cloudflared` and `yt-dlp` (Node scripts: skipped on Windows); `OSINT_LIVE=1 node --test test/geoint-live.test.js` and `node test/bench.mjs` need the real pack and the user's yes; `OSINT_LIVE=1 node --test test/export-live.test.js` prints a case with this machine's own browser (no network). `node test/demo.mjs <cases folder>` serves the dashboard on 41390 against fake APIs on 41399 (a « Fake APIs » badge). Dashboard texts say « the agent », never an AI vendor's name. `OSINT_NOW=<ISO date>` sets the watch's clock, `OSINT_SERVE=0` keeps `watch --every` from starting a server, `OSINT_NOTIFY=0` turns the notifications off (the tests and the demo set all three as needed).
- `skill-video` media-generator: `node test/fake-proxy.mjs <dir> <port>` in `plugins/skill-video/skills/media-generator/engine/` serves fake OpenRouter, Kie and ElevenLabs APIs for a dev dashboard: the routers' real public catalogs and price lists, every generation faked, nothing spent. A server started with `OPENROUTER_BASE=http://127.0.0.1:<port>/api/v1`, `ELEVENLABS_BASE=…/el`, `KIE_BASE=…/kie` and `KIE_UPLOAD_BASE=…/kieup` runs in developer mode, its header's « Fake API » switch on.
- Add a plugin: create `plugins/<type>-<domain>/.claude-plugin/plugin.json`, add its entry to `.claude-plugin/marketplace.json`, then add it to the [Catalog](#catalog) and the [Plugin documentation](#plugin-documentation).
