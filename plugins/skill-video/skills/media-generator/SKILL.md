---
name: media-generator
description: Generates and edits images, videos and voices with AI models through model routers (OpenRouter), like Higgsfield but local and with every cost shown. Image create and edit (cinematic camera, relight, inpaint, upscale, face swap, character swap, expand, new angle, edit text, remove background, restyle in a preset or own style, reference sheets of a character, an outfit, an object, a place or a pose), video create and edit (cinematic camera with camera moves, animate an image, first and last frame, camera moves like dolly zoom, crash zoom, FPV drone, orbit, VFX like fire or disintegration, talking avatar, extend, upscale, relight, recolor, restyle, object swap, face swap, inpaint, clean up, reframe, and on this machine for free: remove background, depth map, FPS boost, SDR to HDR), text to speech with preset or cloned voices, voice change and dubbing into other languages (ElevenLabs). Keeps a Library of Elements (characters, outfits, objects, places, poses, brands, voices) and styles, cited with @name in every prompt. Gathers each project in a workspace, with a timeline to lay its shots and sounds on and hand to video-editor. Opens a local dashboard. Use it whenever the user wants an image, a video clip or a voice generated or transformed by AI ("génère une image", "crée une vidéo IA de…", "anime cette photo", "fais un dolly zoom", "change le visage", "upscale", "redessine-la en style anime", "crée un style avec ces images", "crée le personnage Lulu avec ces photos", "fais une fiche personnage", "garde ce produit comme élément", "crée la voix du narrateur", "fais-la parler", "voix off", "change la voix de cette vidéo", "traduis cette vidéo en anglais", "double en espagnol", "ouvre le générateur", "crée un workspace", "combien j'ai dépensé"), or pastes a prompt copied from the media-generator dashboard ("Copy prompt", "Send to edit", "Ask Claude").
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
- `elements/<name>/`: the Library's Elements a prompt cites with `@name` (characters, outfits, objects, places, poses,
  brands; voices picked as a voice), their images or clips and `element.json` (type, words);
- `styles/<name>/`: the user's own styles, a few images of a look and its words (`style.json`);
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
- `missing uv`: no Depth map and no Remove background for videos (they run models on this machine). Give `brew install
  uv`. Everything else works. With uv, the models download by themselves at their first use (330 MB, once), or ahead
  with `media.mjs setup vision`.

## Modes

| The request | What you do |
|---|---|
| `studio`, "ouvre le générateur" | `media.mjs studio --open`, give the URL |
| `setup` | Show `media.mjs setup`, change only what the user asks |
| `credits`, "combien j'ai dépensé" | `media.mjs credits`, then sum it up |
| A pasted "Copy prompt" from the dashboard | The model's prompt, as a draft (below) |
| A pasted "Send to edit" from the dashboard | Hand the file to the video-editor skill |
| An Element or a style to make, or a pasted "Ask Claude" | Elements and styles of the Library (below) |
| A workspace ("crée un workspace", "travaille dans le projet …"), its files or its edit | Workspaces (below) |
| Anything else | A generation (below) |

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
- `@name` in the prompt cites an Element or a style of the Library: see « Elements and styles of the Library ».
  Some tools take them in a field of their own: Character swap (`--field character="@Max, @Coat"`), Object swap
  (`--field element="@Papi, @Coat, @Lisbon"`) and both Inpaints take several, of every type, each read by its type
  (a place as the setting, a pose as the pose); Character swap and Object swap take photos instead or as well (`--in
  references=<file>`), one or the other is needed. Video Face swap takes one character (a face). The Element must be
  of a type the field takes (`media.mjs tools` lists them): make it first when there is none (« Elements and styles
  of the Library »).
- **A painted area** (image Inpaint, video Inpaint, Object swap, Clean up): the image or a frame with the area in
  translucent magenta (`--in sketch=<file>`). For an image Inpaint, `--in matte=<file>` (white where painted, black
  elsewhere) lays the model's result back on the original inside that area only, so the rest keeps its pixels (the
  dashboard makes both files; the matte is never sent; `--field outside=model` keeps the model's whole image). A
  painted frame is an image beside the video: of the video models, only Seedance takes one (the command names it
  when the chosen model cannot). A video sent to Seedance goes through Seedance 2.0 Mini, 4 s or longer (the command
  refuses a shorter one, free): it remakes the shot at its length. Seedance 2.5 edits no video through OpenRouter yet (it
  asks a length OpenRouter refuses): it stays among the other models, with Seedance 2.0 and 2.0 Fast, for the day it does. Seedance refuses, free, any image that may show a real person
  (`PrivacyInformation`): a painted frame with someone in it, a face photo for video Face swap. Say so and offer FLUX
  Video Edit or Aleph 2 with words only (no painted frame), or an illustrated face.
