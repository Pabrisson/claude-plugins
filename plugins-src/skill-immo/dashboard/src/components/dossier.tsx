import { budget, RENT_BAN } from "@engine/budget.js"
import { inGeometry } from "@engine/geo.js"
import { daysOnline, dropped, negotiation } from "@engine/market.js"
import { ExternalLinkIcon, MessageSquarePlusIcon, ScaleIcon, SearchCheckIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Dpe } from "@/components/dpe"
import { nearby } from "@/components/map-view"
import { Gap, Ruler } from "@/components/ruler"
import { useRun } from "@/components/run-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Listing, type Status } from "@/lib/api"
import { ACCURACY_LABEL, date, eur, m2, pct, POI_LABEL, SALE_STATUS, share, SOURCE_LABEL, STATUS_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { useIsMobile } from "@/lib/use-mobile"

const REASON: Record<string, (v: number | boolean) => string> = {
  above_market: v => `affiché ${pct(v as number)} au-dessus du vendu`,
  days_online: v => `${v} jours en ligne`,
  urgent: () => "mention urgent",
  already_dropped: v => `déjà baissé de ${share(v as number, 1)}`,
}
const RISK_KEYS: Record<string, string> = { DE_1949_A_1960: "1949–1960", DE_1961_A_1974: "1961–1974", DE_1975_A_1993: "1975–1993", DE_1994_A_2000: "1994–2000", DE_2001_A_2010: "2001–2010", A_COMPTER_DE_2011: "depuis 2011", AVANT_1949: "avant 1949", NON_CONNUE: "inconnue" }

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}
function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground" title={hint}>{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}

