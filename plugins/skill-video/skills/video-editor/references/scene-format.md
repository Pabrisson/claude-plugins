# The scene: `source/scene.js`

The video is a web page you write. `source/scene.js` is an ES module whose default export builds the scene once,
with anything the web offers: HTML, CSS, SVG, canvas, and a **GSAP timeline** with its plugins (SplitText,
DrawSVG, MorphSVG, MotionPath, ScrambleText, Text, CustomEase, CustomWiggle). The engine then puts the page at
every frame's time (`tl.seek(t)`), captures it and encodes it. Be as inventive as the story deserves: there is
no catalog of allowed effects, and the engine imposes no look.

```
source/scene.css   the design system, loaded before the scene: type scale, colors per sequence, textures,
                   classes for the recurring pieces, @font-face rules
source/scene.js    the scene (code): builds the DOM with those classes, animates it on `tl`
source/sound.py    the music and the sound design (sound-format.md)
source/edit.json   data the engine reads: { duration, cut, poster, media }
actors/*.json      optional declarative actors, see actors-format.md
```

Write the look in `scene.css` first, then the scene: classes keep forty scenes consistent, and inline styles
drift. `engine/test/scene-demo.js` (with a camera) and `scene-scratch.js` (no source) show the API, not a look to
copy.

```css
/* scene.css */
#stage { --cream: #fbf4ea; --night: #1d1b1d; background: var(--cream) }
.seq { position: absolute; inset: 0 }
.seq.dark { background: var(--night); color: var(--cream) }
.seq.red { background: var(--accent); color: #fff }
.giant { font: 800 360px/0.85 var(--font); letter-spacing: -0.04em; white-space: nowrap }
```

```js
export default async function scene({ stage, tl, at, W, H, pick, cue }) {
  const seq = document.createElement('section')
  seq.className = 'seq dark'
  seq.innerHTML = `<h1 class="giant">TRANSPORT</h1>`
  stage.append(seq)
  const { chars } = SplitText.create(seq.firstChild, { type: 'chars', mask: 'chars' })
  // bigger than the frame: the word crosses it
  tl.fromTo(seq.firstChild, { x: W }, { x: -seq.firstChild.offsetWidth, duration: 2.4, ease: 'power2.inOut' }, at(0.4))
  tl.from(chars, { yPercent: 110, duration: 0.6, ease: 'expo.out', stagger: 0.025 }, at(0.4))
  cue('whoosh', at(0.4), { dur: 2.4 })
}
```

## Rules the render depends on

- **Time**: the timeline runs in **video seconds**. Anchor every moment on the transcript with `at(source seconds)`
  (`files/words.md` gives source times): cuts and speed-ups then never break the sync. Without a source video,
  `at(t) === t`.
- **Only the timeline moves things.** Put every tween on `tl` (or on timelines added to it). GSAP's own clock is
  stopped, so `gsap.to()` outside `tl` never plays. For values computed per frame (counters, canvas drawings),
  use `tick(t => …)`. No `Date`, `performance.now()`, `Math.random()` (use `rng(seed)`), no CSS transitions, no
  `tl.call()` side effects: chunks render out of order and must look the same. CSS `@keyframes` animations are fine:
  the engine seeks them too.
- **Motion blur**: `render --blur 4` averages 4 sub-frames per frame (180° shutter). A text whose content changes
  with time (a counter, typed text) smears across them: compute it from `frame(t)`, the time of the frame, so it
  stays sharp. Tweens of position, scale and opacity blur as they should.
