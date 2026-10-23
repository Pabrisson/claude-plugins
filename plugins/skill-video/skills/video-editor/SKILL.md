---
name: video-editor
description: Claude as a video editor. Cuts a talking-head take (local file or URL) into a short or a longer video, or creates a motion-design video from scratch when there is no footage. Renders every chosen format (9:16, 16:9, 1:1, 4:5) in every chosen resolution (4K, 2K, 1080p, 720p) locally and fast, with captions, synthesized music and sound effects, a local review studio and a style that learns. Use it whenever the user wants to edit, cut or make a video, a short, a reel, a TikTok, an animated explainer or motion design ("monte cette vidéo", "fais-moi un short", "crée une vidéo", "montage", "motion design", "video editing"), or gives a video file or link to work on. Also use it when they paste "apply this feedback" from the studio, or ask for variations, the video style setup or editing rule packs.
argument-hint: "[setup | <video file or URL> [content sources…] [studio] | apply this feedback … | variations <element> | preview | rules …]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/engine/video.mjs *)
---

# Video editor

You edit videos for the user the way a human editor would: a talking-head take becomes a tight video with motion
design on every idea, or a brief becomes a motion-design video with no footage at all. A local engine renders it.
The user reviews it in a local studio, and their feedback comes back to you as a pasted prompt.

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
| anything else | A new video: `[<video file or URL>] [content sources…] [studio]` |

## setup

Read `references/style-schema.md`. The style belongs to this project folder.

When the request is about a brand, a product or a site, take its identity from there first: palette, fonts, logo,
tone and claims. Propose it in one confirmation instead of asking from scratch. Otherwise, interview the user briefly
in their language, using AskUserQuestion where the answers are choices. Cover:
- name and handle;
- language;
- niche and audience;
- CTA line and button texts;
- palette;
- font;
- the mood of the music.

Then write everything with one `video.mjs style set a.b=value …`, plus one `style note "…"` per strong preference
(the music's mood is a note). Show the resulting STYLE.md. The style says who the user is and how their videos look and sound. How to
edit (pace, cuts, captions) belongs to the rule packs, not here.

## A new video

### 1. Source

A video file or URL in the request is the source. Without one, the video is made from scratch in motion design:
do not ask for a source. Other files, links or claude.ai artifacts in the request are **content sources**: the
facts, numbers and visuals the video talks about.

### 2. Starting questions

Ask them in two AskUserQuestion calls, one right after the other. A call holds four questions at most, each with
two to four options, and "Other" is always added for free text.

Skip a question only when the request already answers it explicitly, and skip a call that has no question left.
Write the labels in the user's language. The French ones below are the defaults.

Before asking, read the source's size and frame rate with `video.mjs probe <file|url>` (it does not download).
Read the encoders this machine has with `video.mjs codecs`.

**Call 1:**
- **Formats** (header `Formats`, multiSelect): `9:16` (Shorts, Reels, TikTok), `16:9` (YouTube, web), `1:1` (carré
  Instagram/Facebook), `4:5` (portrait Instagram/Facebook).
  - When the source's `format` (from `probe`) is one of these, add « (format d'origine) » to it.
  - When it matches none of them, put « Format d'origine (W×H) » first and drop `4:5`, which stays reachable
    through Other. That option becomes `--formats source`.
