# Following a search: refresh, the watch, alerts

Read it before `refresh`, an `alert …` (« préviens-moi… », « crée une alerte »), a question on the « Prospection » map,
its odds or the dashboard's news and watch. `immo.mjs` means `node "${CLAUDE_SKILL_DIR}/engine/immo.mjs"`, as in SKILL.md; the credits rule and the
assisted mode are SKILL.md's.

Contents: refresh (DPE, energy audits, building permits, alerts, « Prospection ») · the dashboard server's watch · alert · `alerts.json`

## refresh

`immo.mjs refresh -p <slug>`. It refreshes the free data, then, in Stream Estate mode, asks for what changed since the
last refresh (the credits rule; it pays only for what changed).

Report the new listings, the price drops (old → new), the offers and the expiries. For assisted listings, offer to
recheck the ones the user follows, one WebFetch each.

A refresh only brings what Stream Estate changed: a listing that left the portals quietly stays online until the
dashboard server's daily link check finds its pages gone (free; Leboncoin and SeLoger never answer it). To check some
at once, or to get their full photo galleries (listings fetched before 1.20 have 1 to 5 photos),
`immo.mjs reread -p <slug> [--id <id,…>]`: each listing read again, 1 credit each (the credits rule), those still online
and not dropped without `--id`; the ones gone expire. The dashboard's list offers it on the rows ticked (« Relire sur l'API »).

Its DPE line counts the zone's DPE of the last 12 months, those no listing matches and the new ones since the last
refresh: `recent DPE (12 months): 178, 177 without a listing, 3 new since the last refresh`. A DPE comes before a sale or
a lease, so a recent one without a listing may be a home about to go on sale (ADEME does not say which). Say the new ones
in one line; the dashboard's « Prospection » map rings them (layer « DPE récents »), and they go to its news. Two lines
follow, `energy audits (12 months): 15, 1 new since the last refresh` and `building permits (12 months): 4, …`:
- an energy audit is due to sell a house or a whole building rated E, F or G (it is also made for a renovation grant,
  and ADEME does not say which): a new one is a strong sign of a sale, say it;
- a permit is a demolition (a plot or a programme to come), homes built (a house divided, a new-build programme to buy
  off-plan, or works next door) or a plot divided: say the new ones.

Its last line, `alerts: « DPE rue Paul Bert » 2`, names the user's own alerts that fired: say them.

The « Prospection » tab colors the IRIS of the map's box by the odds that a home goes on sale within 12 months (DVF
sales over the census's homes), by the sales a year after successions and separations, by their share of vacant homes
or by their sold price per m², from public figures per IRIS and commune (`references/data-sources.md`). Its IRIS card
adds the second homes, the homes built before 1946, heated with oil, and whose household moved in 10 years ago or more.
Its map shows the box's recent DPE, energy audits and building permits (never the applicant). Its « Estimations »
switch hides the rest and shows each address of the box, in the search's zone or not, with its odds of going on sale
soon (red to green): its DPE (those of one day count once), audits and permits of the last 12 months, its IRIS's sales
against its tenants moving out; in the zone, a DPE a listing has does not count. An address clicked opens its block.
« Type de bien » filters the DPE, audits and listings of both maps (never the permits).
The weights are reasoned, not measured: say so if the user takes a % for a fact. It
never names a person: if the user asks for the deaths or divorces of an address, say that no source gives them and that
joining people to homes is not allowed.

## The dashboard server's watch

A listing the user dropped (« Écarté ») is out of the follow-up: the watch, its counts and its link check skip it, a
refresh leaves it out of its queries (it pays nothing for it), and no default alert takes its changes. It stays in the
list (« Écartées »), the map and the board. Taken back (another status), only its later changes come: `reread --id` to
read it again now.

While the dashboard server runs (`dashboard` starts it, it stops once every agent it worked for has quit), it watches
every search, free: at its start, then every 6 hours (« Réglages »: off, 30 min, 1 h, 6 h, 12 h, 24 h; the header
counts down to the next one, and pauses or resumes it: a pause keeps the period). It reads the zone's new DPE that no listing matches, its new energy audits and building
permits, the same at the places of the user's alerts (outside the zone too), reloads the recent DPE and energy audits
of the search's commune that the « Prospection » and « Cadastre » maps show (as fresh as the news; their other communes
a week) and, in Stream Estate mode, counts (free,
no item returned) the listings not
fetched yet and the fetched ones that changed on the portals since the last refresh, with what « Actualiser » would
fetch (its badge: those changed and the new ones, up to the most a fetch takes). The news go to
`<slug>/feed.json`; those the search's alerts take get a desktop notification (« Réglages »: on or off, sound, quiet
hours). The counts are no news: « Suivi » shows them in a bar with « Récupérer » and « Actualiser », through the
credits dialog. In the dashboard, the bell counts what is not read and opens the latest, and « Suivi » lists the news
day by day, those of one watch folded: « Chercher l'annonce » puts a `[chercher]` item in the prompt (a DPE, an
audit), « Carte » shows a DPE, an audit or a permit on « Prospection ». The watch spends no credit, but for the
automatic fetch the user turned on.

