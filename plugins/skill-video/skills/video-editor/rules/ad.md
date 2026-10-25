---
name: ad
description: Social ads (6, 15 or 30 s on Meta, TikTok, YouTube): hook in the first second, the product before 3 s, one offer, one CTA, made to work muted
params: {"face_framing": true, "speed": 1.1, "breaths": {"sentence": 0.08, "comma": 0.05}, "captions": true, "music": true, "sfx": true, "graphics": "lead", "max_static": 1.5, "duration": [6, 30], "hook": 1, "cta": true}
---
## When writing the scene
- One length, the platforms' slots: 6 s (a bumper: one idea, often no speech), 15 s or 30 s. Ask which one when the
  request does not say, and set it with `rules set 'duration=[15,15]'`.
- The hook in the first `hook` s (`part('hook', …)`): movement, a face, the product in use or a question on screen.
  No logo intro, no slow fade-in.
- The product, or its result, on screen before 3 s, and the brand named or shown before 5 s: most viewers leave
  before the end.
- One offer and one promise: the benefit for the viewer, then its proof (a number, a demo, one sentence of a
  testimonial). Every claim comes from About.md's sources, nothing invented.
- Made to work muted: everything that matters is also written on screen, and captions follow every word said.
- One CTA, the button text of STYLE.md, on screen for the last 2 to 3 s (`part('cta', …)`); said too when there is
  a voice.
- Recompose each format for itself (9:16 for Reels and TikTok, 1:1 and 4:5 for the feeds, 16:9 for YouTube) and
  keep the platforms' interface zones free (scene-format.md).
- Music: a strong start on the hook, a resolution on the CTA; a sound on each key entrance.

## Self-review: picture (stills/contact.jpg)
- [ ] Without sound, the first frame and the first second say what the ad is about
- [ ] The product is visible before 3 s and the brand before 5 s
- [ ] One offer, one CTA, both readable at phone size
- [ ] Nothing important in the platforms' interface zones

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] The music hits on the hook and resolves on the CTA
