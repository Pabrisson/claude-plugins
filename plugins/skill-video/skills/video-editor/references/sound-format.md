# The sound: `source/sound.py`

You compose the music of each video in code, the way the scene is written, and you give it its effects: the
projects folder's library has the common ones ready, and you design the others, as many as the video needs.
`source/sound.py` is a Python module (numpy and the standard library only) whose
`sound(v)` returns the video's music and effects. The engine (`engine/audio.py`) runs it, then does the mixing:
- with a voice, it edits the voice (each rush brought to the same level, no rumble under 80 Hz, a light denoise, a
  gentle compression), ducks the music under it, and sets the music and the effects to the style's levels;
- without a voice, it keeps your balance between music and effects;
- it adds the media clips' own sound where the scene plays them, at the music bed's loudness times their `volume`
  (`edit.json`), ducked under the voice: you do not place them in `sound.py`;
- in every case, the whole mix goes to -14 LUFS with its true peak (4× oversampled) under -1.5 dBTP, so that AAC,
  which overshoots by up to about 1 dB, mostly stays under -1 dBTP. When it does not, `final` lowers that encoded
  track by 0.5 dB steps until the delivered file is under -1 dBTP.

`video.mjs audio` builds `assets/mix.wav` and prints its loudness. `final` rebuilds it whenever `sound.py`, the cues,
the timeline or a sound of the library changed.

```python
from audio import *          # the kit below, numpy as np, SR = 48000

def sound(v):
    music, fx = bus(v.n), bus(v.n)
    ...                      # compose
    return music, fx         # each (2, v.n) or mono (v.n); a single array is the music
```

| `v.` | |
|---|---|
| `duration`, `n` | Length in seconds and in samples (48 kHz) |
| `cues` | The scene's `cue(kind, t, data)` calls, `[{ "kind", "t", …data }]` in video seconds, sorted |
| `words` | The spoken words `[{ "w", "v0", "v1" }]` in video seconds (empty without speech) |
| `speech` | Whether a voice plays: the music is then a bed under it, otherwise it carries the video |
| `variant` | `0`, or `1…N` for sound variations (`audio --at <s> --variants N`) |

**Same plan, same file.** The output must be deterministic: seed every generator (`np.random.default_rng(7)`),
never use the clock.

## The kit

| | |
|---|---|
| `secs(d)` | The time axis of `d` seconds (a numpy array) |
| `hz(m)` | MIDI note → Hz (`hz(69)` = 440) |
| `bus(n)` | An empty stereo bus `(2, n)` |
| `place(bus, t, sig, gain=1, pan=0)` | Adds `sig` at `t` seconds: mono is panned from -1 to 1 at constant power, `(2, n)` goes as is |
| `filt(x, lo=None, hi=None, order=2)` | High-pass at `lo`, low-pass at `hi` (Hz), on any array |
| `band_noise(d, fc, bw, rng)` | Noise in a band `bw` octaves wide whose center follows `fc(p)`, `p` from 0 to 1: whooshes, risers, wind |
| `sweep(d, f0, f1, k)` | A sine gliding from `f0` to `f1` at rate `k`, with its time axis: kicks, drops, zaps |
| `osc(f, t, bright=8, phase=0)` | A band-limited saw-like wave; `bright` 1 is almost a sine, 3 a soft pad, 8+ bright; `f` in Hz or per sample |
| `adsr(d, a, dc, s, r)` | The envelope of a note held `d` seconds (attack, decay to sustain, release) |
| `reverb(x, d=2, wet=.3, seed=0)` | `x` plus a `d`-second tail; mono comes back stereo |
| `tape_stop(x, t, back, d=.6)` | Slows `x` down to a stop at `t`, silent until `back` (in place) |
| `load(path)` | A sound file (WAV, MP3, M4A, FLAC…) as a stereo array at 48 kHz, path relative to the video's folder: a track the user gives (`return load('assets/track.mp3')`), a recorded sound to place |
| `play(bus, c, gain=1)` | Places the effect of cue `c` from the library (below): `for c in v.cues: play(fx, c)` |
| `lufs(x)`, `norm(x, target)` | The loudness of a stereo array, and the array brought to `target` LUFS: to set the balance of music and effects without a voice (`return norm(music, -16), norm(fx, -20)`) |

