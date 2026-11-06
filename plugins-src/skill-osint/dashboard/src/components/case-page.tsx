import { CommandIcon, PanelLeftIcon, SearchIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { BrainTree } from "@/components/brain-tree"
import { CanvasView } from "@/components/canvas-view"
import { CaseHeader } from "@/components/case-header"
import { Chips } from "@/components/chips"
import { GraphView } from "@/components/graph-view"
import { NextActions } from "@/components/next-actions"
import { NoteView } from "@/components/note-view"
import { useObsidian } from "@/components/obsidian-button"
import { Palette } from "@/components/palette"
import { PivotButtons } from "@/components/pivot-buttons"
import { SidePanel } from "@/components/side-panel"
import { TopBar } from "@/components/top-bar"
import { Widget } from "@/components/widgets"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Manifest, type View } from "@/lib/api"
import { useBasket } from "@/lib/basket"
import { typeColor } from "@/lib/colors"
import { slugOf, useNow } from "@/lib/format"
import { runRefresh } from "@/lib/refresh"
import { caseHref, go } from "@/lib/route"
import { useCase } from "@/lib/use-case"
import { getLang, own, t, type Lang } from "@/lib/i18n"

// fetched once per language (the labels come translated)
const typesP: Partial<Record<Lang, Promise<Manifest[]>>> = {}
export function useTypes() {
  const [types, setTypes] = useState<Manifest[] | null>(null)
  useEffect(() => { (typesP[getLang()] ??= api.types().catch(() => [])).then(setTypes) }, [])
  return types
}
export const WIDGET_ICON: Record<string, string> = { hypotheses: "scale", sources: "library", timeline: "calendar-range", table: "table", map: "map", evidence: "images", calibration: "target" }
// a view's tab: its widget, with « -<label> » when the widget comes back (table-subdomains, table-dns)
export function viewTabs(m: Manifest | undefined) {
  const views = m?.views ?? [], n = (w: string) => views.filter(v => v.widget === w).length
  return views.map(v => ({ id: n(v.widget) > 1 ? `${v.widget}-${slugOf(v.label ?? v.widget)}` : v.widget, view: v, icon: v.icon ?? WIDGET_ICON[v.widget] ?? "layout-grid", label: v.label ? own(m, v.label) : t(v.widget[0].toUpperCase() + v.widget.slice(1)) }))
}
export type ViewTab = { id: string; view: View; icon: string; label: string }

