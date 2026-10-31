import { useRef, useState } from "react"
import {
  AudioLinesIcon,
  BoxIcon,
  CopyIcon,
  FolderOpenIcon,
  LayersIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PersonStandingIcon,
  PlusIcon,
  SearchIcon,
  ShapesIcon,
  ShirtIcon,
  SparklesIcon,
  TagIcon,
  Trash2Icon,
  UploadIcon,
  UserIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, currentOf, ELEMENT_TYPES, fileUrl, mediaKind, outputPath, plain, typeLabel, type Element, type ElementType, type Kind, type State, type Tool } from "@/lib/api"
import { Chips, Label } from "@/components/chips"
import { LibraryList, Listen, upload, type Pick } from "@/components/inputs"
import type { Compose } from "@/components/composer"
import { Main, Side } from "@/components/pages"
import { WorkspaceRows } from "@/components/workspace-list"

// a new Element as a result leads to it: its type and files, the words its tool had
export type ElementDraft = { type: ElementType; paths: string[]; words?: string }
// what a Library page asks of the composer: a tool of a space, filled in
export type Use = (kind: Kind, tool: string, patch: Partial<Compose>) => void

export const TYPE_ICON: Record<ElementType, LucideIcon> = {
  character: UserIcon,
  outfit: ShirtIcon,
  object: BoxIcon,
  location: MapPinIcon,
  pose: PersonStandingIcon,
  brand: TagIcon,
  voice: AudioLinesIcon,
  other: ShapesIcon,
}
// the References tool that makes a type's sheets, and the field its words go to
const SHEETS: Partial<Record<ElementType, { tool: string; field: string }>> = {
  character: { tool: "character", field: "who" },
  outfit: { tool: "outfit", field: "what" },
  object: { tool: "object", field: "what" },
  location: { tool: "location", field: "what" },
  pose: { tool: "pose", field: "what" },
}
const WORDS: Record<ElementType, string> = {
  character: "a woman in her 30s, short red hair, green parka",
  outfit: "a brown leather biker jacket, white tee, black jeans",
  object: "a matte black ceramic mug with a gold rim",
  location: "a narrow Lisbon street, yellow tram rails, tiled facades",
  pose: "mid-jump, arms raised, knees bent",
  brand: "a specialty coffee roaster, warm and premium",
  voice: "warm, slow, a smile in the voice",
  other: "what it is, in a few words",
}
const NAME = /^[\w-]+$/
const medium = (t: ElementType) => (t === "voice" ? "audio" : "image")
const count = (n: number, t: ElementType) => `${n} ${t === "voice" ? "clip" : "image"}${n === 1 ? "" : "s"}`

// the results of one medium, to pick from
export const results = (state: State, kind: "image" | "audio"): Pick[] =>
  state.media.flatMap((j) => (j.status === "done" ? j.outputs.filter((o) => mediaKind(o) === kind).map((o) => ({ path: outputPath(state.home, j, o), job: j })) : []))

