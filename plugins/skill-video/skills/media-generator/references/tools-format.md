# The tool catalogs

`engine/tools/image.json`, `video.json` and `audio.json` list the tools. The dashboard's tool picker and Claude read
the same files: a new tool is a new entry, nothing else to code.

```json
{
  "id": "dolly-zoom-in",
  "label": "Dolly zoom in",
  "group": "Camera",
  "mode": "create",
  "icon": "zoom-in",
  "description": "Pushes in while zooming out: the background stretches, the subject holds.",
  "inputs": [{ "key": "first_frame", "kind": "image", "label": "Image", "optional": true }],
  "fields": [
    { "key": "subject", "label": "Subject", "type": "text", "placeholder": "the dancer in the red coat" },
    { "key": "speed", "label": "Speed", "type": "choice", "options": ["slow", "steady", "fast"], "default": "steady" }
  ],
  "template": "Dolly zoom on {subject}: the camera dollies in at a {speed} pace… {prompt}",
  "models": ["kwaivgi/kling-v3.0-pro", "bytedance/seedance-2.5"]
}
```

| Key | What it is |
|---|---|
| `id` | Unique in its file, letters, digits and `-` |
| `label`, `description` | What the dashboard shows, in English, sentence case |
| `group` | The picker's group: Custom, Style, Camera, VFX, Frames, Characters, Light & color, Retouch, Voice |
| `mode` | `create` or `edit`: the composer's segmented control |
| `icon` | A lucide icon name (kebab-case) |
| `inputs` | The files it takes, in the order they are sent (below) |
| `fields` | The settings the template uses (below) |
| `presets` | Setups that fill several fields at once: `[{ "label": "Noir", "fields": { "lens": "…", "grade": "…" } }]`, chips above the fields |
| `template` | The prompt: `{key}` is a field's value (or its default), `{prompt}` the user's own words |
| `models` | Router model ids, recommended first; without it, any model of the kind |
| `params` | Settings forced for this tool, such as `{ "resolution": "4K" }` or `{ "background": "transparent" }` |
| `local` | Done on the machine: `reframe` (ffmpeg, free), `extend` (a frame of the source, then the new shot joined), `expand` (the image padded with gray margins from its `margin` fields, sent at the model's closest ratio) |
| `provider` | `elevenlabs` for the tools video-editor's engine does (change voice, translate) |

Fields (`type`):
- **choice**: a few `options`, as chips. **select**: a long list, as a searchable button (beside the composer, grouped, a
  line on each). **multi**: several options in the order picked, joined by `, then ` (camera moves).
- **text**, **number** (min, max, step, unit: a slider), **color**.
- **light**: the lights around the subject, placed on a stage (`lights`: how many at most); its value is the light in
  words. With `options` (presets, each with its `rig` of lights), the dashboard offers Preset, Custom and Describe.
- **margin**: Expand's share of the image added on one side (0 to 2), set by the dashboard's frame editor.
- **style**: a look, picked in the dashboard's style gallery (a card per preset, the user's own from the Library under
  « Yours »). `"options": "styles"` takes the shared list of `tools/styles.json` (Restyle and Custom use it; a
  `default` may be one of its labels); without a `default` the field is optional (Custom: a × clears it). A style of
  the Library (`styles/<name>/`, its value is its name) stands for « the last reference image(s): their medium,
  palette… (its words) » in the prompt, and its images go last among the references.
- An option is a value, or `{ "value", "label", "group", "note" }` (a style adds `swatch`: 3 or 4 colors for its
  card until the user has a result in it, then the card shows that result); `"value": ""` with `"label": "Auto"` leaves the field
  out of the prompt. On the command line, a label stands for its value (`--field light=Silhouette`).
- `phrase` wraps a field's value in the template (`"Shot on {}"`), so an empty one leaves nothing behind.
- `section` puts fields under one heading, the selects as tiles two a row.

Inputs (`kind`):
- **image**: images. For an image model, every image input becomes a reference, in the order of `inputs`, so the
  template can say « the first image », « the second image ». For a video model, `first_frame` and `last_frame` are
  the frames, the others (`references`, `sketch`) references.
- **video**: the source of a video edit, sent as a video reference.
- **audio**: a sound (a talking avatar's voice; a voice to clone with `voice_clips`).
- **sketch**: a picture the user drew on (a frame with marks), sent as an image reference. The template says what
  the marks mean.
- **mask**: the image (or a frame of the video, picked along it) with an area the user painted in translucent magenta
  (brush, eraser, lasso), sent as an image reference. The template names the magenta area.
- **media**: an audio or a video file (ElevenLabs tools).
- `optional: true` when it may be left out, `multiple: true` when it takes several files (the dashboard caps them at
  what the chosen model takes, « 2 / 13 »).
- `phrase`: how the prompt names the input's images, `{}` their place, put where the template says `{key}`:
  `"Match the light of {}."` gives « Match the light of images 2 to 3. », nothing without a file. An image model gets
  every input in order (« the second image »); a video model its `references` and `sketch` apart from its frames
  (« the first reference image »).

A template reads well with any field left empty: the engine drops empty parentheses and folds the punctuation left by
empty fields into one mark (the dashboard's `fill` does the same; its read-only prompt shows a placeholder not filled
yet as `{key}`, never sent). Test a
new tool with `media.mjs <kind> --tool <id> … --estimate`: it prints the filled prompt and the price without
spending.
