# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""The video's sound. Claude writes the music and the sound design of each video in the project's source/sound.py
(references/sound-format.md); this file runs it and mixes it with the edited voice: the music ducks under the
voice, the mix goes to -14 LUFS with peaks under -1 dBFS. It is also the kit sound.py imports (`from audio import *`):
placement, filters, noise, oscillators, envelopes, reverb, tape stop. numpy only, no audio file.

  uv run audio.py <plan.json> [--variant n] [--at <s> --len 8] [--out x.wav]
  uv run audio.py --selftest

The plan, written by video.mjs audio (every time in VIDEO seconds):
  {"duration": 43.2, "voice": "…/assets/voice.wav" | null, "sound": "…/source/sound.py" | null, "variant": 0,
   "cues": [{"kind": "hit", "t": 1.2}], "words": [{"w": "Bonjour", "v0": 0.4, "v1": 0.8}],
   "levels": {"music": -21, "sfx": -28.5, "duck": 0.5}, "out": "…/assets/mix.wav"}
"""
import argparse, importlib.util, json, os, sys, tempfile, time, wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np

__all__ = ['SR', 'np', 'secs', 'hz', 'bus', 'place', 'filt', 'band_noise', 'sweep', 'osc', 'adsr', 'reverb', 'tape_stop', 'load']

SR = 48000
# loudness of the mix, its peak ceiling (dBFS); under a voice: the music bed and the effects (LUFS), the music's
# gain while someone speaks (1 - duck)
LEVELS = {'lufs': -14, 'peak': -1, 'music': -21, 'sfx': -28.5, 'duck': 0.5}


# ── kit ─────────────────────────────────────────────────────────────────────
def secs(d): return np.arange(int(round(d * SR))) / SR
def hz(m): return 440 * 2 ** ((m - 69) / 12)
def bus(n): return np.zeros((2, n))


def place(bus, t, sig, gain=1.0, pan=0.0):
    """Adds a mono (panned -1…1, constant power) or stereo (2, n) signal into bus at t seconds."""
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
    i = int(round(t * SR))
    if i < 0: sig, i = sig[:, -i:], 0
    k = max(0, min(sig.shape[1], bus.shape[1] - i))
    bus[:, i:i + k] += sig[:, :k] * gain


def filt(x, lo=None, hi=None, order=2):
    """High-pass at lo and/or low-pass at hi (Hz), Butterworth-like slopes, in the frequency domain."""
    f, g = np.fft.rfftfreq(x.shape[-1], 1 / SR), 1.0
    if hi: g = g / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo: g = g / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x) * g, x.shape[-1])


def band_noise(d, fc, bw, rng):
    """d seconds of noise in a band bw octaves wide whose center follows fc(p), p from 0 to 1 (whooshes, risers)."""
    n, win, hop = int(d * SR), 1024, 256
    x, out, w, fr = rng.standard_normal(n + win), np.zeros(n + win), np.hanning(win), np.fft.rfftfreq(win, 1 / SR)
    for s in range(0, n, hop):
        g = np.exp(-.5 * (np.log2(np.maximum(fr, 1) / fc(s / n)) / (bw / 2)) ** 2)
        out[s:s + win] += np.fft.irfft(np.fft.rfft(x[s:s + win] * w) * g, win) * w
    return out[:n] / (np.abs(out).max() + 1e-9)


def sweep(d, f0, f1, k):
    """A sine gliding from f0 to f1 Hz at rate k (kicks, zaps, drops), with its time axis."""
    t = secs(d)
    return np.sin(2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t * k)) / SR), t


_TABLES = {}


def osc(f, t, bright=8, phase=0.0):
    """Band-limited saw-like wave (bright=1: almost a sine, 3: soft pad, 8+: bright), f in Hz or an array per sample."""
    f0 = float(np.max(f))
    key = (round(bright, 2), min(40, int(15000 / max(f0, 20))))
    if key not in _TABLES:
        k = np.arange(1, key[1] + 1)
        _TABLES[key] = (np.sin(2 * np.pi * np.outer(np.arange(4096) / 4096, k)) / k / (1 + (k / bright) ** 4)).sum(1)
    ph = np.cumsum(np.broadcast_to(f, t.shape)) / SR if np.ndim(f) else f * t
    return _TABLES[key][((ph + phase) % 1 * 4096).astype(int)]


def adsr(d, a=.005, dc=.15, s=.7, r=.2):
    """Envelope of a note held d seconds: attack a, decay to sustain s within dc, release r after d (d + r long)."""
    t = secs(d + r)
    e = np.minimum(1, t / max(a, 1e-4)) * (s + (1 - s) * np.exp(-np.maximum(t - a, 0) * 4.6 / max(dc, 1e-4)))
    return e * np.clip((d + r - t) / max(r, 1e-4), 0, 1)


def reverb(x, d=2.0, wet=.3, seed=0, lo=200, hi=7000):
    """x plus a d-second reverb tail (decaying stereo noise), wet share of it; mono x comes back stereo."""
    x = np.stack([x, x]) if x.ndim == 1 else x
    t, rng = secs(d), np.random.default_rng(seed)
    ir = filt(rng.standard_normal((2, len(t))) * np.exp(-t * 6.9 / d), lo, hi)
    ir[:, :int(.012 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(1, keepdims=True))
    n, size = x.shape[1], 1 << (x.shape[1] + len(t)).bit_length()
    return x + wet * np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:, :n]


def tape_stop(x, t, back, d=.6):
    """The tape slows down to a stop over d seconds from t, then silence until back (seconds), in place."""
    i, j = int(t * SR), min(int(back * SR), x.shape[1])
    if j <= i: return
    k = min(int(d * SR), j - i)
    u = np.arange(k) / (d * SR)
    pos = i + d * SR / 3 * (1 - (1 - u) ** 3)
    for c in range(x.shape[0]): x[c, i:i + k] = np.interp(pos, np.arange(i, i + k), x[c, i:i + k]) * (1 - u ** 3)
    x[:, i + k:j] = 0
    f = min(480, x.shape[1] - j)
    x[:, j:j + f] *= np.linspace(0, 1, f)


def load(path):
    """A 16-bit 48 kHz WAV (path relative to the video's folder) as a stereo array: a given track, a recorded sound.
    Convert anything else first: ffmpeg -i in.mp3 -ar 48000 -c:a pcm_s16le assets/x.wav"""
    with wave.open(str(path)) as w:
        if w.getsampwidth() != 2 or w.getframerate() != SR: raise SystemExit(f'{path}: 16-bit {SR} Hz expected (convert it with ffmpeg)')
        x = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, w.getnchannels()).T / 32768
    return x[[0, -1]]


# ── loudness and mix ────────────────────────────────────────────────────────
# BS.1770 K-weighting at 48 kHz: high shelf, then high-pass (b, a)
KW = (((1.53512485958697, -2.69169618940638, 1.19839281085285), (1, -1.69065929318241, 0.73248077421585)),
      ((1, -2, 1), (1, -1.99004745483398, 0.99007225036621)))


def lufs(x):
    """Integrated loudness of a (2, n) signal: K-weighting, 400 ms blocks every 100 ms, -70 LUFS and -10 LU gates."""
    n = x.shape[1]
    size = 1 << (n + SR - 1).bit_length()  # room for the filters' tails
    z = np.exp(-2j * np.pi * np.fft.rfftfreq(size))
    h = np.prod([(b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z) for b, a in KW], 0)
    y = (np.fft.irfft(np.fft.rfft(x, size) * h, size)[:, :n] ** 2).sum(0)
    c, w = np.concatenate([[0], np.cumsum(y)]), int(.4 * SR)
    s = np.arange(0, n - w + 1, SR // 10)
    z = (c[s + w] - c[s]) / w
    z = z[z > 10 ** ((-70 + .691) / 10)]
    if not len(z): return -70.0
    z = z[z > z.mean() / 10]
    return -.691 + 10 * np.log10(z.mean())


def norm(x, target):
    l = lufs(x)
    return x * 10 ** ((target - l) / 20) if l > -70 else x


def limit(x, ceiling):
    """Look-ahead peak limiter on 5 ms blocks: the gain is down before a peak, then recovers over about 80 ms."""
    b = 240
    m = -(-x.shape[1] // b)
    peak = np.pad(np.abs(x).max(0), (0, m * b - x.shape[1])).reshape(m, b).max(1)
    need = np.pad(np.minimum(1, ceiling / np.maximum(peak, 1e-9)), 1, constant_values=1)
    need = np.minimum(np.minimum(need[:-2], need[1:-1]), need[2:])
    g, e = np.empty(m), 1.0
    for i, v in enumerate(need):
        e = min(v, e + (1 - e) * .06)
        g[i] = e
    return np.clip(x * np.interp(np.arange(x.shape[1]), np.arange(m) * b + b / 2, g), -ceiling, ceiling)


def ducking(voice, duck, n):
    """The music's gain from the voice: down to 1 - duck while it speaks (10 ms steps, 80 ms attack started 60 ms
    early, 400 ms release)."""
    hop = SR // 100
    m = len(voice) // hop
    db = 10 * np.log10((voice[:m * hop].reshape(m, hop) ** 2).mean(1) + 1e-12)
    on = np.clip((db - np.percentile(db, 99) + 30) / 10, 0, 1)
    env, e = np.empty(m), 0.0
    for i, v in enumerate(np.concatenate([on[6:], np.zeros(6)])):
        e += (v - e) * (.12 if v > e else .025)
        env[i] = e
    return np.interp(np.arange(n), (np.arange(m) + .5) * hop, 1 - duck * env)


def read(path, n):
    with wave.open(str(path)) as w:
        if w.getsampwidth() != 2 or w.getframerate() != SR: raise SystemExit(f'{path}: 16-bit {SR} Hz expected')
        x = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, w.getnchannels()).mean(1) / 32768
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def write(path, x):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(x.shape[0]); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(np.round(np.clip(x, -1, 1) * 32767).astype('<i2').T.tobytes())


def compose(plan, n, speech):
    """Runs source/sound.py: sound(v) returns the music bus, or (music, fx); each stereo (2, n) or mono."""
    spec = importlib.util.spec_from_file_location('sound', plan['sound'])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    v = SimpleNamespace(duration=plan['duration'], n=n, cues=plan.get('cues') or [], words=plan.get('words') or [],
                        variant=plan.get('variant') or 0, speech=speech)
    here = os.getcwd()
    os.chdir(Path(plan['sound']).resolve().parent.parent)  # the video's folder: load('assets/…') works
    try: out = mod.sound(v)
    finally: os.chdir(here)
    music, fx = (out, None) if isinstance(out, np.ndarray) else out
    fit = lambda x: None if x is None else np.pad(np.atleast_2d(x)[[0, -1]], ((0, 0), (0, max(0, n - x.shape[-1]))))[:, :n]
    return fit(music), fit(fx)


def mix(plan):
    lv = {**LEVELS, **(plan.get('levels') or {})}
    n = int(round(plan['duration'] * SR))
    out, gain, speech, music, fx = np.zeros((2, n)), np.ones(n), False, None, None
    if plan.get('voice'):
        v = read(plan['voice'], n)
        speech = lufs(np.stack([v, v])) > -70
        out += norm(np.stack([v, v]), lv['lufs'])
        gain = ducking(v, lv['duck'], n)
    if plan.get('sound'): music, fx = compose(plan, n, speech)
    if speech:  # a bed under the voice, at the style's levels
        if music is not None: out += norm(music, lv['music']) * gain
        if fx is not None: out += norm(fx, lv['sfx'])
    else:  # no voice: sound.py's own balance
        for x in (music, fx):
            if x is not None: out += x
    # the whole mix to the target (the limiter takes some loudness off: a second pass brings it back)
    # ponytail: a brickwall limiter alone, add a compressor on the voice if dynamic voices pump
    for _ in range(2): out = limit(norm(out, lv['lufs']), 10 ** (lv['peak'] / 20))
    return out, {'gain': gain, 'speech': speech, 'music': music, 'fx': fx}


SELFTEST_SOUND = '''
from audio import *

def sound(v):
    music, fx, t = bus(v.n), bus(v.n), secs(v.duration)
    place(music, 0, .3 * osc(hz(45 + v.variant), t, 3))
    for c in v.cues:
        s, tt = sweep(.3, 160, 48, 28)
        place(fx, c['t'], s * np.exp(-tt * 12), .8, .3)
    return music, fx
'''


def selftest():
    started, d = time.time(), 12.345
    n = int(round(d * SR))
    t = np.arange(n) / SR
    talk = (t % 2.5) < 1.2  # 1.2 s of speech, 1.3 s of silence
    with tempfile.TemporaryDirectory() as tmp:
        write(f'{tmp}/voice.wav', (.3 * np.sin(2 * np.pi * 160 * t) * (.6 + .4 * np.sin(2 * np.pi * 5 * t)) * talk)[None])
        assert load(f'{tmp}/voice.wav').shape == (2, n), 'load'
        Path(f'{tmp}/sound.py').write_text(SELFTEST_SOUND)
        cues = [{'kind': 'hit', 't': x} for x in (1, 3.5, 6.3, 9.5, 11)]
        for voice in (f'{tmp}/voice.wav', None):
            plan = {'duration': d, 'voice': voice, 'sound': f'{tmp}/sound.py', 'cues': cues}
            out, info = mix(plan)
            peak = np.abs(out).max()
            assert out.shape == (2, n), f'{out.shape[1]} samples instead of {n}'
            assert peak <= 10 ** (-1 / 20) + 1e-4, f'peak {20 * np.log10(peak):.2f} dBFS'
            assert abs(lufs(out) + 14) < 1, f'{lufs(out):.1f} LUFS ({"with" if voice else "without"} a voice)'
        plan['voice'] = f'{tmp}/voice.wav'
        out, info = mix(plan)
        g = 20 * np.log10(info['gain'])
        assert g[talk].mean() < g[~talk].mean() - 3, f'music {g[talk].mean():.1f} dB under the voice, {g[~talk].mean():.1f} dB between'
        assert mix(plan)[0].tobytes() == out.tobytes(), 'not deterministic'
        assert mix({**plan, 'variant': 2})[0].tobytes() != out.tobytes(), 'sound.py does not get the variant'
        fx = info['fx']
        for c in cues:
            s = int(c['t'] * SR)
            assert np.abs(fx[:, s - 480:s]).max() == 0 < np.abs(fx[:, s:s + 48]).max(), f'effect at {c["t"]} s is off its cue'
    print(f'selftest ok in {time.time() - started:.1f} s: exact length, no clipping, -14 LUFS with and without a voice, music down under it, effects on their cues, variants, deterministic')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='The video sound: runs source/sound.py, mixes it with the voice, loudness.')
    ap.add_argument('plan', nargs='?')
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--variant', type=int, help="the value sound.py reads as v.variant (sound variations)")
    ap.add_argument('--at', type=float, help='an extract from this video second instead of the whole mix')
    ap.add_argument('--len', type=float, default=8, help='length of the extract (s)')
    ap.add_argument('--out', help="output wav (default: the plan's out)")
    a = ap.parse_args()
    if a.selftest: sys.exit(selftest())
    if not a.plan: ap.error('a plan, or --selftest')
    started, plan = time.time(), json.loads(Path(a.plan).read_text())
    if a.variant is not None: plan['variant'] = a.variant
    out, info = mix(plan)
    if a.at is not None:
        out = out[:, int(a.at * SR):int((a.at + a.len) * SR)].copy()
        k = min(960, out.shape[1] // 2)
        out[:, :k] *= np.linspace(0, 1, k)
        out[:, out.shape[1] - k:] *= np.linspace(1, 0, k)
    dest = a.out or plan['out']
    write(dest, out)
    parts = [x for x, on in (('voice', plan.get('voice')), ('sound.py', plan.get('sound'))) if on]
    print(f"{dest}: {out.shape[1] / SR:.2f} s, {lufs(out):.1f} LUFS, peak {20 * np.log10(np.abs(out).max() + 1e-9):.1f} dBFS"
          f" ({', '.join(parts) or 'silence'}{f', variant {plan.get('variant')}' if plan.get('variant') else ''}) in {time.time() - started:.1f} s")
