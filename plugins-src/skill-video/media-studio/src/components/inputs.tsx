import { useRef, useState } from "react"
import { AudioLinesIcon, CheckIcon, FolderOpenIcon, LoaderCircleIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, ScissorsIcon, StarIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, fileUrl, mediaKind, outputPath, plain, when, type Input, type Job, type Tool } from "@/lib/api"
import { Chips, Label } from "@/components/chips"
import { SketchDialog } from "@/components/sketch"
import { CutDialog } from "@/components/cut"

const ACCEPT = { image: "image/*", sketch: "image/*", video: "video/*", audio: "audio/*", media: "audio/*,video/*" }
const fits = (input: Input, file: string) => {
  const k = mediaKind(file)
  return input.kind === "media" ? k === "audio" || k === "video" : input.kind === "sketch" ? k === "image" : k === input.kind
}

export async function upload(file: File) {
  return (await api.upload(file, file.name)).path
}

// where a pasted or dropped file goes: the first of the tool's inputs that takes its kind and has room
export function slotFor(tool: Tool, value: Record<string, string[]>, name: string) {
  return tool.inputs.find((i) => i.kind !== "sketch" && fits(i, name) && (i.multiple || !value[i.key]?.length))
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
}: {
  tool: Tool
  value: Record<string, string[]>
  onChange: (v: Record<string, string[]>) => void
  home: string
  media: Job[]
  label?: boolean
}) {
  const [sketch, setSketch] = useState<{ key: string; src: string } | null>(null)
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
    if (!base) return toast.error(`Add the ${tool.inputs.find((i) => i.kind !== "sketch")?.label.toLowerCase() ?? "image"} first, then draw on it`)
    setSketch({ key, src: fileUrl(base) })
  }

  if (!tool.inputs.length) return null
  return (
    <div className="w-full">
      {label && <Label>Inputs</Label>}
      <div className="flex flex-wrap gap-2">
        {tool.inputs.map((input) => (
          <Slot
            key={input.key}
            input={input}
            files={value[input.key] ?? []}
            onFiles={(f) => set(input.key, f)}
            onDraw={() => openSketch(input.key)}
            onCut={(path) => setCut({ key: input.key, path })}
            library={media.flatMap((j) => (j.status === "done" ? j.outputs.map((o) => ({ path: outputPath(home, j, o), job: j })) : [])).filter((x) => fits(input, x.path))}
          />
        ))}
      </div>
      <SketchDialog
        open={!!sketch}
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
}: {
  input: Input
  files: string[]
  onFiles: (f: string[]) => void
  onDraw: () => void
  onCut: (path: string) => void
  library: Pick[]
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const room = input.multiple ? true : files.length === 0

  async function add(list: FileList | File[]) {
    setBusy(true)
    try {
      const paths = await Promise.all([...list].map(upload))
      onFiles(input.multiple ? [...files, ...paths] : paths.slice(0, 1))
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
            {input.kind === "sketch" ? (
              <button type="button" onClick={onDraw} className="grid size-full place-items-center rounded-lg" aria-label={`Draw ${input.label.toLowerCase()}`} title="Draw on the image">
                <PencilIcon className="size-5" />
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => picker.current?.click()} className="grid size-full place-items-center rounded-lg" aria-label={`Add ${input.label.toLowerCase()}`} title="Pick a file, drop one here, or paste it">
                {busy ? <LoaderCircleIcon className="size-5 animate-spin" /> : <PlusIcon className="size-5" />}
              </button>
            )}
            {input.kind !== "sketch" && library.length > 0 && (
              <LibraryPicker input={input} items={library} picked={files} onPick={(f) => onFiles(input.multiple ? (files.includes(f) ? files.filter((x) => x !== f) : [...files, f]) : [f])} />
            )}
            <input ref={picker} type="file" hidden multiple={input.multiple} accept={ACCEPT[input.kind]} onChange={(e) => e.target.files && add(e.target.files)} />
          </div>
          <span className={cn("line-clamp-2 text-center text-xs leading-tight", input.optional ? "text-muted-foreground" : "text-foreground")} title={input.label}>
            {input.label}
          </span>
          {input.optional && <span className="text-center text-xs text-muted-foreground/70">optional</span>}
        </div>
      )}
    </>
  )
}

type Pick = { path: string; job: Job }

// a voice in the list: its own play button
function Listen({ path }: { path: string }) {
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  return (
    <>
      <audio ref={audio} src={fileUrl(path)} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
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
  const [show, setShow] = useState<"all" | "favorites">("all")
  const list = items.filter((i) => show === "all" || i.job.favorite)
  const tiles = list.filter((i) => mediaKind(i.path) !== "audio"), voices = list.filter((i) => mediaKind(i.path) === "audio")
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
        <div className="flex items-center gap-3 border-b px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{input.label} from the library</span>
            <span className="block text-xs text-muted-foreground">
              {items.length} result{items.length > 1 ? "s" : ""}, newest first{input.multiple ? " · pick several" : ""}
            </span>
          </span>
          {items.some((i) => i.job.favorite) && (
            <Chips options={["all", "favorites"] as const} value={show} onChange={setShow} label={(o) => (o === "all" ? "All" : "Favorites")} className="[&>button]:px-2.5 [&>button]:py-0.5 [&>button]:text-xs" />
          )}
        </div>
        <div className="flex max-h-[min(380px,55vh)] flex-col gap-3 overflow-auto p-3">
          {!list.length && <p className="py-6 text-center text-sm text-muted-foreground">No favorite here yet.</p>}
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
                    onClick={() => pick(i.path)}
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
                <button type="button" aria-pressed={on} onClick={() => pick(i.path)} className="min-w-0 flex-1 text-left">
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
      </PopoverContent>
    </Popover>
  )
}
