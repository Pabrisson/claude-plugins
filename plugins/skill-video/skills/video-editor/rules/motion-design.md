---
name: motion-design
description: Motion design carries the visuals: every idea gets an animated element, nothing stays static
params: {"max_static": 2, "sfx": true, "graphics": "lead", "read": {"word": 0.3, "min": 1.2}}
---
## When writing the scene
- One visual per idea and per key word, invented for this video: numbers → counters that climb, brands → their
  logos, comparisons → side by side, steps → a path that fills, a promise → a word that rolls, a problem → something
  that cracks. Build it with HTML, SVG, canvas and GSAP; do not settle for a title on a plain background.
- A visual change at least every `max_static` s: a new element, a camera move, a transition between scenes
  (iris, wipe, zoom through a letter, a pill that grows to fill the frame). Declare the key elements with `part()`:
  `check` measures the stretches between them.
- Proof on screen: every number said or written appears, animated, with its unit.
- Motion with intent: expo/back eases on entrances, staggered letters (SplitText), strokes drawn on (DrawSVG),
  a slow drift on what stays. Exits as designed as entrances.
- The look comes from the Direction, built on the brand's material (STYLE.md, its notes first): this pack sets the
  density and the pace, not the aesthetic.
- A `cue()` on each key entrance and transition: `sound.py` gives each kind of event its own designed sound.
- Without speech, the beats of About.md drive the scenes, and the on-screen text is the transcript (`say()`): keep
  each text up long enough to be read (`read`: 0.3 s per word, 1.2 s minimum).
- Recompose each format: in portrait the visual goes under the text, titles break on two lines; nothing important
  in the platforms' interface zones (scene-format.md).

## Self-review: picture (stills/contact.jpg)
- [ ] Every number said or written appears on screen
- [ ] No frame mostly empty, every transition designed; the brand's motif and color story held; STYLE.md's notes
  followed
- [ ] Each text is readable at phone size
- [ ] Every format is composed for itself, nothing cut by the frame

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] Each key entrance and transition is heard, its sound starting on its cue
