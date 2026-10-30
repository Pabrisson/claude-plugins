import { useMemo, useState } from "react"
import { CheckIcon, PaintbrushIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { fileUrl, mediaKind, opt, outputPath, type Field, type Job, type Kind, type SavedStyle } from "@/lib/api"
import { Chips, Label } from "@/components/chips"

type Preset = ReturnType<typeof opt> & { swatch?: string[] }

// a grain for the painted styles, drawn once
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0"/></filter><rect width="120" height="120" filter="url(#n)"/></svg>'
)}")`
// each group's texture over the style's palette: cel shadows, a lit sphere, stitches, paint grain, pixels
const TEXTURE: Record<string, string> = {
  "2D animation": "linear-gradient(115deg, transparent 58%, rgb(0 0 0 / .22) 58%), radial-gradient(circle at 70% 30%, rgb(255 255 255 / .35) 0 14%, transparent 15%)",
  "3D": "radial-gradient(circle at 38% 34%, rgb(255 255 255 / .6), transparent 26%), radial-gradient(circle at 50% 50%, transparent 30%, rgb(0 0 0 / .35) 75%)",
  Handmade: "repeating-linear-gradient(45deg, rgb(255 255 255 / .14) 0 3px, transparent 3px 7px), repeating-linear-gradient(-45deg, rgb(0 0 0 / .12) 0 3px, transparent 3px 7px)",
  "Painting & illustration": `${GRAIN}, linear-gradient(160deg, rgb(255 255 255 / .18), transparent 40%)`,
  "Pixel & retro": "linear-gradient(90deg, rgb(0 0 0 / .28) 1px, transparent 1px) 0 0 / 10px 10px, linear-gradient(rgb(0 0 0 / .28) 1px, transparent 1px) 0 0 / 10px 10px",
}
function Art({ preset }: { preset: Preset }) {
  const [a = "#666", b = "#999", c = "#333", d = b] = preset.swatch ?? []
  return (
    <span
      aria-hidden
      className="absolute inset-0"
      style={{ background: `${TEXTURE[preset.group ?? ""] ?? ""}${TEXTURE[preset.group ?? ""] ? ", " : ""}radial-gradient(circle at 85% 85%, ${d} 0 18%, transparent 19%), linear-gradient(135deg, ${a}, ${b} 50%, ${c})` }}
    />
  )
}

