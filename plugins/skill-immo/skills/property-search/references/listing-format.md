# Listing format

## `add --file`: what Claude read

When Claude reads a listing itself, it writes what it found in a JSON file (one object, or an array) and runs
`immo.mjs add -p <slug> --file listing.json`. It reads it from a WebFetch of one listing page, a WebSearch result, or
the text the user pasted (then with `--source pasted`).

Write only what the listing says, never a guess. Leave unknown fields out. Every field is optional except `price` and
`area`.

```json
{
  "url": "https://www.pap.fr/annonces/appartement-lyon-3e-r123",
  "site": "pap",
  "type": "flat",
  "title": "Appartement 3 pièces 62 m²",
  "price": 289000,
  "area": 62,
  "land_area": null,
  "rooms": 3,
  "bedrooms": 2,
  "floor": 4,
  "floors": 6,
  "last_floor": false,
  "dpe": "D",
  "dpe_value": 212,
  "ges": "C",
  "construction_year": 1930,
  "lots": 24,
  "elevator": true,
  "balcony": true,
  "terrace": false,
  "garden": false,
  "cellar": true,
  "parking": false,
  "outdoor_area": 4,
  "condition": "GOOD",
  "address": "12 rue Paul Bert",
  "city": "Lyon",
  "postcode": "69003",
  "agency_fees": 9000,
  "agency_fees_included": true,
  "condo_yearly": 1600,
  "property_tax": 1100,
  "publisher": "Particulier",
  "publisher_type": "PRIVATE_INDIVIDUAL",
  "phone": "06 00 00 00 00",
  "published_at": "2026-09-14",
  "urgent": false,
  "status": "AVAILABLE",
  "pictures": ["https://…/1.jpg"],
  "description": "…",
  "text": "the pasted text, when the listing came as text"
}
```

- `type`: `flat`, `house`, `land` (a plot), `parking` (a parking or a box) or `premises` (a shop, an office, commercial
  premises). A listing without one is a flat.
