# /// script
# requires-python = ">=3.10"
# dependencies = ["onnxruntime", "numpy", "pillow"]
# ///
"""media-generator's local vision: a depth map, or the subject cut out, of every frame of a video, with two ONNX models
fetched once into ~/.cache/media-generator/models ($MEDIA_GENERATOR_VISION_DIR): Depth Anything V2 Small (Apache-2.0)
and BiRefNet lite (MIT). Frames come and go through ffmpeg; the sound is kept.

  uv run vision.py fetch
  uv run vision.py depth <video> <out.mp4> [--near white|black]
  uv run vision.py matte <video> <out base> [--background transparent|green|black|white]
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from fractions import Fraction
from pathlib import Path

DIR = Path(os.environ.get("MEDIA_GENERATOR_VISION_DIR") or Path.home() / ".cache/media-generator/models")
# the files at a fixed revision: what was tested is what runs
MODELS = {
    "depth": ("depth-anything-v2-small.onnx", "onnx-community/depth-anything-v2-small", "4472b7362082ad9968fee890ca0f1e5aca36b93d", 99_000_000),
    "matte": ("birefnet-lite.onnx", "onnx-community/BiRefNet_lite-ONNX", "de15b22ba131738a16dff04aab8bdf8dc32e3ac1", 224_000_000),
}
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
COLORS = {"green": (0, 255, 0), "black": (0, 0, 0), "white": (255, 255, 255)}


def say(line):
    print(line, flush=True)


def fetch(which):
    name, repo, rev, size = MODELS[which]
    f = DIR / name
    if f.exists():
        return f
    DIR.mkdir(parents=True, exist_ok=True)
    part = f.with_suffix(".part")
    say(f"fetching {name} ({size // 1_000_000} MB, once)")
    urllib.request.urlretrieve(f"https://huggingface.co/{repo}/resolve/{rev}/onnx/model.onnx", part)
    part.rename(f)
    return f


def session(which):
    import onnxruntime as ort

    say(f"loading {MODELS[which][0]}")
    # ponytail: on the CPU, about 0.3 s a depth frame and 4 s a cut-out one; CoreML cannot compile BiRefNet's deformable
    # convolutions and PyTorch's GPU would run its remote code: a faster cut-out model when long clips matter
    return ort.InferenceSession(str(fetch(which)), providers=["CPUExecutionProvider"])


def probe(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate,nb_frames:format=duration",
                          "-of", "json", video], capture_output=True, text=True, check=True)
    j = json.loads(out.stdout)
    s = j["streams"][0]
    rate = s.get("avg_frame_rate") or "30/1"
    frames = int(s.get("nb_frames") or 0) or round(float(j["format"].get("duration") or 0) * float(Fraction(rate)))
    return s["width"], s["height"], rate, frames


def frames(video, w, h):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield buf
    p.wait()


def writer(video, w, h, rate, fmt, outs):
    """ffmpeg reading raw frames on stdin, the source's sound beside them, one or more outputs"""
    argv = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", fmt, "-s", f"{w}x{h}", "-r", rate, "-i", "-", "-i", video]
    for o in outs:
        argv += ["-map", "0:v", "-map", "1:a?", *o]
    return subprocess.Popen(argv, stdin=subprocess.PIPE)


def normalized(img, w, h):
    import numpy as np

    x = (np.asarray(img.resize((w, h), 3), dtype=np.float32) / 255 - MEAN) / STD
    return x.transpose(2, 0, 1)[None].astype(np.float32)


def depth(video, out, near):
    import numpy as np
    from PIL import Image

    s = session("depth")
    name = s.get_inputs()[0].name
    w, h, rate, total = probe(video)
    # the short side at 364 (the model's 518 is 2.3 times slower on a CPU for a map that blurs the same), both sides
    # multiples of 14: the model's patches
    k = 364 / min(w, h)
    mw, mh = max(14, round(w * k / 14) * 14), max(14, round(h * k / 14) * 14)
    enc = writer(video, w, h, rate, "gray", [["-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]])
    lo = hi = None
    for i, buf in enumerate(frames(video, w, h)):
        img = Image.frombuffer("RGB", (w, h), buf)
        d = s.run(None, {name: normalized(img, mw, mh)})[0][0]
        # the model's disparity (higher is nearer), scaled by its range eased over the frames so the grays do not flicker
        a, b = np.percentile(d, 1), np.percentile(d, 99)
        lo, hi = (a, b) if lo is None else (lo * 0.85 + a * 0.15, hi * 0.85 + b * 0.15)
        v = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)
        if near == "black":
            v = 1 - v
        g = Image.fromarray((v * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
        enc.stdin.write(g.tobytes())
        if i % 5 == 0:
            say(f"depth: frame {i + 1}/{total or '?'}")
    enc.stdin.close()
    if enc.wait():
        sys.exit("ffmpeg could not write the depth video")


def matte(video, base, background):
    import numpy as np
    from PIL import Image

    s = session("matte")
    inp = s.get_inputs()[0]
    side = inp.shape[2] if isinstance(inp.shape[2], int) else 1024
    w, h, rate, total = probe(video)
    alpha = background == "transparent"
    outs = ([["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-c:a", "libopus", "-shortest", f"{base}.webm"],
             ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-c:a", "pcm_s16le", "-shortest", f"{base}.mov"]] if alpha
            else [["-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f"{base}.mp4"]])
    enc = writer(video, w, h, rate, "rgba" if alpha else "rgb24", outs)
    for i, buf in enumerate(frames(video, w, h)):
        img = Image.frombuffer("RGB", (w, h), buf)
        logits = s.run(None, {inp.name: normalized(img, side, side)})[-1][0, 0]
        m = Image.fromarray((255 / (1 + np.exp(-logits))).astype(np.uint8)).resize((w, h), Image.BILINEAR)
        if alpha:
            rgba = img.copy()
            rgba.putalpha(m)
            enc.stdin.write(rgba.tobytes())
        else:
            enc.stdin.write(Image.composite(img, Image.new("RGB", (w, h), COLORS[background]), m).tobytes())
        if i % 5 == 0:
            say(f"cutting out: frame {i + 1}/{total or '?'}")
    enc.stdin.close()
    if enc.wait():
        sys.exit("ffmpeg could not write the cut-out video")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "depth", "matte"])
    ap.add_argument("src", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--near", default="white", choices=["white", "black"])
    ap.add_argument("--background", default="transparent", choices=["transparent", *COLORS])
    a = ap.parse_args()
    if a.cmd == "fetch":
        for k in MODELS:
            fetch(k)
        session("depth"), session("matte")
        say(f"ready: {DIR}")
    elif not (a.src and a.out):
        ap.error("a video and an output")
    elif a.cmd == "depth":
        depth(a.src, a.out, a.near)
    else:
        matte(a.src, a.out, a.background)
