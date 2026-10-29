# Open data

Every source below is free and needs no key. All were checked live on 2026-10-27, on 20 rue Paul Bert, Lyon 3e. The
engine keeps each answer in the searches folder's `.cache/` for the time given (TTL). If a source changes, fix
`lib/opendata.js` and this page.

| Need | Source and call | TTL |
|---|---|---|
| Geocoding | Géoplateforme `https://data.geopf.fr/geocodage/search?q=&type=housenumber\|street\|municipality&limit=` | 30 d |
| Autocomplete | `https://data.geopf.fr/geocodage/completion?text=&type=StreetAddress,PositionOfInterest` | none |
| Real sales | geo-DVF `https://files.data.gouv.fr/geo-dvf/latest/csv/<year>/communes/<dep>/<insee>.csv` | 30 d (recent years), 180 d (older) |
| DPE of an address | ADEME data-fair `https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines` | 30 d |
| DPE classes of a zone | The same dataset, `values_agg?field=type_batiment;etiquette_dpe` with `geo_distance` or `code_insee_ban_eq` | 30 d |
| Recent DPE of a zone | The same dataset, `lines?bbox=<w,s,e,n>&date_etablissement_dpe_gte=<12 months ago>&sort=-date_etablissement_dpe` | 7 d |
| Property tax rates | DGFiP « fiscalité locale des particuliers », `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records` | 90 d |
| Homes authorised | Sitadel (SDES), DiDo `https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1/datafiles/<rid>/json` | 30 d |
| Risks | Géorisques `https://georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=<lon>,<lat>` | 90 d |
| Rents | Carte des loyers (DHUP), through the tabular API: the latest year's dataset, found by its title | 30 d |
| Condominiums | Registre national d'immatriculation des copropriétés, through data.gouv's tabular API | 30 d |
| Shops, schools, transport, parks | OSM Overpass `https://overpass-api.de/api/interpreter` | 30 d |
| Travel times | Isochrones `https://data.geopf.fr/navigation/isochrone?resource=bdtopo-valhalla&profile=pedestrian\|car` | 90 d |
| Crime | SSMSI, communal and departmental bases, through the tabular API | 30 d |
| Income | INSEE Filosofi, through the Melodi API `https://api.insee.fr/melodi/data/DS_FILOSOFI_CC?GEO=` | 90 d |
| Zone outlines | geo.api.gouv.fr (commune, arrondissement) and IGN WFS `STATISTICALUNITS.IRIS:contours_iris` (IRIS) | 90 d |
| A street's line | IGN WFS `BDTOPO_V3:troncon_de_route`, `CQL_FILTER=identifiant_voie_ban_gauche='<ban>' OR …_droite` | 30 d |
| IRIS of a box (odds map) | The same WFS, `BBOX=<s>,<w>,<n>,<e>` | none |
| Census per IRIS (odds map) | INSEE Melodi `DS_RP_MENAGES_PRINC_IRIS` and `DS_RP_LOGEMENT_PRINC_IRIS`, `?GEO=IRIS-<code>&GEO=…` | 90 d |
| Recent DPE of a commune (odds map) | ADEME `lines?code_insee_ban_eq=<insee>&date_etablissement_dpe_gte=<12 months ago>` | 7 d |
| Base map | IGN vector tiles, style `https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json` | (browser) |

## Notes per source

- **Géoplateforme** (formerly API Adresse). A feature carries `label`, `type`, `citycode` (the arrondissement's code
  in Paris, Lyon and Marseille: 69383), `postcode`, `depcode` and `id`. The `id` is the BAN id, built as
  `<insee>_<street code>_<number>`. The street code is DVF's `adresse_code_voie` (5245 for rue Paul Bert), so a street
  is found in DVF by its code, not by its name.
