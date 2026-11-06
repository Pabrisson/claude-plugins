import { MessageSquarePlusIcon, PanelRightCloseIcon, PanelRightOpenIcon, PlusIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { CaseCard } from "@/components/case-card"
import { Chips } from "@/components/chips"
import { SharedEntities } from "@/components/shared-entities"
import { STATUS } from "@/components/status"
import { appState, TopBar } from "@/components/top-bar"
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
import { useHomeEvents } from "@/lib/use-events"

type Filters = { types: string[]; statuses: string[]; q: string; shared: boolean }
const KEY = "osint-home"
const loadFilters = (): Filters => { try { return { types: [], statuses: [], q: "", shared: true, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } } catch { return { types: [], statuses: [], q: "", shared: true } } }
const byRecent = (a: CaseSummary, b: CaseSummary) => (b.last?.t ?? b.created).localeCompare(a.last?.t ?? a.created)

export function Home() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [types, setTypes] = useState<Manifest[]>([])
  const [shared, setShared] = useState<SharedEntity[] | null>(null)
  const [home, setHome] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState(loadFilters)
  const [only, setOnly] = useState<SharedEntity | null>(null)
  const [sheet, setSheet] = useState(false) // the shared entities on a narrow screen: closed at each visit
  const wide = useMedia("(min-width: 1280px)"), now = useNow()
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(f)) } catch { /* kept for this visit only */ } }, [f])
  const loadShared = useCallback(() => api.shared().then(setShared, () => setShared([])), [])
  useEffect(() => {
    api.cases().then(setCases, (e: Error) => setError(e.message))
    api.types().then(setTypes, () => {})
    appState().then(s => setHome(s.home))
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
  const q = f.q.trim().toLowerCase()
  const shown = (cases ?? []).filter(c =>
    (!f.types.length || f.types.includes(c.type)) && (!f.statuses.length || f.statuses.includes(c.status)) &&
    (!q || [c.title, c.slug, c.answer ?? ""].some(s => s.toLowerCase().includes(q))) && (!only || only.cases.some(x => x.slug === c.slug)),
  ).sort(byRecent)
  const count = (k: "type" | "status", v: string) => (cases ?? []).filter(c => c[k] === v).length
  const typeIds = [...new Set([...types.map(t => t.id), ...(cases ?? []).map(c => c.type)])]
  const pick = (e: SharedEntity) => setOnly(o => (o?.key === e.key ? null : e))
  const panel = <SharedEntities list={shared} titles={titles} active={only?.key ?? null} onPick={e => { pick(e); setSheet(false) }} />

  return (
    <>
      <TopBar search={{ value: f.q, onChange: v => setF(x => ({ ...x, q: v })) }} />
      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-6">
        <main className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-auto">
              <h1 className="text-xl font-semibold tracking-tight">Investigations</h1>
              <p className="text-sm text-muted-foreground">{cases ? `${cases.length} case${cases.length === 1 ? "" : "s"}, live` : "Loading…"}</p>
            </div>
            <AskAgent />
            <Button variant="outline" size="sm" onClick={() => (wide ? setF(x => ({ ...x, shared: !x.shared })) : setSheet(true))} aria-expanded={wide ? f.shared : sheet}>
              {f.shared && wide ? <PanelRightCloseIcon data-icon="inline-start" /> : <PanelRightOpenIcon data-icon="inline-start" />}Shared entities
              {shared && shared.length > 0 && <Badge variant="secondary" className="ml-1 tabular-nums">{shared.length}</Badge>}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Chips multiple label="Case types" value={f.types} onChange={v => setF(x => ({ ...x, types: v }))}
              options={typeIds.map(id => { const t = types.find(x => x.id === id); return { value: id, label: t?.label ?? id, icon: t?.icon ?? "circle-help", count: count("type", id) } })} />
            <Chips multiple label="Statuses" value={f.statuses} onChange={v => setF(x => ({ ...x, statuses: v }))}
              options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label, icon: s.icon, count: count("status", value) }))} />
            {only && (
              <Badge variant="secondary" className="h-7 gap-1.5 pr-1 pl-2.5">
                <Icon name="filter" aria-hidden />Filtered by {only.value}
                <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="Clear the entity filter" onClick={() => setOnly(null)}><XIcon /></Button>
              </Badge>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!cases && !error && <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>}
          {cases?.length === 0 && (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Icon name="scan-search" /></EmptyMedia>
                <EmptyTitle>No case yet</EmptyTitle>
                <EmptyDescription>A case starts from a domain, an image, a username… The agent then works on it live, here and in Obsidian.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent><Button asChild><a href="#/new"><PlusIcon data-icon="inline-start" />New case</a></Button></EmptyContent>
            </Empty>
          )}
          {cases && cases.length > 0 && !shown.length && <p className="py-10 text-center text-sm text-muted-foreground">No case matches these filters.</p>}
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map(c => <CaseCard key={c.slug} summary={c} type={types.find(t => t.id === c.type)} color={typeColor(c.type, types)} home={home} titles={titles} now={now} />)}
          </div>
        </main>
        {wide && f.shared && (
          <aside className="sticky top-20 flex max-h-[calc(100dvh-6rem)] w-80 shrink-0 flex-col gap-3 self-start">
            <div>
              <h2 className="text-sm font-semibold">Shared entities</h2>
              <p className="text-xs text-muted-foreground">Found in two cases or more. A click keeps their cases.</p>
            </div>
            <div className="-mx-2 overflow-y-auto px-2">{panel}</div>
          </aside>
        )}
      </div>
      {!wide && (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent className="w-[22rem]">
            <SheetHeader><SheetTitle>Shared entities</SheetTitle><SheetDescription>Found in two cases or more. A click keeps their cases.</SheetDescription></SheetHeader>
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
  const placeholder = "slug" in scope ? "What should the agent check in this case?" : "Which cases share a hosting provider?"
  const submit = () => { if (!text.trim()) return; add({ tag: "question", text: text.trim() }); toast.success("Added to the prompt"); setText(""); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline" size={size}><MessageSquarePlusIcon data-icon="inline-start" />Ask Agent</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader><PopoverTitle>Ask the agent</PopoverTitle><PopoverDescription>{"slug" in scope ? "The question joins this case's prompt." : "The question joins the prompt about all cases."}</PopoverDescription></PopoverHeader>
        <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} rows={4} autoFocus
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit() }} />
        <Button onClick={submit} disabled={!text.trim()}><PlusIcon data-icon="inline-start" />Add to prompt</Button>
      </PopoverContent>
    </Popover>
  )
}
