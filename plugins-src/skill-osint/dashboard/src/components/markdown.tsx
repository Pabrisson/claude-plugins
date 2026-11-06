import { calloutOf, parseTarget, preprocess } from "@engine/obsidian-md.js"
import { useEffect, useState, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { Icon } from "@/components/icon"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { api, fileUrl } from "@/lib/api"
import { slugOf } from "@/lib/format"
import { t } from "@/lib/i18n"
import { caseHref } from "@/lib/route"
import { cn } from "@/lib/utils"

// Obsidian's resolution (lib/brain.js `resolver`): a path from the vault's root, with or without .md, else the first
// file of that name
export function resolveNote(files: string[], target: string): string | null {
  if (!target) return null
  const t = target.replace(/\\/g, "/").toLowerCase(), base = (s: string) => s.slice(s.lastIndexOf("/") + 1)
  const byPath = (x: string) => files.find(f => f.toLowerCase() === x || f.toLowerCase().replace(/\.md$/, "") === x)
  return byPath(t) ?? byPath(`${t}.md`) ?? files.find(f => { const b = base(f.toLowerCase()); return b === base(t) || b.replace(/\.md$/, "") === base(t) }) ?? null
}
// the plain text of rendered children (a heading's anchor)
const textOf = (n: ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(textOf).join("") : n && typeof n === "object" && "props" in n ? textOf((n.props as { children?: ReactNode }).children) : "")
const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg)$/i
const CALLOUT: Record<string, { icon: string; tone: string }> = {
  note: { icon: "info", tone: "bg-sky-500/10 [&_.co-icon]:text-sky-600 dark:[&_.co-icon]:text-sky-400" },
  info: { icon: "info", tone: "bg-sky-500/10 [&_.co-icon]:text-sky-600 dark:[&_.co-icon]:text-sky-400" },
  tip: { icon: "lightbulb", tone: "bg-emerald-500/10 [&_.co-icon]:text-emerald-600 dark:[&_.co-icon]:text-emerald-400" },
  warning: { icon: "triangle-alert", tone: "bg-amber-500/10 [&_.co-icon]:text-amber-600 dark:[&_.co-icon]:text-amber-400" },
  danger: { icon: "octagon-x", tone: "bg-rose-500/10 [&_.co-icon]:text-rose-600 dark:[&_.co-icon]:text-rose-400" },
  error: { icon: "octagon-x", tone: "bg-rose-500/10 [&_.co-icon]:text-rose-600 dark:[&_.co-icon]:text-rose-400" },
  question: { icon: "circle-help", tone: "bg-violet-500/10 [&_.co-icon]:text-violet-600 dark:[&_.co-icon]:text-violet-400" },
  quote: { icon: "quote", tone: "bg-muted" },
}
// only the links a note may carry: the vault's (obsidian:, embed:), the web, mail, the block anchors; never javascript:
const urlTransform = (u: string) => (/^(obsidian:|embed:|#\^|obsidian:\/\/)/.test(u) ? u : defaultUrlTransform(u))

type Props = { text: string; slug: string; files: string[]; onOpen: (path: string, anchor?: string | null) => void; depth?: number; inline?: boolean; className?: string }
// A note's body as Obsidian shows it: wikilinks that open the note (a Journal reference scrolls to its line), embedded
// images and notes (one level), callouts with their icon (the color in the box, never on its edge), block anchors
export function Markdown({ text, slug, files, onOpen, depth = 0, inline, className }: Props) {
  const src = preprocess(text)
  const components: Components = {
    a({ href = "", children }) {
      // [](#^j042): the anchor of a block (the Markdown parser encodes the caret)
      if (/^#(\^|%5E)/i.test(href) && !textOf(children)) return <span id={`block-${href.replace(/^#(\^|%5E)/i, "")}`} />
      const tg = parseTarget(href)
      if (tg?.kind === "obsidian") {
        const path = tg.target ? resolveNote(files, tg.target) : null
        if (!path && tg.target) return <span className="text-muted-foreground underline decoration-dotted" title={t("No such note in this case")}>{children}</span>
        return <a href={caseHref(slug, "brain", `${path ?? ""}${tg.anchor ? `#${tg.anchor}` : ""}`)} onClick={e => { e.preventDefault(); onOpen(path ?? "", tg.anchor) }} className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">{children}</a>
      }
      const vault = /^obsidian:\/\/open\?vault=([^&]+)/.exec(href)?.[1]
      if (vault) return <span className="inline-flex items-center gap-1"><a href={caseHref(decodeURIComponent(vault))} className="text-primary underline underline-offset-2">{children}</a><a href={href} title={t("Open in Obsidian")} className="text-muted-foreground hover:text-foreground"><Icon name="gem" className="size-3" /></a></span>
      return <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{children}<Icon name="external-link" className="ml-0.5 inline size-3 align-baseline opacity-60" aria-hidden /></a>
    },
    img({ src: s = "", alt }) {
      const tg = parseTarget(String(s))
      // an image from the web is never fetched by the dashboard (it would contact its host, maybe the target): a link
      if (tg?.kind !== "embed") return <a href={String(s)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2"><Icon name="image" className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />{alt || String(s)}</a>
      const path = resolveNote(files, tg.target)
      if (!path) return <span className="text-muted-foreground">{t("{embed} not found", { embed: `![[${tg.target}]]` })}</span>
      if (IMAGE.test(path)) return <Zoom src={fileUrl(slug, path)} alt={alt ?? path} />
      if (path.endsWith(".md") && depth < 1) return <Embed slug={slug} path={path} files={files} onOpen={onOpen} />
      return <a href={caseHref(slug, "brain", path)} onClick={e => { e.preventDefault(); onOpen(path) }} className="text-primary underline">{path}</a>
    },
    blockquote({ node, children }) {
      const raw = node?.position ? src.slice(node.position.start.offset, node.position.end.offset).replace(/^[ \t]*> ?/gm, "") : ""
      const c = calloutOf(raw)
      if (!c) return <blockquote>{children}</blockquote>
      const look = CALLOUT[c.type] ?? { icon: "sticky-note", tone: "bg-muted" }
      return (
        <div className={cn("rounded-lg px-3 py-2.5", look.tone)} role="note">
          <p className="flex items-center gap-2 font-medium"><Icon name={look.icon} className="co-icon size-4 shrink-0" aria-hidden />{c.title}</p>
          <Markdown text={raw.split("\n").slice(1).join("\n")} slug={slug} files={files} onOpen={onOpen} depth={depth} className="mt-1.5" />
        </div>
      )
    },
    table: ({ children }) => <div className="overflow-x-auto rounded-md ring-1 ring-foreground/10"><table>{children}</table></div>,
    h1: ({ children }) => <h1 id={slugOf(textOf(children))}>{children}</h1>,
    h2: ({ children }) => <h2 id={slugOf(textOf(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={slugOf(textOf(children))}>{children}</h3>,
    input: ({ checked, type }) => <input type={type} checked={!!checked} readOnly disabled />,
    ...(inline && { p: ({ children }) => <>{children}</> }),
  }
  if (inline) return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>{src}</ReactMarkdown>
  return <div className={cn("md", className)}><ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>{src}</ReactMarkdown></div>
}

// ![[Note]]: its body, indented, one level deep
function Embed({ slug, path, files, onOpen }: { slug: string; path: string; files: string[]; onOpen: Props["onOpen"] }) {
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => { api.note(slug, path).then(n => setBody(n.body), () => setBody("")) }, [slug, path])
  return (
    <span className="my-2 block rounded-md bg-muted/40 px-3 py-2 ring-1 ring-foreground/10">
      <a href={caseHref(slug, "brain", path)} onClick={e => { e.preventDefault(); onOpen(path) }} className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Icon name="file-text" className="size-3" />{path}</a>
      {body != null && <Markdown text={body} slug={slug} files={files} onOpen={onOpen} depth={1} />}
    </span>
  )
}
// an image in a note: a click shows it full size
export function Zoom({ src, alt, children }: { src: string; alt: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="cursor-zoom-in rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={t("Show {alt} full size", { alt })}>
        {children ?? <img src={src} alt={alt} loading="lazy" className="max-h-96 rounded-md" />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(96vw,1400px)] p-2 sm:max-w-[min(96vw,1400px)]">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img src={src} alt={alt} className="max-h-[85vh] w-full rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}
