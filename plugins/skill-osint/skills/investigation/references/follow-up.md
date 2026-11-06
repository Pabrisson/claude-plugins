# Refresh, next actions, pivots, the dashboard's prompts

Contents: refresh · watch · export PDF and print view · next · pivots · prompt formats.

## Refresh

`osint.mjs refresh -p <slug> [--only a,b] [--yes] [--json]` replays the type's engine steps (a type's `refresh` list), compares each snapshot with the previous one and writes « What changed » in `Case.md`, the Journal and `case.json`: nothing is re-collected as if new. The agent steps come back as prompt items (`agent step: [type:section] input`): do them, then update the analysis. A noisy step with `noisy=ask` exits 2: ask the user, rerun with `--yes`, or `--only` without it; with `noisy=never` it is skipped and the Journal says so. End with what changed, in a few lines.

## A person's Refresh

A `person` case's Refresh is one step, `profile` (`consolidate --children`): each child's own Refresh first (all its steps but the noisy ones, which the Journal gives to run after the user's yes: `refresh -p <child> --only <ids> --yes`), then `consolidate`. A child's agent steps come back as `[<type>:<section>] <input> (case <slug>)`: do them in the case named. « What changed » of the person: identifiers added, a confidence or a share that changed. A child gone to the bin or failing is noted and the others go on. The watch (stage 11) never hands back an agent step.

## Watch

A watched case gets its refresh again on a period, by itself: the dashboard server runs the type's free engine steps and tells the user what changed.

- `osint.mjs watch -p <slug> --every 6h|12h|24h|7d` turns it on or changes the period; `--every off` turns it off. No other period: asked for « every 5 minutes », say the shortest is 6 hours and ask which one.
- What runs: the refresh steps `by: engine` of the case's type that declare `watch: true` — never a noisy step, one that sends an image or one that costs (the engine refuses them whatever the manifest says), never an agent step, never one nobody declared. `watch --every` prints them; tell the user, and that the agent's own steps (reading pages, reverse image searches) wait for a Refresh. `domain`'s watch never reads the site itself (`home` is a Refresh step only); `email`'s asks XposedOrNot for the address, within its daily limits. A pass never gets a `--yes`. A private type (`.osint-types/`) is watched only on the user's yes: `watch --every 24h -p <slug> --yes` after they have read its `engine.js` (exit 2 without it, a changed `type.json` or `engine.js` stops its passes until the next yes).
- A `person` case (and the cases below it) is watched only within its frame: a purpose and a legal basis, no pursuit of a private person, no GDPR article 9 category. `watch` refuses otherwise, and a pass that finds the frame changed queries nothing. The person's watch runs each child's watched steps, then the profile.
- A pass is the usual refresh, by `watch`: « What changed » in the Journal (kind `watch`) and in Case.md's `what-changed` block (« · watch »), the « N new » badge, and a desktop notification (« acme.fr: 3 new certificates ») whose click opens the case — on macOS only with `terminal-notifier` (`doctor` says so), on Linux with notify-send 0.7.10 or later. A page read again unchanged adds no note: a watch of weeks does not fill `Sources/`.
- The dashboard server runs the passes. `watch --every` starts it when none runs. While a case is watched it stays on after the agents have quit, until « Stop server » in Settings or the end of the session; the next `osint.mjs dashboard` starts it again. A pass missed meanwhile (server off, machine asleep) runs once then, not once per missed period, and the next one comes a period after it.
- One case at a time, each host's limits kept. A pass that fails is noted in the Journal (`fail · watch pass: …`); its next pass is set as usual; `watch -p <slug>` shows the error.
- `watch` lists the watched cases with their last and next pass; `watch -p <slug>` shows one; `watch --pause` and `--resume` are the folder's switch (each case keeps its period); `watch --notify on|off`; `watch --due` runs now the passes that are due (what the server does every minute).
- « What changed on <case>? »: `brain context` (its last « What changed ») then the Journal's `watch` entries, citing them.

## Export PDF and Print view

- `osint.mjs export -p <slug> [--journal]` prints the case's print view with a Chromium-family browser (Chrome,
  Chromium or Edge, else the GeoINT pack's Chromium; `OSINT_BROWSER=<path>` forces one) to
  `<slug>/Exports/<slug>-<date>.pdf`. Git keeps it: a dated deliverable. A second export the same day is
  `<slug>-<date>-2.pdf`; a PDF is never overwritten. Its SHA-256 goes to the Journal.
- The PDF holds the question and the frame, the report (the answer and the confidence of each level with its
  criteria), the hypotheses and the ACH matrix, the sources (URL, date, archive, SHA-256, Admiralty grade), the
  evidence as thumbnails with their hashes, and with `--journal` the whole Journal as an appendix. Add `--journal` when
  the user wants the audit trail, or when the PDF leaves the team.
- Reply with the file, its SHA-256 and the browser, citing the export's Journal entry (`[[Journal#^j042]]`).
- A case not concluded yet prints with a « Draft » banner: say so, and conclude first when the user wants a final
  report. Evidence changed or gone since it was added is marked in the PDF: say so too.
- Exit 3 (no browser): say it in one line, give the install command from the message, and give the print view
  instead: run `osint.mjs dashboard -p <slug>` and replace `#/c/<slug>` in its URL with `print/<slug>` (add
  `?journal=1` for the appendix); the user prints it or saves it as PDF from their own browser. Do not retry.
- Exit 1 (the browser failed, or did not finish within `OSINT_PDF_TIMEOUT`, 120 s by default): the failure is in the
  Journal; give the print view the same way; another browser can be tried with `OSINT_BROWSER=<path>`.
- The dashboard's « Export ▾ » menu on a case: « Export PDF » runs the same command itself, « Print view » opens the
  same page, « Open in Obsidian » the case's vault: none sends a prompt to the agent.

## Next actions

`next --file leads.json`: `[ { "label": "Read the 2019 home page", "why": "the SIREN may differ", "minutes": 5, "noisy": false, "prompt": "[lead:L01] …" } ]` (`prompt` optional). Ticked boxes (`- [x]`) in `Leads.md` stay done when the list is replaced. `next --done L02` marks one done. A type's actions (`legal-notice`, `deep-wayback`, `tracker-search` for `domain`) and its pivots show on the dashboard too.

## Pivots and child cases

A pivot is a new case on an entity found in this one: `new <type> <value> --parent <slug> --from <note path>`. The child inherits the frame (`noisy`, purpose, legal basis); do not ask it again. The parent lists its children; the same entity in two cases appears in `brain entities --shared`. A type may take an entity only when it carries a property: `pivots: [{ "kind": "organization", "has": "siren" }]` (`company-fr`). The dashboard then offers « New Company (France) case on SIREN 456 789 122 » on an organization with a `siren`, never on one without; the pasted item is `[pivot:company-fr] SIREN 456 789 122 — from Entities/SIREN 456 789 122.md`, and `new company-fr "SIREN 456 789 122" --parent <slug> --from "Entities/SIREN 456 789 122.md"` reads the number from the value.

**To an email case**: every `email` entity (an address a domain case read on a home page or a legal notice) offers « New Email case on <address> ». A person is always the subject of an email case: the child inherits the parent's frame, and you ask the legal basis when the parent had none.

**From an email case**: the address's own domain → `domain` (never a public webmail nor a disposable domain); the local part → `username` (a weak signal: many people share a name); the Gravatar avatar → `verify-media` on its URL, or `geolocate-image --file <case folder>/Evidence/<the avatar file>` when it shows a place; each account Gravatar verified → `username`. `[email:account-probe]` in a pasted prompt is noisy: run it without `--yes`, show the user what exit 2 says, and wait for the yes.

## Prompts copied from the dashboard

First line: `osint case <slug>: start` (a case just created, no items), `osint follow-up (case <slug>)` or `osint (all cases)`. Then `n. [<tag>] <text>`:

| Tag | Do |
|---|---|
| `<type>:<action>` | the `<action>` section of the type's `method.md` (the `method:` line of `brain context`) |
| `lead:Lnn` | the lead `Lnn` of `Leads.md` |
| `pivot:<type>` | the pivot above; the text is `<value> — from <note>` |
| `refresh` | `refresh` |
| `question` | answer from `brain context`/`search`, citing notes |
| `install` | `setup <tool>` |

End with one line per item: done, or why not.