- `area` is the living area (the building's, for premises); `land_area` the plot in m², for a house or a plot. A plot's
  price per m² is on its land; a parking has none, it is weighed on its price.
- `address`: give it only when the listing states the number and the street. The engine then places the flat (the
  national address base) and finds its DPE, condominium and building sales. With only a street or a neighborhood,
  give `point: [lon, lat]` from `immo.mjs geocode` when it helps the map, and no `address`.
- `publisher_type`: `PRIVATE_INDIVIDUAL` or `REAL_ESTATE_AGENCY`.
- `status`: `AVAILABLE` or `UNDER_OFFER`.
- `condition`: `NEW`, `GOOD` or `TO_RENOVATE`.
- `dpe`, `ges`: a letter from A to G.
- Prices are in euros, with the agency fees as listed.

## `listings.json`

There is one object per flat, whatever its source. The engine writes it and the dashboard reads it. Field names are in
snake_case.

| Field | Meaning |
|---|---|
| `id` | The Stream Estate property uuid, else `w-<hash>` (websearch) or `p-<hash>` (pasted), hashed from the URL or the text |
| `source` | `stream-estate`, `websearch` or `pasted` |
| `property_type` | `flat`, `house`, `land`, `parking` or `premises` (Stream Estate's office and shop); absent means flat |
| `se_id` | The Stream Estate id, or null |
| `urls[]` | `{ url, source, published_at, expired_at, last_seen_at, favorites, urgent }` for each portal it is on (`source`: the portal, SL, LBC, Bienici…) |
| `price`, `net_price`, `area`, `carrez`, `land_area`, `price_per_m2` | Asking price (€, fees as listed), net seller price, m², Carrez, land in m², €/m² (of land for a plot) |
| `rooms`, `bedrooms`, `floor`, `floors`, `last_floor`, `ground_floor` | The flat |
| `dpe` | `{ energy, energy_value, ghg, date, reference }` from the listing |
| `construction_year`, `lots`, `construction_type`, `condition`, `legal_proceedings`, `new_build` | The building |
| `features` | `{ balcony, terrace, garden, cellar, parking, elevator, caretaker, bike_room, fiber, crossing, quiet, orientation[], heating }` |
| `location` | `{ point: [lon, lat], accuracy, address, city, insee, postcode, neighborhood, iris, city_id }`. Stream Estate gives no address: `accuracy` says how close its point is (`PRECISE` at the house number, `NEIGHBORHOOD`) |
| `fees` | `{ agency: { amount, percentage, included, paid_by }, condo_yearly, property_tax }` (€ a year) |
| `status` | `AVAILABLE`, `UNDER_OFFER`, `SOLD`, `WITHDRAWN` or `EXPIRED` (Stream Estate: `AVAILABLE` or `EXPIRED` only) |
| `publishers[]` | `{ type, name, card, website, phone, email, profile_url, mandate }` |
| `pictures[]`, `title`, `description` | Up to 12 pictures |
| `published_at`, `updated_at` | The first publication on any portal, the last crawl |
| `urgent`, `favorites` | Urgent on a portal (a lever), the highest favorite count (competition); a listing Claude read only |
| `price_changes[]` | The portals' price history `{ date, from, to, pct }`, each change once |
| `first_seen`, `price_history[]` | When this search first saw it, each price it saw `{ date, price }` |
| `changes[]` | `{ date, kind: new\|price_drop\|price_rise\|status\|expired, from, to }`, for the "new since your last visit" view |
| `my_status`, `favorite`, `notes` | The user's: `to_visit`, `visited`, `offer`, `dropped` or null; their star (the dashboard's ☆, apart from the status); free notes |
| `messages[]` | Its conversation with the agent or the seller (`message`, the dossier's « Ajouter »): `{ id, date, from: me\|them, kind: offer\|question\|visit\|reply\|follow_up\|documents\|other, channel: email\|sms\|phone\|visit\|null, amount, to, text, sent_at }`. `from: me` is a draft until `sent_at` (the user marks it sent); `from: them` is received; `to` is the one on the other side. An old message without `from` is the user's |
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
  - `zone { how: radius|commune|iris, kind: radius|polygon, center, radius_m, geometry, label }`. For a
    street, `how: radius` is a band along the whole street: a polygon (`kind: polygon`) `radius_m` wide on each side,
    its ends taken from the street's DVF sales and address numbers;
  - `criteria { budget_min, budget_max, area_min, area_max, rooms_min, rooms_max, floor_min, land_min, dpe_max,
    elevator, outdoor }`, each applied to the types that have it;
  - `max`, `stream { total, counted_at }`, `last_fetch`, `last_refresh`, `last_visit`, and
    `alert { searches[] { id, type }, topic, hooks { match, event }, webhook, enabled, created }` (one Stream Estate
    saved search per type).
- `market.json`:
  - `dvf.<type>` for each type of the search: `{ commune, zone, street, recent, years, trend, by_rooms, streets,
    points[] }`. Each of the four first is a stats object: `count`, `median_ppm2` (the unit price: € per m², of land
    for a plot, € a lot for a parking), `q1`, `q3`, `median_price`, `median_area` and `by_quarter[]`;
    - `trend { zone, commune }`: each `{ to, median_ppm2, y1, y3 }`, the median of the last 12 months (to the newest
      sale) and its move against the 12 months one and three years before (0.05 = +5 %), null under 10 sales a side;
    - `by_rooms { scope: recent|zone, rows[] { rooms, count, median_price, median_area, median_ppm2 } }`: 5 stands for
      5 and more, 3 sales at least a row; the zone's last two years, or its five when they hold under 30 sales;
    - `streets[] { code_voie, name, count, median_ppm2, point, change, distance }`: the commune's streets with 5 sales
      or more, the 40 nearest to the zone's center; `change` is the last two years against the years before;
  - `context { dpe, tax, housing }`, each `{ error }` when its source failed:
    - `dpe { scope: zone|commune, flat, house }`: the count of ADEME DPE per class, one per home, within the zone's
      radius of its center (a circle or a street), else in the commune;
    - `tax { year, city, commune, epci, epci_name, total, waste, france }`: the property tax rates in %, `total` with
      the syndicates and GEMAPI, `waste` the household waste tax apart, `france` the average weighted by population;
    - `housing { release, years[] { year, authorised, started } }`: the homes authorised and started (Sitadel);
  - `rent { year, flat, flat_small, flat_large, house }`: the carte des loyers of the commune, each `{ per_m2, low,
    high, scope, observations }` (€ per m² a month, charges included);
  - `alsace_moselle`;
  - `stream { type, median, average, series { "2026-10": … } }`: the asking €/m² of the zone's listings over two
    years, filled by `market` for the search's first type.
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
