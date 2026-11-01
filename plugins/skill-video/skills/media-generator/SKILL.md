---
name: media-generator
description: Generates and edits images, videos and voices with AI models through model routers (Kie.ai by default, or OpenRouter, one active at a time), like Higgsfield but local and with every cost shown. Image create and edit (cinematic camera, relight, inpaint, upscale, face swap, character swap, expand, new angle, edit text, remove background, restyle in a preset or own style, reference sheets of a character, an outfit, an object, a place or a pose), video create and edit (cinematic camera with camera moves, animate an image, first and last frame, camera moves like dolly zoom, crash zoom, FPV drone, orbit, VFX like fire or disintegration, talking avatar, lip sync, several keyframes, reference videos and voices, spoken lines, extend, upscale, relight, recolor, restyle, object swap, face swap, inpaint, clean up, reframe, and on this machine for free: remove background, depth map, FPS boost, SDR to HDR), text to speech with preset or cloned voices and dialogues (ElevenLabs straight, Gemini…), voice change and dubbing into other languages (ElevenLabs), music and songs (Suno, Lyria) with their extends, covers, vocals, stems and lyrics, sound effects, a voice isolated, speech to video. Keeps a Library of Elements (characters, outfits, objects, places, poses, brands, voices) and styles, cited with @name in every prompt. Gathers each project in a workspace, with a timeline to lay its shots and sounds on and hand to video-editor. Opens a local dashboard. Use it whenever the user wants an image, a video clip or a voice generated or transformed by AI ("génère une image", "crée une vidéo IA de…", "anime cette photo", "fais un dolly zoom", "change le visage", "upscale", "redessine-la en style anime", "crée un style avec ces images", "crée le personnage Lulu avec ces photos", "fais une fiche personnage", "garde ce produit comme élément", "crée la voix du narrateur", "fais-la parler", "voix off", "change la voix de cette vidéo", "traduis cette vidéo en anglais", "double en espagnol", "crée une musique", "une chanson sur…", "prolonge ce morceau", "sépare la voix", "un bruitage de pluie", "fais-le chanter sur cette musique", "ouvre le générateur", "crée un workspace", "combien j'ai dépensé"), or pastes a prompt copied from the media-generator dashboard ("Copy prompt", "Send to edit", "Ask Claude").
argument-hint: "[studio | setup | credits | <what to generate, with files> | <a prompt copied from the dashboard>]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/engine/media.mjs *)
---

# Media generator

You generate and edit images, videos and voices for the user with AI models. The models sit behind a router,
one active at a time: Kie.ai by default, or OpenRouter (each one key for many labs; OpenRouter when only its key is
set; the user picks it in Settings › Router, or `media.mjs setup set router.active=kie|openrouter` when they ask).
ElevenLabs is never reached through a router while its key is set: its voices (Voice, dialogues), the voice change and
dubbing go straight to its API, with its own key and credits, whichever router is active. Suno's models come by Kie,
Lyria's by OpenRouter. Every generation costs money,
so the user always sees the price first and says yes. A local dashboard does the same with clicks.

`media.mjs` below means `node ${CLAUDE_SKILL_DIR}/engine/media.mjs`: write it out in full in every command (a shell
variable holding `node …` does not run under zsh). Everything lives in the folder Claude Code runs in
(`$MEDIA_GENERATOR_DIR` overrides it):
- `media/<id>/`: one folder per generation, with its outputs (`out-1.png`, `out.mp4`, `out.mp3`, `dub-en.mp4`, a song's `out-1.mp3` and `cover-1.jpg`…), its
  inputs (`in-*`) and its `job.json`;
- `elements/<name>/`: the Library's Elements a prompt cites with `@name` (characters, outfits, objects, places, poses,
  brands; voices picked as a voice), their images or clips and `element.json` (type, words);
- `styles/<name>/`: the user's own styles, a few images of a look and its words (`style.json`);
- `ledger.jsonl`: every paid action, in the provider's unit;
- `settings.json`: the active router, the confirmation thresholds, the monthly caps, the ElevenLabs plan and the
  default models.

Talk to the user in French. Write prompts for the models in English, unless the user wants on-screen text in
another language. The dashboard is in English.

