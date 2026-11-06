# IP address

Hard rules: never scan, ping, trace, port-test or open any connection to the address under investigation, and never submit it to a service that would probe it (« scan this IP », an online port test, a speed or reachability check). The case reads registries and published lists only; no command of this type opens a socket to the address. The ports, software and CVE ids Shodan lists are Shodan's own observations: note them, never confirm them. A residential address is personal data: look no further into the subscriber.

## frame
Ask in one question what the frame leaves open: the question, the purpose, `noisy` (ask or never; no step of this type is noisy, the answer still goes in the frame) and whether the address may be a person's (seen in a visit log, a mail header or a consumer access provider: `person=true` with its GDPR legal basis; a server, a company or a cloud: `person=false`). Then `osint.mjs new ip "<the address as given>" --question "…" --frame noisy=… [--frame person=true --frame legal_basis="…"]`. A private, loopback, link-local, carrier-grade NAT or misspelled address is refused by `collect`: say so to the user and go no further.

## collect
`osint.mjs ip collect -p <slug>` (`--only registry,prefix,rdns,geo,ports,tor,cloud` for some steps): the registry records and abuse contact, the announcing AS, the reverse name (confirmed when it resolves back), a coarse location, what Shodan saw, the Tor exit list, the published cloud ranges. A step that fails is already noted: go on. When `collect` warns « looks like a residential line » and `Case.md` says `person: false`: stop, `osint.mjs status --set blocked --why "the address looks residential: the frame needs person=true and its legal basis" -p <slug>`, ask the user, and search nothing more on the subscriber.

## process
`osint.mjs brain context -p <slug>`. Group what was read: who holds the range (RDAP holder), who announces it (AS), who serves it (a cloud, a CDN, a Tor exit), which names (a reverse name confirmed or only claimed, the names Shodan saw). Ports, software and CVE ids are observations of Shodan, never tested. A clue added by hand cites its source (`osint.mjs source <url> --file <capture> -p <slug>`).

## analyse
Level `operator`: at least two hypotheses among the RDAP holder, the AS holder (they differ for a leased range or a shared project, like 1.1.1.0/24 held by the APNIC and announced by Cloudflare), the customer of a cloud or a CDN (the cloud does not operate what runs on it), a Tor or VPN exit (whoever used it stays unknown), the subscriber of an access provider (only when the frame says `person=true`). `--refute-if` first. `hyp lr` with the clue's real status: registries and published lists `read`, a reverse name not confirmed, Shodan's hostnames, tags and CVE ids `inferred`. Level `location`: the country, the city at best. The geolocation is always `inferred` (cap 3, never excludes); the registry's country is the holder's, not the machine's; a cloud region read in a published list is `read` for that region's country. Never a street, never a radius smaller than the map's circle.

## redteam
A sub-agent (or a separate pass) tries to refute the leading answer: anycast (one address, hundreds of places), a CDN in front of the origin, a range reassigned (a recently changed registry record), a lagging GeoLite2, a leased range (holder differs from the AS), the Tor list's date against the date of the facts. `osint.mjs redteam --file <verdict.json> -p <slug>`.

## conclude
`osint.mjs conclude --file <conclusion.json> -p <slug>` with the confidence per level and its criteria (those of the manifest), `radius_m` of the map's circle for `location` (50000 for a city, 500000 for a country), each alternative with its test; one answer.

## leads
`osint.mjs next --file <leads.json> -p <slug>`: the `domain` pivots (a confirmed reverse name, the few Shodan names that matter, never all fifty), `company-fr` on an organization whose SIREN is known, `web-mentions`, and a refresh later (ports, Tor exit).

## web-mentions
Search the web for the exact address (`"203.0.113.7"`; for IPv6 its canonical and its long form): abuse reports, blocklists, forums. One page read at a time; each page that brings something becomes a source (`osint.mjs source <url> --file <capture> --reliability <A-F> -p <slug>`) and an `inferred` clue (a report names an activity, not an operator). Never submit the address to a service that would probe it.