- **A keyframe, then the shot (Aleph 2).** Object swap, Face swap and video Inpaint go to Aleph 2 by a keyframe: the
  only edit through OpenRouter that keeps the video and changes just the subject, a character too. Clean up, Custom
  edit, Restyle, Relight and Recolor take one on Aleph 2 as well. Two calls, each with its own estimate and yes:
  1. `video --tool object-swap --in video=<file> --field old="the girl" --field element=@Papi --frame <seconds>`: the
     frame at that time edited as an image (Seedream 5.0 Flash, about $0.02; `--keyframe-model <image model>` for
     another), with the tool's Elements, painted area and references. Look at it (Read) and show it before going on.
  2. The same with `--in keyframe=<that image> --frame <seconds>` (Aleph 2, $0.28 a second, $1.40 at least; a source
     of 2 to 30 s under 16 MB): Aleph carries the change through the whole shot. Without a keyframe Aleph 2 refuses
     these three tools, and a keyframe goes to no other model (OpenRouter has no other that takes one).
- **Done here, free** (`provider: local`, no estimate to approve): Reframe, FPS boost (`--field target=60|120|slow2|slow4`),
  SDR to HDR (an HDR10 conversion, it adds no detail; `--field peak=600|1000|1600`), Depth map (about 0.3 s a frame)
  and Remove background (about 4 s a frame: a 5 s clip takes some minutes; `--field background=transparent|green|black|white`,
  transparent gives a WebM to preview and a ProRes 4444 `.mov` for editing software). Run the long ones in the
  background.
- **Styles.** Restyle (`--tool restyle`, image and video) redraws the source in a style, what is in it and its motion
  kept; Custom takes one too, optional. `--field style=<style>`: a preset's label (`media.mjs tools image --search
  restyle` lists the 24) or the name of a style of the user's own. `media.mjs styles add <name> <images…> --words
  "<the look in words>"` makes one from 1 to 5 images that share a look (the dashboard's Library › Styles does the
  same); its images go last among the references and the prompt names them, `media.mjs styles` lists them. With
  such a style in Custom image, Recraft V4 Styles (`recraft/recraft-v4-styles`, Pro for more detail, about 1K) is
  made for it: it draws the prompt in the look of the references. Not for Restyle: it makes a new image, the
  source is not kept.

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

## Elements and styles of the Library

The Library keeps what comes back from one generation to the next. Making or changing an Element or a style is free
and local: no estimate, no yes.

- **Elements** (`elements/<name>/`) each have a type, which tells the model what their images are: `character` (a
  person, a creature, a mascot), `outfit`, `object` (a product, a prop, a vehicle), `location`, `pose` (a body pose,
  nothing else), `brand` (a logo kept exact, its colors and typeface), `voice` (1 to 3 clips), `other` (one made
  before the types).
- **Citing.** `@name` in any image or video prompt (Custom, a tool's words, a raw prompt) sends the Element's images
  after the tool's own and names them: « Lulu (the character in images 2 to 3, <its words>) ». Their images count
  toward the model's references (`N refs`). A style is never cited: it goes in a Style field (`--field style=<name>`).
  A voice is never cited in words either: `audio --tool voice --voice @name` clones its clips, its words say how it
  sounds.
- **Making one**, when the user asks (« crée le personnage Lulu avec ces photos », « garde ce produit », « fais-en un
  style ») or pastes « Ask Claude » from the dashboard:
  1. Look at the images (Read) and write what it is in a few English words: they go with every `@name`.
  2. `media.mjs elements add <name> <files…> --type <type> --words "…"`; a brand adds `--colors "#hex,#hex"` and
     `--font "…"`, a voice takes audio clips. `--from <generation id>` takes a result's images or clips (several
     `--from` for several). A style: `media.mjs styles add <name> <images…> --words "<the look>"` (1 to 5 images,
     `--from` too).
  3. Photos that are not clean references (a busy background, one angle only) for a type with a References tool:
     offer its sheets first. That is a generation: its price and the user's yes (step 3 above). Then save the sheets
     that came out right, with the photos when they help.
  4. Tell the user the `@name` to cite. The open dashboard shows it at once.
- **Changing one.** `elements set <name> [<files…>] [--type …] [--words …] [--colors …] [--font …] [--drop <file>]`,
  `elements show <name>`, `elements remove <name>`; the same `set`, `show`, `remove` for `styles`. `elements
  elevenlabs <name>` puts a voice on the ElevenLabs account for Change voice (ElevenLabs needs a paid plan for it).
- **References tools** (image, group References): `character`, `outfit`, `object`, `location`, `pose`. They only make
  images in `media/`, never an Element by themselves. Each sheet picked (`--field sheets="Body turnaround, Face
  close-up"`, their labels in `media.mjs tools image --search references`) is its own job at its own ratio, and the
  estimate is their total. The first sheet sets the look; the others wait for it and take its image as the `sheet` to
  match. They need words (`--field who="…"` for a character, `--field what="…"` for the others) or photos (`--in
  references=<file>`), or both; a style is optional (`--field style=…`). To redo one sheet: the same tool with `--field
  sheets=<that one>` and `--in sheet=<the first sheet's image>`. A brand has no tool: a model redraws a logo wrong,
  the real file goes in.