// A case's page: its head, its tabs (Brain, Graph, Canvas, then the type's views), live
export function CasePage({ slug, tab, note }: { slug: string; tab: string; note: string | null }) {
  const { index, events, error, notePulse, views } = useCase(slug)
  const types = useTypes(), now = useNow()
  const m = types?.find(t => t.id === index?.type)
  const { add } = useBasket()
  const obsidian = useObsidian()
  const [palette, setPalette] = useState(false), [tree, setTree] = useState(false), [next, setNext] = useState(false), [refreshing, setRefreshing] = useState(false)
  useEffect(() => { api.seen(slug).catch(() => {}) }, [slug])
  const [path, anchor] = useMemo(() => { const n = note ?? "Case.md", i = n.indexOf("#"); return i < 0 ? [n, null] : [n.slice(0, i), n.slice(i + 1)] }, [note])
  // the notes written during this visit and not opened since: a dot in the tree
  const [opened] = useState(() => new Date().toISOString())
  const [read, setRead] = useState<Record<string, string>>({})
  const fresh = useMemo(() => new Set(events.filter(e => e.kind === "note.write" && e.path?.endsWith(".md") && !e.deleted && e.path !== path && e.t > opened && e.t > (read[e.path] ?? "")).map(e => e.path!)), [events, read, path, opened])
  // the note being left counts as read up to now
  const openNote = (p: string, a?: string | null) => {
    setTree(false); setRead(r => ({ ...r, [path]: new Date().toISOString() }))
    go(caseHref(slug, "brain", `${p || path}${a ? `#${a}` : ""}`))
  }
  const refresh = async () => { setRefreshing(true); await runRefresh(slug, add, m?.private); setRefreshing(false) }

  if (error && !index) return (
    <>
      <TopBar />
      <Empty className="m-6 border border-dashed">
        <EmptyHeader><EmptyTitle>{t("No case {slug}", { slug })}</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader>
        <Button asChild variant="outline"><a href="#/">{t("All cases")}</a></Button>
      </Empty>
    </>
  )
  if (!index || !types) return <><TopBar /><div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4"><Skeleton className="h-20" /><Skeleton className="h-[60vh]" /></div></>
  const tabs = [{ id: "brain", icon: "brain", label: t("Brain") }, { id: "graph", icon: "share-2", label: t("Graph") }, { id: "canvas", icon: "layout-dashboard", label: t("Canvas") }, ...(m ? viewTabs(m) : [])]
  const current = tabs.find(t => t.id === tab) ? tab : "brain"
  return (
    <div className="flex flex-col lg:h-dvh">
      <TopBar>
        <Button variant="outline" size="sm" className="ml-2 hidden w-56 justify-start text-muted-foreground md:inline-flex" onClick={() => setPalette(true)}>
          <SearchIcon data-icon="inline-start" />{t("Search this case")}<kbd className="ml-auto inline-flex items-center gap-0.5 font-mono text-[10px]"><CommandIcon className="size-3" />K</kbd>
        </Button>
      </TopBar>
      <div className="border-b">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3">
          <CaseHeader index={index} m={m} color={typeColor(index.type, types)} now={now} onRefresh={refresh} refreshing={refreshing} onNext={() => setNext(true)} />
          <Chips label={t("Views")} size="xs" value={current} onChange={t => go(caseHref(slug, t, t === "brain" ? note ?? undefined : undefined))} options={tabs.map(t => ({ value: t.id, label: t.label, icon: t.icon }))} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1600px] px-4 lg:min-h-0 lg:flex-1">
        {current === "brain" ? (
          <div className="grid grid-cols-[minmax(0,1fr)] lg:h-full lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
            <aside className="hidden overflow-y-auto py-4 pr-3 lg:block"><BrainTree index={index} open={path} fresh={fresh} onOpen={p => openNote(p)} /></aside>
            <div data-note-scroller className="min-w-0 py-4 lg:overflow-y-auto lg:border-x lg:px-6">
              <Button variant="outline" size="sm" className="mb-3 lg:hidden" onClick={() => setTree(true)}><PanelLeftIcon data-icon="inline-start" />{t("Notes")}</Button>
              <NoteView key={path} slug={slug} path={path} anchor={anchor} index={index} pulse={notePulse} onOpen={openNote}
                extra={n => (path.startsWith("Entities/") && n.props.kind ? <PivotButtons entity={{ kind: String(n.props.kind), value: String(n.props.value ?? ""), path, props: n.props }} manifest={m} types={types} /> : null)} />
            </div>
            <aside className="border-t py-4 lg:overflow-y-auto lg:border-t-0 lg:pl-4"><SidePanel index={index} path={path.endsWith(".md") ? path : null} events={events} onOpen={openNote} /></aside>
          </div>
        ) : current === "graph" ? <GraphView index={index} />
          : current === "canvas" ? <CanvasView index={index} pulse={notePulse} />
          : (() => { const t = viewTabs(m).find(x => x.id === current)!; const w = (t.view as View & { view?: string }).view ?? t.view.widget; return <Widget slug={slug} index={index} view={t.view} manifest={m!} pulse={views[w] ?? 0} /> })()}
      </div>
      <Sheet open={tree} onOpenChange={setTree}>
        <SheetContent side="left" className="w-72">
          <SheetHeader><SheetTitle>{t("Notes")}</SheetTitle></SheetHeader>
          <div className="overflow-y-auto px-3 pb-4"><BrainTree index={index} open={path} fresh={fresh} onOpen={p => openNote(p)} /></div>
        </SheetContent>
      </Sheet>
      <Palette open={palette} setOpen={setPalette} index={index} onOpen={openNote} onRefresh={m ? refresh : undefined} onObsidian={() => obsidian.open(index.dir)} />
      {m && <NextActions open={next} setOpen={setNext} index={index} manifest={m} types={types} />}
      {obsidian.dialog}
    </div>
  )
}
