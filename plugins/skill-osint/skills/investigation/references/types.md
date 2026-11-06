# Case types: the contract, and a type of the user's own

Contents: what a type is · a type of the user's own (private) · making one · type.json field by field · engine.js and
ctx · method.md · labels.json · templates/ · the widgets · requires · refresh · check list · common mistakes

## What a type is

A case type is a folder. The engine reads its `type.json` to make the case's form, frame, levels, phases, dashboard
tabs, actions, pivots and refresh; it runs its `engine.js` only when one of its commands is called; the agent follows
its `method.md`. Adding a type adds a folder: nothing to build, the dashboard draws it from the manifest.

```
<type>/
  type.json     the manifest (required)
  method.md     one `## <id>` section per phase, per action, per agent refresh step (required)
  engine.js     the type's commands (osint.mjs <type> <command> -p <slug>), when it has some
  labels.json   the words its engine.js and its templates write, in en and fr
  templates/    notes that replace the engine's for this type (optional)
```

The plugin's types live in the skill's `types/` folder; `osint.mjs types` prints each type's folder.

## A type of the user's own

A private type lives in the cases folder, `<cases folder>/.osint-types/<id>/`, with the same structure as a plugin
type, and is versioned with the cases (the skill's `.gitignore` keeps it).

- It loads after the plugin's types and never replaces nor changes one: a folder named like a plugin type is refused.
  To change what a plugin type does, copy it under a new id. Never edit a type in the plugin's folder: an update
  replaces it.
- Its id is its folder's name: lowercase letters, digits and dashes, neither an engine command nor a prompt tag
  (`new`, `list`, `types`, `refresh`, `doctor`, `lead`, `pivot`, `question`, `install`…). `osint.mjs types` says why a
  folder is refused; the other types load all the same.
- Its `engine.js` runs with the engine's rights. `doctor`, `list` and the dashboard never load it; `osint.mjs types`
  (to check its commands: `types --no-load` does not) and its own commands do, and so does a watch pass. **Before the
  first run of a private type, tell the user that its code will run on their machine, and in a cases folder you did not
  make, list its private types (`doctor` shows them with their folder) and read their `engine.js` first.** Write only
  inside `.osint-types/<id>/`; never install a dependency (no `npm install`, no `uv`, no download) without the user's yes.
- The engine refuses, before loading it, an `engine.js` that imports anything but a few `node:` modules (`path`, `url`,
  `util`, `crypto`, `buffer`, `string_decoder`, `querystring`, `zlib`, `events`, `assert`, `timers/promises`), a file of
  the plugin or a package, or that uses `import()`, `require`, a bare `fetch()`, `eval`, `new Function`, `globalThis`/`global`,
  `constructor.constructor` or `process.getBuiltinModule` (comments are ignored): it must go through `ctx`. This
  check is lexical: it keeps a mistake or an obvious shortcut out, it is not a sandbox, and JavaScript can spell what a
  word list does not name. What protects the user is their reading of the code first, and that the watch and the
  dashboard run a private type only for the code they approved on this machine (below). A private type cannot give the user's yes: its tunnel calls never carry `yes` nor `unmasked`, and it is
  never run by the watch before the user's yes (below).
- The dashboard marks it « Private »: its card in New case, its cases' cards, its line in Settings.
- Its cases need it: a case copied to another cases folder needs its type copied too. A case whose type was removed or
  is refused still opens (notes, graph, canvas), without its views, actions and refresh.
- Its Refresh runs its `engine.js`: the dashboard hides the button for a private type and its server refuses the call;
  run `osint.mjs refresh -p <slug>` yourself (the card's « Copy prompt » asks you to).
- It follows the skill's ethics like any type: passive by default; no login, no account made, no contact with the
  target; no SMTP probe, call, SMS nor messaging presence check; no sensitive data (GDPR article 9); no minors. Refuse
  a type whose purpose is to follow or locate a private person.

## Making one (there is no command for it: copy, then adapt)

1. Frame it with the user in one question: what a case starts from (the input), the question its cases answer (the
   levels, and what high, medium and low mean for each), the sources it may read (free and keyless first), what would
   be noisy. Say in the same message that the type is code (its `engine.js`) that will run on their machine with the
   engine's rights, and that you write only inside `.osint-types/<id>/`.
2. Run `osint.mjs types` from the cases folder, pick the closest type and copy its folder to `.osint-types/<id>/` with
   your file tools (or `cp -R` on macOS and Linux, `Copy-Item -Recurse` on Windows).
3. `type.json`: `id` becomes the folder's name, then each field below.
4. `engine.js`: keep the commands the type needs, rewrite them, drop the rest. Import `node:` modules only: drop any
   import of the plugin's files (`../../engine/lib/…`), whose path changes with each version of the plugin.
5. `labels.json` (en and fr), `method.md` (a section per phase, action and agent refresh step), `templates/` only when
   a note needs another shape.
6. Run `osint.mjs types` until the type's line reads `ok      <id> (private) — .osint-types/<id>`; each error is
   printed under the line (it loads the `engine.js`, so tell the user first that the code will run).
7. Tell the user: the folder, what the type does, that its `engine.js` runs with the engine's rights, that New case in
   the dashboard now offers it. Its first real case is its test: `osint.mjs new <id> <input> --question … --frame …`.

## type.json, field by field

| Field | What it is |
|---|---|
| `id` | the folder's name; the first word of `osint.mjs <id> <command>` and of the prompt items `[<id>:<action>]` |
| `label`, `icon`, `description` | the New case card and the case's tile; `icon` is a lucide name in kebab-case (`globe`, `store`) |
| `frame` | the frame questions that apply, besides the question and the purpose, always asked: `"noisy"` (ask or never, no default), `"image"` (may the image leave this machine, no default), `"person"` (a person as subject, then a GDPR legal basis), or `{ "id": "person", "always": true }` when the subject is always a person |
| `inputs` | the form (below) |
| `levels` | the hypotheses' levels, coarse to fine: `{ "id", "label", "criteria": { "high", "medium", "low" } }`; `conclude` asks a confidence per level and the criteria it meets |
| `phases` | `{ "id", "label" }` in order; `log --phase <id>` moves the case; each has its `## <id>` in method.md |
| `views` | the case's tabs after Brain, Graph and Canvas: widgets of the catalog (below) |
| `actions` | the static next actions: `{ "id", "label", "icon", "target", "prompt", "noisy", "minutes" }`; `target` is `case`, `hyp`, `evidence` or `entity:<kind>`; `prompt` reads `[<id>:<action>] {value}` (also `{hyp}`, `{file}`); each has its `## <action>` in method.md |
| `pivots` | the entity kinds a case of this type can start from: every case shows « New <label> case on <value> » on such an entity |
| `refresh` | the steps refresh runs again (below) |
| `requires` | what the machine needs (below) |

