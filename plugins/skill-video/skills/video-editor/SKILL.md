---
name: video-editor
description: A video editor for any genre. Edits footage (one or several rushes, local files or URLs, plus B-roll) into a short, a long YouTube video, an interview or podcast clip, a tutorial, a montage on music (travel, vlog, event), a brand film…, or creates a motion-design video from scratch when there is no footage. Renders every chosen format (9:16, 16:9, 1:1, 4:5) in every chosen resolution (4K, 2K, 1080p, 720p) locally and fast, with captions, music and sound effects synthesized or generated (with media-generator, as are voice-overs, transcripts and clips), a local review studio and a style that learns. Use it whenever the user wants to edit, cut, assemble or make a video of any kind ("monte cette vidéo", "monte mes rushes", "fais-moi un short", "crée une vidéo", "montage", "motion design", "video editing"), or gives video files or links to work on. Also use it when they paste "apply this feedback" from the studio, or ask for variations, the video style setup or editing rule packs.
argument-hint: "[setup | <video files or URLs…> [content sources…] [studio] | apply this feedback … | variations <element> | preview | rules …]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/engine/video.mjs" *), Bash(node ${CLAUDE_SKILL_DIR}/engine/video.mjs *)
---

# Video editor

You edit videos for the user the way a human editor would, whatever the genre. Rushes become a tight edit: a short,
a long YouTube video, an interview, a tutorial, a montage on music, a brand film… The graphics carry the video or
serve the footage, as the genre calls for. Or a brief becomes a motion-design video with no footage at all. A local
engine renders it. The user reviews it in a local studio, and their feedback comes back to you as a pasted prompt.

`video.mjs` below means `node "${CLAUDE_SKILL_DIR}/engine/video.mjs"`, the path in double quotes (it can hold spaces or,
on Windows, backslashes); the skill runs on macOS, Linux and Windows. References are in
`${CLAUDE_SKILL_DIR}/references/`; read the one a step names before doing that step.

Any agent can run this skill: `${CLAUDE_SKILL_DIR}` is this skill's folder, the one holding this SKILL.md (an agent
that does not replace it uses that folder's path; media-generator is its sibling folder); AskUserQuestion is your tool
for multiple-choice questions to the user (none: numbered choices in the chat, then wait for the answer). The keys are
environment variables (ELEVENLABS_API_KEY, OPENROUTER_API_KEY, OPENROUTER_MANAGEMENT_KEY, KIE_API_KEY): Claude Code's
`/plugin configure skill-video@pabrisson` exports them, any other agent reads them from its environment.

Everything lives in the project the agent runs in, the projects folder (`$VIDEO_EDITOR_DIR` overrides it):
- one folder per video (`<slug>/`);
- `.style/`, the style of this project;
- `.rules/`, its own rule packs;
- `.sound/`, its sound effects, which all its videos play.

Run the commands from that folder and pass `-p <slug>` to every project command.

Talk to the user in the style's language (`creator.lang`, French by default). Write code and file contents in
English, and on-screen text, captions and CTA in the style's language.

## Before anything

Run `video.mjs doctor` once per conversation.
- If it reports a missing tool, show the user its install command and stop. Never install anything yourself
  without saying so.
- If it says there is no style yet, run **setup** first, then come back to the request.
- Its `generation` line says whether media-generator has a key. Only then do the starting questions have their
  Génération call (step 2, `references/new-video.md`), and can a medium be generated (« Generating a medium »).

Some installs happen on their own, and the user should hear about them:
- The first transcription downloads the Whisper model (about 1.5 GB).
- The first render installs `playwright-core` in the engine (a few seconds).

## Modes

The first word of `$ARGUMENTS` picks the mode. Anything else is a new video.

| Arguments | Mode |
|---|---|
| `setup` | The style interview (`references/style-schema.md`, « The setup mode ») |
| `apply this feedback …` | Apply the studio's feedback |
| `variations <element>` | Numbered options for one element, then save the choice |
| `preview` | The live debug page of the current project |
| `rules …` | List, choose, create or edit rule packs |
| anything else | A new video: `[<video files or URLs…>] [content sources…] [studio]` |

## setup

Read `references/style-schema.md` and follow its « The setup mode ».

## A new video