## The effects: the library

The effects are the projects folder's, not each video's: every video of the folder plays the same `whoosh`, so its
videos sound like one brand. A kind of sound exists once, in `.sound/` (next to `.style/` and `.rules/`), as one file
or several takes that play in turn (`whoosh.wav`, `whoosh-2.wav`…). A video's `assets/sound/<kind>.*` overrides it for
that video only. The library is not frozen like the style: a sound made again changes it for every video at its next
`audio`.

**The catalog** (`engine/sfx.json`): the library's ready-made kinds, for the common events. It is a base, not a
limit: when the video needs a sound of its own, invent its kind (« Sounds of your own », below). `check` flags only a
cue that no sound plays. The old names in the catalog's aliases still play their kind (`swoosh` is a `whoosh`).

| Kind | For | Also |
|---|---|---|
| `whoosh` | a move across the frame, a transition | swoosh, slide, sweep, wipe, zoom, morph… |
| `swish` | a quick small move: a line drawn, a bar that fills, a card that swaps | draw, fill, bar, slash, swap… |
| `riser` | a build-up whose climax lands on the cue | rise, grow, swell, suck |
| `drop` | something that falls or goes down | dive, fall |
| `impact` | the big hit of a reveal or a turn | slam, reveal, crack, strike, sting… |
| `hit` | a small dry hit: a cut, a snap, a word that lands | snap, slap, clap, cut |
| `thud` | something set down, docked, stacked or closed | layer, stack, dock, close… |
| `stamp` | a stamp, a seal, a validation pressed on | seal |
| `pop` | an element that appears: a bubble, a tag, a chip | bubble, chip, tag, cascade… |
| `click` | an interface click: a button, a key, a switch, a selection | key, press, select, tab, switch… |
| `type` | one keystroke of typed text | letters, typing |
| `tick` | a counter, a clock, rolling digits | count, counter, countup, clock, roll… |
| `blip` | a short electronic beep: a signal, a pulse, a sonar | pulse, sonar, ripple |
| `chime` | a success, a notification, a bright resolve | ding, bell, ok, done, check… |
| `error` | a failure, a loss, an alarm | alarm, loss, fail |
| `shimmer` | a shine, a sparkle, a scan of light | shine, sparkle, scan |
| `glitch` | a digital glitch: scrambled text, a rewind, a scratch | scramble, rewind, scratch |
| `paper` | paper: a flap, a tear, a page flipped, a print | flap, tear, flip, print |

`video.mjs sounds` prints the catalog with every alias and what the library has.

**What a cue's data does** with `play()`:
- `x`: where it sits on screen, -1 to 1: the sound is panned there;
- `dur`: the move's length: `whoosh`, `swish`, `riser` and `drop` fit it (within 0.67× to 1.5×);
- `pitch`: semitones up (or down); `i` of `n` climbs an octave over a count (the steps of a counter);
- `n` with `step` (s) or `dur`: a series of `n` sounds, `step` apart or spread over `dur` (typed text, rolling digits);
- `gain`: louder or softer than the kind's level.

The loudest instant of the sound lands on `t` (a whoosh's middle, a riser's climax). Each occurrence differs a
little in pitch and level, and the takes alternate, so 30 pops never sound like one sample.

**Only what the video needs.** Once the scene is written and its stills rendered, `video.mjs sounds -p <slug>` lists
the kinds its cues use and where each sound comes from (the video, the library, `sound.py`, or missing), then how to
make the missing ones. For a kind of the catalog:
- with the kit (no credit): `video.mjs sfx <kind>… --local` synthesizes three takes of each into `.sound/`;
- with ElevenLabs, when `source/elevenlabs.json` turns `sfx` on: `video.mjs sfx <kind> -p <slug>`, one kind per call, from
  the catalog's prompt at the catalog's length (give your own prompt as a second argument when the brand calls for
  it: describe the sound, not the picture).

