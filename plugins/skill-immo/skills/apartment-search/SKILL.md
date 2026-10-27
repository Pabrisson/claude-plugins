---
name: apartment-search
description: Helps the user buy a flat in France. Finds the flats for sale around an address, a street or a neighborhood, weighs each against the real sales (DVF), its building (DPE, condominium, risks), its neighborhood (shops, schools, transport, travel times, crime, income) and the user's budget, and opens a local dashboard. Listings come from the Stream Estate API (paid, with the user's yes on every credit) or, without it, from WebSearch, one WebFetch per listing page, or pasted text. Use it whenever the user looks for a flat or an apartment to buy, gives an address or a listing to assess ("trouve-moi un appartement", "cherche un T3 rue …", "analyse cette annonce", "ajoute cette annonce", "ça vaut combien", "marge de négociation", "achat immobilier"), or pastes "apply this feedback" from the dashboard.
argument-hint: "[setup | <adresse | rue | quartier> [critères] | add <url | texte> | refresh [<slug>] | alert … | dashboard [<slug>] | apply this feedback …]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/engine/immo.mjs *)
---

# Apartment search

You help the user buy a flat in France. A search starts from an address, a street or a neighborhood. You find the flats
for sale there, and the local engine weighs each one:

- against the real sales (DVF);
- against its building: DPE, condominium, risks;
- against its neighborhood: shops, schools, transport, travel times, crime, income;
- against the user's budget.

The user then works in a local dashboard, and its feedback comes back to you as a pasted prompt.

`immo.mjs` below means `node ${CLAUDE_SKILL_DIR}/engine/immo.mjs`. References are in `${CLAUDE_SKILL_DIR}/references/`;
read the one a step names before doing that step.

Everything lives in the folder Claude Code runs in, the searches folder (`$IMMO_DIR` overrides it):
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
- `stream-estate: on|off`: whether the key is set. Off means every search is classic.
- `credits: …`: what was spent. Say it when the user is about to spend more.
- `profile: none yet`: the budget needs `setup`. Offer it, but do not block a search on it.

## Credits: the user's yes before every one

