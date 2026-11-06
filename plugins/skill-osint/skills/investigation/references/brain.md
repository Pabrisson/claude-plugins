# The case as a second brain

Contents: context · search · show · entities · the vault · what is authoritative.

## Taking a case up, or answering about it

Always `brain context -p <slug>` first: its `method:` line is the path of the case type's `method.md`, a plugin type's or a private one's: the phases and the `[<type>:<action>]` items are sections of that file. Then status, phase, question, counts, the ranking, the leads and **« Edited in the vault since the agent's last command »**, the notes the user changed in Obsidian. Read those notes before acting: the user's edit wins over what you remember.

- `brain search "<text>" [-p <slug> | --all] [--kind <a folder: Clues, Sources, Hypotheses… or an entity kind: domain, person…>]`: matches as `slug/path:line: text`.
- `brain show -p <slug> <C03 | S01 | H02 | note title | Journal#^j042>`: a note's properties, body and backlinks, or one Journal line.
- `brain entities [-p <slug> | --all] [--kind k] [--shared]`: entities; `--shared` lists those in at least two cases.

Answer by citing the notes (`[[C03 …]]`, `[[Journal#^j042]]`), not by paraphrasing from memory. For several cases: `brain search --all`, `brain entities --all --shared`.

## The vault

`Case.md` (frame, hypotheses table, ACH matrix, conclusion), `Journal.md` (one line per engine action, `^jNNN`), `Report.md`, `Leads.md`, folders `Entities/ Clues/ Sources/ Hypotheses/ Evidence/`, `Graph.canvas`. Managed blocks (`%% osint:begin <name> %%` … `%% osint:end <name> %%`) are rewritten by the engine: never write inside them by hand; free text goes through `note <path> --block agent`. The text outside the blocks and the properties the user edited are theirs.

## What is authoritative

The notes carry what the user can edit; `.osint/` (`case.json`, `analysis.json`, `events.jsonl`, `views/`, snapshots) carries what the engine computes. If they disagree on something the user typed, the note wins; on a computed value (shares, ids), the engine does. Notes are edited in Obsidian, not in the dashboard.
