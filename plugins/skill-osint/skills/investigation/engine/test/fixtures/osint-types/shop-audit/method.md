# Shop audit

A private type of this cases folder (`.osint-types/shop-audit/`): an online shop before an order. Passive: the shop's
own pages, each read once; never an order, an account, nor a message to the shop.

## frame
Ask in one question what the frame leaves open: the purpose (an order, a wholesale deal, a dispute) and `noisy` (ask or
never; this type has no noisy step). Then `osint.mjs new shop-audit <domain> --question "<can one order from this
shop?>" --frame noisy=<ask|never> --lang <the session's language>`.

## collect
Run `osint.mjs shop-audit collect -p <slug>`: the home page, then the legal notice it links to, each recorded as a
source; each check goes to the Checks table and becomes a clue. A page that does not answer is already noted: go on.
Never read a page again in a loop.

## analyse
Hypotheses of the `seller` level, at least "the seller is identified and reachable" and "the seller cannot be
identified", each with `--refute-if` written first. A SIREN read in the legal notice is a `read` clue that can exclude;
a link not found is `read` too, but weak: the terms of sale may sit on the order page. Weigh with `hyp lr`; exclude only
with a read clue whose capture exists.

## redteam
A sub-agent (or a separate pass) tries to refute the leading hypothesis: a SIREN of another company, a legal notice
copied from another shop, terms hidden behind the cart. Record it with `redteam --file verdict.json`.

## conclude
`conclude --file` with the `seller` confidence and its criteria, taken from the manifest; the checks not found go to
`unresolved`. One answer.

## leads
`next --file`: read the terms of sale where the order page shows them (`[shop-audit:read-terms]`), a `domain` case on
the shop's domain to know who runs the site, a `company-fr` case on the SIREN.

## read-terms
Find the terms of sale (the order page, the cart, the footer of a product page); read them once and record them
(`source <url> --file <the text saved>`); add as clues the withdrawal right (14 days), delivery and returns, and the
consumer mediator they name. Never place an order nor create an account.
