# Stream Estate API v1

Contents: Costs · GET /documents/properties · GET /indicators/price_per_meter · Searches (alerts): no longer made

Extracted from `https://docs.stream.estate/api-reference/openapi.json` (1.0.0, read on 2026-10-28) and checked with a
v1 key the same day. The spec itself is not shipped. A v1 key does not work on the v2 (`api-v2.stream.estate`), and
the v2 is not used.

- **Base**: `https://api.stream.estate`. The header `X-API-KEY: <key>` carries the key, read from
  `$STREAM_ESTATE_API_KEY` (the plugin's secret, exported by its SessionStart hook in Claude Code; any other agent
  reads it from the environment). It never leaves the engine.
- **Format**: `Accept: application/ld+json` returns a Hydra collection, `{ "hydra:member": [...], "hydra:totalItems" }`.
  `application/json` returns a bare array, with no total: the engine always asks for JSON-LD.
- **Query strings**: lists as `propertyTypes[]=0&propertyTypes[]=1`, polygons as `geoShapes[0][3][0]=<lon>` and
  `geoShapes[0][3][1]=<lat>`. The brackets go raw. A URL of 10 kB is refused (9 kB passes): a zone's outline is cut to
  60 vertices, and the excluded ids are split over windows of creation dates (below), each URL under 8.5 kB.
- **Errors**: 400, 401 (wrong key), 403, 404, 429 (slow down). Nothing is documented for an empty balance: the engine
  treats a 402 as one (assisted mode, exit 3).
- **Pricing** (2026-10-28): billed by **item**, 0.01 € each pay as you go. Plans: Starter 99 €/month for 15,000 items,
  Growth 399 €, Scale 799 €. The engine calls an item a credit.

## Costs

The v1 answers carry no cost header and there is no usage route: the engine logs each call at its route's price, from
this table or the searches folder's `.costs.json` (`costs set "<route>=<credits>"`, read off the console). Nor does it
give the account's balance: on 2026-10-29 with the key, `/me`, `/users/me` and `/account` answered `404`, the Hydra
documentation its answers link to (`docs.jsonld`) a `500`, and no header carries a quota. Stream Estate shows the account
in its console only (a web app with its own login; its billing page, https://stream.estate/console/billing): the euros deposited, pay as you go, and « API items returned », the
items billed since the account opened. `costs account <€ deposited> <items>` keeps the console's figures, `costs topup
<€>` money added; the balance is the deposit less those items and the ones the log counted since, at `eur_per_credit`.

| Route | Use | Cost |
|---|---|---|
| `GET /documents/properties` | Listings of the zone, counts, refresh | 1 credit per item returned; `itemsPerPage=0` (a count) returns none |
| `GET /documents/properties/{id}` | One listing read again (`reread`) | 1 credit (one item) |
| `GET /indicators/price_per_meter` | The zone's asking €/m² (`market`) | Unknown |
| `DELETE /searches/{id}` | Deleting an alert of skill-immo 1.6 or before | Unknown |

Not used: `similar-properties`,
`/indicators/points_of_interest` (Overpass does it), `/public/location-autocomplete` and `/cities` (the zones are the
engine's own), `GET`, `POST`, `PUT /searches` and `/webhook-tester` (the saved searches, below).

## GET /documents/properties

The filters used: `transactionType=0` (sale), `propertyTypes[]` (apartment `0`, house `1`, building `2`, parking `3`,
office `4`, land `5`, shop `6`), `budgetMin`/`budgetMax`, `surfaceMin`/`surfaceMax`, `roomMin`/`roomMax`,
`landSurfaceMin`, `energyCategories[]`, `excludedProperties[]` (property uuids), `expired`, `fromUpdatedAt`,
`fromExpiredAt`, `fromDate`/`toDate` (the property's `createdAt`), `itemsPerPage` (30 at most), `page`, `order[updatedAt]=desc`. The zone is one of:
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
- **The fetched ones left out**: the property's `createdAt` never changes. `fromDate` and `toDate` take a full ISO
  date, both included, to the second, and a listing's `published_at` matched its `createdAt` for all 75 of a search
  (free counts, 2026-11-02). So the fetched ones are split into windows of creation dates, newest first, each with as
  many `excludedProperties[]` as its URL holds: one query per window, none of them ever back as new, so never paid
  twice. A fetch over several windows first checks, free, that they add up to the exact count (everything, less what
  each window's ids take off it), else it refuses.
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

**Gone listings.** The v1 rarely sets `expired` when an advert leaves its portal, so a fetch pays for ghosts too: on
2026-11-02, Louveciennes (75 flats online by the v1's rule), every advert not crawled (`lastCrawledAt`) for 50 days or
more answered `410 Gone` or « ad-not-found », those crawled within 14 days `200`. The engine takes an advert not crawled
for 30 days when read as gone, and a property without any advert left as `EXPIRED` (16 of the 75 that day). Later, the
dashboard server reads each advert's page once a day (free): `404`, `410` or a redirect to a « not found » page marks it
gone; Leboncoin, SeLoger, Le Figaro and PAP answer `403` to it, unknown. `reread` (1 credit a listing) reads them again.

**Photos.** The property's `pictures` and each advert's are Stream Estate's copies, 1 to 5; each advert's
`picturesRemote` is its portal's whole gallery (10 to 20 photos, 2026-11-02), which loads from the dashboard while the
advert is online and answers `404` once it is gone. The engine keeps the gallery of the advert online with the most,
and the copies aside.

What the engine makes of it (`fromStreamEstate`): the DPE class most adverts give (one portal often mistypes it), one
publisher per phone number, the `price` events of all the adverts once each as the price history, the features from
the adverts' free text (true when listed, else unknown). There is no address, no IRIS, no transaction status (under
offer), no property tax and no urgent flag.

## GET /indicators/price_per_meter

The same filters (the engine sends the type, the zone and `fromDate`, two years back) and `aggregationInterval=month`.
Returns `[{ average, average_min, average_max, median, series: { "2026-10": 5063.61, … } }]`: the asking €/m² of the
listings created in the period, expired ones included. Rue Paul Bert, flats, 2026-10-28: median 4,805, average 5,054.

## Searches (alerts): no longer made

A v1 saved search (`POST /searches`, a `budgetMax` required) pushes each match and each price event as a POST to an
HTTPS URL (`endpointRecipient`, `eventEndpoint`). It keeps no history of its pushes and has no route to read them back,
and the dashboard server listens on 127.0.0.1 only: a push would need a relay on the internet. skill-immo 1.6 and before
pushed them to a random ntfy.sh topic; since 1.8 the alerts are the dashboard's (`alerts.json`), fed by the server's
free counts instead:
- the listings of the zone not fetched yet: `expired=false`, `fromUpdatedAt` 90 days back, the fetched ones excluded;
- the fetched ones that changed since the last refresh: the refresh's two queries (`fromUpdatedAt`, then
  `expired=true&fromExpiredAt=`, the dropped ones excluded, as the refresh does), less the same with the fetched ones
  excluded (over their windows).

Each is a count (`itemsPerPage=0`): no item, no credit. They say how many, not which: the refresh (paid per item) does,
by hand (« Suivi »'s bar) or by the automatic fetch the user turns on in « Réglages », within its monthly credits.

`alert delete -p <slug>` deletes the saved searches an old search holds (`DELETE /searches/{id}`, then a `404`), checked
with the key on 2026-10-28.
