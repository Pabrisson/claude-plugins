import type { Feature, LineString, Point } from "geojson"

export type Props = Record<string, unknown>
export type OsintEvent = { t: string; kind: string; by: "engine" | "agent" | "vault" | "dashboard" | "watch"; phase?: string; text?: string; n?: number; of?: number; path?: string; id?: string; journal?: string; data?: Record<string, unknown>; deleted?: boolean }
export type Link = { target: string; path: string | null; anchor: string | null; embed: boolean }
export type NoteMeta = { path: string; title: string; folder: string; props: Props; tags: string[]; links: Link[]; blocks: string[]; headings: string[]; mtime: string; size: number; excerpt: string }
export type Lead = { id: string; label: string; why: string; minutes: number | null; noisy: boolean; prompt: string; done: boolean; created: string }
export type Relation = { from: string; to: string; label: string; source: string | null }
export type Ranked = { id: string; status: string; share: number }
export type Cell = { clue: string; hyp: string; lr: number; status: string; cap: number; why: string; journal: string | null }
export type Conclusion = { answer: string; confidence: Record<string, "high" | "medium" | "low">; criteria: Record<string, string>; radius_m?: number | null; alternatives: { hyp: string; test: string }[]; unresolved: string[] }
export type CaseIndex = {
  slug: string; dir: string; type: string; props: Props; notes: NoteMeta[]; files: string[]
  backlinks: Record<string, { from: string; line: number; text: string }[]>
  analysis: { ranked: Record<string, Ranked[]>; frontier: string | null; cells: Cell[]; exclusions: { hyp: string; clue: string; why: string; journal: string | null }[] }
  leads: Lead[]; relations: Relation[]; evidence: EvidenceEntry[]; reverse: ReverseState; conclusion: Conclusion | null; last: OsintEvent | null
  counts: { entities: number; sources: number; clues: number; hypotheses: number; leads_open: number; new: number }
  watch: Watch | null
}
// the watch (spec § 12.1): a case's period with its last and next pass; the folder's switch and notifications
export type Every = "6h" | "12h" | "24h" | "7d"
// developer: the mode is on; fake: the engine commands run on the fake APIs now; fake_available: this server was started on
// them (fake_url: where); busy: a command is running
export type AppState = { home: string; version: string; developer: boolean; fake: boolean; fake_available: boolean; fake_url: string | null; busy: boolean }
export type Watch = { every: Every; last: string | null; next: string; error: string | null }
export type WatchedCase = Watch & { slug: string; armed?: boolean; type: string; result: { at: string; added: number; removed: number; changed: number } | null }
export type WatchState = { on: boolean; notify: boolean; click_hint: string | null; running: boolean; stops: boolean; cases: WatchedCase[] }
export type EvidenceEntry = { id: string; file: string; sha256: string; of: string | null; kind?: "original" | "masked" | "derived"; input?: string; boxes?: number[][]; added?: string }
export type Verdict = { at: string; candidate: string; page: string | null; file: string | null; verdict: "match" | "no match" | "unsure"; reason: string; compared: string[]; journal: string; clue: string | null }
export type ReverseState = { clear: Record<string, { at: string; journal: string }>; verdicts: Verdict[]; tunnels: { opened: string; until: string; files: string[]; unmasked: boolean; journal: string; closed?: string; served?: { at: string; file: string; engine: string }[] }[] }
export type EngineLink = { engine: string; label: string; url: string; verified: string | null }
export type TunnelFile = { file: string; url: string; why: string; links: EngineLink[] }
export type TunnelState = { open: true; until: string; files: TunnelFile[]; served: number } | { open: false; cloudflared: boolean }
export type MapProps = { role: "candidate" | "excluded" | "sightline" | "pano" | "place"; label: string; ref?: string; radius_m?: number; heading?: number; date?: string; url?: string; kind?: string; group?: string; status?: string }
export type Raster = { id: string; label: string; tiles: string; maxzoom?: number; attribution?: string; period?: string }
export type MapView = { type: "FeatureCollection"; features: Feature<Point | LineString, MapProps>[]; rasters?: Raster[] }
export type EvidenceViewItem = { group: string; file?: string; url?: string; label?: string; kind?: string; rank?: number; page?: string | null; site?: string | null; score?: number; box?: number[]; t?: number | null; date?: string; heading?: number; license?: string; author?: string; verdict?: Verdict["verdict"] }
export type EvidenceView = { items: EvidenceViewItem[] }
export type Gut = { at: string; ranked: { place: string; p: number; cues: string }[]; region: string | null; would_change: string }
export type Truth = { lat: number; lon: number; at: string; error_km: number | null; score: number | null; country: string | null; country_code: string | null; region: string | null; answer: { hyp: string; title: string; point: [number, number] | null; level: string; confidence: string | null; country_code: string | null; region: string | null }; country_hit: boolean | null; region_hit: boolean | null; gut_hit: boolean | null; gut_rank: number | null }
export type ConfidenceRow = { n: number; median_km: number | null; within_25: number | null; within_200: number | null }
export type Scoreboard = { at: string; cases: number; median_km: number | null; mean_score: number | null; within: Record<"1" | "25" | "200" | "750" | "2500", number | null>; country_rate: number | null; gut_country_rate: number | null; by_confidence: Record<"high" | "medium" | "low", ConfidenceRow>; rows: { slug: string; error_km: number | null; score: number | null; confidence: string | null; country_hit: boolean | null; gut_hit: boolean | null }[] }
export type CalibrationView = { gut: Gut | null; truth: Truth | null; scoreboard: Scoreboard | null }
export type Upload = { path: string; name: string; size: number }
export type Status = "draft" | "running" | "done" | "blocked"
export type CaseSummary = { slug: string; type: string; title: string; status: Status; phase: string | null; confidence: string | null; answer: string | null; created: string; last: OsintEvent | null; thumb: string | null; counts: { entities: number; sources: number; leads_open: number }; parent: string | null; children: string[]; new: number; watch: Watch | null }
export type Option = { value: string; label: string; icon: string }
export type Input = { id: string; kind: "text" | "url" | "file" | "select" | "chips" | "toggle"; label: string; required?: boolean; placeholder?: string; default?: string | boolean | string[]; options?: Option[]; when?: Record<string, string | string[] | boolean>; multiline?: boolean; multiple?: boolean; help?: string; accept?: string; link?: boolean }
export type View = { widget: string; label?: string; icon?: string; kind?: string; where?: Props; columns?: string[]; view?: string }
export type Action = { id: string; label: string; icon: string; target: string; prompt: string; noisy: boolean; minutes: number }
export type Manifest = { id: string; label: string; icon: string; description: string; frame: (string | { id: string; always?: boolean; legal_basis?: string; purpose?: boolean })[]; inputs: Input[]; levels: { id: string; label: string; criteria: Record<string, string> }[]; phases: { id: string; label: string }[]; views: View[]; actions: Action[]; pivots: (string | { kind: string; has: string })[]; private: boolean }
export type Note = { path: string; props: Props; body: string; mtime: string }
export type SharedEntity = { key: string; kind: string; value: string; cases: { slug: string; path: string }[] }
export type DoctorLine = { status: "ok" | "MISSING" | "missing" | "info" | "warning"; name: string; text: string; fix?: string }
export type TypeReadiness = { id: string; label: string | null; private: boolean; path: string; where: string; ready: boolean; missing: string[]; notes: string[]; errors: string[]; refused: string | null }
export type Doctor = { lines: DoctorLine[]; types: TypeReadiness[]; home: string }
export type RefreshResult = { diffs: { name: string; first?: boolean; added: unknown[]; removed: unknown[]; changed: unknown[] }[]; agent: { id: string; section: string; prompt: string }[]; skipped?: string[] }

