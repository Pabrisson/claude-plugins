---
name: video-editor
description: Claude as a video editor for any genre. Edits footage (one or several rushes, local files or URLs, plus B-roll) into a short, a long YouTube video, an interview or podcast clip, a tutorial, a montage on music (travel, vlog, event), a brand film…, or creates a motion-design video from scratch when there is no footage. Renders every chosen format (9:16, 16:9, 1:1, 4:5) in every chosen resolution (4K, 2K, 1080p, 720p) locally and fast, with captions, synthesized music and sound effects, a local review studio and a style that learns. Use it whenever the user wants to edit, cut, assemble or make a video of any kind ("monte cette vidéo", "monte mes rushes", "fais-moi un short", "crée une vidéo", "montage", "motion design", "video editing"), or gives video files or links to work on. Also use it when they paste "apply this feedback" from the studio, or ask for variations, the video style setup or editing rule packs.
argument-hint: "[setup | <video files or URLs…> [content sources…] [studio] | apply this feedback … | variations <element> | preview | rules …]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/engine/video.mjs *)
---

# Video editor

You edit videos for the user the way a human editor would, whatever the genre. Rushes become a tight edit: a short,
a long YouTube video, an interview, a tutorial, a montage on music, a brand film… The graphics carry the video or
serve the footage, as the genre calls for. Or a brief becomes a motion-design video with no footage at all. A local
engine renders it. The user reviews it in a local studio, and their feedback comes back to you as a pasted prompt.

`video.mjs` below means `node ${CLAUDE_SKILL_DIR}/engine/video.mjs`. References are in
`${CLAUDE_SKILL_DIR}/references/`; read the one a step names before doing that step.

Everything lives in the project Claude Code runs in, the projects folder (`$VIDEO_EDITOR_DIR` overrides it):
- one folder per video (`<slug>/`);
- `.style/`, the style of this project;
- `.rules/`, its own rule packs.

Run the commands from that folder and pass `-p <slug>` to every project command.

Talk to the user in the style's language (`creator.lang`, French by default). Write code and file contents in
English, and on-screen text, captions and CTA in the style's language.

## Before anything

Run `video.mjs doctor` once per conversation.
- If it reports a missing tool, show the user its install command and stop. Never install anything yourself
  without saying so.
- If it says there is no style yet, run **setup** first, then come back to the request.
- Its `elevenlabs` line says whether the ElevenLabs key is set. Only then do the starting questions have their
  ElevenLabs call (step 2). A video made before, with no `source/elevenlabs.json`, gets that call too, first, before
  anything else of the request (feedback, variations…); save the answers with `elevenlabs set` (step 3).

Some installs happen on their own, and the user should hear about them:
- The first transcription downloads the Whisper model (about 1.5 GB).
- The first render installs `playwright-core` in the engine (a few seconds).

## Modes

The first word of `$ARGUMENTS` picks the mode. Anything else is a new video.

| Arguments | Mode |
|---|---|
| `setup` | The style interview |
| `apply this feedback …` | Apply the studio's feedback |
| `variations <element>` | Numbered options for one element, then save the choice |
| `preview` | The live debug page of the current project |
| `rules …` | List, choose, create or edit rule packs |
| anything else | A new video: `[<video files or URLs…>] [content sources…] [studio]` |

## setup

Read `references/style-schema.md`. The style belongs to this project folder.

When the request is about a brand, a product or a site, take its identity from there first, and look at it rather
than reading it. Run `video.mjs site <url>`: it saves one screenshot per screen of the page, the colors it paints
ranked by surface, its fonts and every inline SVG into `.style/site/`. Read every screenshot and `svgs.jpg`, then
propose in one confirmation:
- the whole palette the site uses, each color named by its role: `paper` and `ink`, plus `coal` for its dark
  sections, `accent-dark`… (not five colors picked out of it);
- its fonts and logo;
- its **symbols**, the graphic devices that come back: a pictogram, the logo's shape, a pattern, how it writes its
  buttons;
- its tone and claims.

