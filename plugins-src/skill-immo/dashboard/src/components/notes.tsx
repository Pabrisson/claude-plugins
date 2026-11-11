import { diffLines, diffWordsWithSpace } from "diff"
import { CheckIcon, DiffIcon, EyeIcon, FileTextIcon, HistoryIcon, Maximize2Icon, PencilIcon, RotateCcwIcon } from "lucide-react"
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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

// a version of the notes: the notes before a change, rebuilt by the engine from the change's .diff (lib/notes.js;
// null when the notes no longer hold it), and who made the change
type Version = NonNullable<Listing["notes_history"]>[number]
const BY = { user: "Notes modifiées", agent: "Notes complétées par l'IA", restore: "Version restaurée" }

// What restoring a version does to the note, side by side as git shows it: on the left the current note, the lines that
// go in red; on the right the note once restored, the lines that come back in green. In a change, removed and added lines
// face each other as they come; a line facing the one it became (in order, the first sharing at least half its text)
// has the words that differ marked.
type Word = { text: string; hit: boolean }
type Cell = { n: number; text: string; words?: Word[] } | null
type Row = { change: boolean; left: Cell; right: Cell }
const linesOf = (value: string) => value.slice(0, -1).split("\n")
function words(a: string, b: string) {
  const parts = diffWordsWithSpace(a, b), same = parts.reduce((n, p) => n + (p.added || p.removed ? 0 : p.value.length), 0)
  if (same < Math.max(a.length, b.length) / 2) return null
  return { del: parts.filter(p => !p.added).map(p => ({ text: p.value, hit: !!p.removed })), add: parts.filter(p => !p.removed).map(p => ({ text: p.value, hit: !!p.added })) }
}
function sideBySide(from: string, to: string): Row[] {
  // every line ends with its break, the last one too: a note without a final break still matches line for line
  const parts = diffLines(from && from + "\n", to && to + "\n"), rows: Row[] = []
  let l = 1, r = 1
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p.added && !p.removed) { for (const text of linesOf(p.value)) rows.push({ change: false, left: { n: l++, text }, right: { n: r++, text } }); continue }
    const del = p.removed ? linesOf(p.value) : [], add = p.added ? linesOf(p.value) : parts[i + 1]?.added ? linesOf(parts[++i].value) : []
    const pairs: [number, number, ReturnType<typeof words>][] = []
    for (let k = 0, q = 0; k < add.length; k++)
      for (let j = q; j < del.length; j++) { const w = words(del[j], add[k]); if (w) { pairs.push([j, k, w]); q = j + 1; break } }
    let q = 0, k = 0
    for (const [pq, pk, w] of [...pairs, [del.length, add.length, null] as [number, number, null]]) {
      for (let j = 0; j < Math.max(pq - q, pk - k); j++) rows.push({ change: true, left: q + j < pq ? { n: l++, text: del[q + j] } : null, right: k + j < pk ? { n: r++, text: add[k + j] } : null })
      if (w) rows.push({ change: true, left: { n: l++, text: del[pq], words: w.del }, right: { n: r++, text: add[pk], words: w.add } })
      q = pq + 1; k = pk + 1
    }
  }
  return rows
}

// one side of a row: its line number, its sign and its text; an empty side (the line is on the other side only) grey.
// On a phone the two sides stack, as one column: a line unchanged once, a change red then green.
const SIDE = {
  left: { tint: "bg-[var(--diff-del)]", word: "bg-[var(--diff-del-word)]", fg: "text-[var(--diff-del-fg)]", sign: "−", said: "Enlevé : " },
  right: { tint: "bg-[var(--diff-add)]", word: "bg-[var(--diff-add-word)]", fg: "text-[var(--diff-add-fg)]", sign: "+", said: "Remis : " },
}
function Side({ cell, side, change }: { cell: Cell; side: "left" | "right"; change: boolean }) {
  const s = SIDE[side], edge = side === "right" && "sm:border-l"
  if (!cell) return <div aria-hidden className={cn("hidden bg-muted/50 sm:block", edge)} />
  return (
    <div className={cn("grid min-w-0 grid-cols-[2.75rem_1.25rem_1fr]", edge, change && s.tint, !change && side === "right" && "hidden sm:grid")}>
      <span aria-hidden className="pr-2 text-right text-muted-foreground/70 tabular-nums select-none">{cell.n}</span>
      <span aria-hidden className={cn("text-center select-none", s.fg)}>{change && s.sign}</span>
      <span className="pr-3 break-words whitespace-pre-wrap">
        {change && <span className="sr-only">{s.said}</span>}
        {cell.words ? cell.words.map((w, k) => (w.hit ? <mark key={k} className={cn("rounded-sm text-inherit", s.word)}>{w.text}</mark> : w.text)) : cell.text}
      </span>
    </div>
  )
}

