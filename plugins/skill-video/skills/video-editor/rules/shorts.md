---
name: shorts
description: Short-form rhythm (TikTok, Reels, YouTube Shorts): aggressive cuts, speed-up, captions, hook, CTA, music bed
params: {"face_framing": true, "speed": 1.15, "breaths": {"sentence": 0.08, "comma": 0.05}, "captions": true, "music": true}
---
## When writing the scene
- Strong hook in the first 2 s: the most surprising claim or number, said and shown at once. Never open on a greeting.
- `prepare` already cuts every silence down to a breath and speeds the voice up. If a passage sounds rushed,
  lower `speed` in the project's `source/rules.json` `overrides`, never in this pack.
- Aim for 30 to 75 s. When the rough cut runs longer, propose `cut` ranges (source/edit.json) on digressions,
  repeats and false starts.
- Word-by-word sticker captions (`captions()`), big, in the creator's language (STYLE.md), near the seam in
  portrait; never over the key visual or the face.
- A music bed under the voice (`source/sound.py`), ducked by it; a tape stop on a dramatic pause when there is one.
- CTA at the end with the texts of STYLE.md, 2 to 3 s after the last sentence.
- Portrait (9:16): the motion design on top, the camera at the bottom; move the seam to give a visual the whole frame for one beat,
  then bring the face back; a punch-in (`cam.view.zoom`) on a strong word.

## Self-review checklist (stills/contact.jpg)
- [ ] Hook visible and readable before 2 s
- [ ] Captions readable and never covering the key visual or the face
- [ ] CTA present in the last seconds
- [ ] Every cut lands on a breath: no clipped word, no dead air left
- [ ] The face stays in frame in every format