Stream Estate costs 0.01 € a credit (the profile's `eur_per_credit`). Every command that may cost does three things:
- it estimates first;
- it stops with **exit code 2** and the estimate (credits, €, what is left of the monthly cap);
- it runs only once you pass the user's answer back.

1. Run the command without `--spend`, or with `--estimate` for a JSON estimate.
2. Ask the user with AskUserQuestion. Give the credits, the euros and what is left of the cap. Recommend the smallest
   useful option, for example `--max 30` before 100.
3. Only after a yes, run it again with `--spend <credits>` (and `--max` if they chose fewer).

Three cases need the user's own words before you add the flag:
- **Unknown cost**: a route not measured yet says `unknown cost`. Say « coût inconnu » and ask. Pass
  `--accept-unknown` only after a yes.
- **Monthly cap**: never pass `--force` unless the user explicitly agrees to go over it, in this conversation, for
  this call.
- **A yes is for one call**: it covers that call only. A refresh next week asks again.

The other exit codes:

| Exit code | Meaning | What you do |
|---|---|---|
| 3 | No credits left (402, neither served nor charged), or no key | Say so, then go on in the assisted mode |
| 4 | Stream Estate does not know the URL (not charged) | Read the page with WebFetch, then `add --file` |

## Listings without Stream Estate: the assisted mode

In a classic search, or after an exit 3, you find the listings yourself:
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
| `refresh [<slug>]` | What changed: new listings, price drops, offers, expiries |
| `alert …` | Create, list or turn off a Stream Estate alert |
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

1. **Place**: if the place is ambiguous (a street name in several towns, "Croix-Rousse"), run `immo.mjs geocode "<q>"`
   and ask which one.
2. **Zone and mode**: ask in one AskUserQuestion call what the request leaves open.
   - The zone, always a polygon:
     - for a street, a band along the whole street, `--radius` on each side (300 m by default). Its ends come from the
       street's DVF sales and address numbers;
     - for an address, a circle around it (`--radius`: 500 m by default, 300–1000);
     - the commune or arrondissement (`--zone commune`);
     - the IRIS (`--zone iris`);
     - with the key, a neighborhood of Stream Estate (`--zone division --division <id>`).
   - The mode, when the key is on: « Stream Estate (annonces de tous les portails, payant) » first, then « Classique
     (open data et annonces assistées, gratuit) ». It goes in `--mode`.
3. **Criteria**: put the ones the request gives in `--criteria "budget_max=450000 rooms_min=3 dpe_max=D elevator=true"`.
   The keys are `budget_min`, `budget_max`, `area_min`, `area_max`, `rooms_min`, `rooms_max`, `floor_min`, `dpe_max`,
   `elevator` and `outdoor`. Do not ask for criteria the user did not mention.
4. **Search**: `immo.mjs search "<q>" --mode … [--zone …] [--radius …] [--criteria …]`. This is free. It prints the sold
   €/m² of the zone, the street and the commune, the neighborhood, and in Stream Estate mode the count and the
   estimate.
5. **Listings**:
   - Stream Estate mode: the credits rule above, then `immo.mjs fetch -p <slug> --spend N [--max N]`. Then offer
     `immo.mjs market -p <slug>` (asking prices and reconciled sales, unknown cost until measured).
   - Classic mode: the assisted mode.
6. **Dashboard**: `immo.mjs dashboard -p <slug> --open`. Give the user its URL.
7. **Summary**: say in a few lines how many listings there are, the zone's sold €/m², the two or three listings
   that stand out and why (below the market, a recent drop, a long time online), and what is missing (no profile, no
   DVF in Alsace-Moselle…).

## add

- **A URL, Stream Estate mode**: `immo.mjs add -p <slug> --url <url>` (2 credits, through the credits rule). On exit 4,
  read the page with WebFetch.
- **A URL, classic mode**: read the page with WebFetch.
- **Text**: the assisted mode, with `--source pasted`.

Without a search, ask which search it goes to, or start one from the listing's address.

## refresh

`immo.mjs refresh -p <slug>`. It refreshes the free data, then, in Stream Estate mode, asks for what changed since the
last refresh (the credits rule; it pays only for what changed).

Report the new listings, the price drops (old → new), the offers and the expiries. For assisted listings, offer to
recheck the ones the user follows, one WebFetch each.

## alert

1. Run `immo.mjs alert forecast -p <slug>`. It is free and gives the expected notifications per day.
2. Say it, and ask whether to create the alert (unknown cost). Then run `alert create -p <slug> --accept-unknown
   [--drop 3]`.
3. By default the alert pushes to a random **ntfy.sh** topic. Give the user its name: they subscribe in the ntfy app,
   and whoever knows the topic can read it. `--webhook <https url>` sends to their own endpoint instead.
4. `alert events`, `on`, `off` and `delete` work on the search's alert. `alert list` lists the account's alerts.

## Analyse and compare

`immo.mjs show -p <slug> --id <id[,id…]>` prints, per listing, what the dashboard computes:
- the market badge against the sold €/m² (`reference.scope` says which: recent zone, zone or commune);
- the negotiation range and its reasons;
- the days online, the drops already made;
- the budget against the profile (total, loan, monthly payment, debt ratio, HCSF 35 %, down payment needed);
- the building: the registry DPE, the condominium, the risks, the sales in the same building;
- what is within 500 m, and the travel times.

`immo.mjs enrich -p <slug> --id <id>` fetches the building data again. In Stream Estate mode, `--resolve` first asks
for the exact address (beta, unknown cost: ask). Show a resolved address only when its `shown` is `address`; say
« adresse probable » for `probable`.

Answer with the numbers, then a plain verdict. Below, at or above the market, and why. What to check at the visit: the
DPE against the registry, the condominium's lots and syndic, a G or F (it can no longer be let from 2025 or 2028), the
risks. The negotiation margin, as a range.

## apply this feedback

The dashboard's « Copier le prompt » gives:

```
apply this feedback (recherche <slug>)
1. [affiner] rooms_min=3 dpe_max=D — <the user's words>
2. [analyser] <id> — <a short description>
3. [comparer] <id>, <id>
4. [ajouter] <url or text>
5. [question] <free text>
```

Do every item in order:
- `[affiner]`: `search -p <slug> --criteria "…"`, then, in Stream Estate mode, the credits rule for a new fetch. The criteria
  filter the dashboard's list and the next fetches; they delete nothing. In `show`, a listing outside them has
  `matches: false`, and one whose value is unknown (a missing DPE) still matches.
- `[analyser]`: `show --id`, and `enrich --id` if it has no building data.
- `[comparer]`: `show --id a,b`, and a table of the 2 to 4 listings.
- `[ajouter]`: the add mode.
- `[question]`: answer it.

Then say in one line per item what you did, and tell the user to reload the dashboard.

## Common mistakes

| Mistake | Instead |
|---|---|
| Running `fetch --spend 100` because the estimate said 100 | Ask first, and offer fewer (`--max 30`) |
| Passing `--accept-unknown` or `--force` "to save a round trip" | Ask; an unknown cost is the user's call |
| WebFetching a SeLoger or Leboncoin results page to list flats | WebSearch, then one listing page at a time |
| Filling a missing DPE or floor from a guess | Leave it out of the JSON |
| Showing a `MEDIUM` or `LOW` resolved address as the address | « adresse probable » |
| Calling a flat a bargain on the street's median alone | Use `show`'s `reference`, and say its scope and count |
