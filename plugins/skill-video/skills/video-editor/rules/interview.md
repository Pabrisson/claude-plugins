---
name: interview
description: Interviews, podcasts, testimonials and talks: the words lead, natural pauses, names and quotes on screen, B-roll on the topics
params: {"face_framing": true, "breaths": {"sentence": 0.35, "comma": 0.18}, "music": true, "graphics": "support", "max_static": 12}
---
## When writing the scene
- The words carry the video. Cut on meaning: keep whole answers and drop the false starts, the repeats and the
  interviewer's "hmm". Keep a pause when it carries emotion.
- Several rushes (one camera per person, or one recording per answer): the order of `--source` is the order of the
  video. Remove whole questions or answers with `cut`, and say in About.md's Beats which rush each beat comes from.
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

## Self-review checklist (stills/contact.jpg)
- [ ] Every answer kept is whole: no sentence cut in the middle, no question left without its answer
- [ ] Each speaker is named on screen at their first appearance
- [ ] No graphic over a face
- [ ] The voice has the same level and tone from one rush to the next
