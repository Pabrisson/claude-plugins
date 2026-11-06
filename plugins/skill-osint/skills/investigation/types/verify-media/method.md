# Verify an image or a video

Three questions about a picture and what is said about it: where it first appeared (`origin`), whether the caption fits the evidence (`claim`), and the signs of editing or generation (`integrity`). The engine reads what tools can read (pages and their dates, the Wayback Machine, metadata, the embedded thumbnail, the C2PA manifest, direct reverse search) and records it as sources, entities, clues and dates on the timeline; you look, judge and conclude.

Rules:
1. Never fabricate verification: a clue cites a source or a Journal entry, and the engine refuses a conclusion that rests on one that does not.
2. The image wins: the evidence of the picture prevails over its metadata and over every caption.
3. Signs are clues, never a verdict: an AI marker, a C2PA manifest or a missing EXIF is read as a clue. The engine refuses `integrity` above medium unless a signed and valid C2PA manifest of the original lifts it.
4. Read each page once. Never loop on a protected page with repeated WebFetch calls: open it once, save its capture, give it to `first-seen --file`.

## frame
Take what the user already said as the answer: « the image can leave » is `image_may_leave=true`, « nothing noisy » is `noisy=never`; ask only for what is missing. One single question, before anything else: the question and its purpose; `image_may_leave` (searching for exact copies needs the image to leave this machine; `--unmasked` exists for this type only and sends people visible in the picture without a mask); `noisy` (ask or never); `person` and its legal basis only when the question is about a person visible in it. Then `osint.mjs new verify-media <file or URL> --question … --in claim="…" --frame image_may_leave=… --frame noisy=… --lang <language>`. A video: `--in media=video --in video=<URL>`, or `--in media=video --file clip.mp4`.

## archive
`osint.mjs verify-media intake -p <slug>`. An image by link is downloaded once (`E01`, its URL kept). A video file gets its key frames; a video by link goes through yt-dlp and its page becomes a dated source. If yt-dlp finds no video, do not retry in a loop: give the image by its URL, or the video as a file.

## metadata
`osint.mjs verify-media meta -p <slug>` (exiftool, the embedded thumbnail, c2patool). Exit code 3: say what is missing and go on. Metadata speaks of the file, not of the scene; a file without metadata says nothing; an AI marker is a `read` clue, not a verdict. Compare the thumbnail with the image at full size and note a gap with `clue … --status observed --where <thumbnail>`.

## reverse
Look for exact copies: a masked file, or a file you looked at and declared without people (`--no-people`), or `--unmasked` when the frame lets the image leave and the user said yes (`--yes`; without it exit code 2; a refresh replays an unmasked send only with `--yes`). The Journal says to which engines. `osint.mjs verify-media direct -p <slug> [--no-people | --unmasked --yes]` (Yandex and Baidu, with the GeoINT pack); then Lens, Bing and TinEye through the tunnel (`references/reverse-search.md`). Open each result page once, keep its capture, judge each candidate one image at a time at full size, and write `reverse verdict --file`.

## first-seen
Write `pages.json`: each page found, with `url`, the post date read on the page in `posted`, the saved capture in `capture`, `author` and `author_url`, `engine`, `match`, and `in_capture: true` only when you saw the image in the page's first Wayback capture. Then `osint.mjs verify-media first-seen --file pages.json -p <slug>`. The earliest dated page is a candidate, not a proof: an older copy may exist (`first-seen-deep`). A page's date may be updated or backdated; its first Wayback capture (only a status 200 one) dates the PAGE, not the image: the home page, a profile or a live page archived early proves nothing about the picture. It counts for the earliest appearance only with `in_capture: true` (open the capture, see the image); without it the timeline says « page archived since » and nothing more.

## claim
Split the caption into place, date and event, and test each against the content of the image: the place (landmarks, signs; pivot to `geolocate-image` on the image when the place is unknown), the date (older copies, season, `chronolocate`), the event (other images of it). Every `observed` clue cites a Journal entry: `log --phase claim "<what you saw>"` first, then `clue … --status observed --where <file> --journal jNNN`. Hypotheses at the `claim` level: the caption as it is against at least one alternative (a recycled photo, another place, another date), the `--refute-if` written first; `hyp lr` with each clue's real status.

## integrity
The signs: metadata (software, AI markers, edit dates, a thumbnail with another framing), C2PA, and a look at the image at full size (hands, text, shadows, reflections, edges, repeated patterns, bent lines), each an `observed` clue with its crop (`--where`). Hypotheses at the `integrity` level (camera photo, edited, generated). Confidence for `integrity` stays at medium unless a signed and valid C2PA manifest of the original lifts it: `conclude` refuses more.

## redteam
A sub-agent (else a separate pass) tries to refute the answer: an older copy elsewhere, a twin monument, a flipped image, a repost date taken for the photo's date, an invalid manifest. `redteam --file`.

## answer
`conclude --file`: one answer (at the `claim` level), a confidence per level with the manifest's criteria (for `origin`, the candidate with its date and where it comes from), the alternatives with their test. Then `next --file`: leads (`first-seen-deep`, `frames-reverse`, `chronolocate`, pivots to `geolocate-image` on the image, `username` on the author's account, `domain` on the site of the first appearance).

## frames-reverse
A video: pick 3 to 5 sharp, distinctive key frames in `Evidence/frames/`; `verify-media direct --files <frames> [--no-people | --unmasked --yes]`, then `reverse --files <frames>` through the tunnel; every page found goes into `first-seen --file`.

## first-seen-deep
Use your web search on X, Telegram, TikTok and YouTube: the words of the caption in the local languages, the name of the place, the hashtags, with a date filter before the candidate (`until:`, `before:`). Open each result once, save its capture, `first-seen --file`. Never log in to an account, never create one.

## chronolocate
Measure a shadow in the image (bearing, height/length ratio). `osint.mjs sun --at <lat,lon> --date <day or instant> [--tz <zone>] --shadow-bearing <deg> [--ratio <r>] -p <slug>` (a `computed` clue); `osint.mjs weather --at <lat,lon> --date <day> --hour <HH> -p <slug>` (an `inferred` clue: a reanalysis ranks hours, it does not exclude). An EXIF time is the camera's clock.

## refresh-engines
Lens, Bing and TinEye again through the tunnel (`reverse --files … [--unmasked --yes]`), one image at a time; each new page goes into `first-seen --file`; `reverse verdict` for what was compared.
