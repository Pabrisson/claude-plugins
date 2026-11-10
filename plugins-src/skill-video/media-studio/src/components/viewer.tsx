import { useContext, useEffect, useRef, useState } from "react"
import { AudioLinesIcon, CaptionsIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClapperboardIcon, Columns2Icon, CopyIcon, DownloadIcon, ExternalLinkIcon, FileAudioIcon, FolderKanbanIcon, PauseIcon, PianoIcon, PlayIcon, StarIcon, Trash2Icon, UserRoundPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Slider } from "@/components/ui/slider"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api, fileUrl, inputPath, mediaKind, outputPath, plain, when, type Job, type Line, type Shot, type Spec } from "@/lib/api"
import { jsonParts } from "@/lib/text"
import { locale, own, t } from "@/lib/i18n"
import { Label } from "@/components/chips"
import { Thumb, Workspaces } from "@/components/inputs"
import { ModelLogo } from "@/components/model-logo"
import { BRIDGES, costOf, DeleteDialog, HINTS, REMIX, SEND, sendToEdit, SONG, type Bridge, FINAL, isDraft } from "@/components/results"
import { CompareDialog, secs } from "@/components/compare"
import { useZoom, ZoomBadge } from "@/components/zoom"

// the settings a result was made with, in words
const PARAMS: Record<string, [string, (v: unknown) => string]> = {
  aspect_ratio: [t("Ratio"), String],
  duration: [t("Duration"), (v) => `${v} s`],
  resolution: [t("Resolution"), String],
  quality: [t("Quality"), String],
  n: [t("Images"), String],
  sound: [t("Sound"), (v) => (v ? t("on") : t("off"))],
  voice: [t("Voice"), String],
  seed: [t("Seed"), String],
  mid_times: [t("Middle frames at"), (v) => (v as number[]).map((x) => `${x} s`).join(", ")],
  draft_of: [t("Final of the draft"), String],
}
// a model's option as the Settings list shows it: on / off, else its value
const optionText = (v: unknown) => (v === true ? t("on") : v === false ? t("off") : String(v))
// a key in words; shown as the catalogs' word of the same text where there is one (a field's « Voice », « Style »)
const words = (k: string) => (k[0].toUpperCase() + k.slice(1)).replaceAll("_", " ")
// an input's role, as the tools name them
const ROLES: Record<string, string> = { sketch: t("Painted"), matte: t("Mask (kept here)"), first_frame: t("First frame"), last_frame: t("Last frame"), voice_clips: t("Voice"), sheet: t("Sheet") }
// who made it: the router, ElevenLabs straight or this machine
const MADE_BY: Record<string, string> = { kie: "Kie.ai", openrouter: "OpenRouter", local: t("This machine"), elevenlabs: "ElevenLabs" }
// a Suno song's extras (Kie), each a small job of its own: its WAV, its words with their times, a music video, a stem's
// notes; a singer from it asks its name and where it sings alone
const EXTRAS = [
  { tool: "wav", label: "WAV", icon: FileAudioIcon, hint: t("The song as a WAV file") },
  { tool: "lyrics-timings", label: t("Lyrics with timings"), icon: CaptionsIcon, hint: t("Each sung word with its time: captions") },
  { tool: "music-video", label: t("Music video"), icon: ClapperboardIcon, hint: t("An MP4 with its cover and a visualizer") },
]
async function runExtra(spec: Spec, label: string, confirm = false) {
  try {
    await api.generate(spec, confirm)
    toast.success(t("{label} started", { label }), { description: t("It lands in Audio's results.") })
  } catch (e) {
    const err = e as Error & { status?: number; body?: { shown?: string } }
    if (err.status === 409) toast(t("{label}: {cost} to confirm", { label, cost: err.body?.shown ?? t("a cost") }), { action: { label: t("Go on"), onClick: () => runExtra(spec, label, true) } })
    else toast.error(plain(err.message))
  }
}
const extraSpec = (tool: string, file: string | string[], fields: Record<string, string> = {}): Spec => ({ kind: "audio", tool, prompt: "", fields, inputs: { clip: [file].flat() }, params: {} })

