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
