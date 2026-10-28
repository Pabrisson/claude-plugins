import { BellPlusIcon, CheckCheckIcon, DownloadIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { DPE_HEX } from "@/components/dpe"
import { clockOf, dayLabel, LOOK, newsKey, NewsTile, newsTitle, UnreadDot, useNews, type NewsItem } from "@/components/news"
import { useRun } from "@/components/run-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { credits, date, dpeAsk, eur, num, pct, SALE_STATUS, SOURCE_LABEL, STATUS_LABEL } from "@/lib/format"
import { isNew } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/status"
import type { Status } from "@/lib/api"

export function FollowTab() {
  const { slug, data, state, lastVisit, select } = useSearch()
  const run = useRun()
  const [forecast, setForecast] = useState<string | null>(null)
  const streamOn = state.stream_estate && data.search.mode === "stream-estate", alert = data.search.alert

  async function askForecast() {
    const r = await api.run({ cmd: "alert", slug, args: { sub: "forecast" } })
    if (r.code !== 0) return setForecast(r.err.replace(/^error: /, ""))
    const f = JSON.parse(r.out)
    setForecast(`Environ ${num(f.per_day?.average ?? f.total / (f.window_days || 30))} notification(s) par jour (${num(f.total)} sur ${f.window_days} jours).`)
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-4">
        <NewsCard />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(STATUS_LABEL).map(([k, v]) => {
            const ls = data.listings.filter(l => l.my_status === k)
            return (
              <Card key={k} size="sm">
                <CardHeader><CardTitle className="flex items-center gap-2"><StatusDot status={k as Status} />{v}</CardTitle><CardDescription>{ls.length} bien{ls.length > 1 ? "s" : ""}</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-1">
                  {ls.map(l => (
                    <button key={l.id} type="button" onClick={() => select(l.id)} className="flex justify-between gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent">
                      <span className="truncate">{l.title ?? `${l.rooms} p. ${l.area} m²`}</span><span className="font-medium whitespace-nowrap">{eur(l.price)}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Alerte de l'API payante</CardTitle>
          <CardDescription>Nouveaux biens et baisses de prix, poussés sur votre téléphone par ntfy</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {!streamOn ? (
            <Alert><AlertTitle>Indisponible</AlertTitle><AlertDescription>{state.stream_estate ? "Cette recherche est en mode OpenData." : "Les alertes nécessitent une clé de l'API payante."}</AlertDescription></Alert>
          ) : alert ? (
            <>
              <p>Alerte active{alert.drop ? `, baisses de ${alert.drop} % ou plus` : ""}.</p>
              {alert.topic && <p className="text-muted-foreground">Abonnez-vous au sujet <b className="text-foreground">{alert.topic}</b> dans l'app ntfy. Quiconque le connaît peut le lire.</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => run({ cmd: "alert", slug, args: { sub: "events" }, label: "Lecture des événements de l'alerte" })}>Lire les événements</Button>
                <Button size="sm" variant="outline" onClick={() => run({ cmd: "alert", slug, args: { sub: alert.enabled === false ? "on" : "off" }, label: alert.enabled === false ? "Réactiver l'alerte" : "Couper l'alerte" })}>{alert.enabled === false ? "Réactiver" : "Couper"}</Button>
              </div>
              {data.events.slice(0, 20).map(e => <div key={e.id} className="flex justify-between text-muted-foreground"><span>{e.type === "NEW_MATCH" ? "Nouveau bien" : e.type === "PRICE_CHANGE" ? "Changement de prix" : e.type}</span><span>{date(e.at)}</span></div>)}
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={askForecast}>Estimer le volume (gratuit)</Button>
              {forecast && <p className="text-muted-foreground">{forecast}</p>}
              <Button size="sm" onClick={() => run({ cmd: "alert", slug, args: { sub: "create" }, label: "Création de l'alerte" })}><BellPlusIcon data-icon="inline-start" />Créer l'alerte</Button>
            </>
          )}
          <p className="text-xs text-muted-foreground">{data.listings.filter(l => isNew(l, lastVisit)).length} annonce(s) nouvelle(s) ou modifiée(s) depuis votre dernière visite.</p>
        </CardContent>
      </Card>
    </div>
  )
}

// the filters over the news, each with its swatch
const FILTERS: Record<string, { label: string; of: (n: NewsItem) => boolean; swatch: string | null }> = {
  all: { label: "Tout", of: () => true, swatch: null },
  dpe: { label: "DPE", of: n => n.kind === "dpe", swatch: `linear-gradient(90deg, ${Object.values(DPE_HEX).join(", ")})` },
  listings: { label: "Annonces", of: n => n.kind === "new" || n.kind === "listings", swatch: "var(--news-new)" },
  prices: { label: "Prix", of: n => n.kind === "price_drop" || n.kind === "price_rise", swatch: "conic-gradient(var(--news-drop) 0 50%, var(--news-rise) 0)" },
  status: { label: "Statuts", of: n => n.kind === "status" || n.kind === "expired", swatch: "var(--news-other)" },
}
const PAGE = 50

// The news, day by day: each kind in its color, the unread ones with a dot. The bell asks for one (newsFocus):
// every kind is shown, it scrolls into view and lights up a moment.
function NewsCard() {
  const { slug, data, unread, reload, newsFocus, focusNews } = useSearch()
  const run = useRun()
  const { items, fresh } = useNews()
  const [filter, setFilter] = useState("all"), [shown, setShown] = useState(PAGE), [seen, setSeen] = useState<string | null>(null)
  const list = items.filter(FILTERS[filter].of), latest = data.feed.items.find(n => n.kind === "listings")
  const days = list.slice(0, shown).reduce<[string, NewsItem[]][]>((out, n) => {
    const d = dayLabel(n.date)
    if (out.at(-1)?.[0] === d) out.at(-1)![1].push(n)
    else out.push([d, [n]])
    return out
  }, [])

  // the one the bell asks for: every kind, and enough of them, shown at once; then on screen, lit up a moment
  if (newsFocus !== seen) {
    setSeen(newsFocus)
    if (newsFocus) {
      setFilter("all")
      setShown(s => Math.max(s, items.findIndex(n => newsKey(n) === newsFocus) + 1))
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
    <Card id="news" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Nouveautés</CardTitle>
        <CardDescription>{unread ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est lu"}{data.search.last_refresh ? `, dernière actualisation le ${date(data.search.last_refresh)}` : ""}</CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!unread} onClick={async () => { await api.readFeed(slug); await reload() }}><CheckCheckIcon data-icon="inline-start" /><span className="max-sm:sr-only">Tout marquer comme lu</span></Button>
          <Button variant="outline" size="sm" onClick={() => run({ cmd: "refresh", slug, label: "Actualisation de la recherche" })}><RefreshCwIcon data-icon="inline-start" /><span className="max-sm:sr-only">Actualiser</span></Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length > 0 && (
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={filter} onValueChange={v => { if (v) { setFilter(v); setShown(PAGE) } }} className="flex-wrap" aria-label="Filtrer les nouveautés">
            {Object.entries(FILTERS).map(([k, f]) => {
              const count = items.filter(f.of).length
              return (k === "all" || count > 0) && (
                <ToggleGroupItem key={k} value={k}>
                  {f.swatch && <i aria-hidden className="size-2.5 rounded-full" style={{ background: f.swatch }} />}{f.label}<span className="text-muted-foreground tabular-nums">{count}</span>
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        )}
        {!items.length && <p className="text-sm text-muted-foreground">Rien de nouveau. Le serveur du dashboard vérifie les DPE et les annonces de la zone à son démarrage, puis régulièrement.</p>}
        {days.map(([day, ns]) => (
          <section key={day} aria-label={day} className="flex flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-muted-foreground">{day}</h3>
            <ol className="flex flex-col gap-0.5">
              {ns.map(n => <NewsRow key={newsKey(n)} n={n} fresh={fresh(n)} lit={newsFocus === newsKey(n)} latest={n === latest} />)}
            </ol>
          </section>
        ))}
        {list.length > shown && <Button variant="ghost" size="sm" className="self-center" onClick={() => setShown(s => s + PAGE)}>Afficher les {Math.min(PAGE, list.length - shown)} suivantes</Button>}
      </CardContent>
    </Card>
  )
}

// One news: its tile, its kind in its color, what it is about and where, then its price, its status or its action.
// A listing's opens its dossier.
function NewsRow({ n, fresh, lit, latest }: { n: NewsItem; fresh: boolean; lit: boolean; latest: boolean }) {
  const { slug, data, state, select, addFeedback } = useSearch()
  const run = useRun()
  const { label, color } = LOOK[n.kind], streamOn = state.stream_estate && data.search.mode === "stream-estate"
  const title = cn("block max-w-full truncate text-left text-sm", fresh ? "font-medium" : "text-muted-foreground")
  const detail = "l" in n ? n.l.location.address ?? n.l.location.neighborhood ?? n.l.location.city ?? `Source : ${SOURCE_LABEL[n.l.source]}`
    : n.kind === "dpe" ? `DPE ${n.dpe.energy} du ${date(n.dpe.date)}, ${n.dpe.address ?? "adresse inconnue"}, sans annonce`
    : `${n.count} à récupérer, ${credits(n.count, state.usage.eur_per_credit)}`
  return (
    <li id={`news-${newsKey(n)}`}
      className={cn("relative grid scroll-mt-4 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 transition-colors duration-700 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        "l" in n && "hover:bg-accent/60", lit && "bg-accent outline-2 -outline-offset-2 outline-ring")}>
      <NewsTile n={n} dim={!fresh} />
      <div className="min-w-0">
        <p className="text-xs font-semibold" style={{ color }}>{label}{fresh && <span className="sr-only">, non lue</span>}</p>
        {"l" in n
          ? <button type="button" onClick={() => select(n.l.id)} className={cn(title, "after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring")}>{newsTitle(n)}</button>
          : <p className={title}>{newsTitle(n)}</p>}
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
        {(n.kind === "price_drop" || n.kind === "price_rise") && (
          <>
            <s className="text-xs text-muted-foreground tabular-nums">{eur(n.from as number)}</s>
            <span className="text-sm font-semibold tabular-nums">{eur(n.to as number)}</span>
            <span className="rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums" style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>
              {pct(((n.to as number) - (n.from as number)) / (n.from as number), 1)}
            </span>
          </>
        )}
        {n.kind === "new" && <span className="text-sm font-semibold tabular-nums">{eur(n.to as number)}</span>}
        {(n.kind === "status" || n.kind === "expired") && <Badge variant="outline">{SALE_STATUS[String(n.to)] ?? n.to}</Badge>}
        {n.kind === "dpe" && (
          <Button variant="outline" size="xs" onClick={() => { addFeedback({ kind: "chercher", text: dpeAsk(n.dpe) }); toast.success("Ajouté au prompt : Claude cherchera l'annonce") }}>
            <SearchIcon data-icon="inline-start" />Chercher l'annonce
          </Button>
        )}
        {latest && streamOn && <Button size="xs" onClick={() => run({ cmd: "fetch", slug, label: "Annonces de l'API payante" })}><DownloadIcon data-icon="inline-start" />Récupérer</Button>}
        <span className="ml-auto flex items-center gap-2 sm:ml-0">
          <time dateTime={n.date} className="text-xs text-muted-foreground tabular-nums">{clockOf(n.date)}</time>
          {fresh ? <UnreadDot /> : <i aria-hidden className="size-2" />}
        </span>
      </div>
    </li>
  )
}
