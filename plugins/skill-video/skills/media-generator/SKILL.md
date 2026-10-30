---
name: media-generator
description: Generates and edits images, videos and voices with AI models through model routers (OpenRouter), like Higgsfield but local and with every cost shown. Image create and edit (cinematic camera, relight, inpaint, upscale, face swap, character swap, expand, new angle, edit text, remove background), video create and edit (cinematic camera with camera moves, animate an image, first and last frame, camera moves like dolly zoom, crash zoom, FPV drone, orbit, VFX like fire or disintegration, talking avatar, extend, upscale, relight, restyle, object swap, clean up, reframe), text to speech with preset or cloned voices, voice change and dubbing into other languages (ElevenLabs). Opens a local dashboard. Use it whenever the user wants an image, a video clip or a voice generated or transformed by AI ("génère une image", "crée une vidéo IA de…", "anime cette photo", "fais un dolly zoom", "change le visage", "upscale", "fais-la parler", "voix off", "change la voix de cette vidéo", "traduis cette vidéo en anglais", "double en espagnol", "ouvre le générateur", "combien j'ai dépensé"), or pastes a prompt copied from the media-generator dashboard ("Copy prompt", "Send to edit").
argument-hint: "[studio | setup | credits | <what to generate, with files> | <a prompt copied from the dashboard>]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/engine/media.mjs *)
---

# Media generator

You generate and edit images, videos and voices for the user with AI models. The models sit behind a router
(OpenRouter: one key for many labs), and the voice change and dubbing use ElevenLabs. Every generation costs money,
so the user always sees the price first and says yes. A local dashboard does the same with clicks.

`media.mjs` below means `node ${CLAUDE_SKILL_DIR}/engine/media.mjs`: write it out in full in every command (a shell
variable holding `node …` does not run under zsh). Everything lives in the folder Claude Code runs in
(`$MEDIA_GENERATOR_DIR` overrides it):
- `media/<id>/`: one folder per generation, with its outputs (`out-1.png`, `out.mp4`, `out.mp3`, `dub-en.mp4`…), its
  inputs (`in-*`) and its `job.json`;
- `elements/<name>/`: the people, products and places a prompt cites with `@name`;
- `ledger.jsonl`: every paid action, in the provider's unit;
- `settings.json`: the confirmation thresholds, the monthly caps, the ElevenLabs plan and the default models.

Talk to the user in French. Write prompts for the models in English, unless the user wants on-screen text in
another language. The dashboard is in English.

## Before anything

Run `media.mjs doctor` once per conversation.
- A missing tool: give its install command and stop.
- `openrouter: no key`: nothing can be generated. Tell the user to set it with `/plugin configure skill-video@pabrisson`
  (a key from openrouter.ai/keys), then restart the session. `tools`, `models` and the dashboard still work.
- `elevenlabs: no key`: no voice change and no translation. Everything else works.
- `missing cloudflared`: a video or a voice cannot reach OpenRouter (video edits, upscale, talking avatar). Give
  `brew install cloudflared` (no account needed). Everything else works.

## Modes

| The request | What you do |
|---|---|
| `studio`, "ouvre le générateur" | `media.mjs studio --open`, give the URL |
| `setup` | Show `media.mjs setup`, change only what the user asks |
| `credits`, "combien j'ai dépensé" | `media.mjs credits`, then sum it up |
| A pasted "Copy prompt" from the dashboard | The model's prompt, as a draft (below) |
| A pasted "Send to edit" from the dashboard | Hand the file to the video-editor skill |
| Anything else | A generation (below) |

## A generation

### 1. The tool

Pick the kind (`image`, `video`, `audio`) and the tool that does what the user asks:
`media.mjs tools <kind> --search "<words>"` lists them, with their inputs, fields and recommended models. "Custom" (id `free`)
is the user's own prompt; the others fill a prompt template from their fields.

- Inputs are files: `--in <input>=<file>`, once per file (`--in references=a.png --in references=b.png`). Files the
  user gave keep their path. A result of an earlier generation is in `media/<id>/`.
- Fields: `--field <key>=<value>`, one of its options (its label works too: `--field light=Silhouette`, `Auto` leaves it
  out) or free text. Camera moves go in order: `--field movement="dolly in, then pan left"`. A relight's `light` is
  words: where each light is, its color, brightness and softness. Expand's frame is four margins, a share of the image
  on each side: `--field left=0.25 --field right=0.25`.
