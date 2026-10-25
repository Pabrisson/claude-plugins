# The sound: `source/sound.py`

There are no presets. You compose the music and design the sounds of each video, in code, the way the scene is
written: `source/sound.py` is a Python module (numpy and the standard library only) whose `sound(v)` returns the
video's music and effects. The engine (`engine/audio.py`) runs it, then does the mixing:
- with a voice, it edits the voice (each rush brought to the same level, no rumble under 80 Hz, a light denoise, a
  gentle compression), ducks the music under it, and sets the music and the effects to the style's levels;
- without a voice, it keeps your balance between music and effects;
- it adds the media clips' own sound where the scene plays them, at the music bed's loudness times their `volume`
  (`edit.json`), ducked under the voice: you do not place them in `sound.py`;
- in every case, the whole mix goes to -14 LUFS with peaks under -1 dBFS.

`video.mjs audio` builds `assets/mix.wav` and prints its loudness. `final` rebuilds it whenever `sound.py`, the cues
or the timeline changed.

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
- **Design one sound per kind of event.** The cues carry the scene's events, and each kind gets its own sound:
  - a `band_noise` whoosh shaped like the move;
  - an impact for a reveal: a low sweep, a noise burst and reverb;
  - ticks that follow a counter;
  - clicks for typed text;
  - a riser that ends on the hit;
  - a glassy bell for a pop of interface.

  Build each from layers: a transient, a body, a tail. Pan it where the thing is on screen (pass `x` in the cue's
  data). Put a whoosh's loudest point on the cue, and end a riser on it.
- **Mix for phones.** Too much below 80 Hz sounds dull on a phone and eats loudness. Leave room around 2 to 5 kHz for
  the effects, and add a little reverb to give space.

## Checking (you cannot listen, so measure)

- `video.mjs audio -p <slug>` prints the length, loudness and peak.
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

def whoosh(c, rng):
    d = c.get('dur', .6)
    s = band_noise(d, lambda p: 600 * 6 ** p, 1.2, rng) * np.sin(np.pi * np.linspace(0, 1, int(d * SR))) ** 2
    return s, -d / 2          # loudest on the cue

def sound(v):
    rng = np.random.default_rng(7)
    music, fx = bus(v.n), bus(v.n)
    bar = 4 * BEAT
    for i in range(int(v.duration / bar) + 1):
        place(music, i * bar, pad(CHORDS[i % 4], bar), .08)
        for b in range(4) if i >= 2 else ():             # the drums come in on bar 3
            place(music, i * bar + b * BEAT, kick(rng), .5)
    for c in v.cues:
        if c['kind'] == 'whoosh':
            s, off = whoosh(c, rng)
            place(fx, c['t'] + off, s, .4, c.get('x', 0))
    return reverb(music, 2.5, .2), reverb(fx, 1.2, .15)
```
