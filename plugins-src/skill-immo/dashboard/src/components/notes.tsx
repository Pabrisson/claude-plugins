import { CheckIcon, EyeIcon, HistoryIcon, Maximize2Icon, PencilIcon, RotateCcwIcon } from "lucide-react"
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, type Listing } from "@/lib/api"
import { date, dateTime, eur, SALE_STATUS, titleOf } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

// the engine's limit (immo.mjs NOTES_MAX)
const MAX = 20000

// The note's text, and what ticks a box `- [ ]` in it (none: the boxes are read only). A box is ticked in the text
// itself, at its list item's place in the source, so the note stays plain Markdown the agent reads and appends to.
const Source = createContext<{ text: string; onTick?: (text: string) => void }>({ text: "" })
const Task = createContext<{ at: number; checked: boolean; label: string } | null>(null)
const TASK = /^(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\]/
const COMPONENTS: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  li: function Item({ node, className, children }) {
    const { text } = useContext(Source), start = node?.position?.start.offset
    const m = start != null && className?.includes("task-list-item") ? TASK.exec(text.slice(start)) : null
    if (!m || start == null) return <li className={className}>{children}</li>
    const checked = m[1] !== " ", label = text.slice(start + m[0].length).split("\n")[0].trim()
    return <li className={cn(className, checked && "done")}><Task.Provider value={{ at: start + m[0].length - 2, checked, label }}>{children}</Task.Provider></li>
  },
  input: function Box() {
    const { text, onTick } = useContext(Source), t = useContext(Task)
    if (!t) return null
    return <Checkbox checked={t.checked} disabled={!onTick} aria-label={t.label} onCheckedChange={() => onTick?.(text.slice(0, t.at) + (t.checked ? " " : "x") + text.slice(t.at + 1))} className="absolute top-[3px] left-0" />
  },
}

// Markdown as the notes hold it: GitHub's (tables, task lists, links), a line break kept as typed; never raw HTML
export function Markdown({ text, onTick, className }: { text: string; onTick?: (text: string) => void; className?: string }) {
  return (
    <Source.Provider value={{ text, onTick }}>
      <div className={cn("md", className)}><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>{text}</ReactMarkdown></div>
    </Source.Provider>
  )
}

