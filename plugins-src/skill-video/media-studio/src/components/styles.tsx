import { useState } from "react"
import { ImageIcon, PaintbrushIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon, VideoIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, fileUrl, opt, plain, type Option, type SavedStyle, type State } from "@/lib/api"
import { Chips, Label } from "@/components/chips"
import { ConfirmDelete, FilesEditor, type Use } from "@/components/elements"
import { Main, Side } from "@/components/pages"
import { lastIn, StyleCard, StyleThumb, type Preset } from "@/components/style-picker"

type Open = { preset: Preset } | { yours: string }

// the Library's styles: the presets and the user's own in one gallery, each opened to use it (Restyle, Custom) or,
// for one's own, to change it
export function StylesTab({ tabs, state, options, engine, onUse, onChanged }: { tabs: React.ReactNode; state: State; options: Option[]; engine: string; onUse: Use; onChanged: () => void }) {
  const presets = options.map((o) => opt(o) as Preset)
  const yours = state.styles ?? []
  const [source, setSource] = useState<"all" | "presets" | "yours">("all")
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Open | null>(null)
  const [creating, setCreating] = useState(false)
  const q = query.trim().toLowerCase()
  const groups = [...new Set(presets.map((p) => p.group ?? ""))]
  const mine = source === "presets" || group ? [] : yours.filter((s) => !q || `${s.name} ${s.words}`.toLowerCase().includes(q))
  const theirs = source === "yours" ? [] : presets.filter((p) => (!group || p.group === group) && (!q || `${p.label} ${p.note ?? ""} ${p.group ?? ""}`.toLowerCase().includes(q)))
  const thumb = (p: Preset) => lastIn(p.value, p.label, "image", state.media, state.home)
  const shownYours = open && "yours" in open ? yours.find((s) => s.name === open.yours) : undefined

  return (
    <>
      <Side>
        {tabs}
        <Button variant="space" onClick={() => setCreating(true)}>
          <PlusIcon /> New style
        </Button>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search styles" aria-label="Search styles" className="pl-8" />
        </div>
        <div>
          <Label>Show</Label>
          <Chips
            options={["all", "yours", "presets"] as const}
            value={source}
            label={(s) => (s === "all" ? "All" : s === "yours" ? `Yours · ${yours.length}` : `Presets · ${presets.length}`)}
            onChange={(s) => (setSource(s), s === "yours" && setGroup(null))}
          />
        </div>
        {source !== "yours" && (
          <nav aria-label="Groups" className="-mx-1 flex flex-col gap-0.5">
            {[null, ...groups].map((g) => (
              <button
                key={g ?? "all"}
                type="button"
                aria-current={group === g ? "true" : undefined}
                onClick={() => setGroup(g)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  group === g ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <span className="flex-1">{g ?? "Every group"}</span>
                <span className="text-xs tabular-nums">{g ? presets.filter((p) => p.group === g).length : presets.length}</span>
              </button>
            ))}
          </nav>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          A style is a look: medium, palette, line and texture, never what is in the picture. Use one in Restyle or Custom. Yours are made from 1 to 5 images that share the
          look.
        </p>
      </Side>
      <Main title="Styles" aside={<span className="text-sm text-muted-foreground">{mine.length + theirs.length} styles</span>}>
        {source !== "presets" && !group && (
          <section className="flex flex-col gap-3" aria-label="Yours">
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Yours</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
              {mine.map((s) => (
                <StyleCard key={s.name} radio={false} on={false} title={s.name} note={s.words || `${s.files.length} image${s.files.length > 1 ? "s" : ""}`} onPick={() => setOpen({ yours: s.name })} thumb={<StyleThumb file={s.files[0]} className="absolute inset-0" />} />
              ))}
              {!q && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors outline-none hover:border-space/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <PlusIcon className="size-5" />
                  New style
                  <span className="px-6 text-center text-xs">From 1 to 5 images of the look</span>
                </button>
              )}
            </div>
          </section>
        )}
        {(group ? [group] : groups).map((g) => {
          const list = theirs.filter((p) => (p.group ?? "") === g)
          return list.length ? (
            <section key={g} className="flex flex-col gap-3" aria-label={g}>
              <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{g}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
                {list.map((p) => (
                  <StyleCard key={p.value} radio={false} on={false} title={p.label} note={p.note} onPick={() => setOpen({ preset: p })} thumb={<StyleThumb file={thumb(p)} preset={p} className="absolute inset-0" />} />
                ))}
              </div>
            </section>
          ) : null
        })}
        {!mine.length && !theirs.length && (source === "presets" || q) && <p className="py-8 text-center text-sm text-muted-foreground">No style matches.</p>}
      </Main>
      {open && "preset" in open && <PresetDialog preset={open.preset} file={thumb(open.preset)} onClose={() => setOpen(null)} onUse={onUse} />}
      {shownYours && <YourStyle style={shownYours} state={state} onClose={() => setOpen(null)} onUse={onUse} onChanged={onChanged} />}
      {creating && <NewStyle state={state} engine={engine} onClose={() => setCreating(false)} onSaved={(name) => (setCreating(false), onChanged(), setOpen({ yours: name }))} />}
    </>
  )
}

// where a style goes: Restyle an image or a video, or Custom image with it
function UseButtons({ value, onUse, onClose }: { value: string; onUse: Use; onClose: () => void }) {
  const go = (kind: "image" | "video", tool: string) => (onClose(), onUse(kind, tool, { fields: { style: value } }))
  return (
    <>
      <Button variant="space" onClick={() => go("image", "restyle")}>
        <PaintbrushIcon /> Restyle an image
      </Button>
      <Button variant="outline" onClick={() => go("video", "restyle")}>
        <VideoIcon /> Restyle a video
      </Button>
      <Button variant="outline" onClick={() => go("image", "free")}>
        <ImageIcon /> Create with it
      </Button>
    </>
  )
}

function PresetDialog({ preset, file, onClose, onUse }: { preset: Preset; file: string | null; onClose: () => void; onUse: Use }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[600px]">
        <div className="pr-8">
          <DialogTitle>{preset.label}</DialogTitle>
          <DialogDescription className="mt-1">
            {preset.group} · {preset.note}
            {file ? "" : " · its card is painted from its palette until you make something in it"}
          </DialogDescription>
        </div>
        <StyleThumb file={file} preset={preset} className="aspect-video w-full rounded-xl border" />
        <p className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">{preset.value}</p>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <UseButtons value={preset.value} onUse={onUse} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// one of the user's styles, open: its images and words to change, where it goes
function YourStyle({ style, state, onClose, onUse, onChanged }: { style: SavedStyle; state: State; onClose: () => void; onUse: Use; onChanged: () => void }) {
  const [words, setWords] = useState(style.words)
  const [confirm, setConfirm] = useState(false)
  async function save(body: { paths?: string[]; words?: string; drop?: string[]; remove?: boolean }) {
    try {
      await api.styles({ name: style.name, ...body })
      onChanged()
    } catch (e) {
      toast.error(plain((e as Error).message))
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-5 overflow-auto sm:max-w-[640px]">
        <div className="pr-8">
          <DialogTitle>{style.name}</DialogTitle>
          <DialogDescription className="mt-1">Your style: its images go with the request, the model takes their look, never their subject.</DialogDescription>
        </div>
        <div className={cn("grid gap-1 overflow-hidden rounded-xl border", style.files.length > 1 && "grid-cols-2")}>
          {style.files.slice(0, 4).map((f) => <img key={f} src={fileUrl(f)} alt="" className="aspect-video w-full object-cover" />)}
        </div>
        <div>
          <Label hint="optional, sent with it">The look in words</Label>
          <Input value={words} placeholder="loose sumi ink washes, rice paper, one red accent" onChange={(e) => setWords(e.target.value)} onBlur={() => words !== style.words && save({ words })} />
        </div>
        <FilesEditor files={style.files} kind="image" state={state} label="Images of the look" max={5} onAdd={(paths) => save({ paths })} onDrop={(f) => save({ drop: [f.split("/").pop()!] })} />
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <UseButtons value={style.name} onUse={onUse} onClose={onClose} />
          <span className="flex-1" />
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
            <Trash2Icon /> Delete
          </Button>
        </div>
        <ConfirmDelete what={style.name} open={confirm} onCancel={() => setConfirm(false)} onConfirm={() => (setConfirm(false), onClose(), save({ remove: true }))} />
      </DialogContent>
    </Dialog>
  )
}

function NewStyle({ state, engine, onClose, onSaved }: { state: State; engine: string; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState("")
  const [words, setWords] = useState("")
  const [paths, setPaths] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const taken = (state.styles ?? []).some((s) => s.name === name)
  async function save() {
    setBusy(true)
    try {
      await api.styles({ name, words: words || undefined, paths })
      toast.success(`Style ${name} saved`, { description: "Use it in Restyle or Custom." })
      onSaved(name)
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  function askClaude() {
    const n = name || "<a short name>"
    const text = [
      `/skill-video:media-generator Make the style ${n} in my Library.`,
      paths.length ? `Its images: ${paths.join(", ")}.` : "No image yet: ask me for 1 to 5 images that share the look.",
      words ? `The look in words: ${words}.` : "Look at the images and write their look in a few words: medium, palette, line, texture, light; never their subject.",
      `Save it with: node "${engine}/media.mjs" styles add ${n} <images…> --words "…" (--from <generation> takes a result's images).`,
      "Then tell me how to use it.",
    ].join("\n")
    navigator.clipboard.writeText(text).then(
      () => toast.success("Prompt copied", { description: "Paste it in Claude Code: Claude makes the style." }),
      () => toast.error("The clipboard refused the copy")
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-5 overflow-auto sm:max-w-[640px]">
        <div>
          <DialogTitle>New style</DialogTitle>
          <DialogDescription className="mt-1">A look taken from 1 to 5 images: a painting, a film frame, an illustration. The model copies the look, never what is in them.</DialogDescription>
        </div>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div>
            <Label hint={taken ? "adds to it" : undefined}>Name</Label>
            <Input value={name} placeholder="Ink-wash" onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} />
          </div>
          <div>
            <Label hint="optional">The look in words</Label>
            <Input value={words} placeholder="loose sumi ink washes, rice paper, one red accent" onChange={(e) => setWords(e.target.value)} />
          </div>
        </div>
        <FilesEditor files={paths} kind="image" state={state} label="Images of the look" max={5} onAdd={(more) => setPaths((p) => [...p, ...more.filter((m) => !p.includes(m))].slice(0, 5))} onDrop={(f) => setPaths((p) => p.filter((x) => x !== f))} />
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button variant="outline" onClick={askClaude} title="Copies a request for Claude: it writes the words and saves the style">
            <SparklesIcon /> Ask Claude
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="space" disabled={busy || !name || !paths.length} onClick={save}>
            {!name ? "Name it" : !paths.length ? "Add an image" : taken ? `Add to ${name}` : "Save style"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
