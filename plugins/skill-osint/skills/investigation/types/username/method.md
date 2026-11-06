# username

A username: the public accounts that carry it. They are candidate accounts, not identities: the same name on two
sites proves nothing until two independent links tie them to the subject.

## frame
- The subject is always a person: ask, in one question, what the case must answer, its purpose, the GDPR legal
  basis and `noisy` (ask or never). A child case keeps its parent's frame: ask only what it lacks (the legal basis
  for a username born of a domain case).
- Refuse a username targeted to harass, stalk, dox, threaten or contact someone who does not want it, and any minor.
- From a profile URL (a pivot from an `account` entity), pass the URL and the username as title:
  `osint.mjs new username https://www.instagram.com/durand.bakery --title durand.bakery --parent <slug> --from <note> --question "…" --frame legal_basis="…"`.
- Categories: every one but NSFW by default; NSFW only when the user asks (`--in categories=social,coding,nsfw`).
  Maigret only when asked (`--in maigret=true`, it needs `uv`).

## collect
- `osint.mjs username check -p <slug>`: WhatsMyName, GET only, about two minutes for the full list. Exit 3 means `uv`
  is missing for the Maigret option: WhatsMyName ran, say Maigret was skipped.
- Then `osint.mjs brain context -p <slug>`: the tally, the accounts found, the dataset's date.
- Never run it again in a loop. An `unknown` site (a bot wall, a timeout) is not a lead by itself.

## process
- Read each found profile once (`profile-read`), one page at a time, the most specific site first. A profile page is a third party's public page, not the subject's own site: it is read whatever `noisy` says.
- Record only what the purpose needs: the display name, the links of the bio, the avatar, the site's own links.
  Never health, religion, politics, sexuality or any other GDPR article 9 data; nothing about a minor.

## analyse
- One level, `same-person`. Hypotheses about the set of accounts: « A and B are the subject », « only A », « none
  (namesakes) »; `--refute-if` written first.
- Clue statuses: a link that each profile makes to the other, or the same unique email, read on both → `read`; the
  same avatar checked full size → `observed`; the same name, bio or style → `observed`; the same username only →
  `inferred` (the engine's own clue).

## redteam
- Try to refute the leading set: a common username (how many sites carry it), a namesake in another country or
  language, a squatted or impersonating account, an avatar that is a logo or a stock picture, a link that only one
  side makes.

## conclude
- `conclude --file`: the retained set, the `same-person` confidence with the manifest's criteria (high = two
  independent links; medium = name, bio and avatar consistent; low = the same username only), each other set as an
  alternative with the test that would tell it apart.

## leads
- `next --file`: `profile-read` of each unread found account, `avatar-compare`, `maigret` if not run yet, and the
  pivots: a link of a bio → `domain`; an avatar (its `image` entity) → `verify-media` or `geolocate-image`; another
  username seen on a profile → `username`.

## profile-read
- Open the profile once: in a browser or with a page reader, then `source <url> --file <saved text or capture>`;
  else `source <url>`. One profile at a time.
- A `clue` per fact, with its source; the links of the bio as entities (`entity domain <d> --sources Sxx`); the avatar
  as evidence (`evidence <image url>`) and as an entity (`entity image <image url> --prop role=avatar --sources Sxx`,
  which the image types take as a pivot); nothing more.
- Mark the account read: `entity account <url> --prop read=true --sources Sxx`.

## avatar-compare
- Save each avatar as evidence (`evidence <url>`), look at them one at a time, full size; the same image (crop,
  colors, details) → `clue "…" --status observed --credibility 2 --sources Sxx`. A logo or a stock picture proves
  nothing.
- A reverse search of an avatar is a pivot to `verify-media`, not this action.

## maigret
- `osint.mjs username maigret -p <slug>` (uv runs Maigret 0.6.6 on its top 500 sites, 3 to 10 minutes): its finds join
  the Accounts table (`via: maigret`). Exit 3 means `uv` is missing: `osint.mjs setup uv`, or go on without it.