- **geo-DVF**:
  - `latest/` holds the last five years: in October 2026, 2021 to 2025.
  - The URL answers with a `302` to OVH object storage, so follow it.
  - There is one row per local or lot. A mutation (`id_mutation`) counts as the sale of one property when it sells
    exactly one local of one type, so its price is that local's:
    - a flat (`Appartement`), a house (`Maison`) or premises (`Local industriel. commercial ou assimilé`): one local,
      its cellars and parkings (`Dépendance`) allowed, nothing of another type. Mutations of several apartments are
      left out. A house keeps the land of its parcels (`surface_terrain`, each parcel and culture once);
    - a plot (`land`): no local at all, only building land, soils, gardens or leisure land (`AB`, `S`, `J`, `AG`), not
      farmland, 50 m² at least;
    - a parking: one `Dépendance` lot, alone. DVF gives no surface: it is weighed on its price.
  - On rue Paul Bert in 2024, leaving out every mutation with a dependency would keep 175 sales out of 1,180 and
    would bias the price (mostly small flats). Lyon 3e that year: 1,180 flats, 68 premises, 209 parkings, 32 houses,
    2 plots.
  - The surface is `lot1_surface_carrez` for a flat, else `surface_reelle_bati`. A unit price outside its bounds is a
    typo and is dropped: 500–30,000 €/m² (flats, houses), 200–30,000 (premises), 5–5,000 €/m² of land (plots),
    1,000–200,000 € (parkings).
  - **There is no DVF for the Moselle, the Bas-Rhin and the Haut-Rhin (57, 67, 68)**, which keep their own land
    register: their URLs answer `404`, and the dashboard says so.
- **ADEME DPE**:
  - `qs=identifiant_ban:"69383_5245_00020"` returns the DPE of an address. Without a BAN id, use
    `geo_distance=<lon>,<lat>,<meters>`.
  - The fields used: `etiquette_dpe`, `etiquette_ges`, `surface_habitable_logement`, `numero_etage_appartement`,
    `cout_total_5_usages` (€/year), `conso_5_usages_par_m2_ep`, `annee_construction`.
  - The flat's own DPE is the one whose surface is within 8 % of the listing's (and on the same floor when both are
    known).
  - `numero_immatriculation_copropriete` links it to the condominium register.
- **Carte des loyers** (ministère du Logement, ANIL):
  - One dataset a year, « "Carte des loyers" - Indicateurs de loyers d'annonce par commune en <year> ». The engine
    finds the latest through `https://www.data.gouv.fr/api/1/datasets/?q=…`, then its resources by their title: flats
    (all, « 1 ou 2 pièces », « 3 pièces ou plus ») and houses. Fallback: the 2025 resource ids.
  - `INSEE_C__exact=<insee>` (the arrondissement's code in Paris, Lyon, Marseille). The fields: `loypredm2` (€ per m² a
    month, charges included), `lwr.IPm2` and `upr.IPm2` (the 95 % range), `TYPPRED` (`commune`, else `maille`: a group
    of communes) and `nbobs_com`. Lyon 3e, 2025: 16.40 €/m² for a flat, 17.89 for a house.
  - A flat takes the row of its size; the dashboard compares its rent with owning it.
- **Géorisques**: `risquesNaturels` and `risquesTechnologiques`, each a `{ present, libelle }`. Only the risks present
  are kept.
- **Condominium register (RNIC)**:
  - The CSV weighs 450 MB, so the tabular API is queried instead:
    `https://tabular-api.data.gouv.fr/api/resources/<rid>/data/?longitude__greater=&longitude__less=&latitude__greater=&latitude__less=`.
  - The resource is the one titled "RNIC - Actualisation quotidienne". Its id is found through
    `https://www.data.gouv.fr/api/1/datasets/62da71c068871f4c54258c7c/` (fallback `3ea8e2c3-…`).
  - Its columns were renamed in April 2026: `numero_immatriculation`, `nombre_total_lots`, `nombre_lots_habitation`,
    `periode_construction`, `type_syndic`, `longitude`, `latitude`.
