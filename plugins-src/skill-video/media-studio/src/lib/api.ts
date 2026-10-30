// The engine's local API (media.mjs serve) and the shapes it answers with
export type Kind = "image" | "video" | "audio"
export type Page = Kind | "library" | "credits" | "settings"

export type Input = {
  key: string
  kind: "image" | "video" | "audio" | "sketch" | "mask" | "media"
  label: string
  optional?: boolean
  multiple?: boolean
}
// an option: its value, or the value with what the dashboard shows of it (a preset light carries its lights)
export type Option = string | { value: string; label?: string; group?: string; note?: string; rig?: Light[] }
// one light around the subject: azimuth (0 front, 90 right, 180 behind) and elevation in degrees, 0–100 levels
export type Light = { az: number; el: number; color: string; brightness: number; diffuse: number }
export type Field = {
  key: string
  label: string
  type: "choice" | "text" | "number" | "color" | "select" | "multi" | "light" | "margin"
  options?: Option[]
  // how a value reads in the template ("shot on {}"): an empty one leaves nothing
  phrase?: string
  // the composer's heading this field sits under
  section?: string
  // a light field: how many lights the user may place
  lights?: number
  default?: string | number
  placeholder?: string
  min?: number
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
  params?: Record<string, unknown>
  local?: string
  provider?: string
  // setups that fill several fields at once
  presets?: { label: string; fields: Record<string, string> }[]
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
    references?: number
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
}
export type Limits = { threshold: number | null; cap: number | null }
export type Settings = {
  openrouter: Limits
  elevenlabs: Limits & { plan: string | null }
  defaults: Record<Kind, string | null>
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
  // ElevenLabs' plans: USD per 1,000 credits
  plans: Record<string, number>
  // the fake APIs a dev or test server was started on (none for a real one), and whether it uses them now
  fake: { on: boolean; bases: string[] }
  month: { openrouter: number; elevenlabs: number }
}
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
}
export type Element = { name: string; files: string[] }

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
  elements: (body?: { name: string; paths?: string[]; remove?: boolean }) =>
    body ? post<Element[]>("/api/elements", body) : call<Element[]>("/api/elements"),
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

// the tool's template with its fields and the user's words: the same as media.mjs's fill
export function fill(tool: Tool, fields: Record<string, string>, prompt: string) {
  let text = tool.template || "{prompt}"
  for (const f of tool.fields) {
    const v = String(fields[f.key] ?? f.default ?? "")
    text = text.replaceAll(`{${f.key}}`, v && f.phrase ? f.phrase.replace("{}", v) : v)
  }
  return text
    .replaceAll("{prompt}", prompt ?? "")
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)/g, "")
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