`--here` makes the sound for this video only (`assets/sound/`), when it must differ from the project's. A sound that is
there is made again only with `--force`: an ElevenLabs one costs credits again, so make again only the one a comment
is about.

**Sounds of your own.** The library takes care of the common events; what makes this video's sound is yours to
design: its signature, a sound that plays in the key of the music, one that follows the data (a counter that climbs, a
chart that fills), a moment no kind of the catalog says. Make as many as the video needs, under any name, three ways:
- **In `sound.py`**, for this video only: designed in code like the music, in layers (a transient, a body, a tail),
  tuned to the score and the scene, placed with `place()` on its cue.
- **In the library**, for every video of the folder: `def <name>(rng)` in `.sound/sfx.py`, returning a mono or
  stereo array (`from audio import *`; `import sfx` gives the kit's designs, `sfx.whoosh`…), then
  `video.mjs sfx <name> --local`. The cues of that name then play it. A `def` named after a kind of the catalog
  replaces the kit's design of it for the project.
- **With ElevenLabs**, when `sfx` is on: `video.mjs sfx <name> "<the sound>" [--length <s>] -p <slug>` (1 s unless
  said).

A sound baked into the library goes through the finish: the kind's band, its stereo width and a short tail for a kind
of the catalog, the design's own band and length for a sound of your own, and its peak at -1 dBFS.

**What makes an effect sound recorded rather than synthesized** (measured on ElevenLabs' effects against the kit's
first designs; the kit's designs follow it, follow it in yours):
- **Width.** Moves, hits and sparkles are wide (decorrelated left and right); pops, keys and thuds stay mono.
- **Short, dry tails.** 30 to 400 ms from the peak down to -40 dB. No reverb on the effects: the music carries the
  space.
- **Shape.** A fast rise and a slower fall: a whoosh peaks a fifth of the way in, and its pitch falls as it passes.
- **Each kind in its own band.** A whoosh in the mids (250 Hz to 4 kHz, not hiss), a thud at 80 to 250 Hz (not a
  sub), a key with a body around 400 Hz, a tick at 2.8 kHz, a blip at 900 Hz gliding down, a chime and a shimmer
  above 6 kHz.
- **Grain.** Micro-transients and a level that is never smooth; a sharp peak (crest 15 to 28 dB).

## With ElevenLabs

When the video's `source/elevenlabs.json` turns on `music` or `sfx` (the user's choice at its start), ElevenLabs
makes them and `sound.py` places them: the kit only shapes them (fades, filters, pan) and makes the rest. The
commands refuse what the file leaves off.
- **The music**: `video.mjs music "<prompt>" --length <video s> -p <slug>` writes an instrumental track to
  `assets/sound/music.mp3`. Write the prompt as the score you would compose: the mood of the style's notes, the
  Direction's tempo (« 120 bpm »), the instruments, and the arrangement on the story with its times (« sparse intro,
  builds from 4 s, a break at 9.5 s, full on the reveal at 10 s, resolves on a final chord at 15 s »). Never name an
  artist. Make it the video's length, then `video.mjs beats assets/sound/music.mp3 -p <slug>` measures its grid for
  the scene's cuts. When the video's length changes, make it again rather than cutting it off.
- **The effects**: the ones the library lacks for this video's cues (`video.mjs sounds -p <slug>` lists them),
  `video.mjs sfx <kind> -p <slug>` each. They go to the library, so the next videos of the folder play them too, and
  `play()` places them.
- **Each file is made once.** Making it again takes `--force` and costs credits again: change only the one a comment
  is about.
- **Refused**: when a command answers that the key may not (a missing permission, the plan, the credits), the kit
  makes that part, as without ElevenLabs (`sfx <kind> --local` for an effect), with no new attempt. Tell the user in
  the summary.

