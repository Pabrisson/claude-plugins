import { useRef, useState } from "react"
import { AudioLinesIcon, BrushIcon, CheckIcon, FolderOpenIcon, LoaderCircleIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, ScissorsIcon, StarIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, fileUrl, mediaKind, outputPath, plain, when, type Input, type Job, type Tool } from "@/lib/api"
import { Chips, Label } from "@/components/chips"
import { SketchDialog } from "@/components/sketch"
import { MaskDialog } from "@/components/mask"
import { CutDialog } from "@/components/cut"

const ACCEPT = { image: "image/*", sketch: "image/*", mask: "image/*", matte: "image/*", video: "video/*", audio: "audio/*", media: "audio/*,video/*" }
// an input drawn in the dashboard: a sketch (marks) or a mask (a painted area)
const drawn = (input: Input) => input.kind === "sketch" || input.kind === "mask"
const fits = (input: Input, file: string) => {
  const k = mediaKind(file)
  return input.kind === "media" ? k === "audio" || k === "video" : drawn(input) ? k === "image" : k === input.kind
}

export async function upload(file: File) {
  return (await api.upload(file, file.name)).path
}

// where a pasted or dropped file goes: the first of the tool's inputs that takes its kind and has room (an input of
// several up to what the model takes)
export function slotFor(tool: Tool, value: Record<string, string[]>, name: string, limits: Record<string, number> = {}) {
  const n = (i: Input) => value[i.key]?.length ?? 0
  return tool.inputs.find((i) => !drawn(i) && fits(i, name) && (i.multiple ? limits[i.key] == null || n(i) < limits[i.key] : !n(i)))
}

// a file as a small tile: its picture, its first frame, or a sound icon
export function Thumb({ path, className }: { path: string; className?: string }) {
  const k = mediaKind(path), name = path.split("/").pop()
  if (k === "image") return <img src={fileUrl(path)} alt={name} className={cn("size-full object-cover", className)} />
  if (k === "video") return <video src={fileUrl(path)} muted preload="metadata" className={cn("size-full object-cover", className)} />
  return (
    <div className={cn("flex size-full flex-col items-center justify-center gap-1 bg-muted p-1 text-center text-xs text-muted-foreground", className)}>
      <AudioLinesIcon className="size-5 text-aud" />
      <span className="line-clamp-2 break-all">{name}</span>
    </div>
  )
}

