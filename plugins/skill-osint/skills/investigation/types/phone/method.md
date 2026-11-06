# Phone number

Hard rules: never call the number, never text it, never check whether it has an account on WhatsApp, Telegram, Signal or any app that syncs contacts. Each one contacts the holder or tells them someone looked. No command does it, the engine refuses these links (`wa.me/<number>`, `t.me/+<number>`, `signal.me/#p/…`), and a request for one is refused with this reason, the passive steps offered instead. No paid lookup either: no reverse directory that charges, no HLR or CNAM query (they also ask the subscriber's network). A number in a block the ARCEP keeps for fiction reaches nobody: say so.

## frame
Ask in one question what the frame leaves open: the purpose, the scope, `noisy` (ask or never; this type has no noisy step, the answer still goes in the frame) and whether the subject is a person. A mobile number, or one found on a private profile, is a person's: `person=true` with its GDPR legal basis. A switchboard, or a number a business publishes: `person=false`. Then `osint.mjs new phone "<the number as given>" --question "…" --frame noisy=… --frame person=… [--frame legal_basis="…"]`, with `--in country=<ISO code>` when the number has no country code and is not French.

## collect
`osint.mjs phone collect -p <slug>`: the numbering plan (E.164, country, line type) and, in the French plan, the holder of the number's block in the ARCEP's register. It prints the writings to search. The block holder is the operator the block was given to: the number may have been ported since, so never name it as today's operator. A step that fails is already noted: go on. Record any other phone number of the case in E.164, the form `collect` prints.

## mentions
Search the web for the number, each writing in quotes: the first five printed by `collect`, then the others if nothing came up; at most ten searches, never the same results page twice. A results page is not a source; each page that shows the number is: `osint.mjs source <url> [--file <capture>] --reliability <A–F> -p <slug>`, then `osint.mjs entity url <url> --sources <S> --prop role=mention --prop site=<host> --prop "writing=<the writing found>" --prop seen=<YYYY-MM-DD> -p <slug>`, then a clue for what the page ties the number to (`osint.mjs clue "…" --status observed --sources <S> -p <slug>`). Company sites and business directories first; people directories only with `person=true`, and only what the purpose needs.

## process
`osint.mjs brain context -p <slug>`. Record what each mention names: a company (`entity organization "<name>" --prop siren=<SIREN>` when the page gives it), a site (`entity domain`), an account (`entity account <url>`) and the handle it shows (`entity username <handle>`), a person only with `person=true` and never a sensitive fact (GDPR article 9). Group the mentions by holder and by date: a number given to someone else shows up as two holders at two periods.

## analyse
Hypotheses for `owner` (who answers at this number: the company a page names, an agency, a former holder, nobody) and for `line` (its type and network: the plan's type, ported or not, a fiction block). `--refute-if` first. `hyp lr` with the clue's real status: `read` for the numbering plan and the ARCEP's register, `observed` for a page that shows the number, `inferred` for the block holder (portability) and for a directory entry. A page that copies another is not a second source.

## redteam
A sub-agent (or a separate pass) tries to refute the leading answer: a number given to someone else since the page was written, a directory that copied a stale entry, a forwarding or virtual number (VoIP), a block holder taken for today's operator, a template's placeholder left on a site. `osint.mjs redteam --file <verdict.json> -p <slug>`.

## conclude
`osint.mjs conclude --file <conclusion.json> -p <slug>` with the confidence per level and its criteria (those of the manifest), each alternative with its test; one answer.

## leads
`osint.mjs next --file <leads.json> -p <slug>`: `deep-mentions` when the first searches found little; the pivots — `company-fr` on a company the number points to (a SIREN read on a page, or the block holder), `domain` on a site that publishes the number, `username` on the handle of an account that shows it.

## deep-mentions
Every writing printed by `collect`, then searches limited to business directories, company pages and social networks (`site:` queries), one page read at a time; record each page that shows the number as in `mentions`. People directories only with `person=true` and its legal basis.

## refresh-mentions
Run the searches of `mentions` again. Skip the pages the case already has (`osint.mjs brain search "<host>" -p <slug>`); record each new one as in `mentions`; then write what changed over the engine's « none »: `osint.mjs note Case.md --block what-changed --file <md> -p <slug>` (a heading « What changed — <date> », one line per new page with its source id), and `osint.mjs log --phase leads "Refresh: <n> new mentions" -p <slug>`.
