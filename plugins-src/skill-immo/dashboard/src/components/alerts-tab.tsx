import { alertsOf, EVENTS as ENGINE_EVENTS, FIELDS, streetOf, takes } from "@engine/alerts.js"
import { BellRingIcon, GaugeIcon, GlobeIcon, HexagonIcon, LockIcon, MapPinIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { LOOK, NewsTile, newsKey, newsTitle, useNews, type NewsBase } from "@/components/news"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Alert, type AlertEvent, type AlertField, type Alerts, type AuditRow, type Condition, type DpeRow, type PermitRow, type Place } from "@/lib/api"
import { date, num, PERMIT_LABEL, permitLabel, STATUS_LABEL, TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

// the default alerts (engine lib/alerts.js DEFAULTS): the follow-up, each on by default
const DEFAULT_LOOK: Record<string, { name: string; text: string; kind: keyof typeof LOOK }> = {
  dpe: { name: "Nouveaux DPE sans annonce", text: "Un DPE récent de la zone, d'un bien de vos types et critères, qu'aucune annonce n'explique : peut-être un bien bientôt en vente.", kind: "dpe" },
  new: { name: "Nouvelles annonces", text: "Chaque annonce qui entre dans la recherche.", kind: "new" },
  price_drop: { name: "Baisses de prix", text: "Une annonce suivie baisse son prix.", kind: "price_drop" },
  price_rise: { name: "Hausses de prix", text: "Une annonce suivie monte son prix.", kind: "price_rise" },
  status: { name: "Statuts", text: "Sous offre, vendue ou retirée.", kind: "status" },
  expired: { name: "Annonces suivies expirées", text: "Une annonce à laquelle vous avez donné un statut n'est plus en ligne. Celles à trier disparaissent sans bruit de la carte et des cartes (la Liste les garde).", kind: "expired" },
  audit: { name: "Nouveaux audits énergétiques", text: "Un audit énergétique récent de la zone : obligatoire pour vendre une maison ou un immeuble entier classé E, F ou G, souvent une vente proche.", kind: "audit" },
  permit: { name: "Nouveaux permis", text: "Un permis de construire, de démolir ou d'aménager autorisé dans la zone : un terrain, un programme neuf, des travaux à côté.", kind: "permit" },
}
// the events: those of a source, watched anywhere (« Où »), then those of the listings, in the search's zone only
const EVENTS = Object.keys(ENGINE_EVENTS) as AlertEvent[]
const anywhere = (e: AlertEvent) => !!(ENGINE_EVENTS[e] as { anywhere?: boolean }).anywhere
const EVENT_LABEL: Record<AlertEvent, string> = { dpe: "Nouveau DPE", audit: "Nouvel audit énergétique", permit: "Nouveau permis", new: "Nouvelle annonce", price_drop: "Baisse de prix", price_rise: "Hausse de prix", status: "Changement de statut", expired: "Annonce expirée" }
const FIELD_LABEL: Record<AlertField, string> = {
  street: "Rue", type: "Type de bien", energy: "Classe DPE", area: "Surface (m²)", price: "Prix (€)", price_per_m2: "Prix au m² (€)", rooms: "Pièces",
  change_pct: "Variation de prix (%)", favorite: "En favori", my_status: "Mon statut", criteria: "Dans les critères de la recherche",
  building: "Immeuble entier", permit_kind: "Nature du permis", homes: "Logements créés",
}
type Kind = "text" | "number" | "class" | "type" | "status" | "bool" | "permit"
const OP_LABEL: Record<Kind, Record<string, string>> = {
  text: { contains: "contient", is: "est" }, number: { gte: "au moins", lte: "au plus" }, class: { lte: "jusqu'à", gte: "à partir de" },
  type: { is: "est" }, status: { is: "est", not: "n'est pas" }, bool: { is: "est" }, permit: { is: "est" },
}
// what a source's preview reads at a place
const SOURCE_LABEL: Partial<Record<AlertEvent, string>> = { dpe: "DPE", audit: "audits énergétiques", permit: "permis" }
const STATUS_VALUE: Record<string, string> = { none: "Aucun", ...STATUS_LABEL }
const PLACE_LABEL = { zone: "Zone de la recherche", street: "Une rue", radius: "Autour d'une adresse", commune: "Une commune" } as const
const kindOf = (f: AlertField) => FIELDS[f].kind as Kind
const fresh = (field: AlertField): Condition => {
  const k = kindOf(field)
  return { field, op: Object.keys(OP_LABEL[k])[0], value: { text: "", number: "", class: "E", type: "flat", status: "to_visit", bool: true, permit: "demolish" }[k] }
}
const valueLabel = (c: Condition) => {
  const k = kindOf(c.field)
  return k === "text" ? `« ${c.value} »` : k === "number" ? num(+c.value) : k === "type" ? TYPE_LABEL[c.value as keyof typeof TYPE_LABEL]
    : k === "status" ? STATUS_VALUE[String(c.value)] : k === "bool" ? (c.value ? "oui" : "non") : k === "permit" ? PERMIT_LABEL[c.value as keyof typeof PERMIT_LABEL] : String(c.value)
}
// « Nouveau DPE · Classe DPE à partir de F »
export const summary = (a: Pick<Alert, "event" | "conditions">) => [EVENT_LABEL[a.event], ...a.conditions.map(c => `${FIELD_LABEL[c.field]} ${OP_LABEL[kindOf(c.field)][c.op]} ${valueLabel(c)}`)].join(" · ")
// the fields a condition may take: those of the alert's event
const fieldsFor = (e: AlertEvent) => (Object.keys(FIELD_LABEL) as AlertField[]).filter(f => FIELDS[f].events.includes(e))

// Where an alert looks, as a pill: the globe for a place of its own (anywhere in France), the zone's hexagon otherwise
export function Scope({ place, className }: { place?: Place; className?: string }) {
  const away = place && place.how !== "zone"
  return (
    <Badge variant="outline" className={cn("max-w-56 shrink-0 gap-1 font-normal text-muted-foreground", className)} title={away ? `${PLACE_LABEL[place.how]} : ${place.label}` : "Dans la zone de la recherche"}>
      {away ? <GlobeIcon /> : <HexagonIcon />}<span className="truncate">{away ? (place.how === "radius" ? `${num(place.radius_m)} m · ${place.label}` : place.label) : "Zone"}</span>
    </Badge>
  )
}

// starting points for the user's own alerts
type Template = { name: string; event: AlertEvent; place?: "street"; conditions: Condition[] }
const TEMPLATES: Template[] = [
  { name: "DPE dans une rue", event: "dpe", place: "street", conditions: [] },
  { name: "Passoires thermiques", event: "dpe", conditions: [{ field: "energy", op: "gte", value: "F" }] },
  { name: "Grosse baisse de prix", event: "price_drop", conditions: [{ field: "change_pct", op: "gte", value: 5 }] },
  { name: "Baisse sur mes favoris", event: "price_drop", conditions: [{ field: "favorite", op: "is", value: true }] },
  { name: "Audits dans une rue", event: "audit", place: "street", conditions: [] },
  { name: "Démolitions", event: "permit", conditions: [{ field: "permit_kind", op: "is", value: "demolish" }] },
]

// The search's alerts: the user's own, then the default ones, each one event at a place with conditions; what they
// take goes to « Suivi », the bell and the desktop notifications
export function AlertsTab() {
  const { slug, data, reload } = useSearch()
  const { all } = useNews()
  const [editing, setEditing] = useState<Alert | null>(null)
  const alerts = alertsOf(data.alerts) as Alert[], custom = (data.alerts.custom ?? []) as Alert[], off = data.alerts.off ?? []
  const count = (a: Alert) => all.filter(n => takes(a, n, data.search)).length

  async function save(next: Alerts, done?: string) {
    try {
      await api.saveAlerts(slug, next)
      await reload()
      if (done) toast.success(done)
    } catch (e) {
      toast.error("L'alerte n'a pas été enregistrée", { description: `Détail technique : ${(e as Error).message}` })
    }
  }
  const toggleDefault = (id: string, on: boolean) => save({ off: on ? off.filter(x => x !== id) : [...off, id], custom })
  const toggleMine = (id: string, on: boolean) => save({ off, custom: custom.map(a => (a.id === id ? { ...a, enabled: on } : a)) })
  const remove = async (a: Alert) => {
    const before = data.alerts
    await save({ off, custom: custom.filter(x => x.id !== a.id) })
    toast(`Alerte « ${a.name} » supprimée`, { action: { label: "Annuler", onClick: () => save(before) } })
  }
  const put = (a: Alert) => save({ off, custom: custom.some(x => x.id === a.id) ? custom.map(x => (x.id === a.id ? a : x)) : [...custom, a] }, `Alerte « ${a.name} » enregistrée`)
  // a street to start from: the search's own, when it is one
  const s = data.search, ownStreet: Place | undefined = s.type === "street" && s.ban ? { how: "street", ban: s.ban, label: s.label, point: s.point } : undefined
  const start = (t?: Template) => setEditing({
    id: `a-${Date.now().toString(36)}`, enabled: true, name: t?.name ?? "", event: t?.event ?? "dpe", conditions: t?.conditions ?? [],
    place: t?.place === "street" ? ownStreet ?? { how: "zone" } : { how: "zone" },
  })

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Mes alertes</CardTitle>
          <CardDescription>Ce que vous voulez voir passer : un nouveau DPE ou un audit énergétique dans une rue, même hors de la zone, une passoire thermique, une démolition, une baisse de plus de 5 %…</CardDescription>
          <CardAction><Button size="sm" onClick={() => start()}><PlusIcon data-icon="inline-start" />Nouvelle alerte</Button></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {custom.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {custom.map(a => (
                <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/50">
                  <span aria-hidden className={cn("grid size-9 place-items-center rounded-lg bg-primary/15 text-primary transition-opacity", !a.enabled && "opacity-55")}><BellRingIcon className="size-4.5" /></span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className={cn("truncate text-sm font-medium", !a.enabled && "text-muted-foreground")}>{a.name}</p>
                    <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Scope place={a.place} /><span className="truncate">{summary(a)}</span></p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-2 text-xs text-muted-foreground tabular-nums max-sm:hidden">{num(count(a))} reçue{count(a) > 1 ? "s" : ""}</span>
                    <Button variant="ghost" size="icon-sm" aria-label={`Modifier l'alerte ${a.name}`} onClick={() => setEditing(a)}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Supprimer l'alerte ${a.name}`} onClick={() => remove(a)}><Trash2Icon /></Button>
                    <Switch className="ml-2" checked={a.enabled} onCheckedChange={v => toggleMine(a.id, v)} aria-label={`Alerte ${a.name} ${a.enabled ? "active" : "coupée"}`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{custom.length ? "Partir d'un modèle :" : "Aucune alerte à vous pour l'instant. Partir d'un modèle :"}</span>
            {TEMPLATES.map(t => <Button key={t.name} variant="outline" size="xs" onClick={() => start(t)}>{t.name}</Button>)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Alertes par défaut</CardTitle>
          <CardDescription>Le suivi de la zone : chacune est active tant que vous ne la coupez pas. Une nouveauté qu'une de vos alertes retient arrive quand même.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-0.5">
            {alerts.filter(a => a.builtin).map(a => {
              const look = DEFAULT_LOOK[a.id], { color, Icon } = LOOK[look.kind], n = count(a)
              return (
                <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5">
                  <span aria-hidden className={cn("grid size-9 place-items-center rounded-lg transition-opacity", !a.enabled && "opacity-55")} style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>
                    {Icon ? <Icon className="size-4.5" /> : <GaugeIcon className="size-4.5" />}
                  </span>
                  <div className="min-w-0">
                    <p className={cn("flex items-center gap-2 text-sm font-medium", !a.enabled && "text-muted-foreground")}>{look.name}<Scope /></p>
                    <p className="text-xs text-muted-foreground">{look.text}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums max-sm:hidden">{num(n)} reçue{n > 1 ? "s" : ""}</span>
                    <Switch checked={a.enabled} onCheckedChange={v => toggleDefault(a.id, v)} aria-label={`${look.name} ${a.enabled ? "active" : "coupée"}`} />
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
      <AlertEditor alert={editing} known={custom.some(a => a.id === editing?.id)} onClose={() => setEditing(null)} onSave={a => { put(a); setEditing(null) }} />
    </div>
  )
}

// One of the user's alerts, made or changed: its name, its event, its place, its conditions (all of them true), and
// what it would have taken
function AlertEditor({ alert, known, onClose, onSave }: { alert: Alert | null; known: boolean; onClose: () => void; onSave: (a: Alert) => void }) {
  return (
    <Dialog open={!!alert} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {alert && <EditorForm key={alert.id} alert={alert} known={known} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  )
}

function EditorForm({ alert, known, onClose, onSave }: { alert: Alert; known: boolean; onClose: () => void; onSave: (a: Alert) => void }) {
  const { slug, data } = useSearch()
  const { all } = useNews()
  const [name, setName] = useState(alert.name), [event, setEvent] = useState<AlertEvent>(alert.event), [conditions, setConditions] = useState(alert.conditions)
  // the kind of place, and the place once found (null while the user looks for it)
  const [how, setHow] = useState<Place["how"]>(alert.place?.how ?? "zone"), [place, setPlace] = useState<Place | null>(alert.place && alert.place.how !== "zone" ? alert.place : null)
  const fields = fieldsFor(event), away = anywhere(event) && how !== "zone"
  const draft: Alert = { ...alert, name: name.trim(), event, place: away ? place ?? undefined : { how: "zone" }, conditions }
  const ready = !!draft.name && (!away || !!place) && conditions.every(c => String(c.value).trim() !== "")
  // an event of the zone only: back to the zone, and its conditions only
  const pick = (e: AlertEvent) => {
    setEvent(e)
    setConditions(cs => cs.filter(c => fieldsFor(e).includes(c.field)))
    if (!anywhere(e)) setHow("zone")
  }
  // the streets the zone's DPE, listings and sales name, to pick from
  const streets = useMemo(() => {
    const out = new Map<string, string>()
    const dpe = Array.isArray(data.area.dpe_recent) ? data.area.dpe_recent.map(d => streetOf(d.address)) : []
    for (const s of [data.search.street?.name, ...dpe, ...data.listings.map(l => streetOf(l.location.address)), ...Object.values(data.market.dvf ?? {}).flatMap(d => d?.streets?.map(x => x.name) ?? [])])
      if (s && !out.has(s.toLowerCase())) out.set(s.toLowerCase(), s)
    return [...out.values()].sort((a, b) => a.localeCompare(b, "fr"))
  }, [data])
  const set = (i: number, c: Partial<Condition>) => setConditions(cs => cs.map((x, k) => (k === i ? { ...x, ...c } : x)))

  // what it would have taken: the news already in for the zone, the DPE, audits or permits of the last 12 months at a
  // place (the server) (each answer kept with the draft it answers: another draft is loading)
  const [answer, setAnswer] = useState<{ key: string; r: { count: number; items: (DpeRow | AuditRow | PermitRow)[] } | "error" } | null>(null)
  const key = JSON.stringify(draft), asks = away && !!place && ready
  useEffect(() => {
    if (!asks) return
    const t = setTimeout(() => api.previewAlert(slug, JSON.parse(key)).then(r => setAnswer({ key, r }), () => setAnswer({ key, r: "error" })), 400)
    return () => clearTimeout(t)
  }, [key, asks, slug])
  const remote = asks ? (answer?.key === key ? answer.r : "loading") : null
  const hits = away ? [] : all.filter(n => takes(draft, n, data.search))

  return (
    // min-w-0: the dialog's grid lets it shrink, so that a long preview line truncates instead of widening it
    <form onSubmit={e => { e.preventDefault(); if (ready) onSave(draft) }} className="flex min-w-0 flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{known ? `Alerte « ${alert.name} »` : "Nouvelle alerte"}</DialogTitle>
        <DialogDescription>Elle retient les nouveautés qui remplissent toutes ses conditions, et les envoie dans le suivi.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="a-name">Nom</FieldLabel>
          <Input id="a-name" value={name} onChange={e => setName(e.target.value)} placeholder="DPE rue Garibaldi" maxLength={80} required />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Quand</FieldLegend>
          <div className="grid items-start gap-x-4 gap-y-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <span className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground"><GlobeIcon className="size-3.5" />Partout, lieu au choix</span>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={anywhere(event) ? event : ""} onValueChange={v => v && pick(v as AlertEvent)} className="flex-wrap justify-start" aria-label="Événements partout">
              {EVENTS.filter(anywhere).map(e => <ToggleGroupItem key={e} value={e}>{EVENT_LABEL[e]}</ToggleGroupItem>)}
            </ToggleGroup>
            <span className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground"><HexagonIcon className="size-3.5" />Zone de la recherche</span>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={anywhere(event) ? "" : event} onValueChange={v => v && pick(v as AlertEvent)} className="flex-wrap justify-start" aria-label="Événements de la zone">
              {EVENTS.filter(e => !anywhere(e)).map(e => <ToggleGroupItem key={e} value={e}>{EVENT_LABEL[e]}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        </FieldSet>
        <FieldSet>
          <FieldLegend variant="label">Où</FieldLegend>
          {anywhere(event) ? (
            <>
              <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={how} onValueChange={v => { if (v) { setHow(v as Place["how"]); setPlace(null) } }} className="flex-wrap justify-start" aria-label="Lieu">
                {(Object.keys(PLACE_LABEL) as Place["how"][]).map(h => <ToggleGroupItem key={h} value={h}>{h === "zone" ? <HexagonIcon /> : <GlobeIcon />}{PLACE_LABEL[h]}</ToggleGroupItem>)}
              </ToggleGroup>
              {how === "zone" ? <FieldDescription>{data.search.zone.label}</FieldDescription> : <PlacePicker how={how} value={place} onChange={setPlace} />}
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"><LockIcon className="size-4 shrink-0" /><HexagonIcon className="size-4 shrink-0" />Zone de la recherche — {data.search.zone.label}</p>
              <FieldDescription>Les annonces ne sont suivies que dans la zone de la recherche.</FieldDescription>
            </>
          )}
        </FieldSet>
        <FieldSet>
          <FieldLegend variant="label">Si</FieldLegend>
          {conditions.length === 0 && <p className="text-sm text-muted-foreground">Sans condition : chaque {EVENT_LABEL[event][0].toLowerCase() + EVENT_LABEL[event].slice(1)}{away ? " à cet endroit" : ""}.</p>}
          <datalist id="a-streets">{streets.map(s => <option key={s} value={s} />)}</datalist>
          {conditions.map((c, i) => {
            const k = kindOf(c.field)
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={c.field} onValueChange={f => set(i, fresh(f as AlertField))}>
                  <SelectTrigger size="sm" className="w-44" aria-label="Champ"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{fields.map(f => <SelectItem key={f} value={f}>{FIELD_LABEL[f]}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <Select value={c.op} onValueChange={op => set(i, { op })}>
                  <SelectTrigger size="sm" aria-label="Opérateur"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{Object.entries(OP_LABEL[k]).map(([op, l]) => <SelectItem key={op} value={op}>{l}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <ValueInput c={c} onChange={value => set(i, { value })} />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Retirer la condition" onClick={() => setConditions(cs => cs.filter((_, x) => x !== i))}><XIcon /></Button>
              </div>
            )
          })}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setConditions(cs => [...cs, fresh(fields.includes("energy") ? "energy" : fields[0])])}>
            <PlusIcon data-icon="inline-start" />Ajouter une condition
          </Button>
          <FieldDescription>Toutes les conditions doivent être vraies ; une valeur inconnue (une annonce sans adresse) ne passe pas.</FieldDescription>
        </FieldSet>
      </FieldGroup>
      <section aria-label="Aperçu" aria-live="polite" className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
        {away ? (
          !place ? <p className="text-sm text-muted-foreground">Choisissez le lieu : l'aperçu montre ses {SOURCE_LABEL[event]} des 12 derniers mois.</p>
            : remote === "loading" ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Lecture des {SOURCE_LABEL[event]} à cet endroit…</p>
            : remote === "error" ? <p className="text-sm text-muted-foreground">{event === "permit" ? "Sitadel" : "L'ADEME"} ne répond pas pour l'instant : l'alerte marchera quand même.</p>
            : remote && (
              <>
                <p className="text-sm font-medium">Sur les 12 derniers mois à cet endroit, elle en aurait retenu {num(remote.count)}. Seuls ceux publiés à partir d'aujourd'hui arriveront dans le suivi.</p>
                {remote.items.slice(0, 3).map(d => <PreviewLine key={d.number} n={{ kind: event, date: d.date, [event]: d } as unknown as NewsBase} />)}
              </>
            )
        ) : (
          <>
            <p className="text-sm font-medium">Parmi les nouveautés déjà reçues, elle en aurait retenu {num(hits.length)}.</p>
            {hits.slice(0, 3).map(n => <PreviewLine key={newsKey(n)} n={n} />)}
          </>
        )}
      </section>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
        <Button type="submit" disabled={!ready}>Enregistrer</Button>
      </DialogFooter>
    </form>
  )
}

// a news of the preview: its tile, its kind, what and where
function PreviewLine({ n }: { n: NewsBase }) {
  const where = n.kind === "dpe" ? `${n.dpe.address ?? "adresse inconnue"}, DPE du ${date(n.dpe.date)}`
    : n.kind === "audit" ? `${n.audit.address ?? "adresse inconnue"}, audit du ${date(n.audit.date)}`
    : n.kind === "permit" ? `${n.permit.address}, ${permitLabel(n.permit).toLowerCase()} du ${date(n.permit.date)}` : "l" in n ? n.l.location.address : null
  return (
    <div className="flex items-center gap-3">
      <NewsTile n={n} className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold" style={{ color: LOOK[n.kind].color }}>{LOOK[n.kind].label}</span>
        <span className="block truncate text-sm">{newsTitle(n)}{where ? ` · ${where}` : ""}</span>
      </span>
    </div>
  )
}

// An alert's place: the address autocomplete (free), then the server finds the street's BAN id, the commune's code
// or the address's point; a circle gets its radius
function PlacePicker({ how, value, onChange }: { how: "street" | "commune" | "radius"; value: Place | null; onChange: (p: Place | null) => void }) {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ fulltext: string; kind: string }[]>([]), [busy, setBusy] = useState(false)
  const [radius, setRadius] = useState(value?.how === "radius" ? value.radius_m : 300)
  useEffect(() => {
    if (q.length < 3) return
    const t = setTimeout(() => api.autocomplete(q).then(setHits).catch(() => setHits([])), 200)
    return () => clearTimeout(t)
  }, [q])
  async function choose(text: string) {
    setBusy(true)
    try { onChange(await api.place(how, text, radius)); setQ("") } catch { toast.error("Lieu introuvable", { description: "Essayez une adresse plus précise." }) }
    setBusy(false)
  }
  return (
    <div className="flex flex-col gap-3">
      {value && value.how !== "zone" ? (
        <p className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><MapPinIcon className="size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{value.label}</span><Button type="button" variant="ghost" size="xs" onClick={() => onChange(null)}>Changer</Button></p>
      ) : (
        <Command shouldFilter={false} className="rounded-lg border">
          <CommandInput placeholder={{ street: "Rue Garibaldi, Lyon", commune: "Villeurbanne", radius: "12 cours Gambetta, Lyon" }[how]} value={q} onValueChange={setQ} />
          {q.length >= 3 && (
            <CommandList>
              <CommandEmpty>{busy ? "Recherche…" : "Aucun lieu trouvé."}</CommandEmpty>
              <CommandGroup>{hits.map(h => <CommandItem key={h.fulltext} value={h.fulltext} onSelect={() => choose(h.fulltext)}><MapPinIcon />{h.fulltext}</CommandItem>)}</CommandGroup>
            </CommandList>
          )}
        </Command>
      )}
      {how === "radius" && (
        <Field>
          <FieldLabel>Rayon : {num(radius)} m</FieldLabel>
          <Slider min={100} max={2000} step={50} value={[radius]} onValueChange={([v]) => { setRadius(v); if (value?.how === "radius") onChange({ ...value, radius_m: v }) }} aria-label="Rayon" />
        </Field>
      )}
    </div>
  )
}

// a condition's value, as its field's kind asks
function ValueInput({ c, onChange }: { c: Condition; onChange: (v: Condition["value"]) => void }) {
  const k = kindOf(c.field)
  if (k === "text") return <Input className="h-8 min-w-36 flex-1" list="a-streets" value={String(c.value)} onChange={e => onChange(e.target.value)} placeholder="Rue Paul Bert" aria-label="Valeur" />
  if (k === "number") return <Input className="h-8 w-28" type="number" inputMode="decimal" value={String(c.value)} onChange={e => onChange(e.target.value === "" ? "" : +e.target.value)} aria-label="Valeur" />
  const options: Record<string, string> = k === "class" ? Object.fromEntries([..."ABCDEFG"].map(x => [x, x])) : k === "type" ? TYPE_LABEL : k === "status" ? STATUS_VALUE : k === "permit" ? PERMIT_LABEL : { true: "Oui", false: "Non" }
  return (
    <Select value={String(c.value)} onValueChange={v => onChange(k === "bool" ? v === "true" : v)}>
      <SelectTrigger size="sm" aria-label="Valeur"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{Object.entries(options).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  )
}