Steps 1 to 5 (the rushes and sources, the starting questions, the project, the brief, the studio before the edit) are
in `references/new-video.md`: read it first and follow them, then come back here for step 6. Each step, from the brief
to the delivery, starts with its `status` line: run it before anything else of the step.

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
  `video.mjs beats <track> [--at <video s>]` for a track the user gives. When the starting questions chose a generated
  music, make it now, before the scene (sound-format.md, « Generated sounds »), and measure it the same way. `files/beats.md`
  lists each bar's beats in VIDEO seconds: put the cuts and the big moments on them. `check` measures the cuts with
  the `on_beat` param.
- Show the source with `camera()` and play the clips with `clip(id, start)`: each one brings its sound, at its
  `volume` in `edit.json`.
- Put a `cue(kind, t, data)` on every event that should be heard, at the instant it peaks: a kind of the sound
  catalog for a common event, a kind of your own for the others (sound-format.md), and what the sound needs (`x`,
  `dur`, `n` and `step`…).
- Declare what the picture is made of with `part(kind, t0, t1, data)`: a `part('sequence', …, { name, field })`
  per sequence (`field`: the palette color it sits on), and one per key element (`title`, `counter`, `logo`,
  `transition`…). The studio's Clip tab shows them, and the user's feedback points at them by kind and name.
- Without speech, declare what the viewer reads with `say(text, from, to)`, one line per moment. It is the
  transcript the user reviews and quotes in the studio.
- **Never cut a word or a letter**, whatever the pack. A text sits whole in every box that clips it (a mask, a
  window, a roller, a card): as wide as its longest word in every format, and tall enough for its accents and
  descenders (scene-format.md, « No word or letter is cut »). Only the frame may cut display type.

Once the scene is written, go straight to the sound (step 8): no review pass before it.

### 8. Sound

`video.mjs status "Sound" -p <slug>`

The sound comes before the review, so that every pass reviews it with the picture. When the pack or the request
asks for music or sound, write `source/sound.py`. A video without speech always gets sound. Read
`references/sound-format.md` first.
- Compose the score on the Direction's tempo and beats.
- Place the common effects with `play()`: they come from the projects folder's library. Run
  `video.mjs stills -p <slug>` (it saves the cues), then `video.mjs sounds -p <slug>`, and make only the kinds of the
  catalog it says are missing: generated when the starting questions chose it (« Generating a medium », then
  `sfx <kind> --from <file>`), else with the kit (`sfx <kind>… --local`).
- Design the sounds of your own, as many as the video needs (sound-format.md, « Sounds of your own »): the library is a
  base, not a limit.
- What is generated (the music, effects), `sound.py` places (sound-format.md, « Generated sounds »). The rest, and
  what a generation could not make, the kit makes.
- The clips play their own sound by themselves: set each one's `volume` in `edit.json`.

The voice needs nothing: the engine levels the rushes, cuts the rumble, denoises lightly and compresses it.

Then run `video.mjs audio -p <slug>`, and measure: the balance of the bands, effects starting on their cues, a quiet
break, and the clips' level against the voice.

### 9. Review until nothing is left to fix

Start it only once `source/sound.py` is written and mixed (step 8), when the video has sound. This is where the
quality comes from, so take the time it needs: usually four to eight passes. Each pass:
- **Log it**: `video.mjs status "Review pass <n>: <what it looks at>" -p <slug>`.
- **Render the stills that matter**, not only the beats:
  `video.mjs stills <source s…> -p <slug> --format <main>`. Take both sides of every transition, the middle of the
  fast moves, and the peak and last frame of each sequence.
- **Measure** with `video.mjs check -p <slug>`: the pack's numbers on the edit (length, hook, CTA, stretches without
  a change, cuts inside a word, cuts on the beat…), then the layout of every format: a text in the platforms'
  interface zones, too small for a phone, cut by the frame or by its box, or over a face. Fix what it flags. A text that is
  decoration, not meant to be read, takes `data-say=""`. Then `video.mjs audio -p <slug>` once the stills are
  rendered (they saved the cues moved by your fixes), and the measures of step 8 again.
- **Read the sheets and hunt the defects**:
  - something that pops, flickers at a cut, or does not animate (`preview` shows the motion live);
  - overlaps, and a word or a letter cut by the frame or by its box (a mask, a roller, a card), accents and
    descenders included;
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

Start with `video.mjs status "Feedback v<n>: <count> changes" -p <slug>`: while the next version is made, the studio
shows its steps above the feedback. Then read `references/review-format.md` and every image the prompt attaches, and
follow its « Applying it »: each id gets its change, then `resolved` and `reply` in the feedback file.

A change that needs a generation (the voice-over's text, the music or an effect made again, a new clip, a transcript
again) gets its estimate and the user's yes first (« Generating a medium »), then go on.

