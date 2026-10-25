---
name: interview
description: Interviews, podcasts, testimonials and talks: the words lead, natural pauses, names and quotes on screen, B-roll on the topics
params: {"face_framing": true, "breaths": {"sentence": 0.35, "comma": 0.18}, "music": true, "graphics": "support", "max_static": 12}
---
## When writing the scene
- The words carry the video. Cut on meaning: keep whole answers and drop the false starts, the repeats and the
  interviewer's "hmm". Keep a pause when it carries emotion, and the laughs that show the relationship.
- Several rushes (one camera per person, or one recording per answer): the order of `--source` is the order of the
  video. Remove whole questions or answers with `cut`, and say in About.md's Beats which rush each beat comes from.
- Cut on the sound, not the picture: let a voice start under the previous image (J-cut) or finish over the next one
  (L-cut), with B-roll or a clip of the other rush (`volume` 0) over the join, so the cuts go unnoticed.
- With a camera per person recording the same conversation, sync each other camera with `video.mjs sync <id>`:
  its clip then follows the source. Show the listener's reaction (a nod, a smile) for one beat on a strong line.
- Questions: keep the interviewer's voice when it frames the answer. Otherwise remove it and put the question on
  screen as a short text card.
- A lower third with each speaker's name and role at their first appearance, in STYLE.md's palette and font, and
  again after a long absence.
- Framing: a slow push-in (`cam.view.zoom` 1 → 1.08 over a whole answer) on the strong moments, a punch-in only on
  a punchline.
- B-roll (`media`) on what the speaker describes, its sound low (`volume` 0.2 to 0.4). The speaker's voice never
  stops under it.
- A pull quote, large, for the sentence the video is about: once or twice per video.
- Music: none under the words by default, a bed only at the open, the transitions and the end, unless the request
  asks for one.

## Self-review: picture (stills/contact.jpg)
- [ ] Each speaker is named on screen at their first appearance
- [ ] No graphic over a face
- [ ] The same grade on every rush

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] Every answer kept is whole: no sentence cut in the middle, no question left without its answer
- [ ] The voice has the same level and tone from one rush to the next
- [ ] The joins between speakers are carried by the sound, not by a hard cut on silence
