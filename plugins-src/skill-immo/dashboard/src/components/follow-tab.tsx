import { alertsOf } from "@engine/alerts.js"
import { BellRingIcon, CheckCheckIcon, CheckIcon, ChevronDownIcon, DownloadIcon, MapIcon, RadarIcon, RefreshCwIcon, SearchIcon, SettingsIcon, SquareKanbanIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Scope, summary } from "@/components/alerts-tab"
import { CreditBadge, lastCount } from "@/components/credit-badge"
import { DPE_HEX } from "@/components/dpe"
import { clockOf, dayLabel, LOOK, newsKey, NewsTile, newsTitle, UnreadDot, useNews, type NewsItem } from "@/components/news"
import { useRun } from "@/components/run-dialog"
import { StatusDot } from "@/components/status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Alert, type Status } from "@/lib/api"
import { date, dpeAsk, eur, num, ORIGIN, pct, SALE_STATUS, STATUS_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

const clock = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })

// The follow-up: what the API has to fetch, the news day by day (unread first shown), and on the right the watch, the
// user's alerts and their selection. `onView` opens another tab.
export function FollowTab({ onView }: { onView: (v: string) => void }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col gap-3">
        <ApiBar />
        <NewsCard onView={onView} />
      </div>
      <aside aria-label="Résumé" className="flex flex-col gap-4 lg:sticky lg:top-4">
        <WatchCard onView={onView} />
        <MyAlertsCard onView={onView} />
        <SelectionCard onView={onView} />
      </aside>
    </div>
  )
}

// The API's free counts, to fetch: the listings not fetched yet and the fetched ones changed since the last refresh.
// Only when there is something; automatic when the settings say so.
function ApiBar() {
  const { slug, data, state } = useSearch()
  const run = useRun()
  const s = data.search, on = state.stream_estate && s.mode === "stream-estate"
  const added = lastCount(data)?.total ?? 0, changed = data.feed.changed?.since === s.last_refresh ? data.feed.changed.total : 0
  if (!on || !(added || changed)) return null
  const color = LOOK.listings.color
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}><DownloadIcon className="size-4.5" /></span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Sur l'API : </span>
        {[added && `${num(added)} nouvelle${added > 1 ? "s" : ""} annonce${added > 1 ? "s" : ""}`, changed && `${num(changed)} suivie${changed > 1 ? "s" : ""} modifiée${changed > 1 ? "s" : ""} depuis l'actualisation du ${date(s.last_refresh)}`].filter(Boolean).join(" · ")}
        <span className="block text-xs text-muted-foreground">{state.settings.auto_fetch ? `Récupérées automatiquement à la prochaine veille${state.watch.next ? ` (${clock.format(new Date(state.watch.next))})` : ""}, dans votre budget.` : "Comptées gratuitement par la veille ; les récupérer coûte des crédits."}</span>
      </p>
      <span className="flex flex-wrap gap-2">
        {added > 0 && <Button size="sm" onClick={() => run({ cmd: "fetch", slug, label: "Annonces de l'API" })}><DownloadIcon data-icon="inline-start" />Récupérer<CreditBadge cost="fetch" /></Button>}
        {changed > 0 && <Button size="sm" variant="outline" onClick={() => run({ cmd: "refresh", slug, label: "Actualisation de la recherche" })}><RefreshCwIcon data-icon="inline-start" />Actualiser<CreditBadge cost="refresh" /></Button>}
      </span>
    </div>
  )
}

