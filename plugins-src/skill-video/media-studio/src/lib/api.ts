// The engine's local API (media.mjs serve) and the shapes it answers with
export type Kind = "image" | "video" | "audio"
export type Page = Kind | "workspace" | "library" | "credits" | "settings"

export type Input = {
  key: string
  kind: "image" | "video" | "audio" | "sketch" | "mask" | "matte" | "media"
  label: string
  optional?: boolean
  multiple?: boolean
  // a mask: the field the paint dialog shows under the picture (what goes there), and the matte input that keeps the
  // painted area in black and white, never sent (an inpaint lays the result back on the original with it)
  field?: string
  matte?: string
  // how the prompt names its images, {} their place (« images 2 to 3 »): nothing without a file
  phrase?: string
  // shown only while the tool's fields have these values (Music's references in Describe)
  when?: Record<string, string>
  // how many files it takes, when exactly so many (Mashup's two songs)
  count?: number
}
// an option: its value, or the value with what the dashboard shows of it (a preset light carries its lights, a style
// the palette of its card, a References sheet its ratio)
export type Option = string | { value: string; label?: string; group?: string; note?: string; rig?: Light[]; cam?: Cam; swatch?: string[]; ratio?: string }
// one light around the subject: azimuth (0 front, 90 right, 180 behind) and elevation in degrees, 0–100 levels
export type Light = { az: number; el: number; color: string; brightness: number; diffuse: number }
// where New angle's camera goes: around the subject and up in degrees from where the picture was taken, closer (1) or
// farther (-1)
export type Cam = { az: number; el: number; zoom: number }
export type Field = {
  key: string
  label: string
  // lines: words on several lines (lyrics); singer: a voice of the Library made a Suno singer
  type: "choice" | "text" | "number" | "color" | "select" | "multi" | "light" | "margin" | "style" | "sheets" | "element" | "camera" | "recolors" | "lines" | "singer"
  options?: Option[]
  // how a value reads in the template ("shot on {}"): an empty one leaves nothing
  phrase?: string
  // the composer's heading this field sits under
  section?: string
  // a light field: how many lights the user may place
  lights?: number
  // an element field: the Library's types it takes, several at once (« @Papi, @Coat ») and how each type reads
  types?: ElementType[]
  multiple?: boolean
  by_type?: Partial<Record<ElementType, string>>
  // may stay empty: the read-only prompt shows no {key} for it
  optional?: boolean
  // the tool cannot go without it (Object swap's element)
  required?: boolean
  // shown only while the tool's other fields have these values (Music's lyrics in Write, when sung)
  when?: Record<string, string>
  default?: string | number
  placeholder?: string
  min?: number
  // a number's top, a recolors field's items at most
  max?: number
  step?: number
  unit?: string
}
export type Tool = {
  id: string
  label: string
  group: string
  mode: "create" | "edit"
  icon: string
  description: string
  inputs: Input[]
  fields: Field[]
  template: string
  models?: string[]
  // other models it runs on, not recommended: a restricted tool's « Other models »
  also?: string[]
  // why each recommended model is recommended (the engine's tools/why.json, or the tool's own)
  why?: Record<string, string>
  params?: Record<string, unknown>
  local?: string
  provider?: string
  // what a music or sound tool asks its router (Suno's task); hidden: run from the viewer, never in the tool list
  action?: string
  hidden?: boolean
  // the routers it runs on, when not both
  routers?: string[]
  // setups that fill several fields at once
  presets?: { label: string; group?: string; note?: string; fields: Record<string, string> }[]
  // a References tool: the Element its sheets make, and the field or input it needs one of (words or photos)
  element?: ElementType
  one_of?: string[]
  // a video edit Aleph 2 can carry from one edited frame: the image tool that edits it (or Custom edit on its frame
  // prompt), the prompt that applies it to the shot, and whether this tool goes to Aleph only that way
  keyframe?: { tool?: string; template?: string; apply: string; required?: boolean }
}
export type Model = {
  id: string
  model: string
  name: string
  lab?: string
  kind: string
  role: string
  provider: string
  // added from OpenRouter's catalog (not in the list kept with the engine), with its price at its cheapest settings
  new?: boolean
  from?: string | null
  // when the catalog first showed it (null: before dates were kept)
  since?: string | null
  params: {
    resolution?: string[] | null
    aspect_ratio?: string[] | null
    duration?: number[] | null
    frames?: string[]
    audio?: boolean | null
    seed?: boolean
    n?: { min: number; max: number } | null
    // the reference images it takes (a video model's apart from its frames); null when unknown
    references?: number | null
    quality?: string[] | null
    background?: string[] | null
    voices?: string[] | null
    // what the dashboard shows of some voices (ElevenLabs'): their line, labels and public samples
    voice_info?: Record<string, { name: string; labels?: Record<string, string>; preview_url?: string; previews?: Record<string, string> }> | null
    // clone false when it takes no clips (Kie); "library" (ElevenLabs): the account's voices and the Library's, whole
    clone?: boolean | "library"
    // a dialogue's lines (Eleven v3 and Gemini on Kie) and how many voices it takes; audio tags in the text
    dialogue?: boolean
    speakers?: number
    tags?: boolean
    max_chars?: number | null
    // the model's own settings, each a control of the Options block, sent as params.options when changed
    options?: ModelOption[]
    // its own editors (Kie): Kling's shots, the middle frames (Grok's at their times), OmniHuman's masks of who speaks,
    // Kling 4.0's voices of the Library, Seedance 2.5's draft then its final
    shots?: { max: number; each: [number, number]; total: number } | null
    // Kling 4.0's caps all its frames by its length (total), each cited @keyframe_n
    mid_frames?: { max: number; timed?: boolean; total?: number; cite?: string } | null
    // the names a model wants its inputs cited by in the words (Kling 4.0: @first_frame, @image_1, @video_1…)
    cite?: Record<string, string> | null
    masks?: number
    named_voices?: number
    draft?: boolean
    // a video model that takes its frames and reference images together (Kie's Grok)
    mix?: boolean
    // the reference videos and sounds it takes, their lengths (each, and in all), and its count of references in all
    // (Kling 4.0: images, videos, Elements and voices, 15)
    videos?: number | null
    audios?: number | null
    ref_seconds?: { each: [number, number]; total?: number } | null
    materials?: number | null
    // a character Element's own voice goes with it (Kling 4.0)
    element_voice?: boolean
    // how many views of each cited Element it takes (Wan 2.2 Animate Replace: its main one); all when unset
    element_views?: number | null
    // Kling's named elements (Kie): how many @Elements it takes whole, and whether beside a frame
    elements?: number
    elements_with_frames?: boolean
    // whether its request has words at all (Volcengine's lip sync has none)
    prompt?: boolean
    // its frames made from a sound's length (Wan 2.2 Speech to Video)
    audio_frames?: { fps: number; min: number; max: number; step: number } | null
  }
}
export type OptionValue = string | number | { value: string | number; label: string }
export type ModelOption = {
  key: string
  label: string
  type: "slider" | "number" | "switch" | "choice" | "select" | "text" | "file"
  min?: number
  max?: number
  step?: number
  values?: OptionValue[]
  default?: string | number | boolean | null
  hint?: string
}
// a dialogue's line: its voice (an ElevenLabs id or @name of the Library, a Gemini voice) and its words
export type Line = { voice: string; text: string }
// a Kling shot: its words and its seconds
export type Shot = { prompt: string; duration: number }
export type Estimate = {
  amount: number | null
  unit: "usd" | "credits"
  known: boolean
  detail: string
}
export type Job = {
  id: string
  kind: Kind
  tool: string
  label: string
  provider: string
  model: string
  name: string
  prompt: string
  estimate: Estimate
  actual: number | null
  actual_known?: boolean
  status: "queued" | "running" | "done" | "failed"
  by: string
  created: string
  started?: string
  finished?: string
  note?: string | null
  error?: string
  outputs: string[]
  favorite?: boolean
  fields?: Record<string, string>
  params?: Record<string, unknown>
  inputs?: Record<string, string[]>
  raw_prompt?: string
  raw?: boolean
  // a References sheet made after the first of its set, matched to its image
  after?: string
  // the workspaces it is in
  workspaces?: string[]
  // where it goes on a timeline once done: a Bridge shot into a cut, a take in place of a clip, a new shot by it
  place?: Place
  // each file's size and length, measured once by the engine
  meta?: Record<string, { w?: number; h?: number; dur?: number }>
  // a song Suno made: its task, its takes (their ids, title, style and words), what it answered
  suno?: { task_id: string | null; tracks: { file: string; voice?: string; audio_id: string | null; title: string; tags: string; lyrics: string; duration: number | null }[] | null; data?: unknown } | null
  // the Library's singer it made
  element?: string
}
// where a result goes on a timeline once done: into the cut at `at` (a Bridge shot, a voice at the playhead), or by
// the clip it replaces: in its place at its length (a take), at the result's length (whole), in place of the stretch
// of it from its file's second `from` to `to` or its end (from: `at` is that stretch's start on the timeline), right
// after it or right before it. mute: the result's own sound off (a talking avatar says the voice already under it)
export type Place = { workspace: string; track: string; at: number; replace?: string; how?: "whole" | "from" | "after" | "before"; from?: number; to?: number; mute?: boolean }
export type Limits = { threshold: number | null; cap: number | null }
export type Router = "openrouter" | "kie"
export type Settings = {
  // the one router that generates
  router: { active: Router }
  openrouter: Limits
  kie: Limits
  elevenlabs: Limits & { plan: string | null }
  defaults: Record<Kind, string | null>
  workspace: { current: string }
}
export type Draft = {
  tool?: string
  model?: string
  prompt?: string
  fields?: Record<string, string>
  at: string
}
export type State = {
  home: string
  settings: Settings
  keys: { openrouter: boolean; management: boolean; kie: boolean; elevenlabs: boolean }
  media: Job[]
  drafts: Partial<Record<Kind, Draft>>
  styles: SavedStyle[]
  elements: Element[]
  // ElevenLabs' plans: USD per 1,000 credits
  plans: Record<string, number>
  // the fake APIs a dev or test server was started on (none for a real one), and whether it uses them now
  fake: { on: boolean; bases: string[] }
  // the active router, and its catalog: when it was last read, how many models it adds to the list (Kie: when its
  // prices were read)
  router: Router
  catalog: { at: string | null; added: number; prices_at?: string | null }
  month: { openrouter: number; kie: number; elevenlabs: number }
  workspaces: Workspace[]
}
// a workspace: a project's media (each job says which it is in), its Elements (linked by hand; linked adds the ones its
// generations cite) and its timeline
export type Workspace = { slug: string; name: string; created: string; elements: string[]; linked: string[]; timeline: Timeline }
// tracks top to bottom: the first video track covers the ones under it, the last one is the main track (its shots end
// to end); off hides a video track, mutes an audio one
export type Track = { id: string; kind: "video" | "audio"; off?: boolean }
// a clip plays a file of a generation (job, file; path: where it is, from the engine) from in to out (its own seconds)
// at a time on the timeline; dur: the file's length (none for a still)
export type Clip = { id: string; track: string; job: string; file: string; path: string; at: number; in: number; out: number; volume?: number; dur?: number }
// rev: the saved copy's number, so an older copy never writes over a newer one
export type Timeline = { ratio: string | null; tracks: Track[]; clips: Clip[]; placed: string[]; rev: number }
export type Spec = {
  kind: Kind
  tool: string
  model?: string
  prompt: string
  raw?: boolean
  fields: Record<string, string>
  inputs: Record<string, string[]>
  params: Record<string, unknown>
  probe?: boolean
  // the same generation 1 to 4 times, a job each
  batch?: number
  place?: Place
}
export type EstimateAnswer = {
  model: string
  provider: string
  prompt: string
  estimate: Estimate
  shown: string
  needs: "unknown" | "threshold" | "cap" | null
}
export type Balances = {
  openrouter: {
    error?: string
    key_left?: number | null
    key_limit?: number | null
    month?: number | null
    account_left?: number | null
  }
  kie?: { error?: string; credits?: number; account_left?: number }
  elevenlabs: { error?: string; left?: number; limit?: number; reset?: string }
}
export type LedgerLine = {
  at: string
  id: string
  kind: Kind
  tool: string
  label: string
  provider: string
  model: string
  unit: "usd" | "credits"
  estimate: number | null
  actual: number | null
  actual_known?: boolean
  status: string
  by: string
  usd?: number
}
export type Voice = {
  voice_id: string
  name: string
  category?: string
  labels?: Record<string, string> | string[]
  languages?: string[]
  description?: string | null
  preview_url?: string | null
  // a sample in each language the voice was verified in
  previews?: Record<string, string>
}
// an Element of the Library: what its images are to the model (a voice holds clips), its words, a brand's colors and
// typeface, a voice's ElevenLabs id once it is on the account, its Suno singer (a persona of a song, or its own voice made
// a Suno voice: pending, its phrase to sing)
export type ElementType = "character" | "outfit" | "object" | "location" | "pose" | "brand" | "voice" | "singer" | "other"
// the Elements heard, not seen: a voice (spoken) and a singer (sung) hold clips, never cited with @ in words
export const heard = (t: ElementType) => t === "voice" || t === "singer"
// a singer of one's own Suno has not heard yet: nothing sings with it until its phrase is sung
export const needsPhrase = (e: Element) => e.type === "singer" && !(e.suno?.persona_id || e.suno?.voice_id)
// voice: a character's own voice, a voice of the Library heard when it speaks in a video (Kling 4.0)
export type Element = { name: string; type: ElementType; words: string; colors: string[]; font: string; voice_id: string | null; voice?: string | null; cover?: string | null; suno?: { persona_id?: string; voice_id?: string; pending?: { task_id: string; phrase: string } } | null; files: string[] }
export const ELEMENT_TYPES: { type: ElementType; label: string; plural: string; hint: string }[] = [
  { type: "character", label: "Character", plural: "Characters", hint: "a person, a creature, a mascot" },
  { type: "outfit", label: "Outfit", plural: "Outfits", hint: "clothes, shoes, accessories worn" },
  { type: "object", label: "Object", plural: "Objects", hint: "a product, a prop, a vehicle" },
  { type: "location", label: "Location", plural: "Locations", hint: "a place, a set" },
  { type: "pose", label: "Pose", plural: "Poses", hint: "a body pose to copy, nothing else" },
  { type: "brand", label: "Brand", plural: "Brands", hint: "a logo kept exact, its colors" },
  { type: "voice", label: "Voice", plural: "Voices", hint: "1 to 3 clips of speech, picked as Audio's voice and for Change voice" },
  { type: "singer", label: "Singer", plural: "Singers", hint: "1 to 3 sung clips, picked as Music's singer once Suno has it" },
  { type: "other", label: "Other", plural: "Other", hint: "anything else" },
]
export const typeLabel = (t: ElementType) => ELEMENT_TYPES.find((x) => x.type === t)!.label
// a style of the Library: its images, the words on its look, and how a prompt cites it (media.mjs writes it)
export type SavedStyle = { name: string; files: string[]; words: string; text: string }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error ?? `${r.status}`), { status: r.status, body: j })
  return j as T
}
const post = <T>(url: string, body: unknown) =>
  call<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

