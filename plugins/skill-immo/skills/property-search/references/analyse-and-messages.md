# Analyse, compare and messages

Read it before analysing or comparing listings, a question on a listing or on the market, or a message received or
to write (an offer, questions, a visit, a reply, a reminder, documents). `immo.mjs` means `node "${CLAUDE_SKILL_DIR}/engine/immo.mjs"`, as in SKILL.md; the credits rule and the
assisted mode are SKILL.md's.

Contents: analyse and compare (`show`, `market.json`, the verdict) · messages and the conversation (one received, one to write) · the conversation's documents (a summary, a question) · a parcel (`cadastre`) · `market.json`

## Analyse and compare

`immo.mjs show -p <slug> --id <id[,id…]>` prints, per listing, what the dashboard computes:
- its `type`, and the market badge against the sold unit price of that type (`reference.scope` says which: recent zone,
  zone or commune);
- `favorite`: the user starred it in the dashboard. « Mes favoris » are the listings where it is true;
- `labels`: the user's free labels from the dashboard (« coup de cœur », « à rappeler »…): « mes biens à rappeler »
  are the listings carrying that label;
- `review`: the strong points and the points to watch (each with its source) and the questions to ask;
- `score`: out of 100, each part (price, budget, energy, transport, travel, outdoor) and its weight;
- `rent`: the rent of the same home, the owner's monthly cost, the gross yield, and the years before buying beats
  renting (null: renting stays cheaper over the loan); `budget.works`, the work a DPE E, F or G calls for;
- `messages`: its conversation with the agency or the seller, in order: `from: me` (yours and the user's, a draft until
  `sent_at`) or `from: them` (received: a reply the user pasted, a call summed up), with `channel` and `amount`, and
  `documents[] { id, name, size, type, path }` (the files it carries, `path` to read them; `type` below);
- the negotiation range and its reasons;
- the days online, the drops already made;
- the budget against the profile (total, loan, monthly payment, debt ratio, HCSF 35 %, down payment needed);
- the building: the registry DPE, the condominium, the risks, the sales in the same building;
- what is within 500 m, and the travel times.