// the filters over the news, each with its swatch
const FILTERS: Record<string, { label: string; of: (n: NewsItem) => boolean; swatch: string | null }> = {
  all: { label: "Tout", of: () => true, swatch: null },
  mine: { label: "Mes alertes", of: n => n.alerts.length > 0, swatch: "var(--primary)" },
  dpe: { label: "DPE", of: n => n.kind === "dpe", swatch: `linear-gradient(90deg, ${Object.values(DPE_HEX).join(", ")})` },
  listings: { label: "Annonces", of: n => n.kind === "new", swatch: "var(--news-new)" },
  prices: { label: "Prix", of: n => n.kind === "price_drop" || n.kind === "price_rise", swatch: "conic-gradient(var(--news-drop) 0 50%, var(--news-rise) 0)" },
  status: { label: "Statuts", of: n => n.kind === "status" || n.kind === "expired", swatch: "var(--news-other)" },
}
const PAGE = 50
// news of one kind found by one watch (the same minute), for the same alerts, fold into one row past this many
const FOLD = 3
type Group = { key: string; items: NewsItem[] }
// the groups of a day: the user's alerts first, then the newest
function groupsOf(ns: NewsItem[]): Group[] {
  const out = new Map<string, NewsItem[]>()
  for (const n of ns) {
    const k = `${n.kind}|${n.date.slice(0, 16)}|${n.alerts.map(a => a.id).join(",")}`
    out.set(k, [...(out.get(k) ?? []), n])
  }
  return [...out].map(([key, items]) => ({ key, items })).sort((a, b) => +(b.items[0].alerts.length > 0) - +(a.items[0].alerts.length > 0) || b.items[0].date.localeCompare(a.items[0].date))
}