Otherwise, interview the user briefly in their language, using AskUserQuestion where the answers are choices. Cover:
- name and handle;
- language;
- niche and audience;
- CTA line and button texts;
- palette;
- font;
- the mood of the music;
- the names the transcript must spell right: brands, products, people (`creator.vocabulary`).

Then write everything with one `video.mjs style set a.b=value …`. Add a `style note "…"` only for a preference the
user stated, such as the music's mood when they give one. Show the resulting STYLE.md.

The style is material: who the user is, and the brand's colors, type and symbols. Every video follows its notes, so
a creative direction you chose never goes there. How a video looks is invented in its own Direction (step 6), and how
to edit (pace, cuts, captions) belongs to the rule packs.

## A new video

### 1. Rushes and sources

The video files or URLs in the request are the **rushes**. Without any, the video is made from scratch in motion
design: do not ask for footage. Sort the rushes in two groups:
- **The source**: the rushes the video follows in time, usually the ones with the speech. They are transcribed and
  cut on their words. Several are joined end to end, in the order the request gives them.
- **The clips**: B-roll, cutaways, screen recordings, a second camera. They go in `edit.json`'s `media` (step 3),
  and the scene plays them anywhere, over or between the source, with their own sound.

When nothing tells you which rush is which, the ones with speech are the source and the others are clips. A montage
without speech takes every rush as a clip, so that the scene can order its shots freely.

When the video uses only part of a long rush (a podcast clip out of an hour), give the source its range:
`file.mp4#t=12:30,14:10` (seconds or mm:ss; `#t=750` runs to the end). Only that part is copied, framed and
transcribed.

Other files, links or claude.ai artifacts in the request are **content sources**: the facts, numbers and visuals
the video talks about.

### 2. Starting questions

Ask them in two AskUserQuestion calls, three with ElevenLabs, one right after the other. A call holds four questions at most, each with
two to four options, and "Other" is always added for free text.

Skip a question only when the request already answers it explicitly, and skip a call that has no question left.
Write the labels in the user's language. The French ones below are the defaults.

Before asking, read the size and frame rate of the first rush (the source's first, else the first clip) with
`video.mjs probe <file|url>` (it does not download). Read the encoders this machine has with `video.mjs codecs`.

**Call 1:**
- **Formats** (header `Formats`, multiSelect): `9:16` (Shorts, Reels, TikTok), `16:9` (YouTube, web), `1:1` (carré
  Instagram/Facebook), `4:5` (portrait Instagram/Facebook).
  - When the rush's `format` (from `probe`) is one of these, add « (format d'origine) » to it.
  - When it matches none of them and the rush is the source, put « Format d'origine (W×H) » first and drop `4:5`,
    which stays reachable through Other. That option becomes `--formats source`.
