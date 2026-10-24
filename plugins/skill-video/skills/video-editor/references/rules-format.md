# Rule packs: `rules/<name>.md`

A pack says **how to edit**: cuts, pace, captions, music, motion density, and the checklist of the self-review. It is
one Markdown file; adding a pack is dropping a file, with no change to the engine or the skill.

| Where | What |
|---|---|
| `<skill>/rules/<name>.md` | The packs of the plugin. Never edit them |
| `.rules/<name>.md` in the projects folder (the project Claude Code runs in) | Personal packs, and personal copies of plugin packs (same name: the copy wins) |

A project freezes its packs and their merged params in `source/rules.json` at `init` (`rules use` changes them),
so editing a pack never changes a finished project.

## Format

```markdown
---
name: podcast-clip
description: One line shown by `rules list` and in the starting question
params: {"breaths": {"sentence": 0.2, "comma": 0.1}, "captions": true, "speed": 1.05}
---
## When writing the scene
- Instructions for Claude, imperative, one idea per line, with the reason when it is not obvious.

## Self-review checklist (stills/contact.jpg)
- [ ] What to check on the contact sheets before rendering
```

The frontmatter is `key: value` lines; a value is inline JSON (a plain string otherwise). No YAML: keep `params` on
one line.

## Params the engine reads

| Param | Default | Effect |
|---|---|---|
| `transcribe` | `true` | Word-level transcript of the speech (`prepare`). `false`: no transcript, no captions, no breaths |
| `face_framing` | `false` | `camera()` keeps the face at 42 % of the height (MediaPipe); otherwise the center |
| `speed` | `1` | Voice and picture speed-up (`1.15` = 15 % faster), through `atempo` |
| `breaths` | none | Cut every silence down to a breath: `{"sentence": 0.08, "comma": 0.05}` (seconds kept after a sentence, a comma). Without it, no automatic cut |
| `captions` | `false` | Tells Claude to put `captions()` in the scene |
| `music` | `false` | Tells Claude to compose music in `source/sound.py` |
| `sfx` | `false` | Tells Claude to put `cue()` on key moments and design their sounds in `source/sound.py` |
| `graphics` | none | Tells Claude what carries the video: `lead` (the motion design: the showreel bar of the skill's Direction) or `support` (the footage: the graphics serve it, the footage bar). Without it, Claude decides from the video and writes the choice in the Direction |
| any other key | | Read by Claude only, e.g. `max_static` (longest stretch without a visual change, for the self-review) |

Merge, lowest priority first: the defaults above, then the packs in the chosen order (only the keys a pack declares
win; the last pack wins), then the project's own `overrides` in `source/rules.json` ("speed up this one less").
`breaths` and `captions` need `transcribe: true`; without a source, `face_framing`, `speed` and `breaths` do nothing.

## Writing a pack (`rules new`, `rules edit`)

- Ask what the format is for (platform, length, audience), its pace (cuts, speed), what must be on screen, and what
  makes a result fail. Turn the answers into `params` and two short sections.
- Keep it about **editing**, not identity: colors, fonts, CTA texts and sound levels belong to the style.
- `rules edit <name>`: copy the plugin's pack into `.rules/` first if it is not there, then edit the copy.
- Check it with `video.mjs rules list` (it must appear, with its origin), then `rules use <name>` on a project.
