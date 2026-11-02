# A new video: steps 1 to 5

Read it at the start of a new video and follow its steps in order. Step 6, « Art direction », and the steps after it
are in SKILL.md: go back there once step 5 is done. `video.mjs` means `node "${CLAUDE_SKILL_DIR}/engine/video.mjs"`, as
in SKILL.md.

Contents: 1. Rushes and sources · 2. Starting questions · 3. Create the project · 4. Brief · 5. Studio before the edit

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

Ask them in two AskUserQuestion calls, three with generation, one right after the other. A call holds four questions at most, each with
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

**Call 3, Génération (single choice)**, only when `doctor`'s `generation` line names a key and this video needs
something a model could make. Ask only about the media the video needs, read from the request, the pack and the
rushes, never one for its own sake; with none, skip the call. First load the media-generator skill (SKILL.md,
« Generating a medium ») and run its `doctor`. One question per need, the local option first, then the generated one:
its tool found with `media.mjs tools <kind> --search "<the need, in English>"`, its model the tool's first recommended one, and its
price from the command run with `--estimate` (nothing spent), in the option's description with the model's name.
- **Transcription** (header `Transcription`), with a source that speaks: « Whisper (local) », then « Générée » (the
  source's sound leaves the machine), on the length of the source (its range).
- **Voix off** (header `Voix off`), only when the video is told rather than shown and has no speech of its own (the
  request asks for a voice-over, or the brief needs a narrator): « Sans voix off », then three voices that fit the
  style's language and the video, found the way media-generator finds voices, each estimated on about 15 characters
  per second of video. Other takes another voice.
- **Musique** (header `Musique`), when the video will have music: « Synthétisée (local) », then « Générée », on the
  length of the video.
- **Effets** (header `Effets`), when the video will have sound effects: « Synthétisés (local) », then « Générés »: only
  the kinds of the catalog the video will likely use and the library lacks (`video.mjs sounds` shows what it has), at
  their catalog length.
- Any other medium the video needs and nothing in the request provides (« avec des plans générés de… », a missing
  shot the brief cannot do without): its own question, « Non » first.

Leave out a need that has no tool. Once the user has answered, give the estimated total of what they chose, then go
on. That yes covers each of these generations up to its estimate; anything later is asked again (SKILL.md,
« Generating a medium »).

The first format chosen is the main one: the rough cut and the studio use it.

### 3. Create the project

Pick a short slug from the topic (`a-z0-9-`), then run:

```
video.mjs init <slug> --formats 9:16,1:1 --renders 1080p,720p --fps 30 --codec h264 [--source <file|url> …] --rules shorts
```

Use `--rules none` for no pack, and leave `--fps` out to keep the source's rate. Give one `--source` per rush of the
source, in the order of the video, each with its range when it has one. `init` joins them and prints where each one starts. A rush of another
shape than the first is letterboxed into it: put first the one with the main shape, or make the odd one a clip.

When call 3 chose a generation, write right after `init` a « Génération » section in `<slug>/About.md`: each
generation said yes to, its tool, its model and its estimate. It is all the user agreed to spend.

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

With a source, run `video.mjs prepare -p <slug>`, then `video.mjs rough -p <slug>`. With a generated transcript, make
it first on `<slug>/assets/source.mp4` (`--out <slug>/assets`), then `prepare --words <its words.json>` instead of
Whisper's:
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

**With a voice-over** (chosen in call 3), write the narration from the beats into `source/voice.txt`: the text the
voice reads, in the style's language, written to be heard (short sentences, one idea each). Generate it with the voice
chosen (`--out <slug>/assets`), then run `video.mjs voice <its file> -p <slug>`: it becomes the source, its sound over
a black picture. Then `prepare` (it transcribes the voice, the style's vocabulary spelled right) and `rough` as with
any source, and the video is cut on the voice's words. The picture is all graphics:
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

## Next

Step 6, « Art direction, before any code », is in SKILL.md: go on there now.