## Workspaces

A workspace is a project: its media, its Elements and a timeline. « Default workspace » is there from the start.
**Every new generation joins the current workspace**, yours and the dashboard's (`--workspace <slug>` on `image`,
`video` or `audio` puts one in another); so does a new Element (`elements add … --workspace <slug>|none` for another
or none). The dashboard's header switches it.

- `media.mjs workspaces` lists them (`*` the current one); `workspaces new <name>` makes one and makes it current;
  `workspaces use <slug>` switches; `workspaces add <slug> <generation ids…>` (and `drop`) puts results in or out.
- `media.mjs workspaces show <slug>` gives its files, its Elements and its timeline in words (`--json` for all of
  it). The user lays the timeline in the dashboard (Workspace › Timeline: the main track V1 holds the shots end to
  end, numbered #1, #2…; the tracks above overlay it, the audio tracks mix); you only read it. Its clips' menus
  (Generate: a tool on the clip as it is cut, or from its frame; Extend after or before; Freeze frame; Fit to the
  format; Voice here; ✦ Bridge shot on a cut) fill the dashboard's composer, and the result lays itself by its clip.
- A pasted prompt that starts with `/skill-video:video-editor Make a video from my media-generator workspace` is
  for the video-editor skill: its clips, their times and their sound are an exact edit, keep it.

## Voices, voice change, translation

- **Speech** (`audio --tool voice`): `--prompt` is the text read. A preset voice of the model (`--voice`, from
  `media.mjs models audio`), a voice of the Library (`--voice @name`), or a voice cloned from 1 to 3 clips (`--in
  voice_clips=<file>`). `--field instructions="…"` says how it sounds.
- **Change voice** (`audio --tool change-voice --in clip=<audio or video> --voice <voice_id>`): the same delivery
  (pauses, emotion, rhythm) in another voice, put back on the video. `media.mjs voices` lists the ElevenLabs voices
  (its default ones and the account's own). `--voice @name` takes a voice of the Library: one not on the account
  yet is put there when the job runs (ElevenLabs needs a paid plan for that), then kept. A new voice of the user's
  own is a Library voice Element (`elements add <name> <clips…> --type voice`, a minute or more of clean speech).
  `--field denoise=remove` drops the background noise.
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
| 3 | No key, a refused key, or no credits left (402) | Say so: the key with `/plugin configure skill-video@pabrisson`, credits on openrouter.ai; videos still running hold their price there, so with several at once wait for them and retry |
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
- **Git.** The engine writes the folder's `.gitignore`: git keeps `media/`, `elements/`, `styles/`, `ledger.jsonl` and
  `settings.json`, and leaves out `.cache/` and `.trash/` (what the dashboard deleted).
- **A new tool** is an entry in `engine/tools/<kind>.json`: read `references/tools-format.md`. A new preset style
  is an entry in `engine/tools/styles.json`.