// The news, day by day, folded per watch: unread ones (what was read meanwhile stays until the filter changes) or
// all, filtered by kind. The bell asks for one (newsFocus): every news shown, it scrolls into view and lights up.
function NewsCard({ onView }: { onView: (v: string) => void }) {
  const { slug, data, state, unread, reload, newsFocus, focusNews } = useSearch()
  const { items, fresh } = useNews()
  const [only, setOnly] = useState(unread > 0 ? "unread" : "all"), [filter, setFilter] = useState("all"), [shown, setShown] = useState(PAGE)
  const [kept, setKept] = useState<Set<string>>(new Set()), [open, setOpen] = useState<Set<string>>(new Set()), [seen, setSeen] = useState<string | null>(null)
  const list = items.filter(n => FILTERS[filter].of(n) && (only === "all" || fresh(n) || kept.has(newsKey(n))))
  const days = useMemo(() => list.slice(0, shown).reduce<[string, NewsItem[]][]>((out, n) => {
    const d = dayLabel(n.date)
    if (out.at(-1)?.[0] === d) out.at(-1)![1].push(n)
    else out.push([d, [n]])
    return out
  }, []), [list, shown])

  // read: one news (kept on screen), or all
  async function read(keys?: string[]) {
    if (keys) setKept(k => new Set([...k, ...keys]))
    await api.readFeed(slug, keys)
    await reload()
  }
  const opened = (n: NewsItem) => { if (state.settings.read_on_open && fresh(n)) read([newsKey(n)]) }

  // the one the bell asks for: every news, and enough of them, shown at once, its group open; then on screen, lit up
  if (newsFocus !== seen) {
    setSeen(newsFocus)
    if (newsFocus) {
      setOnly("all")
      setFilter("all")
      setShown(s => Math.max(s, items.findIndex(n => newsKey(n) === newsFocus) + 1))
      const n = items.find(x => newsKey(x) === newsFocus)
      if (n) setOpen(o => new Set([...o, `${n.kind}|${n.date.slice(0, 16)}|${n.alerts.map(a => a.id).join(",")}`]))
    }
  }
  useEffect(() => {
    if (!newsFocus) return
    const one = items.some(n => newsKey(n) === newsFocus)
    document.getElementById(one ? `news-${newsFocus}` : "news")?.scrollIntoView({ block: one ? "center" : "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
    const t = setTimeout(() => focusNews(null), 2500)
    return () => clearTimeout(t)
  }, [newsFocus, items, focusNews])

  return (
    <Card id="news" className="scroll-mt-4 gap-4">
      <CardHeader>
        <CardTitle>Nouveautés</CardTitle>
        <CardDescription>{unread ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est lu"}{data.search.last_refresh ? ` · dernière actualisation le ${date(data.search.last_refresh)}` : ""}</CardDescription>
        <CardAction><Button variant="outline" size="sm" disabled={!unread} onClick={() => read()}><CheckCheckIcon data-icon="inline-start" /><span className="max-sm:sr-only">Tout marquer comme lu</span></Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={only} onValueChange={v => { if (v) { setOnly(v); setKept(new Set()); setShown(PAGE) } }} aria-label="Lues ou non">
            <ToggleGroupItem value="unread">Non lues<span className="text-muted-foreground tabular-nums">{unread}</span></ToggleGroupItem>
            <ToggleGroupItem value="all">Toutes</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={filter} onValueChange={v => { if (v) { setFilter(v); setShown(PAGE) } }} className="flex-wrap" aria-label="Filtrer par type">
            {Object.entries(FILTERS).map(([k, f]) => {
              const count = items.filter(f.of).length
              return (k === "all" || count > 0) && (
                <ToggleGroupItem key={k} value={k}>
                  {f.swatch && <i aria-hidden className="size-2.5 rounded-full" style={{ background: f.swatch }} />}{f.label}<span className="text-muted-foreground tabular-nums">{count}</span>
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </div>
        {!list.length && (
          <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
            {only === "unread" && items.length ? "Rien de nouveau depuis votre dernière lecture." : items.length ? "Aucune nouveauté de ce type." : "Rien de nouveau. Le serveur vérifie les DPE de la zone et de vos alertes à son démarrage, puis régulièrement."}
          </p>
        )}
        {days.map(([day, ns]) => (
          <section key={day} aria-label={day} className="flex flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-muted-foreground">{day}</h3>
            <ol className="flex flex-col gap-0.5">
              {groupsOf(ns).map(g => g.items.length < FOLD
                ? g.items.map(n => <NewsRow key={newsKey(n)} n={n} fresh={fresh(n)} lit={newsFocus === newsKey(n)} onOpen={() => opened(n)} onRead={() => read([newsKey(n)])} onView={onView} />)
                : <GroupRow key={g.key} g={g} open={open.has(g.key)} onToggle={() => setOpen(o => { const x = new Set(o); if (x.has(g.key)) x.delete(g.key); else x.add(g.key); return x })}>
                    {g.items.map(n => <NewsRow key={newsKey(n)} n={n} fresh={fresh(n)} lit={newsFocus === newsKey(n)} onOpen={() => opened(n)} onRead={() => read([newsKey(n)])} onView={onView} />)}
                  </GroupRow>)}
            </ol>
          </section>
        ))}
        {list.length > shown && <Button variant="ghost" size="sm" className="self-center" onClick={() => setShown(s => s + PAGE)}>Afficher les {Math.min(PAGE, list.length - shown)} suivantes</Button>}
      </CardContent>
    </Card>
  )
}

// news of one watch folded: their kind, how many, their streets, the alert that took them; open, the news below
function GroupRow({ g, open, onToggle, children }: { g: Group; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { fresh } = useNews()
  const n = g.items[0], { label, color } = LOOK[n.kind], unreadCount = g.items.filter(fresh).length
  const where = [...new Set(g.items.map(x => (x.kind === "dpe" ? x.dpe.address : "l" in x ? x.l.location.address : null)?.replace(/^\s*\d+\s*(bis|ter|[a-d])?\s+/i, "").replace(/\s+\d{5}\b.*$/, "")).filter(Boolean))]
  const plural = { dpe: "nouveaux DPE", new: "nouvelles annonces", price_drop: "baisses de prix", price_rise: "hausses de prix", status: "changements de statut", expired: "annonces expirées", listings: "", changed: "" }[n.kind]
  return (
    <li className="flex flex-col">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <span aria-hidden className={cn("relative grid size-9 place-items-center rounded-lg text-sm font-bold tabular-nums", !unreadCount && "opacity-55")} style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>{g.items.length}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-xs font-semibold" style={{ color }}>{label}{n.alerts.map(a => <AlertPill key={a.id} a={a} />)}</span>
          <span className={cn("block truncate text-sm", unreadCount ? "font-medium" : "text-muted-foreground")}>{g.items.length} {plural}{n.alerts[0] ? "" : n.kind === "dpe" ? " sans annonce dans la zone" : ""}</span>
          <span className="block truncate text-xs text-muted-foreground">{where.slice(0, 3).join(", ")}{where.length > 3 ? ` et ${where.length - 3} autre${where.length > 4 ? "s" : ""} rue${where.length > 4 ? "s" : ""}` : ""}</span>
        </span>
        <span className="flex items-center gap-2">
          <time dateTime={n.date} className="text-xs text-muted-foreground tabular-nums">{clockOf(n.date)}</time>
          {unreadCount ? <UnreadDot /> : <i aria-hidden className="size-2" />}
          <ChevronDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <ol className="flex flex-col gap-0.5 pl-6">{children}</ol>}
    </li>
  )
}

// an alert of the user's that took a news: its name and where it looks
function AlertPill({ a }: { a: Alert }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Badge variant="secondary" className="h-5 gap-1 font-medium"><BellRingIcon />{a.name}</Badge></TooltipTrigger>
      <TooltipContent className="flex items-center gap-2"><Scope place={a.place} className="border-background/40 text-background" />{summary(a)}</TooltipContent>
    </Tooltip>
  )
}

// One news: its tile, its kind in its color (and the user's alerts that took it), what it is about and where, then
// its price or status and its time, close to it. Its actions show on hover or focus (always on a phone). A listing's
// opens its dossier.
function NewsRow({ n, fresh, lit, onOpen, onRead, onView }: { n: NewsItem; fresh: boolean; lit: boolean; onOpen: () => void; onRead: () => void; onView: (v: string) => void }) {
  const { select, addFeedback, focusDpe } = useSearch()
  const { label, color } = LOOK[n.kind]
  const title = cn("block max-w-full truncate text-left text-sm", fresh ? "font-medium" : "text-muted-foreground")
  const detail = "l" in n ? n.l.location.address ?? n.l.location.neighborhood ?? n.l.location.city ?? ORIGIN[n.l.source].long
    : n.kind === "dpe" ? `DPE ${n.dpe.energy} du ${date(n.dpe.date)}, ${n.dpe.address ?? "adresse inconnue"}, sans annonce` : ""
  const actions = "flex items-center gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
  return (
    <li id={`news-${newsKey(n)}`}
      className={cn("group relative grid scroll-mt-4 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5 transition-colors duration-700 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        "hover:bg-accent/60", lit && "bg-accent outline-2 -outline-offset-2 outline-ring")}>
      <NewsTile n={n} dim={!fresh} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold" style={{ color }}>{label}{n.alerts.map(a => <AlertPill key={a.id} a={a} />)}{fresh && <span className="sr-only">, non lue</span>}</p>
        {"l" in n
          ? <button type="button" onClick={() => { onOpen(); select(n.l.id) }} className={cn(title, "after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring")}>{newsTitle(n)}</button>
          : <p className={title}>{newsTitle(n)}</p>}
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
        <span className={cn(actions, "relative z-10")}>
          {n.kind === "dpe" && (
            <>
              <Button variant="ghost" size="xs" onClick={() => { onOpen(); focusDpe(n.dpe); onView("odds") }}><MapIcon data-icon="inline-start" />Carte</Button>
              <Button variant="ghost" size="xs" onClick={() => { onOpen(); addFeedback({ kind: "chercher", text: dpeAsk(n.dpe) }); toast.success("Ajouté au prompt : Claude cherchera l'annonce") }}><SearchIcon data-icon="inline-start" />Chercher l'annonce</Button>
            </>
          )}
          {fresh && <Button variant="ghost" size="icon-xs" aria-label="Marquer comme lue" onClick={onRead}><CheckIcon /></Button>}
        </span>
        {(n.kind === "price_drop" || n.kind === "price_rise") && (
          <>
            <s className="text-xs text-muted-foreground tabular-nums">{eur(n.from as number)}</s>
            <span className="text-sm font-semibold tabular-nums">{eur(n.to as number)}</span>
            <span className="rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums" style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>{pct(((n.to as number) - (n.from as number)) / (n.from as number), 1)}</span>
          </>
        )}
        {n.kind === "new" && <span className="text-sm font-semibold tabular-nums">{eur(n.to as number)}</span>}
        {(n.kind === "status" || n.kind === "expired") && <Badge variant="outline">{SALE_STATUS[String(n.to)] ?? n.to}</Badge>}
        <span className="ml-auto flex items-center gap-2 sm:ml-0">
          <time dateTime={n.date} className="text-xs text-muted-foreground tabular-nums">{clockOf(n.date)}</time>
          {fresh ? <UnreadDot /> : <i aria-hidden className="size-2" />}
        </span>
      </div>
    </li>
  )
}

// the server's watch: the last, the next, one now; its settings
function WatchCard({ onView }: { onView: (v: string) => void }) {
  const { state, reload } = useSearch()
  const [busy, setBusy] = useState(false), w = state.watch
  async function go() {
    setBusy(true)
    try { await api.watchNow(); await reload() } catch (e) { toast.error("La veille a échoué", { description: `Détail technique : ${(e as Error).message}` }) }
    setBusy(false)
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><RadarIcon className="size-4" />Veille</CardTitle>
        <CardDescription>{w.last ? `Dernière ${clock.format(new Date(w.last))}` : "Pas encore faite"}{w.next ? ` · prochaine ${clock.format(new Date(w.next))}` : " · coupée"}</CardDescription>
        <CardAction><Button variant="ghost" size="icon-sm" aria-label="Réglages de la veille" onClick={() => onView("settings")}><SettingsIcon /></Button></CardAction>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" className="w-full" disabled={busy || w.running} onClick={go}>{busy || w.running ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}Vérifier maintenant</Button>
      </CardContent>
    </Card>
  )
}

// the user's alerts on, with their unread news; the « Alertes » tab
function MyAlertsCard({ onView }: { onView: (v: string) => void }) {
  const { data } = useSearch()
  const { items, fresh } = useNews()
  const mine = (alertsOf(data.alerts) as Alert[]).filter(a => !a.builtin && a.enabled)
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BellRingIcon className="size-4" />Mes alertes</CardTitle>
        <CardAction><Button variant="link" size="xs" className="px-0" onClick={() => onView("alerts")}>Gérer</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!mine.length && <p className="text-xs text-muted-foreground">Aucune : créez-en une pour un DPE dans une rue, une passoire, une grosse baisse…</p>}
        {mine.map(a => {
          const n = items.filter(x => x.alerts.some(y => y.id === a.id)), u = n.filter(fresh).length
          return (
            <div key={a.id} className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{a.name}</span><span className="text-xs text-muted-foreground tabular-nums">{u ? <b className="text-foreground">{u} non lue{u > 1 ? "s" : ""}</b> : `${n.length}`}</span></span>
              <Scope place={a.place} className="self-start" />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// the listings by status, in one line each; the kanban
function SelectionCard({ onView }: { onView: (v: string) => void }) {
  const { data } = useSearch()
  const favorites = data.listings.filter(l => l.favorite).length
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SquareKanbanIcon className="size-4" />Ma sélection</CardTitle>
        <CardAction><Button variant="link" size="xs" className="px-0" onClick={() => onView("kanban")}>Kanban</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 text-sm">
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <span key={k} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><StatusDot status={k as Status} />{v}</span><span className="tabular-nums text-muted-foreground">{data.listings.filter(l => l.my_status === k).length}</span></span>
        ))}
        <span className="flex items-center justify-between gap-2 border-t pt-1.5"><span>Favoris</span><span className="tabular-nums text-muted-foreground">{favorites}</span></span>
      </CardContent>
    </Card>
  )
}