// a style's picture: the user's last result in it (a video plays under the pointer), else its painted card
function Thumb({ file, preset, className }: { file: string | null; preset?: Preset; className?: string }) {
  const k = file ? mediaKind(file) : null
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      {preset && k !== "image" && k !== "video" && <Art preset={preset} />}
      {k === "image" && <img src={fileUrl(file!)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
      {k === "video" && (
        <video
          src={fileUrl(file!)}
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
          onMouseEnter={(e) => !still && e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
        />
      )}
    </span>
  )
}

// the last result made in a style (Restyle or Custom), of this space first: a preset by its value or its label
function lastIn(value: string, label: string | undefined, kind: Kind, media: Job[], home: string) {
  const made = (j: Job) => j.status === "done" && j.outputs.length && (j.fields?.style === value || (!!label && j.fields?.style?.toLowerCase() === label.toLowerCase()))
  const j = media.find((x) => x.kind === kind && made(x)) ?? media.find(made)
  return j ? outputPath(home, j, j.outputs.find((o) => mediaKind(o) === "image" || mediaKind(o) === "video") ?? j.outputs[0]) : null
}

// the style a tool draws in, as a row: its picture and name, Change, and × when the tool can go without one (Custom)
export function StyleField({
  field: f,
  value,
  onChange,
  kind,
  styles,
  media,
  home,
}: {
  field: Field
  value?: string
  onChange: (v: string) => void
  kind: Kind
  styles: SavedStyle[]
  media: Job[]
  home: string
}) {
  const [open, setOpen] = useState(false)
  const v = value ?? (f.default != null ? String(f.default) : "")
  const presets = useMemo(() => (f.options ?? []).map((o) => opt(o) as Preset), [f.options])
  const preset = presets.find((p) => p.value === v), saved = styles.find((s) => s.name === v)
  const name = preset?.label ?? (saved ? saved.name : v)
  const file = saved ? saved.files[0] : v ? lastIn(v, preset?.label, kind, media, home) : null
  return (
    <div>
      <Label hint={f.default == null ? "optional" : undefined}>{f.label}</Label>
      <div className="flex items-center gap-3 rounded-xl border bg-card p-2 pr-2.5">
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Style: ${name || "none"}. Change it`}>
          {v ? (
            <Thumb file={file} preset={preset} className="size-11 shrink-0 rounded-lg border" />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed text-muted-foreground">
              <PaintbrushIcon className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-medium", !v && "text-muted-foreground")}>{name || "No style"}</span>
            <span className="block truncate text-xs text-muted-foreground">{saved ? "Your style" : preset ? preset.group : "The model's own look"}</span>
          </span>
        </button>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {v ? "Change" : "Choose"}
        </Button>
        {v && f.default == null && (
          <Button size="icon-sm" variant="ghost" aria-label="No style" onClick={() => onChange("")}>
            <XIcon />
          </Button>
        )}
      </div>
      <Gallery open={open} onClose={() => setOpen(false)} value={v} presets={presets} styles={styles} kind={kind} media={media} home={home} onPick={(x) => (onChange(x), setOpen(false))} />
    </div>
  )
}

// every style as a card: the presets by group, searchable, and the user's own from the Library
function Gallery({
  open,
  onClose,
  value,
  presets,
  styles,
  kind,
  media,
  home,
  onPick,
}: {
  open: boolean
  onClose: () => void
  value: string
  presets: Preset[]
  styles: SavedStyle[]
  kind: Kind
  media: Job[]
  home: string
  onPick: (v: string) => void
}) {
  const [tab, setTab] = useState<"presets" | "yours">(styles.some((s) => s.name === value) ? "yours" : "presets")
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const groups = [...new Set(presets.map((p) => p.group ?? ""))]
  const q = query.trim().toLowerCase()
  const shown = presets.filter((p) => (!group || p.group === group) && (!q || `${p.label} ${p.note ?? ""} ${p.group ?? ""}`.toLowerCase().includes(q)))
  const yours = styles.filter((s) => !q || `${s.name} ${s.words}`.toLowerCase().includes(q))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[min(860px,calc(100vh-2rem))] max-w-[min(1080px,calc(100%-2rem))] flex-col gap-4 sm:max-w-[min(1080px,calc(100%-2rem))]">
        <div>
          <DialogTitle>Pick a style</DialogTitle>
          <DialogDescription className="mt-1">A style is a look: medium, palette, line and texture, never what is in the picture. Your own are made in the Library, from your images.</DialogDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chips options={["presets", "yours"] as const} value={tab} label={(t) => (t === "presets" ? "Presets" : `Yours · ${styles.length}`)} onChange={setTab} />
          <span className="flex-1" />
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search styles" aria-label="Search styles" className="pl-8" />
          </div>
        </div>
        {tab === "presets" && (
          <Chips options={["", ...groups]} value={group ?? ""} label={(g) => g || "All"} onChange={(g) => setGroup(g || null)} className="[&>button]:px-2.5 [&>button]:py-0.5 [&>button]:text-xs" />
        )}
        <div className="-mx-1 min-h-0 flex-1 overflow-auto px-1 pb-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3" role="radiogroup" aria-label="Styles">
            {tab === "presets"
              ? shown.map((p) => <Card key={p.value} on={p.value === value} title={p.label} note={p.note} onPick={() => onPick(p.value)} thumb={<Thumb file={lastIn(p.value, p.label, kind, media, home)} preset={p} className="absolute inset-0" />} />)
              : yours.map((s) => <Card key={s.name} on={s.name === value} title={s.name} note={s.words || `${s.files.length} image${s.files.length > 1 ? "s" : ""}`} onPick={() => onPick(s.name)} thumb={<Thumb file={s.files[0]} className="absolute inset-0" />} />)}
            {tab === "yours" && (
              <button
                type="button"
                onClick={() => (window.location.hash = "library/styles")}
                className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors outline-none hover:border-space/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <PlusIcon className="size-5" />
                New style
                <span className="px-6 text-center text-xs">In the Library, from 1 to 5 images of the look</span>
              </button>
            )}
          </div>
          {tab === "presets" && !shown.length && <p className="py-8 text-center text-sm text-muted-foreground">No style matches.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Card({ on, title, note, thumb, onPick }: { on: boolean; title: string; note?: string; thumb: React.ReactNode; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "group/card relative aspect-video overflow-hidden rounded-xl border text-left transition-[box-shadow,border-color] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        on ? "border-space ring-2 ring-space" : "hover:border-foreground/30"
      )}
    >
      {thumb}
      <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/45 to-transparent px-3 pt-8 pb-2.5 text-white">
        <span className="block truncate text-[13px] font-semibold tracking-wide uppercase">{title}</span>
        {note && <span className="block truncate text-xs text-white/75">{note}</span>}
      </span>
      {on && (
        <span className="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-space text-space-foreground shadow">
          <CheckIcon className="size-3.5" />
        </span>
      )}
    </button>
  )
}
