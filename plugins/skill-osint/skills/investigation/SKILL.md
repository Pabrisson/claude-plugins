---
name: investigation
description: Runs OSINT investigations as cases, each an Obsidian vault shown live in a dashboard. A case starts from a domain or website, an image to geolocate, an image or video to verify, a username, a French company, an email, a phone number, an IP, a place or a person. Use it to investigate, look up or verify any of these, also when asked to call, text or probe a target (refused), to take up, refresh, watch, stop watching or export a case, for a private case type, or for a pasted OSINT dashboard prompt (« qui est derrière ce site », « où a été prise cette photo », « cette photo est-elle vraie », « sur quels sites est ce pseudo », « ce SIREN … », « à qui est cet email, cette boîte existe-t-elle », « à qui est ce numéro », « à qui est cette IP », « qu'y a-t-il à cette adresse », « enquête sur la personne … », « reprends l'enquête … », « surveille l'enquête … », « exporte l'enquête en PDF », « crée un type d'enquête privé », « osint follow-up », « osint case … start »).
argument-hint: "[<domain, URL, email, phone number, IP, address or lat,lon> [question] | <image or video path> [question] | resume <case> | refresh <case> | watch <case> <6h|12h|24h|7d|off> | export <case> [--journal] | dashboard [<case>] | setup [geoint] | <a prompt copied from the dashboard>]"
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/engine/osint.mjs" *), Bash(node ${CLAUDE_SKILL_DIR}/engine/osint.mjs *)
---

# OSINT investigation

A case is an Obsidian vault (notes the user can edit, a Journal, a canvas graph) plus `.osint/` (what the engine computes). The engine is `node "${CLAUDE_SKILL_DIR}/engine/osint.mjs"` (quote the path: spaces, Windows backslashes), called `osint.mjs` below. It runs on macOS, Linux and Windows, and this skill works with any agent: use your own question tool for choices (AskUserQuestion in Claude Code, else numbered options), web search, page reading, a browser and sub-agents when you have them.

Everything lives in the current folder (`$OSINT_DIR` overrides it), one folder per case; commands on a case take `-p <slug>`. Talk to the user in their language, write the cases' content in the session's language (`--lang`), keep code and technical files in English (the dashboard is in English, French in its Settings). Never commit for the user.

## Before anything

Run `osint.mjs doctor` once per conversation. A `MISSING` line: give its fix and stop. A `missing` line: say what stops working, go on. `missing geoint pack`: `geolocate-image` cannot run; tell the user what `osint.mjs setup geoint` downloads (exit 2 shows it: the models' size, StreetCLIP's licence, the free space), ask, then `setup geoint --yes`. `doctor` lists a folder's private types with their path and never loads them: in a folder you did not make, tell the user and read their `engine.js` before `osint.mjs types` or one of their commands.

## Ethics (hard rules)

- Passive by default: no connection, account, contact or interaction with the target. A sign-up probe, and any read of the target's own site (the `domain` home page and legal notice), is `noisy`: `noisy=never` skips or refuses it, `noisy=ask` exits 2: ask the user for that action only, then `--yes`.
- Never a password reset, a call, an SMS, a presence check in a messenger. For a leak, only its name. No minors.
- Never probe an address's mail server (SMTP `RCPT TO`, `VRFY`, a connection to the MX), even when the user asks: it contacts the target. Refuse, say why, and offer the passive steps instead (`email collect`).
- Asked to call or text a number, or to check whether it has a WhatsApp, Telegram or Signal account: refuse, say why (it contacts the holder or tells them someone looked), and offer the passive steps instead (the numbering plan, the block holder, the number's mentions on the web).
- An IP case reads registries and published lists only: never scan, ping, port-test or connect to the address under investigation, nor submit it to a service that would probe it.
- An image leaves this machine only when the frame says so (`image_may_leave: true`) and never with a person visible: mask first (`evidence mask E01 --box x,y,w,h…` or `--people`, then look at the mask) or, having looked at the whole image and seen nobody, declare it (`--no-people`). `--unmasked` (people left visible, to find exact copies) exists for `verify-media` cases only, with the user's yes (`references/reverse-search.md`); any other type refuses it, so say so instead of working around it. A case about where a particular person was follows the `person` rule (legal basis); a private person's home is never searched.
- A city or a region is not a place case: ask for a street address or coordinates.
- Refuse a target that is harassment or tracking of a private person. A person as subject needs a legal basis in the frame.
- A person as the case's subject (`new person`): a purpose and a GDPR legal basis first; each identifier with why the purpose needs it (`person plan`), or dropped; the user chooses which child cases to open, never open one they did not choose.
- Never data of GDPR article 9 (health, religion or belief, sex life or orientation, political opinions, racial or ethnic origin, trade-union membership, genetic or biometric data) in a person case nor in any case below it: the engine refuses it from the CLI and withholds it from a type's collection; do not write it in a note or a hypothesis either.
- Never a street address as an identifier, never help to find, contact or follow a private person, never a minor: refuse in one sentence (the engine refuses too).
- Each type's `method.md` opens with its own hard rules (a residential IP, a home, a company's officers): they bind as these do.

## Exit codes

0 done · 1 error or refusal (read the message, fix, retry) · 2 the user's yes is needed (ask, rerun with `--yes`) · 3 a tool is missing (degraded mode, say so).

## Modes (the request's first words)

- A new case: below. `resume` or a question about a case: `brain context -p <slug>` first, then answer citing its notes (`references/brain.md`). `refresh`: `references/follow-up.md`. **watch** (« surveille <case> toutes les 24 h », « préviens-moi s'il y a du nouveau », "watch <case>", "stop watching"): `references/follow-up.md` (Watch), then `osint.mjs watch -p <slug> --every 6h|12h|24h|7d|off`; tell the user which steps run (the command prints them) and that the dashboard server stays on for it. **export** (a PDF of a case): `references/follow-up.md` (Export PDF and Print view), then `osint.mjs export -p <slug> [--journal]`. `dashboard`: `osint.mjs dashboard [-p <slug>] --open`, give the URL. `setup`: `references/setup.md`. A pasted prompt: see Pasted prompts.
- **A case type** (« crée un type d'enquête », « modifie le type domain »): read `references/types.md` first. Never edit a type of the plugin's `types/` folder, not even when asked to change `domain`: make a private copy under a new id in `.osint-types/<id>/`. A private type is code: before you write it, tell the user its `engine.js` will run on their machine with the engine's rights. Refuse a type made to follow or locate a private person.

## A new case

1. Ask the frame in **one** question: the question to answer, the purpose, `noisy` (ask or never) and, by type, `image_may_leave` and `person` with its legal basis. No default for `noisy` nor `image_may_leave`. A type may propose the legal basis (`company-fr`: « Legitimate interest — public registry data »): say it in the frame question; the user may name another; without `--frame legal_basis` the engine writes the proposed one in Case.md.
2. A file input: `osint.mjs new <type> --file "<path>" --question … --frame image_may_leave=true|false --frame noisy=ask|never --lang …` (an image given in the conversation is saved to a file first). Otherwise `osint.mjs new <type> <input> --question "…" --frame noisy=ask|never [--frame k=v…] --lang <session language>`, then `osint.mjs dashboard -p <slug> --open` and give the user its URL.
3. Right after `new`, read the type's `method.md` in full (its path is the `method:` line of `brain context`, for a plugin type and a private one alike): it is the procedure (for an image, the gut call comes first, then `recon`). Naming the place from your own recognition without its phases is not an answer. Follow its phases (one section per phase) through the red team and `conclude` without asking the user anything more (the frame is set): a step whose output looks degraded or fake is noted with `log --fail` and you go on. Frame every step done outside the engine with `log --phase <id> "<what>"`. Then the red team, `conclude`, `next`, and a few lines of summary with the dashboard link.

## Writing into the case

Always through the engine (`source`, `evidence`, `entity`, `clue`, `hyp`, `note`) so properties, Journal and live view stay right. A negative coordinate after an option is written joined (`--at=-33.8568,151.2153`); the `truth` and `run` commands take their arguments as they are. A claim cites its Journal entry (`[[Journal#^j042]]`) or its source. A tool that fails is noted (`log --fail`) and you go on, never looping on a results page.

## Pasted prompts

- `osint case <slug>: start`: the frame is written, go on from step 3.
- `osint follow-up (case <slug>)`: `brain context`, then each item in order: `[<type>:<action>]` is the `<action>` section of that type's `method.md`, wherever it is (the `method:` line of `brain context`); `[lead:Lnn]` the lead; `[pivot:<type>]` is `new <type> <value> --parent <slug> --from <note>` (inherits the frame); `[refresh]`; `[question]`; `[install] <tool>` is `setup <tool>`. End with one line per item.
- An item that ends with `(case <slug>)` (a child's step handed back by a person's Refresh) is done in that case, `-p <slug>`.
- `osint (all cases)`: `brain search --all` / `brain entities --all`.

## References

| The request touches | Read |
|---|---|
| the cycle's commands and rules: sources, evidence, clues, hypotheses, likelihood ratios, exclusions, red team, conclusion; a time or a day from shadows or the weather (`sun`, `weather`) | `references/cycle.md` |
| taking a case up, answering about it, searching cases, editing notes, shared entities | `references/brain.md` |
| refresh, the watch, a case as a PDF or the print view, next actions, leads, pivots and child cases, the dashboard's prompts | `references/follow-up.md` |
| a picture that may leave this machine: masks, the tunnel, each engine's link, reading results, verdicts | `references/reverse-search.md` |
| doctor's lines, setup (`setup geoint` included), keys (the Mapillary token), the dashboard server, .gitignore | `references/setup.md` |
| a case type's own steps, hard rules and pitfalls | its `method.md` (the `method:` line of `brain context`) |
| a case type of the user's own: making, changing or checking one; the contract of a type | `references/types.md` |

## Common mistakes

| Mistake | Instead |
|---|---|
| Editing a type in the plugin's folder | A private copy in `.osint-types/<new id>/` |
| Excluding a hypothesis on an `observed` or `model` clue | Only a `read` or `computed` clue excludes |
| Quoting a likelihood ratio the engine capped as stronger | Quote the capped one |
| Promising a watch every few minutes, or one that reads pages or searches images by itself | The watch runs the engine's free refresh steps only, every 6h at the most |
| Averaging two hypotheses or two candidate points | One answer, one point, no midpoint |
| A match quoted without a Journal entry | Cite `[[Journal#^jNNN]]` |
| Writing `Case.md` by hand | Go through the engine; free text via `note <path> --block agent` |
| Asking the frame in several questions | One question |
| Sending an image with people unmasked | Mask, or look and declare `--no-people`; `--unmasked` only in `verify-media` |
| Judging matches on a sheet | One image at a time, at full size |
