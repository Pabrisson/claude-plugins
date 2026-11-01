import { useContext, useEffect, useRef, useState } from "react"
import { AudioLinesIcon, CaptionsIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClapperboardIcon, Columns2Icon, CopyIcon, DownloadIcon, ExternalLinkIcon, FileAudioIcon, FolderKanbanIcon, PianoIcon, StarIcon, Trash2Icon, UserRoundPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api, fileUrl, inputPath, mediaKind, outputPath, plain, when, type Job, type Line, type Shot, type Spec } from "@/lib/api"
import { Label } from "@/components/chips"
import { Thumb, Workspaces } from "@/components/inputs"
import { ModelLogo } from "@/components/model-logo"
import { BRIDGES, costOf, DeleteDialog, REMIX, SEND, sendToEdit, SONG, type Bridge, FINAL, isDraft } from "@/components/results"
import { CompareDialog } from "@/components/compare"

// the settings a result was made with, in words
const PARAMS: Record<string, [string, (v: unknown) => string]> = {
  aspect_ratio: ["Ratio", String],
  duration: ["Duration", (v) => `${v} s`],
  resolution: ["Resolution", String],
  quality: ["Quality", String],
  n: ["Images", String],
  sound: ["Sound", (v) => (v ? "on" : "off")],
  voice: ["Voice", String],
  seed: ["Seed", String],
  mid_times: ["Middle frames at", (v) => (v as number[]).map((t) => `${t} s`).join(", ")],
  draft_of: ["Final of the draft", String],
}
// a model's option as the Settings list shows it: on / off, else its value
const optionText = (v: unknown) => (v === true ? "on" : v === false ? "off" : String(v))
const words = (k: string) => (k[0].toUpperCase() + k.slice(1)).replaceAll("_", " ")
// an input's role, as the tools name them
const ROLES: Record<string, string> = { sketch: "Painted", matte: "Mask (kept here)", first_frame: "First frame", last_frame: "Last frame", voice_clips: "Voice", sheet: "Sheet" }
// what each next step does, under its name
const HINTS: Record<string, string> = {
  Remix: "Same settings, open in the composer",
  Animate: "Make it a video",
  "Make an element": "Keep it in the Library",
  "Make a voice": "Keep it in the Library",
  Extend: "Continue the shot",
  Upscale: "Sharper and larger",
  "Talking avatar": "A face speaks it",
  "Speech to video": "An image speaks or sings it",
  "Extend music": "It goes on, in its style",
  Cover: "The same melody, another style",
  Stems: "Its voice and instruments apart",
  "Send to edit": "A rush in video-editor",
  "Add to timeline": "After the last shot of the current workspace",
}
// who made it: the router, ElevenLabs straight or this machine
const MADE_BY: Record<string, string> = { kie: "Kie.ai", openrouter: "OpenRouter", local: "This machine", elevenlabs: "ElevenLabs" }
// a Suno song's extras (Kie), each a small job of its own: its WAV, its words with their times, a music video, a stem's
// notes; a singer from it asks its name and where it sings alone
const EXTRAS = [
  { tool: "wav", label: "WAV", icon: FileAudioIcon, hint: "The song as a WAV file" },
  { tool: "lyrics-timings", label: "Lyrics with timings", icon: CaptionsIcon, hint: "Each sung word with its time: captions" },
  { tool: "music-video", label: "Music video", icon: ClapperboardIcon, hint: "An MP4 with its cover and a visualizer" },
]
async function runExtra(spec: Spec, label: string, confirm = false) {
  try {
    await api.generate(spec, confirm)
    toast.success(`${label} started`, { description: "It lands in Audio's results." })
  } catch (e) {
    const err = e as Error & { status?: number; body?: { shown?: string } }
    if (err.status === 409) toast(`${label}: ${err.body?.shown ?? "a cost"} to confirm`, { action: { label: "Go on", onClick: () => runExtra(spec, label, true) } })
    else toast.error(plain(err.message))
  }
}
const extraSpec = (tool: string, file: string | string[], fields: Record<string, string> = {}): Spec => ({ kind: "audio", tool, prompt: "", fields, inputs: { clip: [file].flat() }, params: {} })

const bytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
const span = (a?: string, b?: string) => {
  const s = a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : NaN
  return Number.isFinite(s) && s >= 0 ? (s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`) : null
}

// a result in full: its media, how it was made, what it cost, and every next step; ← and → walk the list
export function Viewer({
  jobs,
  id,
  onId,
  home,
  per1000,
  onBridge,
}: {
  jobs: Job[]
  id: string | null
  onId: (id: string | null) => void
  home: string
  per1000: number | null
  onBridge: (b: Bridge, job: Job, file: string) => void
}) {
  const i = jobs.findIndex((j) => j.id === id)
  const job = i >= 0 ? jobs[i] : null
  const go = (d: number) => jobs[i + d] && onId(jobs[i + d].id)
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onId(null)}>
      {job && (
        <DialogContent
          className="flex h-[min(900px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-[min(1440px,calc(100vw-2rem))]"
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest("video, audio, input, textarea")) return
            if (e.key === "ArrowLeft") go(-1)
            if (e.key === "ArrowRight") go(1)
          }}
        >
          <Body key={job.id} job={job} jobs={jobs} home={home} per1000={per1000} prev={i > 0 ? () => go(-1) : null} next={i < jobs.length - 1 ? () => go(1) : null} onBridge={(b, f) => (onId(null), onBridge(b, job, f))} onClose={() => onId(null)} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function Body({
  job,
  jobs,
  home,
  per1000,
  prev,
  next,
  onBridge,
  onClose,
}: {
  job: Job
  jobs: Job[]
  home: string
  per1000: number | null
  prev: (() => void) | null
  next: (() => void) | null
  onBridge: (b: Bridge, file: string) => void
  onClose: () => void
}) {
  const [out, setOut] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [comparing, setComparing] = useState(false)
  // the download block's width: its menu takes it exactly
  const block = useRef<HTMLDivElement>(null)
  const [blockWidth, setBlockWidth] = useState<number>()
  const ws = useContext(Workspaces)
  // what the file itself says: its size on screen, its length, its weight; a video the browser cannot play (ProRes)
  const [known, setKnown] = useState<Record<string, { w?: number; h?: number; length?: number; size?: number; unplayable?: boolean }>>({})
  const file = job.outputs[out] ? outputPath(home, job, job.outputs[out]) : null
  const facts = (file && known[file]) || {}
  const setFacts = (patch: (typeof known)[string]) => file && setKnown((all) => ({ ...all, [file]: { ...all[file], ...patch } }))
  const k = file ? mediaKind(file) : null
  // a song's cover beside its take (Suno: cover-1 for out-1), a text file read as it is (lyrics, captions, notes)
  const name = job.outputs[out] ?? "", cover = job.outputs.find((o) => mediaKind(o) === "image" && o.replace(/^cover-/, "").split(".")[0] === name.replace(/^out-/, "").split(".")[0] && /^cover-/.test(o))
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (!file || k !== "other") return
    fetch(fileUrl(file)).then((r) => r.text()).then(setText, () => setText(null))
  }, [file, k])
  const take = job.suno?.tracks?.some((t) => t.file === name)
  // a take's voice taken apart (the Singer tool's voice-1.mp3): a singer is made from it
  const voiceOnly = job.suno?.tracks?.some((t) => t.voice === name)
  const [singer, setSinger] = useState<{ name: string; description: string; start: string; end: string } | null>(null)
  // Make a singer: its name and voice as the Singer tool was told, where it sings the most found by the engine
  const openSinger = () => {
    setSinger({ name: String(job.fields?.name ?? ""), description: String(job.fields?.voice ?? ""), start: "", end: "" })
    api.sung(file!).then(
      (w) => setSinger((s) => (s && !s.start && !s.end ? { ...s, start: String(w.start), end: String(w.end) } : s)),
      (e) => toast.error(plain(e.message))
    )
  }
  const failed = job.status === "failed"
  // the tracks Kie turns into WAV (a song's takes, a Stems' tracks): All in WAV, priced by the engine
  const wavs = failed ? [] : (job.tool === "stems" ? job.outputs.filter((o) => mediaKind(o) === "audio") : (job.suno?.tracks ?? []).map((t) => t.file)).map((o) => outputPath(home, job, o))
  const wavKey = wavs.join("|")
  const [wavPrice, setWavPrice] = useState<string | null>(null)
  useEffect(() => {
    const all = wavKey.split("|")
    if (all.length < 2) return
    api.estimate(extraSpec("wav", all)).then(
      (a) => setWavPrice([a.estimate.credits != null && `${a.estimate.credits} credits`, a.estimate.known ? a.shown : "unknown cost"].filter(Boolean).join(" · ")),
      () => setWavPrice(null)
    )
  }, [wavKey])
  useEffect(() => {
    if (!file) return
    fetch(fileUrl(file), { method: "HEAD" })
      .then((r) => +(r.headers.get("content-length") ?? 0))
      .then((size) => size && setKnown((all) => ({ ...all, [file]: { ...all[file], size } })), () => {})
  }, [file])
  // the shots and a dialogue's lines have their own blocks; the model's options are listed one by one
  const shots = Array.isArray(job.params?.shots) ? (job.params.shots as Shot[]) : null
  const lines = Array.isArray(job.params?.dialogue) ? (job.params.dialogue as Line[]) : null
  const params = Object.entries(job.params ?? {}).filter(([k, v]) => v !== undefined && v !== null && v !== "" && !["shots", "dialogue", "options", "keyframe_video"].includes(k))
  const options = Object.entries((job.params?.options as Record<string, unknown> | undefined) ?? {})
  // a field's words, not the dashboard's own state beside it (a light's stage: "light:rig") nor an untouched margin
  const fields = Object.entries(job.fields ?? {}).filter(([k, v]) => v && v !== "0" && !k.includes(":"))
  const inputs = Object.entries(job.inputs ?? {}).flatMap(([key, list]) => list.map((f) => ({ key, f })))
  const [lab, model] = job.name.includes(": ") ? [job.name.slice(0, job.name.indexOf(": ")), job.name.slice(job.name.indexOf(": ") + 2)] : [job.provider === "local" ? "Local" : job.provider, job.name]
  const made = span(job.started ?? job.created, job.finished)
  const actions = [
    ...(job.tool === "import" ? [] : [{ ...REMIX, run: () => onBridge("remix", failed ? "" : (file ?? "")) }]),
    ...(isDraft(job) ? [{ ...FINAL, hint: "In 1080p, from this draft (Kie lists no price for it)", run: () => onBridge("final", file ?? "") }] : []),
    // already on the current workspace's timeline: its place there instead of « Add to timeline »
    // Make a voice only on speech (a song makes a singer instead)
    ...(failed || !k ? [] : (BRIDGES[k] ?? []).filter((x) => !(k === "audio" && x.b === "element" && !["voice", "change-voice", "isolate-voice", "translate", "import"].includes(job.tool))).map((x) => (x.b === "timeline" && ws.shots[file!] ? { ...x, label: `${ws.shots[file!]} on the timeline`, hint: "Show it in the timeline", run: () => onBridge("shot", file!) } : { ...x, run: () => onBridge(x.b, file!) }))),
    ...(failed || !file ? [] : [{ ...SEND, run: () => sendToEdit(file) }]),
    // a sound's music tools (Kie), Stems on a song Suno made; a take's extras; a stem's notes
    ...(failed || k !== "audio" || job.provider !== "kie" ? [] : SONG.filter((x) => !x.suno || take).map((x) => ({ ...x, run: () => onBridge(x.b, file!) }))),
    ...(failed || !take ? [] : [...EXTRAS.map((x) => ({ ...x, run: () => runExtra(extraSpec(x.tool, file!), x.label) })), { label: "Make a singer", icon: UserRoundPlusIcon, hint: "Its voice and style in the Library, for Music", run: openSinger }]),
    ...(wavs.length < 2 ? [] : [{ label: "All in WAV", icon: FileAudioIcon, hint: `${wavs.length} tracks${wavPrice ? ` · ${wavPrice}` : ""}`, run: () => (runExtra(extraSpec("wav", wavs), "All in WAV"), onClose()) }]),
    ...(failed || !voiceOnly ? [] : [{ label: "Make a singer", icon: UserRoundPlusIcon, hint: "This voice in the Library, for Music's Singer", run: openSinger }]),
    ...(failed || job.tool !== "stems" || k !== "audio" ? [] : [{ label: "MIDI", icon: PianoIcon, hint: "This stem's notes", run: () => runExtra(extraSpec("midi", file!), "MIDI") }, { label: "WAV", icon: FileAudioIcon, hint: "This stem as a WAV file", run: () => runExtra(extraSpec("wav", file!), "WAV") }]),
  ]
  const ext = file?.split(".").pop()?.toUpperCase()
  const stats = [
    { label: "Cost", value: costOf(job, per1000), cost: job.provider !== "local" && !failed },
    { label: "Router", value: MADE_BY[job.provider] ?? job.provider },
    facts.w ? { label: k === "video" ? "Frame" : "Size", value: `${facts.w} × ${facts.h}` } : null,
    facts.length ? { label: "Length", value: `${facts.length.toFixed(1)} s` } : null,
    ext ? { label: "File", value: `${ext}${facts.size ? ` · ${bytes(facts.size)}` : ""}` } : null,
    made ? { label: "Made in", value: made } : null,
  ].filter((x): x is { label: string; value: string; cost?: boolean } => !!x)

  return (
    <>
      <div className="relative flex min-w-0 flex-1 flex-col bg-black">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3">
          {(prev || next) && (
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80 tabular-nums ring-1 ring-white/15 backdrop-blur-sm">
              {jobs.indexOf(job) + 1} / {jobs.length}
            </span>
          )}
          <span className="flex-1" />
          {file && !failed && (
            <span className="pointer-events-auto flex gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => setComparing(true)} className="bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
                <Columns2Icon data-icon="inline-start" /> Compare
              </Button>
              <Button variant="secondary" size="icon-sm" asChild className="bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
                <a href={fileUrl(file)} target="_blank" rel="noreferrer" aria-label="Open in a new tab" title="Open in a new tab">
                  <ExternalLinkIcon />
                </a>
              </Button>
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 pt-14">
          {failed ? (
            <p className="max-w-md text-center text-sm text-destructive">{plain(job.error ?? "Failed")}</p>
          ) : k === "image" ? (
            <img src={fileUrl(file!)} alt={job.prompt} onLoad={(e) => setFacts({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="max-h-full max-w-full rounded-lg object-contain" />
          ) : k === "video" && facts.unplayable ? (
            <p className="max-w-sm text-center text-sm text-white/70">
              The browser cannot show this {ext} file (ProRes keeps the transparency for editing software). Download it, or pick the other result to preview it.
            </p>
          ) : k === "video" ? (
            <video
              src={fileUrl(file!)}
              controls
              autoPlay
              loop
              playsInline
              onLoadedMetadata={(e) => setFacts({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight, length: e.currentTarget.duration })}
              onError={() => setFacts({ unplayable: true })}
              className="max-h-full max-w-full rounded-lg bg-[repeating-conic-gradient(#222_0_25%,#2c2c2c_0_50%)] bg-size-[24px_24px]"
            />
          ) : k === "other" ? (
            <pre className="max-h-full w-full max-w-2xl overflow-auto rounded-lg bg-white/5 p-5 text-sm leading-relaxed whitespace-pre-wrap text-white/85">{text ?? "…"}</pre>
          ) : k === "audio" ? (
            <div className="flex w-full max-w-lg flex-col items-center gap-6">
              {cover ? <img src={fileUrl(outputPath(home, job, cover))} alt="" className="size-56 rounded-xl object-cover shadow-lg" /> : <AudioLinesIcon className="size-16 text-aud" aria-hidden />}
              <audio src={fileUrl(file!)} controls autoPlay onLoadedMetadata={(e) => setFacts({ length: e.currentTarget.duration })} className="w-full" />
            </div>
          ) : null}
        </div>
        {job.outputs.length > 1 && (
          <div className="flex justify-center gap-2 pb-4">
            {job.outputs.map((o, n) => (
              <button
                key={o}
                type="button"
                aria-label={`Result ${n + 1}: ${o}`}
                title={o}
                aria-current={n === out}
                onClick={() => setOut(n)}
                className={cn("size-14 overflow-hidden rounded-md opacity-60 ring-2 ring-transparent transition hover:opacity-100", n === out && "opacity-100 ring-white")}
              >
                {/\.(mov|txt|srt|json)$/i.test(o) ? <span className="grid size-full place-items-center bg-white/10 text-[11px] font-semibold text-white">{o.split(".").pop()!.toUpperCase()}</span> : <Thumb path={outputPath(home, job, o)} />}
              </button>
            ))}
          </div>
        )}
        {prev && (
          <Button variant="secondary" size="icon" aria-label="Previous" onClick={prev} className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
            <ChevronLeftIcon />
          </Button>
        )}
        {next && (
          <Button variant="secondary" size="icon" aria-label="Next" onClick={next} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
            <ChevronRightIcon />
          </Button>
        )}
      </div>

      <aside className="flex w-96 shrink-0 flex-col border-l">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">
          <div className="flex items-start gap-3 pr-8">
            <ModelLogo model={job.model} lab={lab} className="size-10 rounded-lg p-2" />
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold">{job.label}</DialogTitle>
              <DialogDescription className="truncate" title={job.name}>
                {model} · {lab}
              </DialogDescription>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {when(job.created)}
                {job.by === "claude" && <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">by Claude</span>}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2">
            {stats.map((x) => (
              <div key={x.label} className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
                <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{x.label}</dt>
                <dd className={cn("truncate text-sm font-medium tabular-nums", x.cost && "text-cost")} title={x.value}>
                  {x.value}
                </dd>
              </div>
            ))}
          </dl>

          {job.prompt && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>{job.kind === "audio" && k === "audio" ? "Text" : "Prompt"}</Label>
                <Button variant="ghost" size="xs" className="-mt-2" onClick={() => navigator.clipboard.writeText(job.prompt).then(() => toast.success("Prompt copied"))}>
                  <CopyIcon data-icon="inline-start" /> Copy
                </Button>
              </div>
              <p className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">{job.prompt}</p>
            </div>
          )}

          {shots && (
            <div>
              <Label>Shots</Label>
              <ol className="flex flex-col gap-1.5">
                {shots.map((x, i) => (
                  <li key={i} className="rounded-lg bg-muted/50 px-3 py-2 text-sm leading-relaxed">
                    <span className="mr-2 text-xs font-semibold text-muted-foreground tabular-nums">
                      {i + 1} · {x.duration} s
                    </span>
                    {x.prompt}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {lines && (
            <div>
              <Label>Lines</Label>
              <ol className="flex flex-col gap-1.5">
                {lines.map((l, i) => (
                  <li key={i} className="rounded-lg bg-muted/50 px-3 py-2 text-sm leading-relaxed">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{l.voice}</span>
                    {l.text}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {(params.length > 0 || fields.length > 0 || options.length > 0) && (
            <div>
              <Label>Settings</Label>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {[
                  ...params.map(([key, v]) => [PARAMS[key]?.[0] ?? words(key), PARAMS[key]?.[1](v) ?? String(v)]),
                  ...options.map(([key, v]) => [words(key), optionText(v)]),
                  ...fields.map(([key, v]) => [words(key), v]),
                ].map(([l, v]) => (
                  <div key={l} className="contents">
                    <dt className="text-muted-foreground">{l}</dt>
                    <dd className="line-clamp-3 break-words" title={v}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {inputs.length > 0 && (
            <div>
              <Label>Inputs</Label>
              <div className="flex flex-wrap gap-2">
                {inputs.map(({ key, f }) => (
                  <a key={f} href={fileUrl(inputPath(home, job, f))} target="_blank" rel="noreferrer" className="flex w-16 flex-col gap-1" title={f}>
                    <span className="size-16 overflow-hidden rounded-md border">
                      <Thumb path={inputPath(home, job, f)} />
                    </span>
                    <span className="truncate text-center text-[11px] text-muted-foreground">{ROLES[key] ?? words(key)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {actions.length > 0 && (
            <div>
              <Label>Next</Label>
              <div className="flex flex-col gap-1">
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.run}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                      <a.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.label}</span>
                      {(("hint" in a && (a.hint as string)) || HINTS[a.label]) && <span className="block truncate text-xs text-muted-foreground">{("hint" in a && (a.hint as string)) || HINTS[a.label]}</span>}
                    </span>
                  </button>
                ))}
                {!failed && ws.list.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                          <FolderKanbanIcon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">Add to workspace</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {job.workspaces?.length ? `In ${ws.list.filter((w) => job.workspaces!.includes(w.slug)).map((w) => w.name).join(", ")}` : "In no workspace"}
                          </span>
                        </span>
                        <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="left" align="start" className="min-w-56">
                      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                      {ws.list.map((w) => {
                        const on = !!job.workspaces?.includes(w.slug)
                        return (
                          <DropdownMenuCheckboxItem key={w.slug} checked={on} onSelect={(e) => e.preventDefault()} onCheckedChange={() => api.workspaces({ slug: w.slug, ...(on ? { drop: [job.id] } : { add: [job.id] }) }).catch((e) => toast.error(plain(e.message)))}>
                            {w.name}
                          </DropdownMenuCheckboxItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t p-4">
          <div className="flex gap-2">
            {file && (
              // one block: the file, then behind a thin inset line the arrow for every file of the result at once
              <div ref={block} className="flex flex-1 items-center overflow-hidden rounded-md bg-primary">
                <Button className="flex-1 rounded-none shadow-none" asChild>
                  <a href={fileUrl(file)} download={file.split(/[\\/]/).pop()}>
                    <DownloadIcon data-icon="inline-start" /> Download{job.outputs.length > 1 ? ` ${ext}` : ""}
                  </a>
                </Button>
                {job.outputs.length > 1 && (
                  <DropdownMenu onOpenChange={(o) => o && setBlockWidth(block.current?.offsetWidth)}>
                    <span className="h-5 w-px bg-primary-foreground/20" aria-hidden />
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" aria-label="More downloads" className="w-9 rounded-none shadow-none">
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="end" sideOffset={6} collisionPadding={12} style={{ width: blockWidth }}>
                      <DropdownMenuItem asChild>
                        <a href={`/api/media/${job.id}/zip`} download>
                          <span className="flex flex-col">
                            <span>Download all ({job.outputs.length})</span>
                            <span className="text-xs text-muted-foreground">Every file of this result in a .zip</span>
                          </span>
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
            <Button variant="outline" size="icon" aria-label={job.favorite ? "Remove from favorites" : "Add to favorites"} title="Favorite" onClick={() => api.media(job.id, "favorite")}>
              <StarIcon className={cn(job.favorite && "fill-current text-cost")} />
            </Button>
            <Button variant="outline" size="icon" aria-label="Delete" title="Delete" onClick={() => setConfirm(true)}>
              <Trash2Icon />
            </Button>
          </div>
          {(prev || next) && (
            <p className="text-center text-xs text-muted-foreground">
              <Kbd>←</Kbd> <Kbd>→</Kbd> to browse · <Kbd>Esc</Kbd> to close
            </p>
          )}
        </div>
        <DeleteDialog job={job} open={confirm} onOpenChange={setConfirm} onDeleted={onClose} />
        <Dialog open={!!singer} onOpenChange={(o) => !o && setSinger(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogTitle>Make a singer</DialogTitle>
            <DialogDescription>Suno keeps this {voiceOnly ? "voice" : "song's voice and style"} as a singer of the Library: the Singer field of Music, Extend, Cover, Mashup and Replace section takes it. Free.</DialogDescription>
            {singer && (
              <div className="flex flex-col gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={singer.name} placeholder="Nova" onChange={(e) => setSinger({ ...singer, name: e.target.value.replace(/[^\w-]/g, "") })} />
                </div>
                <div>
                  <Label>Described</Label>
                  <Input value={singer.description} placeholder="a warm, breathy female pop voice" onChange={(e) => setSinger({ ...singer, description: e.target.value })} />
                </div>
                <div>
                  <Label hint="10 to 30 s where it sings, found for you">Sung from</Label>
                  <div className="flex items-center gap-2">
                    <Input className="w-24" inputMode="decimal" value={singer.start} placeholder="…" onChange={(e) => setSinger({ ...singer, start: e.target.value })} aria-label="From (s)" />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input className="w-24" inputMode="decimal" value={singer.end} placeholder="…" onChange={(e) => setSinger({ ...singer, end: e.target.value })} aria-label="To (s)" />
                  </div>
                  {/* that part, to hear before keeping it */}
                  {singer.start && singer.end && <audio key={`${singer.start}-${singer.end}`} controls src={`${fileUrl(file!)}#t=${singer.start},${singer.end}`} className="mt-2 h-9 w-full" />}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setSinger(null)}>Cancel</Button>
                  <Button
                    disabled={!singer.name || !singer.description || !singer.start || !singer.end}
                    onClick={() => (runExtra(extraSpec("singer", file!, singer), "Make a singer"), setSinger(null))}
                  >
                    Make it
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        {file && <CompareDialog open={comparing} onOpenChange={setComparing} origin={job} file={file} jobs={jobs} home={home} per1000={per1000} />}
      </aside>
    </>
  )
}
