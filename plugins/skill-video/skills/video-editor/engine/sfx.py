# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""The kit's sound effects: one design per kind of the catalog (sfx.json), written to sound like recorded ones.
`video.mjs sfx <kind>… --local` runs it into the library (the projects folder's .sound/, or a video's assets/sound/).
A sfx.py in that folder may hold the project's own designs (`def whoosh(rng)`…): they come before the kit's, and a
design of any other name is a sound of the project's own (`def sonar_ping(rng)`), as many as it needs.

What ElevenLabs' effects have and plain synthesis lacks (measured on 17 of them, 2026-10-26), which finish() and the
designs give every local sound:
- width: decorrelated stereo on moves, hits and sparkles (L/R correlation 0.45 to 0.9), mono on pops, keys, thuds;
- short, dry tails: 30 to 420 ms from the peak down to -40 dB (not seconds of reverb);
- an asymmetric shape: a whoosh peaks a quarter of the way in, and its pitch falls as it passes;
- each kind in its own band: a thud at 80 to 250 Hz (not a sub), a key's body at 400 Hz, a tick at 2.8 kHz, a blip at
  900 Hz gliding down, a chime and a shimmer above 6 kHz;
- grain: micro-transients and roughness, a sharp peak (crest 15 to 28 dB), and every take a little different.

  uv run sfx.py <kind>… --out <dir> [--takes 3]     <kind>.wav, <kind>-2.wav… into dir
  uv run sfx.py --selftest
