# The files of a search

What the engine writes and the dashboard reads. Read the part a step names: `listings.json` for a listing's fields. `market.json` is in
`analyse-and-messages.md`, `alerts.json` in `follow-up.md`, and what you write for `add --file` in
`listing-format.md`.

Contents: `listings.json` · the other files of a search (`search.json`, `area.json`, `feed.json`) · the files of the
searches folder

## `listings.json`

There is one object per flat, whatever its source. The engine writes it and the dashboard reads it. Field names are in
snake_case.

| Field | Meaning |
|---|---|
| `id` | The Stream Estate property uuid, else `w-<hash>` (websearch), `p-<hash>` (pasted) or `m-<hash>` (manual), hashed from the URL or the text |
| `source` | `stream-estate`, `websearch`, `pasted` or `manual` (typed by the user in the dashboard's form, which posts these same fields to `POST /api/s/<slug>/listings`) |
| `property_type` | `flat`, `house`, `land`, `parking` or `premises` (Stream Estate's office and shop); absent means flat |
| `se_id` | The Stream Estate id, or null |
| `se_created_at` | When Stream Estate created the property (it never changes): the window of creation dates that leaves it out of the next counts and fetches; `published_at` stands in for it on a listing fetched before 1.19 |
| `read_at` | When Stream Estate last gave it (fetch, refresh, reread): its adverts' crawl dates are read against it |
| `urls[]` | `{ url, source, published_at, expired_at, last_seen_at, checked_at, gone_at, favorites, urgent }` for each portal it is on (`source`: the portal, SL, LBC, Bienici…). `last_seen_at`: Stream Estate's last crawl; `checked_at`, `gone_at`: the dashboard server's daily link check (404, 410, a « not found » page). An advert is gone when expired, found gone (and not crawled since), or not crawled for 30 days at `read_at`; a listing all of whose adverts are gone becomes `EXPIRED` (lib/listings.js `deadAd`) |
| `price`, `net_price`, `area`, `carrez`, `land_area`, `price_per_m2` | Asking price (€, fees as listed), net seller price, m², Carrez, land in m², €/m² (of land for a plot) |
| `rooms`, `bedrooms`, `floor`, `floors`, `last_floor`, `ground_floor` | The flat |
| `dpe` | `{ energy, energy_value, ghg, date, reference }` from the listing |
| `construction_year`, `lots`, `construction_type`, `condition`, `legal_proceedings`, `new_build` | The building |
| `features` | `{ balcony, terrace, garden, cellar, parking, elevator, caretaker, bike_room, fiber, crossing, quiet, orientation[], heating }` |
| `location` | `{ point: [lon, lat], accuracy, address, city, insee, postcode, neighborhood, iris, city_id }`. Stream Estate gives no address: `accuracy` says how close its point is (`PRECISE` at the house number, `NEIGHBORHOOD`). A place the user gave (« Préciser l'adresse », `locate`) adds `by: hand\|osint`, `at` and `osint { case, confidence, radius_m }` |
| `location_source` | The source's own place while the user's is in `location`: a refresh writes there, `locate --reset` puts it back |
| `fees` | `{ agency: { amount, percentage, included, paid_by }, condo_yearly, property_tax }` (€ a year) |
| `status` | `AVAILABLE`, `UNDER_OFFER`, `SOLD`, `WITHDRAWN` or `EXPIRED` (Stream Estate: `AVAILABLE` or `EXPIRED` only) |
| `publishers[]` | `{ type, name, card, website, phone, email, profile_url, mandate, by? }`; `by: "hand"`: a contact the user corrected in the dossier (« Modifier le contact »), kept as it is through refreshes; the messages to its old name took the new one |
| `pictures[]`, `se_pictures[]`, `title`, `description` | The photos: the whole gallery of its best advert still online, on the portal's servers (gone with the advert), else Stream Estate's copies (1 to 5, they stay); `se_pictures`: those copies when the gallery is shown, the dashboard's fallback |
| `my_pictures[]` | The user's own photos (images dropped on the dossier's photos, jpg, png, webp, gif or avif, 25 MB at most): `{ id, name, size, file }`, `file` their path in the search's folder (`documents/<listing id>/<id>-<name>`), shown after the portal's; deleted from the viewer |
| `kept_pictures[]` | Once the listing expired, its photos downloaded into the search by the dashboard server's watch (and at its start) before the portal deletes them: `documents/<listing id>/portail-01.jpg`…, the dossier shows them in place of the URLs; git keeps them. Absent: not downloaded yet (a listing none of whose photos could be reached is tried again at the next watch) |
| `published_at`, `updated_at` | The first publication on any portal, the last crawl |
| `urgent`, `favorites` | Urgent on a portal (a lever), the highest favorite count (competition); a listing you read only |
| `price_changes[]` | The portals' price history `{ date, from, to, pct }`, each change once |
| `first_seen`, `price_history[]` | When this search first saw it, each price it saw `{ date, price }` |
| `changes[]` | `{ date, kind: new\|price_drop\|price_rise\|status\|expired, from, to }`, for the "new since your last visit" view |
| `my_status`, `favorite`, `labels`, `seen_at`, `notes`, `notes_history` | The user's: `to_visit`, `visited`, `offer`, `dropped` or null; their star (the dashboard's ☆, apart from the status); their free labels (strings, set in the dashboard, used to group listings); when they first opened its dossier (« Nouveau » until then, or until a status or a star); free notes in Markdown (« Mes notes », rendered in the dossier, a `- [ ]` box ticked there; 20,000 characters at most; `note` adds what the agent learned after them, `note --check` ticks a box); each change of the notes (`notes_history`, the last 30, oldest first: `{ date, by: user\|agent\|restore, diff }`, `diff` the path in the search's folder of `notes/<listing id>/<date>-<by>.diff`, a unified diff in git's format of what the change did, the notes as `notes.md`; a box ticked makes none, nor the first notes; the dossier's « Restaurer » rebuilds the notes before a change by undoing them from the current notes, so never edit `notes` by hand in this file, nor a .diff: write the notes with `note`; a history of full copies `{ date, notes, by }` from before 1.39.0 becomes .diff files at the next read) |
| `messages[]` | Its conversation with the agency or the seller (`message`, the dossier's « Ajouter un message »): `{ id, date, from: me\|them, kind: offer\|question\|visit\|reply\|follow_up\|documents\|other, channel: email\|sms\|phone\|visit\|null, amount, to, text, sent_at, documents? }`. `from: me` is a draft until `sent_at` (the user marks it sent); `from: them` is received; `to` is the one on the other side. An old message without `from` is the user's. `documents[] { id, name, size, file, type }`: the files it carries, `file` their path in the search's folder (`documents/<listing id>/<doc id>-<name>`), deleted with the message; `type` one of `lib/documents.js` (`minutes`, `dpe`, `tax`…, `other`), from the name unless given, `document` sets it |
| `building` | Added by the enrichment: `{ ban, dpe[], dpe_match, dpe_cost_yearly, construction_year, copro, risks, sales[] }` |

The listings are deduplicated by id, else by URL (host and path, without the query or a trailing slash). When Stream
Estate finds a listing the user added by hand, it takes its place and its id, and the user's status, notes, messages and
history stay.

## The other files of a search

- `search.json`:
  - `slug`, `query`, `label`, `type` (housenumber, street, municipality);
  - `mode` (`stream-estate`, or `classic` for OpenData);
  - `types` (`["flat"]` when absent);
  - `point`, `insee`, `dep`, `street { name, code_voie }`, `ban`;
  - `zone { how: radius|commune|iris|drawn, kind: radius|polygon, center, radius_m, geometry, label }`. For a
    street, `how: radius` is a band along the whole street: a polygon (`kind: polygon`), every point within `radius_m`
    of the street's line (BD TOPO), a MultiPolygon when its segments lie apart; without a known line, a straight band
    between its farthest DVF sales and address numbers. `how: drawn` is the outline the user drew on the dashboard's
    map, 60 corners at most (its draft waits in `zone-draft.json` until `search --zone drawn`);
  - `criteria { budget_min, budget_max, area_min, area_max, rooms_min, rooms_max, floor_min, land_min, dpe_max,
    elevator, outdoor }`, each applied to the types that have it;
  - `stream { total, counted_at }`, `last_fetch`, `last_refresh`, `last_visit` (a fetch takes the profile's
    `max_fetch` at most, « Réglages »; a search of 1.7 or before also has `max`, no longer read);
  - `alert { searches[] { id, type }, topic, … }` in a search of skill-immo 1.6 or before: a Stream Estate saved search
    per type, pushed to ntfy.sh. `alert delete` deletes it; nothing makes one any more.
- `market.json`: its fields are in `analyse-and-messages.md`, « `market.json` », with the questions on the market.
- `area.json`:
  - `center`, `pois[] { cat, kind, name, point }`, `risks`;
  - `crime { commune, department }`, `income { local, department, france }`, `iris`;
  - `isochrones[] { place, profile, minutes, geometry }`, `places`;
  - `dpe_recent[] { number, date, energy, type: flat|house, area, address, ban, point }`: the ADEME DPE of the last 12
    months in the zone, newest first, one per home (`{ error }` when ADEME failed; empty for a search with no home
    type). `lib/dpe.js` gives each listing one of them at most: its own by number (`building.dpe_match`,
    `dpe.reference`; a listing whose number is known takes no other), else the one of
    its `building.ban` with the closest surface (within 8 %), else the nearest of the same type and surface within
    300 m, with its class and DPE date when the listing gives them. A DPE taken goes to no other listing.
  - `audit_recent[] { number, date, energy, type: flat|house, building, area, period, address, ban, point }`: ADEME's
    energy audits of the last 12 months in the zone (`building`: a whole building, `area` its own); for a search of
    homes.
  - `permit_recent[] { number, kind: build|demolish|develop, form: PC|DP|PD|PA, date, homes, demolished, land, address,
    ban, point }`: Sitadel's building permits authorised in the last 12 months in the zone (the search's city), placed
    by the BAN; any search.
- `feed.json`: `read_at` (all read up to then) and `read[]` (the keys of news read one by one: `<kind>-<date>-<listing
  id | DPE, audit or permit number>`), the news newest first (`items[]`, 500 at most), and the server's last counts of the API (`stream
  { total, counted_at }`: listings not fetched yet; `changed { since, total, refresh, counted_at }`: fetched ones changed on the
  portals since `last_refresh`, the dropped ones left out, and all that a refresh would fetch, new ones too), shown in « Suivi »'s bar. A news is `{ date, kind, … }`:
  - `dpe { … }`: a DPE of `dpe_recent` new since the last one, that no listing matches (any home type and criteria);
  - `dpe { … }, outside: true`: a new DPE at the place of one of the user's alerts, outside the zone;
  - `audit { … }`, `permit { … }`: a new energy audit or building permit of the zone (a row of `audit_recent`,
    `permit_recent` area.json did not hold), or with `outside: true` at the place of one of the user's alerts.

  The listings' own `changes[]` (`new`, `price_drop`, `price_rise`, `status`, `expired`) are news too. A feed of 1.7
  may hold `listings` and `changed` news: no alert takes them any more.
- `alerts.json`: its format is in `follow-up.md`, « `alerts.json` », with the alert mode that writes it.
- `notes/<listing id>/*.diff`: the history of each listing's notes, one .diff a change (`notes_history` above); git keeps
  them. `git apply` replays one on the notes before it (saved with a final line break).

## The files of the searches folder

- `.settings.json` (« Réglages », every search): `watch_minutes` (0, 30, 60, 360, 720, 1440), `watch_paused` (no watch
  until resumed, its period kept), `api` (false: no call
  at all), `auto_fetch` and `auto_credits` (the automatic fetch and its credits a month), `notify`, `sound`, `quiet`
  (`["22:00", "08:00"]` or null), `read_on_open`, `keep_days` (0, 30, 90, 365; 0 keeps all).
- `.profile.json` (private): the budget's numbers, `weights`, `places`, `buyer { project, situation, timing, financing, name, phone, email }` (the
  dashboard's first contact: who the buyer is and their signature, in the words a message uses; every message is signed with it), and the credits' settings of « Réglages »:
  `monthly_credit_cap`, `eur_per_credit`, `max_fetch` (100), `account { deposited, items, at, topups[] { date, eur } }`
  (Stream Estate's console: the € deposited and « API items returned » as of `at`; `costs account`, `costs topup`).
