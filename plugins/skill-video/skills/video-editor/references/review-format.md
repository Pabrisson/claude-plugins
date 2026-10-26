# Review studio feedback

Before the first version, the studio shows what is being done, from the project's `.cache/progress.json`: the
engine's steps (with the renders' progress) and Claude's (`video.mjs status`). It reloads by itself when the first
version lands.

Every render (`rough`, `final`, `final --draft`) is a version `vN` of the project (`source/project.json` `versions`;
a draft has `draft: true` and the main format only). Each one also keeps a 720p preview of its main format
(`files/versions/vN-<ratio>.mp4`), since the next render overwrites `output/`: the studio compares the version with an
earlier one whose preview is still on disk (V). The studio
(`video.mjs studio`, http://127.0.0.1:41187/<slug>/, or the next free port when another projects folder has its own
studio there; the root opens the first video of the folder, the grid button
switches to another) shows one version; the user comments, cuts and draws on it,
then **Copy prompt** gives the text to paste into Claude. The transcript tab comes first, under the scene's sequences:
the speech in paragraphs, or, without speech, the lines of what the video shows with their frame; a double-click
corrects a word or a line (`fix`). Next to it, the Clip tab shows the version's
thumbnails and one row per kind of the scene's `part()`, and the Sound tab its tracks (voice, clips, music, effects) with
their levels, then one row per kind of cue: the user picks a part, a track, a cue, or every one of a kind for a comment.

## `files/reviews/vN.json`

```json
{
  "kind": "video-review", "v": 1, "about": "…", "slug": "demo", "version": "v2",
  "video": { "file": "demo-9x16-1080p.mp4", "size": 14820311, "mtime": "2026-10-23T15:02:11.000Z" },
  "comments": [
    { "id": "m2k9x0a1b2c3", "type": "comment", "t0": 3.2, "t1": 5.8, "s0": 4.1, "s1": 7.0,
      "text": "the counter should land on 11 726", "words": "plus de onze mille", "format": "9:16",
      "images": [{ "path": "assets/review/frame-m2k9x0a1b2c3.png", "size": [1080, 1920], "ratio": "9:16" }],
      "visuals": [{ "kind": "sequence", "t0": 2, "t1": 6, "name": "the proof", "field": "coal", "color": "#28272a" }],
      "sounds": ["music", { "kind": "whoosh", "t": 3.4, "dur": 0.6, "x": 0.4 }],
      "resolved": false, "reply": "", "created": "…" }
  ]
}
```

