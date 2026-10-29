import { useRef, useState } from "react"
import { AudioLinesIcon, FolderOpenIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, fileUrl, mediaKind, outputPath, plain, type Input, type Job, type Tool } from "@/lib/api"
import { Label } from "@/components/chips"
import { SketchDialog } from "@/components/sketch"

const ACCEPT = { image: "image/*", sketch: "image/*", video: "video/*", audio: "audio/*", media: "audio/*,video/*" }
const fits = (input: Input, file: string) => {
  const k = mediaKind(file)
  return input.kind === "media" ? k === "audio" || k === "video" : input.kind === "sketch" ? k === "image" : k === input.kind
}

export async function upload(file: File) {
  return (await api.upload(file, file.name)).path
}

// a file as a small tile: its picture, its first frame, or a sound icon
export function Thumb({ path, className }: { path: string; className?: string }) {
  const k = mediaKind(path), name = path.split("/").pop()
  if (k === "image") return <img src={fileUrl(path)} alt={name} className={cn("size-full object-cover", className)} />
  if (k === "video") return <video src={fileUrl(path)} muted preload="metadata" className={cn("size-full object-cover", className)} />
  return (
    <div className={cn("flex size-full flex-col items-center justify-center gap-1 bg-muted p-1 text-center text-[11px] text-muted-foreground", className)}>
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
}: {
  tool: Tool
  value: Record<string, string[]>
  onChange: (v: Record<string, string[]>) => void
  home: string
  media: Job[]
}) {
  const [sketch, setSketch] = useState<{ key: string; src: string } | null>(null)
  const set = (key: string, files: string[]) => onChange({ ...value, [key]: files })

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
    <div>
      <Label>Inputs</Label>
      <div className="grid grid-cols-3 gap-2">
        {tool.inputs.map((input) => (
          <Slot
            key={input.key}
            input={input}
            files={value[input.key] ?? []}
            onFiles={(f) => set(input.key, f)}
            onDraw={() => openSketch(input.key)}
            library={media.flatMap((j) => (j.status === "done" ? j.outputs.map((o) => outputPath(home, j, o)) : [])).filter((f) => fits(input, f))}
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
    </div>
  )
}

function Slot({
  input,
  files,
  onFiles,
  onDraw,
  library,
}: {
  input: Input
  files: string[]
  onFiles: (f: string[]) => void
  onDraw: () => void
  library: string[]
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
          <div key={f} className="group relative aspect-square overflow-hidden rounded-lg border">
            <Thumb path={f} />
            <span className="absolute bottom-1 left-1.5 max-w-[85%] truncate text-[11px] text-white [text-shadow:0_1px_2px_#000]">{input.label}</span>
            <button
              type="button"
              aria-label={`Remove ${input.label.toLowerCase()}`}
              onClick={() => onFiles(files.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ))}
        {room && (
          <div
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              if (e.dataTransfer.files.length) add(e.dataTransfer.files)
            }}
            className={cn(
              "flex aspect-square flex-col items-stretch justify-center gap-1 rounded-lg border border-dashed p-1.5 text-[11px] text-muted-foreground",
              over && "border-foreground bg-muted"
            )}
          >
            {input.kind === "sketch" ? (
              <button type="button" onClick={onDraw} className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-center hover:bg-muted">
                <PencilIcon className="size-4" />
                <span className="leading-tight text-foreground">{input.label}</span>
                {input.optional && <span>optional</span>}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => picker.current?.click()} className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-center hover:bg-muted" aria-label={`Add ${input.label.toLowerCase()}`}>
                <PlusIcon className="size-4" />
                <span className="leading-tight text-foreground">{busy ? "Uploading…" : input.label}</span>
                {input.optional && !busy && <span>optional</span>}
              </button>
            )}
            {input.kind !== "sketch" && library.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="flex items-center justify-center gap-1 rounded-md py-0.5 hover:bg-muted">
                    <FolderOpenIcon className="size-3.5" /> Library
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <div className="mb-2 text-xs text-muted-foreground">Pick a result</div>
                  <div className="grid max-h-72 grid-cols-3 gap-2 overflow-auto">
                    {library.slice(0, 60).map((f) => (
                      <button key={f} type="button" onClick={() => onFiles(input.multiple ? [...files, f] : [f])} className="aspect-square overflow-hidden rounded-md border hover:ring-2 hover:ring-ring">
                        <Thumb path={f} />
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <input ref={picker} type="file" hidden multiple={input.multiple} accept={ACCEPT[input.kind]} onChange={(e) => e.target.files && add(e.target.files)} />
          </div>
        )}
    </>
  )
}
