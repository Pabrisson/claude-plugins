import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { date, num } from "@/lib/format"
import { useSearch } from "@/lib/store"

const euros = (n: number, rate: number) => `${(n * rate).toFixed(2).replace(".", ",")} €`

// The credits spent: this month against the cap, per search, per route, the last calls, each route's price, and
// Stream Estate's own count to check the local log against.
export function CostsTab() {
  const { state, slug } = useSearch()
  const u = state.usage, rate = u.eur_per_credit
  const [remote, setRemote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function reconcile() {
    setBusy(true)
    const r = await api.run({ cmd: "usage", args: { remote: true } })
    setRemote(r.code === 0 ? r.out : r.err)
    setBusy(false)
  }
  const ratio = u.cap ? Math.min(1, u.month / u.cap) : 0

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Ce mois-ci</CardTitle>
          <CardDescription>{num(u.last30)} crédits sur 30 jours · {u.unknown ? `${u.unknown} appel(s) de coût inconnu` : "aucun appel de coût inconnu"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight">{num(u.month)} crédits</span>
            <span className="text-muted-foreground">{euros(u.month, rate)} · plafond {num(u.cap)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Crédits du mois" aria-valuenow={u.month} aria-valuemin={0} aria-valuemax={u.cap}>
            <div className={ratio >= 0.9 ? "h-full bg-destructive" : "h-full bg-foreground"} style={{ width: `${ratio * 100}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">Il reste {num(Math.max(0, u.cap - u.month))} crédits avant le plafond. Le moteur refuse de le dépasser sans votre accord donné à Claude.</p>
          {!state.stream_estate && <Alert><AlertTitle>Stream Estate désactivé</AlertTitle><AlertDescription>Sans clé, rien n'est facturé : open data et annonces assistées uniquement.</AlertDescription></Alert>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Rapprochement</CardTitle>
          <CardDescription>Le journal local comparé au décompte de Stream Estate</CardDescription>
          <CardAction><Button variant="outline" size="sm" disabled={!state.stream_estate || busy} onClick={reconcile}>{busy && <Spinner data-icon="inline-start" />}Comparer</Button></CardAction>
        </CardHeader>
        <CardContent>
          {remote ? <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{remote}</pre> : <p className="text-sm text-muted-foreground">{state.stream_estate ? "Lit l'usage du compte sur 30 jours (gratuit a priori)." : "Nécessite Stream Estate."}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Par recherche et par mois</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Recherche</TableHead><TableHead className="text-right">Appels</TableHead><TableHead className="text-right">Crédits</TableHead><TableHead className="text-right">€</TableHead></TableRow></TableHeader>
            <TableBody>
              {!Object.keys(u.by_search).length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Aucun appel facturable pour l'instant.</TableCell></TableRow>}
              {Object.entries(u.by_search).map(([k, v]) => <TableRow key={k} data-state={k === slug ? "selected" : undefined}><TableCell>{k === "-" ? "Hors recherche" : k}</TableCell><TableCell className="text-right">{v.calls}</TableCell><TableCell className="text-right">{num(v.credits)}</TableCell><TableCell className="text-right">{euros(v.credits, rate)}</TableCell></TableRow>)}
              {Object.entries(u.by_month).map(([k, v]) => <TableRow key={k}><TableCell className="text-muted-foreground">{k}</TableCell><TableCell /><TableCell className="text-right">{num(v)}</TableCell><TableCell className="text-right">{euros(v, rate)}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Prix des fonctions</CardTitle><CardDescription>Documentés, mesurés ou inconnus : une fonction inconnue demande votre accord</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {Object.entries(state.costs).map(([r, c]) => <TableRow key={r}><TableCell className="font-mono text-xs">{r}</TableCell><TableCell className="text-right">{c.credits == null ? "inconnu" : `${c.credits}${c.per ? " par résultat" : ""}`}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Derniers appels</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Fonction</TableHead><TableHead>Recherche</TableHead><TableHead className="text-right">Résultats</TableHead><TableHead className="text-right">Crédits</TableHead></TableRow></TableHeader>
            <TableBody>
              {state.log.toReversed().slice(0, 50).map((e, i) => <TableRow key={i}><TableCell>{date(e.date)}</TableCell><TableCell className="font-mono text-xs">{e.route}</TableCell><TableCell>{e.search ?? "—"}</TableCell><TableCell className="text-right">{e.results}</TableCell><TableCell className="text-right">{e.credits ?? "?"}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