An effect of the library is every video's: made again (`sfx <kind> --force`), it changes all the videos of the folder
at their next mix. When the comment is about this video only, make it with `--here`.

When a comment changes what the voice-over says (not how a word is spelled, which `fix` corrects), edit
`source/voice.txt`, generate the voice again, run `voice <its file>` then `prepare` again, and move the scene's `at()`
and `edit.json`'s cuts onto the new times of `files/words.md`.

Then render it at once, without asking: `video.mjs render -p <slug>` with the project's `--blur`, then
`video.mjs final -p <slug>`, which delivers every format and resolution again. A change in `sound.py` or in a clip's
`volume` alone needs no render: `audio`, then `final`. Only when the user asks for a quick preview, render a draft
instead: `render --draft`, then `final --draft` (the main format in 720p, sharp, without the deliverables).

Update « État » in About.md and tell the user the new version is ready: the open studio offers to reload it.

## A change asked in the conversation

When the user asks for a change to a video that has a version, in the conversation rather than with the studio's
prompt (a variation they pick included), start with `video.mjs status "<the change, in a few words>" -p <slug>`, and
note each request on the version they saw, so that the studio shows it in that version's feedback. Once the change
is made, before `render` and `final` (they make the next version):
`video.mjs feedback "<the request, in the user's words>" "<what changed, one sentence>" [--at <s>[,<s>]] -p <slug>`.
- One per request. `--at` is the moment or the range it is about, in SOURCE seconds like `at()`; leave it out for a
  change of the whole video (the music, the grade, every title). Add `--format <f>` only for a change of that format's
  composition.
- The studio shows it resolved, with your sentence as its reply and a conversation icon.

Then render as for the studio's feedback, above.

## variations <element>

Read the Variations section of `references/scene-format.md` and follow it.

## preview

`video.mjs preview -p <slug> [--format 9:16]` opens the scene live in Chrome, with the tweens, cues and words around
the playhead. R reloads it after you edit the scene.

## rules

Read `references/rules-format.md` and follow its « The rules mode ». One pack per video, or none.

## Generating a medium

Whatever a model makes or changes for the video (a music, sound effects, a voice-over, a transcript, images, clips, a
rush made ready before the edit, anything else it offers) is made by media-generator, the plugin's other skill.
Load it the first time (the Skill tool's `skill-video:media-generator`, or its sibling folder's SKILL.md), then
follow its « A generation »: its tools (`media.mjs tools <kind> --search "<the need, in English>"`), its models and
its estimates. Never pick a tool from memory: its list grows. Three rules:
- **`--out <folder>`** on each command: the result lands there, in no workspace and with no dashboard. By default the
  video's own folder: `<slug>/assets/sound/` for a sound, `<slug>/assets/clips/` for a clip, `<slug>/assets/` for an
  image, a voice or a transcript; any other folder the user names. Then the engine takes it in: a voice-over with
  `video.mjs voice <file>`, a transcript with `prepare --words <its words.json>`, an effect with
  `sfx <kind> --from <file>`, a clip in `edit.json`'s `media`, a music with `beats <file>` and sound.py's `load()`.
- **Only what the video needs.** Offer a generation only for a medium the video needs and the rushes or the user's
  files do not provide, the local way (Whisper, the kit) always offered first: never for its own sake.
- **The estimates.** The generations known at the start are estimated in the starting questions
  (`references/new-video.md`): the user's yes there covers each one up to its estimate, so run it with
  `--spend <its estimate>` when its step comes. Any other, new or dearer (a clip the Direction adds, a music made
  again or longer), gets its estimate (`--estimate`) and the user's yes (AskUserQuestion, as media-generator's step 3)
  as soon as it comes up, before it runs. Write each yes in About.md's « Génération » section.

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
  footage anywhere. The only exception is what the user said yes to generate: media-generator sends its prompt and
  the files it is given to its router or ElevenLabs (its SKILL.md, « What leaves the machine »).
- **Git.** `init` writes the projects folder's `.gitignore` when it has none: git keeps the rushes, the clips, the
  music and the effects (`.sound/`, `assets/`), and leaves out only what the engine makes again (`.cache/`, `output/`,
  `stills/`, `frames/`, `assets/source.wav`, `assets/mix.wav`) and manual backups (`.backup/`). `doctor` warns when a `.gitignore` would leave out one of them.
- **One studio per projects folder.** `studio` reuses this folder's server, or starts one on the first free port from
  41187: other folders' studios keep running side by side. Give the user the URL it prints.