// a number with one decimal, as the dashboard's language writes it
const one = (n: number) => n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const bytes = (n: number) => (n >= 1e6 ? t("{n} MB", { n: one(n / 1e6) }) : t("{n} KB", { n: Math.max(1, Math.round(n / 1e3)) }))
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
  // + − 0: the shown media's zoom (in Body)
  const zoomKey = useRef<((k: string) => boolean) | null>(null)
  const onZoomKey = (f: (k: string) => boolean) => {
    zoomKey.current = f
  }
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onId(null)}>
      {job && (
        <DialogContent
          className="flex h-[min(900px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-[min(1440px,calc(100vw-2rem))]"
          onKeyDown={(e) => {
            const target = e.target as HTMLElement
            if (target.closest("input, textarea") || zoomKey.current?.(e.key) || target.closest("video, audio")) return
            if (e.key === "ArrowLeft") go(-1)
            if (e.key === "ArrowRight") go(1)
          }}
        >
          <Body key={job.id} job={job} jobs={jobs} home={home} per1000={per1000} prev={i > 0 ? () => go(-1) : null} next={i < jobs.length - 1 ? () => go(1) : null} onBridge={(b, f) => (onId(null), onBridge(b, job, f))} onClose={() => onId(null)} onZoomKey={onZoomKey} />
        </DialogContent>
      )}
    </Dialog>
  )
}

// a zoomed video's playback: play or pause, where it is, a seek bar
function Transport({ video }: { video: HTMLVideoElement }) {
  const el = useRef(video)
  const read = (v: HTMLVideoElement) => ({ paused: v.paused, time: v.currentTime, length: v.duration || 0 })
  const [at, setAt] = useState(() => read(video))
  useEffect(() => {
    const on = () => setAt(read(video))
    const events = ["timeupdate", "play", "pause", "durationchange", "seeked"]
    for (const ev of events) video.addEventListener(ev, on)
    return () => {
      for (const ev of events) video.removeEventListener(ev, on)
    }
  }, [video])
  const paused = at.paused
  return (
    <div className="absolute inset-x-6 bottom-3 flex items-center gap-3 rounded-full bg-black/60 py-1 pr-4 pl-1 ring-1 ring-white/15 backdrop-blur-sm">
      <Button variant="ghost" size="icon-sm" aria-label={paused ? t("Play") : t("Pause")} onClick={() => (paused ? video.play().catch(() => {}) : video.pause())} className="rounded-full text-white hover:bg-white/15 hover:text-white">
        {paused ? <PlayIcon /> : <PauseIcon />}
      </Button>
      <span className="text-xs whitespace-nowrap text-white/80 tabular-nums">
        {secs(at.time)} / {secs(at.length)}
      </span>
      <Slider value={[at.time]} max={at.length || 1} step={0.01} onValueChange={([v]) => (el.current.currentTime = v)} aria-label={t("Position")} className="flex-1" />
    </div>
  )
}