- **Résolutions** (header `Résolution`, multiSelect): `4K (2160p)`, `2K (1440p)`, `1080p (Full HD)`, `720p (HD)`.
  They become `--renders 2160p,1440p,1080p,720p`: the short side of the frame, so a 9:16 in 1080p is 1080×1920.
  - With a source, add « (d'origine) » to the one that matches its short side.
  - `480p` and the other resolutions of `renders.json` go through Other.
- **Règles** (header `Règles`, **single choice**: one pack per video): the packs from `video.mjs rules list`,
  with their descriptions, plus « Aucune règle ».
  - Beyond three packs, the user types the others through Other.

**Call 2 (single choice):**
- **Cadence** (header `Cadence`):
  - With a source: « Cadence d'origine (N i/s) » first, then `25`, `30` and `60`, without repeating the
    original rate.
  - Without a source: `30` (recommandé), `25`, `60`, `24`.
- **Codec** (header `Codec`): `H.264` (recommandé) first, then `HEVC`, `AV1` and `VP9`.
  - Offer only the codecs that `codecs` lists as available.
  - Add « (logiciel, plus lent) » to a codec that has no hardware encoder.

The first format chosen is the main one: the rough cut and the studio use it.

### 3. Create the project

Pick a short slug from the topic (`a-z0-9-`), then run:

```
video.mjs init <slug> --formats 9:16,1:1 --renders 1080p,720p --fps 30 --codec h264 [--source <file|url>] --rules shorts
```

Use `--rules none` for no pack, and leave `--fps` out to keep the source's rate. With a source, run
`video.mjs prepare -p <slug>`, then `video.mjs rough -p <slug>`:
- `prepare` transcribes the speech, cuts the silences when a pack says so, and frames the face when a pack says so.
- `rough` gives `output/<slug>-rough.mp4` (version v1).

### 4. Brief

Read the content sources and fill `<slug>/About.md`:
- frontmatter: keep `status`, and set `updated`;
- sections: Hook, Sources, Chiffres clés (every number with its source), État, Beats (the story, moment by
  moment).

With a source, the beats follow `files/words.md`, which gives the words with their SOURCE times. Without one, the
beats come from the brief, and their total gives `duration` (seconds) in `source/edit.json`.

### 5. Studio before the edit (only with the word `studio` and a rough cut)

Run `video.mjs studio -p <slug> --open`, tell the user the URL, and **stop and wait**. They will paste feedback on
the rough. There is no scene yet, so handle it this way:
- Apply the cuts to `edit.json`.
- Keep the comments as notes in About.md's Beats, for the scene.
- Answer every id in the feedback file.
- Run `rough` again only if the user wants to see the cuts.

Then continue.

### 6. Art direction, before any code

Read `references/scene-format.md`, the project's `source/STYLE.md` (its notes included) and the **active pack**
(`rules list` gives its file; its params are in `source/rules.json`).

Then research what the video shows:
- **The brand or product**: its colors, fonts, logo (take the SVG from the site when there is one), claims and
  numbers.
- **Any inspiration video given**: download it with `uvx yt-dlp`, turn it into a contact sheet with ffmpeg
  (`fps=2,scale=320:-1,tile=6x8`), and study its rhythm, transitions, typography and colors.
- **The visuals**: fetch logos, screenshots and images into `assets/` with `curl -L`. The render is offline.

Write a **Direction** section in About.md before writing any code:
- the concept in one line;
- sequence by sequence: the time range, what it says, its visual idea, its field (light, dark or accent) and the
  transition into the next one;
- the type scale, from display type to labels;
- the textures and the motion language (eases, speeds);
- the music's tempo, with the big moments placed on its beats.

The bar is a motion designer's showreel, not a slide deck. What makes the difference:
- **Fill the frame.** No frame is mostly empty. Display type is at the scale of the frame and may overflow it. A
  background is never a blank page: use fields of color, patterns, repeated type, grids or textures.
- **Contrast between sequences.** Alternate light, dark and accent fields, scales and densities. Each sequence has
  its own visual idea.
- **Show, do not caption.** Every idea becomes something to see: the product's interface, data that moves (charts,
  counters, maps), objects, diagrams, the real logos.
- **Design the transitions.** Use masks, wipes, a zoom through a letter, a shape that grows to fill the frame, match
  cuts. Never a plain fade between two static slides.
- **Motion with intent.** Use expo and back eases for entrances, overlapping actions, staggers, camera moves on
  whole sequences and parallax layers. Nothing stays still for more than about 1.5 s, and the cuts fall on the beats.
- **Polish.** A grain or texture over everything, steady margins, and sizes readable on a phone.

The style and the pack decide the look and the pace; the bar above decides the ambition.

### 7. Write the main format

Write `source/scene.css` first: the design system of the Direction. Then write `source/scene.js` for the **main
format only** (the first one). Give it the whole frame: the other formats come in step 9, and composing three
frames at once leads to small, safe layouts.
- Anchor every moment on the speech with `at(source seconds)`, so cuts never break the sync.
- Put a `cue(kind, t, data)` on every event that should be heard, with what the sound needs (`dur`, `x`…).

### 8. Review until nothing is left to fix

This is where the quality comes from, so take the time it needs: usually four to eight passes. Each pass:
- **Render the stills that matter**, not only the beats:
  `video.mjs stills <source s…> -p <slug> --format <main>`. Take both sides of every transition, the middle of the
  fast moves, and the peak and last frame of each sequence.
- **Read the sheets and hunt the defects**:
  - something that pops, flickers at a cut, or does not animate (`preview` shows the motion live);
  - overlaps and texts cut by the frame;
  - empty or weak frames;
  - sizes unreadable on a phone;
  - timing that drags or rushes;
  - two sequences that look alike;
  - anything below the bar of step 6.
- **Fix, and look again.**

Stop when a full pass finds nothing.

### 9. The other formats

Recompose each other format with the same timings: the layout changes, not the story. Do not shrink the main
format. Review each one the same way, on its own stills.

