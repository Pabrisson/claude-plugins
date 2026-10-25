---
name: montage
description: Montages carried by music (travel, vlog, event, aftermovie, sport, product shots): cuts on the beat, natural sound moments, few words
params: {"music": true, "graphics": "support", "max_static": 3, "shot": [1, 3], "shots": true}
---
## When writing the scene
- The music leads. Choose its tempo first (Direction), then put every cut on a beat or a bar. A track the user gives
  goes through `load()` in `sound.py`: measure its tempo and first downbeat (onsets, with numpy) before placing the
  cuts.
- Cut 1 to 2 frames before the beat: the eye takes that long, and the cut then feels on it. Vary the grid with the
  energy: on the bar when the music is calm, on every beat or half-beat at the peak, a shot held across a break.
- Find each rush's shots before choosing: declare every rush as one `media` entry, then run `prepare`.
  `files/shots.md` lists the shots of each file; look at the contact sheet of each shot.
- The rushes are clips: one `media` entry per shot you keep (`from`, `dur`), placed with `clip()` on the beats, in
  the order you choose. A voice-over or a rush with speech, when there is one, is the source. Keep only the best
  seconds of each shot (`shot` s, longer for a wide establishing shot), and cut on movement: a turn, a step, a pan
  that goes on into the next shot.
- Structure: open on the strongest image, build with shorter shots as the music rises, reach a peak, then breathe on
  a long wide shot before the end.
- Natural sound: let a moment of a rush's own sound come up on its own (a laugh, a wave, a crowd) with the music
  dipping under it. Otherwise the rushes stay low (`volume` 0.15 to 0.3 for the clips).
- Speech, when there is some, is short and chosen: a line that frames the video, kept whole.
- Graphics stay light: a title, places and dates in small type, a logo at the end. One grade on every shot (CSS
  `filter`, scene-format.md).
- No automatic cut on silences (`breaths` is off): the shots are chosen by hand, a speech source is cut in `cut`.

## Self-review: picture (stills/contact.jpg)
- [ ] No shot held longer than its content deserves, no two similar shots in a row
- [ ] The same grade on every shot
- [ ] The cuts follow movement from one shot to the next

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing, or only establishing shots held on purpose
- [ ] Every cut falls on the grid, 1 to 2 frames before its beat (the cuts' times against the music's tempo)
- [ ] The natural sound moments come through, the music dipping under them
- [ ] The end resolves with the music, no note cut off