## Before anything

Run `media.mjs doctor` once per conversation.
- A missing tool: give its install command and stop.
- `openrouter: no key`: nothing can be generated. Tell the user to set it with `/plugin configure skill-video@pabrisson`
  (a key from openrouter.ai/keys), then restart the session. `tools`, `models` and the dashboard still work.
- `active router: …, without its key`: the router picked in Settings has no key. Same as above for that router (a
  Kie key from kie.ai/api-key), or switch back to the other one if the user prefers.
- `elevenlabs: no key`: no voice change and no translation; Voice takes the router's ElevenLabs voices. Everything else
  works.
- `missing cloudflared`: a video or a voice cannot reach OpenRouter (video edits, upscale, talking avatar). Give
  `brew install cloudflared` (no account needed). Everything else works, and Kie needs none (it takes the files by its
  own upload).
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
  The user's own image can be the keyframe (the dashboard's « Your image », from the computer or the Library): step 2
  straight with it; the Element or photos are then not asked, the keyframe carries the change.
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

The tool's first recommended model on the active router, unless the user names one or it cannot do the job; `media.mjs
tools <kind> --search <tool>` gives each recommended model with why (ranked on Artificial Analysis' leaderboards,
October 2026: GPT Image 2.5 Sunburst first for images, MiniMax H3 first for new videos, Wan 3.0, Seedance 2.5, Kling
4.0 after it). Say why when you pick one the user did not. Each
router has its own list (`providers/openrouter-models.json`, `providers/kie-models.json`), each model with what it
takes there: the same model may do more on one (Seedance 2.5 on Kie edits a video and goes to 1080p, through
OpenRouter it does neither; Kling 3.0 is 720p on OpenRouter, up to 4K on Kie). A model named in a remix or a
default of the other router runs on the active one when it has it; otherwise the command says so: pick another or
offer to switch the router.

**On Kie** (`media.mjs credits` says which router is active): the video edits (Custom edit, Restyle, Object swap,
Clean up, Inpaint, Face swap, Relight, Recolor) go to Seedance 2.5 first, which takes the video, the Elements'
images and up to 1080p, then Kling 4.0 (it remakes the shot from the video at the source's length, cheaper, Elements
beside it), Kling 3.0 Omni Transformation and Wan 2.7 Video Edit; no Aleph 2 there, so no keyframe
step. Object swap also runs on Wan 2.2 Animate Replace (not recommended, $0.03–0.06 a second, 480p to 720p): the
person of the video becomes the one of an Element's main view or of one photo, motion and expressions kept, no prompt
(the « Replace » words and a painted area do nothing there). Upscale video is Topaz (×1, ×2, ×4: ×1.5 runs ×2, ×3 runs ×4), Talking avatar Kling AI Avatar or OmniHuman,
Remove background Recraft. Voice: ElevenLabs straight, or Eleven v3 Dialogue or Gemini TTS on Kie (no cloning there), no FLUX video, no HeyGen. Kling 4.0,
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
- `--option <key>=<value>` (repeat it): the model's own settings by the names its API gives them, a choice by its value
  or its label: `negative_prompt="…"` (Avoid), `prompt_extend=on|off`, `cfg_scale=0.4`, `web_search=on`,
  `return_last_frame=on` (also saves `last-frame.jpg`, to start the next shot from), `output_format=png|jpeg|webp|mov`,
  `output_compression=80`, `thinking_mode=on`, `color_palette="#112233 #445566 #778899"` (3 to 10), `temperature=1.2`,
  `filler_words=on`, `pe_fast_mode=on`, `keep_original_sound=on`, `audio_setting=origin`, `personGeneration=allow_adult`,
  `enable_translation=off`, `loop=on` (Grok: its first frame ends it too), `reference_link_urls=<a public page>` or
  `reference_file_urls=<a PDF, Word, slides…>` (Wan 3.0: a video made from it). OpenRouter's go under its provider's
  name by themselves. One the model lacks is refused with its list.
- **Shots** (Kling 3.0 and 3.0 Omni on Kie): `--shot "<seconds>: <words>"`, one a shot in order (1 to 12 s each, their
  sum a length the model makes, 15 s at most), with `--tool free`; `@names` work in them.
- **Middle frames** (Kling 4.0: up to 8, in order, cited `@keyframe_1`…; Grok Imagine Video: up to 4, each at its time):
  `--in mid_frames=<image>` (Grok: `--in mid_frames=<image>@<seconds>`). Kling 4.0's length caps all its frames, first
  and last included: 3 s → 4, 4 s → 5 … 9 s and more → 10 (refused before, free). No reference image beside frames.
- **Omni references** (Kie: Kling 4.0, Kling 3.0 Omni, Seedance 2.x, Wan 3.0, Wan 2.7, Hailuo 3, Vidu Q4; the counts in
  `models video`): reference videos `--in ref_videos=<video>`, sounds `--in ref_audios=<audio>`, with `--tool free` or
  Cinematic camera, never beside a frame; each within the model's lengths (Kling 4.0 2 to 30 s, 30 s in all; Seedance 2.0
  2 to 15 s, 15 s in all). Kling 4.0 wants each cited: `@image_1`, `@video_1` in the words (the command adds the missing
  ones at the end); 15 references in all (images, videos, Elements, voices). A video given changes the price to the
  model's « with video input » rate.
- **A voice of one's own** (Kling 4.0): `--in ref_voices=<clip>@<Name>`, cited `@Name` in the words; up to 3 with the
  Library's. A character Element can carry its own voice: `elements set Papi --voice @Narrator` (a voice of the
  Library); it then speaks with it wherever `@Papi` is cited on Kling 4.0, without counting among the 3, and on Kling 3.0
  and 3.0 Omni (its first clip, 5 to 30 s). Wan 2.7 on Kie: a reference sound (`--in ref_audios=`) is the voice its
  subjects speak with beside references, the sound the video follows from words alone; a photo and a voice make a
  talking head on it too (Talking avatar, as long as the voice).
- **Spoken lines** (any video model with sound: the lips follow them): `--say "@Papi: Bonjour"`, `--say "@Papi
  (@Narrator): Bonjour"` (in that voice, Kling 4.0), `--say "(@Narrator): Il était une fois"` (off screen), in order;
  written after the words as « @Papi says: "Bonjour" ».