// the tool's inputs: drop or pick a file, take one from the library, draw a sketch
export function InputSlots({
  tool,
  value,
  onChange,
  home,
  media,
  label = true,
  limits = {},
  none,
  fields,
  onField,
}: {
  tool: Tool
  value: Record<string, string[]>
  onChange: (v: Record<string, string[]>) => void
  home: string
  media: Job[]
  label?: boolean
  // how many files an input of several may hold on the chosen model, and why none when so
  limits?: Record<string, number>
  none?: string
  // the tool's words, for the field a mask shows under its picture (Put there)
  fields?: Record<string, string>
  onField?: (key: string, v: string) => void
}) {
  const [sketch, setSketch] = useState<{ key: string; src: string; mask: boolean; video?: string } | null>(null)
  const [cut, setCut] = useState<{ key: string; path: string } | null>(null)
  const set = (key: string, files: string[]) => onChange({ ...value, [key]: files })

  // a video just sent (picked, dropped or pasted here or on the composer) opens Edit reference; the inputs it came
  // with (a draft, a pick from the library, a cut) do not
  const [seen, setSeen] = useState(() => new Set(Object.values(value).flat()))
  const fresh = Object.entries(value).flatMap(([key, files]) => files.filter((f) => !seen.has(f)).map((path) => ({ key, path })))
  if (fresh.length) {
    setSeen(new Set([...seen, ...fresh.map((f) => f.path)]))
    const sent = fresh.find((f) => mediaKind(f.path) === "video" && /\/\.cache\/uploads\//.test(f.path) && !f.path.endsWith("-cut.mp4"))
    if (sent) setCut(sent)
  }

  async function openSketch(key: string) {
    let base = value.image?.[0] ?? value.first_frame?.[0]
    const video = value.video?.[0] ?? value.clip?.[0]
    try {
      if (!base && video) base = (await api.frame(video)).path
    } catch (e) {
      return toast.error(plain((e as Error).message))
    }
    if (!base) return toast.error(`Add the ${tool.inputs.find((i) => !drawn(i))?.label.toLowerCase() ?? "image"} first, then draw on it`)
    const mask = tool.inputs.find((i) => i.key === key)?.kind === "mask"
    setSketch({ key, src: fileUrl(base), mask, video: mask && !value.image?.[0] && !value.first_frame?.[0] ? video : undefined })
  }

  // the mask being painted: the field it shows and whether it keeps a matte
  const painting = sketch?.mask ? tool.inputs.find((i) => i.key === sketch.key) : undefined
  const wordsField = painting?.field ? tool.fields.find((f) => f.key === painting.field) : undefined

  if (!tool.inputs.length) return null
  return (
    <div className="w-full">
      {label && <Label>Inputs</Label>}
      <div className="flex flex-wrap gap-2">
        {tool.inputs.filter((i) => i.kind !== "matte").map((input) => (
          <Slot
            key={input.key}
            input={input}
            files={value[input.key] ?? []}
            onFiles={(f) => set(input.key, f)}
            onDraw={() => openSketch(input.key)}
            onCut={(path) => setCut({ key: input.key, path })}
            limit={limits[input.key]}
            none={none}
            library={media.flatMap((j) => (j.status === "done" ? j.outputs.map((o) => ({ path: outputPath(home, j, o), job: j })) : [])).filter((x) => fits(input, x.path))}
          />
        ))}
      </div>
      <MaskDialog
        src={sketch?.mask ? sketch.src : null}
        video={sketch?.video}
        matte={!!painting?.matte}
        words={wordsField && fields && onField ? { label: wordsField.label, placeholder: wordsField.placeholder, value: fields[wordsField.key] ?? "", onChange: (v) => onField(wordsField.key, v) } : undefined}
        onClose={() => setSketch(null)}
        onSave={async (png, matte) => {
          const key = sketch!.key, keep = painting?.matte
          setSketch(null)
          const { path } = await api.upload(png, "mask.png")
          // the matte stays here: the engine lays the result back inside it, it is never sent
          const kept = matte && keep ? { [keep]: [(await api.upload(matte, "matte.png")).path] } : {}
          onChange({ ...value, [key]: [path], ...kept })
        }}
      />
      <SketchDialog
        open={!!sketch && !sketch.mask}
        src={sketch?.src ?? null}
        onClose={() => setSketch(null)}
        onSave={async (png) => {
          const key = sketch!.key
          setSketch(null)
          const { path } = await api.upload(png, "sketch.png")
          set(key, [path])
        }}
      />
      <CutDialog
        path={cut?.path ?? null}
        onClose={() => setCut(null)}
        onDone={(path) => {
          set(cut!.key, (value[cut!.key] ?? []).map((f) => (f === cut!.path ? path : f)))
          setCut(null)
        }}
      />
    </div>
  )
}

function Slot({
  input,
  files,
  onFiles,
  onDraw,
  onCut,
  library,
  limit,
  none = "Not on this model",
}: {
  input: Input
  files: string[]
  onFiles: (f: string[]) => void
  onDraw: () => void
  onCut: (path: string) => void
  library: Pick[]
  limit?: number
  none?: string
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const room = input.multiple ? limit == null || files.length < limit : files.length === 0
  // the files that still fit; those beyond the model's count are left out, said once
  const fit = <T,>(more: T[]) => {
    const left = limit == null ? more.length : Math.max(0, limit - files.length)
    if (more.length > left) toast.warning(`${more.length - left} left out`, { description: `The model takes ${limit} here: remove one to swap it.` })
    return more.slice(0, left)
  }

  async function add(list: FileList | File[]) {
    const take = input.multiple ? fit([...list]) : [...list].slice(0, 1)
    if (!take.length) return
    setBusy(true)
    try {
      const paths = await Promise.all(take.map(upload))
      onFiles(input.multiple ? [...files, ...paths] : paths)
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {files.map((f, i) => (
        <div key={f} className="flex w-18 flex-col gap-1">
          <div className="group relative size-18 overflow-hidden rounded-lg border">
            <Thumb path={f} />
            <button
              type="button"
              aria-label={`Remove ${input.label.toLowerCase()}`}
              onClick={() => onFiles(files.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
            {mediaKind(f) === "video" && (
              <button
                type="button"
                aria-label={`Cut or crop the ${input.label.toLowerCase()}`}
                title="Cut and crop"
                onClick={() => onCut(f)}
                className="absolute bottom-1 left-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <ScissorsIcon className="size-3" />
              </button>
            )}
          </div>
          <span className="line-clamp-2 text-center text-xs leading-tight" title={input.label}>{input.label}</span>
        </div>
      ))}
      {!room && input.multiple && limit != null && (
        <div className="flex w-18 flex-col gap-1">
          <div className="grid size-18 place-items-center rounded-lg border border-dashed p-1 text-center text-xs leading-tight text-muted-foreground" title={limit === 0 ? none : `The model takes ${limit} here`}>
            {limit === 0 && !files.length ? none : "Full"}
          </div>
          <span className="line-clamp-2 text-center text-xs leading-tight text-muted-foreground">{input.label}</span>
          {(files.length > 0 || limit > 0) && <Count files={files.length} limit={limit} />}
        </div>
      )}
      {room && (
        <div className="flex w-18 flex-col gap-1">
          <div
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setOver(false)
              if (e.dataTransfer.files.length) add(e.dataTransfer.files)
            }}
            className={cn(
              "relative size-18 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-space/60 hover:text-space",
              over && "border-space bg-space/10 text-space"
            )}
          >
            {drawn(input) ? (
              <button type="button" onClick={onDraw} className="grid size-full place-items-center rounded-lg" aria-label={input.label} title={input.kind === "mask" ? "Paint the area on the image" : "Draw on the image"}>
                {input.kind === "mask" ? <BrushIcon className="size-5" /> : <PencilIcon className="size-5" />}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => picker.current?.click()} className="grid size-full place-items-center rounded-lg" aria-label={`Add ${input.label.toLowerCase()}`} title="Pick a file, drop one here, or paste it">
                {busy ? <LoaderCircleIcon className="size-5 animate-spin" /> : <PlusIcon className="size-5" />}
              </button>
            )}
            {!drawn(input) && library.length > 0 && (
              <LibraryPicker input={input} items={library} picked={files} onPick={(f) => onFiles(input.multiple ? (files.includes(f) ? files.filter((x) => x !== f) : [...files, ...fit([f])]) : [f])} />
            )}
            <input ref={picker} type="file" hidden multiple={input.multiple} accept={ACCEPT[input.kind]} onChange={(e) => e.target.files && add(e.target.files)} />
          </div>
          <span className={cn("line-clamp-2 text-center text-xs leading-tight", input.optional ? "text-muted-foreground" : "text-foreground")} title={input.label}>
            {input.label}
          </span>
          {input.multiple && limit != null ? <Count files={files.length} limit={limit} /> : input.optional && <span className="text-center text-xs text-muted-foreground/70">optional</span>}
        </div>
      )}
    </>
  )
}

export type Pick = { path: string; job: Job }

// how many files an input of several holds, of what the model takes here: red when it holds too many
function Count({ files, limit }: { files: number; limit: number }) {
  return <span className={cn("text-center text-xs tabular-nums", files > limit ? "font-medium text-destructive" : "text-muted-foreground/70")}>{files} / {limit}</span>
}

// a voice in the list: its own play button
// a sound to listen to: a file of the folder, or a URL (an ElevenLabs voice's preview)
export function Listen({ path, src }: { path: string; src?: string }) {
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  return (
    <>
      <audio ref={audio} src={src ?? fileUrl(path)} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button
        type="button"
        aria-label={playing ? "Pause" : "Listen"}
        onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-aud text-background transition-transform hover:scale-105"
      >
        {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5 translate-x-px" />}
      </button>
    </>
  )
}

// the results an input can take, newest first: pictures and clips as tiles, voices as rows to listen to; the ones in
// the input are checked, a click adds or removes one (replaces it for a single file)
function LibraryPicker({ input, items, picked, onPick }: { input: Input; items: Pick[]; picked: string[]; onPick: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const pick = (path: string) => {
    onPick(path)
    if (!input.multiple) setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${input.label} from the library`} title="From the library" className="absolute right-1 bottom-1 grid size-6 place-items-center rounded-md bg-muted text-muted-foreground hover:text-foreground">
          <FolderOpenIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(460px,calc(100vw-2rem))] gap-0 p-0">
        <LibraryList title={`${input.label} from the library`} items={items} picked={picked} onPick={pick} multiple={input.multiple} />
      </PopoverContent>
    </Popover>
  )
}

// the library's results in a picker: how many, all or the favorites, the grid to pick from
export function LibraryList({ title, items, picked, onPick, multiple }: { title: string; items: Pick[]; picked: string[]; onPick: (path: string) => void; multiple?: boolean }) {
  const [show, setShow] = useState<"all" | "favorites">("all")
  const list = items.filter((i) => show === "all" || i.job.favorite)
  return (
    <>
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">
            {items.length} result{items.length > 1 ? "s" : ""}, newest first{multiple ? " · pick several" : ""}
          </span>
        </span>
        {items.some((i) => i.job.favorite) && (
          <Chips options={["all", "favorites"] as const} value={show} onChange={setShow} label={(o) => (o === "all" ? "All" : "Favorites")} className="[&>button]:px-2.5 [&>button]:py-0.5 [&>button]:text-xs" />
        )}
      </div>
      <PickList items={list} picked={picked} onPick={onPick} empty={items.length ? "No favorite here yet." : "Nothing in the library yet."} className="max-h-[min(380px,55vh)] p-3" />
    </>
  )
}

// results as a grid to pick from, newest first: pictures and clips as tiles, voices as rows to listen to; the ones
// picked are checked
export function PickList({ items, picked, onPick, empty, className }: { items: Pick[]; picked: string[]; onPick: (path: string) => void; empty: string; className?: string }) {
  const tiles = items.filter((i) => mediaKind(i.path) !== "audio"), voices = items.filter((i) => mediaKind(i.path) === "audio")
  return (
    <div className={cn("flex flex-col gap-3 overflow-auto", className)}>
      {!items.length && <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>}
      {tiles.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {tiles.map((i) => {
            const on = picked.includes(i.path)
            return (
              <button
                key={i.path}
                type="button"
                aria-pressed={on}
                aria-label={`${i.job.label}, ${when(i.job.created)}`}
                title={`${i.job.label} · ${when(i.job.created)}`}
                onClick={() => onPick(i.path)}
                className={cn("group/tile relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5 transition outline-none hover:ring-2 hover:ring-space/60 focus-visible:ring-2 focus-visible:ring-ring", on && "ring-2 ring-space")}
              >
                <Thumb path={i.path} />
                {mediaKind(i.path) === "video" && <PlayIcon className="absolute bottom-1.5 left-1.5 size-3.5 text-white drop-shadow" />}
                {i.job.favorite && <StarIcon className="absolute top-1.5 left-1.5 size-3.5 fill-current text-cost drop-shadow" />}
                <span className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/75 to-transparent px-1.5 pt-5 pb-1 text-left text-xs text-white opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100">
                  {i.job.label}
                </span>
                {on && <CheckIcon className="absolute top-1.5 right-1.5 size-5 rounded-full bg-space p-0.5 text-space-foreground" />}
              </button>
            )
          })}
        </div>
      )}
      {voices.map((i) => {
        const on = picked.includes(i.path)
        return (
          <div key={i.path} className={cn("flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition-colors hover:bg-muted/60", on && "border-space/60 bg-space/10")}>
            <Listen path={i.path} />
            <button type="button" aria-pressed={on} onClick={() => onPick(i.path)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm">{i.job.prompt || i.job.label}</span>
              <span className="block text-xs text-muted-foreground">
                {i.job.label} · {when(i.job.created)}
              </span>
            </button>
            {on && <CheckIcon className="size-4 shrink-0 text-space" />}
          </div>
        )
      })}
    </div>
  )
}