export const api = {
  state: () => call<State>("/api/state"),
  engine: () => call<{ engine: string }>("/__media-generator"),
  tools: () => call<Record<Kind, Tool[]>>("/api/tools"),
  models: (kind: Kind) => call<Model[]>(`/api/models?kind=${kind}`),
  // OpenRouter's catalog read now: the models it adds by router kind, found: new since the last read
  refreshModels: () => post<{ at: string; added: Record<"image" | "video" | "speech", { id: string; name: string; found: boolean }[]>; unwired?: string[]; prices?: number }>("/api/models/refresh", {}),
  balances: (refresh = false) =>
    call<Balances>(`/api/balances${refresh ? "?refresh" : ""}`),
  ledger: () => call<LedgerLine[]>("/api/ledger"),
  estimate: (spec: Spec) => post<EstimateAnswer>("/api/estimate", spec),
  generate: (spec: Spec, confirm = false) =>
    post<{ id: string; ids: string[] }>("/api/generate", { ...spec, confirm }),
  upload: (file: Blob, name: string) =>
    call<{ path: string }>(`/api/upload?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: file,
    }),
  frame: (path: string, last = false, t?: number) =>
    post<{ path: string }>("/api/frame", { path, last, t }),
  cut: (path: string, start: number, end: number, crop?: { x: number; y: number; w: number; h: number }) =>
    post<{ path: string }>("/api/cut", { path, start, end, crop }),
  import: (path: string) => post<{ id: string; kind: Kind }>("/api/import", { path }),
  media: (id: string, action: "favorite" | "delete") =>
    post<{ ok: true }>(`/api/media/${id}/${action}`, {}),
  settings: (s: Partial<Settings>) => post<Settings>("/api/settings", s),
  fake: (on: boolean) => post<State["fake"]>("/api/fake", { on }),
  voices: () => call<Voice[] | { voices: Voice[] }>("/api/voices"),
  clone: (name: string, paths: string[]) =>
    post<{ ok: true }>("/api/voice-clone", { name, paths }),
  // Suno's help with the words (Kie, priced): lyrics from a theme (its versions), a style written out richer
  assist: (what: "lyrics" | "boost", text: string, confirm = false) => post<{ texts: { title: string; text: string }[]; cost: number | null }>("/api/assist", { what, text, confirm }),
  // where a sound sings the most (Make a singer's 10 to 30 s), and recordings cleaned by the Voice Isolator (jobs of the
  // Library, priced: 409 asks first)
  sung: (path: string) => post<{ start: number; end: number; sung: number; duration: number }>("/api/sung", { path }),
  clean: (paths: string[], confirm = false) => post<{ paths: string[] }>("/api/clean", { paths, confirm }),
  // a voice of the Library made a Suno singer: its phrase to sing first, then the recording of it
  sunoVoice: (body: { name: string; start?: number; end?: number; language?: string; verify?: string }) => post<{ phrase?: string; task_id?: string } & Partial<Element>>("/api/elements/suno", body),
  elements: (body: { name: string; type?: ElementType; words?: string; colors?: string[]; font?: string; voice?: string; paths?: string[]; drop?: string[]; remove?: boolean; elevenlabs?: boolean; workspace?: string | null }) =>
    post<Element[]>("/api/elements", body),
  styles: (body: { name: string; paths?: string[]; words?: string; drop?: string[]; remove?: boolean }) => post<SavedStyle[]>("/api/styles", body),
  workspaces: (body: { new?: string; slug?: string; use?: boolean; name?: string; add?: string[]; drop?: string[]; link?: string[]; unlink?: string[]; timeline?: Timeline; rev?: number; remove?: boolean }) =>
    post<{ current: string; workspaces: Workspace[] }>("/api/workspaces", body),
  edit: (slug: string) => call<{ text: string | null }>(`/api/workspaces/${slug}/edit`),
}
// a clip's pictures on the timeline: a video's frames side by side (STRIP of them), a sound's waveform
export const STRIP = 20
export const stripUrl = (path: string) => `/api/strip?path=${encodeURIComponent(path)}`
export const waveUrl = (path: string) => `/api/wave?path=${encodeURIComponent(path)}`

// the workspace new generations join, and what its views list
export const currentOf = (s: State) => s.workspaces.find((w) => w.slug === s.settings.workspace.current) ?? s.workspaces[0]
export const inWorkspace = (j: Job, slug: string) => !!j.workspaces?.includes(slug)
// what a workspace's generations cost: dollars, and ElevenLabs credits apart
export function spentIn(s: State, slug: string) {
  const jobs = s.media.filter((j) => inWorkspace(j, slug) && j.provider !== "local" && j.status !== "queued" && j.status !== "running")
  const of = (unit: "usd" | "credits") => jobs.filter((j) => j.estimate.unit === unit).reduce((a, j) => a + (j.actual ?? j.estimate.amount ?? 0), 0)
  return { usd: of("usd"), credits: of("credits") }
}

export const fileUrl = (path: string) => `/files?path=${encodeURIComponent(path)}`
// the pictures a sound may have, when its job made one: a Suno take's cover (out-2.mp3 and its voice-2.mp3 show
// cover-2.jpeg, Kie's, or .jpg). Found by its path; the caller tries each and hides what does not load
export const coverPaths = (path: string) =>
  /\/media\/[^/]+\/(?:out|voice)-\d+\.\w+$/.test(path) ? ["jpeg", "jpg", "png", "webp"].map((x) => path.replace(/(?:out|voice)-(\d+)\.\w+$/, `cover-$1.${x}`)) : []
// a job's own cover of one of its sounds, from its outputs
export const coverOf = (job: Job, file: string) => {
  const n = file.match(/(?:^|\/)(?:out|voice)-(\d+)\.\w+$/)?.[1]
  return n ? (job.outputs.find((o) => o.startsWith(`cover-${n}.`)) ?? null) : null
}
export const outputPath = (home: string, job: Job, file: string) =>
  `${home}/media/${job.id}/${file}`
export const inputPath = (home: string, job: Job, file: string) =>
  `${home}/media/${job.id}/${file}`
export const mediaKind = (file: string) =>
  /\.(png|jpe?g|webp|gif|svg)$/i.test(file)
    ? "image"
    : /\.(mp4|mov|webm)$/i.test(file)
      ? "video"
      : /\.(mp3|wav|m4a|flac|ogg)$/i.test(file)
        ? "audio"
        : "other"

// an option's value, its words and its group
export const opt = (o: Option) => (typeof o === "string" ? { value: o, label: o } : { ...o, label: o.label ?? o.value })
// a value's words: its option's label, sentence-cased; Auto for an empty one
export function shown(f: Field, v: string) {
  const l = f.options?.map(opt).find((o) => o.value === v)?.label ?? v
  return l ? sentence(l) : "Auto"
}
// a label's first letter up, an aperture as written (f/2.8)
export const sentence = (s: string) => (!s || /^f\//.test(s) ? s : s[0].toUpperCase() + s.slice(1))

// the tools done on this machine, free and without a model (media.mjs's LOCAL)
export const isLocal = (tool: Tool) => ["reframe", "fps", "hdr", "depth", "matte"].includes(tool.local ?? "")

// the user writes the whole prompt (Custom, speech): its template is their words, a style at most after them
export const ownPrompt = (tool: Tool) => tool.template.replace(" {style}", "") === "{prompt}"

// a style of the Library stands for its words in the prompt, as media.mjs sends it
export const withLooks = (tool: Tool, fields: Record<string, string>, styles: SavedStyle[]) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, (tool.fields.find((f) => f.key === k)?.type === "style" && styles.find((s) => s.name === v)?.text) || v]))

// the inputs whose images count as references: every image of an image model, a video model's references and sketch
// (its frames go apart)
export const imageInputs = (kind: Kind, tool: Tool) =>
  tool.inputs.filter((i) => (kind === "image" ? ["image", "sketch", "mask"].includes(i.kind) : ["references", "sketch"].includes(i.key)))

// where an input's images reach the model, as the prompt names them: the same as media.mjs's places
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]
const placeOf = (kind: Kind, at: number, n: number) => {
  const noun = kind === "image" ? "image" : "reference image"
  return n === 1 ? `the ${ORDINALS[at - 1] ?? `#${at}`} ${noun}` : `${noun}s ${at} to ${at + n - 1}`
}
export function places(kind: Kind, tool: Tool, inputs: Record<string, string[]>) {
  const out: Record<string, string> = {}
  let at = 1
  for (const i of imageInputs(kind, tool)) {
    const n = inputs[i.key]?.length ?? 0
    if (n) out[i.key] = placeOf(kind, at, n)
    at += n
  }
  return out
}

// what a prompt can cite with @name: the Library's Elements with images (a voice is picked as Audio's voice, a style in
// a Style field)
export type Mentionable = Pick<Element, "name" | "type" | "files" | "words">
export const mentionables = (s: State): Mentionable[] => (s.elements ?? []).filter((e) => !heard(e.type) && e.files.length)
// the @names a prompt cites, once each and in order, of those it can
export const cited = (text: string, items: Mentionable[]) =>
  [...new Set([...text.matchAll(/@([\w-]+)/g)].map((m) => m[1]))].flatMap((n) => items.filter((i) => i.name === n))
// how media.mjs names them in the prompt: what each is and where its images are (after the tool's, from), once
const CITED: Record<string, (w: string) => string> = {
  character: (w) => `the character in ${w}`,
  outfit: (w) => `the outfit in ${w}`,
  object: (w) => `the object in ${w}`,
  location: (w) => `the place in ${w}`,
  pose: (w) => `the pose in ${w}: only its body pose, never its face, clothes or place`,
  brand: (w) => `the brand in ${w}: its logo reproduced exactly`,
  other: (w) => `shown in ${w}`,
}
export function withMentions(text: string, kind: Kind, from: number, s: State) {
  const items = mentionables(s), done = new Set<string>()
  let at = from
  return text.replace(/@([\w-]+)/g, (all, name: string) => {
    if (done.has(name)) return name
    const it = items.find((i) => i.name === name)
    if (!it) return all
    const where = placeOf(kind, at, it.files.length), el = s.elements.find((e) => e.name === name)!
    at += it.files.length
    done.add(name)
    const brand = el.type === "brand" ? [el.colors.length ? `its colors ${el.colors.join(", ")}` : "", el.font ? `the typeface ${el.font}` : ""] : []
    return `${name} (${[CITED[el.type](where), ...brand, el.words].filter(Boolean).join(", ")})`
  })
}
// the place of the first image an @name brings: after the tool's own
export const mentionFrom = (kind: Kind, tool: Tool, inputs: Record<string, string[]>) => 1 + imageInputs(kind, tool).reduce((n, i) => n + (inputs[i.key]?.length ?? 0), 0)

// the tool's template with its fields, its inputs' places and the user's words: the same as media.mjs's fill. holes
// (the read-only prompt) keeps what is still to fill as {key}, the user's words aside; an optional part (a style without
// a default, an optional input) or an Auto picked on purpose leaves nothing
export function fill(tool: Tool, fields: Record<string, string>, prompt: string, kind: Kind, inputs: Record<string, string[]>, holes = false) {
  const hole = (key: string) => (holes ? `{${key}}` : "")
  let text = tool.template || "{prompt}"
  for (const f of tool.fields) {
    let v = String(fields[f.key] ?? f.default ?? "")
    // a References tool's sheets: the first one's words, as its job sends them (the others follow it)
    if (f.type === "sheets") v = f.options?.map(opt).find((o) => v.split(",").some((x) => x.trim().toLowerCase() === o.label.toLowerCase()))?.value ?? ""
    const auto = f.options?.some((o) => opt(o).value === "") || (f.type === "style" && f.default == null) || f.optional || (f.type === "element" && !f.required)
    text = text.replaceAll(`{${f.key}}`, v ? (f.phrase ? f.phrase.replace("{}", v) : v) : auto ? "" : hole(f.key))
  }
  const at = places(kind, tool, inputs)
  for (const i of tool.inputs) if (i.phrase) text = text.replaceAll(`{${i.key}}`, at[i.key] ? i.phrase.replace("{}", at[i.key]) : i.optional ? "" : hole(i.key))
  return text
    .replaceAll("{prompt}", prompt ?? "")
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/\s+([.,:;)])/g, "$1")
    .replace(/[.,:;]{2,}/g, (m) => (m.includes(".") ? "." : m[0]))
    .replace(/^[\s.,:;]+|[\s,:;]+$/g, "")
    .trim()
}

// the routers by their ids, as the pages name them
export const ROUTER_NAME: Record<Router, string> = { openrouter: "OpenRouter", kie: "Kie.ai" }

// the USD price of 1,000 ElevenLabs credits on the user's plan, null without a paid one
export const per1000 = (s: State) => s.plans?.[s.settings.elevenlabs?.plan ?? ""] || null
// a price as the engine writes it: dollars, or ElevenLabs credits with their dollars on a paid plan
export function money(amount: number | null | undefined, unit: "usd" | "credits", usdPer1000?: number | null): string {
  if (amount == null) return "unknown cost"
  if (unit === "usd") return `$${amount >= 0.1 || !amount ? amount.toFixed(2) : amount.toFixed(3).replace(/0$/, "")}`
  const credits = `${Math.round(amount).toLocaleString("en-US")} credits`
  return usdPer1000 ? `${credits} · ${money((amount * usdPer1000) / 1000, "usd")}` : credits
}

// an estimate as a button or a list shows it: free, per minute (ElevenLabs before the clip), per character (a voice
// before its text), or ≈ its price
export function priceLabel(a: EstimateAnswer) {
  if (a.provider === "local") return "free"
  if (!a.estimate.known) return a.estimate.detail?.match(/^per \w+/)?.[0] ?? (a.provider === "elevenlabs" ? "per minute" : "unknown cost")
  return `≈ ${a.shown}`
}

// an engine message without its CLI hints ("(--in key=<file>)")
export const plain = (msg: string) => msg.replace(/\s*\((--|media\.mjs)[^)]*\)/g, "").replace(/^error: /, "")

export function when(iso: string) {
  const d = new Date(iso), now = new Date()
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === now.toDateString()) return `today ${hm}`
  if (d.toDateString() === new Date(now.getTime() - 864e5).toDateString()) return `yesterday ${hm}`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function elapsed(iso?: string) {
  if (!iso) return ""
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}
