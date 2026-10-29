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
| `group` | The picker's group: Free, Camera, VFX, Frames, Characters, Light & color, Retouch, Voice |
| `mode` | `create` or `edit`: the composer's segmented control |
| `icon` | A lucide icon name (kebab-case) |
| `inputs` | The files it takes, in the order they are sent (below) |
| `fields` | The settings the template uses: `choice` (options, chips), `text`, `number` (min, max, step, unit: a slider), `color` |
| `template` | The prompt: `{key}` is a field's value (or its default), `{prompt}` the user's own words |
| `models` | Router model ids, recommended first; without it, any model of the kind |
| `params` | Settings forced for this tool, such as `{ "resolution": "4K" }` or `{ "background": "transparent" }` |
| `local` | Done on the machine: `reframe` (ffmpeg, free), `extend` (a frame of the source, then the new shot joined) |
| `provider` | `elevenlabs` for the tools video-editor's engine does (change voice, translate) |

Inputs (`kind`):
- **image**: images. For an image model, every image input becomes a reference, in the order of `inputs`, so the
  template can say « the first image », « the second image ». For a video model, `first_frame` and `last_frame` are
  the frames, the others (`references`, `sketch`) references.
- **video**: the source of a video edit, sent as a video reference.
- **audio**: a sound (a talking avatar's voice; a voice to clone with `voice_clips`).
- **sketch**: a picture the user drew on (a frame with marks), sent as an image reference. The template says what
  the marks mean.
- **media**: an audio or a video file (ElevenLabs tools).
- `optional: true` when it may be left out, `multiple: true` when it takes several files.

A template reads well with any field left empty: the engine drops empty parentheses and doubled punctuation. Test a
new tool with `media.mjs <kind> --tool <id> … --estimate`: it prints the filled prompt and the price without
spending.
