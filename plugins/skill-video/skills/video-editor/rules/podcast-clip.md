---
name: podcast-clip
description: Vertical clips cut from a podcast or a long interview: one self-contained moment, the speaker on screen, captions, a link to the full episode
params: {"face_framing": true, "speed": 1.05, "breaths": {"sentence": 0.15, "comma": 0.08}, "captions": true, "graphics": "support", "max_static": 4, "duration": [20, 90], "hook": 3, "cta": true}
---
## When writing the scene
- One moment that stands alone without the episode: a strong opinion, a story with its punchline, a surprising
  number. Find it in `files/words.md`; when the request does not name it, propose two or three with their times
  and let the user choose. Then give the source only that moment, with a margin: `--source episode.mp4#t=12:20,14:20`
  (`init` again in a new project), so an hour of episode is not framed for one minute of clip.
- Start on the strongest sentence, even mid-conversation: cut the run-up. Put the question on screen when the answer
  needs it. Declare the opening with `part('hook', …)`.
- End on the punchline or a laugh, never on a trailing sentence.
- Show who speaks. A second camera (the other speaker) is a clip of `edit.json`, synced on the source by its sound
  with `video.mjs sync <id>`: `clip()` then follows the source, silent. Show it while that person speaks.
  Switch when the voice changes, letting the new voice start just before the picture (J-cut).
- One camera for two people: reframe on whoever speaks with `cam.view` (`x`, `y`), or split the portrait frame in two
  when both react.
- Word-by-word captions (`captions()`), big, never over a face; the speaker's name and role small at their first
  line.
- No music under the conversation, unless the request asks for it.
- The show's name and "full episode" with the CTA of STYLE.md at the end (`part('cta', …)`). Keep the platforms'
  interface zones free (scene-format.md).

## Self-review: picture (stills/contact.jpg)
- [ ] The first frame says what the moment is about, without sound
- [ ] The face of whoever speaks is on screen, in frame in every format
- [ ] Captions readable and never over a face

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] The clip makes sense without the episode, and ends on its punchline
- [ ] Every switch of camera follows the voice