// The editor's colors: a textarea over the same text tinted, letter for letter (same font, size and wrapping, no bold
// nor italic that would move the caret off its letter). Only the marks are colored: headings, list and box marks,
// bold and code, links.
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]*\]\([^)\n]*\)|(?<![\w*])\*[^*\s][^*\n]*\*(?!\*)|(?<!\w)_[^_\s][^_\n]*_(?!\w))/g
const MARK = "text-muted-foreground"
function inline(s: string): ReactNode[] {
  return s.split(INLINE).map((p, i) => {
    if (i % 2 === 0) return p
    if (p.startsWith("`")) return <span key={i} className="text-[var(--md-code)]">{p}</span>
    if (p.startsWith("[")) { const j = p.indexOf("]("); return <Fragment key={i}><span className="text-[var(--md-link)]">{p.slice(0, j + 1)}</span><span className={MARK}>{p.slice(j + 1)}</span></Fragment> }
    // bold tinted, italic grey (as the dossier shows it)
    const n = p.startsWith("**") ? 2 : 1
    return <Fragment key={i}><span className={MARK}>{p.slice(0, n)}</span><span className={n === 2 ? "text-[var(--md-strong)]" : MARK}>{p.slice(n, -n)}</span><span className={MARK}>{p.slice(-n)}</span></Fragment>
  })
}
function highlight(text: string): ReactNode[] {
  return text.split("\n").map((line, i) => {
    let m: RegExpExecArray | null, body: ReactNode
    if ((m = /^(#{1,6}[ \t]+)(.*)$/.exec(line))) body = <><span className={MARK}>{m[1]}</span><span className="text-[var(--md-heading)]">{m[2]}</span></>
    else if ((m = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/.exec(line))) body = <>{m[1]}<span className="text-[var(--md-mark)]">{m[2]}</span>{m[3]}{m[4] && <span className="text-[var(--md-mark)]">{m[4]}</span>}{inline(m[5])}</>
    else if ((m = /^([ \t]*>[ \t]?)(.*)$/.exec(line))) body = <><span className="text-[var(--md-mark)]">{m[1]}</span><span className={MARK}>{inline(m[2])}</span></>
    else body = inline(line)
    // each line's break, and one more after the last: an empty last line keeps its height, as in the textarea
    return <Fragment key={i}>{body}{"\n"}</Fragment>
  })
}
// the box scrolls (60 % of the screen at most), the textarea grows with its text over the tinted copy
function Editor({ value, onChange, area, scroller }: { value: string; onChange: (v: string) => void; area: React.RefObject<HTMLTextAreaElement | null>; scroller: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={scroller} className={cn("max-h-[60vh] overflow-y-auto rounded-md border border-input shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30", value.length > MAX && "border-destructive")}>
      <div className="grid min-h-40 text-base leading-relaxed md:text-sm [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:px-3 [&>*]:py-2 [&>*]:break-words [&>*]:whitespace-pre-wrap">
        <div aria-hidden className="pointer-events-none">{highlight(value)}</div>
        <textarea ref={area} aria-label="Mes notes" value={value} onChange={e => onChange(e.target.value)} aria-invalid={value.length > MAX} placeholder="Visite, questions à poser, impressions…" className="h-full resize-none overflow-hidden bg-transparent text-transparent caret-foreground outline-none selection:bg-primary/25 placeholder:text-muted-foreground" />
      </div>
    </div>
  )
}

// What happened to the listing, newest first, quiet below the notes; each change of the notes can be undone: its
// icon opens the notes as they were before it, and « Restaurer cette version » (`open`: the version shown)
type Version = NonNullable<Listing["notes_history"]>[number]
const BY = { user: "Notes modifiées", agent: "Notes complétées par l'agent", restore: "Version restaurée" }
function FollowLog({ l, open, onOpen, onRestore }: { l: Listing; open: Version | null; onOpen: (v: Version | null) => void; onRestore?: () => void }) {
  const log: { date: string; text: string; version?: Version }[] = [
    { date: l.first_seen, text: "Ajoutée à la recherche" },
    ...(l.changes ?? []).filter(c => c.kind !== "new").map(c => ({ date: c.date, text: c.kind === "expired" ? "Annonce expirée" : c.kind === "status" ? `Statut : ${SALE_STATUS[String(c.to)] ?? c.to}` : `Prix : ${eur(c.from as number)} → ${eur(c.to as number)}` })),
    ...(l.notes_history ?? []).map(v => ({ date: v.date, text: BY[v.by], version: v })),
  ].toSorted((a, b) => b.date.localeCompare(a.date))
  return (
    <div className="-mr-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-2 text-xs text-muted-foreground" tabIndex={0} role="region" aria-label="Historique de l'annonce">
      {log.map((c, i) => (
        <div key={i} className="flex min-h-6 items-center justify-between gap-4">
          <time dateTime={c.date}>{c.version ? dateTime(c.date) : date(c.date)}</time>
          <span className="flex items-center gap-1 text-right">
            {c.text}
            {c.version && onRestore && (
              <Popover open={open === c.version} onOpenChange={o => onOpen(o ? c.version! : null)}>
                <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Restaurer la note d'avant" title="Restaurer la note d'avant"><RotateCcwIcon /></Button></PopoverTrigger>
                <PopoverContent align="end" className="w-[min(30rem,calc(100vw-2rem))]">
                  <PopoverHeader>
                    <PopoverTitle>La note avant cette modification</PopoverTitle>
                    <PopoverDescription>{dateTime(c.version.date)} · {BY[c.version.by].toLowerCase()}. La note actuelle restera dans l'historique.</PopoverDescription>
                  </PopoverHeader>
                  <Markdown text={c.version.notes} className="max-h-72 overflow-y-auto rounded-md border px-3 py-2" />
                  <Button size="sm" className="self-end" onClick={onRestore}><RotateCcwIcon data-icon="inline-start" />Restaurer cette version</Button>
                </PopoverContent>
              </Popover>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

// « Suivi »: the user's notes (Markdown, folded past 24rem and read whole in a dialog, written in « Modifier ») and what happened to the listing
// (FollowLog). A box of « À demander » ticks at once; a draft left open (the dossier closed) is saved, never lost.
export function FollowSection({ l }: { l: Listing }) {
  const { slug, reload } = useSearch()
  const notes = l.notes ?? ""
  const [draft, setDraft] = useState<string | null>(null), editing = draft != null, changed = editing && draft !== notes
  const [tab, setTab] = useState("write"), [saving, setSaving] = useState(false), [discard, setDiscard] = useState(false)
  const [full, setFull] = useState(false), [long, setLong] = useState(false), [back, setBack] = useState<Version | null>(null)
  const box = useRef<HTMLDivElement>(null), area = useRef<HTMLTextAreaElement>(null), scroller = useRef<HTMLDivElement>(null), pending = useRef<string | null>(null)

  // folded only when it runs past its box
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setLong(el.scrollHeight > el.clientHeight + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [notes, editing])
  // the cursor at the end: what one adds goes after
  useEffect(() => {
    const t = area.current
    if (!editing || !t) return
    t.focus({ preventScroll: true })
    t.setSelectionRange(t.value.length, t.value.length)
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [editing, tab])
  useEffect(() => { pending.current = changed ? draft : null })
  useEffect(() => () => { if (pending.current != null) api.listing(slug, l.id, { notes: pending.current.slice(0, MAX) }).then(reload, () => {}) }, [slug, l.id, reload])

  async function commit() {
    if (draft == null || draft.length > MAX) return
    if (!changed) return setDraft(null)
    setSaving(true)
    try {
      await api.listing(slug, l.id, { notes: draft })
      await reload()
      setDraft(null)
      toast.success("Notes enregistrées")
    } catch { toast.error("Les notes n'ont pas pu être enregistrées : votre texte reste ouvert") }
    finally { setSaving(false) }
  }
  const cancel = () => (changed ? setDiscard(true) : setDraft(null))
  const tick = (text: string) => api.listing(slug, l.id, { notes: text }).then(reload, () => toast.error("La case n'a pas pu être enregistrée"))
  const edit = () => { setFull(false); setDraft(notes); setTab("write") }
  async function restore() {
    if (!back) return
    try {
      await api.listing(slug, l.id, { notes: back.notes, restore: true })
      await reload()
      setBack(null)
      toast.success("Version restaurée : la note d'avant reste dans l'historique")
    } catch { toast.error("La version n'a pas pu être restaurée") }
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Suivi</h3>
        {!editing && notes && <Button size="xs" variant="outline" onClick={edit}><PencilIcon data-icon="inline-start" />Modifier</Button>}
      </div>

      {editing ? (
        // the dossier's panel leaves Échap to it (components/dossier: onEscapeKeyDown)
        <div data-notes-editor className="flex flex-col gap-2" onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
          else if (e.key === "Escape") { e.preventDefault(); cancel() }
        }}>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="write"><PencilIcon />Écrire</TabsTrigger>
              <TabsTrigger value="preview"><EyeIcon />Aperçu</TabsTrigger>
            </TabsList>
            <TabsContent value="write">
              <Editor value={draft} onChange={setDraft} area={area} scroller={scroller} />
            </TabsContent>
            <TabsContent value="preview">
              {draft.trim() ? <Markdown text={draft} onTick={setDraft} className="max-h-[60vh] min-h-40 overflow-y-auto rounded-md border px-3 py-2" /> : <p className="min-h-40 rounded-md border px-3 py-2 text-sm text-muted-foreground">Rien à afficher.</p>}
            </TabsContent>
          </Tabs>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto hidden text-xs text-muted-foreground sm:inline"><kbd>⌘</kbd> ou <kbd>Ctrl</kbd> + <kbd>Entrée</kbd> pour enregistrer</span>
            <span className={cn("text-xs text-muted-foreground tabular-nums", draft.length > MAX && "font-medium text-destructive")}>{draft.length.toLocaleString("fr-FR")} / {MAX.toLocaleString("fr-FR")}</span>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>Annuler</Button>
            <Button size="sm" onClick={commit} disabled={saving || draft.length > MAX}>{saving ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}Enregistrer</Button>
          </div>
        </div>
      ) : notes ? (
        <div className="flex flex-col gap-1">
          <div ref={box} className={cn("max-h-96 overflow-hidden", long && "mask-b-from-70%")}>
            <Markdown text={notes} onTick={tick} />
          </div>
          {long && <Button variant="ghost" size="xs" className="self-center" onClick={() => setFull(true)}><Maximize2Icon data-icon="inline-start" />Tout afficher</Button>}
          <Dialog open={full} onOpenChange={setFull}>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Mes notes</DialogTitle>
                <DialogDescription>{titleOf(l)}</DialogDescription>
              </DialogHeader>
              <Markdown text={notes} onTick={tick} />
              <DialogFooter><Button variant="outline" onClick={edit}><PencilIcon data-icon="inline-start" />Modifier</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <button type="button" onClick={() => { setDraft(""); setTab("write") }} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <PencilIcon className="size-4 shrink-0" />Ajouter une note : visite, questions à poser, impressions…
        </button>
      )}

      <Separator />
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><HistoryIcon className="size-3.5" />Historique</h4>
      <FollowLog l={l} open={back} onOpen={setBack} onRestore={editing ? undefined : restore} />

      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandonner les modifications ?</AlertDialogTitle>
            <AlertDialogDescription>Ce que vous avez changé dans vos notes depuis « Modifier » sera perdu.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer à écrire</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => setDraft(null)}>Abandonner</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