export function Dossier() {
  const { data, selected, select } = useSearch()
  const mobile = useIsMobile()
  const l = data.listings.find(x => x.id === selected)
  const title = l ? l.title ?? `${l.rooms ?? "?"} pièces, ${l.area ?? "?"} m²` : ""
  const body = l && <DossierBody key={l.id} l={l} />
  if (mobile)
    return (
      <Drawer open={!!l} onOpenChange={o => !o && select(null)}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader><DrawerTitle>{title}</DrawerTitle><DrawerDescription>{l && eur(l.price)}</DrawerDescription></DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">{body}</div>
        </DrawerContent>
      </Drawer>
    )
  return (
    <Sheet open={!!l} onOpenChange={o => !o && select(null)}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-[min(720px,100vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b"><SheetTitle>{title}</SheetTitle><SheetDescription>{l && `${eur(l.price)} · ${SOURCE_LABEL[l.source]}`}</SheetDescription></SheetHeader>
        <div className="p-4">{body}</div>
      </SheetContent>
    </Sheet>
  )
}

function DossierBody({ l }: { l: Listing }) {
  const { slug, data, state, profile, ref, refStats, reload, compare, toggleCompare, addFeedback } = useSearch()
  const run = useRun()
  const [notes, setNotes] = useState(l.notes)
  const nego = negotiation(l, ref?.ppm2), days = daysOnline(l), drop = dropped(l)
  const b = l.building, dpeReg = b?.dpe.find(d => d.number === b.dpe_match)
  const near = nearby(l.location.point, Array.isArray(data.area.pois) ? data.area.pois : [])
  const travel = (data.area.isochrones ?? []).filter(i => i.geometry && l.location.point && inGeometry(l.location.point, i.geometry))
  const streamOn = state.stream_estate && data.search.mode === "stream-estate"
  const short = `${l.rooms ?? "?"} p., ${l.area ?? "?"} m², ${eur(l.price)}${l.location.address ? `, ${l.location.address}` : ""}`

  async function setStatus(s: string) {
    await api.listing(slug, l.id, { my_status: (s || null) as Status })
    await reload()
  }
  async function saveNotes() {
    if (notes === l.notes) return
    await api.listing(slug, l.id, { notes })
    await reload()
    toast.success("Notes enregistrées")
  }

  return (
    <div className="flex flex-col gap-3">
      {l.pictures.length > 0 && (
        <div className="flex snap-x gap-2 overflow-x-auto pb-1">
          {l.pictures.map(p => <img key={p} src={p} alt="" loading="lazy" className="h-40 snap-start rounded-lg object-cover" onError={e => e.currentTarget.remove()} />)}
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-3xl font-bold tracking-tight">{eur(l.price)}</span>
        <span className="text-sm text-muted-foreground">
          {[l.area && `${l.area} m²`, l.rooms && `${l.rooms} pièces`, l.floor != null && (l.floor === 0 ? "rez-de-chaussée" : `${l.floor}ᵉ étage${l.floors ? ` sur ${l.floors}` : ""}`), m2(l.price_per_m2)].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {l.status !== "AVAILABLE" && <Badge variant="outline">{SALE_STATUS[l.status] ?? l.status}</Badge>}
        {l.urls.map((u, i) => u.url
          ? <Button key={i} variant="outline" size="xs" asChild><a href={u.url} target="_blank" rel="noreferrer">{u.source ?? "annonce"}<ExternalLinkIcon data-icon="inline-end" /></a></Button>
          : <Badge key={i} variant="secondary">{u.source}</Badge>)}
        {l.publishers.map((p, i) => <Badge key={i} variant="secondary">{p.type === "PRIVATE_INDIVIDUAL" ? "Particulier" : p.name ?? "Agence"}{p.card ? ` · carte ${p.card}` : ""}</Badge>)}
      </div>
      {l.publishers.some(p => p.phone || p.email) && (
        <p className="text-sm text-muted-foreground">Contact : {l.publishers.flatMap(p => [p.phone, p.email]).filter(Boolean).join(" · ")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={l.my_status ?? ""} onValueChange={setStatus} aria-label="Mon statut">
          {Object.entries(STATUS_LABEL).map(([k, v]) => <ToggleGroupItem key={k} value={k}>{v}</ToggleGroupItem>)}
        </ToggleGroup>
        <Button variant={compare.includes(l.id) ? "secondary" : "outline"} size="sm" onClick={() => toggleCompare(l.id)}><ScaleIcon data-icon="inline-start" />{compare.includes(l.id) ? "Dans le comparateur" : "Comparer"}</Button>
        <Button variant="outline" size="sm" onClick={() => { addFeedback({ kind: "analyser", text: `${l.id} — ${short}` }); toast.success("Ajouté au prompt pour Claude") }}><MessageSquarePlusIcon data-icon="inline-start" />Analyser avec Claude</Button>
      </div>

      <Section title="Prix et négociation">
        {refStats && <Ruler stats={refStats} ticks={[{ id: l.id, ppm2: l.price_per_m2 }]} />}
        <Row label="Écart au prix vendu"><Gap ppm2={l.price_per_m2} refPpm2={ref?.ppm2} long /></Row>
        <Row label="Vendu, zone" hint={ref ? `${ref.count} ventes` : undefined}>{m2(ref?.ppm2)}</Row>
        {data.market.dvf?.street && <Row label={`Vendu, ${data.search.street?.name ?? "rue"}`}>{m2(data.market.dvf.street.median_ppm2)}</Row>}
        {data.market.stream?.trend?.data?.length ? <Row label="Affiché, zone (dernier mois)">{m2(data.market.stream.trend.data.at(-1)?.metrics["median:price_per_sqm"])}</Row> : null}
        <Row label="En ligne depuis">{days != null ? `${days} jours` : "—"}{l.urgent ? " · urgent" : ""}{l.favorites ? ` · ${l.favorites} favoris` : ""}</Row>
        {drop > 0 && <Row label="Baisses déjà faites">{pct(-drop, 1)}</Row>}
        {[...l.price_changes.map(c => ({ date: c.date, text: `${eur(c.from)} → ${eur(c.to)}` })), ...(l.changes ?? []).filter(c => c.kind === "price_drop" || c.kind === "price_rise").map(c => ({ date: c.date, text: `${eur(c.from as number)} → ${eur(c.to as number)}` }))].map((c, i) => (
          <Row key={i} label={date(c.date)}>{c.text}</Row>
        ))}
        {nego ? (
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
            <span className="text-xs text-muted-foreground">Marge de négociation estimée</span>
            <span className="text-2xl font-bold">{share(nego.low)} à {share(nego.high)}</span>
            <span className="text-xs text-muted-foreground">soit {eur(Math.round((l.price ?? 0) * nego.low))} à {eur(Math.round((l.price ?? 0) * nego.high))} · {["3 % d'écart habituel entre affiché et vendu", ...nego.reasons.map((r: unknown[]) => REASON[r[0] as string]?.(r[1] as number | boolean))].join(", ")}</span>
          </div>
        ) : <p className="text-sm text-muted-foreground">Pas de marge : le bien est sous offre, vendu ou retiré.</p>}
      </Section>

      <Section title="Bâtiment et risques" action={
        <span className="flex gap-1.5">
          <Button size="xs" variant="outline" onClick={() => run({ cmd: "enrich", slug, args: { id: l.id }, label: "Analyse du bâtiment (gratuit)" })}><SearchCheckIcon data-icon="inline-start" />{b ? "Mettre à jour" : "Analyser"}</Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span><Button size="xs" variant="outline" disabled={!streamOn || !l.se_id} onClick={() => run({ cmd: "enrich", slug, args: { id: l.id, resolve: true }, label: "Adresse exacte (Stream Estate)" })}>Adresse exacte</Button></span>
            </TooltipTrigger>
            <TooltipContent>{streamOn && l.se_id ? "Stream Estate retrouve l'adresse exacte (bêta), puis le DPE, la copropriété et les ventes de l'immeuble" : "Nécessite Stream Estate (clé et recherche en mode Stream Estate)"}</TooltipContent>
          </Tooltip>
        </span>
      }>
        {b?.address?.label && <Row label={b.address.shown === "address" ? "Adresse" : "Adresse probable"}>{b.address.shown ? b.address.label : "non trouvée"}</Row>}
        {!b?.address && <Row label="Localisation">{l.location.address ?? "—"} ({ACCURACY_LABEL[l.location.accuracy ?? "UNKNOWN"] ?? "inconnue"})</Row>}
        <Row label="DPE de l'annonce"><Dpe value={l.dpe?.energy} />{l.dpe?.energy_value ? <span className="ml-2 text-muted-foreground">{l.dpe.energy_value} kWh/m²/an</span> : null}</Row>
        <Row label="DPE au registre ADEME">{dpeReg ? <><Dpe value={dpeReg.energy} /><span className="ml-2 text-muted-foreground">{date(dpeReg.date)} · {dpeReg.area} m² · {eur(dpeReg.cost)}/an</span></> : b?.dpe.length ? `${b.dpe.length} DPE à l'adresse, aucun de cette surface` : "—"}</Row>
        {(RENT_BAN as Record<string, string>)[l.dpe?.energy ?? ""] && <Row label="Location interdite">dès {(RENT_BAN as Record<string, string>)[l.dpe!.energy!].slice(0, 4)} (classe {l.dpe!.energy})</Row>}
        <Row label="Construction">{b?.construction_year ?? l.construction_year ?? (b?.copro ? RISK_KEYS[b.copro.period] ?? "—" : "—")}</Row>
        <Row label="Copropriété">{b?.copro ? `${b.copro.lots} lots dont ${b.copro.dwellings} logements · syndic ${b.copro.syndic ?? "inconnu"}` : l.lots ? `${l.lots} lots (annonce)` : "—"}</Row>
        {b?.copro && <Row label="Registre">{b.copro.name} · n° {b.copro.number}</Row>}
        <Row label="Équipements">{[l.features.elevator && "ascenseur", l.features.balcony && "balcon", l.features.terrace && "terrasse", l.features.cellar && "cave", l.features.parking && "parking", l.features.caretaker && "gardien", l.features.fiber && "fibre", l.features.elevator === false && "sans ascenseur"].filter(Boolean).join(", ") || "—"}</Row>
        <Row label="Charges, taxe foncière">{l.fees.condo_yearly ? `${eur(Math.round(l.fees.condo_yearly / 12))}/mois` : "—"} · {l.fees.property_tax ? `${eur(l.fees.property_tax)}/an` : "—"}</Row>
        <Row label="Risques">{b?.risks ? [...b.risks.natural, ...b.risks.technological].map(r => r.label).join(", ") || "aucun signalé" : "—"}</Row>
        {b?.sales.length ? (
          <>
            <Separator />
            <span className="text-xs text-muted-foreground">Ventes dans l'immeuble (DVF)</span>
            {b.sales.slice(0, 5).map(s => <Row key={s.id} label={date(s.date)}>{eur(s.price)} · {s.area} m² · {m2(s.ppm2)}</Row>)}
          </>
        ) : null}
      </Section>

      <Section title="Quartier et trajets">
        {Object.keys(POI_LABEL).filter(k => near[k]).map(k => (
          <Row key={k} label={POI_LABEL[k]}>{near[k].count} à moins de 500 m · le plus proche à {near[k].nearest} m{near[k].name ? ` (${near[k].name})` : ""}</Row>
        ))}
        {!Object.keys(near).length && <p className="text-sm text-muted-foreground">{l.location.point ? "Rien de recensé à moins de 500 m." : "Le bien n'a pas de position."}</p>}
        {travel.length > 0 && <Separator />}
        {[...new Set(travel.map(i => i.place))].map(p => (
          <Row key={p} label={p}>{travel.filter(i => i.place === p).map(i => `≤ ${i.minutes} min ${i.profile === "car" ? "en voiture" : "à pied"}`).join(" · ")}</Row>
        ))}
        {!travel.length && (data.area.places?.length ?? 0) > 0 && <Row label="Lieux clés">au-delà de 30 min à pied et 20 min en voiture</Row>}
      </Section>

      <BudgetSection l={l} profileIncome={profile.net_income_monthly} />

      <Section title="Suivi">
        <Field>
          <FieldLabel htmlFor="notes">Mes notes</FieldLabel>
          <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Visite, questions à poser, impressions…" />
        </Field>
        {[{ date: l.first_seen, text: "Ajoutée à la recherche" }, ...(l.changes ?? []).filter(c => c.kind !== "new").map(c => ({ date: c.date, text: c.kind === "expired" ? "Annonce expirée" : c.kind === "status" ? `Statut : ${SALE_STATUS[String(c.to)] ?? c.to}` : `Prix : ${eur(c.from as number)} → ${eur(c.to as number)}` }))].map((c, i) => (
          <Row key={i} label={date(c.date)}>{c.text}</Row>
        ))}
      </Section>
    </div>
  )
}

// the loan of this flat with the profile, its down payment, rate and length changeable here before they are saved
function BudgetSection({ l, profileIncome }: { l: Listing; profileIncome: number }) {
  const { profile, setProfile } = useSearch()
  // the saved profile wins again once it changes
  const [p, setP] = useState(profile), [saved, setSaved] = useState(profile)
  if (saved !== profile) { setSaved(profile); setP(profile) }
  const r = budget(l, p)
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) || 0 })
  const changed = (["down_payment", "rate", "years", "net_income_monthly"] as const).some(k => p[k] !== profile[k])
  return (
    <Section title="Budget" action={changed && <Button size="xs" onClick={async () => { setProfile(await api.saveProfile(p)); toast.success("Profil enregistré") }}>Enregistrer dans le profil</Button>}>
      <FieldGroup className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field><FieldLabel htmlFor="dp">Apport (€)</FieldLabel><Input id="dp" type="number" inputMode="numeric" value={p.down_payment} onChange={set("down_payment")} /></Field>
        <Field><FieldLabel htmlFor="inc">Revenus nets/mois</FieldLabel><Input id="inc" type="number" inputMode="numeric" value={p.net_income_monthly} onChange={set("net_income_monthly")} /></Field>
        <Field><FieldLabel htmlFor="rate">Taux (%)</FieldLabel><Input id="rate" type="number" step="0.05" value={p.rate} onChange={set("rate")} /></Field>
        <Field><FieldLabel htmlFor="yrs">Durée (ans)</FieldLabel><Input id="yrs" type="number" value={p.years} onChange={set("years")} /></Field>
      </FieldGroup>
      <Row label="Prix">{eur(r.price)}</Row>
      {(r.agency_extra ?? 0) > 0 && <Row label="Frais d'agence en plus">{eur(r.agency_extra)}</Row>}
      <Row label={`Frais de notaire (${l.new_build ? "neuf" : "ancien"})`}>{eur(r.notary)}</Row>
      <Row label="Coût total">{eur(r.total)}</Row>
      <Row label="Emprunt">{eur(r.loan)}</Row>
      <Row label={`Mensualité sur ${p.years} ans à ${String(p.rate).replace(".", ",")} %`}>{eur(r.payment)} + {eur(r.insurance)} d'assurance</Row>
      {r.debt_ratio != null ? (
        <>
          <Row label="Taux d'endettement" hint="Plafond du HCSF : 35 % des revenus nets, assurance comprise, sur 25 ans au plus">
            <span className={r.hcsf_ok ? "" : "text-destructive"}>{share(r.debt_ratio, 1)} {r.hcsf_ok ? "· sous le plafond de 35 %" : "· au-dessus du plafond de 35 %"}</span>
          </Row>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={Math.round(r.debt_ratio * 100)} aria-valuemin={0} aria-valuemax={50} aria-label="Taux d'endettement">
            <div className={r.hcsf_ok ? "h-full bg-foreground" : "h-full bg-destructive"} style={{ width: `${Math.min(100, (r.debt_ratio / 0.5) * 100)}%` }} />
          </div>
          {!r.hcsf_ok && r.down_needed != null && <Row label="Apport nécessaire pour 35 %">{eur(r.down_needed)}</Row>}
        </>
      ) : <p className="text-sm text-muted-foreground">{profileIncome ? "" : "Indiquez vos revenus pour le taux d'endettement."}</p>}
      <Separator />
      <Row label="Taxe foncière">{r.owning.property_tax ? `${eur(Math.round(r.owning.property_tax / 12))}/mois` : "—"}</Row>
      <Row label="Charges de copropriété">{r.owning.condo ? `${eur(Math.round(r.owning.condo / 12))}/mois` : "—"}</Row>
      <Row label="Énergie estimée" hint={l.building?.dpe_cost_yearly ? "Coût du DPE au registre" : "Estimation depuis la classe DPE"}>{r.owning.energy ? `${eur(Math.round(r.owning.energy / 12))}/mois` : "—"}</Row>
      <Row label="Total chaque mois">{eur(r.monthly_total)}</Row>
    </Section>
  )
}
