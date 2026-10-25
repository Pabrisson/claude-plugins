# Rule packs: `rules/<name>.md`

A pack says **how to edit**: cuts, pace, captions, music, motion density, and the checklists of the self-review. It
is one Markdown file; adding a pack is dropping a file, with no change to the engine or the skill. A video follows
one pack, or none.

| Where | What |
|---|---|
| `<skill>/rules/<name>.md` | The packs of the plugin. Never edit them |
| `.rules/<name>.md` in the projects folder (the project Claude Code runs in) | Personal packs, and the personal lines of a plugin pack (same name: it wins) |

A project freezes its pack's merged params in `source/rules.json` at `init` (`rules use` changes them, `rules set`
adds the project's overrides). The text is not frozen: `video.mjs rules show -p <slug>` always gives the pack's
current text, so a better pack improves the next passes of every project.

## Format

```markdown
---
name: podcast-clip
description: One line shown by `rules list` and in the starting question
params: {"breaths": {"sentence": 0.2, "comma": 0.1}, "captions": true, "speed": 1.05, "hook": 3}
---
## When writing the scene
- Instructions for Claude, imperative, one idea per line, with the reason when it is not obvious.

## Self-review: picture (stills/contact.jpg)
- [ ] What to check on the contact sheets before rendering

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] What to check by ear or in the transcript: clipped words, levels, music against the cuts
```

The frontmatter is `key: value` lines; a value is inline JSON (a plain string otherwise). No YAML: keep `params` on
one line. `rules list` flags a pack whose `params` is not valid JSON or has a value of the wrong type, and `init` and
`rules use` refuse it.

`extends: <name>` starts from another pack: its params, then its text, with this pack's params and lines after them
(they win when they disagree). A `.rules/shorts.md` with `extends: shorts` extends the plugin's `shorts`, so it
keeps getting the plugin's updates and holds only the user's own lines.

## Params the engine reads

| Param | Default | Effect |
|---|---|---|
| `transcribe` | `true` | Word-level transcript of the speech (`prepare`). `false`: no transcript, no captions, no breaths |
| `face_framing` | `false` | `camera()` keeps the face at 42 % of the height (MediaPipe); otherwise the center |
| `speed` | `1` | Voice and picture speed-up (`1.15` = 15 % faster, from 0.5 to 2), through `atempo` |
| `breaths` | none | Cut every silence down to a breath: `{"sentence": 0.08, "comma": 0.05}` (seconds kept after a sentence, a comma). Without it, no automatic cut |
| `captions` | `false` | Tells Claude to put `captions()` in the scene; `check` makes sure it is there |
| `music` | `false` | Tells Claude to compose music in `source/sound.py` |
| `sfx` | `false` | Tells Claude to put `cue()` on key moments and design their sounds in `source/sound.py` |
| `freezes` | none | `prepare` lists in `files/freezes.md` where the source's picture stays still for that many seconds or more once cut, with what is said over it (a screen recording waiting) |
| `shots` | `false` | `prepare` lists in `files/shots.md` the shots of every file of `edit.json`'s media, to pick each clip's `from` and `dur`; it then runs without a source too |
| `graphics` | none | Tells Claude what carries the video: `lead` (the motion design: the showreel bar of the skill's Direction) or `support` (the footage: the graphics serve it, the footage bar). Without it, Claude decides from the video and writes the choice in the Direction |

## Params `check` measures

`video.mjs check -p <slug>` (after `stills`, which save the scene's parts) measures these on the edit, in VIDEO
seconds, and prints ✓ or ✗ for each. It sees the cuts, the clips and the `part()` calls, not what moves inside them.

| Param | Example | What `check` measures |
|---|---|---|
| `duration` | `[30, 75]` | The video's length, from min to max seconds |
| `hook` | `2` | A `part('hook', …)` starting before that second |
| `cta` | `true` | A `part('cta', …)` ending in the last 5 s (before the end screen, when there is one) |
| `end_screen` | `20` | A `part('end-screen', …)` over the last seconds |
| `max_static` | `8` | No stretch longer than that without a cut, a clip or a `part()` starting or ending |
| `shot` | `[1, 3]` | Each clip on screen from min to max seconds (until the next clip starts) |
| `read` | `{"word": 0.3, "min": 1.2}` | Each on-screen line (`say()`, without speech) up for 0.3 s per word, 1.2 s at least |
| `chapters` | `true` | YouTube's rules on the `part('sequence')`: 3 or more, the first at 0:00, each 10 s or more; prints the list (`final` writes it into the description) |
| `on_beat` | `true` | Each cut (a join of takes, a clip coming in) 0 to 3 frames before a beat or a half-beat of `files/beats.json` (`video.mjs beats`) |

Whatever the pack:
- the cuts of `edit.json` are checked against the transcript: a cut inside a word is a ✗;
- the layout of every format is sampled 4 times a second: a text in the platforms' interface zones (9:16), too small
  for a phone (under 24 px at 1080 once scaled), cut by the frame (display type from 130 px may cross it), or over the
  face the camera shows, for 0.75 s or more, is a ✗. Captions count; a `data-say=""` decoration does not.

Any other key is read by Claude only, e.g. a threshold the checklists name.

Merge, lowest priority first: the defaults above, then the pack's params (and the packs it extends), then the
project's own `overrides` in `source/rules.json`, written by `rules set key=value -p <slug>` ("speed up this one
less"). `breaths` and `captions` need `transcribe: true`; without a source, `face_framing`, `speed` and `breaths` do
nothing.

## Writing a pack (`rules new`, `rules edit`)

- Ask what the format is for (platform, length, audience), its pace (cuts, speed), what must be on screen, and what
  makes a result fail. Turn the answers into `params` and the three sections: what is measurable goes into the params
  `check` reads, what needs an eye or an ear into the checklists.
- Keep it about **editing**, not identity: colors, fonts, CTA texts and sound levels belong to the style.
- `rules edit <name>`: write the changes in `.rules/<name>.md` with `extends: <name>` (create it if it is not there),
  never a full copy of the plugin's pack: a copy would no longer get its updates.
- Check it with `video.mjs rules list` (it must appear, with its origin and no `broken` line), then
  `rules show <name>`.

## The rules mode

One pack per video, or none.
- `rules`: run `video.mjs rules list`. Tell the user about any pack it flags as broken.
- `rules show [<name>]`: run `video.mjs rules show <name>`, or `rules show -p <slug>` for the project's pack.
- `rules use <name|none>`: run `video.mjs rules use … -p <slug>`. With a source, rerun `prepare` then `rough`.
- `rules set <key>=<value>`: run `video.mjs rules set … -p <slug>`, for this project only. After `transcribe`,
  `face_framing`, `speed` or `breaths`, rerun `prepare` then `rough`.
- `rules new <name>`: ask a few questions (Writing a pack, above), and write `.rules/<name>.md` in the projects
  folder. Check that it appears in `rules list`.
- `rules edit <name>`: write the changes in the projects folder's `.rules/<name>.md`, with `extends: <name>` in its
  frontmatter (create it if it is not there). Never copy the plugin's pack, and never edit the packs inside the
  plugin: updates replace them.
