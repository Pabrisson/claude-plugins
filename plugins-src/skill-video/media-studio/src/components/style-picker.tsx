import { useMemo, useState } from "react"
import {
  BookOpenIcon,
  BoxIcon,
  BrushIcon,
  CameraIcon,
  CheckIcon,
  ClapperboardIcon,
  Disc3Icon,
  DramaIcon,
  FeatherIcon,
  FilmIcon,
  Gamepad2Icon,
  GuitarIcon,
  HandIcon,
  KeyboardMusicIcon,
  LayoutGridIcon,
  MicIcon,
  MicVocalIcon,
  MonitorPlayIcon,
  MusicIcon,
  PaintbrushIcon,
  PenToolIcon,
  PianoIcon,
  PlusIcon,
  SearchIcon,
  SkullIcon,
  ShapesIcon,
  SparklesIcon,
  SpeechIcon,
  UserIcon,
  Volume2Icon,
  WandSparklesIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { fileUrl, mediaKind, opt, outputPath, type Field, type Job, type Kind, type SavedStyle, type SoundFamily } from "@/lib/api"
import { Chips, Label } from "@/components/chips"
import { Listen } from "@/components/inputs"

export type Preset = ReturnType<typeof opt> & { swatch?: string[]; for?: SoundFamily }

// the sound styles' families: what they are for, their icon, the palette of one's own style's card
export const FAMILIES: Record<SoundFamily, { label: string; icon: LucideIcon; swatch: string[] }> = {
  music: { label: "Music", icon: MusicIcon, swatch: ["#7b2cbf", "#ff5d8f", "#1b1b3a", "#ffd166"] },
  voice: { label: "Voice", icon: SpeechIcon, swatch: ["#2a9d8f", "#264653", "#1d3557", "#e9c46a"] },
  sound: { label: "Sound", icon: Volume2Icon, swatch: ["#3a86ff", "#03045e", "#0b090a", "#ff006e"] },
}
// one's own sound style as a card: its family's palette on the waveform
export const familyArt = (s: SavedStyle): Preset => ({ value: s.name, label: s.name, swatch: s.for ? FAMILIES[s.for].swatch : undefined })
// the field a sound style fills in its tools: a voice's How it sounds, else Style
export const styleKey = (family?: SoundFamily) => (family === "voice" ? "instructions" : "style")

// each group's icon, for its chip and its row in the Library
const GROUP_ICONS: Record<string, LucideIcon> = {
  "2D animation": PenToolIcon,
  "3D": BoxIcon,
  Handmade: HandIcon,
  "Painting & illustration": BrushIcon,
  "Pixel & retro": Gamepad2Icon,
  Photographic: CameraIcon,
  Graphic: ShapesIcon,
  Content: MonitorPlayIcon,
  "Pop & dance": Disc3Icon,
  Electronic: KeyboardMusicIcon,
  "Hip-hop & R&B": MicVocalIcon,
  Rock: GuitarIcon,
  Metal: SkullIcon,
  "Acoustic & jazz": PianoIcon,
  "Cinematic & game": ClapperboardIcon,
  Narration: BookOpenIcon,
  Energy: ZapIcon,
  Soft: FeatherIcon,
  Character: DramaIcon,
  Realistic: MicIcon,
  Cinematic: FilmIcon,
  Stylized: WandSparklesIcon,
}
export function GroupIcon({ group, className }: { group: string | null; className?: string }) {
  const Icon = group ? (GROUP_ICONS[group] ?? SparklesIcon) : LayoutGridIcon
  return <Icon className={className} />
}

// a grain for the painted styles, drawn once
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0"/></filter><rect width="120" height="120" filter="url(#n)"/></svg>'
)}")`
// a waveform's bars, the sound styles' texture
const WAVE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60">${[10, 22, 34, 18, 44, 28, 12, 38, 24, 50, 16, 30, 20, 42, 14, 26, 46, 18, 32, 10]
    .map((h, i) => `<rect x="${i * 8 + 2}" y="${(60 - h) / 2}" width="4" height="${h}" rx="2" fill="white" fill-opacity=".45"/>`)
    .join("")}</svg>`
)}") center / 70% 55% no-repeat`
// each group's texture over the style's palette: cel shadows, a lit sphere, stitches, paint grain, pixels; a sound's waveform
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
      style={{ background: `${TEXTURE[preset.group ?? ""] ?? WAVE}, radial-gradient(circle at 85% 85%, ${d} 0 18%, transparent 19%), linear-gradient(135deg, ${a}, ${b} 50%, ${c})` }}
    />
  )
}

