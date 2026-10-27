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
  "title": "Appartement 3 pièces 62 m²",
  "price": 289000,
  "area": 62,
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
| `id` | The Stream Estate property id, else `w-<hash>` (websearch) or `p-<hash>` (pasted), hashed from the URL or the text |
| `source` | `stream-estate`, `websearch` or `pasted` |
| `se_id` | The Stream Estate id, or null |
| `urls[]` | `{ url, source, published_at, expired_at, last_seen_at, favorites, urgent }` for each portal it is on. `url` is null for a protected source |
| `price`, `net_price`, `area`, `carrez`, `price_per_m2` | Asking price (€, fees as listed), net seller price, m², Carrez, €/m² |
| `rooms`, `bedrooms`, `floor`, `floors`, `last_floor`, `ground_floor` | The flat |
| `dpe` | `{ energy, energy_value, ghg, date, reference }` from the listing |
| `construction_year`, `lots`, `construction_type`, `condition`, `legal_proceedings`, `new_build` | The building |
| `features` | `{ balcony, terrace, garden, cellar, parking, elevator, caretaker, bike_room, fiber, crossing, quiet, orientation[], heating }` |
| `location` | `{ point: [lon, lat], accuracy, address, city, insee, postcode, neighborhood, iris, city_id }` |
| `fees` | `{ agency: { amount, percentage, included, paid_by }, condo_yearly, property_tax }` (€ a year) |
| `status` | `AVAILABLE`, `UNDER_OFFER`, `SOLD`, `WITHDRAWN` or `EXPIRED` |
| `publishers[]` | `{ type, name, card, website, phone, email, profile_url, mandate }` |
| `pictures[]`, `title`, `description` | Up to 12 pictures |
| `published_at`, `updated_at` | The first publication on any portal, the last crawl |
| `urgent`, `favorites` | Urgent on a portal (a lever), the highest favorite count (competition) |
| `price_changes[]` | The source's price history `{ date, from, to, pct }` |
| `first_seen`, `price_history[]` | When this search first saw it, each price it saw `{ date, price }` |
| `changes[]` | `{ date, kind: new\|price_drop\|price_rise\|status\|expired, from, to }`, for the "new since your last visit" view |
| `my_status`, `notes` | The user's: `to_visit`, `visited`, `offer`, `dropped` or null, and free notes |
| `building` | Added by the enrichment: `{ address, ban, dpe[], dpe_match, dpe_cost_yearly, construction_year, copro, risks, sales[] }` |

The listings are deduplicated by id, else by URL (host and path, without the query or a trailing slash). When Stream
Estate finds a listing the user added by hand, it takes its place and its id, and the user's status, notes and history
stay.

## The other files of a search

- `search.json`:
  - `slug`, `query`, `label`, `type` (housenumber, street, municipality);
  - `mode` (`stream-estate` or `classic`);
  - `point`, `insee`, `dep`, `street { name, code_voie }`, `ban`;
  - `zone { how: radius|commune|iris|division, kind: radius|polygon, center, radius_m, geometry, label }`. For a
    street, `how: radius` is a band along the whole street: a polygon (`kind: polygon`) `radius_m` wide on each side,
    its ends taken from the street's DVF sales and address numbers;
  - `criteria { budget_min, budget_max, area_min, area_max, rooms_min, rooms_max, floor_min, dpe_max, elevator,
    outdoor }`;
  - `max`, `stream { total, counted_at }`, `last_fetch`, `last_refresh`, `last_visit`, and
    `alert { id, topic, drop }`.
- `market.json`:
  - `dvf { commune, zone, street, recent }`. Each of the four is a stats object: `count`, `median_ppm2`, `q1`, `q3`,
    `median_price`, `median_area` and `by_quarter[]`;
  - `dvf.years` and `dvf.points[]`;
  - `alsace_moselle`;
  - `stream { trend, dpe, publishers, online, transactions }`, filled by `market`.
- `area.json`:
  - `center`, `pois[] { cat, kind, name, point }`, `risks`;
  - `crime { commune, department }`, `income { local, department, france }`, `iris`;
  - `isochrones[] { place, profile, minutes, geometry }`, `places`.
- `alert-events.json`: the alert's events, written by `alert events`.