- **Overpass**:
  - It refuses curl's default User-Agent (`406`): the engine sends `skill-immo/1.0 (+repo URL)`.
  - When it is busy it answers `502` or `429`: three tries, 2 then 4 s apart.
  - It is queried once per search, over the zone's box grown by 600 m, so that every listing gets its 500 m. The
    counts per flat are made in the browser.
- **Isochrones**: `bdtopo-valhalla`, with `costValue` in seconds. There is no free public transport routing across
  France, so the travel times are on foot (15 and 30 min) and by car (20 min), from each place of the profile.
- **SSMSI**:
  - The communal base has the commune code in a column named after the geography's year (`CODGEO_2026`), so the
    engine finds it from the first row.
  - The fields: `annee`, `indicateur`, `nombre` and `taux_pour_mille`. Paris, Lyon and Marseille have figures per
    arrondissement.
  - Small numbers are not published (`est_diffuse: ndiff`).
  - The departmental base (`Code_departement`) gives the comparison.
- **Filosofi** (Melodi):
  - `GEO=COM-<insee>`, `ARM-<insee>` (an arrondissement), `DEP-<dep>` or `FRANCE-FM`.
  - The measures used: `MED_SL` (median standard of living, €/year) and `PR_MD60` (poverty rate, %). Millésime 2023.
  - **IRIS is not published** in this dataset (`IRIS-…` returns nothing): the commune or arrondissement is the
    finest level.
- **IGN styles**: `standard`, `gris` and `attenue` exist. There is no dark one, so the dashboard darkens `gris`
  itself.

- **DPE classes of a zone** (ADEME `values_agg`): `type_batiment_in=appartement,maison` drops the building DPE (one per
  building), and `methode_application_dpe_neq=dpe appartement généré à partir des données DPE immeuble` the flats' DPE
  generated from them (22 % of Lyon 3e's): one DPE per home. A home diagnosed again (`numero_dpe_remplace`, about 10 %)
  may still count twice. 300 m around rue Paul Bert: 2,132 flats, 47 % C, 6 % F and G.
- **Recent DPE of a zone** (ADEME `lines`, checked on 2026-10-27): the zone's box (`bbox`, then the engine keeps what is
  inside the zone) and the same two filters, one DPE per home. `_geopoint` is `lat,lon`. A page holds 10,000 rows at most
  (`size + skip` cannot be more): the engine follows `next` once. Over 12 months: 178 in Louveciennes, 1,704 in the box
  around rue Paul Bert, 4,884 in Lyon 3e, 11,400 in Paris 15e. No field says whether a DPE was made to sell or to let;
  a G can no longer be let since 2025.
- **Property tax rates** (data.economie.gouv.fr, 50,000 calls a day): one row per commune and year, 2021 to 2025.
  `e12vote` is the commune's rate, `e32vote` the intercommunality's, `taux_global_tfb` their total with the syndicates,
  TSE and GEMAPI, `taux_plein_teom` the waste tax. Paris, Lyon and Marseille vote one rate: the engine asks for 75056,
  69123 or 13055 for an arrondissement. France's average comes from one more call,
  `select=sum(taux_global_tfb*mpoid)/sum(mpoid)` (weighted by population: 43.13 % in 2025). Lyon 2025: 32.82 %.
- **Homes authorised** (Sitadel on DiDo, dataset `6513ee3a3b05e5cd969c270f`, file `9c90a880-…`): one row per commune
  (or arrondissement), year and type of home, 2013 onwards; the engine keeps « Tous Logements ». DiDo lists a release
  (`millesime`) days before it opens it and answers 400 until then: the engine reads the dataset's releases and takes
  the newest whose `date_diffusion` has passed. The last year's homes started are not out yet. Lyon 3e: 174 authorised
  in 2025, 472 in 2022.

## The odds map (« Prospection »)

The dashboard's odds map asks the server `GET /api/odds?bbox=<w,s,e,n>` each time it stops (zoom 14 or closer; a box
wider than 0.3° by 0.2° is refused). The engine (`oddsOf` in `immo.mjs`, `lib/odds.js`) answers the box's IRIS with
their census, DVF sales, odds and prices, its communes, and its DPE, energy audits and building permits of the last 12
months. Checked live on 2026-10-29 around rue Paul Bert: 86 IRIS, 10,058 DPE, 63 audits and 22 permits, 13 s the first
time, about 1 s once kept.