const copy = (text: string, what: string, description?: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`, description ? { description } : undefined),
    () => toast.error("The clipboard refused the copy")
  )

export function ElementsTab({
  tabs,
  state,
  tools,
  engine,
  draft,
  onDraftUsed,
  onUse,
  onChanged,
}: {
  tabs: React.ReactNode
  state: State
  tools: Tool[]
  engine: string
  draft: ElementDraft | null
  onDraftUsed: () => void
  onUse: Use
  onChanged: () => void
}) {
  const [type, setType] = useState<ElementType | "all">("all")
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  // a new one asked here, or from a result (« Make an element »)
  const [creating, setCreating] = useState<ElementDraft | null>(null)
  const making = creating ?? draft
  const stop = () => (setCreating(null), onDraftUsed())
  const all = state.elements ?? []
  const q = query.trim().toLowerCase()
  const [ws, setWs] = useState("all")
  const inWs = (e: Element, slug: string) => slug === "all" || !!state.workspaces.find((w) => w.slug === slug)?.linked.includes(e.name)
  const list = all.filter((e) => (type === "all" || e.type === type) && inWs(e, ws) && (!q || `${e.name} ${e.words}`.toLowerCase().includes(q)))
  const shown = all.find((e) => e.name === open)
  return (
    <>
      <Side>
        {tabs}
        <WorkspaceRows state={state} value={ws} onPick={setWs} count={(slug) => all.filter((e) => inWs(e, slug)).length} unit="element" all />
        <Button variant="space" onClick={() => setCreating({ type: type === "all" ? "character" : type, paths: [] })}>
          <PlusIcon /> New element
        </Button>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search elements" aria-label="Search elements" className="pl-8" />
        </div>
        <nav aria-label="Types" className="-mx-1 flex flex-col gap-0.5">
          {[{ type: "all" as const, plural: "All" }, ...ELEMENT_TYPES].map((t) => {
            const Icon = t.type === "all" ? LayersIcon : TYPE_ICON[t.type]
            const n = all.filter((e) => (t.type === "all" || e.type === t.type) && inWs(e, ws)).length
            if (t.type === "other" && !n) return null
            return (
              <button
                key={t.type}
                type="button"
                aria-current={type === t.type ? "true" : undefined}
                onClick={() => setType(t.type)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  type === t.type ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                <span className="flex-1">{t.plural}</span>
                <span className="text-xs tabular-nums">{n}</span>
              </button>
            )
          })}
        </nav>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Cite an element in any image or video prompt with <span className="font-medium text-foreground">@name</span>: its images go with the request, and the prompt says what
          they are. A voice is picked in Audio › Voice. The References tools make clean sheets for a character, an outfit, an object, a place or a pose.
        </p>
      </Side>
      <Main title="Elements" aside={<span className="text-sm text-muted-foreground">{list.length} of {all.length}</span>}>
        {list.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
            {list.map((el) => <ElementCard key={el.name} el={el} onOpen={() => setOpen(el.name)} />)}
          </div>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">{(() => {
                const Icon = type === "all" ? LayersIcon : TYPE_ICON[type]
                return <Icon />
              })()}</EmptyMedia>
              <EmptyTitle>{all.length ? "Nothing matches" : "No element yet"}</EmptyTitle>
              <EmptyDescription>
                {all.length ? "Another type or other words." : "Your characters, outfits, objects, places, poses, brands and voices: made once, cited with @name in every prompt."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button onClick={() => setCreating({ type: type === "all" ? "character" : type, paths: [] })}>
                <PlusIcon /> New element
              </Button>
              {SHEETS[type === "all" ? "character" : type] && (
                <Button variant="outline" onClick={() => onUse("image", SHEETS[type === "all" ? "character" : type]!.tool, {})}>
                  <SparklesIcon /> Make reference sheets
                </Button>
              )}
            </EmptyContent>
          </Empty>
        )}
      </Main>
      {shown && <ElementDialog el={shown} state={state} tools={tools} onClose={() => setOpen(null)} onUse={onUse} onChanged={onChanged} />}
      {making && (
        <NewElement
          key={JSON.stringify(making)}
          draft={making}
          state={state}
          tools={tools}
          engine={engine}
          onClose={stop}
          onSaved={(name) => (stop(), onChanged(), setOpen(name))}
        />
      )}
    </>
  )
}

// an Element's picture: its images (the first large), a brand's logo on its colors, a voice's clips
function Cover({ el, className }: { el: Element; className?: string }) {
  if (el.type === "voice")
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 bg-linear-to-br from-aud/25 to-aud/5", className)}>
        <AudioLinesIcon className="size-8 text-aud" />
        <span className="text-xs text-muted-foreground">{count(el.files.length, "voice")}</span>
      </div>
    )
  if (el.type === "brand")
    return (
      <div className={cn("relative flex items-center justify-center bg-muted p-6", className)}>
        {el.files[0] && <img src={fileUrl(el.files[0])} alt="" className="size-full object-contain" />}
        {el.colors.length > 0 && (
          <span className="absolute inset-x-0 bottom-0 flex h-2.5">
            {el.colors.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}
          </span>
        )}
      </div>
    )
  const [a, ...rest] = el.files
  if (!a)
    return (
      <div className={cn("grid place-items-center bg-muted text-muted-foreground", className)}>
        {(() => {
          const Icon = TYPE_ICON[el.type]
          return <Icon className="size-7" />
        })()}
      </div>
    )
  return (
    <div className={cn("grid gap-px bg-border", rest.length ? "grid-cols-3 grid-rows-2" : "", className)}>
      <img src={fileUrl(a)} alt="" loading="lazy" className={cn("size-full min-h-0 object-cover", rest.length && "col-span-2 row-span-2")} />
      {rest.slice(0, 2).map((f, i) => (
        <img key={f} src={fileUrl(f)} alt="" loading="lazy" className={cn("size-full min-h-0 object-cover", rest.length === 1 && i === 0 && "row-span-2")} />
      ))}
    </div>
  )
}

export function ElementCard({ el, onOpen, className }: { el: Element; onOpen: () => void; className?: string }) {
  const Icon = TYPE_ICON[el.type]
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left transition-[border-color,box-shadow] duration-150 outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      <Cover el={el} className="aspect-[4/3] w-full overflow-hidden" />
      <span className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">@{el.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{el.words || count(el.files.length, el.type)}</span>
        </span>
        <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
          <Icon /> {typeLabel(el.type)}
        </Badge>
      </span>
    </button>
  )
}

// the files of an Element or a style: each with ×, then a file to send or one to pick in the library
export function FilesEditor({
  files,
  kind,
  state,
  label,
  max,
  onAdd,
  onDrop,
}: {
  files: string[]
  kind: "image" | "audio"
  state: State
  label: string
  max?: number
  onAdd: (paths: string[]) => void
  onDrop: (path: string) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const room = max == null || files.length < max
  const tile = "flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors outline-none hover:border-space/60 hover:text-space focus-visible:ring-3 focus-visible:ring-ring/50"
  return (
    <div>
      <Label hint={max ? `${files.length} / ${max}` : undefined}>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <div key={f} className="group relative size-20 overflow-hidden rounded-lg border">
            {kind === "audio" ? (
              <div className="grid size-full place-items-center bg-aud/10">
                <Listen path={f} />
              </div>
            ) : (
              <img src={fileUrl(f)} alt="" className="size-full object-cover" />
            )}
            <button
              type="button"
              aria-label="Remove"
              onClick={() => onDrop(f)}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ))}
        {room && (
          <>
            <button type="button" disabled={busy} onClick={() => picker.current?.click()} className={tile}>
              {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
              Upload
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={tile}>
                  <FolderOpenIcon className="size-4" />
                  Library
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" collisionPadding={12} className="flex max-h-(--radix-popover-content-available-height) w-[min(460px,calc(100vw-2rem))] flex-col gap-0 p-0">
                <LibraryList
                  title={`${kind === "audio" ? "Clips" : "Images"} from the library`}
                  items={results(state, kind)}
                  picked={files}
                  onPick={(p) => (files.includes(p) ? onDrop(p) : onAdd([p]))}
                  multiple
                />
              </PopoverContent>
            </Popover>
          </>
        )}
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={kind === "audio" ? "audio/*" : "image/*"}
          onChange={async (e) => {
            const list = [...(e.target.files ?? [])].slice(0, max == null ? undefined : max - files.length)
            if (!list.length) return
            setBusy(true)
            try {
              onAdd(await Promise.all(list.map(upload)))
            } catch (err) {
              toast.error(plain((err as Error).message))
            } finally {
              setBusy(false)
              e.target.value = ""
            }
          }}
        />
      </div>
    </div>
  )
}

// a brand's colors: swatches with ×, one more from the picker
function Colors({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [next, setNext] = useState("#0e2a47")
  return (
    <div>
      <Label hint="kept exact">Colors</Label>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((c) => (
          <span key={c} className="flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-1 text-xs tabular-nums">
            <span className="size-6 rounded-full border" style={{ background: c }} />
            {c}
            <button type="button" aria-label={`Remove ${c}`} onClick={() => onChange(value.filter((x) => x !== c))} className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <input type="color" value={next} onChange={(e) => setNext(e.target.value)} aria-label="A color" className="h-8 w-10 cursor-pointer rounded-md border bg-transparent" />
          <Button size="sm" variant="outline" onClick={() => !value.includes(next.toUpperCase()) && onChange([...value, next.toUpperCase()])}>
            <PlusIcon /> Add
          </Button>
        </span>
      </div>
    </div>
  )
}

// a deletion asked once more
export function ConfirmDelete({ what, open, onCancel, onConfirm, text = "It leaves the Library for good. What you made with it stays." }: { what: string; open: boolean; onCancel: () => void; onConfirm: () => void; text?: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogTitle>Delete {what}?</DialogTitle>
        <DialogDescription>{text}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// an Element, open: its files, type and words to change, what it leads to
export function ElementDialog({ el, state, tools, onClose, onUse, onChanged }: { el: Element; state: State; tools: Tool[]; onClose: () => void; onUse: Use; onChanged: () => void }) {
  const [words, setWords] = useState(el.words)
  const [font, setFont] = useState(el.font)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const sheets = SHEETS[el.type], tool = sheets && tools.find((t) => t.id === sheets.tool)
  async function save(body: Omit<Parameters<typeof api.elements>[0], "name">) {
    setBusy(true)
    try {
      await api.elements({ name: el.name, ...body })
      onChanged()
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  const Icon = TYPE_ICON[el.type]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-5 overflow-auto sm:max-w-[640px]">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="truncate">@{el.name}</DialogTitle>
            <DialogDescription className="mt-0.5">
              {typeLabel(el.type)} · {count(el.files.length, el.type)}
              {el.type === "voice" ? ", picked in Audio › Voice" : ", all sent with every @name"}
            </DialogDescription>
          </div>
        </div>

        {el.type !== "voice" && (
          <div>
            <Label>Type</Label>
            <Chips
              options={ELEMENT_TYPES.filter((t) => t.type !== "voice" && (t.type !== "other" || el.type === "other")).map((t) => t.type)}
              value={el.type}
              label={typeLabel}
              onChange={(type) => save({ type })}
            />
          </div>
        )}

        <div>
          <Label hint={el.type === "voice" ? "how it sounds" : "sent with every @name"}>What it is</Label>
          <Textarea value={words} placeholder={WORDS[el.type]} onChange={(e) => setWords(e.target.value)} onBlur={() => words !== el.words && save({ words })} className="min-h-16" />
        </div>

        {el.type === "brand" && (
          <>
            <Colors value={el.colors} onChange={(colors) => save({ colors })} />
            <div>
              <Label hint="optional">Typeface</Label>
              <Input value={font} placeholder="Inter" onChange={(e) => setFont(e.target.value)} onBlur={() => font !== el.font && save({ font })} />
            </div>
          </>
        )}

        <FilesEditor
          files={el.files}
          kind={medium(el.type)}
          state={state}
          label={el.type === "voice" ? "Clips" : el.type === "brand" ? "Logos" : "Images"}
          max={el.type === "voice" ? 3 : undefined}
          onAdd={(paths) => save({ paths })}
          onDrop={(f) => save({ drop: [f.split("/").pop()!] })}
        />

        {el.type === "voice" && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{el.voice_id ? "On your ElevenLabs account" : "Change voice (ElevenLabs)"}</span>
              <span className="block text-xs text-muted-foreground">
                {el.voice_id ? `Pick it in Audio › Change voice (${el.voice_id}).` : "An instant clone on your account, to put this voice on a clip. ElevenLabs needs a paid plan for it."}
              </span>
            </span>
            {!el.voice_id && (
              <Button size="sm" variant="outline" disabled={busy || !state.keys.elevenlabs} onClick={() => save({ elevenlabs: true })}>
                Add to ElevenLabs
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {el.type !== "voice" ? (
            <Button variant="outline" onClick={() => copy(`@${el.name}`, `@${el.name}`, "Paste it in any image or video prompt.")}>
              <CopyIcon /> Copy @{el.name}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => (onClose(), onUse("audio", "voice", { params: { voice: `@${el.name}` } }))}>
              <AudioLinesIcon /> Speak with it
            </Button>
          )}
          {tool && sheets && (
            <Button
              variant="outline"
              onClick={() => (onClose(), onUse("image", tool.id, { inputs: el.files.length ? { references: el.files.slice(0, 4) } : {}, fields: el.words ? { [sheets.field]: el.words } : {} }))}
            >
              <SparklesIcon /> Make sheets
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
            <Trash2Icon /> Delete
          </Button>
        </div>
        <ConfirmDelete what={`@${el.name}`} open={confirm} onCancel={() => setConfirm(false)} onConfirm={() => (setConfirm(false), onClose(), save({ remove: true }))} />
      </DialogContent>
    </Dialog>
  )
}

// a new Element: its type, name, words and files; saved here, or made by Claude from the same (Ask Claude)
export function NewElement({ draft, state, tools, engine, onClose, onSaved }: { draft: ElementDraft; state: State; tools: Tool[]; engine: string; onClose: () => void; onSaved: (name: string) => void }) {
  const [type, setType] = useState(draft.type)
  const [name, setName] = useState("")
  const [words, setWords] = useState(draft.words ?? "")
  const [paths, setPaths] = useState(draft.paths)
  const [colors, setColors] = useState<string[]>([])
  const [font, setFont] = useState("")
  // the workspace it is linked to: the current one, another, or none
  const [ws, setWs] = useState(currentOf(state)?.slug ?? "none")
  const [busy, setBusy] = useState(false)
  const kind = medium(type), files = paths.filter((p) => mediaKind(p) === kind)
  const taken = (state.elements ?? []).some((e) => e.name === name)
  const sheets = SHEETS[type], tool = sheets && tools.find((t) => t.id === sheets.tool)
  const hint = ELEMENT_TYPES.find((t) => t.type === type)!.hint

  async function save() {
    setBusy(true)
    try {
      await api.elements({ name, type, words, paths: files, workspace: ws === "none" ? null : ws, ...(type === "brand" ? { colors, font } : {}) })
      toast.success(`@${name} saved`, { description: type === "voice" ? "Pick it in Audio › Voice." : "Cite it in any image or video prompt." })
      onSaved(name)
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  function askClaude() {
    const label = typeLabel(type).toLowerCase(), n = name || "<a short name>"
    const text = [
      `/skill-video:media-generator Make the ${label} Element @${n} in my Library.`,
      files.length ? `Its ${kind === "audio" ? "clips" : "images"}: ${files.join(", ")}.` : `No ${kind === "audio" ? "clip" : "image"} yet: ask me for them${tool ? `, or make them with ${tool.label}` : ""}.`,
      words ? `What it is: ${words}.` : `Look at ${kind === "audio" ? "them" : "the images"} and write what it is in a few words (they go with every @name).`,
      type === "brand" && colors.length ? `Its colors: ${colors.join(", ")}.` : "",
      tool ? `If they are not clean reference sheets yet, make them first with ${tool.label} (media.mjs image --tool ${tool.id}; its estimate, then my yes before spending), and keep the best.` : "",
      `Save it with: node "${engine}/media.mjs" elements add ${n} <files…> --type ${type} --words "…"${type === "brand" ? ' --colors "#hex,#hex"' : ""} --workspace ${ws} (--from <generation> takes a result's ${kind === "audio" ? "clips" : "images"}).`,
      "Then tell me the @name to cite.",
    ].filter(Boolean).join("\n")
    copy(text, "Prompt", "Paste it in Claude Code: Claude makes the element.")
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-5 overflow-auto sm:max-w-[640px]">
        <div>
          <DialogTitle>New element</DialogTitle>
          <DialogDescription className="mt-1">Made once, cited with @name in every prompt: its images go with the request.</DialogDescription>
        </div>
        <div>
          <Label>Type</Label>
          <Chips options={ELEMENT_TYPES.filter((t) => t.type !== "other").map((t) => t.type)} value={type} label={typeLabel} onChange={setType} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {hint}
            {type === "brand" ? ". No tool redraws a logo: send the real file." : ""}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div>
            <Label hint={taken ? "adds to it" : undefined}>Name</Label>
            <InputGroup>
              <InputGroupAddon>@</InputGroupAddon>
              <InputGroupInput value={name} placeholder="lulu" aria-label="Name" onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} />
            </InputGroup>
          </div>
          <div>
            <Label hint={type === "voice" ? "how it sounds" : "sent with every @name"}>What it is</Label>
            <Input value={words} placeholder={WORDS[type]} onChange={(e) => setWords(e.target.value)} />
          </div>
        </div>
        <div>
          <Label hint="linked to it, cited first in its prompts">Workspace</Label>
          <Select value={ws} onValueChange={setWs}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.workspaces.map((w) => (
                <SelectItem key={w.slug} value={w.slug}>
                  {w.name}
                  {w.slug === currentOf(state)?.slug ? <span className="text-muted-foreground"> · current</span> : null}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value="none">No workspace</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {type === "brand" && (
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Colors value={colors} onChange={setColors} />
            <div>
              <Label hint="optional">Typeface</Label>
              <Input value={font} placeholder="Inter" onChange={(e) => setFont(e.target.value)} />
            </div>
          </div>
        )}
        <FilesEditor
          files={files}
          kind={kind}
          state={state}
          label={type === "voice" ? "Clips, 1 to 3 of clean speech" : type === "brand" ? "Logos" : "Images"}
          max={type === "voice" ? 3 : undefined}
          onAdd={(more) => setPaths((p) => [...p, ...more.filter((m) => !p.includes(m))])}
          onDrop={(f) => setPaths((p) => p.filter((x) => x !== f))}
        />
        {tool && !files.length && (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            No clean images yet? {tool.label} makes them from a few photos or words: each sheet lands in the library, then « Make an element » on one brings you back here.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button variant="outline" onClick={askClaude} title="Copies a request for Claude: it writes the words, makes the sheets if needed and saves the element">
            <CopyIcon /> Ask Claude
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="space" disabled={busy || !NAME.test(name) || !files.length} onClick={save}>
            {!name ? "Name it" : !files.length ? (kind === "audio" ? "Add a clip" : "Add an image") : taken ? `Add to @${name}` : "Save element"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