const JSON_COLORS: Record<string, string> = { key: "text-sky-300", string: "text-emerald-300", number: "text-amber-300", boolean: "text-violet-300", null: "text-rose-300" }
function JsonView({ text }: { text: string }) {
  return <>{jsonParts(text).map((p, i) => (p.kind ? <span key={i} className={JSON_COLORS[p.kind]}>{p.text}</span> : p.text))}</>
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
  onZoomKey,
}: {
  job: Job
  jobs: Job[]
  home: string
  per1000: number | null
  prev: (() => void) | null
  next: (() => void) | null
  onBridge: (b: Bridge, file: string) => void
  onClose: () => void
  onZoomKey: (f: (k: string) => boolean) => void
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
  // an image or a video zooms on the wheel; zoomed, a video's own controls give way to a bar that stays its size
  const [stage, setStage] = useState<HTMLElement | null>(null)
  const zoom = useZoom(file ?? "", stage)
  useEffect(() => onZoomKey(zoom.key))
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
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
  // a voice ElevenLabs designed or remixed (Design a voice, Remix a voice): kept under a name, free
  const designed = job.voices?.some((v) => v.file === name)
  const [keeping, setKeeping] = useState<string | null>(null)
  const keep = (as: string) =>
    api.keepVoice(job.id, name, as).then(
      (el) => (toast.success(t("@{name} is in the Library", { name: el.name }), { description: t("A voice of your ElevenLabs account too: Voice, Change voice and the others take it.") }), setKeeping(null)),
      (e) => toast.error(plain(e.message))
    )
  // the tracks Kie turns into WAV (a song's takes, a Stems' tracks): All in WAV, priced by the engine
  const wavs = failed ? [] : (job.tool === "stems" && job.provider === "kie" ? job.outputs.filter((o) => mediaKind(o) === "audio") : (job.suno?.tracks ?? []).map((t) => t.file)).map((o) => outputPath(home, job, o))
  const wavKey = wavs.join("|")
  const [wavPrice, setWavPrice] = useState<string | null>(null)
  useEffect(() => {
    const all = wavKey.split("|")
    if (all.length < 2) return
    api.estimate(extraSpec("wav", all)).then(
      (a) => setWavPrice([a.estimate.credits != null && t("{n} credits", { n: a.estimate.credits }), a.estimate.known ? a.shown : t("unknown cost")].filter(Boolean).join(" · ")),
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
    ...(isDraft(job) ? [{ ...FINAL, hint: t("In 1080p, from this draft (Kie lists no price for it)"), run: () => onBridge("final", file ?? "") }] : []),
    // already on the current workspace's timeline: its place there instead of « Add to timeline »
    // Make a voice only on speech (a song makes a singer instead)
    ...(failed || !k ? [] : (BRIDGES[k] ?? []).filter((x) => !(k === "audio" && x.b === "element" && !["voice", "change-voice", "isolate-voice", "translate", "import"].includes(job.tool))).map((x) => (x.b === "timeline" && ws.shots[file!] ? { ...x, label: t("{shot} on the timeline", { shot: ws.shots[file!] }), hint: t("Show it in the timeline"), run: () => onBridge("shot", file!) } : { ...x, run: () => onBridge(x.b, file!) }))),
    ...(failed || !file ? [] : [{ ...SEND, run: () => sendToEdit(file) }]),
    // a sound's music tools (Kie), Stems on a song Suno made; a take's extras; a stem's notes
    ...(failed || k !== "audio" || job.provider !== "kie" ? [] : SONG.filter((x) => !x.suno || take).map((x) => ({ ...x, run: () => onBridge(x.b, file!) }))),
    ...(failed || !take ? [] : [...EXTRAS.map((x) => ({ ...x, run: () => runExtra(extraSpec(x.tool, file!), x.label) })), { label: t("Make a singer"), icon: UserRoundPlusIcon, hint: t("Its voice and style in the Library, for Music"), run: openSinger }]),
    ...(wavs.length < 2 ? [] : [{ label: t("All in WAV"), icon: FileAudioIcon, hint: `${t("{n} tracks", { n: wavs.length })}${wavPrice ? ` · ${wavPrice}` : ""}`, run: () => (runExtra(extraSpec("wav", wavs), t("All in WAV")), onClose()) }]),
    ...(failed || !voiceOnly ? [] : [{ label: t("Make a singer"), icon: UserRoundPlusIcon, hint: t("This voice in the Library, for Music's Singer"), run: openSinger }]),
    ...(failed || !designed ? [] : [{ label: t("Keep this voice"), icon: UserRoundPlusIcon, hint: t("In the Library and on your ElevenLabs account, free"), run: () => setKeeping("") }]),
    ...(failed || job.tool !== "stems" || job.provider !== "kie" || k !== "audio" ? [] : [{ label: "MIDI", icon: PianoIcon, hint: t("This stem's notes"), run: () => runExtra(extraSpec("midi", file!), "MIDI") }, { label: "WAV", icon: FileAudioIcon, hint: t("This stem as a WAV file"), run: () => runExtra(extraSpec("wav", file!), "WAV") }]),
  ]
  const ext = file?.split(".").pop()?.toUpperCase()
  const stats = [
    { label: t("Cost"), value: costOf(job, per1000), cost: job.provider !== "local" && !failed },
    { label: t("Router"), value: MADE_BY[job.provider] ?? job.provider },
    facts.w ? { label: k === "video" ? t("Frame") : t("Size"), value: `${facts.w} × ${facts.h}` } : null,
    facts.length ? { label: t("Length"), value: `${one(facts.length)} s` } : null,
    ext ? { label: t("File"), value: `${ext}${facts.size ? ` · ${bytes(facts.size)}` : ""}` } : null,
    made ? { label: t("Made in"), value: made } : null,
  ].filter((x): x is { label: string; value: string; cost?: boolean } => !!x)

  return (
    <>
      <div className="relative flex min-w-0 flex-1 flex-col bg-black">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3">
          {(prev || next) && (
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/80 tabular-nums ring-1 ring-white/15 backdrop-blur-sm">
              {jobs.indexOf(job) + 1} / {jobs.length}
            </span>
          )}
          {zoom.zoomed && <ZoomBadge zoom={zoom} />}
          <span className="flex-1" />
          {file && !failed && (
            <span className="pointer-events-auto flex gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => setComparing(true)} className="bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
                <Columns2Icon data-icon="inline-start" /> {t("Compare")}
              </Button>
              <Button variant="secondary" size="icon-sm" asChild className="bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
                <a href={fileUrl(file)} target="_blank" rel="noreferrer" aria-label={t("Open in a new tab")} title={t("Open in a new tab")}>
                  <ExternalLinkIcon />
                </a>
              </Button>
            </span>
          )}
        </div>
        <div
          ref={setStage}
          data-zoom={(!failed && (k === "image" || (k === "video" && !facts.unplayable))) || undefined}
          onPointerDown={zoom.down}
          onPointerMove={zoom.move}
          onPointerUp={zoom.up}
          onPointerCancel={zoom.up}
          onDoubleClick={zoom.double}
          className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6 pt-14", zoom.zoomed && "cursor-grab touch-none select-none active:cursor-grabbing")}
        >
          {failed ? (
            <p className="max-w-md text-center text-sm text-destructive">{plain(job.error ?? t("Failed"))}</p>
          ) : k === "image" ? (
            <img src={fileUrl(file!)} alt={job.prompt} draggable={false} style={zoom.style} onLoad={(e) => setFacts({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="max-h-full max-w-full rounded-lg object-contain" />
          ) : k === "video" && facts.unplayable ? (
            <p className="max-w-sm text-center text-sm text-white/70">
              {t("The browser cannot show this {ext} file (ProRes keeps the transparency for editing software). Download it, or pick the other result to preview it.", { ext: ext ?? "" })}
            </p>
          ) : k === "video" ? (
            <video
              ref={setVideo}
              src={fileUrl(file!)}
              controls={!zoom.zoomed}
              autoPlay
              loop
              playsInline
              onLoadedMetadata={(e) => setFacts({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight, length: e.currentTarget.duration })}
              onError={() => setFacts({ unplayable: true })}
              style={zoom.style}
              className="max-h-full max-w-full rounded-lg bg-[repeating-conic-gradient(#222_0_25%,#2c2c2c_0_50%)] bg-size-[24px_24px]"
            />
          ) : k === "other" ? (
            <pre className={cn("max-h-full w-full max-w-2xl overflow-auto rounded-lg bg-white/5 p-5 text-sm leading-relaxed whitespace-pre-wrap text-white/85", /\.json$/i.test(file!) && "font-mono text-[13px]")}>
              {text == null ? "…" : /\.json$/i.test(file!) ? <JsonView text={text} /> : text}
            </pre>
          ) : k === "audio" ? (
            <div className="flex w-full max-w-lg flex-col items-center gap-6">
              {cover ? <img src={fileUrl(outputPath(home, job, cover))} alt="" className="size-56 rounded-xl object-cover shadow-lg" /> : <AudioLinesIcon className="size-16 text-aud" aria-hidden />}
              <audio src={fileUrl(file!)} controls autoPlay onLoadedMetadata={(e) => setFacts({ length: e.currentTarget.duration })} className="w-full" />
            </div>
          ) : null}
          {zoom.zoomed && k === "video" && video && <Transport video={video} />}
        </div>
        {job.outputs.length > 1 && (
          <div className="flex justify-center gap-2 pb-4">
            {job.outputs.map((o, n) => (
              <button
                key={o}
                type="button"
                aria-label={t("Result {n}: {file}", { n: n + 1, file: o })}
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
          <Button variant="secondary" size="icon" aria-label={t("Previous")} onClick={prev} className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
            <ChevronLeftIcon />
          </Button>
        )}
        {next && (
          <Button variant="secondary" size="icon" aria-label={t("Next")} onClick={next} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
            <ChevronRightIcon />
          </Button>
        )}
      </div>

      <aside className="flex w-96 shrink-0 flex-col border-l">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">
          <div className="flex items-start gap-3 pr-8">
            <ModelLogo model={job.model} lab={lab} className="size-10 rounded-lg p-2" />
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold">{own(job.label)}</DialogTitle>
              <DialogDescription className="truncate" title={job.name}>
                {model} · {lab}
              </DialogDescription>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {when(job.created)}
                <button
                  type="button"
                  title={t("Copy this media's ID")}
                  aria-label={t("Copy the ID {id}", { id: job.id })}
                  onClick={() => navigator.clipboard.writeText(job.id).then(() => toast.success(t("ID copied"), { description: job.id }))}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground/80 transition-colors outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="truncate">{job.id}</span>
                  <CopyIcon className="size-3 shrink-0" aria-hidden />
                </button>
                {job.by === "agent" && <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">{t("by Agent")}</span>}
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
                <Label>{job.kind === "audio" && k === "audio" ? t("Text") : t("Prompt")}</Label>
                <Button variant="ghost" size="xs" className="-mt-2" onClick={() => navigator.clipboard.writeText(job.prompt).then(() => toast.success(t("Prompt copied")))}>
                  <CopyIcon data-icon="inline-start" /> {t("Copy")}
                </Button>
              </div>
              <p className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">{job.prompt}</p>
            </div>
          )}

          {shots && (
            <div>
              <Label>{t("Shots")}</Label>
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
              <Label>{t("Lines")}</Label>
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
              <Label>{t("Settings")}</Label>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {[
                  ...params.map(([key, v]) => [PARAMS[key]?.[0] ?? own(words(key)), PARAMS[key]?.[1](v) ?? String(v)]),
                  ...options.map(([key, v]) => [own(words(key)), optionText(v)]),
                  ...fields.map(([key, v]) => [own(words(key)), v]),
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
              <Label>{t("Inputs")}</Label>
              <div className="flex flex-wrap gap-2">
                {inputs.map(({ key, f }) => (
                  <a key={f} href={fileUrl(inputPath(home, job, f))} target="_blank" rel="noreferrer" className="flex w-16 flex-col gap-1" title={f}>
                    <span className="size-16 overflow-hidden rounded-md border">
                      <Thumb path={inputPath(home, job, f)} />
                    </span>
                    <span className="truncate text-center text-[11px] text-muted-foreground">{ROLES[key] ?? own(words(key))}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {actions.length > 0 && (
            <div>
              <Label>{t("Next")}</Label>
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
                          <span className="block truncate text-sm font-medium">{t("Add to workspace")}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {job.workspaces?.length ? t("In {names}", { names: ws.list.filter((w) => job.workspaces!.includes(w.slug)).map((w) => w.name).join(", ") }) : t("In no workspace")}
                          </span>
                        </span>
                        <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="left" align="start" className="min-w-56">
                      <DropdownMenuLabel>{t("Workspaces")}</DropdownMenuLabel>
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
                    <DownloadIcon data-icon="inline-start" /> {job.outputs.length > 1 ? t("Download {ext}", { ext: ext ?? "" }) : t("Download")}
                  </a>
                </Button>
                {job.outputs.length > 1 && (
                  <DropdownMenu onOpenChange={(o) => o && setBlockWidth(block.current?.offsetWidth)}>
                    <span className="h-5 w-px bg-primary-foreground/20" aria-hidden />
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" aria-label={t("More downloads")} className="w-9 rounded-none shadow-none">
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="end" sideOffset={6} collisionPadding={12} style={{ width: blockWidth }}>
                      <DropdownMenuItem asChild>
                        <a href={`/api/media/${job.id}/zip`} download>
                          <span className="flex flex-col">
                            <span>{t("Download all ({n})", { n: job.outputs.length })}</span>
                            <span className="text-xs text-muted-foreground">{t("Every file of this result in a .zip")}</span>
                          </span>
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
            <Button variant="outline" size="icon" aria-label={job.favorite ? t("Remove from favorites") : t("Add to favorites")} title={t("Favorite")} onClick={() => api.media(job.id, "favorite")}>
              <StarIcon className={cn(job.favorite && "fill-current text-cost")} />
            </Button>
            <Button variant="outline" size="icon" aria-label={t("Delete")} title={t("Delete")} onClick={() => setConfirm(true)}>
              <Trash2Icon />
            </Button>
          </div>
          {(prev || next) && (
            <p className="text-center text-xs text-muted-foreground">
              <Kbd>←</Kbd> <Kbd>→</Kbd> {t("to browse")} · <Kbd>Esc</Kbd> {t("to close")}
            </p>
          )}
        </div>
        <DeleteDialog job={job} open={confirm} onOpenChange={setConfirm} onDeleted={onClose} />
        <Dialog open={!!singer} onOpenChange={(o) => !o && setSinger(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogTitle>{t("Make a singer")}</DialogTitle>
            <DialogDescription>
              {voiceOnly
                ? t("Suno keeps this voice as a singer of the Library: the Singer field of Music, Extend, Cover, Mashup and Replace section takes it. Free.")
                : t("Suno keeps this song's voice and style as a singer of the Library: the Singer field of Music, Extend, Cover, Mashup and Replace section takes it. Free.")}
            </DialogDescription>
            {singer && (
              <div className="flex flex-col gap-3">
                <div>
                  <Label>{t("Name")}</Label>
                  <Input value={singer.name} placeholder="Nova" onChange={(e) => setSinger({ ...singer, name: e.target.value.replace(/[^\w-]/g, "") })} />
                </div>
                <div>
                  <Label>{t("Described")}</Label>
                  <Input value={singer.description} placeholder={t("a warm, breathy female pop voice")} onChange={(e) => setSinger({ ...singer, description: e.target.value })} />
                </div>
                <div>
                  <Label hint={t("10 to 30 s where it sings, found for you")}>{t("Sung from")}</Label>
                  <div className="flex items-center gap-2">
                    <Input className="w-24" inputMode="decimal" value={singer.start} placeholder="…" onChange={(e) => setSinger({ ...singer, start: e.target.value })} aria-label={t("From (s)")} />
                    <span className="text-sm text-muted-foreground">{t("to")}</span>
                    <Input className="w-24" inputMode="decimal" value={singer.end} placeholder="…" onChange={(e) => setSinger({ ...singer, end: e.target.value })} aria-label={t("To (s)")} />
                  </div>
                  {/* that part, to hear before keeping it */}
                  {singer.start && singer.end && <audio key={`${singer.start}-${singer.end}`} controls src={`${fileUrl(file!)}#t=${singer.start},${singer.end}`} className="mt-2 h-9 w-full" />}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setSinger(null)}>{t("Cancel")}</Button>
                  <Button
                    disabled={!singer.name || !singer.description || !singer.start || !singer.end}
                    onClick={() => (runExtra(extraSpec("singer", file!, singer), t("Make a singer")), setSinger(null))}
                  >
                    {t("Make it")}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={keeping != null} onOpenChange={(o) => !o && setKeeping(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogTitle>{t("Keep this voice")}</DialogTitle>
            <DialogDescription>{t("ElevenLabs keeps {name} as a voice of your account, and the Library as a voice: Voice, Change voice, Remix a voice and the voices of your characters take it. Free.", { name: name.replace(/\.mp3$/, "") })}</DialogDescription>
            {keeping != null && (
              <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), keeping && keep(keeping))}>
                <div>
                  <Label>{t("Name")}</Label>
                  <Input autoFocus value={keeping} placeholder="Claire" onChange={(e) => setKeeping(e.target.value.replace(/[^\w-]/g, ""))} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setKeeping(null)}>{t("Cancel")}</Button>
                  <Button type="submit" disabled={!keeping}>{t("Keep it")}</Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
        {file && <CompareDialog open={comparing} onOpenChange={setComparing} origin={job} file={file} jobs={jobs} home={home} per1000={per1000} />}
      </aside>
    </>
  )
}
