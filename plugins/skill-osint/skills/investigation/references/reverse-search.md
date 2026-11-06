# Reverse image search

Contents: when a picture may leave · what may leave · the tunnel · each engine's link · reading the results · ranking and judging · verify-media: exact copies.

## When a picture may leave

Only with `image_may_leave: true` (the frame, in `Case.md`). Otherwise every send is refused (exit 1), `geolocate-image run revimg.py` and `intake.py` without `--no-rev` included. Changing the frame is the user's.

## What may leave

A file of `Evidence/` in JPEG, PNG, WebP or GIF that is a masked copy (`evidence mask E01 --box x,y,w,h [--box …]`, or `--people`: the pack's detector adds the persons and faces it sees; look at the result anyway), or that you looked at whole and declared free of people (`--no-people` on `reverse`, `recon` or `run`). Never a capture of results, never a file outside `Evidence/`. The mask is flat black by ffmpeg (else the pack's Pillow, else exit 3); its boxes stay in `case.json`. Only `verify-media` takes `--unmasked`.

## The tunnel

`osint.mjs reverse --files E02,01_sign [--minutes 15] [--no-people] -p <slug>`. The dashboard server opens a Cloudflare tunnel with no account (`cloudflared`), serves only the chosen files under a random path, waits until the name answers on public DNS, then gives one link per engine. One tunnel per case, closed at its time (1 to 120 min), by `reverse --close`, when the case is deleted or when the server stops. The Journal says which files left, when, and which engines read them (by User-Agent). Without `cloudflared`: exit 3; the direct Yandex/Baidu path of `recon` remains.

## Each engine's link

| Engine | Form | Checked |
|---|---|---|
| Google Lens | `https://lens.google.com/uploadbyurl?url=<enc>` | not checked yet |
| Yandex | `https://yandex.com/images/search?rpt=imageview&url=<enc>` | not checked yet |
| Bing | `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:<enc>` | 2026-11-02 |
| TinEye | `https://tineye.com/search?url=<enc>` | not checked yet |
| Baidu | `https://image.baidu.com/n/pc_search?queryImageUrl=<enc>` | not checked yet |

(`lib/reverse.js`, `ENGINES[].verified`, is the source of this table.)

## Reading the results

Protected pages are never reread in a loop by a page fetch. With a browser: open each link, keep the text and a capture (`source <url> --file <capture>`); each page found becomes a `url` entity and a clue when it brings something. Without one: the dashboard's Evidence tab has a button per engine and « Paste results » (text and captures saved to `Evidence/captures/`, a `[reverse-results]` item in the basket). Yandex and Baidu labels are votes, not places.

## Ranking and judging

`geolocate-image compare [--query <crop>]` (always `--no-check`: MegaLoc locally, never Gemini). Judge the top **one image at a time, at full size** (with sub-agents, the top 24 in batches of 6 in parallel; without, the top 8 in turn), on invariant features (structure, skyline, signs), never on a sheet. Write each judgment: `osint.mjs reverse verdict --file verdicts.json -p <slug>`:

```json
[{ "candidate": "#1", "page": "https://pt.wikipedia.org/wiki/Templo_romano_de_%C3%89vora", "verdict": "match",
   "reason": "the same temple from the same corner", "compared": ["granite columns", "Corinthian capitals", "podium"] },
 { "candidate": "#2", "verdict": "unsure", "reason": "too small to judge" }]
```

`candidate` is a rank (`#3`), a URL or a file; `file` is an `Evidence/` path. A `match` without `compared` is refused; a `match` becomes an `observed` clue that cites its verdict, a constraint with three features or more.

## verify-media: exact copies

`--unmasked` is allowed for `verify-media` only (we look for exact copies), when the frame lets the image leave (`image_may_leave: true`), with an entry in the Journal that says that people visible went out unmasked and to which engines. Any other type refuses it (`--unmasked is for verify-media cases only`).

- `osint.mjs verify-media direct [--files E01,…] [--no-people | --unmasked] -p <slug>`: Yandex and Baidu by direct upload (the GeoINT pack's `revimg.py`, no tunnel). The Journal says `Sent unmasked to …` or `Sent to …`. Without `--files`, it sends again what went out last (this is what Refresh does).
- `osint.mjs reverse --files E01 --unmasked -p <slug>`: the tunnel, with Google Lens, Bing and TinEye; the Journal line of the tunnel says `sent unmasked: people visible may reach the engines`. The dashboard's gallery offers « Open unmasked » (with a confirmation) for a `verify-media` case only.
- Open each page found once, keep its capture, then `verify-media first-seen --file pages.json` with the date you read. Never read a results page in a loop.