**Inputs**: `{ "id", "kind", "label", "required"?, "placeholder"?, "default"?, "when"? }`, `kind` one of `text`
(`multiline` optional), `url`, `file` (`accept`), `select`, `chips` (both with `options: [{ "value", "label", "icon" }]`,
every option with its icon) and `toggle`. `when: { "<input>": "<value>" }` (or a list of values) shows the field only
then; the engine refuses it otherwise. The first `required` input is the case's main input (`new <id> <value>`,
`{value}` in prompts).

**Entity kinds** (`pivots`, `entity:<kind>`, `ctx.entity`): `domain`, `url`, `ip`, `organization`, `person`, `email`,
`account`, `tracker`, `place`, `phone`, `image`, `video`.

`caps` (per-type caps of the likelihood ratios) is in the design, not read by the engine: leave it out.

## engine.js and ctx

```js
export const commands = {
  collect: {
    help: 'one line for the agent',
    flags: { only: 'string', all: 'boolean' },
    run: async (ctx, args, flags) => { /* … */ },
  },
}
```

`osint.mjs <id> collect --only x -p <slug>` runs it; the Journal records the command and the dashboard shows it live.

- **Write through ctx only**: never write a file of the case yourself. **Reach the network through `ctx.fetch` only**:
  never `fetch()`, `http`, nor a child process running curl. `ctx.fetch` keeps each host's rate, the cache, the
  User-Agent, one Journal entry per request, and the guard that refuses Gemini and Google Vision.