async function json<T>(r: Response): Promise<T> {
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(b.error ?? r.statusText)
  return b as T
}
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
export const api = {
  state: () => fetch("/api/state").then(r => json<AppState>(r)),
  // developer mode (Settings › Development) and the Fake APIs switch; each answers with the new state
  developer: (on: boolean) => post("/api/developer", { on }).then(r => json<AppState>(r)),
  fake: (on: boolean) => post("/api/fake", { on }).then(r => json<AppState>(r)),
  types: () => fetch("/api/types").then(r => json<Manifest[]>(r)),
  cases: () => fetch("/api/cases").then(r => json<CaseSummary[]>(r)),
  case: (slug: string) => fetch(`/api/cases/${slug}`).then(r => json<CaseIndex>(r)),
  note: (slug: string, path: string) => fetch(`/api/cases/${slug}/note?path=${encodeURIComponent(path)}`).then(r => json<Note>(r)),
  view: <T,>(slug: string, widget: string) => fetch(`/api/cases/${slug}/view/${widget}`).then(r => json<T | null>(r)),
  create: (body: unknown) => post("/api/cases", body).then(r => json<{ slug: string }>(r)),
  remove: (slug: string) => fetch(`/api/cases/${slug}`, { method: "DELETE" }).then(r => json<object>(r)),
  refresh: (slug: string) => post(`/api/cases/${slug}/refresh`).then(r => json<RefreshResult>(r)),
  seen: (slug: string) => post(`/api/cases/${slug}/seen`).then(r => json<object>(r)),
  shared: () => fetch("/api/entities/shared").then(r => json<SharedEntity[]>(r)),
  // a file of the New case form, sent before the case exists (a Blob: the browser sets Content-Length); its progress, and an abort
  upload: (file: File, onProgress?: (share: number) => void, signal?: AbortSignal) => new Promise<Upload>((ok, ko) => {
    const x = new XMLHttpRequest()
    x.open("POST", `/api/uploads?name=${encodeURIComponent(file.name)}`)
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    x.onload = () => { const b = JSON.parse(x.responseText || "{}"); if (x.status < 300) ok(b as Upload); else ko(new Error(b.error ?? x.statusText)) }
    x.onerror = () => ko(new Error("The upload was interrupted"))
    signal?.addEventListener("abort", () => { x.abort(); ko(new DOMException("Upload cancelled", "AbortError")) })
    x.send(file)
  }),
  capture: (slug: string, blob: Blob, name: string) => fetch(`/api/cases/${slug}/capture?name=${encodeURIComponent(name)}`, { method: "POST", body: blob }).then(r => json<{ path: string }>(r)),
  tunnel: (slug: string) => fetch(`/api/cases/${slug}/tunnel`).then(r => json<TunnelState>(r)),
  openTunnel: (slug: string, files: string[], minutes = 15, unmasked = false) => post(`/api/cases/${slug}/tunnel`, { files, minutes, ...(unmasked && { unmasked, yes: true }) }).then(r => json<{ open: true; until: string; files: TunnelFile[] }>(r)),
  closeTunnel: (slug: string) => fetch(`/api/cases/${slug}/tunnel`, { method: "DELETE" }).then(r => json<{ closed: boolean }>(r)),
  truth: (slug: string, lat: number, lon: number) => post(`/api/cases/${slug}/truth`, { lat, lon }).then(r => json<Truth>(r)),
  watch: () => fetch("/api/watch").then(r => json<WatchState>(r)),
  watchSettings: (patch: { on?: boolean; notify?: boolean }) => post("/api/watch", patch).then(r => json<WatchState>(r)),
  setWatch: (slug: string, every: Every | "off") => post(`/api/cases/${slug}/watch`, { every }).then(r => json<{ watch: Watch | null; stops: boolean }>(r)),
  // « Stop server »: the server answers, then exits
  stopServer: () => post("/__osint/quit").then(r => json<object>(r)),
  // « Export PDF »: the engine prints the case's print view; rejects with an Error that carries the engine's exit code
  // (3: no browser here, nothing failed: Print view still works)
  exportPdf: (slug: string, journal: boolean) => post(`/api/cases/${slug}/export${journal ? "?journal=1" : ""}`).then(async r => {
    const b = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(b.error ?? r.statusText), { code: b.code as number | undefined })
    return b as ExportResult
  }),
  doctor: (network = false) => (network ? post("/api/doctor/network") : fetch("/api/doctor")).then(r => json<Doctor>(r)),
}
export type ExportResult = { file: string; sha256: string; browser: string; journal: string }
// the print view: a static page the browser prints or saves as PDF (the engine's own PDF export prints the same page)
export const printUrl = (slug: string, journal = false) => `/print/${slug}${journal ? "?journal=1" : ""}`
// the case's PDFs, newest first: <slug>-<date>.pdf, then -2, -3… on the same day
export const exportsOf = (files: string[]) => files
  .filter(f => /^Exports\/[^/]+\.pdf$/.test(f))
  .map(f => ({ f, key: f.replace(/\.pdf$/, "").replace(/(\d{4}-\d{2}-\d{2})$/, "$1-1") }))
  .sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }))
  .map(x => x.f)
export const fileUrl = (slug: string, path: string) => `/api/cases/${slug}/file?path=${encodeURIComponent(path)}`
