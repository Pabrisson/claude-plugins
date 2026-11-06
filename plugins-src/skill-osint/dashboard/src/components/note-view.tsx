import { ExternalLinkIcon } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { Icon } from "@/components/icon"
import { Markdown, Zoom } from "@/components/markdown"
import { kindOf } from "@/components/shared-entities"
import { Skeleton } from "@/components/ui/skeleton"
import { api, fileUrl, type CaseIndex, type Note } from "@/lib/api"
import { slugOf } from "@/lib/format"

const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg)$/i
type Open = (path: string, anchor?: string | null) => void

// a captured page or a recorded answer, as text (JSON indented); never rendered, so nothing of it runs or loads
function Source({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { fetch(url).then(r => r.text()).then(t => { try { setText(JSON.stringify(JSON.parse(t), null, 2)) } catch { setText(t) } }, () => setText("")) }, [url])
  if (text == null) return <Skeleton className="h-64" />
  return <pre className="max-h-[70vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{text.length > 200_000 ? `${text.slice(0, 200_000)}\n…` : text}</pre>
}

// A property's value as Obsidian shows it: a wikilink is a link, a list one item per line, a URL a link
function PropValue({ v, slug, files, onOpen }: { v: unknown; slug: string; files: string[]; onOpen: Open }): ReactNode {
  if (v == null || v === "") return <span className="text-muted-foreground">—</span>
  if (Array.isArray(v)) return v.length ? <span className="flex flex-col gap-0.5">{v.map((x, i) => <span key={i}><PropValue v={x} slug={slug} files={files} onOpen={onOpen} /></span>)}</span> : <span className="text-muted-foreground">—</span>
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "object") return <code className="text-xs">{JSON.stringify(v)}</code>
  const s = String(v)
  if (s.includes("[[")) return <Markdown text={s} slug={slug} files={files} onOpen={onOpen} inline />
  if (/^https?:\/\/\S+$/.test(s)) return <a href={s} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">{s}</a>
  return <span className="break-words">{s}</span>
}

// The open note: its properties in a table, then its body. It reloads in place when its file changes (pulse), the
// scroll position kept; a Journal reference scrolls to its line. A file of Evidence shows as itself (an HTML capture in
// a sandbox: no script of a captured page ever runs here). Keyed by its path: another note starts from a blank state;
// the column that scrolls it carries data-note-scroller.
export function NoteView({ slug, path, anchor, index, pulse, onOpen, extra }: {
  slug: string; path: string; anchor: string | null; index: CaseIndex; pulse: { path: string; n: number } | null; onOpen: Open
  extra?: (note: Note) => ReactNode
}) {
  const [note, setNote] = useState<Note | null>(null)
  const [error, setError] = useState<string | null>(null)
  const saved = useRef<{ top: number; win: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const scroller = () => root.current?.closest<HTMLElement>("[data-note-scroller]") ?? null
  const isNote = path.endsWith(".md")
  const load = useCallback((keep: boolean) => {
    if (!isNote) return
    api.note(slug, path).then(n => {
      // read where the reader is before the text changes, put it back once drawn
      if (keep) saved.current = { top: root.current?.closest<HTMLElement>("[data-note-scroller]")?.scrollTop ?? 0, win: window.scrollY }
      setNote(n); setError(null)
    }, (e: Error) => setError(e.message))
  }, [slug, path, isNote])
  useEffect(() => { load(false) }, [load])
  const last = useRef(0)
  useEffect(() => {
    if (!pulse || pulse.n === last.current) return
    last.current = pulse.n
    if (pulse.path === path || pulse.path === "*") load(true)
  }, [pulse, path, load])
  useLayoutEffect(() => {
    if (!saved.current) return
    const el = scroller()
    if (el) el.scrollTop = saved.current.top
    window.scrollTo(0, saved.current.win)
    saved.current = null
  })
  // a reference to a block (^j042) or a heading: there, once the note is drawn
  const anchored = useRef<string | null>(null)
  useEffect(() => {
    const key = `${path}#${anchor}`
    if (!note || !anchor || anchored.current === key) return
    anchored.current = key
    const el = document.getElementById(anchor.startsWith("^") ? `block-${anchor.slice(1)}` : slugOf(anchor))
    if (!el) return
    el.scrollIntoView({ block: "center" })
    const line = el.closest("li, p, tr, h1, h2, h3") ?? el
    line.classList.remove("block-flash"); void (line as HTMLElement).offsetWidth; line.classList.add("block-flash")
  }, [note, anchor, path])

  return <div ref={root}>{body()}</div>
  function body() {
  if (!isNote) {
    const ev = index.evidence.find(e => e.file === path)
    return (
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold break-all"><Icon name="file" className="size-4 shrink-0" />{path}</h1>
        {ev && <p className="font-mono text-xs break-all text-muted-foreground">{ev.id} · SHA-256 {ev.sha256}</p>}
        {IMAGE.test(path) ? <Zoom src={fileUrl(slug, path)} alt={path} />
          : /\.(html?|json|txt|md|csv|xml)$/i.test(path) ? <Source url={fileUrl(slug, path)} />
          : <a href={fileUrl(slug, path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">Open the file<ExternalLinkIcon className="size-3.5" /></a>}
      </div>
    )
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!note) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
  const props = Object.entries(note.props).filter(([k]) => k !== "tags")
  // its title on top, as Obsidian shows it, then the properties, then the rest of the body
  const h1 = /^\s*# (.+)\r?\n?/.exec(note.body), title = h1?.[1].trim() ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "")
  const kind = path.startsWith("Entities/") ? kindOf(String(note.props.kind)) : null
  return (
    <article className="flex flex-col gap-5">
      <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        {kind && <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-sans font-medium" style={{ color: kind.color, background: `color-mix(in oklch, ${kind.color} 15%, transparent)` }}><Icon name={kind.icon} className="size-3" aria-hidden />{kind.label}</span>}
        <span className="truncate">{path}</span>
      </p>
      <h1 className="-mt-2 text-2xl font-semibold tracking-tight break-words">{title}</h1>
      {props.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">Properties</caption>
          <tbody>
            {props.map(([k, v]) => (
              <tr key={k} className="border-b border-border/60 last:border-0">
                <th scope="row" className="w-36 py-1.5 pr-3 text-left align-top font-normal text-muted-foreground">{k}</th>
                <td className="py-1.5 align-top"><PropValue v={v} slug={slug} files={index.files} onOpen={onOpen} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {extra?.(note)}
      <Markdown text={h1 ? note.body.slice(h1[0].length) : note.body} slug={slug} files={index.files} onOpen={onOpen} />
    </article>
  )
  }
}
