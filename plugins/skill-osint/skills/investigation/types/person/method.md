# Person

A person case orchestrates: it never searches the person by itself. It records the identifiers the user already has,
each with why the purpose needs it, proposes one child case per identifier, lets the user choose, then consolidates
what the children found into `Profile.md` and weighs each identifier as the subject's or another person's.

## frame

- Refuse at once, in one sentence, and stop: a private person targeted to find, contact, follow or locate (an ex, a
  neighbour, « where does she live »), a minor, a request for data of GDPR article 9 (health, religion or belief, sex
  life or sexual orientation, political opinions, racial or ethnic origin, trade-union membership, genetic or biometric
  data), harassment. The engine refuses them too: never try to word around it.
- Ask in one question what the frame lacks: the purpose (what the user needs to know about this person, and why), the
  GDPR legal basis, noisy actions (ask or never, no default), the identifiers already known, one per line.
- `osint.mjs new person "<name>" --in identifiers="<line>\n<line>" --question "…" --frame purpose="…" --frame legal_basis="…" --frame noisy=ask|never --lang <session>`
  (from a company's officer: add `--parent <slug> --from "Entities/<name>.md"`). Prefix a line that reads two ways:
  `username:`, `email:`, `phone:`, `domain:`, `employer:`, `city:`. Never a street address.

## plan

- Write `plan.json`: `[{ "line": "<a line of the identifiers, as written>", "why": "<why the purpose needs it>" }]`;
  `"as": "city"` for a line the engine cannot read; `"drop": "<why the purpose does not need it>"` for an identifier the
  purpose does not need (data minimisation: drop rather than keep « just in case »); a line only in `plan.json` adds an
  identifier. A town is kept as an identifier and opens no case (`place` wants an address or coordinates).
- `osint.mjs person plan --file plan.json -p <slug>`: every identifier becomes an entity with its reason, and one line
  per child case it proposes (`[pivot:<type>] <value> — from Entities/<file>.md`, or `already in <slug>`).
- Show the proposals to the user (the type, the identifier, the reason) and ask which to open, in one question with
  several choices. Never open a child case the user did not choose. In the dashboard: Next actions › Pivots.

## children

- For each identifier chosen: `osint.mjs new <type> "<value>" --parent <slug> --from "Entities/<file>.md" --question "<is it the subject's, and what the purpose needs from it>" --lang <session>`;
  the child inherits the frame (purpose, legal basis, noisy) and the guard. Then follow that type's `method.md` (the `method:` line of `brain context`) as far
  as the purpose needs: a child need not reach its conclusion.
- An identifier a child finds (an account in a bio, a namesake's account, an address on a shop's site: a colleague's)
  is not a new child by default, and it is not the subject's either: consolidation lists it in `Profile.md` under
  « Candidates (not weighed) », with a `candidate` link in the graph, outside the profile and its PDF. It enters the
  profile only when a likelihood ratio above 1 is recorded for it (`person lr`). A mail provider or a host is no
  candidate. A phone written 06 39… and +33 6 39… is one identifier (the French plan); a number without its country
  code is refused unless the session is in French or the plan line says `"country": "GB"`.
- A detail of GDPR article 9 met in a child (a dating site, a union, a religion in a bio) is never written: the engine
  withholds it and says so in the Journal; do not note it elsewhere either.

## consolidate

- `osint.mjs person consolidate -p <slug>` after the children, and whenever one changed: `Profile.md` (identifiers by
  kind, each with its case, source, confidence and how much it is the subject's, then the candidates), the Identifiers table, the timeline of
  every linked case. It prints its Journal entry (`^jNNN`): person-case clues that sum the profile up cite it.
- The parent (the company the person was found in) counts as a linked case: its subject is an identifier.

## identity

- For each identifier, read the clues of its case (`osint.mjs brain show C03 -p <child>`), then
  `osint.mjs person lr "<identifier>" --case <child> --clue C03 --lr <x> --why "…" -p <slug>`: above 1 the subject's,
  below 1 another person's (a namesake, a shop's shared mailbox, a number attributed to no one). The engine caps it by
  the clue's status (read 50, observed 5, inferred 3, model 3). A name alone weighs nothing.

## analyse

- Hypotheses at level `identity`, two at least (the identifiers kept are the subject's / some belong to a namesake or
  a third party), each with `--refute-if` written first. The person case's own clues sum up what the profile shows and
  cite the consolidate entry: `osint.mjs clue "…" --status read --journal jNNN -p <slug>`.

## redteam

- Try to refute the answer: a namesake (same name, another birth month), a shared identifier (a shop's mailbox, a family
  phone), a stale or recycled account, a number never attributed. `redteam --file`.

## conclude

- `conclude --file` with the confidence of `identity` and the manifest's criteria; one answer; each alternative with
  the test that would tell it apart.

## leads

- `next --file`: the proposals left (an identifier the user has not chosen yet), reads a child still needs. Never a
  home address, never a contact with the person.

## employer

- An employer known by its name: `osint.mjs new company-fr "<name>" --parent <slug> --from "Entities/<name>.md" --question "…"`
  (by its SIREN, the pivot of Next actions does it).