- **Canvases**: put a `<canvas>` at `left:0; top:0` (full stage is the easy way) and move it with transforms only:
  a canvas placed by layout renders blank (Chrome's DOM capture limit; the page warns). Images, SVG (text included),
  CSS backgrounds, masks, clip-paths, filters, blend modes and shadows all capture normally.
- **Formats are recomposed, not shrunk.** The same scene builds every format; read `W`, `H`, `format` or use
  `pick(landscape, portrait, tall)` (portrait = 4:5 and up, tall = 9:16), and CSS on
  `#stage.landscape | .square | .portrait | .tall` or `#stage[data-format="9:16"]`. Same timings everywhere (one
  soundtrack). Compose the main format first, then give each other format its own pass.
- **The style is material.** Follow STYLE.md's notes; take its palette, fonts and symbols. Every color of the palette
  is on the stage as a CSS variable (`var(--paper)`, `var(--ink)`, `var(--accent)`, and the brand's others such as
  `var(--coal)`), the font as `var(--font)`; `style` holds the rest (creator name, CTA texts, language). Use the
  palette as fields, not as one background: they switch on the Direction's color story. The style's fonts are
  already loaded; another one goes in `scene.css` with `@font-face` pointing at a file in `assets/fonts/` (no remote
  fonts: the render is offline).
- **Assets**: `asset('logos/x.png')` is the URL of `assets/logos/x.png`. Fetch logos and images into `assets/`
  first (PNG, JPEG, WebP, SVG).

## What the scene receives

| Field | |
|---|---|
| `stage` | The root element, `W × H` CSS pixels (short side 1080), `overflow: hidden` |
| `W`, `H`, `format`, `formats`, `fps`, `duration` | This render's canvas, all the project's formats, frame rate, video length |
| `tl`, `gsap` | The paused master timeline, and GSAP (plugins are globals: `SplitText`, `DrawSVGPlugin`…) |
| `at(s)`, `source(v)` | Source seconds → video seconds, and back |
| `frame(t)` | `t` rounded to its frame: for texts that change with time under motion blur |
| `words` | The speech, word by word: `{ w, t0, t1 }` source seconds, `{ v0, v1 }` video seconds (empty without speech) |
| `style` | style.json merged with the defaults (`creator`, `look`, `notes`) |
| `pick(land, port, tall)` | The value for this format |
| `camera()` | The source camera (below), or `null` without a source |
| `clip(id, start)` | A clip of `edit.json`'s `media` as a box playing from video time `start` |
| `captions(opts)` | Word-by-word sticker captions of the speech (below) |
| `paper()` | `Promise<string>`: a paper texture as a CSS background, only when the style asks for a paper look |
| `cue(kind, t, data)` | A named sound moment at video time `t`, for sound.py: any kind and data (`{ dur, x, … }`) |
| `part(kind, t0, t1, data)` | A part of the picture from `t0` to `t1` (video seconds), for the studio's Clip tab: `'sequence'` with `{ name, field }` (`field`: the palette color it sits on), or a key element of any kind (`'title'`, `'counter'`…) with `{ name }` |
| `say(text, from, to)` | What the viewer reads from `from` to `to` (video seconds): one line of the transcript (below) |
| `tick(fn)` | `fn(t)` runs at every frame (and sub-frame), after the timeline |
| `num(n, decimals)` | A number in the creator's language (`11 726`, `106,3`) |
| `rng(seed)` | A seeded random generator |
| `actors()` | The actors canvas (when `actors/` exists), to place it at a chosen depth; otherwise it goes on top |
| `variant` | `0` in renders; `1…N` in `stills <s> --variants N` (see Variations) |

### camera()

A box (`div.ve-camera`, `position:absolute; inset:0` by default) showing the source frame of each instant, covering
the box. Put it in any container (a band, a rounded window, a phone mockup, a circle with `border-radius:50%`),
several times if you like. Its focus stays at 42 % of the height: the face when the `face_framing` rule is on, the
center otherwise. `cam.view = { zoom, x, y }` is tweenable: `zoom > 1` tightens (punch-ins), `x`, `y` force a focus
in source pixels.

```js
const cam = camera(), win = document.createElement('div')
win.style.cssText = `position:absolute;left:0;top:${H * 0.6}px;width:${W}px;height:${H * 0.4}px;overflow:hidden`
win.append(cam)
stage.append(win)
tl.to(cam.view, { zoom: 1.25, duration: 0.2, ease: 'power3.out' }, at(22.1))
```

### captions(opts)

`div.ve-captions` (full width, centered): groups of `words` (3) ending on punctuation or a pause; each word pops in
when it is said. `size` defaults to STYLE.md's caption size. Place it (`style.top`, `left`, `width`) and restyle
it with CSS (`.ve-captions span` is a word). Only for speech.

## `source/edit.json`

```json
{ "duration": 45, "cut": [[12.4, 14.1]], "poster": 2.5, "media": { "arc": { "src": "assets/clips/arc.mp4", "from": 2, "dur": 6, "width": 720 } } }
```

`duration` (seconds) is required without a source; with one, the timeline gives it. `cut` holds ranges to remove
(the studio's cuts): source seconds with a source; without one, seconds of the scene's own time. The scene keeps
its timings and the engine skips the cut ranges, along with the cues and `say()` lines inside them. `duration` in
the scene stays the scene's full length. `poster` is the source time of the poster frame, `media` the clips `clip()` and media actors
play (extracted as frames at the project's rate).

## The transcript of a video without speech

Without speech, the transcript is what the video shows, one line per moment. It feeds `files/words.md`, the studio's
Transcript panel and the `On screen:` lines of the Copy prompt, so it has to read like what a viewer reads.

**Declare it with `say()`**, next to the tweens that show the text: you know what each moment means, the page does
not. One call per moment, in plain words, without the decoration:

```js
say("Vous êtes e-commerçant, une marketplace, logisticien, transporteur ou expéditeur", at(6.25), at(9))
say("Des relances clients dans toutes les langues : « Où est mon colis ? », « Where is my parcel? »…", at(19.25), at(21.25))
```

With one `say()` or more, the transcript is exactly these lines. Without any, the engine samples the readable texts
4 times a second, and that guess has limits:
- it reads a block's own text, in reading order;
- it skips text clipped by a mask or a window, faint text (opacity under 0.4) and small text (under about 24 px
  at 1080);
- it groups each moment's texts on one line.

Rolling words, split letters and mock interfaces still come out rough. Correct a group with `data-say="…"` (its
text replaces what is inside), and leave decoration out with `data-say=""`.

## Sound

The music and the sound design are written for each video in `source/sound.py`: see `sound-format.md`. The scene's
`cue()` calls are its timeline of events (exported by `render` and `stills` into `.cache/cues.json`).

## Parts

The studio's Clip tab shows the video as thumbnails and, under them, one row per kind of `part()`. Declare them next
to the tweens they describe, so the user's feedback can name them and you find them back:

```js
part('sequence', at(26), at(28), { name: 'the reveal', field: 'accent' })
part('title', at(26.2), at(27.8), { name: 'Figural' })
```

A `clip()` is a part of its own (`kind: 'clip'`), and with a source `final` adds the kept takes (`kind: 'take'`).
`render` and `stills` export the parts into `.cache/parts.json`; `final` keeps them in `files/video/vN.json`.

## Checking

`video.mjs stills [source seconds…] --format all`: images and a contact sheet per format (without times: one per
beat of the timeline). Ask for the moments that matter: both sides of every transition, the middle of fast moves,
the last frame of each sequence. `video.mjs preview`: the scene live in Chrome, with the tweens and cues around the
playhead; R reloads it. Renders run at about 175 to 280 frames per second, four times slower with `--blur 4`.

## Variations

To let the user choose how one element looks, make the scene read `variant` around that element only, then render
the options on one numbered sheet:

```js
// 0 is the edit (the current choice); 1…6 are the options shown on the sheet
const look = [2, 1, 2, 3, 4, 5, 6][variant]
counter.className = `counter look-${look}`
```

`video.mjs stills 12.4 --variants 6` → `stills/<ratio>/variants/contact.jpg` (`#1`…`#6`) and one image each. Once
the user picks, write the choice into the scene without `variant` (the edit must not depend on it). For the sound,
`sound.py` reads `v.variant` the same way, and `video.mjs audio --at 12.4 --variants 4` renders 8 s of the mix per
option into `stills/sound/<n>.wav`.