- **Who speaks** (OmniHuman 1.5, Talking avatar): `--in speaker_masks=<mask>`, the person painted white.
- **Library voices** (Kling 4.0): cite a voice Element `@Narrator` in the prompt: its clip goes as the voice of that name.
- **Lip sync** (Edit, Kie only): `video --tool lip-sync --in video=<someone speaking> --in audio=<the new voice>`.
  Volcengine (recommended, $0.04 a second of the voice) keeps the video, no prompt; it lasts as long as the voice
  (trimmed or looped); `--option mode=basic` for a complex scene (several people, cuts), `separate_vocal=on` to clean
  the voice first. Its other models: Seedance 2.0 remakes the shot from the video and the voice as references (4–15 s,
  input and output seconds billed), and the talking heads (Kling AI Avatar, InfiniTalk, OmniHuman) start from one frame
  of the video (`--frame <seconds>`, 0 by default): the motion is new. A photo that speaks is Talking avatar.
- **Speech to video** (Create): `video --tool speech-to-video --in first_frame=<image> --in audio=<voice or song>`, its
  words optional: whoever is in it speaks or sings, the scene moves with the sound, as long as it lasts. Kie: Wan 2.2
  Speech to Video (recommended, 480p/580p/720p, 2.5 to 7.5 s: a longer sound is refused, cut it), Seedance 2.0 (4–15 s),
  Wan 2.7, and the talking heads (Seedance takes the image as a reference beside the sound: Kie refuses a first frame with it); OpenRouter: Wan 2.7 (billed 5 s at least), HeyGen Avatar IV.
- **Draft** (Seedance 2.5 on Kie): `--option draft=on` makes a 480p preview; once the user likes it, `--from-draft
  <generation>` makes its 1080p final within 7 days (no prompt; Kie lists no price for it: an unknown cost, its own yes
  then `--accept-unknown`).
- **Dialogue** (ElevenLabs v4 and v3 straight, Eleven v3 and Gemini TTS on Kie): `--line "<voice>: <words>"`, below.

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

