# BODACC (recorded: 2026-11-06)

`552081317.json`: the real answer of `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=registre="552081317"&order_by=dateparution desc&limit=100` (DILA, Licence Ouverte): `total_count` 121, the 100 latest notices of EDF (61 modifications, 34 filed accounts, 4 sales, 1 corrective notice).

## Rewritten fields (personal data, spec § 11)

In each `listepersonnes` (a JSON string), the `administration` text names the directors who leave and join: every person's name is rewritten `EXEMPLE, Prénom` (or `EXEMPLE`), the role words and the companies (auditors) are kept. One `Mme <Nom> <Prénom> au lieu de <Nom>` of a corrective notice is rewritten `Mme EXEMPLE Prénom au lieu de EXEMPLE`. Nothing else changed.
