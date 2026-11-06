import { CommandIcon, PanelLeftIcon, SearchIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { InvestigationTree } from "@/components/brain-tree"
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
import { SubCases } from "@/components/sub-cases"
import { TopBar } from "@/components/top-bar"
import { useWatchState } from "@/components/watch-control"
import { Widget } from "@/components/widgets"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Manifest, type View } from "@/lib/api"
import { CaseScope, inCase, useBasket } from "@/lib/basket"
import { typeColor } from "@/lib/colors"
import { slugOf, useNow } from "@/lib/format"
import { runRefresh } from "@/lib/refresh"
import { caseHref, go, splitNote, splitTab, subNote, subTab } from "@/lib/route"
import { treeOf, type TreeCase } from "@/lib/tree"
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
const OWN = ["brain", "graph", "canvas"]

// An investigation's page: its top case's head, its sub-cases (each with its own Refresh, Watch, Export and views),
// and its tabs (Brain, Graph, Canvas over all its cases, then the type's views); a sub-case's address opens here
export function CasePage({ slug, tab, note }: { slug: string; tab: string; note: string | null }) {
  const { index, events, error, notePulse, views, reload } = useCase(slug)
  const types = useTypes(), now = useNow()
  const m = types?.find(t => t.id === index?.type)
  const { add } = useBasket()
  const obsidian = useObsidian(), watch = useWatchState().state
  const [palette, setPalette] = useState(false), [tree, setTree] = useState(false), [next, setNext] = useState(false), [refreshing, setRefreshing] = useState(false)
  useEffect(() => { api.seen(slug).catch(() => {}) }, [slug])
  // a sub-case: its investigation's page, at its note or its view
  const root = index?.root && index.root !== slug ? index.root : null
  useEffect(() => {
    if (!root) return
    const own = OWN.includes(tab), at = own ? (tab === "brain" ? subNote(slug, note ?? "Case.md") : undefined) : undefined
    location.replace(caseHref(root, own ? tab : subTab(slug, tab), at))
  }, [root, slug, tab, note])
  const cases = useMemo(() => (index && !root ? treeOf(index) : []), [index, root])
  const bySlug = useMemo(() => new Map(cases.map(c => [c.slug, c])), [cases])
  const titles = useMemo(() => Object.fromEntries(cases.map(c => [c.slug, c.title])), [cases])
  const [path, anchor] = useMemo(() => { const n = note ?? "Case.md", i = n.indexOf("#"); return i < 0 ? [n, null] : [n.slice(0, i), n.slice(i + 1)] }, [note])
  // the open note, in its case (a sub-case gone: the top case's Case.md)
  const at = splitNote(path), noteCase = at.slug && bySlug.has(at.slug) ? bySlug.get(at.slug)! : cases[0], notePath = at.slug && !bySlug.has(at.slug) ? "Case.md" : at.path
  // the notes written during this visit and not opened since: a dot in the tree
  const [opened] = useState(() => new Date().toISOString())
  const [read, setRead] = useState<Record<string, string>>({})
  const fresh = useMemo(() => new Set(events.filter(e => e.kind === "note.write" && e.path?.endsWith(".md") && !e.deleted && e.t > opened)
    .map(e => ({ k: e.case && e.case !== slug ? subNote(e.case, e.path!) : e.path!, t: e.t })).filter(x => x.k !== path && x.t > (read[x.k] ?? "")).map(x => x.k)), [events, read, path, opened, slug])
  // a note opened in its case; the note being left counts as read up to now
  const openNote = (p: string, a?: string | null, of?: string | null) => {
    setTree(false); setRead(r => ({ ...r, [path]: new Date().toISOString() }))
    const full = of && of !== slug ? subNote(of, p) : p
    go(caseHref(slug, "brain", `${full || path}${a ? `#${a}` : ""}`))
  }
  const openIn = (p: string, of: string | null) => openNote(p, null, of)
  const refreshCase = (of: string) => { const c = bySlug.get(of)!, cm = types?.find(x => x.id === c.index.type); return runRefresh(of, of === slug ? add : i => add(inCase(i, of)), cm?.private) }
  const refreshAll = async () => {
    setRefreshing(true)
    await runRefresh(slug, add, m?.private, cases.map(c => ({ slug: c.slug, type: c.index.type, private: types?.find(x => x.id === c.index.type)?.private, parent: c.parent })))
    setRefreshing(false)
  }
  const refreshOne = async (of: string) => { setRefreshing(true); await refreshCase(of); setRefreshing(false) }

  if (error && !index) return (
    <>
      <TopBar />
      <Empty className="m-6 border border-dashed">
        <EmptyHeader><EmptyTitle>{t("No case {slug}", { slug })}</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader>
        <Button asChild variant="outline"><a href="#/">{t("All cases")}</a></Button>
      </Empty>
    </>
  )
  if (!index || !types || root || !cases.length) return <><TopBar /><div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4"><Skeleton className="h-20" /><Skeleton className="h-[60vh]" /></div></>
  const subs = cases.slice(1)
  const tabs = [{ id: "brain", icon: "brain", label: t("Brain") }, { id: "graph", icon: "share-2", label: t("Graph") }, { id: "canvas", icon: "layout-dashboard", label: t("Canvas") }, ...(m ? viewTabs(m) : [])]
  // a sub-case's view: its own chip while it is open
  const sub = splitTab(tab), subCase = sub.slug ? bySlug.get(sub.slug) : undefined, subM = subCase && types.find(x => x.id === subCase.index.type)
  const subView = subCase && viewTabs(subM).find(x => x.id === sub.tab)
  if (subCase && subView) tabs.push({ id: tab, icon: subView.icon, label: `${subCase.title} · ${subView.label}` })
  const current = tabs.find(t => t.id === tab) ? tab : "brain"
  const noteM = types.find(x => x.id === noteCase.index.type), noteOf = noteCase.slug === slug ? null : noteCase.slug
  const pulseOf = (of: string | null) => {
    if (!notePulse || notePulse.path === "*") return notePulse
    const x = splitNote(notePulse.path)
    return x.slug === of ? { path: x.path, n: notePulse.n } : null
  }
  // a view's widget, its data reloaded when its file changes (a sub-case's: « <widget>~<slug> »)
  const widget = (c: TreeCase, cm: Manifest, v: ViewTab) => { const w = (v.view as View & { view?: string }).view ?? v.view.widget; return <Widget slug={c.slug} index={c.index} view={v.view} manifest={cm} pulse={views[c.slug === slug ? w : subTab(c.slug, w)] ?? 0} /> }
  return (
    <div className="flex flex-col lg:h-dvh">
      <TopBar>
        <Button variant="outline" className="mx-2 hidden h-9 max-w-xl min-w-0 flex-1 justify-start text-muted-foreground sm:inline-flex" onClick={() => setPalette(true)}>
          <SearchIcon data-icon="inline-start" /><span className="truncate">{subs.length ? t("Search this investigation") : t("Search this case")}</span>
          <kbd className="ml-auto inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground"><CommandIcon className="size-3" />K</kbd>
        </Button>
        <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label={t("Search this case")} onClick={() => setPalette(true)}><SearchIcon /></Button>
      </TopBar>
      <div className="border-b">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3">
          <CaseHeader index={index} m={m} color={typeColor(index.type, types)} now={now} onRefresh={refreshAll} refreshing={refreshing} onNext={() => setNext(true)}
            cases={cases.map(c => ({ slug: c.slug, title: c.title, depth: c.depth, icon: types.find(x => x.id === c.index.type)?.icon ?? "circle-help" }))} onRefreshOne={refreshOne} />
          <SubCases cases={subs} types={types} now={now} paused={watch ? !watch.on : false} viewsOf={viewTabs} onOpen={of => openNote("Case.md", null, of)}
            onView={(of, id) => go(caseHref(slug, subTab(of, id)))} onRefresh={refreshCase} onDeleted={reload} />
          <Chips label={t("Views")} size="xs" value={current} onChange={t => go(caseHref(slug, t, t === "brain" ? note ?? undefined : undefined))} options={tabs.map(t => ({ value: t.id, label: t.label, icon: t.icon }))} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1600px] px-4 lg:min-h-0 lg:flex-1">
        {current === "brain" ? (
          <div className="grid grid-cols-[minmax(0,1fr)] lg:h-full lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
            <aside className="hidden overflow-y-auto py-4 pr-3 lg:block"><InvestigationTree cases={cases} types={types} open={path} fresh={fresh} onOpen={openIn} /></aside>
            <div data-note-scroller className="min-w-0 py-4 lg:overflow-y-auto lg:border-x lg:px-6">
              <Button variant="outline" size="sm" className="mb-3 lg:hidden" onClick={() => setTree(true)}><PanelLeftIcon data-icon="inline-start" />{t("Notes")}</Button>
              {noteOf && <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><button type="button" className="hover:underline" onClick={() => openNote("Case.md")}>{cases[0].title}</button><span aria-hidden>›</span><span className="font-medium text-foreground">{noteCase.title}</span></p>}
              <CaseScope slug={noteOf}>
                <NoteView key={path} slug={noteCase.slug} path={notePath} anchor={anchor} index={noteCase.index} pulse={pulseOf(noteOf)} onOpen={(p, a) => openNote(p, a, noteOf)}
                  extra={n => (notePath.startsWith("Entities/") && n.props.kind ? <PivotButtons entity={{ kind: String(n.props.kind), value: String(n.props.value ?? ""), path: notePath, props: n.props }} manifest={noteM} types={types} /> : null)} />
              </CaseScope>
            </div>
            <aside className="border-t py-4 lg:overflow-y-auto lg:border-t-0 lg:pl-4">
              <SidePanel index={noteCase.index} path={notePath.endsWith(".md") ? notePath : null} events={events} onOpen={(p, a) => openNote(p, a, noteOf)} root={slug} titles={titles} onOpenIn={(of, p) => openNote(p, null, of)} />
            </aside>
          </div>
        ) : current === "graph" ? <GraphView cases={cases} onOpen={openIn} />
          : current === "canvas" ? <CanvasView cases={cases} pulse={notePulse} onOpen={openIn} />
          : subCase && subM && subView && current === tab ? <CaseScope slug={subCase.slug}>{widget(subCase, subM, subView)}</CaseScope>
          : widget(cases[0], m!, viewTabs(m).find(x => x.id === current)!)}
      </div>
      <Sheet open={tree} onOpenChange={setTree}>
        <SheetContent side="left" className="w-72">
          <SheetHeader><SheetTitle>{t("Notes")}</SheetTitle></SheetHeader>
          <div className="overflow-y-auto px-3 pb-4"><InvestigationTree cases={cases} types={types} open={path} fresh={fresh} onOpen={openIn} /></div>
        </SheetContent>
      </Sheet>
      <Palette open={palette} setOpen={setPalette} cases={cases} onOpen={openNote} onRefresh={m ? refreshAll : undefined} onObsidian={() => obsidian.open(index.dir)} />
      <NextActions open={next} setOpen={setNext} cases={cases} types={types} />
      {obsidian.dialog}
    </div>
  )
}