- `--prompt "…"` adds the user's words to the template, or is the whole prompt with "Custom". `--raw` sends the prompt
  exactly as written, without the template.
- `@name` in the prompt brings that Element's images as references. `media.mjs elements add <name> <images…>` makes
  one, when the user wants a character or a product to come back.

### 2. The model

The tool's first recommended model, unless the user names one or it cannot do the job. `media.mjs models <kind>
--search <words>` shows what each model takes (durations, resolutions, frames, audio, references).
Settings: `--duration`, `--ratio`, `--resolution`, `--n` (images), `--quality`, `--sound on|off` (video), `--seed`,
`--voice` (speech). `--batch 2` to `4` runs the same generation that many times, one job each (a seed goes up by one a
job); the estimate and the user's yes are for the total. Without them, the engine picks sensible values the model accepts: a video made from an image
keeps that image's ratio (the closest the model takes).

### 3. The price, then the user's yes

Run the command without `--spend`. It stops with **exit code 2** and prints the estimate as JSON (`shown` is how to
say it: `$0.84`, `1,610 credits`, or `1,610 credits · $0.29` once their ElevenLabs plan is set). Then ask with AskUserQuestion, in French:
- the price, the model and what it will make;
- options: go at that price (recommended when it matches the request), a cheaper way when there is one (a faster
  model, a shorter clip, a lower resolution, fewer images or a smaller batch, `dubbing_v1` rather than `dubbing_v2`), and no.

Only after a yes, run it again with `--spend <amount>` (the estimate's amount: USD for OpenRouter, credits for
ElevenLabs).

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

## Voices, voice change, translation

- **Speech** (`audio --tool voice`): `--prompt` is the text read. A preset voice of the model (`--voice`, from
  `media.mjs models audio`), or a voice cloned from 1 to 3 clips (`--in voice_clips=<file>`). `--field
  instructions="…"` says how it sounds.
- **Change voice** (`audio --tool change-voice --in clip=<audio or video> --voice <voice_id>`): the same delivery
  (pauses, emotion, rhythm) in another voice, put back on the video. `media.mjs voices` lists the account's voices,
  and `media.mjs voice-clone <name> <recordings…>` makes one from the user's recordings (a minute or more of clean
  speech). `--field denoise=remove` drops the background noise.
- **Translate** (`audio --tool translate --in clip=<file> --field to=en,es`): a dubbed file per language in the
  speakers' own voices, with its subtitles (`.vtt`). `--field quality=dubbing_v1` (default, 3,000 credits a minute
  per language) or `dubbing_v2` (better voices and emotion, 13,500 a minute). **No lip-sync**: say so.
- ElevenLabs bills credits: give them as `shown` (with their dollars when the plan is set).

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
| 3 | No key, a refused key, or no credits left (402) | Say so: the key with `/plugin configure skill-video@pabrisson`, credits on openrouter.ai |
| 1 | Any other error | Read the message: a missing input, a model that does not take a frame, a file over 50 MB… |

## Good to know

- **The dashboard.** `media.mjs studio` reuses this folder's server or starts one on the first free port from 41287,
  on 127.0.0.1 only. It stops by itself once every Claude Code session that opened it has quit. A generation started
  there runs in its own process and finishes even if the page closes.
- **Costs.** OpenRouter in USD as it reports them, never converted. ElevenLabs in credits, and in USD at the price of
  the plan set in the settings (`setup set elevenlabs.plan=free|starter|creator|pro|scale|business`, only when the user
  names theirs). The thresholds and caps are per provider and unset until the user sets them (dashboard Settings,
  or `setup set`). `media.mjs credits` gives the balances and this month's spending.
- **What leaves the machine.** The prompt and the input files of a generation go to its router or to ElevenLabs.
  Images are inlined (up to 50 MB a file). A video or a voice for OpenRouter is served from this machine at a random
  address through a Cloudflare quick tunnel, opened when the job is submitted (about 20 s) and closed when it ends.
  Nothing else.
- **Git.** The engine writes the folder's `.gitignore`: git keeps `media/`, `elements/`, `ledger.jsonl` and
  `settings.json`, and leaves out `.cache/` and `.trash/` (what the dashboard deleted).
- **A new tool** is an entry in `engine/tools/<kind>.json`: read `references/tools-format.md`.