- **A street's line** (IGN WFS, BD TOPO): its segments by the street's BAN id (`69383_5245`: 47 segments, 2.7 km, 18 kB). Some streets lack the link, often those of the BAN's newer ids (`13207_dqffc7`, the Corniche Kennedy): then by `nom_collaboratif_gauche|droite` in the commune (`insee_commune_*`), upper case with the street's kind abbreviated (`COR DU PRESIDENT JOHN FITZGERALD KENNEDY`, `BD`, `MTE`). Checked live on 2026-10-29 on 8 streets of Paris, Lyon and Marseille: the band along it holds the whole street, where the capsule of its farthest sales lost up to 80 %.
- **IRIS of a box** (IGN WFS): `BBOX` as lat lon. Each feature has `code_iris`, `nom_iris`, `code_insee` (the
  arrondissement's in Paris, Lyon, Marseille: 69383), `nom_commune` and `type_iris` (H homes, A activity, D other, Z a
  commune not split). 165 IRIS in 0.07° by 0.04° of Lyon, 0.13 MB, 2.8 s.
- **Census per IRIS** (Melodi, population census 2023): several `GEO=IRIS-<code>` in one call (50 a call; 25 IRIS in
  6 s and 0.6 s). A row counts what its dimensions other than `_T` say. The ones read:
  - `DS_RP_LOGEMENT_PRINC_IRIS`: `RP_MEASURE=DWELLINGS` (all homes), with `OCS=DW_MAIN` (main homes), with `TSH=100`
    (their owners); `DWELLING_L_STAY` with `OCS=DW_MAIN, TSH=100` sums the owners' years in their home;
  - `DS_RP_MENAGES_PRINC_IRIS`: `RP_MEASURE=POP, AGE=Y_GE15` with `CIVIL_STATUS` 1 married, 2 PACS, 3 living together,
    4 widowed, 5 divorced, 6 single; `ONEPERS, NOC=P1, OCS=DW_MAIN` with `AGE=Y55T79` and `Y_GE80`: the people living
    alone. Danton-Bir Hakeim (Lyon 3e): 6,750 homes, 1,512 owners for 13 years, 206 people of 80 and more alone.
  - `DS_RP_LOGEMENT_PRINC_IRIS` again: `OCS=DW_VAC` (vacant homes), `OCS=DW_SEC_DW_OCC` (second homes); with
    `OCS=DW_MAIN`, `BUILD_END=Y_LT1919` and `Y1919T1945` (built before 1946), `NRG_SRC=OIL` (heated with oil),
    `L_STAY=Y_GE10` (the household moved in 10 years ago or more). Danton-Bir Hakeim: 503 vacant of 6,750, 630 built
    before 1946.
  - The values are the census's estimates (decimals): the engine rounds them.
- **The odds** (`lib/odds.js`): an IRIS's flats and houses sold a year (DVF's sales of one home, the last three whole
  years) over its homes is the odds that one of them goes on sale within 12 months (1.2 % to 3.3 % around rue Paul
  Bert). Successions: people living alone of 55 to 79 × 1.3 % and of 80 and more × 9 % a year (France's death rates
  by age), × the owners' share of the main homes. Separations: couples × 1 % a year × the same share. Both are
  estimates, said so in the dashboard.
- **The odds of an address** (« Estimations », `addressOdds` in `lib/odds.js`, run by the dashboard on the box's
  rows): its DPE, audits and permits (by BAN id, else point), each a chance p, together 1 − Π(1 − p). The DPE of one
  address and one day are one signal, the likeliest: around rue Paul Bert, 126 addresses had 3 or more the same day
  (34 at 42 rue Tronchet), a whole building diagnosed or a home diagnosed twice. A DPE: its IRIS's
  share of sales, DVF's sales a year / (sales + tenants × 1/5 moving out a year), France's 30 % without figures (10 to
  30 % around rue Paul Bert, median 15 %), at least 80 % for a G. An audit: 50 %. Both whole for 2 months, half to 6, a
  quarter after. A permit to develop 70 %, to build 2 homes or more 60 %, to demolish 50 %, one house 10 %. A DPE a
  listing of the search has is left out. Reasoned weights, not measured; they could be set on DVF's sales at the DPE's
  address in the 12 months after it.
