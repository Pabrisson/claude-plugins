# The case as a second brain

Contents: context · search · show · entities · an investigation and its sub-cases · workspaces · the vault · what is authoritative.

## Taking a case up, or answering about it

Always `brain context -p <slug>` first: its `method:` line is the path of the case type's `method.md`, a plugin type's or a private one's: the phases and the `[<type>:<action>]` items are sections of that file. Then status, phase, question, counts, the ranking, the leads and **« Edited in the vault since the agent's last command »**, the notes the user changed in Obsidian. Read those notes before acting: the user's edit wins over what you remember.

- `brain search "<text>" [-p <slug> | --all] [--kind <a folder: Clues, Sources, Hypotheses… or an entity kind: domain, person…>]`: matches as `slug/path:line: text`.
- `brain show -p <slug> <C03 | S01 | H02 | note title | Journal#^j042>`: a note's properties, body and backlinks, or one Journal line.
- `brain entities [-p <slug> | --all] [--kind k] [--shared]`: entities, each case with its `root`; `--shared` lists those of at least two investigations (a case and its own sub-cases are one).

Answer by citing the notes (`[[C03 …]]`, `[[Journal#^j042]]`), not by paraphrasing from memory. For several cases: `brain search --all`, `brain entities --all --shared`.

## An investigation: a case and its sub-cases

A pivot makes a sub-case: its own folder and vault (`new … --parent <slug>`), but one investigation with the case it came from. `brain context -p <top case>` ends with every sub-case below it (type, status, answer, confidence, question); `brain search` and `brain entities -p <slug>` cover the case and its sub-cases. A sub-case's `brain context` names its investigation's top case (`investigation: <slug>`). The dashboard shows one card per investigation, and its page runs everything of its sub-cases (Refresh, Watch, Export, next actions, pivots): what it adds for a sub-case ends with `(case <slug>)`, done in that case.

## Workspaces

Groups of investigations, like media-generator's; nothing moves on disk (each case's `case.json` says its workspace, the whole tree shares its top case's). `osint.mjs workspaces` lists them (`*` the current one); `workspaces new <name>` makes one and makes it current; `workspaces use <slug>`; `workspaces rename <slug> <name>`; `workspaces remove <slug>` (its cases go back to `default`, none deleted; `default` stays); `workspaces move <case> <slug>` moves the whole investigation. A new case joins the current workspace (`new … --workspace <slug>` for another; a sub-case always stays in its parent's). `list --workspace <slug>` keeps one. The dashboard's bar switches the current one too.

## The vault

`Case.md` (frame, hypotheses table, ACH matrix, conclusion), `Journal.md` (one line per engine action, `^jNNN`), `Report.md`, `Leads.md`, folders `Entities/ Clues/ Sources/ Hypotheses/ Evidence/`, `Graph.canvas`. Managed blocks (`%% osint:begin <name> %%` … `%% osint:end <name> %%`) are rewritten by the engine: never write inside them by hand; free text goes through `note <path> --block agent`. The text outside the blocks and the properties the user edited are theirs.

## What is authoritative

The notes carry what the user can edit; `.osint/` (`case.json`, `analysis.json`, `events.jsonl`, `views/`, snapshots) carries what the engine computes. If they disagree on something the user typed, the note wins; on a computed value (shares, ids), the engine does. Notes are edited in Obsidian, not in the dashboard.
