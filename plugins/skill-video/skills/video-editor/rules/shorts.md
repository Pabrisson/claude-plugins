---
name: shorts
description: Short-form rhythm (TikTok, Reels, YouTube Shorts): aggressive cuts, speed-up, captions, hook, CTA, music bed
params: {"face_framing": true, "speed": 1.15, "breaths": {"sentence": 0.08, "comma": 0.05}, "captions": true, "music": true, "graphics": "lead", "duration": [30, 75], "hook": 2, "cta": true}
---
## When writing the scene
- Strong hook in the first `hook` s: the most surprising claim or number, said and shown at once, and written on the
  first frame, since many watch muted. Never open on a greeting. Declare it with `part('hook', …)`.
- `prepare` already cuts every silence down to a breath and speeds the voice up. If a passage sounds rushed,
  lower it with `rules set speed=…`, never in this pack.
- Aim for `duration`. When the rough cut runs longer, propose `cut` ranges (source/edit.json) on digressions,
  repeats and false starts.
- A second hook halfway: a turn, a question or a number that holds the viewers about to swipe away.
- Word-by-word sticker captions (`captions()`), big, in the creator's language (STYLE.md), near the seam in
  portrait; never over the key visual or the face.
- A music bed under the voice (`source/sound.py`), ducked by it; a tape stop on a dramatic pause when there is one.
- CTA at the end with the texts of STYLE.md, 2 to 3 s after the last sentence, declared with `part('cta', …)`.
- Make it loop: the last image and sentence lead back into the first (same framing, an ending the opening
  completes), so a replay feels seamless.
- Portrait (9:16): the motion design on top, the camera at the bottom; move the seam to give a visual the whole frame
  for one beat, then bring the face back; a punch-in (`cam.view.zoom`) on a strong word. Keep the platforms'
  interface zones free (scene-format.md).

## Self-review: picture (stills/contact.jpg)
- [ ] The first frame says what the video is about, without sound
- [ ] Captions readable and never covering the key visual or the face
- [ ] Nothing important in the platforms' interface zones
- [ ] The face stays in frame in every format
- [ ] The last frame leads back into the first

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] Every cut lands on a breath: no clipped word, no dead air left
- [ ] The music bed never covers the voice