```python
from audio import *

def sound(v):
    music, fx = bus(v.n), bus(v.n)
    place(music, 0, load('assets/sound/music.mp3'))
    music[:, -SR // 2:] *= np.linspace(1, 0, SR // 2)        # no click if it runs past the end
    for c in v.cues: play(fx, c)
    return music, fx
```

## Composing for the picture

- **Tempo first.** Pick a tempo for the mood, then time the scene's big moments on its grid. `video.mjs beats <bpm>`
  lays it out in `files/beats.md` (a user's track: `beats <track> [--at <video s>]` measures its tempo, beats and
  downbeats). At 120 bpm a beat is
  0.5 s and a bar is 2 s, so a reveal at 24.0 s falls on a downbeat. A cut on the beat feels intended, and one half
  a beat off feels like a mistake.
- **Arrange on the story, not on a loop.** Follow the beats of About.md:
  - a sparse intro under the hook;
  - layers that come in as the problem grows;
  - a break before the turn: silence, a filtered pad or a tape stop, so the answer lands;
  - the full arrangement on the reveal;
  - an ending that resolves on the last frame.

  A four-chord progression in a key that fits the mood, with chords that change on the bars, is enough material.
  Detuned `osc` pads, a bass on the roots, a pluck or a bell arpeggio for light, and drums give it variety.
- **Synthesize the drums yourself.**
  - kick: a `sweep(.4, 160, 48, 28)` with a fast decay, plus a click of noise;
  - clap and snare: band-filtered noise bursts;
  - hats: high-passed noise of 50 ms.

  Pump the pads under the kick (sidechain) for drive.
- **A sound per event.** The cues carry the scene's events: give a common one the catalog's kind it is (a reveal is
  an `impact`, typed text a series of `type`, a counter a series of `tick`), with what the sound needs (`x`, `dur`,
  `n` and `step`, `pitch`), and `play()` places it. Design the others: the moments that make the video, the sounds that
  belong to the music (a tape stop, a riser in the key, the last chord), whatever the scene needs that the catalog
  lacks. Build each from layers (a transient, a body, a tail), pan it where the thing is on screen, and put its
  loudest instant on the cue.
- **Mix for phones.** Too much below 80 Hz sounds dull on a phone and eats loudness. Leave room around 2 to 5 kHz for
  the effects, and give the music a little reverb for space (the effects stay dry).

## Checking (you cannot listen, so measure)

- `video.mjs audio -p <slug>` prints the length, loudness and true peak.
- Read `assets/mix.wav` with `wave` and numpy, then check:
  - the energy per band (sub < 80 Hz, low, mid, high) of each section, against what you intended;
  - that the effects start on their cues (the envelope rises within a few milliseconds of `t`);
  - that the break is actually quiet.
- Vectorize: build a bar once and `place` it again and again; no Python loop per sample. 45 s of music should
  compute in a few seconds.

## A skeleton

```python
from audio import *

BPM = 120
BEAT = 60 / BPM
CHORDS = [(50, 53, 57), (46, 50, 53), (53, 57, 60), (48, 52, 55)]   # Dm Bb F C, one per bar

def kick(rng):
    s, t = sweep(.4, 160, 48, 28)
    return np.tanh(2 * s * np.exp(-t * 9) + .4 * filt(rng.standard_normal(len(t)), 1500) * np.exp(-t * 300))

def pad(notes, d):
    t = secs(d + 1)
    return sum(osc(hz(m) * c, t, 3) for m in notes for c in (.997, 1.003)) * adsr(d, .3, .5, .8, 1)

def sound(v):
    rng = np.random.default_rng(7)
    music, fx = bus(v.n), bus(v.n)
    bar = 4 * BEAT
    for i in range(int(v.duration / bar) + 1):
        place(music, i * bar, pad(CHORDS[i % 4], bar), .08)
        for b in range(4) if i >= 2 else ():             # the drums come in on bar 3
            place(music, i * bar + b * BEAT, kick(rng), .5)
    for c in v.cues: play(fx, c)
    return reverb(music, 2.5, .2), fx
```