"""
import argparse, importlib.util, json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from audio import SR, band_noise, filt, np, osc, secs, sweep, write  # noqa: E402
# a folder's own sfx.py may `import sfx` for the kit's designs: this very module when it runs as a script
sys.modules.setdefault('sfx', sys.modules[__name__])

CATALOG = json.loads((Path(__file__).parent / 'sfx.json').read_text())
# per kind: the band it sits in (Hz, None: open), its stereo width (0 mono … 1 wide), its tail (s from the peak to
# silence, None: as designed); a sound of the project's own keeps its band and its length
OWN = ((None, None), .3, None)
FINISH = {
    'whoosh': ((120, 7000), .8, .45), 'swish': ((250, 9000), .55, .2), 'riser': ((150, 11000), .25, .35), 'drop': ((200, 10000), .25, .3),
    'impact': ((28, None), .35, .55), 'hit': ((200, None), .6, .18), 'thud': ((55, 3000), .1, .3), 'stamp': ((120, 12000), .8, .16),
    'pop': ((150, 5000), 0, .14), 'click': ((600, None), .15, .07), 'type': ((60, 8000), .05, .09), 'tick': ((700, 12000), .35, .08),
    'blip': ((200, 4000), .3, .2), 'chime': ((400, None), .25, .7), 'error': ((60, 1500), .15, .45), 'shimmer': ((1500, None), .45, 1.0),
    'glitch': ((300, None), .7, .3), 'paper': ((250, 12000), .5, .22),
}


# ── what every local sound goes through ─────────────────────────────────────
def widen(x, w, rng):
    """x (mono, or stereo with its own pan) at width w: each side adds its own 4 ms decorrelated copy (L/R correlation
    about 1 / (1 + w²) for a centered sound)."""
    x = np.stack([x, x]) if x.ndim == 1 else x
    if w <= 0: return x
    t = secs(.004)
    h = rng.standard_normal((2, len(t))) * np.exp(-t * 900)
    return np.stack([c + w * np.convolve(c, k / np.sqrt((k ** 2).sum()))[:len(c)] for c, k in zip(x, h)]) / np.sqrt(1 + w * w)


def finish(kind, x, rng):
    """A design as the library keeps it: in its band, at its width, no tail past the kind's, its peak at -1 dBFS."""
    (lo, hi), w, tail = FINISH.get(kind, OWN)
    x = widen(filt(x, lo or 20, hi), w, rng)
    env = np.abs(x).max(0)
    pk = int(np.convolve(env, np.ones(240) / 240, 'same').argmax())
    a, b = pk + int(.45 * (tail or 0) * SR), pk + int((tail or 0) * SR)
    if tail and b < x.shape[1]:
        x = x[:, :b].copy()
        x[:, a:] *= .5 + .5 * np.cos(np.linspace(0, np.pi, b - a))
    f = min(48, x.shape[1] // 4)
    x[:, :f] *= np.linspace(0, 1, f)
    return x * .89 / max(np.abs(x).max(), 1e-9)


def grain(n, rng, amount=.25, rate=120):
    """Roughness: a gain that wobbles by about amount, at around rate Hz (recorded sounds are never smooth)."""
    g = filt(rng.standard_normal(n + 2000), None, rate)[:n]
    return 1 + amount * g / (np.abs(g).max() + 1e-9)


def env_ad(n, peak, k):
    """A fast rise to sample peak (a curve), then a decay at rate k per second."""
    i = np.arange(n)
    return np.where(i < peak, (i / max(peak, 1)) ** 2, np.exp(-(i - peak) / SR * k))


# ── the designs: one per kind, mono or stereo, at the catalog's length ──────
def whoosh(rng, d=.8):
    """Air rushing past: a band of noise that brightens as it comes and falls as it goes (peak a fifth in), panned
    across, with a darker body under it."""
    n, peak = int(d * SR), int(.18 * d * SR)
    p = np.linspace(0, 1, n)
    fc = lambda q: 450 * 2.8 ** (np.sin(np.pi * min(q / .18, 1) / 2)) * (1 - .6 * max(0, q - .18) / .82)
    air = band_noise(d, fc, 1.6, rng)[:n] * env_ad(n, peak, 7) * grain(n, rng, .3, 60)
    body = band_noise(d, lambda q: 300 + 150 * np.sin(np.pi * q), 1.0, rng)[:n] * env_ad(n, int(peak * 1.2), 6) * .5
    s = air + body
    a = (np.clip(-.6 + 1.2 * p, -1, 1) + 1) * np.pi / 4
    return np.stack([s * np.cos(a), s * np.sin(a)]) * np.sqrt(2)


def swish(rng, d=.5):
    """A thin, quick cut through the air: noise sweeping up from 550 Hz to 2.5 kHz in 150 ms, sharp start."""
    n = int(d * SR)
    s = band_noise(d, lambda q: 550 * 4.5 ** min(q / .3, 1), 1.2, rng)[:n]
    return s * env_ad(n, int(.01 * SR), 14) * grain(n, rng, .2, 90)


def riser(rng, d=1.5):
    """A build-up: noise climbing from 800 Hz to 9 kHz and a tone from 440 to 1760 Hz whose tremolo speeds up, loudest at
    its climax (the cue), then a short fall."""
    n, top = int(d * SR), int(.82 * d * SR)
    p = np.minimum(np.arange(n) / top, 1)
    noise = band_noise(d, lambda q: 800 * 11 ** min(q / .82, 1), 1.2, rng)[:n]
    f = 440 * 4 ** p
    trem = .75 + .25 * np.sin(2 * np.pi * np.cumsum(4 + 22 * p ** 2) / SR)
    tone = osc(f, secs(d)[:n], 4) * trem * .35
    e = np.where(np.arange(n) < top, p ** 2.4, np.exp(-(np.arange(n) - top) / SR * 24))
    return (noise + tone) * e


def drop(rng, d=.6):
    """Something small falling: a whistle gliding down, then the landing's clink and knock."""
    at = .06
    n, land = int(d * SR), int(at * SR)
    t = secs(d)[:n]
    glide = np.sin(2 * np.pi * np.cumsum(np.where(t < at, 3200 * .35 ** (t / at), 0)) / SR) * np.where(t < at, np.minimum(1, t / .01) * .35, 0)
    u = np.maximum(t - at, 0)
    clink = (np.sin(2 * np.pi * 4250 * u) + .6 * np.sin(2 * np.pi * 6380 * u) + .35 * np.sin(2 * np.pi * 9100 * u)) * np.exp(-u * 40) * (t >= at)
    knock = filt(rng.standard_normal(n), 1500, 6000) * np.exp(-u * 160) * (t >= at)
    x = glide + clink * .8 + knock * .5
    x[land:land + 48] *= np.linspace(.3, 1, 48)
    return x


def impact(rng, d=1.5):
    """A big, dry hit: a sub thump gliding from 90 to 45 Hz, a punch at 120 Hz, and a short crack so it reads on a phone,
    with grain on the body."""
    n = int(d * SR)
    sub, t = sweep(d, 90, 45, 14)
    punch, _ = sweep(d, 160, 110, 40)
    crack = filt(rng.standard_normal(n), 900, 5000) * np.exp(-t * 70)
    x = np.tanh(1.6 * sub * np.exp(-t * 7)) * grain(n, rng, .15, 40) + .25 * punch * np.exp(-t * 22) + .15 * crack
    return x * np.minimum(1, t / .003)


def hit(rng, d=.5):
    """A small dry hit: a bright crack (1 to 10 kHz) with a short knock under it."""
    n = int(d * SR)
    t = secs(d)[:n]
    crack = filt(rng.standard_normal(n), 900, 8000) * np.exp(-t * 60) * grain(n, rng, .25, 200)
    knock, _ = sweep(d, 260, 170, 50)
    return crack + .35 * knock[:n] * np.exp(-t * 55)


def thud(rng, d=.5):
    """Something set down: a muffled knock of 90 to 250 Hz, a little box resonance, no sub."""
    n = int(d * SR)
    body, t = sweep(d, 180, 95, 35)
    box = np.sin(2 * np.pi * 320 * t) * np.exp(-t * 35) * .4
    muff = filt(rng.standard_normal(n), 150, 900) * np.exp(-t * 60) * .9
    return (body * np.exp(-t * 16) + box + muff) * grain(n, rng, .2, 80) * np.minimum(1, t / .002)


def stamp(rng, d=.5):
    """A rubber stamp: a broadband slap of the pad on paper, a low knock of the handle, a paper crackle."""
    n = int(d * SR)
    t = secs(d)[:n]
    slap = filt(rng.standard_normal(n), 300, 7000) * np.exp(-t * 55)
    knock, _ = sweep(d, 190, 120, 40)
    crackle = filt(rng.standard_normal(n) * (rng.random(n) > .97), 5000, 11000) * np.exp(-t * 35)
    return slap + .2 * knock[:n] * np.exp(-t * 45) + .4 * crackle


def pop(rng, d=.5):
    """A round pop: a sine jumping from 320 to 650 Hz in 25 ms, a short body, a hint of click."""
    n = int(d * SR)
    t = secs(d)[:n]
    f = 320 + 330 * (1 - np.exp(-t / .008))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 60) * np.minimum(1, t / .0015)
    return body + .08 * filt(rng.standard_normal(n), 2000) * np.exp(-t * 600)


