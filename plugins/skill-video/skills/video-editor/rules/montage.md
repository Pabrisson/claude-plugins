---
name: montage
description: Montages carried by music (travel, vlog, event, aftermovie, sport, product shots): cuts on the beat, natural sound moments, few words
params: {"music": true, "graphics": "support", "max_static": 3}
---
## When writing the scene
- The music leads. Choose its tempo first (Direction), then put every cut on a beat or a bar. A track the user gives
  goes through `load()` in `sound.py`: measure its tempo and first downbeat (onsets, with numpy) before placing the
  cuts.
- The rushes are clips: one `media` entry per shot you keep (`from`, `dur`), placed with `clip()` on the beats, in
  the order you choose. A voice-over or a rush with speech, when there is one, is the source. Keep only the best
  seconds of each shot (1 to 3 s, longer for a wide establishing shot), and cut on movement: a turn, a step, a pan
  that goes on into the next shot.
- Structure: open on the strongest image, build with shorter shots as the music rises, reach a peak, then breathe on
  a long wide shot before the end.
- Natural sound: let a moment of a rush's own sound come up on its own (a laugh, a wave, a crowd) with the music
  dipping under it. Otherwise the rushes stay low (`volume` 0.15 to 0.3 for the clips).
- Speech, when there is some, is short and chosen: a line that frames the video, kept whole.
- Graphics stay light: a title, places and dates in small type, a logo at the end. One grade on every shot (CSS
  `filter`, scene-format.md).
- No automatic cut on silences (`breaths` is off): the shots are chosen by hand, a speech source is cut in `cut`.

## Self-review checklist (stills/contact.jpg)
- [ ] Every cut falls on a beat (the cuts' times against the music's tempo)
- [ ] No shot held longer than its content deserves, no two similar shots in a row
- [ ] The same grade on every shot
- [ ] The end resolves with the music, no note cut off
