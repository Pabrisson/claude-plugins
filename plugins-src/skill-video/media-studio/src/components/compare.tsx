import { useEffect, useRef, useState } from "react"
import { ArrowLeftRightIcon, AudioLinesIcon, FolderOpenIcon, PauseIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Slider } from "@/components/ui/slider"
import { fileUrl, inputPath, mediaKind, outputPath, plain, type Job } from "@/lib/api"
import { Chips } from "@/components/chips"
import { Listen, Thumb, upload } from "@/components/inputs"
import { costOf } from "@/components/results"

type Side = "a" | "b"
// a file on one side: what it is, made with what, for how much
type Item = { path: string; title: string; detail: string; cost?: string; text?: string }

const SIDES: Side[] = ["a", "b"]
const secs = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`

// two files of one medium, A against B: B is the user's pick, the result's input or the result before it suggested
export function CompareDialog({
  open,
  onOpenChange,
  origin,
  file,
  jobs,
  home,
  per1000,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  origin: Job
  file: string
  jobs: Job[]
  home: string
  per1000: number | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body origin={origin} file={file} jobs={jobs} home={home} per1000={per1000} />}
    </Dialog>
  )
}

function Body({ origin, file, jobs, home, per1000 }: { origin: Job; file: string; jobs: Job[]; home: string; per1000: number | null }) {
  const kind = mediaKind(file)
  const timed = kind !== "image"
  const inputs = Object.entries(origin.inputs ?? {})
    .flatMap(([key, files]) => files.map((f) => ({ key, path: inputPath(home, origin, f), title: "Input", detail: `${key.replaceAll("_", " ")} of ${origin.label}` })))
    .filter((i) => mediaKind(i.path) === kind)
  const results: Item[] = jobs
    .filter((j) => j.status === "done")
    .flatMap((j) => j.outputs.map((o) => ({ path: outputPath(home, j, o), title: j.label, detail: `${j.name}${j.by === "claude" ? " · by Claude" : ""}`, cost: costOf(j, per1000), text: j.prompt })))
    .filter((r) => mediaKind(r.path) === kind)
  const at = results.findIndex((r) => r.path === file)
  const suggested = inputs.find((i) => i.key !== "sketch" && i.key !== "mask")?.path ?? results.find((r, n) => n > at && r.path !== file)?.path ?? results.find((r) => r.path !== file)?.path

  const [sides, setSides] = useState<Record<Side, Item | null>>({ a: results[at] ?? { path: file, title: origin.label, detail: origin.name }, b: null })
  const [picking, setPicking] = useState<Side | null>("b")
  const [mode, setMode] = useState<"slider" | "side">("slider")
  const [split, setSplit] = useState(50)
  const [sound, setSound] = useState<Side>("a")
  const [dims, setDims] = useState<Record<Side, string>>({ a: "", b: "" })
  const overlay = kind !== "audio" && mode === "slider" && !picking && !!sides.b

  // the clips play as one: the longer leads, the other follows it and waits on its last frame when shorter
  const el = useRef<Record<Side, HTMLMediaElement | null>>({ a: null, b: null })
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const { a, b } = el.current
      const [m, f] = !a || !b ? [a ?? b, null] : a.duration >= b.duration ? [a, b] : [b, a]
      if (m) {
        if (m.ended) {
          m.currentTime = 0
          m.play().catch(() => {})
        }
        if (f && m.currentTime < f.duration) {
          if (Math.abs(f.currentTime - m.currentTime) > 0.15) f.currentTime = m.currentTime
          if (f.paused) f.play().catch(() => {})
        } else if (f && !f.paused) {
          f.pause()
          f.currentTime = f.duration
        }
        setT(m.currentTime)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
  const play = (on: boolean) => {
    for (const m of Object.values(el.current)) {
      if (m && on) m.play().catch(() => {})
      else m?.pause()
    }
    setPlaying(on)
  }
  const seek = (v: number) => {
    for (const m of Object.values(el.current)) if (m) m.currentTime = Math.min(v, m.duration || v)
    setT(v)
  }
  const pick = (s: Side, item: Item) => {
    play(false)
    seek(0)
    setSides((x) => ({ ...x, [s]: item }))
    setPicking(null)
  }
  const swap = () => {
    play(false)
    setT(0)
    setSides((x) => ({ a: x.b, b: x.a }))
    setDims((d) => ({ a: d.b, b: d.a }))
    setSound((s) => (s === "a" ? "b" : "a"))
  }

  const media = (s: Side) => {
    const it = sides[s]!
    const loaded = (e: React.SyntheticEvent<HTMLMediaElement>) => {
      const m = e.currentTarget, size = m instanceof HTMLVideoElement ? `${m.videoWidth}×${m.videoHeight} · ` : ""
      setDims((d) => ({ ...d, [s]: `${size}${secs(m.duration)}` }))
      setDur(Math.max(el.current.a?.duration || 0, el.current.b?.duration || 0))
    }
    const ref = (m: HTMLMediaElement | null) => {
      el.current[s] = m
    }
    if (kind === "image")
      return <img src={fileUrl(it.path)} alt={it.title} draggable={false} onLoad={(e) => {
            const size = `${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`
            setDims((d) => ({ ...d, [s]: size }))
          }} className="size-full object-contain" />
    if (kind === "video") return <video ref={ref} src={fileUrl(it.path)} muted={sound !== s} playsInline preload="auto" onLoadedMetadata={loaded} className="size-full object-contain" />
    return (
      <>
        <audio ref={ref} src={fileUrl(it.path)} muted={sound !== s} preload="auto" onLoadedMetadata={loaded} />
        <button
          type="button"
          aria-pressed={sound === s}
          onClick={() => setSound(s)}
          className={cn("flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl px-6 py-14 text-center text-white/90 ring-1 ring-white/10 transition-colors", sound === s ? "bg-aud/15 ring-2 ring-aud" : "hover:bg-white/5")}
        >
          <AudioLinesIcon className={cn("size-12", sound === s ? "text-aud" : "text-white/40")} aria-hidden />
          <p className="line-clamp-5 text-[15px] leading-snug">{it.text ? `“${it.text}”` : it.path.split("/").pop()}</p>
          <span className="text-xs text-white/60">{sound === s ? "You hear this one" : `Click or press ${s.toUpperCase()} to hear this one`}</span>
        </button>
      </>
    )
  }

  // the slider: B shows right of the line, A left of it; drag anywhere, or ← → once focused
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!overlay || (e.type === "pointermove" && !e.buttons)) return
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId)
    const r = e.currentTarget.getBoundingClientRect()
    setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)))
  }

  return (
    <DialogContent
      className="flex h-[min(900px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1440px,calc(100vw-2rem))]"
      onKeyDown={(e) => {
        // the viewer behind walks its list on ← →: not from here
        e.stopPropagation()
        const target = e.target as HTMLElement
        if (!timed || target.closest("input, textarea, [role=slider]")) return
        if (e.key === " " && !target.closest("button")) {
          e.preventDefault()
          play(!playing)
        }
        if (e.key === "a" || e.key === "b") setSound(e.key)
      }}
    >
      <div className="flex items-center gap-3 border-b py-2.5 pr-14 pl-5">
        <DialogTitle className="text-base font-semibold">Compare</DialogTitle>
        <DialogDescription className="sr-only">Two {kind === "audio" ? "sounds" : `${kind}s`}, A against B.</DialogDescription>
        <span className="flex-1" />
        {kind !== "audio" && <Chips options={["slider", "side"] as const} value={mode} label={(m) => (m === "slider" ? "Slider" : "Side by side")} onChange={setMode} />}
        <Button variant="outline" size="sm" disabled={!sides.b || !!picking} onClick={swap}>
          <ArrowLeftRightIcon data-icon="inline-start" /> Swap
        </Button>
      </div>

      <div className={cn("relative flex min-h-0 flex-1 bg-black", overlay && "cursor-ew-resize touch-none select-none")} onPointerDown={drag} onPointerMove={drag}>
        {SIDES.map((s) => (
          <div
            key={s}
            className={cn("flex min-w-0 flex-1 items-center justify-center p-4", overlay ? "absolute inset-0" : "relative", !overlay && s === "b" && "border-l border-white/10")}
            style={overlay && s === "b" ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}
          >
            {picking === s || !sides[s] ? (
              <Picker
                side={s}
                kind={kind}
                inputs={inputs}
                results={results}
                other={sides[s === "a" ? "b" : "a"]?.path}
                current={sides[s]?.path}
                suggested={s === "b" ? suggested : undefined}
                onPick={(item) => pick(s, item)}
                onCancel={sides[s] ? () => setPicking(null) : undefined}
              />
            ) : (
              <>
                {media(s)}
                {!overlay && <Letter side={s} />}
              </>
            )}
          </div>
        ))}
        {overlay && (
          <>
            <Letter side="a" />
            <Letter side="b" />
            <div
              role="slider"
              tabIndex={0}
              aria-label="A and B split"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
                e.preventDefault()
                setSplit((x) => Math.min(100, Math.max(0, x + (e.key === "ArrowLeft" ? -5 : 5))))
              }}
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(0,0,0,0.6)] outline-none focus-visible:ring-3 focus-visible:ring-ring/70"
              style={{ left: `${split}%` }}
            >
              <span className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-lg">
                <ArrowLeftRightIcon className="size-4" />
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t px-5 py-3">
        {timed && sides.a && sides.b && !picking && (
          <div className="flex items-center gap-3">
            <Button size="icon" variant="secondary" aria-label={playing ? "Pause" : "Play"} onClick={() => play(!playing)}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <span className="w-24 text-xs text-muted-foreground tabular-nums">
              {secs(t)} / {secs(dur)}
            </span>
            <Slider value={[t]} max={dur || 1} step={0.01} onValueChange={([v]) => seek(v)} aria-label="Position" className="flex-1" />
            <span className="text-xs text-muted-foreground">Sound</span>
            <Chips options={SIDES} value={sound} label={(s) => s.toUpperCase()} onChange={setSound} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-5">
          {SIDES.map((s) => {
            const it = sides[s]
            return (
              <div key={s} className="flex min-w-0 items-center gap-2 text-sm">
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold">{s.toUpperCase()}</span>
                {it ? (
                  <>
                    <span className="min-w-0 flex-1 truncate" title={`${it.title} · ${it.detail}`}>
                      <span className="font-medium">{it.title}</span> <span className="text-muted-foreground">· {it.detail}</span>
                    </span>
                    {it.cost && <span className="font-semibold whitespace-nowrap text-cost tabular-nums">{it.cost}</span>}
                    {dims[s] && <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{dims[s]}</span>}
                    {picking !== s && (
                      <Button variant="ghost" size="xs" onClick={() => (play(false), setPicking(s))}>
                        Change
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Choose B</span>
                )}
              </div>
            )
          })}
        </div>
        {timed && sides.b && !picking && (
          <p className="text-center text-xs text-muted-foreground">
            <Kbd>Space</Kbd> play or pause · <Kbd>A</Kbd> <Kbd>B</Kbd> the sound you hear, at the same moment
          </p>
        )}
      </div>
    </DialogContent>
  )
}

function Letter({ side }: { side: Side }) {
  return <span className={cn("pointer-events-none absolute top-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white", side === "a" ? "left-3" : "right-3")}>{side.toUpperCase()}</span>
}

// what a side can show: the result's inputs, the results of the same medium (newest first), a file from the computer
function Picker({
  side,
  kind,
  inputs,
  results,
  other,
  current,
  suggested,
  onPick,
  onCancel,
}: {
  side: Side
  kind: string
  inputs: Item[]
  results: Item[]
  other?: string
  current?: string
  suggested?: string
  onPick: (item: Item) => void
  onCancel?: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const groups = [
    { label: "Inputs of this result", items: inputs.filter((i) => i.path !== other) },
    { label: "Results", items: results.filter((i) => i.path !== other) },
  ].filter((g) => g.items.length)
  const noun = kind === "audio" ? "sound" : kind

  return (
    <div className="flex size-full max-w-3xl flex-col overflow-hidden rounded-xl bg-background text-foreground">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Choose {side.toUpperCase()}</span>
          <span className="block text-xs text-muted-foreground">Any {noun} to set against {side === "a" ? "B" : "A"}</span>
        </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => file.current?.click()}>
          <FolderOpenIcon data-icon="inline-start" /> {busy ? "Sending…" : "From your computer…"}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <input
          ref={file}
          type="file"
          hidden
          accept={`${kind}/*`}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (!f) return
            if (mediaKind(f.name) !== kind) return toast.error(`${f.name} is not ${kind === "image" ? "an image" : `a ${noun}`}`)
            setBusy(true)
            try {
              onPick({ path: await upload(f), title: f.name, detail: "from your computer" })
            } catch (err) {
              toast.error(plain((err as Error).message))
            } finally {
              setBusy(false)
            }
          }}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4">
        {!groups.length && <p className="py-10 text-center text-sm text-muted-foreground">No other {noun} here yet: take one from your computer.</p>}
        {groups.map((g) => (
          <section key={g.label} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{g.label}</h3>
            {kind === "audio" ? (
              g.items.map((i) => (
                <div key={i.path} className={cn("flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition-colors hover:bg-muted/60", (i.path === current || i.path === suggested) && "border-space/60 bg-space/10")}>
                  <Listen path={i.path} />
                  <button type="button" onClick={() => onPick(i)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm">{i.text || i.detail}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {i.title} · {i.detail}
                      {i.cost && <span className="text-cost"> · {i.cost}</span>}
                    </span>
                  </button>
                  {i.path === suggested && <Tag>Suggested</Tag>}
                </div>
              ))
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {g.items.map((i) => (
                  <button key={i.path} type="button" onClick={() => onPick(i)} title={`${i.title} · ${i.detail}`} className="group/tile flex min-w-0 flex-col gap-1 text-left outline-none">
                    <span
                      className={cn(
                        "relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5 transition group-hover/tile:ring-2 group-hover/tile:ring-space/60 group-focus-visible/tile:ring-2 group-focus-visible/tile:ring-ring",
                        (i.path === current || i.path === suggested) && "ring-2 ring-space"
                      )}
                    >
                      <Thumb path={i.path} />
                      {kind === "video" && <PlayIcon className="absolute bottom-1.5 left-1.5 size-3.5 text-white drop-shadow" />}
                      {i.path === suggested && <Tag className="absolute top-1.5 left-1.5">Suggested</Tag>}
                    </span>
                    <span className="truncate text-xs">
                      <span className="font-medium">{i.title}</span> <span className="text-muted-foreground">· {i.detail}</span>
                    </span>
                    {i.cost && <span className="text-xs font-semibold text-cost tabular-nums">{i.cost}</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("shrink-0 rounded-md bg-space px-1.5 py-0.5 text-xs font-semibold text-space-foreground", className)}>{children}</span>
}