| Field | |
|---|---|
| `type` | `comment` (any request) or `cut` (remove the range; only with a source) |
| `t0`, `t1` | VIDEO seconds of **that version**; `t1 === t0` for a single moment |
| `s0`, `s1` | SOURCE seconds, or SCENE seconds (the scene's own time) without a source: use them for `cut`, to find the words in `files/words.md`, and to find the moment in the scene |
| `words` | What is said, or shown on screen, in the range |
| `from` | `"transcript"` when the user made the comment on a selection of the transcript: it is about those words or lines. Absent otherwise |
| `fix` | `{ "from", "to" }`: a line of what the video shows, or a spoken word, that the user corrected in the transcript (double-click on it; an emptied word goes). Absent otherwise |
| `format` | The format the user was looking at. Only a request about that format's composition (placement, size, framing) stays in it; content, text, timing and sound changes apply to every format |
| `images` | Frames the user drew on, or pictures they dropped (`assets/review/frame-<id>.png`), with their size in pixels and ratio: read them. Older files have bare paths |
| `visuals` | What the comment is about in the picture: a part of the scene (`kind`, `t0`/`t1` in VIDEO seconds, its data), or every part of a kind (`{ "kind" }`). Absent when the comment is not about one |
| `sounds` | What the comment is about in the sound: a whole track (`voice`, `clips`, `music`, `fx`), every cue of a kind (`{ "kind" }`), or one cue of the scene (`kind`, `t` in VIDEO seconds, its data). Absent when the comment is not about the sound |
| `resolved`, `reply` | **Claude writes them**: `resolved: true` and one sentence on what changed. The studio shows the reply |

The studio keeps an answer Claude wrote even when an older tab saves the file again. Edit only `resolved` and
`reply`; leave the other fields as they are.

## The Copy prompt

```
/skill-video:video-editor apply this feedback to the video demo (/Users/me/ma-chaine/demo)

Reviewed video: /Users/me/ma-chaine/demo/output/demo-9x16-1080p.mp4, version v2 of 23 Oct, 17:02, length 00:43.19 (43.19 s).
2 changes to apply:
1. COMMENT from 00:03.20 to 00:05.80 (VIDEO 3.20 s → 5.80 s, 2.60 s) · SOURCE 4.10 s → 7.00 s [id m2k9x0a1b2c3] [format 9:16]
   Words: "plus de onze mille"
   Request: the counter should land on 11 726
   Visual: sequence "the proof" from 00:02.00 to 00:06.00 (VIDEO 2.00 s → 6.00 s · SOURCE 2.90 s → 6.90 s) field "coal"
   Sound: the music track (sound.py's music bus)
   Sound: every "pop" cue (the sound sound.py designs for this kind)
   Sound: cue "whoosh" at 00:03.40 (VIDEO 3.40 s · SOURCE 4.30 s) dur 0.6, x 0.4
   Image (9:16, 1080×1920 px): /Users/me/ma-chaine/demo/assets/review/frame-m2k9x0a1b2c3.png
2. CUT from 00:12.00 to 00:13.40 (VIDEO 12.00 s → 13.40 s, 1.40 s) · SOURCE 14.90 s → 16.50 s [id m2k9x0a1b2c4]

Times: mm:ss.cc = minutes:seconds.hundredths …
Types: CUT = remove the range (it goes in `cut`, in SOURCE time); COMMENT = any other request …
Visual: a part is the scene's part(kind, t0, t1, data) call … /Users/me/ma-chaine/demo/files/video/v2.json.
Sound: a track is a part of the mix …; a cue is the scene's cue(kind, t, data) call … /Users/me/ma-chaine/demo/files/sound/v2.json.
Feedback file: …/files/reviews/v2.json (video version v2, same ids). For each change applied, set "resolved": true …
Change only these points and keep the rest of the edit identical. …
```

Each change keeps its number in the studio (#4): the list skips the resolved ones. `[format …]` appears only for a
project with several formats, `SOURCE` only with a source, `Words:` only with a
transcript (`On screen:` for a video without speech: the lines of what it shows, joined by « / »; either says
`(selected in the transcript)` when the comment was made there), `Text fix: "<from>" → "<to>"` for a corrected line
(with its note at the end), `Visual:` once per
picked part, `Sound:` once per picked track or cue (each with its note at the end), `Image:` once per attached image with its ratio and size.

## `files/sound/vN.json`

What the Sound tab shows of version N, written by `final`: `cues` (the scene's `cue()` calls, VIDEO seconds), `step`
(seconds) and `tracks`, each track's level in dB under the loudest one (-60 floor), one value per step. Read it to
find a cue, or to see where a track is loud or quiet.

## `files/video/vN.json`

What the Clip tab shows of version N, written by `final`: `parts` (the scene's `part()` calls, the `clip()`s and,
with a source, the kept `take`s, VIDEO seconds) and `strips`, per format a sheet of thumbnails (`file`, one every
`every` seconds, `cols` per row, `w`×`h` px each).

## Applying it

The pasted prompt lists changes, each with an `[id …]`, and names the feedback file `files/reviews/vN.json`. Read
every attached image: its ratio says which format it shows, or the shape of a reference. Then handle each id:
- **CUT**: add `[s0, s1]` to `cut` in `source/edit.json`: SOURCE seconds, or SCENE seconds (the scene's own time)
  for a video without a source. No `prepare` needed: the timeline applies `cut` itself. Check in `files/words.md`
  that the cut falls between words or moments.
- **COMMENT**: change the scene (`source/scene.js`, `scene.css`, `edit.json`, assets) at that moment. Anchor the change
  with `at(source seconds)`: the video times of the prompt only say where the user was looking.
  - `[format …]` is the format the user was looking at. Change that format only when the request is about its
    composition (placement, size, framing, what the frame cuts): `format === '16:9'`, `pick()`, or CSS on
    `#stage.landscape`. A change of content, text, numbers, timing or sound applies to every format.
  - Change only what is asked and keep the rest identical: the user has already approved it.
- **Text fix** `"<from>" → "<to>"`:
  - without speech, the user corrected a line of what the video shows: write `to` in place of `from` in the scene at
    that moment, word for word, and change nothing else;
  - with speech, the user corrected a word of the transcript: `video.mjs fix <s0> "<to>" -p <slug>` with the
    comment's SOURCE time (`""` removes the word). The captions, the subtitles and `files/words.md` follow.
- **Sound:** lines say what in the sound the comment is about.
  - A track (`music`, `fx`) is that bus of `source/sound.py` at that moment: change its arrangement or its level
    there. The `voice` track is the voice itself: its level in the style, or a cut. The `clips` track is the clips'
    own sound: the `volume` of the media playing at that moment, in `edit.json`.
  - `every "<kind>"` is the sound `sound.py` designs for that kind: change it, every cue of the kind follows.
  - One cue is a `cue()` of the scene. To change its sound only, give it its own data in the scene and let
    `sound.py` read it. Move or remove the `cue()` when its timing is the problem.
  - A change in `sound.py` or in a clip's `volume` alone needs no render: `audio`, then `final`.
- **Visual:** lines name the parts of the picture the comment is about: find each `part()` in the scene by its kind,
  name and times, and change what it wraps. `every "<kind>"` is every part of that kind (all the titles…): change
  their shared class or helper. A `take` is a kept piece of the source, a `clip` a media of `edit.json`.
- In the feedback file, set `"resolved": true` and write one sentence in `reply` saying what you changed.

Then run `stills` if the change is visual, then `render` (with the project's `--blur`) and `final`, without waiting
to be asked: `final` makes the next version, and the open studio offers to reload it. A draft (`render --draft`,
`final --draft`) only when the user asks for a quick preview.
