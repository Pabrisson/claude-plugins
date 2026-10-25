---
name: tutorial
description: Tutorials, screen recordings and courses: every step kept and clear, zooms on the action, callouts, chapters
params: {"breaths": {"sentence": 0.2, "comma": 0.1}, "music": true, "sfx": true, "graphics": "support", "max_static": 10}
---
## When writing the scene
- The screen recording is the source, or a `media` clip when the face cam is the source. Every step the viewer must
  reproduce stays, in order. Cut the waiting (loading, typing a long text) rather than speeding the voice up.
- Find the waiting: `ffmpeg -i assets/source.mp4 -vf freezedetect=n=0.003:d=2 -an -f null - 2>&1 | grep -o
  "freeze_[a-z]*: [0-9.]*"` lists where the screen stays still for 2 s or more (SOURCE seconds). Cut it when nothing
  is said; when the voice goes on, zoom or add a callout so the picture moves.
- Show the final result in the first 10 s, as the promise, then build it step by step.
- Zoom on the action: `cam.view = { zoom, x, y }` on the area being clicked or typed into (source pixels), held
  while it is used, then back to the whole screen between steps. Smooth moves (0.4 to 0.6 s, `power2.inOut`), never
  a zoom that chases a moving cursor.
- Callouts: an outline or a soft highlight on the button or field of the step, an arrow when it is small, the
  shortcut as a key cap when one is used.
- Mask every secret the screen shows (API keys, tokens, passwords, emails, customer data): a box in the
  interface's color or a blur over it, for as long as it is visible, following it when the view moves.
- A title per step (`part('sequence', …, { name: 'Step 2 · …' })`), and the chapter list in About.md.
- Face cam, when there is one: a small rounded window in a corner that never covers the area being used, full frame
  only for the intro and the end. A face cam recorded with the screen plays muted (`volume: 0`) when the voice comes
  from the source.
- Text on screen readable at phone size: blow up the interface rather than adding small labels.
- Music: a very quiet bed, or none; a soft click on each callout.

## Self-review: picture (stills/contact.jpg)
- [ ] Every step is visible, in order, and the area used is legible at phone size
- [ ] Each zoom shows the whole area being used and holds still while it is used
- [ ] No callout or face cam window over the area being used
- [ ] No secret readable on any frame
- [ ] The final result is shown at the start and before the end

## Self-review: sound and timing (check, audio, files/words.md)
- [ ] `video.mjs check` reports nothing
- [ ] No waiting left: every still screen without speech is cut
- [ ] The voice explains each step while it is on screen, not before or after