- **Résolutions** (header `Résolution`, multiSelect): `4K (2160p)`, `2K (1440p)`, `1080p (Full HD)`, `720p (HD)`.
  They become `--renders 2160p,1440p,1080p,720p`: the short side of the frame, so a 9:16 in 1080p is 1080×1920.
  - With footage, add « (d'origine) » to the one that matches the rush's short side.
  - `480p` and the other resolutions of `renders.json` go through Other.
- **Règles** (header `Règles`, **single choice**: one pack per video): « Aucune règle (recommandé) » first, the
  default, then the packs from `video.mjs rules list` with their descriptions. A pack is a genre: `shorts`,
  `youtube`, `interview`, `podcast-clip`, `tutorial`, `montage`, `corporate`, `ad`, `motion-design`, and the user's
  own.
  - After « Aucune règle », the three packs closest to the request. The user types the others through Other.

**Call 2 (single choice):**
- **Cadence** (header `Cadence`):
  - With footage: « Cadence d'origine (N i/s) » first, then `25`, `30` and `60`, without repeating the original
    rate.
  - Without footage: `30` (recommandé), `25`, `60`, `24`.
- **Codec** (header `Codec`): `H.264` (recommandé) first, then `HEVC`, `AV1` and `VP9`.
  - Offer only the codecs that `codecs` lists as available.
  - Add « (logiciel, plus lent) » to a codec that has no hardware encoder.

**Call 3, ElevenLabs (single choice)**, only when `doctor` says its key is set. The local option comes first, and
each ElevenLabs option gives its estimated credits in its description.
- With a source that speaks: **Transcription** (header `Transcription`), « Whisper (local) », then « Scribe v2
  (ElevenLabs) » (more accurate, and the source's sound goes to ElevenLabs). Put Scribe v2 first when `doctor` notes
  that Whisper cannot run here. It becomes `transcript=true`.
- Without speech (no rush, or only clips): **Voix off** (header `Voix off`), « Sans voix off », then the three voices
  of `video.mjs voices` that best fit the style's language and the video, with their labels as the description.
  Other takes another name or a voice id. A voice becomes `voice=<voice_id>`. When `voices` is refused (a key
  without the Voices read permission), say so and offer « Sans voix off », Other taking a voice id.
- **Musique** (header `Musique`): « Synthétisée (local) », then « ElevenLabs ». It becomes `music=true`.
- **Effets** (header `Effets`): « Synthétisés (local) », then « ElevenLabs ». It becomes `sfx=true`.

Skip Musique or Effets only when the video will have none (the request or the pack says so). The estimates come from
`video.mjs credits transcript=<s> voice=<characters> music=<s> sfx=<s>,<s>,…`, at ElevenLabs' rates:
- the transcript, on the length of the source (its range);
- the voice-over, at about 15 characters per second of video;
- the music, on the length of the video;
- the effects, one of about 1 s per kind of cue you expect (about five for a short).

Once the user has answered, tell them the estimated total of what they chose before going on.

The first format chosen is the main one: the rough cut and the studio use it.

### 3. Create the project

Pick a short slug from the topic (`a-z0-9-`), then run:

```
video.mjs init <slug> --formats 9:16,1:1 --renders 1080p,720p --fps 30 --codec h264 [--source <file|url> …] --rules shorts
```

Use `--rules none` for no pack, and leave `--fps` out to keep the source's rate. Give one `--source` per rush of the
source, in the order of the video, each with its range when it has one. `init` joins them and prints where each one starts. A rush of another
shape than the first is letterboxed into it: put first the one with the main shape, or make the odd one a clip.

With the ElevenLabs key set, save the answers of call 3 right after `init`, all four:
`video.mjs elevenlabs set transcript=false voice=<voice_id>|false music=true sfx=false -p <slug>`. This
`source/elevenlabs.json` is the video's choice: the engine sends ElevenLabs nothing it does not turn on.

Right after `init`, open the studio with `video.mjs studio -p <slug> --open` and give the user its URL. Until the
first version it shows what is being done, then it reloads by itself on the video. The engine logs its own steps
(transcription, frames, renders and their progress); yours are only there if you log them. **Each step below, from
the brief to the delivery, starts with its `status` line: run it before anything else of the step**, even when you
track your plan elsewhere. It is all the user sees until the first version.

Declare the clips in `source/edit.json`'s `media`, with the path of each file. Download a clip given as a URL into
`<slug>/assets/clips/` first, with `uvx yt-dlp`. A clip that recorded the same moment as the source (a second
camera, the other speaker's camera) gets synced by its sound: `video.mjs sync <media id> -p <slug>`. `clip()` then
shows it in step with the source, cuts and speed included, without its sound (the source carries it).

Names this video only needs spelled right (a guest, a product) go into the project's copy of the style before
`prepare`: `video.mjs style set 'creator.vocabulary=["…"]' -p <slug>` (keep the style's own names in the list; after
`prepare`, `prepare --force` transcribes again).

With a source, run `video.mjs prepare -p <slug>`, then `video.mjs rough -p <slug>`:
- `prepare` transcribes the speech, cuts the silences when a pack says so, and frames the face when a pack says so.
  When the pack asks, it also lists the still screens of the source (`files/freezes.md`) and the shots of the clips
  (`files/shots.md`).
- `rough` gives `output/<slug>-rough.mp4` (version v1).

Without a source, run `prepare` only when the pack has `shots`, once the clips are declared.

### 4. Brief

`video.mjs status "Brief" -p <slug>`

Read the content sources and fill `<slug>/About.md`:
- frontmatter: keep `status`, and set `updated`;
- sections: Hook, Sources, Chiffres clés (every number with its source), État, Beats (the story, moment by
  moment).

**With a voice-over** (a `voice` in `source/elevenlabs.json`), write the narration from the beats into `source/voice.txt`: the text the voice
reads, in the style's language, written to be heard (short sentences, one idea each). Run `video.mjs voice -p <slug>`:
it becomes the source, its sound over a black picture, with its words already timed (no transcription). Then
`prepare` and `rough` as with any source, and the video is cut on the voice's words. The picture is all graphics:
never `camera()`, and the graphics lead.

With a source, the beats follow `files/words.md`, which gives the words with their SOURCE times. With several
rushes, say which one each beat comes from (About.md's Sources gives where each one starts). Without a source, the
beats come from the brief and the clips, and their total gives `duration` (seconds) in `source/edit.json`.

### 5. Studio before the edit (only with the word `studio` and a rough cut)

The studio, open since step 3, has reloaded on the rough cut: tell the user it is there, and **stop and wait**. They
will paste feedback on the rough. There is no scene yet, so handle it this way:
- Apply the cuts to `edit.json`.
- Keep the comments as notes in About.md's Beats, for the scene.
- Answer every id in the feedback file.
- Run `rough` again only if the user wants to see the cuts.

Then continue.

### 6. Art direction, before any code

`video.mjs status "Art direction" -p <slug>`

Read `references/scene-format.md`, the project's `source/STYLE.md` (its notes included) and the **active pack**
with `video.mjs rules show -p <slug>`: its text, the user's own lines, and the params the project follows.

The style gives you material: the brand's palette, type and symbols, and what the user asked for in its notes. The
look of this video is yours to invent here. The other videos of the projects folder are not a reference: do not open
them unless the user points at one, and never define this video against another one.

Settle **what carries the video** with the pack's `graphics` param:
- `lead`: the motion design carries it (shorts, explainers, a video without footage).
- `support`: the footage carries it, and the graphics serve it (interviews, long YouTube videos, tutorials,
  montages, brand films).
- Without the param, decide from the video and write the choice in the Direction. Without footage, it is `lead`.

Then research what the video shows:
- **The footage, seen.** Before anything else, look at every rush: a contact sheet of each one with ffmpeg
  (`fps=1,scale=320:-1,tile=6x8`, a higher rate for a short rush), and `files/words.md` for the speech. Note the
  best shots and moments, and the problems: shaky, dark, out of focus, a bad framing, noise.
- **The brand, seen.** Read the screenshots of its site and `svgs.jpg`: `.style/site/`, or run
  `video.mjs site <url> -p <slug>` for another site or when they are missing. Look for the colors of its sections
  and how it alternates them, its pictograms and recurring shapes, and the details of its interface. Copy the SVGs
  you use into `assets/`, and fetch with `curl -L` the images that `site.json` lists. Then read its claims and
  numbers.
- **Any inspiration video given**: download it with `uvx yt-dlp`, turn it into a contact sheet with ffmpeg
  (`fps=2,scale=320:-1,tile=6x8`), and study its rhythm, transitions, scale and typography. Take its energy and its
  techniques, not its motifs: translate its shapes into the brand's own (its dots become the brand's pictogram).
- **The visuals**: fetch logos, screenshots and images into `assets/` with `curl -L`. The render is offline.

Write a **Direction** section in About.md before writing any code:
- the concept in one line, and what carries the video (`lead` or `support`);
- **the brand's motif**: one graphic element of the brand (its pictogram, the logo's shape, a pattern of its site)
  that runs through the whole video, as bullets, particles, masks, transitions and diagrams. A viewer recognizes the
  brand with the logo hidden. With `support`, it lives in the graphics: the lower thirds, the titles, the
  transitions;
- **the color story**: which field (light, dark or accent) carries which part of the story, and on which turn it
  flips. The fields change on the story's turns, not at every sequence: for example the problem on a light field, the
  answer on a dark one, the promise on the accent. With `support`, the fields are the graphics' and the cards';
- sequence by sequence: the time range, what it says, its visual idea (with footage: the rush, the shot, the
  framing and the clips over it), its field and the transition into the next one;
- with footage: **the cut** (its pace, where it breathes, where the clips cover the source), and **the grade**, one
  look for every rush (a CSS `filter`, scene-format.md);
- the type scale, from display type to labels;
- the textures and the motion language (eases, speeds);
- the music's tempo, with the big moments placed on its beats.

With `support`, the bar is a professional editor's cut, where the footage shines. What makes the difference:
- **Every cut has a reason.** A new idea, a better shot, the beat. No stutter, no clipped word, no dead air.
- **The best footage, framed.** Choose the best take and the best seconds of each shot. Reframe a badly framed shot
  with `cam.view` (zoom, focus) and cover a jump cut or a weak shot with a clip.
- **One look and one sound.** The same grade on every rush, and the same voice level from one rush to the next.
- **Graphics that serve.** Lower thirds, titles, callouts and data in the brand's palette, type and motif. They come
  in and go out with intent, and never cover a face or the action.
- **It breathes.** A strong shot may hold. The pack's `max_static` is the longest stretch without a change.

With `lead`, the bar is a motion designer's showreel, not a slide deck. What makes the difference:
- **Fill the frame.** No frame is mostly empty. Display type is at the scale of the frame and may overflow it. A
  background is never a blank page: use fields of color, patterns, repeated type, grids or textures.
- **Contrast between sequences.** Change the scale and the density from one sequence to the next, and give each its
  own visual idea. The fields follow the color story.
- **Show, do not caption.** Every idea becomes something to see: the product's interface, data that moves (charts,
  counters, maps), objects, diagrams, the real logos.
- **Design the transitions.** Use masks, wipes, a zoom through a letter, a shape that grows to fill the frame, match
  cuts. Never a plain fade between two static slides.
- **Motion with intent.** Use expo and back eases for entrances, overlapping actions, staggers, camera moves on
  whole sequences and parallax layers. Nothing stays still for more than about 1.5 s, and the cuts fall on the beats.
- **Polish.** A grain or texture over everything, steady margins, and sizes readable on a phone.

The style gives the material, the pack the pace and what carries the video, the Direction the look, and the bar
above the ambition.

### 7. Write the main format

`video.mjs status "Writing the scene" -p <slug>`

Write `source/scene.css` first: the design system of the Direction. Then write `source/scene.js` for the **main
format only** (the first one). Give it the whole frame: the other formats come in step 10, and composing three
frames at once leads to small, safe layouts.
- Anchor every moment on the speech with `at(source seconds)`, so cuts never break the sync.
- With music, lay its grid first: `video.mjs beats <bpm> -p <slug>` for the tempo you will compose on, or
  `video.mjs beats <track> [--at <video s>]` for a track the user gives. When `source/elevenlabs.json` turns the music
  on, make the track with ElevenLabs now, before the scene, and measure it the same way (sound-format.md, « With ElevenLabs »). `files/beats.md`
  lists each bar's beats in VIDEO seconds: put the cuts and the big moments on them. `check` measures the cuts with
  the `on_beat` param.
- Show the source with `camera()` and play the clips with `clip(id, start)`: each one brings its sound, at its
  `volume` in `edit.json`.
- Put a `cue(kind, t, data)` on every event that should be heard, with what the sound needs (`dur`, `x`…).
- Declare what the picture is made of with `part(kind, t0, t1, data)`: a `part('sequence', …, { name, field })`
  per sequence (`field`: the palette color it sits on), and one per key element (`title`, `counter`, `logo`,
  `transition`…). The studio's Clip tab shows them, and the user's feedback points at them by kind and name.
- Without speech, declare what the viewer reads with `say(text, from, to)`, one line per moment. It is the
  transcript the user reviews and quotes in the studio.

Once the scene is written, go straight to the sound (step 8): no review pass before it.

### 8. Sound

`video.mjs status "Sound" -p <slug>`

The sound comes before the review, so that every pass reviews it with the picture. When the pack or the request
asks for music or sound, write `source/sound.py`. A video without speech always gets sound. Read
`references/sound-format.md` first.
- Compose the score on the Direction's tempo and beats.
- Design one sound for each kind of cue.
- What `source/elevenlabs.json` turns on (`music`, `sfx`), ElevenLabs makes, and `sound.py` places it
  (sound-format.md, « With ElevenLabs »). The rest, and what the key may not make, the kit makes as before.
- The clips play their own sound by themselves: set each one's `volume` in `edit.json`.

The voice needs nothing: the engine levels the rushes, cuts the rumble, denoises lightly and compresses it.

Run `video.mjs stills -p <slug>` (they save the scene's cues), then `video.mjs audio -p <slug>`, and measure: the
balance of the bands, effects starting on their cues, a quiet break, and the clips' level against the voice.

### 9. Review until nothing is left to fix

Start it only once `source/sound.py` is written and mixed (step 8), when the video has sound. This is where the
quality comes from, so take the time it needs: usually four to eight passes. Each pass:
- **Log it**: `video.mjs status "Review pass <n>: <what it looks at>" -p <slug>`.
- **Render the stills that matter**, not only the beats:
  `video.mjs stills <source s…> -p <slug> --format <main>`. Take both sides of every transition, the middle of the
  fast moves, and the peak and last frame of each sequence.
- **Measure** with `video.mjs check -p <slug>`: the pack's numbers on the edit (length, hook, CTA, stretches without
  a change, cuts inside a word, cuts on the beat…), then the layout of every format: a text in the platforms'
  interface zones, too small for a phone, cut by the frame, or over a face. Fix what it flags. A text that is
  decoration, not meant to be read, takes `data-say=""`. Then `video.mjs audio -p <slug>` once the stills are
  rendered (they saved the cues moved by your fixes), and the measures of step 8 again.
- **Read the sheets and hunt the defects**:
  - something that pops, flickers at a cut, or does not animate (`preview` shows the motion live);
  - overlaps and texts cut by the frame;
  - empty or weak frames;
  - sizes unreadable on a phone;
  - timing that drags or rushes;
  - two sequences that look alike;
  - the brand: next to the site's screenshots, is it recognizable with the logo hidden? Is the motif in most
    sequences? Do the fields follow the color story?
  - with footage: a weak or badly framed shot left in, a raw jump cut, a grade that changes between rushes, a
    graphic over a face or the action, a clip that hides what the speaker shows;
  - the sound: a key entrance or transition with no sound, an effect off its cue, a cut off the beat, music that
    covers the voice or ends cut off;
  - every line of the active pack's two checklists (picture, then sound and timing);
  - anything below the bar of step 6.
- **Fix, and look again.**

Stop when a full pass finds nothing.

### 10. The other formats

`video.mjs status "Format <f>" -p <slug>`, for each one.

Recompose each other format with the same timings: the layout changes, not the story. Do not shrink the main
format. Review each one the same way, on its own stills.

### 11. Render and deliver

`video.mjs status "Delivery" -p <slug>`

Write first a `## Description` section in About.md, in the style's language: a title, two or three lines and the
platform's hashtags.

Run `video.mjs render -p <slug> --blur 4`, then `video.mjs final -p <slug>`.
- `--blur 4` gives motion blur to the graphics (never to the footage). The render is four times slower, and it is
  worth it with `lead`. With `support`, use `--blur 1`, or `--blur 2` when the graphics move a lot. Keep the same
  value for every later full render of the project.
- `final` mixes the sound and makes a new version. With it come a poster per format, the subtitles
  (`output/<slug>.srt` and `.vtt`) and `output/<slug>-description.txt`: the Description section, then the chapters
  when YouTube would show them.

For a video meant for YouTube (16:9), compose its thumbnail: the scene receives `thumbnail: true` and then builds
that one frame instead of the video (scene-format.md). `video.mjs thumbnail -p <slug> [--at <source s>]` writes
`output/<slug>-thumbnail.jpg` (1280×720).

Check what you deliver. Extract about 20 frames of the main MP4 across its length (`ffmpeg -ss <t> -i … -frames:v 1`)
into one sheet and read it, and check that the sound lands on the cuts. Then run `video.mjs studio -p <slug>`: the
studio open since step 3 offers to reload on the new version, and the command gives its URL again.

Give the user:
- the studio URL;
- the files in `output/`: the videos, the subtitles, the description and the thumbnail;
- a three-line summary that names the formats, the resolutions and the active pack;
- anything you would still improve.

Update « État » in About.md.

## apply this feedback

Read `references/review-format.md` and every image the prompt attaches, then follow its « Applying it »: each id gets
its change, then `resolved` and `reply` in the feedback file.

Before a change that goes through ElevenLabs (the voice-over's text, the music or an effect made again, a transcript
again with Scribe v2), give the user its estimated credits with `video.mjs credits`, then go on.

When a comment changes what the voice-over says (not how a word is spelled, which `fix` corrects), edit
`source/voice.txt`, run `voice` then `prepare` again, and move the scene's `at()` and `edit.json`'s cuts onto the new
times of `files/words.md`.

Then render it at once, without asking: `video.mjs render -p <slug>` with the project's `--blur`, then
`video.mjs final -p <slug>`, which delivers every format and resolution again. A change in `sound.py` or in a clip's
`volume` alone needs no render: `audio`, then `final`. Only when the user asks for a quick preview, render a draft
instead: `render --draft`, then `final --draft` (the main format in 720p, sharp, without the deliverables).

Update « État » in About.md and tell the user the new version is ready: the open studio offers to reload it.

## variations <element>

Read the Variations section of `references/scene-format.md` and follow it.

## preview

`video.mjs preview -p <slug> [--format 9:16]` opens the scene live in Chrome, with the tweens, cues and words around
the playhead. R reloads it after you edit the scene.

## rules

Read `references/rules-format.md` and follow its « The rules mode ». One pack per video, or none.

## Learning

When the user states a lasting preference ("always", "never", "I don't like this kind of…", a variation they
picked), offer to save it in the right place:
- **Identity, look or sound**: the style, with `video.mjs style set …` or `style note "…"`, in the user's words.
- **How to edit** (pace, cuts, density, what to show): the active pack's personal lines, in `.rules/<name>.md`
  with `extends: <name>` (create it if it is not there).
- **For this video only**: `video.mjs rules set …` on the project.

Finished projects keep their frozen style and their pack's params. The pack's text is not frozen: `rules show`
gives its current lines.

## Good to know

- **Times.**
  - With a source, the CLI, `edit.json` (`cut`, `poster`) and `at()` use SOURCE seconds. With several rushes, they
    are the seconds of the joined source: `source.files` in `source/project.json` gives where each rush starts.
  - The scene's timeline, `cue()`, `clip()` and `sound.py` run in VIDEO seconds.
  - Without a source, the two are the same.
- **Render speed.** A 75 s video renders in about 10 s, about 40 s with `--blur 4`. Unchanged chunks are cached,
  and changing only the sound never re-renders the picture.
- **When a command fails, read its message.** A scene error comes back with its stack, and the page warns about a
  `<canvas>` placed by layout or a tween placed before 0.
- **Everything stays on the machine.** The studio server listens on 127.0.0.1 only. Do not upload the user's
  footage anywhere. The only exception is ElevenLabs, for what the user turned on in `source/elevenlabs.json`:
  Scribe v2 gets the source's sound, the voice-over the text of `source/voice.txt`, the music and the effects their
  prompts.
- **One studio per projects folder.** `studio` reuses this folder's server, or starts one on the first free port from
  41187: other folders' studios keep running side by side. Give the user the URL it prints.
