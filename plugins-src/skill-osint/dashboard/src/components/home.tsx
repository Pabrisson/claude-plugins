import { MessageSquarePlusIcon, PanelRightCloseIcon, PanelRightOpenIcon, PlusIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { CaseCard } from "@/components/case-card"
import { Chips } from "@/components/chips"
import { SharedEntities } from "@/components/shared-entities"
import { STATUS } from "@/components/status"
import { TopBar } from "@/components/top-bar"
import { nameOf, useWorkspaces, useWorkspaceView } from "@/components/workspace-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Icon } from "@/components/icon"
import { api, type CaseSummary, type Manifest, type SharedEntity } from "@/lib/api"
import { useBasket } from "@/lib/basket"
import { typeColor } from "@/lib/colors"
import { useMedia, useNow } from "@/lib/format"
import { t } from "@/lib/i18n"
import { aggregate, investigations } from "@/lib/tree"
import { useHomeEvents } from "@/lib/use-events"

type Filters = { types: string[]; statuses: string[]; q: string; shared: boolean }
const KEY = "osint-home"
const loadFilters = (): Filters => { try { return { types: [], statuses: [], q: "", shared: true, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } } catch { return { types: [], statuses: [], q: "", shared: true } } }
const byRecent = (a: CaseSummary, b: CaseSummary) => (b.last?.t ?? b.created).localeCompare(a.last?.t ?? a.created)

export function Home() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [types, setTypes] = useState<Manifest[]>([])
  const [shared, setShared] = useState<SharedEntity[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState(loadFilters)
  const [only, setOnly] = useState<SharedEntity | null>(null)
  const [sheet, setSheet] = useState(false) // the shared entities on a narrow screen: closed at each visit
  const wide = useMedia("(min-width: 1280px)"), now = useNow()
  const ws = useWorkspaces(), all = useWorkspaceView() === "all"
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(f)) } catch { /* kept for this visit only */ } }, [f])
  const loadShared = useCallback(() => api.shared().then(setShared, () => setShared([])), [])
  useEffect(() => {
    api.cases().then(setCases, (e: Error) => setError(e.message))
    api.types().then(setTypes, () => {})
    loadShared()
  }, [loadShared])
  // live: the summary replaces its card, a new case comes in, null removes it; shared entities follow, 3 s apart
  const timer = useRef<number | undefined>(undefined)
  useHomeEvents(useCallback((slug: string, summary: CaseSummary | null) => {
    setCases(list => {
      const rest = (list ?? []).filter(c => c.slug !== slug)
      return summary ? [...rest, summary] : rest
    })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(loadShared, 3000)
  }, [loadShared]))

  const titles = useMemo(() => Object.fromEntries((cases ?? []).map(c => [c.slug, c.title])), [cases])
  // one card per investigation (a case and the cases below it), the current workspace's or all of them
  const wsOf = (c: CaseSummary) => (ws?.list.some(x => x.slug === c.workspace) ? c.workspace : "default")
  const invs = useMemo(() => investigations(cases ?? []).map(inv => ({ ...inv, sum: aggregate(inv) })), [cases])
  const here = invs.filter(inv => all || !ws || wsOf(inv.root) === ws.current), roots = new Set(here.map(inv => inv.root.slug))
  const q = f.q.trim().toLowerCase()
  const shown = here.filter(({ all: tree, sum }) =>
    (!f.types.length || tree.some(c => f.types.includes(c.type))) && (!f.statuses.length || f.statuses.includes(sum.status)) &&
    (!q || tree.some(c => [c.title, c.slug, c.answer ?? ""].some(s => s.toLowerCase().includes(q)))) && (!only || only.cases.some(x => tree.some(c => c.slug === x.slug))),
  ).sort((a, b) => byRecent(a.sum, b.sum))
  const count = (k: "type" | "status", v: string) => here.filter(inv => (k === "type" ? inv.all.some(c => c.type === v) : inv.sum.status === v)).length
  const typeIds = [...new Set([...types.map(t => t.id), ...(cases ?? []).map(c => c.type)])]
  const pick = (e: SharedEntity) => setOnly(o => (o?.key === e.key ? null : e))
  // shared between two investigations or more of what is shown
  const sharedHere = shared && shared.map(e => ({ ...e, cases: e.cases.filter(c => roots.has(c.root)) })).filter(e => new Set(e.cases.map(c => c.root)).size >= 2)
  const panel = <SharedEntities list={sharedHere} titles={titles} active={only?.key ?? null} onPick={e => { pick(e); setSheet(false) }} />

  return (
    <>
      <TopBar search={{ value: f.q, onChange: v => setF(x => ({ ...x, q: v })) }} />
      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-6">
        <main className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-auto">
              <h1 className="text-xl font-semibold tracking-tight">{t("Investigations")}</h1>
              <p className="text-sm text-muted-foreground">
                {cases ? <>{ws && <span className="font-medium text-foreground">{all ? t("All workspaces") : nameOf(ws, ws.current)}</span>}{ws && " · "}{t(here.length === 1 ? "{n} investigation, live" : "{n} investigations, live", { n: here.length })}</> : t("Loading…")}
              </p>
            </div>
            <AskAgent />
            <Button variant="outline" size="sm" onClick={() => (wide ? setF(x => ({ ...x, shared: !x.shared })) : setSheet(true))} aria-expanded={wide ? f.shared : sheet}>
              {f.shared && wide ? <PanelRightCloseIcon data-icon="inline-start" /> : <PanelRightOpenIcon data-icon="inline-start" />}{t("Shared entities")}
              {sharedHere && sharedHere.length > 0 && <Badge variant="secondary" className="ml-1 tabular-nums">{sharedHere.length}</Badge>}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Chips multiple label={t("Case types")} value={f.types} onChange={v => setF(x => ({ ...x, types: v }))}
              options={typeIds.map(id => { const t = types.find(x => x.id === id); return { value: id, label: t?.label ?? id, icon: t?.icon ?? "circle-help", count: count("type", id) } })} />
            <Chips multiple label={t("Statuses")} value={f.statuses} onChange={v => setF(x => ({ ...x, statuses: v }))}
              options={Object.entries(STATUS).map(([value, s]) => ({ value, label: t(s.label), icon: s.icon, count: count("status", value) }))} />
            {only && (
              <Badge variant="secondary" className="h-7 gap-1.5 pr-1 pl-2.5">
                <Icon name="filter" aria-hidden />{t("Filtered by {value}", { value: only.value })}
                <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label={t("Clear the entity filter")} onClick={() => setOnly(null)}><XIcon /></Button>
              </Badge>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!cases && !error && <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>}
          {cases?.length === 0 && (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Icon name="scan-search" /></EmptyMedia>
                <EmptyTitle>{t("No case yet")}</EmptyTitle>
                <EmptyDescription>{t("A case starts from a domain, an image, a username… The agent then works on it live, here and in Obsidian.")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent><Button asChild><a href="#/new"><PlusIcon data-icon="inline-start" />{t("New case")}</a></Button></EmptyContent>
            </Empty>
          )}
          {cases && cases.length > 0 && !here.length && (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Icon name="folder-kanban" /></EmptyMedia>
                <EmptyTitle>{t("No investigation in this workspace yet")}</EmptyTitle>
                <EmptyDescription>{t("The cases you start now join it. Another workspace, or All workspaces, is one click away in the bar.")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent><Button asChild><a href="#/new"><PlusIcon data-icon="inline-start" />{t("New case")}</a></Button></EmptyContent>
            </Empty>
          )}
          {here.length > 0 && !shown.length && <p className="py-10 text-center text-sm text-muted-foreground">{t("No case matches these filters.")}</p>}
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map(({ sum, below }) => <CaseCard key={sum.slug} summary={sum} below={below} types={types} type={types.find(t => t.id === sum.type)} color={typeColor(sum.type, types)} titles={titles} now={now} workspace={wsOf(sum)} showWorkspace={all && (ws?.list.length ?? 0) > 1} />)}
          </div>
        </main>
        {wide && f.shared && (
          <aside className="sticky top-20 flex max-h-[calc(100dvh-6rem)] w-80 shrink-0 flex-col gap-3 self-start">
            <div>
              <h2 className="text-sm font-semibold">{t("Shared entities")}</h2>
              <p className="text-xs text-muted-foreground">{t("Found in two investigations or more. A click keeps their cards.")}</p>
            </div>
            <div className="-mx-2 overflow-y-auto px-2">{panel}</div>
          </aside>
        )}
      </div>
      {!wide && (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent className="w-[min(22rem,90vw)]">
            <SheetHeader><SheetTitle>{t("Shared entities")}</SheetTitle><SheetDescription>{t("Found in two investigations or more. A click keeps their cards.")}</SheetDescription></SheetHeader>
            <div className="overflow-y-auto px-4 pb-4">{panel}</div>
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}

// a question for the agent about every case: the « all cases » prompt
export function AskAgent({ size = "sm" }: { size?: "sm" | "default" }) {
  const { add, scope } = useBasket()
  const [open, setOpen] = useState(false), [text, setText] = useState("")
  const placeholder = "slug" in scope ? t("What should the agent check in this case?") : t("Which cases share a hosting provider?")
  const submit = () => { if (!text.trim()) return; add({ tag: "question", text: text.trim() }); toast.success(t("Added to the prompt")); setText(""); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline" size={size}><MessageSquarePlusIcon data-icon="inline-start" />{t("Ask Agent")}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader><PopoverTitle>{t("Ask the agent")}</PopoverTitle><PopoverDescription>{"slug" in scope ? t("The question joins this case's prompt.") : t("The question joins the prompt about all cases.")}</PopoverDescription></PopoverHeader>
        <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} rows={4} autoFocus
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit() }} />
        <Button onClick={submit} disabled={!text.trim()}><PlusIcon data-icon="inline-start" />{t("Add to prompt")}</Button>
      </PopoverContent>
    </Popover>
  )
}
