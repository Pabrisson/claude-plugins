---
name: tutorial
description: Tutorials, screen recordings and courses: every step kept and clear, zooms on the action, callouts, chapters
params: {"breaths": {"sentence": 0.2, "comma": 0.1}, "music": true, "sfx": true, "graphics": "support", "max_static": 10}
---
## When writing the scene
- The screen recording is the source, or a `media` clip when the face cam is the source. Every step the viewer must
  reproduce stays, in order. Cut the waiting (loading, typing a long text) rather than speeding the voice up.
- Zoom on the action: `cam.view = { zoom, x, y }` on the area being clicked or typed into (source pixels), held
  while it is used, then back to the whole screen between steps. Smooth moves (0.4 to 0.6 s, `power2.inOut`), never
  a zoom that chases a moving cursor.
- Callouts: an outline or a soft highlight on the button or field of the step, an arrow when it is small, the
  shortcut as a key cap when one is used.
- A title per step (`part('sequence', …, { name: 'Step 2 · …' })`), and the chapter list in About.md.
- Face cam, when there is one: a small rounded window in a corner that never covers the area being used, full frame
  only for the intro and the end. A face cam recorded with the screen plays muted (`volume: 0`) when the voice comes
  from the source.
- Text on screen readable at phone size: blow up the interface rather than adding small labels.
- Music: a very quiet bed, or none; a soft click on each callout.

## Self-review checklist (stills/contact.jpg)
- [ ] Every step is visible, in order, and the area used is legible at phone size
- [ ] Each zoom shows the whole area being used and holds still while it is used
- [ ] No callout or face cam window over the area being used
- [ ] The final result is shown before the end
