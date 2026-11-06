import { normalize } from "@engine/kinds.js"
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force"
import { ScanIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Chips } from "@/components/chips"
import { kindOf } from "@/components/shared-entities"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { fit, usePanZoom } from "@/lib/pan-zoom"
import type { TreeCase } from "@/lib/tree"

// of: the cases a node is in (an entity found in several is one node); open: the note a click opens, in its case
type N = SimulationNodeDatum & { id: string; label: string; group: string; color: string; r: number; caseLink?: boolean; of: string[]; open: { slug: string | null; path: string } }
type L = SimulationLinkDatum<N> & { source: N | string; target: N | string }
// the notes that are not entities: one neutral tone per folder (CSS variables, read at draw time: they follow the theme)
const FOLDER: Record<string, { label: string; icon: string; color: string }> = {
  "": { label: "Case notes", icon: "file-text", color: "--foreground" },
  Clues: { label: "Clues", icon: "search", color: "--muted-foreground" },
  Hypotheses: { label: "Hypotheses", icon: "lightbulb", color: "--chart-5" },
  Sources: { label: "Sources", icon: "library", color: "--ring" },
  cases: { label: "Cases", icon: "folder-tree", color: "--chart-2" },
}
const css = (v: string) => (v.startsWith("--") ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888" : v)

// The investigation's notes as one graph (wikilinks), d3-force on a canvas: a node's color is its entity kind, or its
// folder's tone; an entity found in several cases is one node; each case of an investigation is a square (its
// Case.md) tied to the case above it. Drag a node, wheel to zoom, drag the background to move; a click opens the note
// in Brain, in its case. Nodes already placed keep their place when the index changes.
export function GraphView({ cases, onOpen }: { cases: TreeCase[]; onOpen: (path: string, slug: string | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Simulation<N, L> | null>(null), nodes = useRef(new Map<string, N>()), links = useRef<L[]>([])
  const hover = useRef<N | null>(null), dragging = useRef<N | null>(null), fitted = useRef(false)
  const [hidden, setHidden] = useState<string[]>([]), [hiddenCases, setHiddenCases] = useState<string[]>([])
  const hiddenRef = useRef({ groups: hidden, cases: hiddenCases })
  useEffect(() => { hiddenRef.current = { groups: hidden, cases: hiddenCases } })
  const visible = (n: N) => !hiddenRef.current.groups.includes(n.group) && n.of.some(c => !hiddenRef.current.cases.includes(c))
  const toWorld = (e: { clientX: number; clientY: number }) => { const r = cv.current!.getBoundingClientRect(), t = tf.current; return { x: (e.clientX - r.left - t.x) / t.k, y: (e.clientY - r.top - t.y) / t.k } }
  const hit = (e: { clientX: number; clientY: number }) => { const p = toWorld(e); let best: N | null = null; for (const n of nodes.current.values()) if (visible(n) && Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y) <= n.r + 4) best = n; return best }
  const { transform, setTransform } = usePanZoom(wrap, e => !!hit(e))
  const open = useRef(onOpen)
  useEffect(() => { open.current = onOpen })
  const tf = useRef(transform)
  useEffect(() => { tf.current = transform; draw() })

  // the graph's data from the indexes: every case's notes (an entity by its normalized key, once), their resolved
  // links (one per pair), each sub-case's Case.md tied to its parent's
  const data = useMemo(() => {
    const byId = new Map<string, Omit<N, "x" | "y">>(), es = new Map<string, [string, string]>(), deg = new Map<string, number>(), many = cases.length > 1
    const edge = (a: string, b: string) => { if (a === b) return; const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (!es.has(k)) { es.set(k, [a, b]); deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1) } }
    const idOf = new Map<string, string>() // « <slug>|<path> » → node id
    for (const [i, c] of cases.entries()) {
      for (const n of c.index.notes) {
        const entity = n.folder === "Entities", k = entity ? kindOf(String(n.props.kind)) : null, home = many && n.path === "Case.md"
        const id = entity ? `ent:${normalize(String(n.props.kind), n.props.value, n.props)}` : `${c.slug}|${n.path}`
        idOf.set(`${c.slug}|${n.path}`, id)
        const had = byId.get(id)
        if (had) { if (!had.of.includes(c.slug)) had.of.push(c.slug); continue }
        byId.set(id, { id, label: home ? c.title : entity ? String(n.props.value ?? n.title) : n.title, group: home ? "cases" : entity ? `kind:${n.props.kind}` : n.folder in FOLDER ? n.folder : "", color: home ? FOLDER.cases.color : k ? k.color : FOLDER[n.folder in FOLDER ? n.folder : ""].color, r: 0, caseLink: home, of: [c.slug], open: { slug: i ? c.slug : null, path: n.path } })
      }
    }
    for (const c of cases) {
      for (const n of c.index.notes) for (const l of n.links) { const b = l.path && idOf.get(`${c.slug}|${l.path}`); if (b) edge(idOf.get(`${c.slug}|${n.path}`)!, b) }
      if (c.parent) edge(`${c.slug}|Case.md`, `${c.parent}|Case.md`)
    }
    const ns = [...byId.values()]
    for (const n of ns) n.r = 4 + Math.sqrt(deg.get(n.id) ?? 0) * 2.2
    return { ns, es: [...es.values()].filter(([a, b]) => byId.has(a) && byId.has(b)) }
  }, [cases])

  useEffect(() => {
    const old = nodes.current, next = new Map<string, N>()
    for (const d of data.ns) {
      const prev = old.get(d.id)
      if (prev) { next.set(d.id, Object.assign(prev, d)); continue }
      // a new node enters beside a neighbor already placed
      const nb = data.es.map(([a, b]) => (a === d.id ? b : b === d.id ? a : null)).map(x => (x ? old.get(x) : undefined)).find(Boolean)
      next.set(d.id, { ...d, x: (nb?.x ?? 0) + (Math.random() - 0.5) * 30, y: (nb?.y ?? 0) + (Math.random() - 0.5) * 30 })
    }
    nodes.current = next
    links.current = data.es.map(([a, b]) => ({ source: a, target: b }))
    if (!sim.current) sim.current = forceSimulation<N, L>().force("charge", forceManyBody().strength(-120)).force("center", forceCenter(0, 0)).force("collide", forceCollide<N>(14))
      // a weak pull to the middle: a note linked to nothing stays in view
      .force("x", forceX<N>(0).strength(0.06)).force("y", forceY<N>(0).strength(0.06)).on("tick", () => draw())
    sim.current.nodes([...next.values()]).force("link", forceLink<N, L>(links.current).id(n => n.id).distance(60))
    // the first layout is computed at once and fitted; later changes move gently from where the nodes are
    if (!fitted.current) { sim.current.stop().alpha(1).tick(300); fitView(); draw() } else sim.current.alpha(0.3).restart()
    return undefined
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { sim.current?.stop() }, [])

  function fitView() {
    const el = wrap.current, ns = [...nodes.current.values()]
    if (!el || !ns.length) return
    fitted.current = true
    const xs = ns.map(n => n.x ?? 0), ys = ns.map(n => n.y ?? 0)
    // the labels of the linked cases stick out of the nodes: some room on each side
    setTransform(fit({ x0: Math.min(...xs) - 70, y0: Math.min(...ys), x1: Math.max(...xs) + 70, y1: Math.max(...ys) + 20 }, el.clientWidth, el.clientHeight))
  }
  function draw() {
    const c = cv.current, el = wrap.current
    if (!c || !el) return
    const dpr = devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = `${w}px`; c.style.height = `${h}px` }
    const g = c.getContext("2d")!, t = tf.current, hv = hover.current
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
    g.translate(t.x, t.y); g.scale(t.k, t.k)
    const shown = visible
    const near = new Set<string>()
    if (hv) for (const l of links.current) { const a = l.source as N, b = l.target as N; if (a.id === hv.id) near.add(b.id); if (b.id === hv.id) near.add(a.id) }
    g.lineWidth = 1 / t.k
    g.strokeStyle = css("--border")
    for (const l of links.current) {
      const a = l.source as N, b = l.target as N
      if (!shown(a) || !shown(b)) continue
      g.globalAlpha = hv && a.id !== hv.id && b.id !== hv.id ? 0.25 : 1
      g.strokeStyle = hv && (a.id === hv.id || b.id === hv.id) ? css("--muted-foreground") : css("--border")
      g.beginPath(); g.moveTo(a.x ?? 0, a.y ?? 0); g.lineTo(b.x ?? 0, b.y ?? 0); g.stroke()
    }
    const surface = css("--background"), ink = css("--foreground")
    for (const n of nodes.current.values()) {
      if (!shown(n)) continue
      g.globalAlpha = hv && n !== hv && !near.has(n.id) ? 0.35 : 1
      g.fillStyle = css(n.color); g.strokeStyle = surface; g.lineWidth = 2 / t.k
      g.beginPath()
      if (n.caseLink) g.rect((n.x ?? 0) - n.r, (n.y ?? 0) - n.r, n.r * 2, n.r * 2); else g.arc(n.x ?? 0, n.y ?? 0, n.r, 0, Math.PI * 2)
      g.fill(); g.stroke()
    }
    g.globalAlpha = 1
    g.font = `${12 / t.k}px Inter Variable, sans-serif`; g.textAlign = "center"; g.textBaseline = "top"
    for (const n of nodes.current.values()) {
      if (!shown(n) || !(n === hv || near.has(n.id) || t.k > 1.6 || n.r > 12 || n.caseLink)) continue
      const label = n.label.length > 40 ? `${n.label.slice(0, 39)}…` : n.label
      g.lineWidth = 3 / t.k; g.strokeStyle = surface; g.strokeText(label, n.x ?? 0, (n.y ?? 0) + n.r + 3 / t.k)
      g.fillStyle = ink; g.fillText(label, n.x ?? 0, (n.y ?? 0) + n.r + 3 / t.k)
    }
  }

  // a node: dragged (pinned while held), hovered (its label and neighbors), clicked (opens)
  useEffect(() => {
    const c = cv.current
    if (!c) return
    let moved = false, start: N | null = null
    const down = (e: PointerEvent) => { const n = hit(e); if (!n) return; start = n; moved = false; dragging.current = n; c.setPointerCapture(e.pointerId); n.fx = n.x; n.fy = n.y; sim.current?.alphaTarget(0.2).restart() }
    const move = (e: PointerEvent) => {
      const d = dragging.current
      if (d) { const p = toWorld(e); d.fx = p.x; d.fy = p.y; moved = true; return }
      const n = hit(e)
      if (n !== hover.current) { hover.current = n; c.style.cursor = n ? "pointer" : ""; draw() }
    }
    const up = () => {
      const d = dragging.current
      if (!d) return
      dragging.current = null; d.fx = null; d.fy = null; sim.current?.alphaTarget(0)
      if (!moved && start) open.current(start.open.path, start.open.slug)
    }
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move); c.addEventListener("pointerup", up)
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const ro = new ResizeObserver(() => draw()); if (wrap.current) ro.observe(wrap.current); return () => ro.disconnect() })

  const groups = [...new Set(data.ns.map(n => n.group))].sort()
  const legend = groups.map(gid => {
    if (gid.startsWith("kind:")) { const k = kindOf(gid.slice(5)); return { value: gid, label: k.label, icon: k.icon, count: data.ns.filter(n => n.group === gid).length } }
    const f = FOLDER[gid] ?? FOLDER[""]
    return { value: gid, label: t(f.label), icon: f.icon, count: data.ns.filter(n => n.group === gid).length }
  })
  return (
    <div className="flex h-full min-h-[70vh] flex-col gap-3 py-4 lg:min-h-0">
      <div className="flex flex-wrap items-center gap-2">
        <Chips multiple size="xs" label={t("Shown in the graph")} value={groups.filter(x => !hidden.includes(x))} onChange={v => setHidden(groups.filter(x => !v.includes(x)))} options={legend} />
        {cases.length > 1 && <Chips multiple size="xs" label={t("Cases in the graph")} value={cases.map(c => c.slug).filter(x => !hiddenCases.includes(x))} onChange={v => setHiddenCases(cases.map(c => c.slug).filter(x => !v.includes(x)))} options={cases.map(c => ({ value: c.slug, label: c.title, icon: "folder-tree", count: data.ns.filter(n => n.of.includes(c.slug)).length }))} />}
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={fitView}><ScanIcon data-icon="inline-start" />{t("Fit")}</Button>
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl bg-muted/30 ring-1 ring-foreground/10" role="img" aria-label={t("Graph of {n} notes and {m} links", { n: data.ns.length, m: data.es.length })}>
        <canvas ref={cv} className="absolute inset-0" />
        <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted-foreground">{t("Wheel to zoom · drag to move · click a node to open it")}</p>
      </div>
    </div>
  )
}