def click(rng, d=.5):
    """A mouse click: a crisp high snap (4 to 12 kHz) as the button goes down, a softer one 35 ms later as it comes up."""
    n = int(d * SR)
    t = secs(d)[:n]
    snap = lambda at, g: g * (filt(rng.standard_normal(n), 3500) * np.exp(-np.maximum(t - at, 0) * 500)
                              + .5 * np.sin(2 * np.pi * 6200 * (t - at)) * np.exp(-np.maximum(t - at, 0) * 300)) * (t >= at)
    return snap(0, 1) + snap(.035, .35)


def type(rng, d=.5):
    """A keystroke: the cap's clack (2 to 5 kHz), its body ringing at about 450 Hz and a low thock as it bottoms out."""
    n = int(d * SR)
    t = secs(d)[:n]
    j = 1 + .08 * (rng.random() - .5)
    clack = filt(rng.standard_normal(n), 1800, 5500) * np.exp(-t * 400)
    body = np.sin(2 * np.pi * 450 * j * t) * np.exp(-t * 70)
    thock = np.sin(2 * np.pi * 70 * j * t) * np.exp(-t * 70)
    return 1.2 * clack + .6 * body + .6 * thock


def tick(rng, d=.5):
    """A clock's tick: a 2.8 kHz ping with its overtone and a dry click of noise."""
    n = int(d * SR)
    t = secs(d)[:n]
    f = 2800 * (1 + .02 * (rng.random() - .5))
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 90) + .45 * np.sin(2 * np.pi * 2.9 * f * t) * np.exp(-t * 140)
            + .9 * filt(rng.standard_normal(n), 3000) * np.exp(-t * 500))


