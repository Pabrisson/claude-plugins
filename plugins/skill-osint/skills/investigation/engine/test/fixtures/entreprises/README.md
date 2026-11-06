# Recherche d'entreprises (recorded: 2026-11-06)

Real answers of `https://recherche-entreprises.api.gouv.fr` (DINUM, from INSEE's Sirene and INPI's RNE, Licence Ouverte 2.0), asked with the User-Agent `skill-osint (fixtures)`. Subjects: the company EDF (SIREN 552 081 317) and the Hôtel de Ville de Paris (`/near_point`, 150 m, 4 pages of 25). Query strings are the engine's own.

| File | Query |
|---|---|
| `search-552081317.json` | `/search?q=552081317` (the identity; the full answer, 1 result) |
| `search-electricite-de-france.json` | `/search?q=ELECTRICITE DE FRANCE&per_page=25&limite_matching_etablissements=100&minimal=true&include=matching_etablissements,siege` (365 results, 25 kept per page; the 100 establishments of EDF) |
| `near-48.8565,2.352-1..4.json` | `/near_point?lat=48.8565&long=2.352&radius=0.15&per_page=25&page=N&limite_matching_etablissements=10&minimal=true&include=matching_etablissements` |
| `person-martin-jean.json`, `person-exemple-prenom.json` | `/search?nom_personne=Martin&prenoms_personne=Jean&type_personne=dirigeant&per_page=3&minimal=true&include=dirigeants,siege` (two copies: the second is what the officers of EDF, now named « EXEMPLE Prénom », are looked up by); it holds a sole trader |
| `search-555555556.json` | `/search?q=555555556`: an unknown, Luhn-valid number now answers `{"results":[],...}` |
| `ghost-123456789.json` | `/search?q=123456789`: the « ghost » record (all fields `null`) the API gives for some numbers; 123 456 789 fails Luhn, so the engine never asks it: a test serves it under SIREN 555 555 556 |

Other files of this folder (`search-456789122.json`, `search-durand.json`, `person-durand-*.json`, `near-45.9012,2.7021-1.json`, …) are the demo's invented company « Boulangerie Durand » (absent from the register): not recorded.

## Rewritten fields (personal data, spec § 11)

Shape and every field are kept; only these values changed:

- every `dirigeants[]` entry with `type_dirigeant: "personne physique"`: `nom` → `EXEMPLE`, `prenoms` → `Prénom` (the months and years of birth are kept: they drive the namesake logic);
- every sole trader (`nature_juridique` starting with `1`): `nom_complet` and `nom_raison_sociale` (when set) → `EXEMPLE Prénom`; `siren` → a Luhn-valid `99000000N` number, every `siret` rebuilt on it (Luhn-valid); in `siege` and `matching_etablissements`: `adresse` → `1 RUE EXEMPLE <code postal> <commune>`, `complement_adresse` → `null`, `numero_voie` → `1`, `libelle_voie` → `EXEMPLE`, `nom_commercial` and `liste_enseignes` → `EXEMPLE Prénom`, coordinates rounded to 3 decimals.

Company data (names, addresses, SIRET of companies, finances) are public registry data and are kept.