// 3 unchanged lines around each change; a longer run folds into « ⋯ N lignes identiques », unfolded by a click
const CONTEXT = 3
function DiffView({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState<number[]>([])
  const near = rows.map(() => Infinity)
  for (let i = 0, last = -Infinity; i < rows.length; i++) { if (rows[i].change) last = i; near[i] = i - last }
  for (let i = rows.length - 1, last = Infinity; i >= 0; i--) { if (rows[i].change) last = i; near[i] = Math.min(near[i], last - i) }
  const line = (k: number) => <div key={k} className="grid min-h-5 sm:grid-cols-2"><Side cell={rows[k].left} side="left" change={rows[k].change} /><Side cell={rows[k].right} side="right" change={rows[k].change} /></div>
  const out: ReactNode[] = []
  for (let i = 0; i < rows.length; ) {
    let j = i
    while (j < rows.length && near[j] > CONTEXT) j++
    if (j === i) { out.push(line(i)); i++; continue }
    const at = i
    // one or two lines are shown rather than folded into a button nearly as tall
    if (j - i < 3 || open.includes(at)) for (let k = i; k < j; k++) out.push(line(k))
    else out.push(
      <button key={`fold-${at}`} type="button" onClick={() => setOpen(o => [...o, at])} className="w-full bg-muted/60 py-0.5 text-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        ⋯ {(j - i).toLocaleString("fr-FR")} lignes identiques
      </button>,
    )
    i = j
  }
  return (
    <div className="h-full overflow-auto rounded-md border font-mono text-xs leading-5">
      <div className="sticky top-0 z-10 hidden border-b bg-muted font-sans font-medium text-muted-foreground sm:grid sm:grid-cols-2">
        <div className="px-3 py-1.5">Note actuelle</div>
        <div className="border-l px-3 py-1.5">Après restauration</div>
      </div>
      {out}
    </div>
  )
}

// « Restaurer » from the history, in a modal nearly as large as the window: what the version takes away and puts back
// (DiffView), the version itself, and the button. Kept shown while the modal closes (`v`: the last version opened).
function RestoreDialog({ current, version, onClose, onRestore }: { current: string; version: Version | null; onClose: () => void; onRestore: () => Promise<void> }) {
  const [v, setV] = useState(version), [busy, setBusy] = useState(false)
  if (version && version !== v) setV(version)
  const rows = useMemo(() => (v ? sideBySide(current, v.notes ?? "") : []), [current, v])
  const del = rows.filter(x => x.change && x.left).length, add = rows.filter(x => x.change && x.right).length
  async function restore() {
    setBusy(true)
    try { await onRestore() } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!version} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="flex h-[90dvh] w-[95vw] max-w-[95vw] flex-col gap-4 overflow-hidden sm:max-w-[95vw]">
        {v && (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle>Restaurer la note d'avant cette modification</DialogTitle>
              <DialogDescription>
                Avant « {BY[v.by]} » du {dateTime(v.date)} ·{" "}
                <span className="font-medium text-[var(--diff-add-fg)] tabular-nums">+{add}</span> <span className="font-medium text-[var(--diff-del-fg)] tabular-nums">−{del}</span> lignes. La note actuelle restera dans l'historique.
              </DialogDescription>
            </DialogHeader>
            <Tabs defaultValue="diff" key={v.date} className="min-h-0 flex-1">
              <TabsList>
                <TabsTrigger value="diff"><DiffIcon />Changements</TabsTrigger>
                <TabsTrigger value="full"><FileTextIcon />Version complète</TabsTrigger>
              </TabsList>
              <TabsContent value="diff" className="min-h-0">
                {add + del ? <DiffView rows={rows} /> : <p className="rounded-md border px-3 py-2 text-muted-foreground">Cette version est identique à la note actuelle : rien à restaurer.</p>}
              </TabsContent>
              <TabsContent value="full" className="min-h-0">
                <Markdown text={v.notes ?? ""} className="h-full overflow-y-auto rounded-md border px-3 py-2" />
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost" size="sm" disabled={busy}>Annuler</Button></DialogClose>
              <Button size="sm" onClick={restore} disabled={busy || !(add + del)}>{busy ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}Restaurer cette version</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// What happened to the listing, newest first, quiet below the notes; each change of the notes can be undone: its
// icon opens RestoreDialog on the notes as they were before it
function FollowLog({ l, onRestore }: { l: Listing; onRestore?: (v: Version) => void }) {
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
            {c.version?.notes != null && onRestore && (
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-haspopup="dialog" aria-label="Restaurer la note d'avant" title="Restaurer la note d'avant" onClick={() => onRestore(c.version!)}><RotateCcwIcon /></Button>
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
    if (back?.notes == null) return
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
              {/* the block's header, room left for the close button */}
              <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
                <DialogTitle className="text-sm font-semibold">Suivi</DialogTitle>
                <DialogDescription className="sr-only">Les notes de {titleOf(l)}</DialogDescription>
                <Button size="xs" variant="outline" onClick={edit}><PencilIcon data-icon="inline-start" />Modifier</Button>
              </DialogHeader>
              <Markdown text={notes} onTick={tick} />
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
      <FollowLog l={l} onRestore={editing ? undefined : setBack} />
      <RestoreDialog current={notes} version={back} onClose={() => setBack(null)} onRestore={restore} />

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
