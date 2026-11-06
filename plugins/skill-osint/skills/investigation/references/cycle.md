# The cycle: commands and rules

Contents: stages · commands · statuses and caps · exclusion · red team and conclusion files · Admiralty · rules.

## Stages

Frame → Collect → Process → Analyse → Red team → Conclude → Leads. A type's `method.md` gives each phase's steps. Wrap what you do outside the engine in `log --phase <id> "<what>"` (`--progress n/m`, `--fail`, `--end`).

## Commands (all take `-p <slug>`)

| Command | What it does |
|---|---|
| `source <url> [--archive spn\|local\|none] [--reliability A..F] [--title t]` | reads the URL once, keeps `Evidence/captures/Sxx.<ext>` and its SHA-256; `--archive spn` also asks Wayback Save Page Now (3 a minute, a failure is noted, the capture stays) |
| `source <url> --file <saved page>` | records a page you read yourself and hashes the capture |
| `evidence <file\|url> [--of Sxx]` | copies an original to `Evidence/Exx-<name>`, hashed, read-only |
| `entity <kind> <value> [--confidence] [--sources S01,S02] [--aliases a,b] [--prop k=v]` | one note per value; kinds: domain url ip organization person email account tracker place phone image video |
| `clue "<text>" --status <s> [--credibility 1..6] [--where <file>] [--sources S01] [--entities v1,v2] [--constraint] [--title t]` | one clue note |
| `hyp add "<claim>" --level <l> --refute-if "<what would refute it>" [--under H01] [--prior p]` | the refutation is written before examining |
| `hyp lr H01 --clue C03 --lr 3 --why "…"` | a likelihood ratio, clamped to the clue's cap |
| `hyp exclude H02 --clue C05 --why "…" [--covers 0.5..1]` / `hyp retain H01` / `hyp list` | exclusion, the retained answer, the ranking |
| `redteam --file v.json` / `conclude --file c.json` / `next --file l.json` | below |
| `note <path.md> --text t \| --file f [--block agent]` | free text in a block of a vault note, never in `.osint/` or `Evidence/` |

A source read again unchanged (same URL, same SHA-256) stays the same source; a clue with the same text, status, place, entities, credibility and constraint is the same clue and gains its new sources (the Journal says « read again, unchanged » or « found again »).

## Statuses and caps

| Clue status | Rests on | LR cap | May exclude |
|---|---|---|---|
| `read` | a text you read (registry, legal notice) | 50 | yes |
| `computed` | a calculation | 50 | yes |
| `observed` | a look (style, layout) | 5 | no |
| `inferred` | a coincidence (shared tracker, hosting) | 3 | no |
| `model` | a model's output | 3 | no |

An LR above the cap is lowered and the Journal says so: quote the capped value. An exclusion needs a `read`/`computed` clue that names a file that exists (`--where`, or the capture of one of its sources); an area hypothesis needs `--covers` of at least 0.5.

## redteam and conclude files

```json
{ "target": "H01", "outcome": "survives", "refutations": [ { "test": "a SIREN homonym?", "result": "the registry shows one company at this address" } ] }
```
`outcome`: `survives`, `weakened` or `refuted`. The red team must come after the last ranking change.

```json
{ "answer": "H01", "confidence": { "owner": "high", "infrastructure": "medium" },
  "criteria": { "owner": "a SIREN read on the site and confirmed by the registry", "infrastructure": "DNS and RDAP agree" },
  "alternatives": [ { "hyp": "H02", "test": "the legal notice naming the agency as publisher" } ],
  "unresolved": ["C07"], "radius_m": null }
```
`conclude` is refused unless: the red team ran after the last ranking and targeted the answer (not refuted); every clue supporting the answer or excluding another hypothesis cites a source or a Journal entry (never fabricate verification); each alternative has its test; each level has `high|medium|low` and the criteria it meets (the type manifest's levels); a radius of 100 m or less has two independent `--constraint` clues. Cite each failed check to the user and fix it.

## GDPR article 9

In a `person` case and every case below it (by `parent`), `entity`, `clue`, `note` and `hyp add|lr` are refused (exit 1) when they carry data of article 9 (health, religion or belief, sex life or orientation, political opinions, racial or ethnic origin, trade-union membership, genetic or biometric data); a type's engine that writes such data has the write withheld (Journal kind `withheld`, never the value) and its command goes on. `new` refuses a question, purpose or input that seeks it, or that seeks to find, contact or follow a private person. The subject's name is never read as such; a word list in English and French, not a classifier. A page's capture keeps what the page showed.

## Admiralty

Source reliability A (completely reliable) to F (cannot be judged), set with `--reliability`; clue credibility 1 (confirmed) to 6 (cannot be judged), set with `--credibility`.

## Rules, word for word

- **Never fabricate verification**: a match is quoted only with its source or Journal entry.
- **The image wins**: the evidence outranks metadata and captions.
- **Models rank, evidence decides.**
- **Exclusion needs the same standard as confirmation.**
- **One answer, no midpoints.**
- **List the whole category before choosing.**

## Time and weather

`osint.mjs sun --at <lat>,<lon> --date <instant|day> [--tz <IANA>] [--shadow-bearing <deg>] [--ratio <h/l>] [--tol 5] [-p <slug>]` (NOAA formulas; a `computed` clue with its source). `osint.mjs weather --at <lat>,<lon> --date <day> [--hour <0-23 UTC>] [-p <slug>]` (Open-Meteo's ERA5 archive, about 9 km; an `inferred` clue: it ranks, it does not exclude). An EXIF time is the camera's local clock, with no sure time zone.
