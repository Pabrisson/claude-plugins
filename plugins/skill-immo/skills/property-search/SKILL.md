---
name: property-search
description: Helps the user buy property in France (a flat, a house, a plot, a parking, a shop or office). Finds what is for sale around an address, a street or a neighborhood, weighs each against the real sales of its type (DVF), its building, neighborhood, rent and the user's budget, writes offer letters, and opens a local dashboard. Listings come from the Stream Estate API (paid, the user's yes on every credit) or from WebSearch, one WebFetch per listing page, or pasted text. Use it whenever the user looks for property to buy, gives an address or a listing to assess, wants an offer or a message to a seller, or wants to be told of what comes up ("trouve-moi un appartement", "cherche une maison à …", "un terrain", "une place de parking", "analyse cette annonce", "ça vaut combien", "marge de négociation", "rédige une offre", "préviens-moi d'un nouveau DPE rue …", "crée une alerte", "quelle est la parcelle", "que dit le PLU", "j'ai rajouté 30 € sur Stream Estate", "achat immobilier"), or pastes "apply this feedback" from the dashboard.
argument-hint: "[setup | <adresse | rue | quartier> [type] [critères] | add <url | texte> | refresh [<slug>] | alerte … | dashboard [<slug>] | apply this feedback …]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/engine/immo.mjs" *), Bash(node ${CLAUDE_SKILL_DIR}/engine/immo.mjs *)
---

# Property search

You help the user buy property in France: a flat (`flat`), a house (`house`), a plot (`land`), a parking (`parking`), a
shop or an office (`premises`). A search starts from an address, a street or a neighborhood, for one or several of
these types. You find what is for sale there, and the local engine weighs each listing:

- against the real sales of its type (DVF): a house against houses, a parking against parkings;
- against its building: DPE, condominium, risks;
- against its neighborhood: shops, schools, transport, travel times, crime, income;
- against the rent of the same home (carte des loyers) and the user's budget.

It gives each listing a review (strong points, points to watch, questions to ask, each with its source) and a score out
of 100 weighted by the user's priorities. You write the messages the user sends (an offer, questions, a visit request, a
reply, a reminder, a request for documents), from each listing's conversation with the agency or the seller.
The user then works in a local dashboard, and its feedback comes back to you as a pasted prompt.

`immo.mjs` below means `node "${CLAUDE_SKILL_DIR}/engine/immo.mjs"`, the path in double quotes (it can hold spaces or, on
Windows, backslashes); the skill runs on macOS, Linux and Windows. References are in `${CLAUDE_SKILL_DIR}/references/`;
read the one a step names before doing that step.

