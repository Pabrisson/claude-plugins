---
name: media-generator
description: Generates and edits images, videos, voices, music and sound effects with AI models through a model router (Kie.ai by default, or OpenRouter) and ElevenLabs, every cost shown and approved first. Keeps a Library of Elements (characters, outfits, objects, places, poses, brands, voices) and styles cited with @name, workspaces with a timeline, and a local dashboard. Use it whenever the user wants an image, a video clip, a voice, a song or a sound made or transformed by AI (create, animate, restyle, upscale, face or object swap, inpaint, camera moves, talking avatar, lip sync, voice-over, voice change, voice design, dubbing, transcripts, music, stems, sound effects), for example "génère une image", "crée une vidéo IA de…", "anime cette photo", "fais un dolly zoom", "change le visage", "redessine-la en style anime", "crée le personnage Lulu avec ces photos", "crée la voix du narrateur", "voix off", "traduis cette vidéo en anglais", "crée une musique", "un bruitage de pluie", "ouvre le générateur", "transcris cette vidéo", "combien j'ai dépensé", or when they paste a prompt copied from the media-generator dashboard ("Copy prompt", "Send to edit", "Ask Claude").
argument-hint: "[studio | setup | credits | <what to generate, with files> | <a prompt copied from the dashboard>]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/engine/media.mjs" *), Bash(node ${CLAUDE_SKILL_DIR}/engine/media.mjs *)
---

# Media generator

You generate and edit images, videos and voices for the user with AI models. The models sit behind a router,
one active at a time: Kie.ai by default, or OpenRouter (each one key for many labs; Kie.ai is the one active until the
user picks another in Settings › Router, or `media.mjs setup set router.active=kie|openrouter` when they ask).
ElevenLabs is never reached through a router while its key is set: its voices (Voice, dialogues, with their captions),
the voice change, dubbing, its sound effects, Eleven Music, music for a video, stems, voice design and remix and
transcripts go straight to its API, with its own key and credits, whichever router is active. Suno's models come by Kie,
Lyria's by OpenRouter. Every generation costs money,
so the user always sees the price first and says yes. A local dashboard does the same with clicks.

`media.mjs` below means `node "${CLAUDE_SKILL_DIR}/engine/media.mjs"`: write it out in full in every command, the
path in double quotes (it can hold spaces or, on Windows, backslashes; a shell variable holding `node …` does not run
under zsh). The skill runs on macOS, Linux and Windows. Everything lives in the folder Claude Code runs in
(`$MEDIA_GENERATOR_DIR` overrides it):
- `media/<id>/`: one folder per generation, with its outputs (`out-1.png`, `out.mp4`, `out.mp3`, `dub-en.mp4`, a song's `out-1.mp3` and `cover-1.jpg`…), its
  inputs (`in-*`) and its `job.json`;
- `elements/<name>/`: the Library's Elements a prompt cites with `@name` (characters, outfits, objects, places, poses,
  brands; voices picked as a voice), their images or clips and `element.json` (type, words);
- `styles/<name>/`: the user's own styles, a few images of a look and its words, or a sound style's words and family (`style.json`);
- `ledger.jsonl`: every paid action, in the provider's unit;
- `settings.json`: the active router, the confirmation thresholds, the monthly caps, the ElevenLabs plan and the
  default models.

Talk to the user in French. Write prompts for the models in English, unless the user wants on-screen text in
another language. The dashboard is in English.

## Before anything

