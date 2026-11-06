import { normalize } from "@engine/kinds.js"
import { ScanIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Icon } from "@/components/icon"
import { kindOf } from "@/components/shared-entities"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { fileUrl, type CaseIndex } from "@/lib/api"
import { t } from "@/lib/i18n"
import { fit, usePanZoom } from "@/lib/pan-zoom"
import type { TreeCase } from "@/lib/tree"

// of: the case a card comes from (its index: its note's title and kind)
type CNode = { id: string; type: "file" | "text" | "link" | "group"; file?: string; text?: string; label?: string; url?: string; x: number; y: number; width: number; height: number; of?: number }
type CEdge = { id: string; fromNode: string; toNode: string; label?: string; same?: boolean }
type Canvas = { nodes: CNode[]; edges: CEdge[] }
// where an edge leaves a box toward a point: the middle of the side that faces it
function side(n: CNode, tx: number, ty: number) {
  const cx = n.x + n.width / 2, cy = n.y + n.height / 2, dx = tx - cx, dy = ty - cy
  return Math.abs(dx) * n.height > Math.abs(dy) * n.width ? { x: cx + Math.sign(dx) * n.width / 2, y: cy } : { x: cx, y: cy + Math.sign(dy) * n.height / 2 }
}

// An investigation's canvases in rows, each case's in a frame with its name (rows about as wide as the whole is tall,
// so that Fit shows them all); a dashed line ties the cards of one entity found in several cases. Groups the vault's
// own canvas holds stay as they are.
const GAP = 160, PAD = 40
function merge(list: { c: TreeCase; canvas: Canvas | null }[], many: boolean): Canvas {
  if (!many) return list[0]?.canvas ?? { nodes: [], edges: [] }
  const nodes: CNode[] = [], edges: CEdge[] = [], first = new Map<string, string>()
  const boxes = list.map(({ canvas }) => {
    const ns = canvas?.nodes ?? [], x0 = ns.length ? Math.min(...ns.map(n => n.x)) : 0, y0 = ns.length ? Math.min(...ns.map(n => n.y)) : 0
    return { x0, y0, w: (ns.length ? Math.max(...ns.map(n => n.x + n.width)) - x0 : 320) + PAD * 2, h: (ns.length ? Math.max(...ns.map(n => n.y + n.height)) - y0 : 120) + PAD * 2 + 24 }
  })
  const row = Math.max(...boxes.map(b => b.w), Math.sqrt(boxes.reduce((a, b) => a + (b.w + GAP) * (b.h + GAP), 0)) * 1.6)
  let x = 0, y = 0, tall = 0
  list.forEach(({ c, canvas }, i) => {
    const { x0, y0, w, h } = boxes[i]
    if (x > 0 && x + w > row) { x = 0; y += tall + GAP; tall = 0 }
    tall = Math.max(tall, h)
    const ns = canvas?.nodes ?? []
    nodes.push({ id: `frame|${c.slug}`, type: "group", label: c.title, x, y, width: w, height: h, of: i })
    for (const n of ns) {
      const id = `${c.slug}|${n.id}`
      nodes.push({ ...n, id, x: n.x - x0 + x + PAD, y: n.y - y0 + y + PAD + 24, of: i })
      const note = n.type === "file" ? c.index.notes.find(m => m.path === n.file) : null
      if (note?.folder === "Entities") {
        const key = normalize(String(note.props.kind), note.props.value, note.props), had = first.get(key)
        if (had && !had.startsWith(`${c.slug}|`)) edges.push({ id: `same|${id}`, fromNode: had, toNode: id, same: true }); else if (!had) first.set(key, id)
      }
    }
    for (const e of canvas?.edges ?? []) edges.push({ ...e, id: `${c.slug}|${e.id}`, fromNode: `${c.slug}|${e.fromNode}`, toNode: `${c.slug}|${e.toNode}` })
    x += w + GAP
  })
  return { nodes, edges }
}

