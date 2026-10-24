---
name: youtube
description: Long-form YouTube (8 to 30 min): hook then chapters, jump cuts that breathe, B-roll and lower thirds, end screen
params: {"face_framing": true, "breaths": {"sentence": 0.22, "comma": 0.1}, "music": true, "sfx": true, "graphics": "support", "max_static": 8}
---
## When writing the scene
- Hook in the first 15 to 30 s: the promise of the video and why to stay, before any intro or greeting. A title card
  after it lasts 3 to 5 s at most.
- `prepare` shrinks the silences but keeps a breath long enough for a long video. Do not speed the voice up.
- Chapters: one `part('sequence', …)` per chapter with its name, and a chapter card or a title at each one. Write the
  chapter list (mm:ss and title) in About.md's État, for the YouTube description.
- The camera carries the video, full frame in 16:9. Change the framing every 10 to 30 s: a punch-in
  (`cam.view.zoom` 1.1 to 1.25) on a key sentence, then back. Never two zooms in a row.
- B-roll and screen captures (`media`) over the voice when the speaker refers to something: show it while the voice
  goes on. Cover a jump cut that feels rough with B-roll.
- Graphics serve the talk: a lower third with the speaker's name at the start, key words and numbers beside the
  face, a list that builds as it is said. Nothing over the face.
- Music: a quiet bed in `sound.py` that changes or pauses at the chapters, and a soft cue on each graphic entrance.
- End: the CTA of STYLE.md, then 20 s of end screen with room for YouTube's elements (two video slots, subscribe).

## Self-review checklist (stills/contact.jpg)
- [ ] The promise is said and shown before 30 s
- [ ] Every chapter has its card or title, and the chapter list is in About.md
- [ ] No stretch longer than `max_static` s without a change of framing, a B-roll or a graphic
- [ ] Every cut lands on a breath; no raw jump cut left where B-roll could cover it
- [ ] The last 20 s leave the end-screen zones free