Run `media.mjs doctor` once per conversation.
- A missing tool: give the install command `doctor` prints (it is this OS's: brew, apt or a download page, winget) and
  stop. On Windows, Claude Code must be restarted after a winget install to see the new PATH.
- `openrouter: no key`: nothing can be generated. Tell the user to set it with `/plugin configure skill-video@pabrisson`
  (a key from openrouter.ai/keys), then restart the session. `tools`, `models` and the dashboard still work.
- `active router: …, without its key`: the router picked in Settings has no key. Same as above for that router (a
  Kie key from kie.ai/api-key), or switch back to the other one if the user prefers.
- `elevenlabs: no key`: no voice change, translation, voice design or transcript, nor ElevenLabs' sound effects and
  music; Voice takes the router's ElevenLabs voices. Everything else works.
- `missing cloudflared`: a video or a voice cannot reach OpenRouter (video edits, upscale, talking avatar). Give
  the command `doctor` prints (no account needed). Everything else works, and Kie needs none (it takes the files by its
  own upload).
- `missing uv`: no Depth map and no Remove background for videos (they run models on this machine). Give the command
  `doctor` prints. Everything else works. With uv, the models download by themselves at their first use (330 MB, once), or ahead
  with `media.mjs setup vision`.

## Modes

| The request | What you do |
|---|---|
| `studio`, "ouvre le générateur" | `media.mjs studio --open`, give the URL |
| `setup` | Show `media.mjs setup`, change only what the user asks |
| `credits`, "combien j'ai dépensé" | `media.mjs credits`, then sum it up |
| A pasted "Copy prompt" from the dashboard | The model's prompt, as a draft (below) |
| A pasted "Send to edit" from the dashboard | Hand the file to the video-editor skill |
| An Element or a style to make, or a pasted "Ask Claude" | `references/library.md` |
| A workspace ("crée un workspace", "travaille dans le projet …"), its files or its edit | `references/library.md`, « Workspaces » |
| Anything else | A generation (below) |

## What to read before

This file holds what every generation follows. The details of each domain are in `${CLAUDE_SKILL_DIR}/references/`:
read the one the request touches before its step 1 (once per conversation is enough).

| The request touches | Read |
|---|---|
| A video edit (Inpaint, Object swap, Face swap, Clean up, Custom edit, Restyle, Relight, Recolor), a tool done on this machine (Reframe, FPS boost, SDR to HDR, Depth map, Remove background), Lip sync, Speech to video | `references/video-tools.md` |
| A model's own setting or editor: `--option`, shots, middle frames, reference videos or sounds, a voice in a video, spoken lines (`--say`), who speaks, a draft | `references/model-options.md` |
| An Element, a style of the user's own, `@name`, a References sheet, a pasted "Ask Claude", a workspace | `references/library.md` |
| Any `audio`: speech, a dialogue, Change voice, Translate, music, a song, music for a video, a sound effect, stems, Isolate voice, a singer, a voice designed or remixed, a transcript | `references/audio.md` |
| A new tool or a new preset style in the engine | `references/tools-format.md` |

## A generation

### 1. The tool

Pick the kind (`image`, `video`, `audio`) and the tool that does what the user asks:
`media.mjs tools <kind> --search "<words>"` lists them, with their inputs, fields and recommended models. "Custom" (id `free`)
is the user's own prompt; the others fill a prompt template from their fields. Custom and Custom edit
(`free-edit`) need the user's words (`--prompt`); on the other tools they are optional, added to the tool's prompt.

- Inputs are files: `--in <input>=<file>`, once per file (`--in references=a.png --in references=b.png`). Files the
  user gave keep their path. A result of an earlier generation is in `media/<id>/`. Most edit tools take optional
  references (Restyle's characters, the light to match, what to paint, other views, the lettering, what lies beyond
  the frame; several face photos for Face swap): the prompt names them by their place. A model takes so many
  reference images (`media.mjs models <kind>`: `N refs`; a video model's apart from its frames), a Library style's
  images included: past that, the command stops before anything is sent; pick fewer or another model. A video
  with a first or last frame takes no reference image (OpenRouter keeps the frames and drops them): the command
  refuses both, keep one or the other. FLUX Video Edit and Aleph 2 take none besides their video: Restyle with
  characters or a style of the user's own goes to Seedance 2.0 Mini.
- Fields: `--field <key>=<value>`, one of its options (its label works too: `--field light=Silhouette`, `Auto` leaves it
  out) or free text. Camera moves go in order: `--field movement="dolly in, then pan left"`. A relight's `light` is
  words: where each light is, its color, brightness and softness. Expand's frame is four margins, a share of the image
  on each side: `--field left=0.25 --field right=0.25`.
- `--prompt "…"` adds the user's words to the template, or is the whole prompt with "Custom". `--raw` sends the prompt
  exactly as written, without the template.
- `@name` in the prompt cites an Element or a style of the Library: see `references/library.md`.
  Some tools take them in a field of their own: Character swap (`--field character="@Max, @Coat"`), Object swap
  (`--field element="@Papi, @Coat, @Lisbon"`) and both Inpaints take several, of every type, each read by its type
  (a place as the setting, a pose as the pose); Character swap and Object swap take photos instead or as well (`--in
  references=<file>`), one or the other is needed. Video Face swap takes one character (a face). The Element must be
  of a type the field takes (`media.mjs tools` lists them): make it first when there is none (`references/library.md`).
- **Styles.** Restyle (`--tool restyle`, image and video) redraws the source in a style, what is in it and its motion
  kept; Custom takes one too, optional. `--field style=<style>`: a preset's label (`media.mjs tools image --search
  restyle` lists the 82) or the name of a style of the user's own. `media.mjs styles add <name> <images…> --words
  "<the look in words>"` makes one from 1 to 5 images that share a look (the dashboard's Library › Visuals does
  the same); its images go last among the references and the prompt names them, `media.mjs styles` lists them. With
  such a style in Custom image, Recraft V4 Styles (`recraft/recraft-v4-styles`, Pro for more detail, about 1K) is
  made for it: it draws the prompt in the look of the references. Not for Restyle: it makes a new image, the
  source is not kept.

### 2. The model

The tool's first recommended model on the active router, unless the user names one or it cannot do the job; `media.mjs
tools <kind> --search <tool>` gives each recommended model with why (ranked on Artificial Analysis' leaderboards,
October 2026: GPT Image 2.5 Sunburst first for images, MiniMax H3 first for new videos, Wan 3.0, Seedance 2.5, Kling
4.0 after it). Say why when you pick one the user did not. Each
router has its own list (`providers/openrouter-models.json`, `providers/kie-models.json`), each model with what it
takes there: the same model may do more on one (Seedance 2.5 on Kie edits a video and goes to 1080p, through
OpenRouter it does neither; Kling 3.0 is 720p on OpenRouter, up to 4K on Kie). A model named in a remix or a
default of the other router runs on the active one when it has it; otherwise the command says so: pick another or
offer to switch the router.

**On Kie** (`media.mjs credits` says which router is active): the video edits go to other models than through
OpenRouter, with no keyframe step (`references/video-tools.md`, « The video edits on Kie »). Upscale video is Topaz (×1,
×2, ×4: ×1.5 runs ×2, ×3 runs ×4), Talking avatar Kling AI Avatar or OmniHuman, Remove background Recraft. Voice:
ElevenLabs straight, or Eleven v3 Dialogue or Gemini TTS on Kie (no cloning there), no FLUX video, no HeyGen. Kling 4.0,
Veo 3.1 Lite and Quality, Wan 3.0 Prime, HappyHorse, Vidu Q4, PixVerse V6 Max, MiniMax H3, Gemini Omni are among
the other models. `media.mjs models <kind>
--search <words>` shows what each model takes (durations, resolutions, frames, audio, references). Models marked
« new, from the catalog » come from the active router's catalog (read at each start of the dashboard and once a day;
`--refresh` reads it now, when the user asks for the newest models): never recommend one over the tool's own. On
OpenRouter say its price is OpenRouter's, not measured; on Kie its price is unknown (each asks for the user's own yes,
`--accept-unknown`).
Settings: `--duration`, `--ratio`, `--resolution`, `--n` (images), `--quality`, `--sound on|off` (video), `--seed`,
`--voice` (speech). `--batch 2` to `4` runs the same generation that many times, one job each (a seed goes up by one a
job); the estimate and the user's yes are for the total. Without them, the engine picks sensible values the model accepts: a video made from an image
keeps that image's ratio (the closest the model takes).

**Each model's own settings and editors** (`media.mjs models <kind>` lists them: `options …`, `N shots`, `N middle
frames`, `masks of who speaks`, `N Library voices`, `draft then final`, `dialogue`). Use them when the user's wish needs
them; the dashboard shows the same in its Options block and editors.
Their flags, one by one: `references/model-options.md`.

### 3. The price, then the user's yes

Run the command without `--spend`. It stops with **exit code 2** and prints the estimate as JSON (`shown` is how to
say it: `$0.84`, `1,610 credits`, or `1,610 credits · $0.29` once their ElevenLabs plan is set). Then ask with AskUserQuestion, in French:
- the price, the model and what it will make;
- options: go at that price (recommended when it matches the request), a cheaper way when there is one (a faster
  model, a shorter clip, a lower resolution, fewer images or a smaller batch, `dubbing_v1` rather than `dubbing_v2`), and no.

Only after a yes, run it again with `--spend <amount>` (the estimate's amount: USD for OpenRouter and Kie, credits
for ElevenLabs).

Three cases need the user's own words before the flag:
- **Unknown cost** (`unknown cost`): say « coût inconnu », ask, then `--accept-unknown`.
- **Over this month's cap** (when the user set one): never `--force` unless the user explicitly agrees to go over
  it, for this call.
- **A yes is for one call.** The next generation asks again.

Never set or raise a threshold or a cap yourself.

### 4. Run and wait

With `--spend`, the command runs to the end: images and voices take seconds, a video one to several minutes (it
polls the router). Run a video command in the background, or with a long timeout, and wait for it. If it was cut
off, `media.mjs jobs` shows where things are and `media.mjs run <id>` resumes it (the video's job id is kept).

### 5. Deliver

Give the output's path and its real cost, as the command printed it (`(estimated)` when the router did not report
it). Look at an image yourself (Read) before saying it is good. Offer the next step that fits: another take, a
variant with another model, animating an image (`video --tool animate --in first_frame=<image>`), extending or
upscaling a video, the dashboard (`media.mjs studio --open`).

## Elements, styles and workspaces

The Library (Elements, styles of the user's own) and the workspaces: `references/library.md`. Making or changing an
Element or a style is free and local: no estimate, no yes. Every new generation joins the current workspace, unless it
goes to a folder: `--out <folder>` on `image`, `video` or `audio` puts its files there too, named `<job id>-<file>` (a
hard link, no space taken twice), in no workspace and with no dashboard; the job stays in `media/` and its cost in the
ledger. Use it when the user names a folder for the result, or when the video-editor skill asks for a medium for a video.

## A pasted "Copy prompt"

The dashboard's « Copy prompt » gives you the space, the tool, the chosen model, its fields, its input files and
what the user wants. Write **the best prompt for that model**: its strengths, its syntax and its ideal length (a
camera move named the way the model understands it, the subject first, light and lens, what must not change). Then:

```
media.mjs draft --space <image|video|audio> --tool <tool> --model <model> --prompt "<the prompt>"
```

**Never generate** from this request: nothing is spent. Tell the user the open dashboard shows a « Reload » bar with
the new prompt, to review and generate there.

## A pasted "Send to edit"

The user wants a generated file in a video. Use the video-editor skill with that file: a new video with it as a
rush, or a B-roll clip in the project the prompt names.

## Exit codes

| Code | Meaning | What you do |
|---|---|---|
| 2 | The user's yes is needed: the estimate is printed | Ask (step 3), then run again with the flag it names |
| 3 | No key, a refused key, or no credits left (402) | Say so: the key with `/plugin configure skill-video@pabrisson`, credits on openrouter.ai or kie.ai; on OpenRouter, videos still running hold their price, so with several at once wait for them and retry |
| 1 | Any other error | Read the message: a missing input, a model that does not take a frame, a file over 50 MB… |

## Good to know

- **The dashboard.** `media.mjs studio` reuses this folder's server or starts one on the first free port from 41287,
  on 127.0.0.1 only. It stops by itself once every Claude Code session that opened it has quit. A generation started
  there runs in its own process and finishes even if the page closes.
- **Costs.** OpenRouter in USD as it reports them, never converted. Kie in USD from its own price list (its public
  price API, read at each start of the dashboard and once a day; its credits at $0.005 each, shown beside; the models
  its catalog adds priced by `providers/kie-catalog-prices.json`, matched by hand), the real cost from the credits each
  task consumed (Lyria at its price a song). ElevenLabs in credits, and in USD at the price of the plan set in the
  settings (`setup set elevenlabs.plan=free|starter|creator|pro|scale|business`, only when the user names theirs). The
  thresholds and caps are per provider and unset until the user sets them (dashboard Settings,
  or `setup set`). `media.mjs credits` gives the balances and this month's spending.
- **What leaves the machine.** The prompt and the input files of a generation go to its router or to ElevenLabs.
  Images are inlined (up to 50 MB a file). A video or a voice for OpenRouter is served from this machine at a random
  address through a Cloudflare quick tunnel, opened when the job is submitted (about 20 s) and closed when it ends.
  Kie takes every file by its own upload (free, deleted after 24 h). Nothing else.
- **Rate limits.** Kie takes 20 new generations every 10 s for the account: past that the engine waits its turn (the
  job says « waiting for Kie's rate limit »), and a 429 is tried again after 10 s, 5 times. OpenRouter has no cap on
  paid models; a model's own 429 is tried again after the time it asks. A 429 is never billed.
- **Git.** The engine writes the folder's `.gitignore`: git keeps `media/`, `elements/`, `styles/`, `ledger.jsonl` and
  `settings.json`, and leaves out `.cache/` and `.trash/` (what the dashboard deleted).
- **A new tool** is an entry in `engine/tools/<kind>.json`: read `references/tools-format.md`. A new preset style
  is an entry in `engine/tools/styles.json` (visual), `music-styles.json`, `voice-styles.json` or `sound-styles.json`.