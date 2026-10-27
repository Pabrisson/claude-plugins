# Stream Estate API v2

Extracted from `https://next.docs.stream.estate/openapi.json` (2.0.0, read on 2026-10-27). The spec itself is not
shipped. The v1 (`api.stream.estate`) stops on 2026-12-31: only v2 is used.

- **Base**: `https://api-v2.stream.estate`. The header `X-API-KEY: <key>` carries the key, read from
  `$STREAM_ESTATE_API_KEY` (the plugin's secret, exported by its SessionStart hook). It never leaves the engine.
- **Format**: `Accept: application/json` returns plain JSON (a property is `{ id, property, publishers, listings }`).
  `application/vnd.api+json` returns JSON:API, the only format that carries `meta.totalItems`, which a count needs.
- **Rate limit**: 500 requests per minute per key. A `429` comes with `X-RateLimit-Retry-After` (a Unix timestamp).
  `resolve-address` has its own per-minute limit (`429`).
- **402**: no credits left. The call was neither served nor charged. The engine stops and falls back to the assisted
  mode (exit 3).
- **Pricing** (2026-10-27): pay as you go at 0.01 € a credit, with no commitment. The home page says 5 € are offered,
  which the pricing page does not confirm. Plans: Starter 99 €/month for 15,000 credits, Growth 399 €, Scale 799 €.

## Costs

Only three routes declare a price in the spec: their answer carries `X-Credits-Charged` and they can return `402`.
The other routes declare neither. They are probably free, but they stay **unknown** until they are measured. Measure
them with `immo.mjs costs measure --accept-unknown --spend 1`, which makes one minimal call per route and compares the
header with `GET /account/api-usage?groupBy=ROUTE`. The results go into the searches folder's `.costs.json`, then into
this table and `lib/costs.js`.

| Route | Use | Cost |
|---|---|---|
| `POST /properties` | Listings of the zone, counts, refresh | 1 credit per result returned, 0 when none: `size: 0` (count only) costs 0 |
| `GET /properties/{id}` | One property, after a lookup | 1 credit per property read |
| `POST /properties/lookup-by-url` | `add <url>` | 1 credit when known, `404` free |
| `POST /alerts/forecast` | Notifications per day before creating an alert | Free (documented "Not billed") |
| `GET /account/api-usage` | `doctor`, `usage --remote` | Assumed free (no header, no 402) |
| `POST /properties/{id}/resolve-address` (beta) | Exact address → ADEME DPE, Géorisques, DVF of the building | Unknown |
| `GET /analytics/listings` | Asking €/m², time online, by DPE and publisher | Unknown (4 calls per `market`) |
| `POST /transactions/search` | Sales reconciled across DVF and notaries | Unknown (per result?) |
| `GET /geo/autocomplete`, `/geo/administrative-divisions/{id}` (+ `/geometry`, `/descendants`) | Division zones and their outline | Unknown |
| `POST /alerts`, `GET /alerts`, `PUT`/`DELETE /alerts/{id}`, `GET /alerts/{id}/events` | Alerts | Unknown |
| `GET /sources`, `GET /publishers/{id}` | Portal names, agency details | Unknown (the property already carries both) |

Not used: favorites (the local statuses do the job), and `event-destinations` beyond what an alert creates through
`notificationDestination.webhookUrl`.

## POST /properties

Body: `{ criteria, size (0–100), page, paginationType: PAGE|CURSOR, cursor, sort: { field, direction } }`. The default
sort is `UPDATED_AT DESC`. A criteria node is either flat filters `{ property, publisher, listings, dates, changes }`,
or `{ and: [...] }`, or `{ or: [...] }`. The filters used:

- `property.type.in: [FLAT]` and `property.transaction.type: SELL`.
- `property.pricing.displayed {gte, lte}`, `property.areas.displayed {gte, lte}`, `property.unit.rooms`, `.floor`.
- `property.unit.diagnostic.scores: [{ type: ENERGY_CONSUMPTION, rating: [A…max] }]`.
- `property.amenities.features.in: [ELEVATOR]`, and `property.unit.features.in: [BALCONY|TERRACE|GARDEN]` (one per
  `or` branch).
- `property.locations.in`. It takes one of:
  - `{ centerPoint: { latitude, longitude, radiusKm } }`;
  - `{ geoShapes: [Polygon|MultiPolygon] }`;
  - `{ ids: [division] }`;
  - `{ uniqueCodes: [INSEE] }`, with `countryCode: FR`.
- `property.id.nin`: up to 100 ids already fetched, so they are not paid twice.
- **Incremental refresh**: `dates.updatedAt.from` exists. The refresh asks
  `or: [updatedAt from the last refresh, listings.expiredAt from the last refresh]`. Expired properties are hidden
  unless `listings.expiredAt` is set.
- Also available, not used yet: `publisher.type`, `listings.marketing.urgent`, `changes.variationPercent` (drops),
  `body.description.in`, `building.constructionYear`, `building.numberOfLots`.

Each `listings[]` entry gives `url` (absent for a protected source: only its name is shown), `source.slug`,
`publishedAt`, `expiredAt`, `lastSeenAt` and `marketing.favorites` / `urgent`.

The fields of `property` used, and what they feed:

- `pricing.displayed` and `pricing.sale.netPrice`.
- `pricing.sale.fees`:
  - `agency` (amount, percentage, includedInPrice, paidBy);
  - `condominium` (total, frequency);
  - `taxes.propertyTax` (amount, frequency).
- `changes[]` (attribute `DISPLAYED_PRICE`, numericOld, numericNew, variationPercent): the price history.
- `transaction.status` (AVAILABLE, UNDER_OFFER, SOLD, WITHDRAWN) and `expired`.
- `unit`: rooms, floor, lastFloor, orientation, condition, balcony, terrace, cellar, parking, and `diagnostic.scores`
  (rating and value).
- `building`: constructionYear, numberOfLots, floors, constructionType, `legalStatus.underLegalProceedings`.
- `amenities`: elevator, caretaker, bikeRoom, `connectivity` (FIBER).
- `location`: a GeoJSON point, `accuracy` (PRECISE, STREET, CITY…), `city.uniqueCode` (INSEE), `neighborhood` and
  `subNeighborhood` (IRIS).
- `publishers[]`: publisherType, agencyName, professionalCardNumber, `contact` (email, phone), mandate.
- `pictures[]`.

## The other routes

- `POST /properties/lookup-by-url` `{ url }` → `{ id, property }`, then `GET /properties/{id}`.
- `POST /properties/{id}/resolve-address` → `{ confidence, method, address { label, houseNumber, street, postcode,
  cityCode, latitude, longitude }, energyCertificateNumber }`. What the confidence allows:
  - `EXACT` and `HIGH`: show the address;
  - `MEDIUM` and `LOW`: a "probable address";
  - `NONE`: nothing.
- `GET /analytics/listings`. Query parameters:
  - `property_type`, `transaction_type`, `event_type` (CREATED, UPDATED, EXPIRED, REACTIVATED);
  - `event_at_from` and `event_at_to`;
  - the bbox: `lat_min`, `lat_max`, `lng_min`, `lng_max`;
  - `group_by` (dpe_energy_rating, publisher_type, transaction_status…) and `time_bucket` (month…);
  - `metrics`: `count`, `median:price_per_sqm`, `median:days_between_events`, `percentile:<field>:<p>`.

  It returns `{ meta: { sample_size }, data: [{ group, metrics }] }`. `days_between_events` on `EXPIRED` events is
  taken as the time online: **to check with the key**.
- `POST /transactions/search` `{ dateMutation: { after, before }, propertyType, priceAmount (cents), city | district |
  neighborhood, geoshape, page: { cursor, size ≤ 100 } }` returns `data[]`, each sale with:
  - `source` (FR_DVF or FR_NOTARIES);
  - `price.amountCents` and `price.pricePerSqmCents`;
  - `areas.livingAreaSqm`;
  - `location.geoPoint`;
  - `matched`, the reconciled duplicate.

  The page's `meta.nextCursor` points to the next one. **To check with the key**: whether the notaries' records
  cover the Bas-Rhin, the Haut-Rhin and the Moselle, which DVF leaves out.
- `GET /geo/autocomplete?query=&type=` → `[{ id, name, locationType, parentName, postalCode, centroid }]`.
  `GET /geo/administrative-divisions/{id}/geometry` → `{ geometry }`, simplified for the division's size.
- `POST /alerts/forecast` `{ criteria }` (no `dates`, `changes` or `property.id`) → `{ windowDays, total, perDay,
  perHour }`.
- `POST /alerts` `{ name, enabled, criteria, notificationDestination: { webhookUrl }, notificationConfig: { rules: [{
  eventType: NEW_MATCH }, { eventType: PRICE_CHANGE, variationPercent: [{ lte: -3 }] }] } }`. The webhook must be
  HTTPS. The first webhook of the account gets a `signingKey`, shown only once. `GET /alerts/{id}/events` →
  `[{ eventType, property, createdAt, notifiedAt }]`.
- `GET /account/api-usage?groupBy=ROUTE&granularity=MONTH` → `{ totals: { calls, results, credits }, byRoute: [{
  route, calls, results, credits }] }`. The default period is the last 30 days.

## Webhook and ntfy.sh

Stream Estate POSTs `{ eventType, eventId, alert: { id, name }, listing: { id }, data: <the property, as
GET /properties/{id}> }`. It signs it with `X-Webhook-Signature: sha256=<HMAC of "{timestamp}.{body}">` and retries 4
times. By default the alert pushes to **ntfy.sh**. The URL is

```
https://ntfy.sh/<topic>?tpl=yes&t=<title template>&m=<message template>
```

ntfy's message templating reads the JSON body, for example
`{{.data.property.pricing.displayed}}`. **To check with the key**: that a real event renders well.

- **Topic security**: whoever knows the topic name can read it. The engine draws a random one
  (`immo-<slug>-<16 hex>`), and the pushes only carry what the listing already shows publicly.
- **Signature**: ntfy does not check the signature. A `--webhook <https url>` that checks it is the alternative.

## Points to settle with the key (phase 0)

- The measured cost of each unknown route (`costs measure`).
- That `size: 0` costs 0. This is documented; `live.test.js` checks it.
- What `days_between_events` measures, and whether `/transactions/search` covers Alsace-Moselle.
- How ntfy renders a real event.
- Replace `engine/test/fixtures/se-property.json`, which is built from the spec's examples, with a recorded answer.