For a question on the market itself, read the search's `market.json` (« `market.json` » below): per type the
price trend over 1 and 3 years, the prices by number of rooms, the streets around with their median and its move, and
`context` (the DPE classes of the zone, the property tax rate against France's, the homes authorised each year).

`immo.mjs enrich -p <slug> --id <id>` fetches the building data again. A Stream Estate listing has no address, only a
point (`location.accuracy`: `PRECISE` at the house number, `NEIGHBORHOOD` around it).

Answer with the numbers, then a plain verdict. Below, at or above the market of its type, and why. What to check at the
visit: start from `review` (its points to watch and questions), the DPE against the registry, the condominium, a G or F
(it can no longer be let from 2025 or 2028), the risks. The negotiation margin, as a range.

## Messages and the conversation

Each listing keeps its conversation with the agency or the seller. The user adds what they receive in the dossier
(« Ajouter »: a reply pasted, a call summed up), or pastes it to you.

**A message the user received** (« l'agence m'a répondu… », a call): add it to the conversation as they give it,
`immo.mjs message -p <slug> --id <id> --from them [--channel email|sms|phone|visit] [--amount <€ proposed>] [--date
<iso>] [--attach <document>]… --file <file>`, and say so in one line. `--attach` (once per file: PDF, image, Word, Excel,
text, 25 MB at most) copies a document the user gave you into the search; with documents, the text is optional.

Each document has a `type`, the one the user chose or the one its name says (`other` when it says none): `ddt` (the
whole diagnostics file), `dpe`, `asbestos`, `lead`, `electricity`, `gas`, `termites`, `risks`, `carrez`, `sanitation`,
`minutes` (PV d'AG), `charges`, `pre_sale` (pré-état daté), `rules`, `summary` (fiche synthétique), `logbook`,
`works_plan`, `tax`, `deed`, `plans`, `invoices`, `energy_bills`, `urbanism`, `boundary`, `other`. When you read one
whose type is wrong or `other` (« scan001.pdf » that is a PV d'AG), set it: `immo.mjs document -p <slug> --id <id>
<doc id> <type>`.

**A message to write**, when the user asks for one or a `[message]` item of the dashboard does:
- `offer`: an offer;
- `question`: the questions for the agency;
- `visit`: a visit request;
- `reply`: an answer to the last message received;
- `follow_up`: a reminder of the last message sent that got no answer;
- `documents`: a request for the documents (full diagnostics, the minutes of the last 3 general meetings, the
  statement of charges, the property tax notice, the pre-sale statement).

1. `immo.mjs show -p <slug> --id <id>`: the whole conversation first (what was offered, answered, promised), then the
   negotiation range, the review, the sales of the street, the notes.
2. Write it in French, short and polite, from those facts only, following on from the conversation:
   - an offer: its amount inside the negotiation range unless the user gave one; ask in one AskUserQuestion when neither
     is clear (the range's low end first). Two or three arguments the data backs (time online, drops, DPE and works,
     sales of the street), the financing in one line, how long it stays valid (10 days by default). Designate the
     property with its parcel when the listing is placed at its address: `immo.mjs cadastre -p <slug> --id <id>` prints
     the line to use (« cadastré section DN n° 68, pour une contenance de 9 a 90 ca »; a flat's is its building's,
     with « lot n° … » left for the seller to fill), « sous réserve de vérification sur le titre de propriété »;
   - a reply to a counter-offer: where it stands against the range and what the seller said;
   - questions or documents: those of `review.questions` that still matter, minus what the conversation already
     answered and the documents it already holds (their `type`; a `ddt` holds every diagnostic). The dashboard's item
     may list them (« : 1) … 2) … », « des documents suivants : … »): ask those, minus what is already there.

   What the item adds after « ; » is the user's and comes first: `montant` (the offer's amount, or a counter-offer in a
   reply), `validité` (days), `financement`, `disponibilités` and `précisions` (a visit), `questions en plus`,
   `consigne` (how to write it).

   Never sign with a name the user did not give.
3. Give the text in your answer, ready to copy. You never send anything: the user does.
4. Always ask, in one AskUserQuestion, whether to add it to the listing's conversation: « Oui, en brouillon » first,
   then « Oui, je l'ai déjà envoyé » and « Non ». On a yes, write it to a file in the scratchpad and run
   `immo.mjs message -p <slug> --id <id> --kind <kind> [--amount <€>] [--to "<who>"] [--sent] --file <file>` (`--sent`
   for « déjà envoyé »). The dossier shows it in « Conversation », with « Copier » and « Marquer envoyé »; an offer
   marked sent moves the listing to « Offre faite ».

## The conversation's documents

The user joins documents to the conversation (the dossier's « Ajouter », or you with `message --attach`): diagnostics,
minutes of general meetings, a statement of charges, a tax notice, a pre-sale statement, plans. A `[documents]` item
names some by their name, type and id:
- `résumé pour <id> … : « <name> » (<doc id>), … ; points : … ; consigne : …`: summarise them;
- `question pour <id> … : « <name> » (<doc id>), … ; question : …`: answer the question from them.

1. `immo.mjs show -p <slug> --id <id>`: each document's `path` in `messages[].documents`. Read each one named, whole
   (a PDF a few pages at a time). A Word or Excel file you cannot read: say so and ask for a PDF.
2. Answer in French from what they say only. Each fact with its source: the document and its page (« PV AG 2025,
   p. 3 »). A summary: what matters to a buyer first, then by document: the works voted or to come and the
   share of this lot, the charges and the arrears, the procedures (unpaid charges, disputes with the syndic or a
   neighbour), what differs from the listing (surface, DPE, charges against `show`). The `points` and the `consigne`
   come first. A question: the answer, then where it is written; « les documents n'en disent rien » when they do not.
3. Ask in one AskUserQuestion whether to keep it in the listing's « Mes notes »: « Oui » first, then « Non ». On a yes,
   write it to a file in the scratchpad, with a first line « Résumé des documents (<date>) : <names> » (or « Question
   sur les documents »), and run `immo.mjs note -p <slug> --id <id> --file <file>`: it is added after the user's notes.

## A parcel

`immo.mjs cadastre <IDU | lon,lat | address>` (or `-p <slug> --id <listing>`, the parcel at the listing's point; `--json`
for everything) prints, free, what the open data says of a parcel: IGN's record and its designation for a deed or an
offer, the urban plan (document, zone, prescriptions, informations, public easements), its buildings (BDNB: year,
levels, homes, footprint, DPE classes, clay hazard, near a historic monument), its condominium, the categories of the
legal persons holding rights on it (never a name), the DPE and audits of its addresses, its permits of the last 12
months, DVF's mutations on it, its risks, and the sources that failed. The dashboard's « Cadastre » tab shows the same.

A parcel's study (a `[parcelle]` item, « que vaut ce terrain », « peut-on construire ») answers, in French, from those
facts only:
- what the zone allows: its type (U urban, AU to urbanise, A farming, N natural; RNU: the national rules), the
  prescriptions that bind (height, setbacks, social mix, heritage), the easements (a PPR, a monument's surroundings: the
  Architecte des Bâtiments de France's opinion). Name the zone's rules document (its GPU link) as the one that decides,
  and never assert a building right the data does not show;
- the land: its contenance, the buildings' footprint and share of it, the free part; several parcels together for an
  « étudier ensemble » item;
- the market: its mutations (a whole building, a plot, flats), the street's and the commune's sales of land and homes
  (`show`, `market.json`), a price per m² of land only from sales of plots;
- the building, its energy (DPE classes, audits), its risks, the permits filed on it;
- what to check before buying: the title, a surveyor's boundary (bornage) for a plot, a certificat d'urbanisme
  opérationnel to build, the condominium's documents for a flat.

## `market.json`

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
