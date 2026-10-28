# Stream Estate API v1

Extracted from `https://docs.stream.estate/api-reference/openapi.json` (1.0.0, read on 2026-10-28) and checked with a
v1 key the same day. The spec itself is not shipped. A v1 key does not work on the v2 (`api-v2.stream.estate`), and
the v2 is not used.

- **Base**: `https://api.stream.estate`. The header `X-API-KEY: <key>` carries the key, read from
  `$STREAM_ESTATE_API_KEY` (the plugin's secret, exported by its SessionStart hook). It never leaves the engine.
- **Format**: `Accept: application/ld+json` returns a Hydra collection, `{ "hydra:member": [...], "hydra:totalItems" }`.
  `application/json` returns a bare array, with no total: the engine always asks for JSON-LD.
- **Query strings**: lists as `propertyTypes[]=0&propertyTypes[]=1`, polygons as `geoShapes[0][3][0]=<lon>` and
  `geoShapes[0][3][1]=<lat>`. The brackets go raw. A URL of 10 kB is refused (9 kB passes): a zone's outline is cut to
  60 vertices and the excluded ids to 60.
- **Errors**: 400, 401 (wrong key), 403, 404, 429 (slow down). Nothing is documented for an empty balance: the engine
  treats a 402 as one (assisted mode, exit 3).
- **Pricing** (2026-10-28): billed by **item**, 0.01 € each pay as you go. Plans: Starter 99 €/month for 15,000 items,
  Growth 399 €, Scale 799 €. The engine calls an item a credit.

## Costs

The v1 answers carry no cost header and there is no usage route: the engine logs each call at its route's price, from
this table or the searches folder's `.costs.json` (`costs set "<route>=<credits>"`, read off the console).

| Route | Use | Cost |
|---|---|---|
| `GET /documents/properties` | Listings of the zone, counts, refresh | 1 credit per item returned; `itemsPerPage=0` (a count) returns none |
| `GET /indicators/price_per_meter` | The zone's asking €/m² (`market`) | Unknown |
| `GET`, `POST /searches`, `PUT`, `DELETE /searches/{id}` | Alerts | Unknown |

Not used: `GET /documents/properties/{id}` (the collection returns the same document), `similar-properties`,
`/indicators/points_of_interest` (Overpass does it), `/public/location-autocomplete` and `/cities` (the zones are the
engine's own), `/webhook-tester` (used once to check the pushes, below).

## GET /documents/properties

The filters used: `transactionType=0` (sale), `propertyTypes[]` (apartment `0`, house `1`, building `2`, parking `3`,
office `4`, land `5`, shop `6`), `budgetMin`/`budgetMax`, `surfaceMin`/`surfaceMax`, `roomMin`/`roomMax`,
`landSurfaceMin`, `energyCategories[]`, `excludedProperties[]` (property uuids), `expired`, `fromUpdatedAt`,
`fromExpiredAt`, `itemsPerPage` (30 at most), `page`, `order[updatedAt]=desc`. The zone is one of:
- `lat`, `lon`, `radius` (km);
- `includedInseeCodes[]` for a commune (an arrondissement's code works: `69383`);
- `geoShapes`, a polygon's outer ring.

No filter on the floor, the elevator or an outdoor space: `matches()` sorts those listings out once fetched, and
`search` warns that the count includes them. The criteria differ per type (a parking has no rooms), so a search sends
one query per type. A count is capped at 10,000.

- **Online**: `expired=false` and `fromUpdatedAt` within 90 days. The v1 never expires most of what left the portals:
  rue Paul Bert (a 400 m band, flats) on 2026-10-28 held 9,420 properties not expired, 7,007 of them not updated for a
  year, 3,364 for three; 677 were updated within 30 days, 1,299 within 90.
- **Incremental refresh**: one query of what is online and updated since the last refresh (`fromUpdatedAt` takes a
  full ISO date), one of what expired since (`expired=true&fromExpiredAt=`).
- **Paging**: a page starts at a multiple of its size, so a fetch of 37 asks 30, then 5, then 2: never one more item
  than the user agreed to.

A `PropertyDocument`: `uuid`, `propertyType`, `price`, `pricePerMeter`, `surface`, `room`, `bedroom`, `floor`,
`landSurface`, `elevator`, `expired`, `expiredAt`, `createdAt`, `updatedAt`, `lastCrawledAt`, `title`, `description`,
`pictures[]` (URLs), `location { lat, lon }` (the spec says `locations`: the answer says `location`), `city { id, name,
insee, zipcode }` and `adverts[]`, one per portal, each with:
- `url`, `publisher { name (the portal: SL, LBC, Bienici…), type (0 individual, 1 professional) }`, `contact { name,
  phone, email, agency, reference }`;
- `price`, `priceExcludingFees`, `feesPercentage`, `feesResponsibility` (0 seller, 1 buyer), `condominiumFees` (a year);
- `energy { category, value }`, `greenHouseGas`, `diagnosticDate`, `constructionYear`, `lotCount`, `floorQuantity`;
- `features[]`, free text (« Balcon », « 2/5 étage », « 1 parking: Box »), `geoAccuracy` (1 house number, 2 neighborhood);
- `expired`, `expiredAt`, `createdAt`, `lastCrawledAt`, `daysOnMarket`;
- `events[] { fieldName (price, expired, title, description, pictures…), fieldOldValue, fieldNewValue (strings),
  percentVariation, createdAt }`.

What the engine makes of it (`fromStreamEstate`): the DPE class most adverts give (one portal often mistypes it), one
publisher per phone number, the `price` events of all the adverts once each as the price history, the features from
the adverts' free text (true when listed, else unknown). There is no address, no IRIS, no transaction status (under
offer), no property tax and no urgent flag.

## GET /indicators/price_per_meter

The same filters (the engine sends the type, the zone and `fromDate`, two years back) and `aggregationInterval=month`.
Returns `[{ average, average_min, average_max, median, series: { "2026-10": 5063.61, … } }]`: the asking €/m² of the
listings created in the period, expired ones included. Rue Paul Bert, flats, 2026-10-28: median 4,805, average 5,054.

## Searches (alerts)

`POST /searches` takes the same filters as a body (`propertyTypes`, `lat`/`lon`/`radius`, `geoShapes`,
`includedZipcodesInsee` for INSEE codes, `budgetMin`…, `roomMin`…, `landSurfaceMin`; no energy filter), a `title`,
`notificationEnabled`, `endpointRecipient` (HTTPS, receives the matches), `eventEndpoint` (HTTPS, receives the events)
and `subscribedEvents` (`ad.update.price`, `ad.update.surface`, `ad.update.pictures`, `ad.update.expired`,
`property.ad.create`, `property.ad.update`). Its id is the end of its `@id` (`/searches/<uuid>`). A `PUT` replaces the
search: the engine sends the whole body again. A failed push is retried five times, an hour apart. There is no history
of the pushes.

- A **match** POSTs `{ "@type": "Match", property, search, createdAt, propertyDocument: <the PropertyDocument> }`.
- An **event** POSTs `{ event: "ad.update.price", adEvent: { fieldName, fieldOldValue, fieldNewValue, percentVariation,
  createdAt }, match: <the match> }`.

Checked with the key on 2026-10-28 (a search on the rue Paul Bert band, created, turned off, deleted):
- `budgetMax` (or `pricePerMeterMax`) is required: without it, a `400` « Veuillez saisir au moins un de ces 2
  critères : Budget maximum ou Prix au m2 ». The engine asks for a `budget_max` first;
- `geoShapes` as `[[[lon, lat], …]]` is kept as sent, with the endpoints, `subscribedEvents` and `budgetMax`; the API
  adds `withCoherentPrice: true` and a `token`;
- a `PUT` with the whole body turns `notificationEnabled` off and keeps the rest; a `DELETE`, then the search answers
  `404`;
- `includedZipcodesInsee: ["69383"]` (a commune zone, created and deleted the same day) is kept as `includedCities`,
  the city « Lyon 3e » (`/cities/28676`): an arrondissement's code gives the arrondissement.

## ntfy.sh

By default an alert pushes to a random ntfy.sh topic (`immo-<slug>-<16 hex>`): whoever knows it can read it, and the
pushes carry only what the listing shows publicly. ntfy's templating turns the JSON into a readable push, one URL per
endpoint:

```
https://ntfy.sh/<topic>?tpl=yes&t=Nouvelle annonce · {{.propertyDocument.city.name}}&m={{.propertyDocument.room}} p. · …
https://ntfy.sh/<topic>?tpl=yes&t=Prix modifié · {{.match.propertyDocument.city.name}}&m={{.adEvent.fieldOldValue}} → …
```

Checked on 2026-10-28 with `GET /webhook-tester?endpoint=<url>[&eventType=ad.update.price]`: « Nouvelle annonce · Paris
8e » / « 3 p. · 100 m² · 900000 € — … », and « Prix modifié · … » / « 900000 → 875000 € (-2.78 %) — … ». The payload
(about 6 kB) is templated, not turned into an attachment.