## Elements and styles of the Library

The Library keeps what comes back from one generation to the next. Making or changing an Element or a style is free
and local: no estimate, no yes.

- **Elements** (`elements/<name>/`) each have a type, which tells the model what their images are: `character` (a
  person, a creature, a mascot), `outfit`, `object` (a product, a prop, a vehicle), `location`, `pose` (a body pose,
  nothing else), `brand` (a logo kept exact, its colors and typeface), `voice` (1 to 3 clips of speech: Voice, Change
  voice, a character's own voice), `singer` (1 to 3 sung clips: Music's Singer once Suno has it, below), `other` (one
  made before the types). Switching a voice to a singer and back keeps its ElevenLabs id and its Suno singer.
- **Citing.** `@name` in any image or video prompt (Custom, a tool's words, a raw prompt) sends the Element's images
  after the tool's own and names them: « Lulu (the character in images 2 to 3, <its words>) ». Their images count
  toward the model's references (`N refs`). On Kling 3.0, Kling 3.0 Omni and Kling 4.0 (Kie) they go instead as
  Kling's own named elements, whole: the prompt keeps `@name`, its words and 2 to 4 images go with it (Kling 3.0 takes
  3, the others 7; Kling 4.0 none beside a first or last frame), and they count toward no reference image.
  A style is never cited: it goes in a Style field (`--field style=<name>`).
  A voice is never cited in words either: `audio --tool voice --voice @name` speaks with it (on ElevenLabs, whole; on
  a router's model that clones, its clips cloned and its words saying how it sounds); a singer sings with `--field
  singer=@name`.
- **Making one**, when the user asks (« crée le personnage Lulu avec ces photos », « garde ce produit », « fais-en un
  style ») or pastes « Ask Claude » from the dashboard:
  1. Look at the images (Read) and write what it is in a few English words: they go with every `@name`.
  2. **2 images at least** (a voice: clips): `elements add` refuses fewer. With one image only, make the second view
     yourself with the type's References tool on it (`media.mjs image --tool character|outfit|object|location|pose
     --in references=<the image> --field sheets="<the sheet it lacks>"`, e.g. a full-body turnaround beside a face, a
     detail sheet beside six views): its price, the user's yes, then look at it (Read) and keep it only if it holds the
     identity. A brand or other takes a second version from the user.
  3. `media.mjs elements add <name> <files…> --type <type> --words "…"`; a brand adds `--colors "#hex,#hex"` and
     `--font "…"`, a voice takes audio clips. `--from <generation id>` takes a result's images or clips (several
     `--from` for several). A style: `media.mjs styles add <name> <images…> --words "<the look>"` (1 to 5 images,
     `--from` too).
  4. Photos that are not clean references (a busy background, one angle only) for a type with a References tool:
     offer its sheets first. That is a generation: its price and the user's yes (step 3 above). Then save the sheets
     that came out right, with the photos when they help.
  5. Tell the user the `@name` to cite. The open dashboard shows it at once.
- An Element made before this rule with one image works as before, except on Kling's elements: the command says so;
  make its second view as in step 2 (`elements set <name> --from <that generation>`).
- **Changing one.** `elements set <name> [<files…>] [--type …] [--words …] [--colors …] [--font …] [--drop <file>]`,
  `elements show <name>`, `elements remove <name>`; the same `set`, `show`, `remove` for `styles`. `elements
  elevenlabs <name>` puts a voice on the ElevenLabs account for Change voice (ElevenLabs needs a paid plan for it);
  `elements suno <name>` makes a singer a Suno voice (below).
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

## Voices, music and sounds

Audio has Create and Edit tools like images and videos. ElevenLabs is reached straight with its key (its voices,
dialogues, Change voice, Translate, in its credits), whichever router is active; without its key, the active router's
ElevenLabs voices stand in (OpenRouter: Eleven v4, v4 Turbo, v3, Multilingual v2, Flash and Turbo v2.5; Kie: Eleven v3
Dialogue, Multilingual v2, Turbo v2.5), and there is no voice change and no dubbing. Music and sounds come by the router.

- **Speech** (`audio --tool voice`): `--prompt` is the text read. ElevenLabs' models come first, straight from its API
  (Eleven v4 by default, then v4 Turbo, v3, v3 Conversational, Multilingual v2, Flash and Turbo v2.5); the active
  router's other speech models follow (Gemini TTS, Seed Audio, MiniMax…; no cloning on Kie). `media.mjs models audio`
  lists them with what each takes.
  - On ElevenLabs: `--voice <voice_id>` (`media.mjs voices` lists the account's) or `--voice @name` (a voice of the
    Library, put on the account when the job runs: ElevenLabs' paid plans clone, the free one refuses). A credit a
    character, half on v4 Turbo, v3 Conversational, Flash and Turbo. Audio tags in the text steer v4, v4 Turbo and v3
    (`[whispers]`, `[laughs]`, `[sighs]`, `[excited]`…). Its options, each model its own: `--option stability=0.4`,
    `similarity_boost`, `style`, `speed` (0.7 to 1.2, not on v4), `use_speaker_boost=on`, `language_code=fr`,
    `apply_text_normalization=on|off|auto`; on v3 stability is `Creative`, `Natural` or `Robust`. `--seed` too.
  - On a router's model: a preset voice (`--voice`, its id: ElevenLabs' on Kie are ids like `EkK5I93UQWFDigLMpZcX`, on
    OpenRouter first names like `george`; the dashboard plays their samples), a voice of the Library (`--voice @name`,
    its clips cloned, OpenRouter's models that clone), or a voice cloned from 1 to 3 clips (`--in voice_clips=<file>`);
    `--field instructions="…"` says how it sounds. ElevenLabs' options on Kie: `--option stability=…`,
    `similarity_boost`, `style`, `speed`, `language_code=fr`.
  - A **dialogue** (Eleven v4 and v3 straight, up to 2,000 characters and 10 voices; Eleven v3 on Kie, 5,000; Gemini
    TTS on Kie, 2 voices, « how it sounds » as each line's style, tags like `<laugh>`, `--option temperature=…` and
    `filler_words=on`): one `--line "<voice_id or @name>: <words>"` a line, in order; no `--prompt`.
- **Change voice** (`audio --tool change-voice --in clip=<audio or video> --voice <voice_id>`, ElevenLabs straight): the
  same delivery (pauses, emotion, rhythm) in another voice, put back on the video. `media.mjs voices` lists the
  ElevenLabs voices (its default ones and the account's own). `--voice @name` takes a voice of the Library: one not on
  the account yet is put there when the job runs (ElevenLabs needs a paid plan for that), then kept. A new voice of the
  user's own is a Library voice Element (`elements add <name> <clips…> --type voice`, a minute or more of clean
  speech). `--field denoise=remove` drops the background noise.
- **Translate** (`audio --tool translate --in clip=<file> --field to=en,es`, ElevenLabs straight): a dubbed file per
  language in the speakers' own voices, with its subtitles (`.vtt`). `--field quality=dubbing_v1` (default, 3,000
  credits a minute per language) or `dubbing_v2` (better voices and emotion, 13,500 a minute). **No lip-sync**: say so,
  and offer Lip sync (video Edit) on the dubbed voice.
- ElevenLabs bills credits: give them as `shown` (with their dollars when the plan is set).
- **Music** (`audio --tool music`, Kie: Suno V6, V6 Mini, V6 Wild, $0.06 a request for 2 takes and their covers;
  OpenRouter: Lyria 3 Pro $0.08 a song, Lyria 3 Clip $0.04 for 30 s):
  - Describe (`--field description="…"`, 3,000 characters), with up to 5 images, a video and a sound (6 s or more) for
    inspiration (`--in references=…`, `ref_videos=…`, `ref_audios=…`; Lyria takes images only).
  - Write (`--field mode=write --field title=… --field style="…" --field lyrics="[Verse]…"`): title 80, style 1,000,
    lyrics 5,000 characters; `--field length=10..360` (seconds, Suno V6), `--field vocals=instrumental`, `--field
    singer=@name` (a singer of the Library that Suno has; Describe takes one too, tested 2026-11-01). Suno's options: `vocal_gender=f|m`, `negative_tags="…"` (Avoid),
    `style_weight`, `weirdness_constraint`, `audio_weight` (0–1), `variety=0..4` (Write only, but Avoid).
  - Suno writes lyrics from a theme (`media.mjs lyrics "<theme>"`, 2 versions, $0.002) or a style out richer
    (`media.mjs boost "<style>"`, $0.002): priced like a generation (`--estimate`, then `--spend`).
  - A take's words land in `lyrics.txt`; Suno keeps its files 14 days, the engine downloads them at once.
- **Sound effect** (Kie: Suno Sounds, $0.0125): `--prompt "rain on a tin roof"` (500 characters), `--option
  version=V6|V6_MINI|V6_WILD`, `sound_loop=on`, `sound_tempo=1..300` (0: its own), `sound_key=Am`, `grab_lyrics=on`.
- **Edit** (Kie): `--in clip=<a sound>`; a sound sent whole (not a Suno take) lasts 6 s at least. Extend music (a Suno take goes on by its id, any other sound sent whole;
  `--field from=60`, else its end; style, lyrics, vocals, singer), Cover (the melody in another style, other words or
  singer), Add vocals (an instrumental sung: title, style, lyrics), Add instrumental (a voice gets its music: title,
  style; both send « noise, distortion » as Avoid unless `--option negative_tags=…`: Kie wants one), Mashup (`--in clips=a --in clips=b`, title, style), $0.06 each; Replace section (a Suno song, `--field
  start=30 --field end=45`, 10 s at least, `--field change="…"`, its new words, a singer; $0.025); Stems (a Suno song: `--field
  split=separate_vocal` voice + music $0.05, `split_stem` up to 12 $0.25, `split_stem_advanced --field
  instrument="Lead Vocal"` one instrument: each take's instrument alone and the song without it, $0.10).
- **Isolate voice** (`audio --tool isolate-voice --in clip=<audio or video>`, always ElevenLabs straight, whichever
  router, 1,000 credits a minute): the voice alone, music, noise and room taken out; a video comes back with its voice
  alone, a sound as an MP3. Kie's Voice Isolator is discontinued.
- **A Suno song's extras** (Kie, its viewer's actions; `--in clip=<a take>`): `--tool wav` ($0.002 a track; a stem of the
  Stems tool too; several `--in clip=` make one job, a WAV per track named after it: the viewer's « All in WAV »), `--tool
  lyrics-timings` (each sung word with its time: `lyrics.srt`, `lyrics.json`, $0.0025), `--tool music-video` (an MP4
  with its cover, `--field author=… --field domain_name=…`, $0.01), `--tool midi --in clip=<a stem>` (its notes,
  `notes.json`, free), `--tool singer --field name=Nova --field description="…"` (a singer of the Library, free: Suno's
  persona of the take from 10 to 30 s where it sings, found unless `--field start=20 --field end=40`; its clip is that
  part, its picture the take's cover; Kie takes its style up to 256 characters, the engine cuts it).
- **Singer** (`audio --tool create-singer --field name=aria --field voice="a warm, breathy female pop voice" --field
  style="dreamy synth-pop"`, Kie, $0.16): a singer made by AI. Suno sings a short song in that voice (2 takes, $0.06),
  then each take's voice is taken apart from the music (Suno's split, $0.05 each): `voice-1.mp3` beside `out-1.mp3`.
  Then `--tool singer --in clip=<voice-1.mp3> --field name=Aria --field description="…"` keeps it (free), the voice
  alone as its clip. When the user wants a singer and has no voice of their own, this is the way.
- **One's own singing voice in Suno** (free, Kie): a singer of the Library (`elements add <name> <sung clips…> --type
  singer`; a recording over music is better cleaned first with Isolate voice: Suno hears a voice best a cappella), then
  `elements suno <name>` gives a phrase to sing (from the 30 s where its first clip sings the most, or `--start <s>
  --end <s>`); the user records it in the same voice, then `elements suno <name> --verify <recording>`. Suno's way to
  prove the voice is theirs: it cannot be done for them. The Singer fields take it (Music, Extend, Cover, Mashup,
  Replace section; not Add vocals, Kie's has no singer).

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
  is an entry in `engine/tools/styles.json`.
