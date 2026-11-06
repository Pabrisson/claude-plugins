# Geolocate an image

GeoINT's method on this engine: where a photo, a video or a Street View capture was taken, by a gut call written first, a recon pass of local models and scripts, reverse search, street-level sweeps, one answer with its radius. The pack (https://github.com/marouane53/GeoINT, MIT, pinned) holds the field guides: `osint.mjs status -p <slug>` prints `references:`, the folder to read (workflow, country-funnel, observe, search, streetlevel, geometry, corridors, sky, verify, datasets, aerial, models, data-sources, `world/*.md`). Read them when a phase asks; never copy them here.

Mapping: GeoINT's `photo_session` is the case itself; `board.py` is `hyp`; `finish` is `conclude`; `truth` is `geolocate-image truth`; `report.md` is `Report.md`. Never run `clues.py update`, never add to `references/world/`: the pack stays as pinned. Run any other script of the pack with `osint.mjs geolocate-image run <script.py> …`: no Google key reaches it, and `compare.py` always runs with `--no-check`.

## rules
1. Gut first, written down.
2. Never fabricate verification.
3. The image wins.
4. Models rank, evidence decides.
5. List the whole category before choosing.
6. Exclusion needs the same standard as confirmation.
7. One answer, no midpoints.
8. Precision needs two independent constraints.
9. Once you have a unique anchor, close the loop.
10. Compute bearings before naming structures.
11. Use every source, without asking.
12. No Google Street View is not "no street level".
13. Sweep towns, don't sample them.
14. Judge a match one image at a time, at full size.

One adaptation: "Never stop to ask the user anything" holds once the frame is set. Ask for the frame in one single question, before anything else.

## archive
The original is already `E01` (copied, hashed, read-only). A video: `osint.mjs geolocate-image intake -p <slug>` (key frames; a link goes through yt-dlp and its page becomes a source). A Street View capture: read its capture date and its compass yourself and record them with `clue … --status read --where E01-….jpg`.

## gut
Before any tool, look at the whole image, then each edge and each corner: sun, biome, roads, poles, signs, plates, architecture (the list of step 1 of GeoINT's `SKILL.md`). Write `gut.json` `{ "ranked": [{ "place", "p", "cues" }], "region", "would_change" }` and run `osint.mjs geolocate-image gut --file gut.json -p <slug>`. The engine refuses the gut call after a tool, and tools before the gut call.

## recon
People visible and the frame lets the image leave: `evidence mask E01 --box x,y,w,h…` (your own read) or `--people` (the pack's detector), then look at the mask. No person seen: `recon --no-people`. Then `osint.mjs geolocate-image recon -p <slug>` (Quick: `--no-ml` for a fast first pass on a slow machine). Read `.osint/geoint/recon/recon.md` and the `recon` block of `Report.md`; compare with the gut call. Each line OCR read is confirmed in its crop before it becomes a `read` clue.

## read-search
Texts, plates, phone numbers, domains: read them yourself in the crops (`Evidence/crops/`), record them (`clue … --status read --where <crop>`), search the web in the local languages; each page read becomes a source (`source <url> --file`). Reverse-search labels are votes, not places. Lens, Bing and TinEye links go through the tunnel: read `references/reverse-search.md`. `geolocate-image compare [--query <crop>]` ranks the similar images locally; verify the top ones one image at a time, at full size (with sub-agents, the top 24 in batches of 6 in parallel; without, the top 8 in turn) and write `reverse verdict --file`.

## country
List the whole category (the countries the engine posted from `prior.json` and `textgeo.json` as `model` clues, plus those your gut call and the clues you read impose). `hyp add "<country>" --level country --refute-if …`. `hyp lr` with each clue's true status: a text read is `read`, a trait seen is `observed`, a model is `model`. Exclude only by a `read` or `computed` clue, with its file.

## region
The same at the `region` level under the leading country (`--under H0x`), every region or city of the category (`geolocate-image run geodata.py …` or `gazetteer.py`); the reference sheets (`run refsheet.py …`) tell them apart.

## pinpoint
Street-level imagery of every provider (`run pano.py coverage <lat,lon> --radius 400`, then `run pano.py list --provider … --near … --radius 3000 --out town.jsonl`). Sweep towns, don't sample them: `geolocate-image sweep index --manifest town.jsonl`, then `sweep rank --index town` (panoramas and clusters on the map). Geometry: `run geo.py …`, `run pose.py …`, `run terrain.py …`. Compute bearings before naming a structure (`run sun.py compass …`). A sight line on the map: `geolocate-image map add sightline --at … --bearing … --km …`. The point kept: `hyp add … --level point --point lat,lon --radius <m>`.

## verify
The winner is verified on invariant features, one image at a time, at full size (`run sweep.py view …`, the panoramas, photos of the place); `reverse verdict` for each comparison. A radius of 100 m or less needs two independent constraints (`clue … --constraint`). Red team: a sub-agent (else a separate pass) looks for the twin place, the flipped photo, the misleading caption; `redteam --file`.

## answer
`conclude --file`: the retained hypothesis with its own point (never an average), the confidence per level with the manifest's criteria, the alternatives each with the test that tells them apart; `next --file` (leads: newer panoramas, other providers, chronolocation). If the user knows the true place: `geolocate-image truth <lat,lon>` (or "Set true location" in the dashboard).

## ground-check
On a hypothesis: panoramas of every provider around its point (`run pano.py coverage`, `list`, `sweep` on the area), compared one image at a time, then `reverse verdict` and `hyp lr`.

## chronolocate
Measure the shadow (bearing and height-to-length ratio) in the image; `osint.mjs sun --at <lat,lon> --date <day or instant> [--tz <zone>] --shadow-bearing <deg> [--ratio <r>] -p <slug>` (a `computed` clue); the weather of the day: `osint.mjs weather --at … --date … --hour … -p <slug>` (an `inferred` clue). An EXIF time is the camera's clock, with no sure time zone.

## same-place-images
Other images of the same place: the reverse search of the file (masked, or declared free of people) through the tunnel, photos of the candidate places (Maps, Mapillary, KartaView, Panoramax, Wikimedia Commons), `geolocate-image compare --query <file>`; each match judged one image at a time.

## identify-building
On a crop: name the type of building and its invariant features; look for the name by the reverse search of the crop and by keywords in the local languages. The name found is a hypothesis until the match is verified.

## refresh-reverse-links
Lens, TinEye and Bing again through the tunnel (`reverse --files …`), one image at a time; each new page becomes a source; `reverse verdict` for what was compared.
