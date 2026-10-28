import { budget, rentOf, rentVsBuy } from "@engine/budget.js"
import { review, score } from "@engine/decide.js"
import { inGeometry } from "@engine/geo.js"
import { asking, daysOnline, dropped, isHome, negotiation, typeOf, unitPrice } from "@engine/market.js"
import { CheckIcon, ChevronDownIcon, CircleQuestionMarkIcon, ContactRoundIcon, CopyIcon, ExternalLinkIcon, HistoryIcon, HouseIcon, MailIcon, MessageSquarePlusIcon, MessageSquareTextIcon, PenLineIcon, PhoneIcon, PlusIcon, ScaleIcon, SearchCheckIcon, ThumbsUpIcon, Trash2Icon, TriangleAlertIcon, UserRoundIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Dpe } from "@/components/dpe"
import { nearby } from "@/components/map-view"
import { Gap, Ruler } from "@/components/ruler"
import { FavoriteButton } from "@/components/favorite"
import { Origin } from "@/components/origin"
import { useRun } from "@/components/run-dialog"
import { StatusDot } from "@/components/status"
import { StaleBar } from "@/components/top-bar"
import { TypeIcon } from "@/components/type-icon"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Channel, type Listing, type Message, type PropertyType, type ScoreKey, type Status } from "@/lib/api"
import { ACCURACY_LABEL, CHANNEL_LABEL, date, dateTime, eur, m2, MESSAGE_LABEL, pct, perUnit, POI_LABEL, SALE_STATUS, SCORE_LABEL, share, STATUS_LABEL, titleOf, TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

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
  const title = l ? <span className="flex items-center gap-2"><TypeIcon type={l.property_type} className="size-4 shrink-0 text-muted-foreground" />{titleOf(l)}</span> : ""
  const body = l && <DossierBody key={l.id} l={l} />
  if (mobile)
    return (
      <Drawer open={!!l} onOpenChange={o => !o && select(null)}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader><DrawerTitle>{title}</DrawerTitle><DrawerDescription>{l && eur(l.price)}</DrawerDescription></DrawerHeader>
          <StaleBar />
          <div className="overflow-y-auto px-4 pb-6">{body}</div>
        </DrawerContent>
      </Drawer>
    )
  return (
    <Sheet open={!!l} onOpenChange={o => !o && select(null)}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-[min(720px,100vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b"><SheetTitle>{title}</SheetTitle><SheetDescription>{l && `${TYPE_LABEL[l.property_type ?? "flat"]} · ${eur(l.price)}`}</SheetDescription></SheetHeader>
        <StaleBar />
        <div className="p-4">{body}</div>
      </SheetContent>
    </Sheet>
  )
}

// what Claude is asked to write, from the dossier's menu: the prompt says what, Claude reads the conversation first
const DRAFTS = {
  offer: "une offre d'achat (montant et arguments à partir de la marge de négociation)", question: "les questions à poser à l'agent ou au vendeur", visit: "une demande de visite",
  reply: "une réponse au dernier message reçu, d'après toute la conversation", follow_up: "une relance du dernier message resté sans réponse",
  documents: "une demande des documents (diagnostics complets, PV des 3 dernières AG, relevé de charges, avis de taxe foncière, pré-état daté)",
} as const

function DossierBody({ l }: { l: Listing }) {
  const { slug, data, profile, marketFor, aidsFor, reload, compare, toggleCompare, addFeedback } = useSearch()
  const run = useRun()
  const [notes, setNotes] = useState(l.notes)
  const t = typeOf(l) as PropertyType, home = isHome(t), { ref, stats: refStats } = marketFor(l), aids = aidsFor(l)
  const nego = negotiation(l, ref?.ppm2), days = daysOnline(l), drop = dropped(l)
  const b = l.building, dpeReg = b?.dpe.find(d => d.number === b.dpe_match)
  const near = nearby(l.location.point, Array.isArray(data.area.pois) ? data.area.pois : [])
  const travel = (data.area.isochrones ?? []).filter(i => i.geometry && l.location.point && inGeometry(l.location.point, i.geometry))
  const short = `${titleOf(l)}, ${eur(l.price)}${l.location.address ? `, ${l.location.address}` : ""}`

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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1">
          <span className="text-3xl font-bold tracking-tight">{eur(l.price)}</span>
          <FavoriteButton l={l} variant="inline" />
        </span>
        <span className="text-sm text-muted-foreground">
          {[l.area && `${l.area} m²`, l.land_area && `terrain de ${l.land_area} m²`, l.rooms && `${l.rooms} pièces`, t === "flat" && l.floor != null && (l.floor === 0 ? "rez-de-chaussée" : `${l.floor}ᵉ étage${l.floors ? ` sur ${l.floors}` : ""}`), perUnit(unitPrice(l), t)].filter(Boolean).join(" · ")}
        </span>
      </div>
      <Origin l={l} variant="line" />
      <Portals l={l} />
      <Contacts l={l} />
      <div className="flex flex-wrap items-center gap-2">
        {/* on a phone, the four statuses share the width instead of running off it */}
        <ToggleGroup type="single" variant="outline" size="sm" value={l.my_status ?? ""} onValueChange={setStatus} aria-label="Mon statut" className="w-full sm:w-auto">
          {Object.entries(STATUS_LABEL).map(([k, v]) => <ToggleGroupItem key={k} value={k} className="flex-1 gap-1 px-1.5 sm:flex-none sm:px-2.5"><StatusDot status={k as Status} />{v}</ToggleGroupItem>)}
        </ToggleGroup>
        <span className="flex flex-wrap gap-2 sm:ml-auto">
          <Button variant={compare.includes(l.id) ? "secondary" : "outline"} size="sm" aria-pressed={compare.includes(l.id)} onClick={() => toggleCompare(l.id)}><ScaleIcon data-icon="inline-start" />{compare.includes(l.id) ? "Dans le comparateur" : "Comparer"}</Button>
          <DraftMenu l={l}
            onAnalyse={() => { addFeedback({ kind: "analyser", text: `${l.id} — ${short}` }); toast.success("Ajouté au prompt : copiez-le pour Claude, il analysera ce bien") }}
            onPick={k => { addFeedback({ kind: "message", text: `${MESSAGE_LABEL[k].toLowerCase()} pour ${l.id} — ${short} : rédige ${DRAFTS[k]}` }); toast.success("Ajouté au prompt : copiez-le pour Claude, il rédigera le message et l'enregistrera ici") }} />
        </span>
      </div>

      <Synthesis l={l} aids={aids} />

      <Section title="Prix et négociation">
        {refStats && <Ruler stats={refStats} ticks={[{ id: l.id, ppm2: l.price_per_m2 }]} />}
        <Row label="Écart au prix vendu"><Gap ppm2={l.price_per_m2} refPpm2={ref?.ppm2} long /></Row>
        <Row label={`Vendu, ${{ recent: "zone (2 ans)", zone: "zone (5 ans)", commune: "commune" }[ref?.scope ?? "recent"]}`} hint={ref ? `${ref.count} ventes` : undefined}>{perUnit(ref?.ppm2, t)}</Row>
        {data.market.dvf?.[t]?.street?.count ? <Row label={`Vendu, ${data.search.street?.name ?? "rue"}`}>{perUnit(data.market.dvf[t]!.street!.median_ppm2, t)}</Row> : null}
        {asking(data.market, t) ? <Row label="Affiché, zone (dernier mois)">{m2(asking(data.market, t))}</Row> : null}
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

      <Conversation l={l} onDraft={k => { addFeedback({ kind: "message", text: `${MESSAGE_LABEL[k].toLowerCase()} pour ${l.id} — ${short} : rédige ${DRAFTS[k]}` }); toast.success("Ajouté au prompt pour Claude") }} />

      <Section title="Bâtiment et risques" action={
        <Button size="xs" variant="outline" onClick={() => run({ cmd: "enrich", slug, args: { id: l.id }, label: "Analyse du bâtiment (gratuit)" })}><SearchCheckIcon data-icon="inline-start" />{b ? "Mettre à jour" : "Analyser"}</Button>
      }>
        <Row label="Localisation">{l.location.address ?? "—"} ({ACCURACY_LABEL[l.location.accuracy ?? "UNKNOWN"] ?? "inconnue"})</Row>
        {home && <Row label="DPE de l'annonce"><Dpe value={l.dpe?.energy} />{l.dpe?.energy_value ? <span className="ml-2 text-muted-foreground">{l.dpe.energy_value} kWh/m²/an</span> : null}</Row>}
        {home && <Row label="DPE au registre ADEME">{dpeReg ? <><Dpe value={dpeReg.energy} /><span className="ml-2 text-muted-foreground">{date(dpeReg.date)} · {dpeReg.area} m² · {eur(dpeReg.cost)}/an</span></> : b?.dpe.length ? `${b.dpe.length} DPE à l'adresse, aucun de cette surface` : "—"}</Row>}
        {budget(l, profile).rent_ban && <Row label="Location interdite">dès {budget(l, profile).rent_ban!.slice(0, 4)} (classe {l.dpe!.energy})</Row>}
        {t !== "land" && <Row label="Construction">{b?.construction_year ?? l.construction_year ?? (b?.copro ? RISK_KEYS[b.copro.period] ?? "—" : "—")}</Row>}
        {(t === "house" || t === "land") && <Row label="Terrain">{l.land_area ? `${l.land_area} m²` : "—"}</Row>}
        {t !== "house" && t !== "land" && <Row label="Copropriété">{b?.copro ? `${b.copro.lots} lots dont ${b.copro.dwellings} logements · syndic ${b.copro.syndic ?? "inconnu"}` : l.lots ? `${l.lots} lots (annonce)` : "—"}</Row>}
        {b?.copro && <Row label="Registre">{b.copro.name} · n° {b.copro.number}</Row>}
        {t !== "land" && <Row label="Équipements">{[l.features.elevator && "ascenseur", l.features.balcony && "balcon", l.features.terrace && "terrasse", l.features.garden && "jardin", l.features.cellar && "cave", l.features.parking && "parking", l.features.caretaker && "gardien", l.features.fiber && "fibre", l.features.elevator === false && "sans ascenseur"].filter(Boolean).join(", ") || "—"}</Row>}
        <Row label="Charges, taxe foncière">{l.fees.condo_yearly ? `${eur(Math.round(l.fees.condo_yearly / 12))}/mois` : "—"} · {l.fees.property_tax ? `${eur(l.fees.property_tax)}/an` : "—"}</Row>
        <Row label="Risques">{b?.risks ? [...b.risks.natural, ...b.risks.technological].map(r => r.label).join(", ") || "aucun signalé" : "—"}</Row>
        {b?.sales.length ? (
          <>
            <Separator />
            <span className="text-xs text-muted-foreground">Ventes à cette adresse (DVF)</span>
            {b.sales.slice(0, 5).map(s => <Row key={s.id} label={date(s.date)}>{eur(s.price)}{s.area ? ` · ${s.area} m²` : ""} · {perUnit(s.ppm2, t)}</Row>)}
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
      {home && <RentSection l={l} />}

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

// "Rédiger avec Claude": a message Claude writes from the prompt. A reply needs a message received, a reminder one sent.
// What Claude may do for a listing, through the prompt: in the dossier's header, analyse it or write a message
// (« Demander à Claude »); in the conversation, write a message only
function DraftMenu({ l, onPick, onAnalyse, size = "sm" }: { l: Listing; onPick: (k: keyof typeof DRAFTS) => void; onAnalyse?: () => void; size?: "sm" | "xs" }) {
  const ms = l.messages ?? []
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size}>
          {onAnalyse ? <MessageSquarePlusIcon data-icon="inline-start" /> : <PenLineIcon data-icon="inline-start" />}{onAnalyse ? "Demander à Claude" : "Rédiger avec Claude"}<ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {onAnalyse && (
          <>
            <DropdownMenuItem onSelect={onAnalyse}><SearchCheckIcon />Analyser ce bien</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Rédiger</DropdownMenuLabel>
          </>
        )}
        <DropdownMenuItem onSelect={() => onPick("offer")}>Une offre d'achat</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("question")}>Les questions à l'agent</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("visit")}>Une demande de visite</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("documents")}>Une demande de documents</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!ms.some(m => m.from === "them")} onSelect={() => onPick("reply")}>Répondre au dernier message</DropdownMenuItem>
        <DropdownMenuItem disabled={!ms.some(m => m.from !== "them" && m.sent_at)} onSelect={() => onPick("follow_up")}>Une relance</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The portals a listing is on, one link each: its latest advert still online there (the latest one, when none is).
// The others fold into a popover: the ones online twice on a portal first, then the expired ones, newest first. A
// listing put online again and again sells slowly, a lever to negotiate.
function Portals({ l }: { l: Listing }) {
  const ads = l.urls.filter(u => u.url).toSorted((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
  const online = ads.filter(u => !u.expired_at), seen = new Set<string>()
  const main = (online.length ? online : ads).filter(u => { const k = u.source ?? u.url!; return !seen.has(k) && !!seen.add(k) })
  const rest = ads.filter(u => !main.includes(u)).toSorted((a, b) => +!!a.expired_at - +!!b.expired_at), unlinked = l.urls.filter(u => !u.url)
  if (!ads.length && !unlinked.length && l.status === "AVAILABLE") return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {l.status !== "AVAILABLE" && <Badge variant="outline">{SALE_STATUS[l.status] ?? l.status}</Badge>}
      {main.map(u => <Button key={u.url} variant="outline" size="xs" asChild><a href={u.url!} target="_blank" rel="noreferrer">{u.source ?? "Annonce"}<ExternalLinkIcon data-icon="inline-end" /></a></Button>)}
      {unlinked.map((u, i) => <Badge key={i} variant="secondary">{u.source}</Badge>)}
      {rest.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className="text-muted-foreground">
              <HistoryIcon data-icon="inline-start" />{rest.length} autre{rest.length > 1 ? "s" : ""} annonce{rest.length > 1 ? "s" : ""}<ChevronDownIcon data-icon="inline-end" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] p-0">
            <PopoverHeader className="px-4 pt-4">
              <PopoverTitle>Autres annonces de ce bien</PopoverTitle>
              <PopoverDescription>En double sur un portail, puis expirées. Un bien remis en ligne plusieurs fois se vend lentement : un argument pour négocier.</PopoverDescription>
            </PopoverHeader>
            <ul className="flex max-h-72 flex-col overflow-y-auto p-2">
              {rest.map(u => (
                <li key={u.url}>
                  <a href={u.url!} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <span className={cn("flex items-center gap-1.5 font-medium", u.expired_at && "text-muted-foreground")}>{u.source ?? "Annonce"}<ExternalLinkIcon className="size-3.5 text-muted-foreground" /></span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{u.expired_at ? `du ${date(u.published_at)} au ${date(u.expired_at)}` : <span className="text-foreground">en ligne depuis le {date(u.published_at)}</span>}</span>
                  </a>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// who sells it: the agency (or the private seller) with a phone and an email to reach them, one line each
function Contacts({ l }: { l: Listing }) {
  if (!l.publishers.length) return null
  const link = "underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  return (
    <div className="flex flex-col gap-1 text-sm">
      {l.publishers.map((p, i) => (
        <p key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium text-foreground"><ContactRoundIcon className="size-4 text-muted-foreground" />{p.type === "PRIVATE_INDIVIDUAL" ? "Particulier" : p.name ?? "Agence"}{p.card && <span className="font-normal text-muted-foreground">carte {p.card}</span>}</span>
          {p.phone && <a href={`tel:${p.phone.replace(/\s/g, "")}`} className={cn("flex items-center gap-1", link)}><PhoneIcon className="size-3.5" />{p.phone}</a>}
          {p.email && <a href={`mailto:${p.email}`} className={cn("flex items-center gap-1", link)}><MailIcon className="size-3.5" />{p.email}</a>}
        </p>
      ))}
    </div>
  )
}

// the strong points, the points to watch and the questions to ask, then the score and what makes it
function Synthesis({ l, aids }: { l: Listing; aids: Parameters<typeof review>[1] }) {
  const r = review(l, aids), s = score(l, aids)
  const Item = ({ icon: Icon, className, text, source }: { icon: typeof ThumbsUpIcon; className: string; text: string; source?: string }) => (
    <li className="flex items-start gap-2 text-sm"><Icon className={cn("mt-0.5 size-4 shrink-0", className)} /><span>{text}{source && <span className="ml-1.5 text-xs text-muted-foreground">{source}</span>}</span></li>
  )
  return (
    <Section title="Synthèse" action={s.value != null && <span className="text-sm"><b className="text-xl tabular-nums">{s.value}</b><span className="text-muted-foreground"> / 100</span></span>}>
      {r.pros.length > 0 && <ul className="flex flex-col gap-1.5" aria-label="Points forts">{r.pros.map((x, i) => <Item key={i} icon={ThumbsUpIcon} className="text-below" {...x} />)}</ul>}
      {r.cons.length > 0 && <ul className="flex flex-col gap-1.5" aria-label="Points de vigilance">{r.cons.map((x, i) => <Item key={i} icon={TriangleAlertIcon} className="text-above" {...x} />)}</ul>}
      {r.questions.length > 0 && (
        <>
          <span className="text-xs font-medium text-muted-foreground">Questions à poser</span>
          <ul className="flex flex-col gap-1.5">{r.questions.map((q, i) => <Item key={i} icon={CircleQuestionMarkIcon} className="text-muted-foreground" text={q} />)}</ul>
        </>
      )}
      <Separator />
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3" aria-label="Détail du score">
        {s.parts.map(p => (
          <div key={p.key} className="flex flex-col gap-1">
            <span className="flex justify-between text-xs"><span className="text-muted-foreground">{SCORE_LABEL[p.key as ScoreKey]}{p.weight ? ` ×${p.weight}` : ""}</span><span className="font-medium">{p.value == null ? "—" : Math.round(p.value * 100)}</span></span>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/70" style={{ width: `${(p.value ?? 0) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Le score pèse chaque critère selon vos priorités (profil). « — » : donnée inconnue, laissée de côté.</p>
    </Section>
  )
}

const CHANNEL_ICON = { email: MailIcon, sms: MessageSquareTextIcon, phone: PhoneIcon, visit: HouseIcon } as const
// The conversation with the agent or the seller, in order: the user's messages on the right (Claude's drafts, those
// sent), the received ones on the left (pasted, or a call summed up). Claude reads it before writing the next one.
function Conversation({ l, onDraft }: { l: Listing; onDraft: (k: keyof typeof DRAFTS) => void }) {
  const { slug, reload } = useSearch()
  const ms = (l.messages ?? []).toSorted((a, b) => a.date.localeCompare(b.date))
  async function change(m: Message, body: { sent?: boolean; delete?: boolean }) {
    await api.listing(slug, l.id, { message: { id: m.id, ...body } })
    await reload()
    if (body.delete) toast.success("Message supprimé de la conversation")
    else if (body.sent) toast.success(m.kind === "offer" ? "Offre envoyée : le bien passe dans « Offre faite »" : "Message marqué comme envoyé")
  }
  return (
    <Section title="Conversation" action={<span className="flex flex-wrap justify-end gap-1.5"><AddMessage l={l} /><DraftMenu size="xs" l={l} onPick={onDraft} /></span>}>
      {!ms.length && <p className="text-sm text-muted-foreground">Aucun message. « Ajouter » garde une réponse de l'agent ou le résumé d'un appel ; « Rédiger avec Claude » met la demande dans le prompt, et Claude lit toute la conversation avant d'écrire.</p>}
      <ol className="flex flex-col gap-2">{ms.map(m => <Bubble key={m.id} m={m} onChange={b => change(m, b)} />)}</ol>
    </Section>
  )
}

function Bubble({ m, onChange }: { m: Message; onChange: (b: { sent?: boolean; delete?: boolean }) => void }) {
  const [full, setFull] = useState(false)
  const mine = m.from !== "them", Icon = m.channel ? CHANNEL_ICON[m.channel] : MailIcon
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border p-3", mine ? "ml-8 bg-primary/5" : "mr-8 bg-muted/60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Icon className="size-4 text-muted-foreground" aria-label={m.channel ? CHANNEL_LABEL[m.channel] : "Message"} />
        <b>{mine ? `Moi${m.to ? ` → ${m.to}` : ""}` : m.to ?? "L'agent ou le vendeur"}</b>
        {m.kind !== "other" && <span className="text-muted-foreground">{MESSAGE_LABEL[m.kind]}</span>}
        {m.amount && <span className="font-semibold">{eur(m.amount)}</span>}
        <span className="text-xs text-muted-foreground">{dateTime(m.date)}</span>
        {mine ? m.sent_at ? <Badge variant="secondary"><CheckIcon />Envoyé le {date(m.sent_at)}</Badge> : <Badge variant="outline">Brouillon</Badge> : <Badge variant="secondary">Reçu</Badge>}
      </div>
      <p className={cn("text-sm whitespace-pre-line", !full && "line-clamp-3")}>{m.text}</p>
      <div className="flex flex-wrap gap-1.5">
        {m.text.split("\n").length > 3 || m.text.length > 240 ? <Button variant="ghost" size="xs" onClick={() => setFull(!full)}>{full ? "Réduire" : "Lire tout"}</Button> : null}
        <Button variant="outline" size="xs" onClick={async () => { await navigator.clipboard.writeText(m.text); toast.success("Message copié") }}><CopyIcon data-icon="inline-start" />Copier</Button>
        {mine && <Button variant={m.sent_at ? "ghost" : "outline"} size="xs" onClick={() => onChange({ sent: !m.sent_at })}>{m.sent_at ? "Marquer non envoyé" : "Marquer envoyé"}</Button>}
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Supprimer le message"><Trash2Icon /></Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
              <AlertDialogDescription>Il sera retiré de la conversation, et Claude ne le lira plus.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => onChange({ delete: true })}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  )
}

// now as a datetime-local value: "2026-10-27T18:30"
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
// a message the user adds to the conversation: the agent's reply, a call summed up, or one they sent themselves
function AddMessage({ l }: { l: Listing }) {
  const { slug, reload } = useSearch()
  const [open, setOpen] = useState(false), [from, setFrom] = useState<"them" | "me">("them"), [channel, setChannel] = useState<Channel>("email")
  const [when, setWhen] = useState(localNow), [text, setText] = useState(""), [amount, setAmount] = useState("")
  async function save() {
    try {
      await api.listing(slug, l.id, { message: { add: { from, channel, date: new Date(when).toISOString(), text, ...(amount ? { amount: Number(amount) } : {}), sent: from === "me" } } })
    } catch (e) { return toast.error("Le message n'a pas été ajouté", { description: `Détail technique : ${(e as Error).message}` }) }
    await reload()
    toast.success("Message ajouté à la conversation")
    setOpen(false)
    setText("")
    setAmount("")
  }
  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (o) setWhen(localNow()) }}>
      <DialogTrigger asChild><Button variant="outline" size="xs"><PlusIcon data-icon="inline-start" />Ajouter</Button></DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ajouter un message</DialogTitle>
          <DialogDescription>Une réponse de l'agent, le résumé d'un appel ou un message que vous avez envoyé : Claude le lira avant d'écrire le suivant.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>De</FieldLabel>
            <ToggleGroup type="single" variant="outline" size="sm" value={from} onValueChange={v => v && setFrom(v as typeof from)} className="justify-start">
              <ToggleGroupItem value="me"><UserRoundIcon />Moi</ToggleGroupItem>
              <ToggleGroupItem value="them"><ContactRoundIcon />Propriétaire / Agence</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel>Canal</FieldLabel>
            <ToggleGroup type="single" variant="outline" size="sm" value={channel} onValueChange={v => v && setChannel(v as Channel)} className="flex-wrap justify-start">
              {(Object.keys(CHANNEL_LABEL) as Channel[]).map(c => { const I = CHANNEL_ICON[c]; return <ToggleGroupItem key={c} value={c}><I />{CHANNEL_LABEL[c]}</ToggleGroupItem> })}
            </ToggleGroup>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="m-when">Date</FieldLabel><Input id="m-when" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="m-amount">Prix proposé (€)</FieldLabel><Input id="m-amount" type="number" inputMode="numeric" step={1000} placeholder="facultatif" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          </div>
          <Field>
            <FieldLabel htmlFor="m-text">Message</FieldLabel>
            <Textarea id="m-text" rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={from === "me" ? "Collez le message envoyé…" : channel === "phone" ? "Appel : le vendeur accepte de descendre à 256 000 € si…" : "Collez le message reçu…"} />
          </Field>
        </FieldGroup>
        <DialogFooter><Button onClick={save} disabled={!text.trim() || !when}>Ajouter à la conversation</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// renting the same home (carte des loyers) against owning it, and when buying starts to pay
function RentSection({ l }: { l: Listing }) {
  const { data, profile } = useSearch()
  const rent = data.market.rent && !("error" in data.market.rent) ? data.market.rent : null
  const row = rentOf(l, rent), r = rentVsBuy(l, row, profile)
  return (
    <Section title="Louer ou acheter">
      {r ? (
        <>
          <Row label="Loyer d'un logement équivalent" hint={`Carte des loyers ${rent!.year}, charges comprises, ${row!.scope === "commune" ? "à la commune" : "à l'échelle de la zone"}`}>{eur(r.rent)}/mois <span className="text-muted-foreground">({eur(r.low)} à {eur(r.high)})</span></Row>
          <Row label="Propriétaire : crédit, taxe et charges">{eur(r.owning)}/mois <span className="text-muted-foreground">dont {eur(r.capital)} de capital remboursé</span></Row>
          <Row label="Rendement locatif brut" hint="Une année de loyer rapportée au prix affiché">{share(r.gross_yield, 1)}</Row>
          <p className="text-sm">{r.break_even_years ? <>Acheter devient plus avantageux que louer au bout d'environ <b>{r.break_even_years} an{r.break_even_years > 1 ? "s" : ""}</b>.</> : <>À ce taux et à ce prix, <b>louer coûte moins cher</b> chaque année que ce que l'achat fait perdre (intérêts, taxe, charges, entretien).</>}</p>
          <p className="text-xs text-muted-foreground">Ordre de grandeur : intérêts de la première année, 1 % du prix par an d'entretien, sans placement de l'apport. Source : carte des loyers {rent!.year} (ministère du Logement).</p>
        </>
      ) : <p className="text-sm text-muted-foreground">{l.area ? "Pas de loyer de référence pour cette commune." : "La surface manque pour comparer à un loyer."}</p>}
    </Section>
  )
}

// the loan of this property with the profile, its down payment, rate and length changeable here before they are saved
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
      {r.works && <Row label="Travaux pour atteindre le DPE D" hint="Ordre de grandeur d'une rénovation complète ; un audit énergétique donne le vrai chiffre">{eur(r.works.low)} à {eur(r.works.high)}</Row>}
      {(r.agency_extra ?? 0) > 0 && <Row label="Frais d'agence en plus">{eur(r.agency_extra)}</Row>}
      <Row label={`Frais de notaire (${l.new_build ? "neuf" : "ancien"})`}>{eur(r.notary)}</Row>
      <Row label="Coût total">{eur(r.total)}</Row>
      {r.works && <Row label="Coût total avec travaux">{eur(r.total + r.works.low)} à {eur(r.total + r.works.high)}</Row>}
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