## alert

The alerts are the dashboard's (« Alertes » tab, `<slug>/alerts.json`, free): they pick the news that reach « Suivi »,
the bell, the desktop notifications and refresh's `alerts:` line. The default ones keep the follow-up (new DPE within
the search's criteria, every new energy audit and building permit of the zone, new listings, price drops and rises,
statuses, and the expiry of a listing the user follows: one still to sort leaves the map and the cards quietly), each
on until turned off. The user adds their own: one event, a place, and conditions all true (a DPE class, a surface, a
whole building, a demolition, homes built, a price, a drop of 5 % or more, a favorite…). The listings' events happen in
the search's zone only; a new DPE, energy audit or building permit may be watched anywhere in France: a street, around
an address, a commune (ADEME and Sitadel, free).

1. `immo.mjs alerts -p <slug>` prints alerts.json, then each alert with the news it took.
2. To make, change or turn off one the user asks for (« préviens-moi d'un nouveau DPE rue Garibaldi »): read
   « `alerts.json` » below, write the whole file again (with the other alerts) in the
   scratchpad, then `immo.mjs alerts -p <slug> --file <file>`. It is checked as the dashboard's. Say in one line what it
   takes, and how many past news it took (`alerts` again); the open dashboard shows « Recharger ».
3. A place outside the zone needs its BAN id (a street: `immo.mjs geocode "<street, town>" --type street` prints `ban
   <insee>_<voie>` and its point), its commune code or its point; the server notes what is there at once, so only the
   DPE published later are news.
4. A search of skill-immo 1.6 or before may hold a Stream Estate alert (`alert` in `search.json`, pushed to ntfy.sh):
   offer to delete it, `immo.mjs alert delete -p <slug>` (unknown cost: the credits rule). Until then the dashboard
   cannot delete that search.

## `alerts.json`

- `alerts.json` (`lib/alerts.js`): which news reach « Suivi », the bell, the desktop notifications and refresh's
  `alerts:` line. A news shows when one alert that is on takes it: its event, its place, and every condition holds.
  - `off[]`: the default alerts turned off, by id: `dpe` (its condition: `criteria` is true), `new`, `price_drop`,
    `price_rise`, `status` (their condition: `my_status` is not `dropped`), `expired` (its conditions: `my_status` is
    not `none` nor `dropped`: only a listing the user follows; one still to sort leaves the map, the cards and the board
    quietly, the list keeps it), `audit`, `permit` (every new one of the zone). Each is on until turned off.
  - `custom[] { id (letters, digits, - and _), name, event, place, conditions[] { field, op, value }, enabled }`: the
    user's own, 50 at most, 10 conditions each. `event` is `dpe`, `audit`, `permit`, `new`, `price_drop`,
    `price_rise`, `status` or `expired`.
  - `place`: `{ "how": "zone" }` (the search's zone; the listings' events take this one only), or, for `dpe`, `audit`
    and `permit`, `{ "how":
    "street", "ban": "69387_3030", "label", "point" }` (the street's BAN id, `geocode` gives it), `{ "how": "commune",
    "insee": "69123", "label", "point" }` (Paris, Lyon, Marseille: their arrondissements), `{ "how": "radius",
    "radius_m": 300, "label", "point" }` (50 m to 3 km). The server reads the place's DPE or audits of the last 12
    months from ADEME, its permits from its city's (a circle: the city at its center); what an alert saw stays in
    `.cache/alerts/<slug>/<id>.json`.

  | `field` | Kind | `op` | Events |
  |---|---|---|---|
  | `street` | text | `contains`, `is` (no case, no accents) | all: the street of the address |
  | `type` | type | `is` (`flat`, `house`, `land`, `parking`, `premises`) | all but `permit` (a whole building is `flat`) |
  | `energy` | class | `lte` (A to it), `gte` (it to G) | all but `permit` |
  | `area` | number | `gte`, `lte` | all but `permit` (a whole building's own) |
  | `building` | bool | `is` | `audit`: a whole building |
  | `permit_kind` | permit | `is` (`build`, `demolish`, `develop`) | `permit` |
  | `homes` | number | `gte`, `lte` | `permit`: the homes it creates |
  | `price`, `price_per_m2`, `rooms` | number | `gte`, `lte` | the listings' |
  | `change_pct` | number | `gte`, `lte` | `price_drop`, `price_rise`: the move in % (5 = 5 %) |
  | `favorite` | bool | `is` | the listings': starred in the dashboard |
  | `my_status` | status | `is`, `not` (`none`, `to_visit`, `visited`, `offer`, `dropped`) | the listings' |
  | `criteria` | bool | `is` | all but `permit`: within the search's types and criteria |

  A value the news does not give (no address) fails the condition. Example: `{ "id": "a-garibaldi", "name": "Passoires
  rue Garibaldi", "event": "dpe", "place": { "how": "street", "ban": "69387_3030", "label": "Rue Garibaldi 69007 Lyon",
  "point": [4.8518, 45.748] }, "conditions": [{ "field": "energy", "op": "gte", "value": "F" }], "enabled": true }`.