- Import the few `node:` modules the engine allows (see above) and nothing else: no file of the plugin, no package.
- A step that fails: catch it, `ctx.fail(text)`, go on to the next. A command that cannot run: `ctx.refuse(message)`
  (exit 1), or `ctx.refuse(message, 2)` when the user's yes is needed first.
- Export the pure parts (a parser, a check) next to `commands`, so that a test can import them.

| ctx | |
|---|---|
| `dir`, `slug`, `manifest`, `input`, `lang` | the case's folder, its slug, the manifest, the input values, the notes' language |
| `t(key, vars)` | a word from the type's `labels.json` (else the engine's), in the case's language, `{name}` filled |
| `state(patch?)` | the type's own space in case.json: read it, or merge `patch` into it |
| `entity(kind, value, { confidence, sources, aliases, props })` | an entity note, merged when it exists → `{ path, created }` |
| `clue(text, { status, where, credibility, constraint, sources, entities, title })` | a clue `C<nn>` → `{ id, path }`; `status` is `read`, `computed`, `observed`, `inferred` or `model` |
| `source({ url, file, body, contentType, archive, reliability, title })` | a source `S<nn>`, its capture kept and hashed (async) → `{ id, path, capture, sha256, status, body, contentType, url }` |
| `evidence(fileOrUrl, { of })` | an original `E<nn>`: copied, hashed, read-only (async) |
| `hyp({ title, level, under, refuteIf, point, radius, prior })` | a hypothesis `H<nn>` |
| `relate([kindA, valueA], [kindB, valueB], label, sourceId)` | a relation between two entities (graph, canvas) |
| `log(text)`, `progress(n, of, text)`, `fail(text)` | a step in the Journal; the live progress; a failure noted |
| `refuse(message, code = 1)` | stops the command |
| `fetch(service, pathOrUrl, opts)` | `{ url, status, headers, body: Buffer, ms, cached, journal }`; `service` is one of `SERVICES` in `engine/lib/net.js` (`rdap`, `crtsh`, `cdx`, `ripestat`, `internetdb`, `nominatim`, `entreprises`, `bodacc`, `overpass`…) or `web` for any `https://` URL (one call a second per host); `opts`: `method`, `headers`, `body`, `timeout`, `max`, `retries`, `cacheHours`, `accept` |
| `snapshot(name, items)` | items with a `key`: refresh compares them with the last run of `name` → `{ added, removed, changed }` |
| `view(name, data)` | writes `.osint/views/<name>.json`, which a widget reads |
| `timeline(items)` | dated items `{ date, label, ref, kind?, url? }` merged into the timeline |
| `resolver()` | DNS: `resolve(name, rrtype) → Promise<Array>` |
| `python`, `tunnel`, `media` | the GeoINT environment, the reverse search tunnel (a private type's call never carries `yes` nor `unmasked`), image and video helpers: see `types/geolocate-image/engine.js` |

## method.md

The agent's own steps for this type: one `## <id>` section per phase, per action and per agent refresh step (the engine
checks that each exists). Each section says in a few imperative lines the command to run, what to read and how, what to
record (`source`, `entity`, `clue`, `hyp`), and what never to do. An item `[<id>:<action>]` of a pasted prompt leads to
its `## <action>` section; `brain context` prints this file's path on its `method:` line.

## labels.json