- **The prices**: the median € per m² of an IRIS's flats and houses sold over the same three years, together then apart,
  from 5 sales on. The map's five classes are Lyon's and Villeurbanne's quintiles (117 IRIS, 2026-10-29): 3,600, 4,200,
  4,700, 5,100 €/m²; the vacant homes' 6, 7.5, 9 and 11 %.
- **Energy audits** (ADEME dataset `ync2epx48x9azbdnggbygqp0`, « Audits énergétiques logement existants », daily, since
  September 2023; checked on 2026-10-29): due before selling a house or a whole building (monopropriété) rated F or G
  since April 2023, E since 2025, D from 2034; also made for a renovation grant, and no field says which. One audit has
  a row per scenario of works: `categorie_scenario_eq=état initial` keeps one. `methode_application_dpe` says a house
  (`dpe maison individuelle`), a whole building (`dpe immeuble collectif …`, its area `surface_habitable_immeuble`) or a
  flat. `bbox`, `geo_distance`, `identifiant_ban_starts` and `code_insee_ban_in` work as on the DPE. Over 12 months: 56
  in Lyon 3e (27 houses, 23 whole buildings), 10 in Louveciennes.
- **Building permits** (data.gouv dataset `689c42fa521ccf80ce954f83`, Sitadel's « Liste des permis de construire et
  autres autorisations d'urbanisme », monthly; checked on 2026-10-29): three CSV resources read through the tabular API
  (`page_size` up to 200, `links.next`): the homes built (PC and DP, `NUM_DAU`, `NB_LGT_TOT_CREES`, `NB_LGT_DEMOLIS`),
  the demolitions (PD) and the plots divided (PA). `COMM` is the city's code (69123 for Lyon's arrondissements),
  `DATE_REELLE_AUTORISATION` the date, `ETAT_*` 4 a cancelled one (left out). About 6 months late for homes, 1 for a
  demolition. No point: the address (in capitals, some accents garbled) goes to the BAN's CSV geocoding
  (`POST data.geopf.fr/geocodage/search/csv`, one call for a city), a score under 0.5 is left out. The applicant
  (`DENOM_DEM`, a company or an SCI that may bear a person's name) is never kept. Lyon over 12 months: 50 homes built, 43
  demolitions, 6 plots.
- **Not used, on purpose**: no source gives a death or a divorce with an address, and joining people to homes is not
  allowed.
  - INSEE's file of deaths (open, monthly) has the name, the birth and the place of death, not the home.
  - DVF forbids finding who sold, even indirectly (article R112 A-3 of the LPF).
  - The land register gives a home's owner 5 times a week at most (article R*107 A-3 of the LPF).
  - Court rulings in open data are pseudonymised, and divorces by mutual consent (at a notary since 2017) are not
    published. INSEE's divorces per department stop in 2016 (`DS_MAR_PACS_DIV_SERIES`).
  - Gathering death notices to reach the heirs (living people, under the GDPR) is left out.
- Tried and dropped (2026-10-28): calibrating « a DPE without a listing → a listing » on DVF. Among the 3,480 DPE of
  2023 around rue Paul Bert, 24 % were followed by a sale at the same address and surface (±8 %) within 18 months, 177
  days later at the median (C 30 %, D 22 %, G 14 %). The user kept the recent DPE as they are.

## The data.gouv.fr MCP

When a data.gouv.fr MCP server is connected, Claude may use it to find and query a dataset the engine does not cover
(the noise maps, a local dataset, a newer edition of one above). The engine does not depend on it.
