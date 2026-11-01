# Each model's own settings and editors

Read it when the user's wish needs a model's own setting or editor (`media.mjs models <kind>` lists them). `media.mjs`
means `node "${CLAUDE_SKILL_DIR}/engine/media.mjs"`, as in SKILL.md.

Contents: `--option` · shots · middle frames · omni references · a voice of one's own · spoken lines · who speaks ·
Library voices · draft · dialogue

**Each model's own settings and editors** (`media.mjs models <kind>` lists them: `options …`, `N shots`, `N middle
frames`, `masks of who speaks`, `N Library voices`, `draft then final`, `dialogue`). Use them when the user's wish needs
them; the dashboard shows the same in its Options block and editors.
- `--option <key>=<value>` (repeat it): the model's own settings by the names its API gives them, a choice by its value
  or its label: `negative_prompt="…"` (Avoid), `prompt_extend=on|off`, `cfg_scale=0.4`, `web_search=on`,
  `return_last_frame=on` (also saves `last-frame.jpg`, to start the next shot from), `output_format=png|jpeg|webp|mov`,
  `output_compression=80`, `thinking_mode=on`, `color_palette="#112233 #445566 #778899"` (3 to 10), `temperature=1.2`,
  `filler_words=on`, `pe_fast_mode=on`, `keep_original_sound=on`, `audio_setting=origin`, `personGeneration=allow_adult`,
  `enable_translation=off`, `loop=on` (Grok: its first frame ends it too), `reference_link_urls=<a public page>` or
  `reference_file_urls=<a PDF, Word, slides…>` (Wan 3.0: a video made from it). OpenRouter's go under its provider's
  name by themselves. One the model lacks is refused with its list.
- **Shots** (Kling 3.0 and 3.0 Omni on Kie): `--shot "<seconds>: <words>"`, one a shot in order (1 to 12 s each, their
  sum a length the model makes, 15 s at most), with `--tool free`; `@names` work in them.
- **Middle frames** (Kling 4.0: up to 8, in order, cited `@keyframe_1`…; Grok Imagine Video: up to 4, each at its time):
  `--in mid_frames=<image>` (Grok: `--in mid_frames=<image>@<seconds>`). Kling 4.0's length caps all its frames, first
  and last included: 3 s → 4, 4 s → 5 … 9 s and more → 10 (refused before, free). No reference image beside frames.
- **Omni references** (Kie: Kling 4.0, Kling 3.0 Omni, Seedance 2.x, Wan 3.0, Wan 2.7, Hailuo 3, Vidu Q4; the counts in
  `models video`): reference videos `--in ref_videos=<video>`, sounds `--in ref_audios=<audio>`, with `--tool free` or
  Cinematic camera, never beside a frame; each within the model's lengths (Kling 4.0 2 to 30 s, 30 s in all; Seedance 2.0
  2 to 15 s, 15 s in all). Kling 4.0 wants each cited: `@image_1`, `@video_1` in the words (the command adds the missing
  ones at the end); 15 references in all (images, videos, Elements, voices). A video given changes the price to the
  model's « with video input » rate.
- **A voice of one's own** (Kling 4.0): `--in ref_voices=<clip>@<Name>`, cited `@Name` in the words; up to 3 with the
  Library's. A character Element can carry its own voice: `elements set Papi --voice @Narrator` (a voice of the
  Library); it then speaks with it wherever `@Papi` is cited on Kling 4.0, without counting among the 3, and on Kling 3.0
  and 3.0 Omni (its first clip, 5 to 30 s). Wan 2.7 on Kie: a reference sound (`--in ref_audios=`) is the voice its
  subjects speak with beside references, the sound the video follows from words alone; a photo and a voice make a
  talking head on it too (Talking avatar, as long as the voice).
- **Spoken lines** (any video model with sound: the lips follow them): `--say "@Papi: Bonjour"`, `--say "@Papi
  (@Narrator): Bonjour"` (in that voice, Kling 4.0), `--say "(@Narrator): Il était une fois"` (off screen), in order;
  written after the words as « @Papi says: "Bonjour" ».
- **Who speaks** (OmniHuman 1.5, Talking avatar): `--in speaker_masks=<mask>`, the person painted white.
- **Library voices** (Kling 4.0): cite a voice Element `@Narrator` in the prompt: its clip goes as the voice of that name.
- **Draft** (Seedance 2.5 on Kie): `--option draft=on` makes a 480p preview; once the user likes it, `--from-draft
  <generation>` makes its 1080p final within 7 days (no prompt; Kie lists no price for it: an unknown cost, its own yes
  then `--accept-unknown`).
- **Dialogue** (ElevenLabs v4 and v3 straight, Eleven v3 and Gemini TTS on Kie): `--line "<voice>: <words>"` (`references/audio.md`).
