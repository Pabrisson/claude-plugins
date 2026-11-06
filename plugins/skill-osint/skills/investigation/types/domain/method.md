# Domain

A domain or a website: who runs it, and where it lives. Free sources, no key. Each section below is read by the agent when it reaches that phase or runs that action.

## frame
Ask what the frame leaves open in one single question: the purpose, the scope, `noisy` (`ask`: the engine reads the site's home page and legal notice after the user's yes; `never`: only public records, no request to the site itself), and `person` when the site is one person's. Then `osint.mjs new domain <domain> --question "…" --frame noisy=ask|never [--frame purpose=…]`.

## collect
Run `osint.mjs domain collect -p <slug>` (Quick depth: rdap, dns, home). `home` reads the site itself, so it is a noisy step: with `noisy=never` it is skipped and the Journal says so; with `noisy=ask` the command exits 2: ask the user, then rerun with `--yes` (or `--only` without `home`). A step that fails is already noted in the Journal: go on, never loop on a results page. When the home page was read and links a legal notice, run `domain legal-notice --yes` next (noisy too: refused with `noisy=never`). `--only rdap,dns,crt,wayback,host,home` replays some steps.

## process
Read what the engine produced (`brain context`, `brain search`). Add by `clue` what you read yourself (a page, an archive), always with its source (`source <url> --file <saved text>`). Group by host, by tracker, by legal identity.

## analyse
Hypotheses at the `owner` level (who runs the site: the legal owner, an agency, a reseller) and at the `infrastructure` level; two per level when possible. Write `--refute-if` before examining. `hyp lr` with the clue's true status: `read` for a registry or a legal notice, `observed` for a style, `inferred` for a hosting coincidence. A shared tracker is an `inferred` clue, never proof of identity.

## redteam
A sub-agent (else a separate pass) tries to refute the leading answer: a SIREN homonym, a site sold since, an agency running several clients under one analytics account, masked RDAP data. Record it with `redteam --file`.

## conclude
`conclude --file`: the confidence per level with the criteria it meets (the manifest's), the alternatives each with its test, the unresolved clues. One answer only.

## leads
`next --file`: reading old pages (`deep-wayback`), searching the tracker (`tracker-search`), pivots: `domain` on a linked domain, `email` on a published address, `url` on a profile.

## legal-notice
Run `osint.mjs domain legal-notice --yes -p <slug>` (only in a `noisy=ask` case, after the user's yes): one read of the legal notice page the home page links to. The publication director's name is published by legal obligation: it becomes a `person` entity only when the frame names a person as subject (`person=true`, with its legal basis); otherwise the name stays in the clue only. No further search on that person without a legal basis.

## deep-wayback
Open 3 to 5 captures at the key dates of `.osint/views/wayback.json` (`https://web.archive.org/web/<timestamp>/<url>`), one at a time. Each capture read becomes a source (`source <url> --file <saved text>`). Note what changes: name, SIREN, trackers, legal notice.

## tracker-search
Search the web for the exact identifier (`"G-XXXXXXX"`, `"UA-1234567-1"`). Each site carrying it is a candidate domain (a lead or a child case), never proof: the same identifier can come from a copied template.
