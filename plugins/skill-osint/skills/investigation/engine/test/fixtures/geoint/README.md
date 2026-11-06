# GeoINT outputs replayed by the fake uv

The fake `uv` (`test/fixtures/bin/uv`) writes these files where the real scripts write theirs. Their shape is the one
the scripts of the pinned commit 18543326 write (read in their code: no script is run by the tests); their values
describe the tests' photo, the Roman temple of Évora (`../images/evora-temple.jpg`).

- `recon/meta/meta.json`: `file`, `bytes` and `sha256` are the tests' 960 px copy's; camera, GPS and time are the EXIF
  of the Commons original as the Commons API lists it on 2026-11-03 (Apple iPhone SE (2nd generation), iOS 14.8.1,
  2021:11:12 14:06:13, GPS 38.5727917, -7.9076417). The 960 px copy carries none.
- `recon/intake/ocr.json`: two invented lines (the photo shows no readable text): they exercise the import of OCR.
- `rev/*.json`, `compare/compare.json`, `sweep/*.json`, `pano/*`: invented results in the exact shape of revimg.py,
  compare.py, sweep.py and pano.py; the pages and panoramas named are public places, their ids are made up.
