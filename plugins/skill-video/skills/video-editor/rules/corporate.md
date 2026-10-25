---
name: corporate
description: Corporate and brand films (presentation, product demo, recruitment, case study): calm pace, polished, the brand on every frame
params: {"face_framing": true, "breaths": {"sentence": 0.3, "comma": 0.15}, "captions": true, "music": true, "sfx": true, "graphics": "support", "max_static": 6, "hook": 10, "shot": [3, 6], "cta": true}
---
## When writing the scene
- One message, said in the first `hook` s (`part('hook', …)`) and proven after: the product, the numbers, the
  people. Every claim comes from About.md's sources, nothing invented.
- Calm and polished: shots of `shot` s, transitions that flow (cuts on movement, soft wipes in the brand's shapes),
  no aggressive jump cuts. The speakers' pauses get shorter, never removed.
- Lay the sound across the cuts: a voice starts under the previous image, or a clip comes in before the word that
  names it, so the edit flows.
- The brand on every frame without shouting: its palette for the graphics, its font, its motif in the transitions
  and the lower thirds, the logo at the open (briefly) and at the end with the CTA (`part('cta', …)`).
- People who speak: name and role as lower thirds. A testimonial is cut down to its best sentences.
- The product itself, close: its interface or the object, with callouts on what it does. Numbers become animated
  counters, with their source in About.md.
- Music: a confident, understated bed under the voice, a lift at the key message, a clean end on the logo.
- Captions on every word: brand films mostly play muted (LinkedIn, sites, events). For a screening with sound,
  `rules set captions=false`.

## Self-review: picture (stills/contact.jpg)
- [ ] The message is shown on screen in the first `hook` s
- [ ] Every number on screen has its source in About.md
- [ ] The brand is recognizable in every sequence, with the logo hidden
- [ ] Names, roles and spellings are right, checked against the sources

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] No pause removed from a speaker, no clipped word
- [ ] The music lifts at the key message and ends cleanly on the logo