Any agent can run this skill: `${CLAUDE_SKILL_DIR}` is this skill's folder, the one holding this SKILL.md (an agent that
does not replace it uses that folder's path); AskUserQuestion is your tool for multiple-choice questions to the user
(none: numbered choices in the chat, then wait for the answer); WebSearch and WebFetch are your web search and
page-reading tools. The Stream Estate key is `$STREAM_ESTATE_API_KEY`: Claude Code's `/plugin configure
skill-immo@pabrisson` exports it, any other agent reads it from the environment.

Everything lives in the folder you run in, the searches folder (`$IMMO_DIR` overrides it):
- one folder per search (`<slug>/`);
- `.profile.json`, the buyer's profile;
- `.cache/`, the open data and the credits log.

Pass `-p <slug>` to every search command.

The first search writes the folder's `.gitignore` (or adds the skill's lines to the existing one). Git keeps:
- the searches, with the listings and the user's statuses and notes;
- the measured prices;
- the credits log.

It leaves out the cache, what the engine computes again (`market.json`, `area.json`) and `.profile.json`, which holds
the user's income. `doctor` warns when git would version the cache or ignore a search. Never commit for the user.

Talk to the user in French. Write code and files in English. The dashboard is in French.

## Before anything

Run `immo.mjs doctor` once per conversation.
- `MISSING`: show the user the fix it prints, and stop.
- `stream-estate: on|off`: whether the key is set and the API is on (the dashboard's « Réglages » can turn it off).
  Off means no search calls the API: the assisted mode.
- `credits: …`: what was spent. Say it when the user is about to spend more.
- `account: …`: Stream Estate shows the account in its console only (https://stream.estate/console/billing), never through the
  API: the euros deposited (pay as you go) and « API items returned », the items billed since the account opened
  (0.01 € each). `account: about 4,96 € left (496 items)` is the deposit less those items and the ones the log counted
  since; say it with the estimate before a fetch. When the user gives the console's figures, `immo.mjs costs account
  <€ deposited> <items>`; when they say they added money, `immo.mjs costs topup <€>` (it needs the account first). The dashboard's « Réglages »
  does the same.
- `profile: none yet`: the budget needs `setup`. Offer it, but do not block a search on it.

## Credits: the user's yes before every one

Stream Estate (API v1) bills each item a call returns, 0.01 € pay as you go: the engine calls it a credit (the
profile's `eur_per_credit`). A count returns no item, so it is free. Every command that may cost does three things:
- it estimates first;
- it stops with **exit code 2** and the estimate (credits, €, what is left of the monthly cap);
- it runs only once you pass the user's answer back.

1. Run the command without `--spend`, or with `--estimate` for a JSON estimate.
2. Ask the user with AskUserQuestion. Give the credits, the euros and what is left of the cap. Recommend the smallest
   useful option, for example `--max 30` before 100.
3. Only after a yes, run it again with `--spend <credits>` (and `--max` if they chose fewer).

One spending needs no yes from you: the dashboard's **automatic fetch** (« Réglages », off by default), which the user
turns on with a monthly budget of credits. The server's watch then refreshes the searches in Stream Estate mode within
that budget and the monthly cap; its calls are logged `by: auto`. Never turn it on or raise its budget yourself.

Three cases need the user's own words before you add the flag:
- **Unknown cost**: a route whose price is not known yet (`market`, `alert delete`) says `unknown cost`. Say « coût
  inconnu » and ask. Pass `--accept-unknown` only after a yes. Its real price shows in Stream Estate's console; the
  user may set it with `immo.mjs costs set "<route>=<credits>"`.
- **Monthly cap**: never pass `--force` unless the user explicitly agrees to go over it, in this conversation, for
  this call.
- **A yes is for one call**: it covers that call only. A refresh next week asks again.

The other exit codes:

| Exit code | Meaning | What you do |
|---|---|---|
| 3 | No credits left (402), no key, or the API turned off in « Réglages » | Say so, then go on in the assisted mode |
| 4 | A listing URL (the API has no lookup by URL) | Read the page with WebFetch, then `add --file` |

## Listings without Stream Estate: the assisted mode

In an OpenData search, or after an exit 3, you find the listings yourself:
- **WebSearch**: for example `appartement à vendre "rue Paul Bert" Lyon 3e` or `T3 vente Lyon 3e Guillotière`.
- **WebFetch**: of **one listing page** at a time, the ones the user wants, or the best WebSearch hits (5 to 10 at
  most).
- **Pasted text**: what the user pastes.

Never fetch a portal's search or results pages, never page through a portal, never fetch the same portal in a loop.
SeLoger, Leboncoin, PAP, Bien'ici and the others forbid scraping in their terms and protect themselves with DataDome. A
blocked page (captcha, 403) is not retried: ask the user to paste the text.

Read `references/listing-format.md`. Write what each listing states in a JSON file in the scratchpad, then run
`immo.mjs add -p <slug> --file <file>`; add `--source pasted` for a pasted text. Never invent a field. A price per m²,
a floor or a DPE the page does not give stays out.

## Modes

The first word of `$ARGUMENTS` picks the mode. Anything else is a new search.

| Arguments | Mode |
|---|---|
| `setup` | The buyer's profile |
| `add <url \| texte>` | Add one listing |
| `refresh [<slug>]` | What changed: new listings, price drops, offers, expiries (`references/follow-up.md`) |
| `alert …`, `alerte …` | The search's alerts: list, make, change or turn off one (`references/follow-up.md`) |
| `dashboard [<slug>]` | Reopen the dashboard |
| `apply this feedback …` | Apply the prompt copied from the dashboard |
| anything else | A new search: `<adresse \| rue \| quartier> [critères]` |

## setup

Ask in one or two AskUserQuestion calls what the request does not give: the down payment, the monthly net income, other
monthly loan payments, the rate and the length (25 years by default), the monthly credit cap (500 by default). Then add
the key places (work, school…) one by one.

```
immo.mjs setup set down_payment=60000 net_income_monthly=5200 rate=3.4 years=25 monthly_credit_cap=300
immo.mjs setup place add Travail "Place Bellecour, Lyon"
```

The profile also holds `notary_old` (0.075), `notary_new` (0.025), `insurance_rate` (0.3 %), `other_loans_monthly` and
`eur_per_credit` (0.01). `immo.mjs setup` shows it. It stays on this machine. Places change the travel times: run
`search -p <slug>` again on the open searches.

## A new search

The dashboard's « Nouvelle recherche » starts nothing itself: it copies a prompt `nouvelle recherche : <place>` with
the lines `- zone`, `- types`, `- annonces` (the mode) and `- critères` (their engine form in parentheses). It answers
steps 1 to 3 (the place comes from the address autocomplete): preview the zone (step 4), then run `search` with them
and ask nothing it gives.

1. **Place**: if the place is ambiguous (a street name in several towns, "Croix-Rousse"), run `immo.mjs geocode "<q>"`
   and ask which one.
2. **Zone and mode**: ask in one AskUserQuestion call what the request leaves open.
   - The zone, always a polygon:
     - for a street, a band along the whole street that follows its bends (its line in IGN's BD TOPO), `--radius` on
       each side (300 m by default). Without a known line, a straight band between its farthest DVF sales and
       address numbers;
     - for an address, a circle around it (`--radius`: 500 m by default, 300–1000);
     - the commune or arrondissement (`--zone commune`);
     - the IRIS (`--zone iris`);
     - the zone the user drew on the dashboard's map (`--zone drawn`), only from a `[zone]` item (below).
   - The mode, when the key is on: « Stream Estate (annonces de tous les portails, payant) » first, then « OpenData
     (open data et annonces assistées, gratuit) ». It goes in `--mode stream-estate|classic` (`classic` is OpenData).
   - The types, when the request does not say (« un bien », « investir »): a multiple-choice question, « Appartement »
     first. « un T3 », « un appartement » is a flat; « une maison », « un terrain », « un parking » or « un box », « un
     local » or « des bureaux » need no question. They go in `--types flat,house` (flat by default).
3. **Criteria**: put the ones the request gives in `--criteria "budget_max=450000 rooms_min=3 dpe_max=D elevator=true"`.
   The keys are `budget_min`, `budget_max`, `area_min`, `area_max`, `rooms_min`, `rooms_max`, `floor_min`, `land_min`
   (m² of land), `dpe_max`, `elevator` and `outdoor`. Each applies to the types that have it: rooms, DPE and outdoor to
   homes, floor and elevator to flats, land to houses and plots; a parking takes only the budget. Do not ask for
   criteria the user did not mention.
4. **Zone preview**: first `immo.mjs search "<q>" … --preview`, with the step 5 arguments. It is free, creates no
   search and prints the zone, its km² and a PNG of it on the Plan IGN. Read that PNG (it shows the image) to check it is
   the place asked for. Give the user its path as a link, then ask « La zone convient ? » in one AskUserQuestion call,
   naming the zone and its km²: « Oui, lancer la recherche » first, then « Agrandir », « Réduire », « Autre zone
   (commune, IRIS…) ». A change makes a new preview; only a yes goes on to step 5. Changing an existing search's zone
   (`--zone`, `--radius`) is previewed the same way (`search -p <slug> … --preview`), except `--zone drawn`: the user
   drew it.
5. **Search**: `immo.mjs search "<q>" --mode … --types … [--zone …] [--radius …] [--criteria …]`. This is free. It
   prints, per type, the sold unit price of the zone, the street and the commune (€/m², €/m² of land for a plot, € a
   lot for a parking), the rent, the property tax rate, the homes authorised, the neighborhood, and in Stream Estate
   mode the count and the estimate.
6. **Listings**:
   - Stream Estate mode: the credits rule above, then `immo.mjs fetch -p <slug> --spend N [--max N]`. The API has no
     filter on the floor, the elevator or an outdoor space: with those criteria, `search` says the count includes
     listings they rule out, and you pay for them too. Then offer `immo.mjs market -p <slug>` (the zone's asking price
     per m², month by month; unknown cost).
   - OpenData mode: the assisted mode.
7. **Dashboard**: `immo.mjs dashboard -p <slug> --open`. Give the user its URL. A listing has its own page there,
   `<URL>annonce/<id>/`: link it when you speak of one listing.
8. **Summary**: say in a few lines how many listings there are, the zone's sold €/m², the two or three listings
   that stand out and why (below the market, a recent drop, a long time online), and what is missing (no profile, no
   DVF in Alsace-Moselle…).

## add

- **A URL**: read the page with WebFetch, then `add --file`. `immo.mjs add -p <slug> --url <url>` only says whether the
  search already holds it (exit 4 otherwise): the API cannot look a listing up by its URL. In Stream Estate mode, a
  later fetch finds the same listing on the portals and merges it with yours by its URL.
- **Text**: the assisted mode, with `--source pasted`.
- **Typed by hand**: the dashboard's « Ajouter » → « Ou saisir l'annonce à la main » adds it itself, as `add --file`
  does (`source: manual`, id `m-…`, free): nothing for you to do.

Without a search, ask which search it goes to, or start one from the listing's address.
## refresh, alert and the watch

Read `references/follow-up.md` and follow it: `refresh`, `reread` (listings read again, 1 credit each: their full
photos, the gone ones expire), the alerts (make, change or turn off one), the « Prospection » map and its odds, the
dashboard server's free watch, its daily link check and its news.

## A listing's address: « Préciser l'adresse »

The dossier places a listing by hand itself (a pin, the address shown), or copies a prompt `osint : où a été prise cette
photo ? … (recherche immo <slug>)` for the OSINT skill (skill-osint): it geolocates the photos, then moves the listing
with `immo.mjs locate -p <slug> --id <id> --at <lat,lon> --osint <case> --confidence high|medium --radius <m> [--address
"<number street>"]` (free; without an address, the address base's at the point), only for a point found with a medium
or high confidence. The building data are read again at the new place. Nothing is lost: the source's place waits in
`location_source`, a refresh never moves the listing back, `locate --reset` (« Revenir à l'origine ») does.

## Analyse, compare and messages

Read `references/analyse-and-messages.md` and follow it: what `show` gives, how to answer on a listing or the market,
a message received, a message to write (an offer, questions, a visit, a reply, a reminder, documents), the documents of a
conversation (a summary, a question on them), a parcel (its
cadastre, urban plan and sales: `cadastre`).

A listing's « Mes notes » are its memory, the user's and yours: read them (`show`) before any answer or work on that
listing, and keep there, without asking, what you learned of it, in Markdown (« The notes » in that reference).

## Other public data: the data.gouv.fr MCP

The engine covers the open data it needs. When a data.gouv.fr MCP server is connected (its tools search the datasets
and query their tables), use it for a question the engine does not answer: a local dataset, a newer edition, the
noise maps, the sales of plots in the next town. Name the dataset and its date in your answer. The
engine stays the source for what it computes: never replace its numbers with yours.

## apply this feedback

The dashboard's « Copier le prompt » gives:

```
apply this feedback (recherche <slug>)
1. [affiner] rooms_min=3 dpe_max=D elevator= types=flat,house mode=classic — <the same in words>
2. [élargir] zone : tout le quartier (IRIS Moncey)
3. [zone] dessinée sur la carte (14 sommets)
4. [annonces] cherche de nouvelles annonces sur l'API (crédits avec mon accord) et sur le web
5. [analyser] <id> — <a short description>
6. [comparer] <id>, <id>
7. [message] offre pour <id> — <a short description> : rédige une offre d'achat (…) ; montant : 250 000 € ; consigne : …
8. [ajouter] <url or text>
9. [chercher] l'annonce du DPE <number> : maison 204 m², DPE D du 19 oct. 2026, <address>
10. [question] <free text>
11. [parcelle] étudier la parcelle DN 68 (69383000DN0068), Lyon 3e, 990 m²
12. [documents] résumé pour <id> — <a short description> : « PV AG 2025.pdf » (d-1a2b3c4d) ; points : … ; consigne : …
```

`(sans recherche)` in place of `(recherche <slug>)`: the dashboard's page without a search (« Explorer » on its home
page), with only `[parcelle]`, `[chercher]` and `[question]` items. No slug: a `[chercher]` listing found is given
by its link, with the offer to create a search there (`add` needs one).

Do every item in order:
- `[affiner]`: what the user changed in the dashboard's « Critères » (only that): `search -p <slug> --criteria "…"` with
  the criteria (`k=` drops one), `--types` with `types=` and `--mode` with `mode=` when present. Then, in Stream Estate
  mode, the credits rule for a new fetch. The criteria filter the dashboard's list and the next fetches; they delete
  nothing. In `show`, a listing outside them has
  `matches: false`, and one whose value is unknown (a missing DPE) still matches.
- `[élargir]`: widen the search as it says, free: `search -p <slug>` with `--zone iris|commune`, `--zone radius --radius
  <m>` (a new zone previewed first, step 4), `--criteria "budget_max=…"` (an empty value drops a criterion:
  `elevator=`) or `--types flat,house,parking`. A prompt holds one zone at most. Several `[élargir]` items make one `search` call. Two need no engine change:
  - « inclure le neuf »: look for new-build programmes and off-plan sales (VEFA) of the zone too, the assisted way;
  - « chercher aussi chez les notaires et les agences du quartier »: WebSearch the notaries' listings
    (immobilier.notaires.fr) and the local agencies' sites, then one listing page at a time, as in the assisted mode.
  Then look for the new listings: in Stream Estate mode the count is free and a fetch goes through the credits rule; in
  OpenData mode, the assisted mode. Say what the wider search brings.
- `[zone]`: the outline the user drew on the dashboard's map (« Modifier la zone »), kept as the search's draft:
  `search -p <slug> --zone drawn` (free), alone or with the `[élargir]` items' criteria (it replaces their zone). Then
  the new listings as for `[élargir]`. Say the zone changed; the dashboard shows « Recharger ».
- `[annonces]`: the header's « Annonces ». « sur l'API … et sur le web »: in Stream Estate mode, `fetch -p <slug>` without
  `--spend` counts for free and stops on the estimate (exit 2): the credits rule, then `fetch --spend`; then the assisted
  mode, 5 to 10 listing pages at most. « sur le web » (no key, an OpenData search or the API off): the assisted mode only. Say what each brought.
- `[analyser]`: `show --id`, and `enrich --id` if it has no building data; answer as `references/analyse-and-messages.md`
  says, on the `axes` and the `consigne` it gives first.
- `[comparer]`: `show --id a,b`, and a table of the 2 to 4 listings (`references/analyse-and-messages.md`).
- `[message]`: `references/analyse-and-messages.md`, « Messages and the conversation ». What follows « ; » is the
  user's: the amount, the validity, the financing, the availabilities, the documents or questions to ask, a `consigne`.
- `[documents]`: a summary of the conversation's documents, or a question on them: `references/analyse-and-messages.md`,
  « The conversation's documents ».
- `[ajouter]`: the add mode.
- `[chercher]`: a recent DPE of the map that no listing matches, or an energy audit (`l'annonce de l'audit énergétique
  <number> : maison 57 m², classe F…`; « immeuble entier » for a whole building). Look for its listing the assisted way: WebSearch its
  street and town with the type and surface (`maison 204 m² "rue de l'Etang" Louveciennes à vendre`), then one listing
  page at a time, 5 at most. Found: `add --file`; its DPE
  then matches it on the map. Not found: say so in one line (not online yet, sold off the portals, or let).
- `[question]`: answer it.
- `[parcelle]`: a parcel (or several, « étudier ensemble ») of the « Cadastre » tab: `immo.mjs cadastre <IDU>` for each, then
  the study as `references/analyse-and-messages.md` « A parcel » says.

Then say in one line per item what you did. The open dashboard sees the change within seconds and shows « Recharger »:
no need to tell the user to reload it.

## Common mistakes

| Mistake | Instead |
|---|---|
| Running `fetch --spend 100` because the estimate said 100 | Ask first, and offer fewer (`--max 30`) |
| Passing `--accept-unknown` or `--force` "to save a round trip" | Ask; an unknown cost is the user's call |
| WebFetching a SeLoger or Leboncoin results page to list flats | WebSearch, then one listing page at a time |
| Filling a missing DPE or floor from a guess | Leave it out of the JSON |
| Giving a Stream Estate listing's point as its address | Say « autour de » the street; the address is unknown, unless `show`'s `located` says who placed it (the user, an OSINT case and its confidence): say so |
| Calling a flat a bargain on the street's median alone | Use `show`'s `reference`, and say its scope and count |
| Weighing a house or a parking against the flats' prices | Each type has its own reference in `show`; say which |
| An offer above the asking price, or with an argument the data does not hold | The negotiation range and `review` only |
| Telling the user the message was sent, or marking it sent | You write it; the user sends it and marks it in the dossier |
| Writing `alerts.json` by hand, or dropping the other alerts | `alerts -p` first, then the whole file through `alerts --file` (it checks it) |
| A Stream Estate saved search (ntfy) for « préviens-moi » | A dashboard alert: free, local, and it can watch a street outside the zone |
| Setting the account from a guess | Only the console's figures the user gives: `costs account`, `costs topup` |