// a style's picture: the user's last result in it (a video plays under the pointer), else its sample image, else its
// painted card
export function StyleThumb({ file, preset, className }: { file: string | null; preset?: Preset; className?: string }) {
  const k = file ? mediaKind(file) : null
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const sample = preset?.preview?.endsWith(".webp") ? preset.preview : null
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      {preset && k !== "image" && k !== "video" && (sample ? <img src={sample} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : <Art preset={preset} />)}
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

// the last result made in a style (Restyle, Custom, a sound's Style or a voice's How it sounds: key), of this space
// first: a preset by its value or its label
export function lastIn(value: string, label: string | undefined, kind: Kind, media: Job[], home: string, key = "style") {
  const made = (j: Job) => j.status === "done" && j.outputs.length && (j.fields?.[key] === value || (!!label && j.fields?.[key]?.toLowerCase() === label.toLowerCase()))
  const j = media.find((x) => x.kind === kind && made(x)) ?? media.find(made)
  return j ? outputPath(home, j, j.outputs.find((o) => mediaKind(o) === "image" || mediaKind(o) === "video") ?? j.outputs[0]) : null
}

// the style a tool draws in (or sounds in: f.for), as a row: its picture and name, Change, and × when the tool can go
// without one (Custom, a sound effect)
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
  // only the styles of its kind: a look for an image or a video, a sound of its family
  const mine = styles.filter((s) => s.for === f.for)
  const preset = presets.find((p) => p.value === v), saved = mine.find((s) => s.name === v)
  const name = preset?.label ?? (saved ? saved.name : v)
  const file = saved ? (saved.files[0] ?? null) : v ? lastIn(v, preset?.label, kind, media, home, f.key) : null
  const optional = f.default == null && !f.required
  const None = f.for ? FAMILIES[f.for].icon : PaintbrushIcon
  return (
    <div>
      <Label hint={optional ? "optional" : undefined}>{f.label}</Label>
      <div className="flex items-center gap-3 rounded-xl border bg-card p-2 pr-2.5">
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Style: ${name || "none"}. Change it`}>
          {v ? (
            <StyleThumb file={file} preset={saved?.for ? familyArt(saved) : preset} className="size-11 shrink-0 rounded-lg border" />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed text-muted-foreground">
              <None className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-medium", !v && "text-muted-foreground")}>{name || "No style"}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {!v ? (f.for ? "The model's own way" : "The model's own look") : saved ? "Your style" : preset ? preset.group : "Your words"}
            </span>
          </span>
        </button>
        {f.for && preset?.preview && <Listen key={preset.preview} path="" src={preset.preview} />}
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {v ? "Change" : "Choose"}
        </Button>
        {v && optional && (
          <Button size="icon-sm" variant="ghost" aria-label="No style" onClick={() => onChange("")}>
            <XIcon />
          </Button>
        )}
      </div>
      <Gallery open={open} onClose={() => setOpen(false)} value={v} presets={presets} styles={mine} family={f.for} fieldKey={f.key} kind={kind} media={media} home={home} onPick={(x) => (onChange(x), setOpen(false))} />
    </div>
  )
}

// every style as a card: the presets by group, searchable, and the user's own from the Library (a sound family's alone)
function Gallery({
  open,
  onClose,
  value,
  presets,
  styles,
  family,
  fieldKey,
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
  family?: SoundFamily
  fieldKey: string
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
          <DialogDescription className="mt-1">
            {family
              ? `A sound style is how it sounds: ${family === "voice" ? "a voice's delivery, its pace and its mood" : family === "music" ? "genre, instruments, tempo and mood" : "its texture and its space"}. Your own are made in the Library, in words.`
              : "A style is a look: medium, palette, line and texture, never what is in the picture. Your own are made in the Library, from your images."}
          </DialogDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chips options={["presets", "yours"] as const} value={tab} label={(t) => (t === "presets" ? "Presets" : `Yours · ${styles.length}`)} icon={(t) => (t === "presets" ? <SparklesIcon /> : <UserIcon />)} onChange={setTab} />
          <span className="flex-1" />
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search styles" aria-label="Search styles" className="pl-8" />
          </div>
        </div>
        {tab === "presets" && (
          <Chips options={["", ...groups]} value={group ?? ""} label={(g) => g || "All"} icon={(g) => <GroupIcon group={g || null} />} onChange={(g) => setGroup(g || null)} className="[&>button]:px-2.5 [&>button]:py-0.5 [&>button]:text-xs" />
        )}
        <div className="-mx-1 min-h-0 flex-1 overflow-auto px-1 pb-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3" role="radiogroup" aria-label="Styles">
            {tab === "presets"
              ? shown.map((p) => <StyleCard key={p.value} on={p.value === value} title={p.label} note={p.note} sample={family ? p.preview : undefined} onPick={() => onPick(p.value)} thumb={<StyleThumb file={lastIn(p.value, p.label, kind, media, home, fieldKey)} preset={p} className="absolute inset-0" />} />)
              : yours.map((s) => <StyleCard key={s.name} on={s.name === value} title={s.name} note={s.words || `${s.files.length} image${s.files.length > 1 ? "s" : ""}`} onPick={() => onPick(s.name)} thumb={<StyleThumb file={s.files[0] ?? null} preset={s.for ? familyArt(s) : undefined} className="absolute inset-0" />} />)}
            {tab === "yours" && (
              <button
                type="button"
                onClick={() => (window.location.hash = family ? "library/sound-styles" : "library/styles")}
                className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors outline-none hover:border-space/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <PlusIcon className="size-5" />
                New style
                <span className="px-6 text-center text-xs">{family ? "In the Library, in a few words" : "In the Library, from 1 to 5 images of the look"}</span>
              </button>
            )}
          </div>
          {tab === "presets" && !shown.length && <p className="py-8 text-center text-sm text-muted-foreground">No style matches.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// a style as a card: a choice in the picker (radio), a button that opens it in the Library; a sound style's sample
// plays from its corner
export function StyleCard({ on, title, note, thumb, onPick, radio = true, sample }: { on: boolean; title: string; note?: string; thumb: React.ReactNode; onPick: () => void; radio?: boolean; sample?: string }) {
  const card = (
    <button
      type="button"
      role={radio ? "radio" : undefined}
      aria-checked={radio ? on : undefined}
      onClick={onPick}
      className={cn(
        "group/card relative aspect-video w-full overflow-hidden rounded-xl border text-left transition-[box-shadow,border-color] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
  return sample ? (
    <div className="relative">
      {card}
      <span className="absolute top-2 right-2">
        <Listen path="" src={sample} />
      </span>
    </div>
  ) : (
    card
  )
}
