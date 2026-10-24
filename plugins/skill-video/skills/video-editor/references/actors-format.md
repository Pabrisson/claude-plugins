# Optional actors: `actors/*.json`

Actors are ready-made, declarative elements (text, card, counter, logo, image, media, arrow, chip, bar, stamp, cta)
for the parts of a video that do not need a hand-built scene. They exist only when the project has an **`actors/`
folder**: every `actors/*.json` there (an array of actors, or one) is drawn on a full-stage canvas over the scene,
or where the scene puts `actors()`. Without the folder, the scene does everything.

The scene stays the creative center (see scene-format.md); actors share its clock and its style.

- Times are **source seconds** (like `at()` in the scene). Positions are in the **primary format's** canvas; in
  another format an actor is scaled and centered like the primary composition, unless its `formats` entry gives
  `fit: false` and its own position. `hidden: true` removes it from a format.
- Colors: `ink`, `accent`, `muted`, `paper`, `card` (the style's palette), `white`, `red`, or any CSS color.
  Text: `*word*` paints a word in the accent color, `\n` breaks the line.

## Keys

`keys: [[t, value, transition], …]`: from source time `t`, the value moves to `value` over `transition`
seconds (default 0.5, ease in-out). A key at or before the owner's start applies at once. Between keys the
value holds. A long transition gives a slow move (a Ken Burns zoom): `[[12, { s: 1.15 }, 4]]`.

For actors, `value` is an object of any props (`x`, `y`, `s`, `r`, `o`, `w`, `size`, `text`, `label`…):
numbers glide, texts switch at the key's time.

## Fields

The examples are written short, as JavaScript objects; in the `.json` files, quote the keys and strings.


| Field | Default | Meaning |
|---|---|---|
| `id` | required | Unique; the studio and the formats overrides use it |
| `type` | required | One of the types below |
| `from`, `to` | 0, end | Source seconds on screen (the exit plays after `to`) |
| `x`, `y` | canvas center | Center, logical px |
| `s`, `r`, `o` | 1, 0, 1 | Scale, rotation (degrees), opacity |
| `pre`, `post` | 0.45, 0.3 | Entrance and exit lengths (video seconds) |
| `enter` | per type | `pop`, `rise`, `fade`, `slam`, `left`, `right`, `none` |
| `keys` | | See above |
| `formats` | | This actor's overrides per format, e.g. `{ "1:1": { "fit": false, "x": 540, "y": 130 } }` |

## text
```js
{ id: 't', type: 'text', from: 1, to: 4, text: 'Rendu en *8,5 s*', size: 110, y: 320, w: 920, weight: 800, color: 'ink', align: 'center' }
```

## card
A raised paper card with a title, a body and an optional image on top.
```js
{ id: 'c', type: 'card', from: 4, to: 8, title: 'Remotion', body: '106,3 s · 7 workers', image: 'assets/images/remotion.png', w: 620, h: 420, align: 'left' }
```
Also: `radius`, `pad`, `fill`, `titleSize` (52), `bodySize` (32), `color`, `bodyColor`.

## counter
Counts from `value[0]` to `value[1]` from its entrance (`dur` seconds, 1.2 by default), in the creator's
language format (`106,3` in French). The suffix is in the accent color.
```js
{ id: 'n', type: 'counter', from: 8, to: 12, value: [0, 106.3], decimals: 1, suffix: ' s', size: 170, label: 'avec Remotion' }
```
Also: `prefix`, `color`, `accent`, `labelSize`.

## logo
A logo on a small white card (`card: false` for none), with an optional label below.
```js
{ id: 'l', type: 'logo', from: 2, to: 6, src: 'assets/logos/remotion.png', w: 180, label: 'Remotion', x: 300, y: 400 }
```

## image
```js
{ id: 'i', type: 'image', from: 3, to: 7, src: 'assets/images/shot.png', w: 640, radius: 28, r: -3 }
```
`h` defaults to the image's ratio; `shadow: false` removes the card behind it.

## media
A clip from `edit.json`'s `media`, playing at its own pace from the actor's entrance, with an optional label chip and dot.
```js
{ id: 'm', type: 'media', media: 'arc', from: 0, to: 6.9, w: 520, label: 'Mon dernier short', dot: 'accent', offset: 0.3 }
```
`ar` forces the ratio; `offset` starts the clip later (seconds). Its sound plays from its entrance through its exit,
at the media's `volume` (scene-format.md, `edit.json`).

## arrow
Drawn on during `draw` seconds (0.6). `a` and `b` are relative to the actor's `x, y` (0, 0 by default, so absolute).
```js
{ id: 'a', type: 'arrow', from: 5, to: 8, a: [420, 360], b: [660, 360], bend: -0.3, color: 'accent', width: 10 }
```

## chip
```js
{ id: 'ch', type: 'chip', from: 1.5, to: 4, text: 'Chrome + WebCodecs', dot: 'accent', y: 480 }
```

## bar
Fills from `value[0]` to `value[1]` (0 to 1) over `dur` seconds, with a label and the percentage.
```js
{ id: 'b', type: 'bar', from: 9, to: 13, label: 'CPU', value: [0, 0.92], w: 820, color: 'red' }
```

## stamp
```js
{ id: 's', type: 'stamp', from: 6, to: 8, text: 'secret', color: 'red', size: 72, x: 820, y: 220 }
```
Tilted −8° by default; it slams in.

## cta
The subscribe card: avatar, name and tagline from STYLE.md, then the button turns into its done state
`press` seconds (1.1) after the entrance.
```js
{ id: 'cta', type: 'cta', from: 61.5, y: 560 }
```
Override with `name`, `sub`, `button`, `done`, `avatar`, `w`.

