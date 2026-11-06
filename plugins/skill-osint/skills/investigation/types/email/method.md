# Email

An address, and what it says of its owner and of its use, from passive sources. Never contact the address, never
talk to its mail server, never ask a site for a password reset.

## frame
- Ask in one question what the frame leaves open: the purpose, the scope, `noisy` (ask or never) and the GDPR legal basis. A person is always the subject of an email case: the basis says why the purpose needs this address.
- Born from another case (`--parent`): the frame is inherited; ask only what the parent lacks (often the legal basis).
- `osint.mjs new email <address> --question "…" --frame legal_basis="<basis — why>" --frame noisy=ask|never --lang <lang>`.

## collect
- `osint.mjs email collect -p <slug>`: address, disposable, mail, gravatar, breaches. A failed step is noted already: go on.
- Gravatar receives only the SHA-256 of the address. XposedOrNot, a third party, receives the address itself (its API takes nothing else): say so when the user asks what leaves the machine.
- XposedOrNot allows 25 calls an hour and 100 a day for the whole cases folder; a `breaches` step refused for its quota says when the next call is allowed: do not retry before.
- Gravatar answers about 100 profiles an hour without a key; a 429 is noted, try later.
- Never run account-probe as part of collect: it is a noisy action (section `account-probe`).

## process
- `osint.mjs brain context -p <slug>`; read the clues and entities collect wrote.
- Search the exact address on the web, quoted (`"name@example.org"`), and on the pages of its own domain: each page that publishes it becomes a source (`source <url> --file <saved text>`) and a clue (`read` when the page names who uses it).
- Open the Gravatar profile and each verified account one page at a time; record what a page states with `clue … --status read --sources S0x`.
- A breach name says the address existed when the breach happened: record nothing more; never look for, download or open breach data.
- A role address (contact@, info@…) belongs to a team or a company, not to one person: weigh it for `owner`.

## analyse
- `owner`: at least two hypotheses when possible (the person or organization a profile or a page names; a provider, a former employee, a shared mailbox), each with `--refute-if` written first.
- `in-use`: « in use today » against « abandoned ». A null or missing MX is a `read` clue that can exclude « in use »; a breach or a sign-up hit is old or inferred, never proof of use today.
- Statuses: DNS and Gravatar are `read`; Holehe hits are `inferred` (cap 3); the same local part on another site is `inferred`.

## redteam
- A sub-agent (else a separate pass) tries to refute the leading answer: a namesake on Gravatar; a profile made by someone else (Gravatar does not prove who reads the mailbox unless a verified account links back); an address recycled by its provider; a role address shared by several people; a catch-all or disposable domain. `redteam --file`.

## conclude
- `conclude --file` with the confidence per level and the manifest's criteria, the alternatives and their test; one answer.

## leads
- `next --file`, then the pivots, each a child case (`new <type> <value> --parent <slug> --from Entities/<note>.md`, the frame inherited):
  - `domain` on the address's own domain (never a public webmail nor a disposable domain);
  - `username` on the local part: a weak signal, many people share a name;
  - the avatar: `verify-media` on its URL (where else the picture appears), or `geolocate-image --file <case folder>/Evidence/<the avatar file>` when it shows a place;
  - the accounts Gravatar verified: `username` on each.
- Never a lead that contacts the address or its mail server.

## account-probe
- Noisy: Holehe asks the sign-up or login form of about 120 sites whether the address has an account there. The sites see these queries; the target gets no email, because the engine always passes `-NP` (no password reset).
- Ask the user first, for this run only, saying what it does: `osint.mjs email account-probe -p <slug>` answers exit 2 with the text to show; after the yes, `osint.mjs email account-probe --yes -p <slug>`. Never pass `--yes` on your own.
- `noisy: never` in the frame: refused (exit 1); say so and go on without it. No `uv`: exit 3, offer `osint.mjs setup uv`.
- Holehe is unmaintained since 2024: each hit is an `inferred` clue (a site that says « taken »), never an account found; a rate-limited site is unknown, not absent.

## never
- No probe of the mail server: no SMTP `RCPT TO`, no `VRFY`, no connection to the MX, whoever asks. It contacts the target; refuse it and say why.
- No password reset, no sign-up, no login, no message sent to the address.
- No breach content: names only.