def blip(rng, d=.5):
    """An interface blip: a soft tone gliding from 900 to 740 Hz, its octave fading first."""
    n = int(d * SR)
    t = secs(d)[:n]
    f = 740 + 160 * np.exp(-t / .02)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + .25 * np.sin(2 * ph) * np.exp(-t * 30)) * np.exp(-t * 22) * np.minimum(1, t / .002)


def chime(rng, d=1.0):
    """A bright success: two glassy bell notes a fifth apart (inharmonic partials up high), the second 70 ms later,
    with airy sparkle above 8 kHz."""
    n = int(d * SR)
    t = secs(d)[:n]
    def bell(f, at):
        u = np.maximum(t - at, 0)
        parts = [(1, 1, 7), (2.76, .5, 11), (5.4, .35, 16), (8.93, .2, 22)]
        return sum(a * np.sin(2 * np.pi * f * r * u) * np.exp(-u * k) for r, a, k in parts) * (t >= at) * np.minimum(1, u / .001)
    air = filt(rng.standard_normal(n), 9000, 15000) * np.exp(-t * 8) * .6
    return bell(4186, 0) + .8 * bell(6272, .07) + air


def error(rng, d=.6):
    """A failure: two low buzzy notes falling (220 then 165 to 130 Hz), a little detuned."""
    n = int(d * SR)
    t = secs(d)[:n]
    f = np.where(t < .17, 220, 165 - 35 * np.clip((t - .17) / .3, 0, 1))
    g = np.where(t < .15, np.minimum(1, t / .005), np.where(t < .19, 0, np.minimum(1, (t - .19) / .005) * np.exp(-(t - .19) * 3)))
    return filt((osc(f * .995, t, 2.5) + osc(f * 1.005, t, 2.5)) * .5, None, 900) * g * grain(n, rng, .15, 50)


def shimmer(rng, d=1.0):
    """Sparkle: thirty glints of high sines (5 to 9.5 kHz) scattered over half a second, each dying fast, over air."""
    n = int(d * SR)
    t = secs(d)[:n]
    x = np.zeros(n)
    for _ in range(30):
        at, f = rng.random() ** 2 * .55, rng.uniform(5000, 9500)
        u = np.maximum(t - at, 0)
        x += np.sin(2 * np.pi * f * u) * np.exp(-u * rng.uniform(18, 40)) * (t >= at) * rng.uniform(.3, 1)
    air = filt(rng.standard_normal(n), 6000, 10000) * np.minimum(1, t / .02) * np.exp(-t * 4) * 1.5
    return x / 6 + air


def glitch(rng, d=.5):
    """Data going wrong: slices of 15 to 50 ms of crushed tone and bright noise, some repeated, stopping dead."""
    n = int(d * SR)
    out, i = np.zeros(n), 0
    while i < int(.3 * SR):
        k = int(rng.uniform(.015, .05) * SR)
        if rng.random() < .25: seg = out[max(0, i - k):i].copy() if i >= k else np.zeros(k)  # a stutter
        elif rng.random() < .5: seg = np.round(osc(rng.uniform(300, 2400), secs(k / SR), 8) * 4) / 4
        else: seg = filt(rng.standard_normal(k), rng.uniform(2000, 6000))
        out[i:i + len(seg)] = seg[:n - i] * (rng.random() > .15)
        i += k
    return out


def paper(rng, d=.5):
    """A page turned: a rustle (noise of 1 to 8 kHz, its level flickering) that ends on a soft flap."""
    n = int(d * SR)
    t = secs(d)[:n]
    flicker = np.abs(filt(rng.standard_normal(n), None, 60))
    rustle = filt(rng.standard_normal(n), 1000, 8000) * flicker / (flicker.max() + 1e-9) * np.minimum(1, t / .03) * np.exp(-t * 10)
    flap = filt(rng.standard_normal(n), 250, 1500) * np.exp(-np.maximum(t - .12, 0) * 45) * (t >= .12)
    return rustle + .7 * flap


DESIGNS = {k: globals()[k] for k in CATALOG}


def designs(folder):
    """The kit's designs, and a folder's own before them: the functions its sfx.py defines (not the `_helpers`)."""
    own = Path(folder) / 'sfx.py'
    if not own.exists(): return DESIGNS
    spec = importlib.util.spec_from_file_location('own_sfx', own)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {**DESIGNS, **{k: f for k, f in vars(mod).items() if callable(f) and not k.startswith('_') and getattr(f, '__module__', None) == 'own_sfx'}}


