# Company (France)

A French company read in the public registries: Recherche d'entreprises (INSEE's Sirene and INPI's RNE, no key, 7 requests a second at most) and BODACC. Its officers are people: the frame always has a person as subject and a legal basis. The type proposes « Legitimate interest — public registry data »; the user may name another. Of an officer, record only the name, the role and the month and year of birth the registry gives: never a day of birth, a home address, a relative, nor anything of GDPR article 9.

## frame
- Ask in one question what the frame leaves open: the question, the purpose (why the case needs this company and its officers), the scope, and the legal basis — propose « Legitimate interest — public registry data ».
- `osint.mjs new company-fr "<name, SIREN or SIRET>" --question "…" --frame purpose="…" [--frame legal_basis="<basis — why>"] --lang <session language>`; without `legal_basis` the proposed one is written in Case.md.
- From another case: `new company-fr "SIREN 456 789 122" --parent <slug> --from "Entities/SIREN 456 789 122.md"` (the frame is inherited).

## collect
1. `osint.mjs company-fr collect -p <slug>`: identity, establishments (the map), officers. A name that matches several companies stops with their list (exit 1): ask the user which one, never pick it yourself, then `company-fr collect --siren <SIREN> -p <slug>`.
2. `osint.mjs company-fr bodacc -p <slug>`: the BODACC notices.
3. `osint.mjs company-fr officers -p <slug>`: the other companies of each officer who is a person.
A step that fails is already noted in the Journal: go on. Never read the registry's or BODACC's pages again in a loop: the engine read them.

## process
- `brain context -p <slug>`, then read the entities and clues the commands wrote.
- What you read yourself (the company's website, an annuaire page, a press article) goes in as a source (`source <url> --file <capture>`) and a clue that cites it.
- An officer's other company of level low is a namesake until a read clue links it (same address, a co-officer of the subject, a BODACC notice naming both): it stays out of the graph.

## analyse
- Level `identity`: which company the case is about. The registry's answer for the SIREN against what the input or the parent case read (name, address, legal notice). Two hypotheses at least when the input was a name or when the parent's data differ.
- Level `network`: for each officer whose other companies matter to the question, « same person » against « namesake ». `hyp lr` from the level the engine wrote: high (same name and month of birth) up to 20, medium (same year) 2 to 3, low (name only) 1.5 at most.
- An insolvency proceeding, a strike-off or accounts no longer filed are `read` clues: weigh them for the question, not for the identity.

## redteam
A sub-agent (or a separate pass) tries to refute the answer: a namesake company (same name, another SIREN), a head office moved, a closed establishment taken for an open one, an officer whose month of birth differs, a BODACC notice where the company is only the other party. `redteam --file`.

## conclude
`conclude --file` with the confidence of each level and its criteria (the manifest's), each alternative with its test; one answer.

## leads
`next --file`: `[company-fr:website]` when no official website is known; `[company-fr:officers-deep] <officer>` for a medium or low match that matters; pivots `[pivot:company-fr]` on an officer's other company or on a company that is an officer, `[pivot:domain]` on the official website, `[pivot:person]` on an officer only when the purpose needs more than the registry (and once the person type exists).

## website
Find the company's official website: a web search on its name with its town or its SIREN; open the likeliest result once. It is the official site only if the page names the company (its SIREN, its name and address in the legal notice). Record it: `source <url> --file <capture>`, `entity domain <domain> --prop role=website --sources <S>`, a `read` clue that cites the source. The domain then offers « New Domain case on <domain> ».

## officers-deep
For one officer: read `.osint/views/network.json` for them; for each company of level medium or low, read its registry page once (`https://annuaire-entreprises.data.gouv.fr/entreprise/<SIREN>`) and look for an independent link: the same address, a co-officer of the subject, a BODACC notice naming both companies. A link found becomes a `read` clue with its source, then `hyp lr`; none, and the match stays a namesake. Never search the person beyond the registry (social networks, address, family) unless the purpose needs it and the frame allows it.