### 10. Sound

When the pack or the request asks for music or sound, write `source/sound.py`. A video without speech always gets
sound. Read `references/sound-format.md` first.
- Compose the score on the Direction's tempo and beats.
- Design one sound for each kind of cue.

Run `video.mjs audio -p <slug>` and measure: the balance of the bands, effects starting on their cues, and a quiet
break.

### 11. Render and deliver

Run `video.mjs render -p <slug> --blur 4`, then `video.mjs final -p <slug>`.
- `--blur 4` gives motion blur. The render is four times slower, and it is worth it for motion design. Use
  `--blur 1` for a talking head, and keep the same value for every later render of the project.
- `final` mixes the sound and makes a new version.

Check what you deliver. Extract about 20 frames of the main MP4 across its length (`ffmpeg -ss <t> -i … -frames:v 1`)
into one sheet and read it, and check that the sound lands on the cuts. Then run
`video.mjs studio -p <slug> --open`.

Give the user:
- the studio URL;
- the files in `output/`;
- a three-line summary that names the formats, the resolutions and the active pack;
- anything you would still improve.

Update « État » in About.md.

## apply this feedback

The pasted prompt lists changes, each with an `[id …]`, and names the feedback file `files/reviews/vN.json`.
Read `references/review-format.md`, and read every attached image. Then handle each id:
- **CUT**: add `[s0, s1]` (SOURCE seconds) to `cut` in `source/edit.json`. Check in `files/words.md` that the cut
  falls between words.
- **COMMENT**: change the scene at that moment.
  - `[format …]` is the format the user was looking at. Change that format only when the request is about its
    composition (placement, size, framing, what the frame cuts). A change of content, text, numbers, timing or
    sound applies to every format.
  - Change only what is asked and keep the rest identical: the user has already approved it.
- In the feedback file, set `"resolved": true` and write one sentence in `reply` saying what you changed.

Then run `stills` if the change is visual, then `render` (with the project's `--blur`) and `final`. Update « État » in About.md and tell the
user to reload the studio.

## variations <element>

Show 6 to 9 numbered options of one element, for example the counter's typography or the caption look.
- **Visual**: make the scene read `variant` around that element only, then run
  `video.mjs stills <source s> --variants N -p <slug>`. Read `stills/<ratio>/variants/contact.jpg` and show the
  user its path.
- **Sound** (music or effects): make `source/sound.py` read `v.variant` around that part only, then run
  `video.mjs audio -p <slug> --at <source s> --variants N`. It writes 8 s per option into `stills/sound/<n>.wav`;
  give the user the paths to listen to.

Once the user picks, write the choice into the scene or `edit.json` with no `variant` left. Then ask whether the
choice should become the user's default. If yes, record it as the learning rule below says.

## preview

`video.mjs preview -p <slug> [--format 9:16]` opens the scene live in Chrome, with the tweens, cues and words around
the playhead. R reloads it after you edit the scene.

## rules

- `rules`: run `video.mjs rules list`.
- `rules use <a,b|none>`: run `video.mjs rules use … -p <slug>`. With a source, rerun `prepare` then `rough`.
- `rules new <name>`: read `references/rules-format.md`, ask a few questions, and write
  `.rules/<name>.md` in the projects folder. Check that it appears in `rules list`.
- `rules edit <name>`: copy the plugin's pack into the projects folder's `.rules/` if it is not there yet, then edit the
  copy. Never edit the packs inside the plugin: updates replace them.

## Learning

When the user states a lasting preference ("always", "never", "I don't like this kind of…", a variation they
picked), offer to save it in the right place:
- **Identity, look or sound**: the style, with `video.mjs style set …` or `style note "…"`.
- **How to edit** (pace, cuts, density, what to show): the personal copy of the active pack concerned, in
  `.rules/`. If several packs are active, ask which one.

Finished projects keep their frozen style and packs. Nothing changes them after the fact.

## Good to know

- **Times.**
  - With a source, the CLI, `edit.json` (`cut`, `poster`) and `at()` use SOURCE seconds.
  - The scene's timeline, `cue()` and `sound.py` run in VIDEO seconds.
  - Without a source, the two are the same.
- **Render speed.** A 75 s video renders in about 10 s, about 40 s with `--blur 4`. Unchanged chunks are cached,
  and changing only the sound never re-renders the picture.
- **When a command fails, read its message.** A scene error comes back with its stack, and the page warns about a
  `<canvas>` placed by layout.
- **Everything stays on the machine.** The studio server listens on 127.0.0.1 only. Do not upload the user's
  footage anywhere.