`{ "en": { "<key>": "text with {name}" }, "fr": { … } }`: the words `engine.js` writes (`ctx.t(key, vars)`) and the
templates use (`{{key}}`). English is the fallback for the other languages; a key the type does not define falls back
to the engine's own labels.

## templates/

A type's `Case.md`, `Report.md`, `Leads.md`, `entity.md`, `clue.md`, `hypothesis.md` or `source.md` replaces the
engine's (`engine/templates/`) for its cases. Variables: `{{title}}` and every label (`{{notes}}`, `{{your_notes}}`,
`{{report}}`…, and the type's own keys). Keep the managed blocks of the engine's template, as they are:
`summary`, `conclusion`, `hypotheses`, `what-changed`, `related` in Case.md; `report` in Report.md; `leads` in Leads.md;
`facts` and `relations` in entity.md; `clue`, `analysis` and `source` in the others
(`%% osint:begin <name> %%` … `%% osint:end <name> %%`).

## The widgets (views)

Brain, Graph and Canvas are always there: do not list them. A type lists the others it needs, in tab order.

| `widget` | Reads | The type writes |
|---|---|---|
| `hypotheses` | the hypotheses, their shares, the ACH matrix | nothing more than the cycle commands |
| `sources` | the Sources notes | nothing more than `ctx.source` |
| `timeline` | `.osint/views/timeline.json` | `ctx.timeline(items)` |
| `table` | the entities of a `kind` (filtered by `where: { "<prop>": "<value>" }`), or the rows of `.osint/views/<view>.json` | `ctx.entity`, or `ctx.view('<view>', rows)`; `columns` names the properties shown, `label` and `icon` the tab |
| `map` | `.osint/views/map.json`, a GeoJSON FeatureCollection whose features carry `properties.role` (`candidate`, `excluded`, `sightline`, `pano`, `place`) and `label`, `ref`, `radius_m`, `heading`, `date`, `url`; plus the `place` entities with `lat` and `lon` | `ctx.view('map', featureCollection)` |
| `evidence` | the case's Evidence (originals, crops, captures), their hashes, the reverse search | `ctx.evidence` |
| `calibration` | `geolocate-image`'s eye guess against the answer | what that type writes; another type rarely needs it |

Two tables: `{ "widget": "table", "label": "Checks", "icon": "list-checks", "view": "checks", "columns": ["check", "status", "where"] }`,
`{ "widget": "table", "label": "Subdomains", "icon": "network", "kind": "domain", "where": { "role": "subdomain" }, "columns": ["value", "ip", "first_seen"] }`.
A private type uses the catalog's widgets only: a new widget is a change of the plugin.

## requires

```json
"requires": {
  "bins": [{ "id": "exiftool", "optional": true, "off": "video and XMP metadata are not read" }],
  "packs": [],
  "keys": [{ "id": "SOME_TOKEN", "optional": true, "off": "that source is skipped", "configure": "set SOME_TOKEN" }]
}
```

A tool or a key that is missing and not `optional` makes the type « needs … » in `doctor`, `osint.mjs types` and New
case; `off` says what stops working without it. Packs (`geoint`): as `types/geolocate-image/type.json` has them.

## refresh

```json
"refresh": [
  { "id": "crt", "by": "engine", "run": "collect --only crt", "noisy": false, "sends_image": false, "paid": false, "watch": true, "noun": ["certificate", "certificates"] },
  { "id": "checks", "by": "engine", "run": "collect", "noisy": false, "sends_image": false, "paid": false, "watch": false, "noun": ["check", "checks"] },
  { "id": "terms", "by": "agent", "section": "read-terms", "watch": false }
]
```

`by: engine` runs `osint.mjs <id> <run> -p <slug>` again; each `ctx.snapshot` it takes is compared with the last one,
and « What changed » goes to the Journal and to Case.md. Name the step's snapshot after the step's `id`
(`ctx.snapshot('crt', …)` for the step `crt`): the watch counts that snapshot's new items. `by: agent` gives the
agent a step: the `## <section>` of method.md.