// Graph.canvas (JSON Canvas 1.0), read only: a file node is a card with its note's title and kind, a text node its
// text, an edge a line with its label; an investigation's cases each in their frame. Wheel to zoom, drag to move, a
// card opens its note in its case. Reloaded when one of them changes.
export function CanvasView({ cases, pulse, onOpen }: { cases: TreeCase[]; pulse: { path: string; n: number } | null; onOpen: (path: string, slug: string | null) => void }) {
  const [canvas, setCanvas] = useState<Canvas | null | "none">(null)
  const wrap = useRef<HTMLDivElement>(null), fitted = useRef(false)
  const { transform, setTransform } = usePanZoom(wrap, e => !!(e.target as Element).closest?.("[data-card]"))
  const n = pulse && (pulse.path.endsWith("Graph.canvas") || pulse.path === "*") ? pulse.n : 0
  const many = cases.length > 1, key = cases.map(c => c.slug).join(",")
  useEffect(() => {
    Promise.all(cases.map(c => fetch(fileUrl(c.slug, "Graph.canvas"), { cache: "no-store" }).then(r => (r.ok ? r.json() as Promise<Canvas> : null), () => null).then(canvas => ({ c, canvas }))))
      .then(list => setCanvas(list.some(x => x.canvas?.nodes.length) ? merge(list, many) : "none"))
  }, [key, n]) // eslint-disable-line react-hooks/exhaustive-deps
  const fitView = () => {
    const el = wrap.current
    if (!el || !canvas || canvas === "none" || !canvas.nodes.length) return
    const ns = canvas.nodes
    setTransform(fit({ x0: Math.min(...ns.map(x => x.x)), y0: Math.min(...ns.map(x => x.y)), x1: Math.max(...ns.map(x => x.x + x.width)), y1: Math.max(...ns.map(x => x.y + x.height)) }, el.clientWidth, el.clientHeight))
  }
  useLayoutEffect(() => { if (!fitted.current && canvas && canvas !== "none") { fitted.current = true; fitView() } })
  if (canvas === "none" || (canvas && !canvas.nodes.length)) return (
    <Empty className="my-4 border border-dashed"><EmptyHeader><EmptyTitle>{t("No canvas yet")}</EmptyTitle><EmptyDescription>{t("Graph.canvas fills as the case records entities and their relations.")}</EmptyDescription></EmptyHeader></Empty>
  )
  const byId = new Map((canvas?.nodes ?? []).map(x => [x.id, x]))
  const ixOf = (c: CNode): CaseIndex => cases[c.of ?? 0]?.index ?? cases[0].index
  const note = (c: CNode) => ixOf(c).notes.find(x => x.path === c.file)
  return (
    <div className="flex h-full min-h-[70vh] flex-col gap-3 py-4 lg:min-h-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon name="lock" className="size-3.5" aria-hidden />{t("Read only: edit it in Obsidian (Graph.canvas)")}
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={fitView}><ScanIcon data-icon="inline-start" />{t("Fit")}</Button>
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl bg-muted/30 ring-1 ring-foreground/10">
        <svg className="absolute inset-0 size-full" role="img" aria-label={t("Canvas of {n} cards", { n: canvas?.nodes.length ?? 0 })}>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {canvas?.nodes.filter(c => c.type === "group").map(c => (
              <g key={c.id} transform={`translate(${c.x} ${c.y})`}>
                <rect width={c.width} height={c.height} rx={14} className="fill-muted/40 stroke-border" strokeWidth={1.5} strokeDasharray={c.id.startsWith("frame|") ? undefined : "4 4"} />
                <text x={16} y={26} className="fill-muted-foreground text-[13px] font-semibold">{c.label}</text>
              </g>
            ))}
            {canvas?.edges.map(e => {
              const a = byId.get(e.fromNode), b = byId.get(e.toNode)
              if (!a || !b) return null
              const p = side(a, b.x + b.width / 2, b.y + b.height / 2), q = side(b, a.x + a.width / 2, a.y + a.height / 2)
              return (
                <g key={e.id}>
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="stroke-muted-foreground/50" strokeWidth={1.5} strokeDasharray={e.same ? "6 5" : undefined} />
                  {e.label && (
                    <g transform={`translate(${(p.x + q.x) / 2} ${(p.y + q.y) / 2})`}>
                      <rect x={-e.label.length * 3.4 - 6} y={-10} width={e.label.length * 6.8 + 12} height={20} rx={10} className="fill-background stroke-border" />
                      <text textAnchor="middle" dy="0.35em" className="fill-muted-foreground text-[11px]">{e.label}</text>
                    </g>
                  )}
                </g>
              )
            })}
            {canvas?.nodes.filter(c => c.type !== "group").map(c => {
              const meta = note(c), k = meta?.folder === "Entities" ? kindOf(String(meta.props.kind)) : null
              const title = c.type === "file" ? String(meta?.props.value ?? meta?.title ?? c.file ?? "") : c.type === "link" ? c.url ?? "" : c.label ?? c.text ?? ""
              const open = () => { if (c.type === "file" && c.file) onOpen(c.file, c.of ? cases[c.of].slug : null) }
              return (
                <g key={c.id} transform={`translate(${c.x} ${c.y})`} data-card={c.type === "file" ? "" : undefined} onClick={open} className={c.type === "file" ? "cursor-pointer" : undefined}
                  role={c.type === "file" ? "link" : undefined} tabIndex={c.type === "file" ? 0 : undefined} aria-label={c.type === "file" ? t("Open {title}", { title }) : undefined} onKeyDown={e => { if (e.key === "Enter") open() }}>
                  <rect width={c.width} height={c.height} rx={10} className="fill-card stroke-border hover:stroke-ring" strokeWidth={1.5} />
                  {c.type === "file" ? (
                    <>
                      <rect x={12} y={(c.height - 28) / 2} width={28} height={28} rx={7} fill={k?.color ?? "var(--muted-foreground)"} fillOpacity={0.18} />
                      <Icon name={k?.icon ?? "file-text"} x={18} y={(c.height - 16) / 2} width={16} height={16} color={k?.color ?? "var(--muted-foreground)"} />
                      <text x={50} y={c.height / 2} dy="-0.2em" className="fill-foreground text-[13px] font-medium">{title.length > 26 ? `${title.slice(0, 25)}…` : title}</text>
                      <text x={50} y={c.height / 2} dy="1.1em" className="fill-muted-foreground text-[11px]">{k?.label ?? meta?.folder ?? ""}</text>
                    </>
                  ) : (
                    <foreignObject x={10} y={8} width={c.width - 20} height={c.height - 16}><p className="line-clamp-4 text-xs text-foreground">{title}</p></foreignObject>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
        <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted-foreground">{t("Wheel to zoom · drag to move · click a card to open its note")}</p>
      </div>
    </div>
  )
}
