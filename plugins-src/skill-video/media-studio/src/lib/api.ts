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
  type: "choice" | "text" | "number" | "color" | "select" | "multi" | "light" | "margin" | "style" | "sheets" | "element" | "camera" | "recolors"
  options?: Option[]
  // how a value reads in the template ("shot on {}"): an empty one leaves nothing
  phrase?: string
  // the composer's heading this field sits under
  section?: string
  // a light field: how many lights the user may place
  lights?: number
  // an element field: the Library's types it takes
  types?: ElementType[]
  // may stay empty: the read-only prompt shows no {key} for it
  optional?: boolean
  // the tool cannot go without it (Object swap's element)
  required?: boolean
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
  params?: Record<string, unknown>
  local?: string
  provider?: string
  // setups that fill several fields at once
  presets?: { label: string; group?: string; note?: string; fields: Record<string, string> }[]
  // a References tool: the Element its sheets make, and the field or input it needs one of (words or photos)
  element?: ElementType
  one_of?: string[]
}
export type Model = {
  id: string
  model: string
  name: string
  lab?: string
  kind: string
  role: string
  provider: string
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
  }
}
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
  // where it goes on a timeline once done: a Bridge shot into a cut, a take in place of a clip
  place?: Place
  // each file's size and length, measured once by the engine
  meta?: Record<string, { w?: number; h?: number; dur?: number }>
}
export type Place = { workspace: string; track: string; at: number; replace?: string }
export type Limits = { threshold: number | null; cap: number | null }
export type Settings = {
  openrouter: Limits
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
  keys: { openrouter: boolean; management: boolean; elevenlabs: boolean }
  media: Job[]
  drafts: Partial<Record<Kind, Draft>>
  styles: SavedStyle[]
  elements: Element[]
  // ElevenLabs' plans: USD per 1,000 credits
  plans: Record<string, number>
  // the fake APIs a dev or test server was started on (none for a real one), and whether it uses them now
  fake: { on: boolean; bases: string[] }
  month: { openrouter: number; elevenlabs: number }
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
// typeface, a voice's ElevenLabs id once it is on the account
export type ElementType = "character" | "outfit" | "object" | "location" | "pose" | "brand" | "voice" | "other"
export type Element = { name: string; type: ElementType; words: string; colors: string[]; font: string; voice_id: string | null; files: string[] }
export const ELEMENT_TYPES: { type: ElementType; label: string; plural: string; hint: string }[] = [
  { type: "character", label: "Character", plural: "Characters", hint: "a person, a creature, a mascot" },
  { type: "outfit", label: "Outfit", plural: "Outfits", hint: "clothes, shoes, accessories worn" },
  { type: "object", label: "Object", plural: "Objects", hint: "a product, a prop, a vehicle" },
  { type: "location", label: "Location", plural: "Locations", hint: "a place, a set" },
  { type: "pose", label: "Pose", plural: "Poses", hint: "a body pose to copy, nothing else" },
  { type: "brand", label: "Brand", plural: "Brands", hint: "a logo kept exact, its colors" },
  { type: "voice", label: "Voice", plural: "Voices", hint: "1 to 3 clips, picked as Audio's voice" },
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
  elements: (body: { name: string; type?: ElementType; words?: string; colors?: string[]; font?: string; paths?: string[]; drop?: string[]; remove?: boolean; elevenlabs?: boolean; workspace?: string | null }) =>
    post<Element[]>("/api/elements", body),
  styles: (body: { name: string; paths?: string[]; words?: string; drop?: string[]; remove?: boolean }) => post<SavedStyle[]>("/api/styles", body),
  workspaces: (body: { new?: string; slug?: string; use?: boolean; name?: string; add?: string[]; drop?: string[]; link?: string[]; unlink?: string[]; timeline?: Timeline; rev?: number; remove?: boolean }) =>
    post<{ current: string; workspaces: Workspace[] }>("/api/workspaces", body),
  edit: (slug: string) => call<{ text: string | null }>(`/api/workspaces/${slug}/edit`),
  montage: (slug: string) => post<{ path: string }>(`/api/workspaces/${slug}/montage`, {}),
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
export const mentionables = (s: State): Mentionable[] => (s.elements ?? []).filter((e) => e.type !== "voice" && e.files.length)
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

// the USD price of 1,000 ElevenLabs credits on the user's plan, null without a paid one
export const per1000 = (s: State) => s.plans?.[s.settings.elevenlabs.plan ?? ""] || null

// a price as the engine writes it: dollars, or ElevenLabs credits with their dollars on a paid plan
export function money(amount: number | null | undefined, unit: "usd" | "credits", usdPer1000?: number | null): string {
  if (amount == null) return "unknown cost"
  if (unit === "usd") return `$${amount >= 0.1 || !amount ? amount.toFixed(2) : amount.toFixed(3).replace(/0$/, "")}`
  const credits = `${Math.round(amount).toLocaleString("en-US")} credits`
  return usdPer1000 ? `${credits} · ${money((amount * usdPer1000) / 1000, "usd")}` : credits
}

// an estimate as a button or a list shows it: free, per minute (ElevenLabs before the clip), or ≈ its price
export function priceLabel(a: EstimateAnswer) {
  if (a.provider === "local") return "free"
  if (!a.estimate.known) return a.provider === "elevenlabs" ? "per minute" : "unknown cost"
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
