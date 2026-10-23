# Review studio feedback

Every render (`rough`, `final`) is a version `vN` of the project (`source/project.json` `versions`). The studio
(`video.mjs studio`, http://127.0.0.1:41187/<slug>/) shows one version; the user comments, cuts and draws on it,
then **Copy prompt** gives the text to paste into Claude.

## `files/reviews/vN.json`

```json
{
  "kind": "video-review", "v": 1, "about": "…", "slug": "demo", "version": "v2",
  "video": { "file": "demo-9x16-1080p.mp4", "size": 14820311, "mtime": "2026-10-23T15:02:11.000Z" },
  "comments": [
    { "id": "m2k9x0a1b2c3", "type": "comment", "t0": 3.2, "t1": 5.8, "s0": 4.1, "s1": 7.0,
      "text": "the counter should land on 11 726", "words": "plus de onze mille", "format": "9:16",
      "images": ["assets/review/frame-m2k9x0a1b2c3.png"], "resolved": false, "reply": "", "created": "…" }
  ]
}
```

| Field | |
|---|---|
| `type` | `comment` (any request) or `cut` (remove the range; only with a source) |
| `t0`, `t1` | VIDEO seconds of **that version**; `t1 === t0` for a single moment |
| `s0`, `s1` | SOURCE seconds (absent without a source): use them for `cut` and to find the words in `files/words.md` |
| `words` | What is said, or shown on screen, in the range |
| `format` | The format the user was looking at. Only a request about that format's composition (placement, size, framing) stays in it; content, text, timing and sound changes apply to every format |
| `images` | Frames the user drew on (`assets/review/frame-<id>.png`): read them |
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
   Image: /Users/me/ma-chaine/demo/assets/review/frame-m2k9x0a1b2c3.png
2. CUT from 00:12.00 to 00:13.40 (VIDEO 12.00 s → 13.40 s, 1.40 s) · SOURCE 14.90 s → 16.50 s [id m2k9x0a1b2c4]

Times: mm:ss.cc = minutes:seconds.hundredths …
Types: CUT = remove the range (it goes in `cut`, in SOURCE time); COMMENT = any other request …
Feedback file: …/files/reviews/v2.json (video version v2, same ids). For each change applied, set "resolved": true …
Change only these points and keep the rest of the edit identical. …
```

`[format …]` appears only for a project with several formats, `SOURCE` only with a source, `Words:` only with a
transcript, `Image:` once per attached drawing.

## Applying it

- **CUT**: add `[s0, s1]` to `cut` in `source/edit.json` (SOURCE seconds), then `prepare` is not needed: the
  timeline applies `cut` itself. Check the words around the cut in `files/words.md` so it lands between words.
- **COMMENT**: change the scene (`source/scene.js`, `scene.css`, `edit.json`, assets) at that moment. Anchor the
  change with `at(source seconds)`; the video times of the prompt only say where the user was looking. A request
  about one format's composition changes that format only (`format === '16:9'`, `pick()`, or CSS on
  `#stage.landscape`); anything else changes every format.
- Answer every id in the feedback file, then run what the change needs (`stills` to check, then `render`,
  `final`); `final` makes the next version and the user reloads the studio.
