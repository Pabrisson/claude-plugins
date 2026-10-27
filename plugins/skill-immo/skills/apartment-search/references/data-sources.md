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
| Risks | Géorisques `https://georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=<lon>,<lat>` | 90 d |
| Condominiums | Registre national d'immatriculation des copropriétés, through data.gouv's tabular API | 30 d |
| Shops, schools, transport, parks | OSM Overpass `https://overpass-api.de/api/interpreter` | 30 d |
| Travel times | Isochrones `https://data.geopf.fr/navigation/isochrone?resource=bdtopo-valhalla&profile=pedestrian\|car` | 90 d |
| Crime | SSMSI, communal and departmental bases, through the tabular API | 30 d |
| Income | INSEE Filosofi, through the Melodi API `https://api.insee.fr/melodi/data/DS_FILOSOFI_CC?GEO=` | 90 d |
| Zone outlines | geo.api.gouv.fr (commune, arrondissement) and IGN WFS `STATISTICALUNITS.IRIS:contours_iris` (IRIS) | 90 d |
| Base map | IGN vector tiles, style `https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json` | (browser) |

## Notes per source

- **Géoplateforme** (formerly API Adresse). A feature carries `label`, `type`, `citycode` (the arrondissement's code
  in Paris, Lyon and Marseille: 69383), `postcode`, `depcode` and `id`. The `id` is the BAN id, built as
  `<insee>_<street code>_<number>`. The street code is DVF's `adresse_code_voie` (5245 for rue Paul Bert), so a street
  is found in DVF by its code, not by its name.
- **geo-DVF**:
  - `latest/` holds the last five years: in October 2026, 2021 to 2025.
  - The URL answers with a `302` to OVH object storage, so follow it.
  - There is one row per local or lot. A mutation (`id_mutation`) counts as an apartment sale when it sells
    **exactly one** apartment, its cellar or parking (`Dépendance`) allowed, and no house or shop. Mutations of
    several apartments are left out.
  - On rue Paul Bert in 2024, leaving out every mutation with a dependency would keep 175 sales out of 1,180 and
    would bias the price (mostly small flats).
  - The surface is `lot1_surface_carrez`, else `surface_reelle_bati`. A €/m² outside 500–30,000 is a typo and is
    dropped.
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
