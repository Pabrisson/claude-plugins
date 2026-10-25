---
name: youtube
description: Long-form YouTube (8 to 30 min): hook then chapters, jump cuts that breathe, B-roll and lower thirds, end screen
params: {"face_framing": true, "breaths": {"sentence": 0.22, "comma": 0.1}, "music": true, "sfx": true, "graphics": "support", "max_static": 8, "duration": [480, 1800], "hook": 30, "cta": true, "end_screen": 20, "chapters": true}
---
## When writing the scene
- Hook in the first `hook` s, declared with `part('hook', …)`: the promise of the video and why to stay, before any
  intro or greeting. A title card after it lasts 3 to 5 s at most.
- `prepare` shrinks the silences but keeps a breath long enough for a long video. Do not speed the voice up.
- Chapters: one `part('sequence', …)` per chapter with its name, and a chapter card or a title at each one. YouTube
  shows them only when the first starts at 0:00, there are 3 or more, and each lasts 10 s or more: the hook is in
  the first one. `video.mjs check` prints the list (mm:ss and name): copy it into About.md's État, for the
  description.
- Open each chapter on a question it answers, as a re-hook. No filler that announces what comes next.
- The camera carries the video, full frame in 16:9. Change the framing every 10 to 30 s: a punch-in
  (`cam.view.zoom` 1.1 to 1.25) on a key sentence, then back. Never two zooms in a row.
- B-roll and screen captures (`media`) over the voice when the speaker refers to something: show it while the voice
  goes on. Cover a jump cut that feels rough with B-roll.
- Lay the sound across the cuts: a B-roll comes in 0.3 to 0.5 s before the word that names it and stays a beat
  after; a new chapter's voice may start over the last image of the previous one.
- Graphics serve the talk: a lower third with the speaker's name at the start, key words and numbers beside the
  face, a list that builds as it is said. Nothing over the face.
- Music: a quiet bed in `sound.py` that changes or pauses at the chapters, and a soft cue on each graphic entrance.
- End: the CTA of STYLE.md (`part('cta', …)`), then `end_screen` s of end screen (`part('end-screen', …)`) with
  room for YouTube's elements (two video slots, subscribe).
- `poster` in edit.json on an expressive frame (the face at its peak, the key visual): the thumbnail starts there.

## Self-review: picture (stills/contact.jpg)
- [ ] The promise is shown on screen during the hook
- [ ] Every chapter has its card or title
- [ ] No raw jump cut left where B-roll could cover it
- [ ] The end screen leaves YouTube's zones free
- [ ] The poster frame reads as a thumbnail

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing, and its chapter list is in About.md
- [ ] Every cut lands on a breath
- [ ] The music changes or pauses at the chapters and never covers the voice