Optional fields of a step, checked by the engine:

| Field | Meaning |
|---|---|
| `noisy: true` | refresh asks for the user's yes under `noisy: ask`, skips the step under `never` |
| `sends_image: true` | the step sends an image out of the machine |
| `paid: true` | the step costs money |
| `watch` | whether the automatic watch runs the step: true by default for an engine step; the engine forces `watch: false` for a noisy, image-sending or paid step, and never watches an agent step. `watch: true` is a manifest error on a noisy, image-sending or paid step (`refresh.<id>.watch: never true for a step that is noisy, sends an image or costs`) and on an agent step (`only an engine step can be watched`). Give `watch: false` to an engine step that contacts the target's own servers (its site, its pages), as `domain`'s `home` does |
| `noun: ["one", "many"]` | what the watch's notification counts, singular and plural, in English (« acme.fr: 3 new certificates »); without it, « <id> item(s) » |

A private type's `watch: true` is a claim, not a permission: its `engine.js` would then run without the agent, at each
pass. The engine watches a private type's case only after the user's yes (`osint.mjs watch --every 24h -p <slug>
--yes`, exit 2 without it; the dashboard cannot give it), and only for the code that yes covered: a changed `type.json`
or `engine.js` stops the passes until the user says yes again. That yes is kept on this machine (`watch-ok.json` in the
plugin's data folder), never in the cases folder: a watch found in a folder someone sent (`case.json`) does not run, for
a plugin type as for a private one, until a local `watch --every …` arms it. The same holds for a private type that is a
child of a watched person case: under the watch or a dashboard click it runs only for an approved hash, else the step
is skipped and the child's Journal says so (approve it with `watch --every … -p <child> --yes`). Ask for it only after the user has read the code, and
mark `watch: false` whatever should not run unattended.

## Check list

- [ ] `id` is the folder's name; `osint.mjs types` reads `ok … (private)`.
- [ ] Every option of a `chips` or `select` input has its icon; every `when` names another input.
- [ ] Every level has its high, medium and low criteria written.
- [ ] Every phase, action and agent refresh step has its `## <id>` in method.md.
- [ ] engine.js imports allowed `node:` modules only, writes through ctx, reaches the network through `ctx.fetch` only
  (`osint.mjs types` refuses it otherwise).
- [ ] Every engine refresh step's `run` is a command of engine.js, and takes a snapshot with keys named after the step.
- [ ] Every refresh step says `noisy`, `sends_image`, `paid`, `watch` and (an engine step) `noun`; one that contacts the
  target's own servers says `watch: false`.
- [ ] labels.json has `en` and `fr` for every key engine.js and the templates use.
- [ ] Nothing in the type contacts the target, logs in or makes an account; a noisy step says `noisy: true`.

## Common mistakes

| Mistake | Instead |
|---|---|
| editing a type in the plugin's folder | copy it to `.osint-types/<new id>/`; an update would replace the edit |
| keeping the copied type's `id` | the folder's name, else `osint.mjs types` refuses it |
| `fetch()` or `fs.writeFileSync` in engine.js | `ctx.fetch`, then `ctx.source`, `ctx.entity`, `ctx.clue`, `ctx.view` |
| an import of `../../engine/lib/…`, `node:fs` or `node:child_process` left from the copy | the allowed `node:` modules and ctx only; the type is refused otherwise |
| installing a package for a type, or running its engine.js before the user knows | never without their yes; tell them the code will run |
| a `watch: true` step taken as already allowed | it is the manifest's claim: the watch needs the user's yes (`watch --every … --yes`) |
| a widget name the catalog does not have | a widget of the catalog (a `table` with a `view` shows any rows) |
| looking for a private type's method.md in the skill's `types/` | the path on `brain context`'s `method:` line, or `osint.mjs types` |
| looking for a command that makes the type | there is none: copy a type, edit it, run `osint.mjs types` |