def bake(kind, make, out, takes=3):
    """Writes takes of make(rng) finished as the library keeps them: <kind>.wav, <kind>-2.wav…; each take its own
    seed and a slightly different pitch."""
    files = []
    for k in range(takes):
        rng = np.random.default_rng([sum(map(ord, kind)), k])
        x = make(rng)
        r = 1 + .03 * (rng.random() - .5) * (k > 0)
        if r != 1: x = np.stack([np.interp(np.arange(0, x.shape[-1] - 1, r), np.arange(x.shape[-1]), c) for c in np.atleast_2d(x)]).squeeze()
        f = Path(out) / f"{kind}{'' if k == 0 else f'-{k + 1}'}.wav"
        write(f, finish(kind, np.asarray(x, float), rng))
        files.append(f)
    return files


def selftest():
    started = time.time()
    assert set(DESIGNS) == set(CATALOG) == set(FINISH), 'one design and one finish per kind of the catalog'
    for kind, make in DESIGNS.items():
        rng = np.random.default_rng(1)
        x = finish(kind, make(rng), rng)
        assert x.shape[0] == 2 and np.isfinite(x).all(), f'{kind}: not finite stereo'
        assert abs(np.abs(x).max() - .89) < 1e-6, f'{kind}: peak'
        assert x.shape[1] <= (CATALOG[kind]['dur'] + .01) * SR, f'{kind}: {x.shape[1] / SR:.2f} s, longer than the catalog'
        env = np.sqrt(np.convolve((x ** 2).mean(0), np.ones(480) / 480, 'same'))
        pk = int(env.argmax())
        assert (env[pk + int(FINISH[kind][2] * SR):] < env[pk] / 100).all(), f'{kind}: tail past {FINISH[kind][2]} s'
        corr = np.corrcoef(x[0], x[1])[0, 1]
        assert corr > .99 if FINISH[kind][1] == 0 else corr < .95 if FINISH[kind][1] >= .4 else True, f'{kind}: width (L/R correlation {corr:.2f})'
        r = np.random.default_rng(1)
        assert np.array_equal(finish(kind, make(r), r), x), f'{kind}: not deterministic'
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, 'sfx.py').write_text('import numpy as np\nfrom audio import secs\ndef pop(rng): return np.sin(np.arange(4800) / 10) * np.exp(-np.arange(4800) / 900)\n'
                                       'def sonar_ping(rng): return np.sin(np.arange(3 * 48000) / 7) * np.exp(-np.arange(3 * 48000) / 30000)\ndef _helper(): pass\n')
        found = designs(tmp)
        files = bake('pop', found['pop'], tmp)
        assert [f.name for f in files] == ['pop.wav', 'pop-2.wav', 'pop-3.wav'] and found['tick'] is tick, 'a folder\'s own design first'
        assert 'sonar_ping' in found and not {'secs', '_helper'} & set(found), 'a sound of its own: its functions, not what it imports'
        ping = finish('sonar_ping', found['sonar_ping'](np.random.default_rng(0)), np.random.default_rng(0))
        assert ping.shape == (2, 3 * SR), 'a sound of its own keeps its length'
    print(f'selftest ok in {time.time() - started:.1f} s: {len(DESIGNS)} designs, stereo, peak, length, tail, width, deterministic, a folder\'s own designs and sounds, takes')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description="The kit's sound effects, into a sound library folder.")
    ap.add_argument('kinds', nargs='*')
    ap.add_argument('--out')
    ap.add_argument('--takes', type=int, default=3)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest: sys.exit(selftest())
    if not a.kinds or not a.out: ap.error('kinds and --out, or --selftest')
    Path(a.out).mkdir(parents=True, exist_ok=True)
    found = designs(a.out)
    bad = [k for k in a.kinds if k not in found]
    if bad: ap.error(f"no design for {', '.join(bad)}: write `def {bad[0]}(rng)` in {Path(a.out) / 'sfx.py'}")
    for k in a.kinds: bake(k, found[k], a.out, a.takes)
