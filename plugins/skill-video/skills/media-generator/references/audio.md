# Voices, music and sounds

Read it before any `audio` generation: speech, a dialogue, Change voice, Translate, a sound style, music, a sound
effect, an Edit of a sound, Isolate voice, a Suno song's extras, a singer, a voice designed or remixed, a transcript. `media.mjs` means `node
"${CLAUDE_SKILL_DIR}/engine/media.mjs"`, as in SKILL.md. The price and the user's yes are SKILL.md's step 3, as for
any generation.

Contents: speech (ElevenLabs, a router's model, a dialogue) · Change voice · Translate · sound styles · music · Music
for a video · sound effect · Edit · Isolate voice · Design a voice · Remix a voice · Transcribe · a Suno song's extras ·
Singer · one's own singing voice in Suno

## Voices, music and sounds

Audio has Create and Edit tools like images and videos. ElevenLabs is reached straight with its key (its voices,
dialogues, Change voice, Translate, its sound effects, Eleven Music, Music for a video, stems, Design and Remix a voice,
Transcribe, in its credits), whichever router is active; without its key, the active router's ElevenLabs voices stand in
(OpenRouter: Eleven v4, v4 Turbo, v3, Multilingual v2, Flash and Turbo v2.5; Kie: Eleven v3 Dialogue, Multilingual v2,
Turbo v2.5), and none of the others. Suno's and Lyria's music and sounds come by the router. ElevenLabs' free plan
refuses in its API (nothing billed, its words shown) Eleven Music, Music for a video, its stems, Design and Remix a
voice: a paid plan; voices, dialogues, sound effects and Transcribe run on it (tested 2026-11-02). Every ElevenLabs tool is
priced before it runs (its credits), except a voice designed or remixed without its text (it writes its own: priced
after, a credit a character; the user's yes, then `--accept-unknown`).

- **Speech** (`audio --tool voice`): `--prompt` is the text read. ElevenLabs' models come first, straight from its API
  (Eleven v4 by default, then v4 Turbo, v3, v3 Conversational, Multilingual v2, Flash and Turbo v2.5); the active
  router's other speech models follow (Gemini TTS, Seed Audio, MiniMax…; no cloning on Kie). `media.mjs models audio`
  lists them with what each takes.
  - On ElevenLabs: `--voice <voice_id>` (`media.mjs voices` lists the account's) or `--voice @name` (a voice of the
    Library, put on the account when the job runs: ElevenLabs' paid plans clone, the free one refuses). A credit a
    character, half on v4 Turbo, v3 Conversational, Flash and Turbo. Audio tags in the text steer v4, v4 Turbo and v3
    (`[whispers]`, `[laughs]`, `[sighs]`, `[excited]`…). Its options, each model its own: `--option stability=0.4`,
    `similarity_boost`, `style`, `speed` (0.7 to 1.2, not on v4), `use_speaker_boost=on`, `language_code=fr`,
    `apply_text_normalization=on|off|auto`; on v3 stability is `Creative`, `Natural` or `Robust`. `--seed` too. Its
    audio effects, on every model, free: `--option filter_preset_id=phone` (a filter: Phone, Old radio…),
    `environment_id=hall` (a room's reverb, `send_level` 0–1), `distance` (0–1), `background_noise_id=cafe`, `pan`
    (-1 to 1); their names as its catalog gives them (`media.mjs models audio --json`). Each voice comes with its
    captions, `captions.srt` beside `out.mp3` (a dialogue's too).
  - On a router's model: a preset voice (`--voice`, its id: ElevenLabs' on Kie are ids like `EkK5I93UQWFDigLMpZcX`, on
    OpenRouter first names like `george`; the dashboard plays their samples), a voice of the Library (`--voice @name`,
    its clips cloned, OpenRouter's models that clone), or a voice cloned from 1 to 3 clips (`--in voice_clips=<file>`);
    `--field instructions="…"` says how it sounds. ElevenLabs' options on Kie: `--option stability=…`,
    `similarity_boost`, `style`, `speed`, `language_code=fr`.
  - A **dialogue** (Eleven v4 and v3 straight, up to 2,000 characters and 10 voices; Eleven v3 on Kie, 5,000; Gemini
    TTS on Kie, 2 voices, « how it sounds » as each line's style, tags like `<laugh>`, `--option temperature=…` and
    `filler_words=on`): one `--line "<voice_id or @name>: <words>"` a line, in order; no `--prompt`.
- **Change voice** (`audio --tool change-voice --in clip=<audio or video> --voice <voice_id>`, ElevenLabs straight): the
  same delivery (pauses, emotion, rhythm) in another voice, put back on the video. `media.mjs voices` lists the
  ElevenLabs voices (its default ones and the account's own). `--voice @name` takes a voice of the Library: one not on
  the account yet is put there when the job runs (ElevenLabs needs a paid plan for that), then kept. A new voice of the
  user's own is a Library voice Element (`elements add <name> <clips…> --type voice`, a minute or more of clean
  speech). `--field denoise=remove` drops the background noise.
- **Translate** (`audio --tool translate --in clip=<file> --field to=en,es`, ElevenLabs straight): a dubbed file per
  language in the speakers' own voices, with its subtitles (`.vtt`). `--field quality=dubbing_v1` (default, 3,000
  credits a minute per language) or `dubbing_v2` (better voices and emotion, 13,500 a minute). **No lip-sync**: say so,
  and offer Lip sync (video Edit) on the dubbed voice.
- ElevenLabs bills credits: give them as `shown` (with their dollars when the plan is set).
- **Sound styles.** The audio tools' Style fields take a sound style: `--field style=<style>` on Music (Write: Suno's
  style; Describe: written after the description), Singer, Extend music, Cover, Add vocals, Add instrumental, Replace
  section, Mashup (a music style), Sound effect (a sound style, after the words), and Voice's `--field
  instructions=<style>` (a voice style: how it is said; ElevenLabs v3 and v4 take no such words: a preset goes as its
  audio tags before the text, a style of one's own is not sent there). A preset's
  label (`media.mjs tools audio --search <tool>` lists them: 47 music, 18 voice, 15 sound), the name of a sound style
  of the user's own (`media.mjs styles add <name> --for music|voice|sound --words "…"`, its words only, sent as they
  are; the dashboard's Library › Sounds does the same), or words of one's own. A preset's label stands for its
  words (`style=Synthwave` sends the preset's). A style of another family is refused.
- **Music** (`audio --tool music`, Kie: Suno V6, V6 Mini, V6 Wild, $0.06 a request for 2 takes and their covers;
  OpenRouter: Lyria 3 Pro $0.08 a song, Lyria 3 Clip $0.04 for 30 s):
  - Describe (`--field description="…"`, 3,000 characters), with up to 5 images, a video and a sound (6 s or more) for
    inspiration (`--in references=…`, `ref_videos=…`, `ref_audios=…`; Lyria takes images only).
  - Write (`--field mode=write --field title=… --field style="…" --field lyrics="[Verse]…"`): title 80, style 1,000,
    lyrics 5,000 characters; `--field length=10..360` (seconds, Suno V6), `--field vocals=instrumental`, `--field
    singer=@name` (a singer of the Library that Suno has; Describe takes one too, tested 2026-11-01). Suno's options: `vocal_gender=f|m`, `negative_tags="…"` (Avoid),
    `style_weight`, `weirdness_constraint`, `audio_weight` (0–1), `variety=0..4` (Write only, but Avoid).
  - Suno writes lyrics from a theme (`media.mjs lyrics "<theme>"`, 2 versions, $0.002) or a style out richer
    (`media.mjs boost "<style>"`, $0.002): priced like a generation (`--estimate`, then `--spend`).
  - A take's words land in `lyrics.txt`; Suno keeps its files 14 days, the engine downloads them at once.
  - **Eleven Music** (`--model music_v2_5`, or `music_v2`, `music_v1`; ElevenLabs straight, any router, 15 credits a
    second; its API needs a paid plan): Describe's words and style, `--option length=30` (3 to 600 s, 0: its own,
    priced after), `--field vocals=instrumental`, and one sound as reference (`--in ref_audios=…`, v2 and v2.5: its
    first 30 s uploaded and paid as a song of that length, `--option condition_strength=low|medium|high|xhigh`). No
    images, video nor singer (Suno's). Write: `--field style=…` (needed) and `--field lyrics="[Verse]\n…"`, each
    `[section]` played as written (30 lines, 2 min at most each), `--field length=` shared over them, else 4 s a line
    (10 s at least a section, an instrumental 30 s). `--seed` with a plan only (Write, a sound reference); v1:
    `--option respect_sections_durations=off` lets it adjust them. `--option sign_with_c2pa=on` signs the MP3 as made
    by AI (Content Credentials; Music for a video and stems too). The song's id is kept with the job (`eleven.song_id`).
- **Music for a video** (`audio --tool video-music --in video=<file>`, ElevenLabs, any router, 15 credits a second of
  video, Eleven Music's rate): music to its cuts and mood, 10 min and 200 MB at most. `--field description="…"`, `--field
  style="cinematic, strings"` (its tags, 10 at most), `--option add_sfx=on` (its sound effects too),
  `separate_tracks=on` (`music.mp3` and `sfx.mp3` apart), `use_audio_as_reference=on` (the video's own sound sets the
  genre, tempo and mood). The timeline's « Generate » on a video clip offers it.
- **Sound effect** (Kie: Suno Sounds, $0.0125, the default there; ElevenLabs SFX v2, the default on OpenRouter, or SFX
  v3, limited access: any router): `--prompt "rain on a tin roof"`. Suno (500 characters): `--option
  version=V6|V6_MINI|V6_WILD`, `sound_loop=on`, `sound_tempo=1..300` (0: its own), `sound_key=Am`, `grab_lyrics=on`.
  ElevenLabs (`--model eleven_text_to_sound_v2`): `--option duration_seconds=0.5..30` (10 credits a second; 0, its own
  length: 50), `loop=on`, `prompt_influence=0..1` (0.3). Short effects come out quiet or off: listen, regenerate with
  « isolated, studio quality, close-miked, no background noise » after the words.
- **Edit** (Kie): `--in clip=<a sound>`; a sound sent whole (not a Suno take) lasts 6 s at least. Extend music (a Suno take goes on by its id, any other sound sent whole;
  `--field from=60`, else its end; style, lyrics, vocals, singer), Cover (the melody in another style, other words or
  singer), Add vocals (an instrumental sung: title, style, lyrics), Add instrumental (a voice gets its music: title,
  style; both send « noise, distortion » as Avoid unless `--option negative_tags=…`: Kie wants one), Mashup (`--in clips=a --in clips=b`, title, style), $0.06 each; Replace section (a Suno song, `--field
  start=30 --field end=45`, 10 s at least, `--field change="…"`, its new words, a singer; $0.025); Stems (a Suno song: `--field
  split=separate_vocal` voice + music $0.05, `split_stem` up to 12 $0.25, `split_stem_advanced --field
  instrument="Lead Vocal"` one instrument: each take's instrument alone and the song without it, $0.10). Stems of any
  song, not only Suno's: `--model eleven_stem_separation` (ElevenLabs, any router), `split=separate_vocal` (voice +
  music, 7.5 credits a second of song) or `split_stem` (6: vocals, drums, bass, guitar, piano, other, 15 a second), or
  its own option `--option stem_variation_id=two_stems_v1|six_stems_v1` (the dashboard's Tracks); no single instrument.
- **Isolate voice** (`audio --tool isolate-voice --in clip=<audio or video>`, always ElevenLabs straight, whichever
  router, 1,000 credits a minute): the voice alone, music, noise and room taken out; a video comes back with its voice
  alone, a sound as an MP3. Kie's Voice Isolator is discontinued.
- **Design a voice** (`audio --tool design-voice --field description="a warm, low female voice, French, late
  thirties, calm"`, ElevenLabs, any router): 3 previews, `preview-1.mp3` to `preview-3.mp3`. `--field text="…"` (100 to
  1,000 characters) is what they say, a credit a character once for the 3; else it writes its own, priced after.
  Voice Design v3 by default (`eleven_ttv_v3`, `--in reference=<a voice clip>` to start from, `--option
  prompt_strength=0..1`), or v2
  (`eleven_multilingual_ttv_v2`); `--option loudness=-1..1`, `guidance_scale=0..10`, `should_enhance=on`, `--seed`. The one the
  user likes is kept: `media.mjs elements keep <name> --from <generation> --take 2` (free: a voice of the ElevenLabs
  account, no clone, and of the Library with its id; the viewer's « Keep this voice »). Then Voice, Change voice and
  the others take `--voice @<name>`.
- **Remix a voice** (`audio --tool remix-voice --voice <voice_id or @name> --field description="older, a British
  accent"`, ElevenLabs, priced as Design a voice): the same 3 previews of the voice changed, kept the same way. Only a
  voice of the user's own (designed, kept, cloned): a premade one is refused. A voice of the Library not on the account
  yet is put there first (a paid plan's clone); one kept from Design a voice is there.
- **Transcribe** (`audio --tool transcribe --in clip=<audio or video>`, ElevenLabs' Scribe v2, any router, 67 credits
  a minute): `transcript.txt`, `captions.srt` and `words.json` (each word's time). `--option diarize=on` (each
  speaker's turn: « Speaker 1: … », `num_speakers=2` at most so many), `tag_audio_events=on` ((laughter)…), `no_verbatim=on` (no ums), `--seed`,
  `language_code=fr`; `--field keyterms="Lucie, Kie.ai"` (names to get right). With `--field text="<the words said>"`
  its words are timed exactly instead (forced alignment, a transcript's rate): captions of a known script.
- **A Suno song's extras** (Kie, its viewer's actions; `--in clip=<a take>`): `--tool wav` ($0.002 a track; a stem of the
  Stems tool too; several `--in clip=` make one job, a WAV per track named after it: the viewer's « All in WAV »), `--tool
  lyrics-timings` (each sung word with its time: `lyrics.srt`, `lyrics.json`, $0.0025), `--tool music-video` (an MP4
  with its cover, `--field author=… --field domain_name=…`, $0.01), `--tool midi --in clip=<a stem>` (its notes,
  `notes.json`, free), `--tool singer --field name=Nova --field description="…"` (a singer of the Library, free: Suno's
  persona of the take from 10 to 30 s where it sings, found unless `--field start=20 --field end=40`; its clip is that
  part, its picture the take's cover; Kie takes its style up to 256 characters, the engine cuts it).
- **Singer** (`audio --tool create-singer --field name=aria --field voice="a warm, breathy female pop voice" --field
  style="dreamy synth-pop"`, Kie, $0.16): a singer made by AI. Suno sings a short song in that voice (2 takes, $0.06),
  then each take's voice is taken apart from the music (Suno's split, $0.05 each): `voice-1.mp3` beside `out-1.mp3`.
  Then `--tool singer --in clip=<voice-1.mp3> --field name=Aria --field description="…"` keeps it (free), the voice
  alone as its clip. When the user wants a singer and has no voice of their own, this is the way.
- **One's own singing voice in Suno** (free, Kie): a singer of the Library (`elements add <name> <sung clips…> --type
  singer`; a recording over music is better cleaned first with Isolate voice: Suno hears a voice best a cappella), then
  `elements suno <name>` gives a phrase to sing (from the 30 s where its first clip sings the most, or `--start <s>
  --end <s>`); the user records it in the same voice, then `elements suno <name> --verify <recording>`. Suno's way to
  prove the voice is theirs: it cannot be done for them. The Singer fields take it (Music, Extend, Cover, Mashup,
  Replace section; not Add vocals, Kie's has no singer).
