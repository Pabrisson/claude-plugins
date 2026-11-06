import { ScanIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Icon } from "@/components/icon"
import { kindOf } from "@/components/shared-entities"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { fileUrl, type CaseIndex } from "@/lib/api"
import { fit, usePanZoom } from "@/lib/pan-zoom"
import { caseHref, go } from "@/lib/route"

type CNode = { id: string; type: "file" | "text" | "link" | "group"; file?: string; text?: string; label?: string; url?: string; x: number; y: number; width: number; height: number }
type CEdge = { id: string; fromNode: string; toNode: string; label?: string }
type Canvas = { nodes: CNode[]; edges: CEdge[] }
// where an edge leaves a box toward a point: the middle of the side that faces it
function side(n: CNode, tx: number, ty: number) {
  const cx = n.x + n.width / 2, cy = n.y + n.height / 2, dx = tx - cx, dy = ty - cy
  return Math.abs(dx) * n.height > Math.abs(dy) * n.width ? { x: cx + Math.sign(dx) * n.width / 2, y: cy } : { x: cx, y: cy + Math.sign(dy) * n.height / 2 }
}

// Graph.canvas (JSON Canvas 1.0), read only: a file node is a card with its note's title and kind, a text node its
// text, an edge a line with its label. Wheel to zoom, drag to move, a card opens its note. Reloaded when it changes.
export function CanvasView({ index, pulse }: { index: CaseIndex; pulse: { path: string; n: number } | null }) {
  const [canvas, setCanvas] = useState<Canvas | null | "none">(null)
  const wrap = useRef<HTMLDivElement>(null), fitted = useRef(false)
  const { transform, setTransform } = usePanZoom(wrap, e => !!(e.target as Element).closest?.("[data-card]"))
  const n = pulse?.path === "Graph.canvas" || pulse?.path === "*" ? pulse.n : 0
  useEffect(() => {
    fetch(fileUrl(index.slug, "Graph.canvas"), { cache: "no-store" }).then(r => (r.ok ? r.json() : "none")).then(setCanvas, () => setCanvas("none"))
  }, [index.slug, n])
  const fitView = () => {
    const el = wrap.current
    if (!el || !canvas || canvas === "none" || !canvas.nodes.length) return
    const ns = canvas.nodes
    setTransform(fit({ x0: Math.min(...ns.map(x => x.x)), y0: Math.min(...ns.map(x => x.y)), x1: Math.max(...ns.map(x => x.x + x.width)), y1: Math.max(...ns.map(x => x.y + x.height)) }, el.clientWidth, el.clientHeight))
  }
  useLayoutEffect(() => { if (!fitted.current && canvas && canvas !== "none") { fitted.current = true; fitView() } })
  if (canvas === "none" || (canvas && !canvas.nodes.length)) return (
    <Empty className="my-4 border border-dashed"><EmptyHeader><EmptyTitle>No canvas yet</EmptyTitle><EmptyDescription>Graph.canvas fills as the case records entities and their relations.</EmptyDescription></EmptyHeader></Empty>
  )
  const byId = new Map((canvas?.nodes ?? []).map(x => [x.id, x]))
  const note = (f?: string) => index.notes.find(x => x.path === f)
  return (
    <div className="flex h-full min-h-[70vh] flex-col gap-3 py-4 lg:min-h-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon name="lock" className="size-3.5" aria-hidden />Read only: edit it in Obsidian (Graph.canvas)
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={fitView}><ScanIcon data-icon="inline-start" />Fit</Button>
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl bg-muted/30 ring-1 ring-foreground/10">
        <svg className="absolute inset-0 size-full" role="img" aria-label={`Canvas of ${canvas?.nodes.length ?? 0} cards`}>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {canvas?.edges.map(e => {
              const a = byId.get(e.fromNode), b = byId.get(e.toNode)
              if (!a || !b) return null
              const p = side(a, b.x + b.width / 2, b.y + b.height / 2), q = side(b, a.x + a.width / 2, a.y + a.height / 2)
              return (
                <g key={e.id}>
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="stroke-muted-foreground/50" strokeWidth={1.5} />
                  {e.label && (
                    <g transform={`translate(${(p.x + q.x) / 2} ${(p.y + q.y) / 2})`}>
                      <rect x={-e.label.length * 3.4 - 6} y={-10} width={e.label.length * 6.8 + 12} height={20} rx={10} className="fill-background stroke-border" />
                      <text textAnchor="middle" dy="0.35em" className="fill-muted-foreground text-[11px]">{e.label}</text>
                    </g>
                  )}
                </g>
              )
            })}
            {canvas?.nodes.map(c => {
              const meta = note(c.file), k = meta?.folder === "Entities" ? kindOf(String(meta.props.kind)) : null
              const title = c.type === "file" ? String(meta?.props.value ?? meta?.title ?? c.file ?? "") : c.type === "link" ? c.url ?? "" : c.label ?? c.text ?? ""
              const open = () => { if (c.type === "file" && c.file) go(caseHref(index.slug, "brain", c.file)) }
              return (
                <g key={c.id} transform={`translate(${c.x} ${c.y})`} data-card={c.type === "file" ? "" : undefined} onClick={open} className={c.type === "file" ? "cursor-pointer" : undefined}
                  role={c.type === "file" ? "link" : undefined} tabIndex={c.type === "file" ? 0 : undefined} aria-label={c.type === "file" ? `Open ${title}` : undefined} onKeyDown={e => { if (e.key === "Enter") open() }}>
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
        <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted-foreground">Wheel to zoom · drag to move · click a card to open its note</p>
      </div>
    </div>
  )
}
