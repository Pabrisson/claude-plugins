import { BellPlusIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"

import { useRun } from "@/components/run-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import { date, eur, num, SALE_STATUS, STATUS_LABEL } from "@/lib/format"
import { isNew } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { StatusDot } from "@/components/status"
import type { Status } from "@/lib/api"

const KIND = { new: "Nouvelle annonce", price_drop: "Baisse de prix", price_rise: "Hausse de prix", status: "Changement de statut", expired: "Annonce expirée" } as const

export function FollowTab() {
  const { slug, data, state, lastVisit, select } = useSearch()
  const run = useRun()
  const [forecast, setForecast] = useState<string | null>(null)
  const streamOn = state.stream_estate && data.search.mode === "stream-estate", alert = data.search.alert
  const changes = data.listings.flatMap(l => (l.changes ?? []).filter(c => !lastVisit || c.date > lastVisit).map(c => ({ ...c, l }))).sort((a, b) => b.date.localeCompare(a.date))

  async function askForecast() {
    const r = await api.run({ cmd: "alert", slug, args: { sub: "forecast" } })
    if (r.code !== 0) return setForecast(r.err.replace(/^error: /, ""))
    const f = JSON.parse(r.out)
    setForecast(`Environ ${num(f.per_day?.average ?? f.total / (f.window_days || 30))} notification(s) par jour (${num(f.total)} sur ${f.window_days} jours).`)
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Nouveautés</CardTitle>
            <CardDescription>{lastVisit ? `Depuis votre dernière visite, le ${date(lastVisit)}` : "Première visite"}{data.search.last_refresh ? ` · dernière actualisation le ${date(data.search.last_refresh)}` : ""}</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => run({ cmd: "refresh", slug, label: "Actualisation de la recherche" })}><RefreshCwIcon data-icon="inline-start" />Actualiser</Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {!changes.length && <p className="text-sm text-muted-foreground">Rien de nouveau.</p>}
            {changes.slice(0, 50).map((c, i) => (
              <button key={i} type="button" onClick={() => select(c.l.id)} className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span><Badge variant={c.kind === "price_drop" ? "default" : "secondary"}>{KIND[c.kind]}</Badge> <span className="ml-1">{c.l.title ?? `${c.l.rooms} p. ${c.l.area} m²`}</span></span>
                <span className="text-right text-muted-foreground">
                  {c.kind === "price_drop" || c.kind === "price_rise" ? `${eur(c.from as number)} → ${eur(c.to as number)}` : c.kind === "status" || c.kind === "expired" ? SALE_STATUS[String(c.to)] ?? c.to : eur(c.to as number)} · {date(c.date)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
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
            <Alert><AlertTitle>Indisponible</AlertTitle><AlertDescription>{state.stream_estate ? "Cette recherche est en mode Classique." : "Les alertes nécessitent une clé de l'API payante."}</AlertDescription></Alert>
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
