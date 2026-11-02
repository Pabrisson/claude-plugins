# The Library and the workspaces

Read it before making, changing or citing an Element or a style of the user's own (`@name`), a References sheet, or
anything about a workspace. `media.mjs` means `node "${CLAUDE_SKILL_DIR}/engine/media.mjs"`, as in SKILL.md.

Contents: Elements and styles of the Library (types, citing, making one, changing one, References tools) · Workspaces

## Elements and styles of the Library

The Library keeps what comes back from one generation to the next. Making or changing an Element or a style is free
and local: no estimate, no yes.

- **Elements** (`elements/<name>/`) each have a type, which tells the model what their images are: `character` (a
  person, a creature, a mascot), `outfit`, `object` (a product, a prop, a vehicle), `location`, `pose` (a body pose,
  nothing else), `brand` (a logo kept exact, its colors and typeface), `voice` (1 to 3 clips of speech: Voice, Change
  voice, a character's own voice), `singer` (1 to 3 sung clips: Music's Singer once Suno has it, `references/audio.md`), `other` (one
  made before the types). Switching a voice to a singer and back keeps its ElevenLabs id and its Suno singer.
- **Citing.** `@name` in any image or video prompt (Custom, a tool's words, a raw prompt) sends the Element's images
  after the tool's own and names them: « Lulu (the character in images 2 to 3, <its words>) ». Their images count
  toward the model's references (`N refs`). On Kling 3.0, Kling 3.0 Omni and Kling 4.0 (Kie) they go instead as
  Kling's own named elements, whole: the prompt keeps `@name`, its words and 2 to 4 images go with it (Kling 3.0 takes
  3, the others 7; Kling 4.0 none beside a first or last frame), and they count toward no reference image.
  A style is never cited: it goes in a Style field (`--field style=<name>`).
  A voice is never cited in words either: `audio --tool voice --voice @name` speaks with it (on ElevenLabs, whole; on
  a router's model that clones, its clips cloned and its words saying how it sounds); a singer sings with `--field
  singer=@name`.
- **Making one**, when the user asks (« crée le personnage Lulu avec ces photos », « garde ce produit », « fais-en un
  style ») or pastes « Ask Agent » from the dashboard:
  1. Look at the images (Read) and write what it is in a few English words: they go with every `@name`.
  2. **2 images at least** (a voice: clips): `elements add` refuses fewer. With one image only, make the second view
     yourself with the type's References tool on it (`media.mjs image --tool character|outfit|object|location|pose
     --in references=<the image> --field sheets="<the sheet it lacks>"`, e.g. a full-body turnaround beside a face, a
     detail sheet beside six views): its price, the user's yes, then look at it (Read) and keep it only if it holds the
     identity. A brand or other takes a second version from the user.
  3. `media.mjs elements add <name> <files…> --type <type> --words "…"`; a brand adds `--colors "#hex,#hex"` and
     `--font "…"`, a voice takes audio clips. `--from <generation id>` takes a result's images or clips (several
     `--from` for several). A style: `media.mjs styles add <name> <images…> --words "<the look>"` (1 to 5 images,
     `--from` too); a sound style (« crée un style musique… »): `media.mjs styles add <name> --for music|voice|sound
     --words "<how it sounds>"`, in English, an artist's sound described without their name.
  4. Photos that are not clean references (a busy background, one angle only) for a type with a References tool:
     offer its sheets first. That is a generation: its price and the user's yes (SKILL.md's step 3). Then save the sheets
     that came out right, with the photos when they help.
  5. Tell the user the `@name` to cite. The open dashboard shows it at once.
- An Element made before this rule with one image works as before, except on Kling's elements: the command says so;
  make its second view as in step 2 (`elements set <name> --from <that generation>`).
- **Changing one.** `elements set <name> [<files…>] [--type …] [--words …] [--colors …] [--font …] [--drop <file>]`,
  `elements show <name>`, `elements remove <name>`; the same `set`, `show`, `remove` for `styles`. `elements
  elevenlabs <name>` puts a voice on the ElevenLabs account for Change voice (ElevenLabs needs a paid plan for it);
  `elements suno <name>` makes a singer a Suno voice (`references/audio.md`, « One's own singing voice in Suno »).
- **References tools** (image, group References): `character`, `outfit`, `object`, `location`, `pose`. They only make
  images in `media/`, never an Element by themselves. Each sheet picked (`--field sheets="Body turnaround, Face
  close-up"`, their labels in `media.mjs tools image --search references`) is its own job at its own ratio, and the
  estimate is their total. The first sheet sets the look; the others wait for it and take its image as the `sheet` to
  match. They need words (`--field who="…"` for a character, `--field what="…"` for the others) or photos (`--in
  references=<file>`), or both; a style is optional (`--field style=…`). To redo one sheet: the same tool with `--field
  sheets=<that one>` and `--in sheet=<the first sheet's image>`. A brand has no tool: a model redraws a logo wrong,
  the real file goes in.

## Workspaces

A workspace is a project: its media, its Elements and a timeline. « Default workspace » is there from the start.
**Every new generation joins the current workspace**, yours and the dashboard's (`--workspace <slug>` on `image`,
`video` or `audio` puts one in another, `--out <folder>` in none); so does a new Element (`elements add … --workspace <slug>|none` for another
or none). The dashboard's header switches it.

- `media.mjs workspaces` lists them (`*` the current one); `workspaces new <name>` makes one and makes it current;
  `workspaces use <slug>` switches; `workspaces add <slug> <generation ids…>` (and `drop`) puts results in or out.
- `media.mjs workspaces show <slug>` gives its files, its Elements and its timeline in words (`--json` for all of
  it). The user lays the timeline in the dashboard (Workspace › Timeline: the main track V1 holds the shots end to
  end, numbered #1, #2…; the tracks above overlay it, the audio tracks mix); you only read it. Its clips' menus
  (Generate: a tool on the clip as it is cut, or from its frame; Extend after or before; Freeze frame; Fit to the
  format; Voice here; ✦ Bridge shot on a cut) fill the dashboard's composer, and the result lays itself by its clip.
- A pasted prompt that starts with `/skill-video:video-editor Make a video from my media-generator workspace` is
  for the video-editor skill: its clips, their times and their sound are an exact edit, keep it.
