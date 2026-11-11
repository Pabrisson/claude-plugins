import { budget, rentOf, rentVsBuy } from "@engine/budget.js"
import { review, score } from "@engine/decide.js"
import { inGeometry } from "@engine/geo.js"
import { asking, daysOnline, dropped, isHome, negotiation, priceSteps, typeOf, unitPrice } from "@engine/market.js"
import { BellRingIcon, CalendarClockIcon, PencilIcon, CheckIcon, ClockIcon, EllipsisIcon, MessagesSquareIcon, ReplyIcon, SendIcon, Undo2Icon, ChevronDownIcon, XIcon, CircleQuestionMarkIcon, LandPlotIcon, ListIcon, LocateFixedIcon, MapIcon, SquareKanbanIcon, ContactRoundIcon, CopyIcon, ExternalLinkIcon, HistoryIcon, HouseIcon, MailIcon, Maximize2Icon, MessageSquareTextIcon, PaperclipIcon, PhoneIcon, PlusIcon, TagIcon, ScaleIcon, SearchCheckIcon, ThumbsUpIcon, Trash2Icon, TriangleAlertIcon, UserRoundIcon } from "lucide-react"
import { Fragment, useEffect, useState, type ReactNode } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { toast } from "sonner"

import { AskDialog, AskMenu, DOC_LABEL, DocIcon, docTypesFor, typeOfDoc } from "@/components/ask-agent"
import { Dpe } from "@/components/dpe"
import { nearby } from "@/components/map-view"
import { Gap, Ruler } from "@/components/ruler"
import { FavoriteButton } from "@/components/favorite"
import { LabelsEditor } from "@/components/labels"
import { LocationLine, placedBy } from "@/components/locate-dialog"
import { Origin } from "@/components/origin"
import { FollowSection } from "@/components/notes"
import { Photos } from "@/components/photos"
import { useRun } from "@/components/run-dialog"
import { StatusDot } from "@/components/status"
import { StaleBar } from "@/components/top-bar"
import { TypeIcon } from "@/components/type-icon"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message as ChatMessage, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, docUrl, listingUrl, type Cadastre, type Channel, type Doc, type Listing, type Message, type PropertyType, type ScoreKey, type Status } from "@/lib/api"
import { ACCURACY_LABEL, bytes, CHANNEL_LABEL, date, dateTime, eur, keur, m2, MESSAGE_LABEL, pct, perUnit, POI_LABEL, SALE_STATUS, SCORE_LABEL, share, STATUS_LABEL, titleOf, TYPE_LABEL } from "@/lib/format"
import { shelved } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { useIsMobile, useMedia } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

const priceConfig = { price: { label: "Prix affiché", color: "var(--chart-4)" } } satisfies ChartConfig
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" })
type Step = { date: string; price: number; pct: number | null }

// The asking price over time (lib/market.js priceSteps), when it changed at least once: a step a change, its change in
// % over it, and the sold price of the market for this surface dashed (`sold`): what is left to negotiate. The list
// of the changes stays under it, as its table.
function PriceChart({ l, sold }: { l: Listing; sold: number | null }) {
  const steps = (priceSteps(l) as Step[]).map(s => ({ ...s, t: Date.parse(s.date) }))
  if (new Set(steps.map(s => s.price)).size < 2) return null
  const ys = [...steps.map(s => s.price), ...(sold ? [sold] : [])]
  return (
    <ChartContainer config={priceConfig} className="aspect-auto h-44 w-full" aria-label="Historique du prix affiché">
      {/* room on the right for the label of a change made today */}
      <LineChart data={steps} margin={{ top: 20, left: 4, right: 36, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} minTickGap={40} tickFormatter={t => day.format(t)} />
        <YAxis tickLine={false} axisLine={false} width={56} domain={[Math.min(...ys) * 0.97, Math.max(...ys) * 1.03]} tickFormatter={v => keur(v)} />
        <ChartTooltip content={<ChartTooltipContent hideIndicator labelFormatter={(_, p) => date(p[0]?.payload.date)} formatter={v => `Prix affiché : ${eur(v as number)}`} />} />
        {sold && <ReferenceLine y={sold} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `Vendu, marché : ${keur(sold)}`, position: "insideBottomRight", fill: "var(--muted-foreground)", fontSize: 11 }} />}
        <Line dataKey="price" type="stepAfter" stroke="var(--color-price)" strokeWidth={2} isAnimationActive={false}
          dot={({ cx, cy, payload, index }: { cx?: number; cy?: number; payload: Step; index: number }) => payload.pct == null ? <g key={index} /> : (
            <g key={index}>
              <circle cx={cx} cy={cy} r={4} fill="var(--color-price)" stroke="var(--card)" strokeWidth={2} />
              <text x={cx} y={(cy ?? 0) - 10} textAnchor="middle" fontSize={11} fill="var(--foreground)">{pct(payload.pct, 1)}</text>
            </g>
          )} />
      </LineChart>
    </ChartContainer>
  )
}

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

// a listing's name, a link to its own page (/<slug>/annonce/<id>): a click opens it, the row or card around it keeps its own
export function ListingLink({ l, className, children }: { l: Listing; className?: string; children?: ReactNode }) {
  const { slug } = useSearch()
  return (
    <a href={listingUrl(slug, l.id)} onClick={e => e.stopPropagation()} title="Ouvrir la page de l'annonce"
      className={cn("underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none", className)}>{children ?? titleOf(l)}</a>
  )
}

// the dossier's « Voir »: the listing on the map, on the board or in the list, the dossier closed
export function ShowIn({ l, onView }: { l: Listing; onView: (v: string) => void }) {
  const { select, spotListing } = useSearch()
  // the tab first (it lets the last one pointed at go), then this one
  const go = (view: string) => { select(null); onView(view); spotListing(l.id) }
  const off = shelved(l)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="shrink-0"><LocateFixedIcon data-icon="inline-start" />Voir<ChevronDownIcon data-icon="inline-end" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max whitespace-nowrap">
        <DropdownMenuItem disabled={!l.location.point || off} onSelect={() => go("listings")}><MapIcon />Sur la carte{!l.location.point ? " (sans position)" : off ? " (expirée, à trier)" : ""}</DropdownMenuItem>
        <DropdownMenuItem disabled={off} onSelect={() => go("kanban")}><SquareKanbanIcon />Dans le Kanban{off ? " (expirée, à trier)" : ""}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go("list")}><ListIcon />Dans la Liste</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Dossier({ onView }: { onView: (v: string) => void }) {
  const { data, selected, select } = useSearch()
  const mobile = useIsMobile()
  const l = data.listings.find(x => x.id === selected)
  // its name opens its own page, the same dossier
  const title = l ? <span className="flex items-center gap-2"><TypeIcon type={l.property_type} className="size-4 shrink-0 text-muted-foreground" /><ListingLink l={l}>{titleOf(l)}<Maximize2Icon className="ml-1.5 inline size-3.5 text-muted-foreground" aria-hidden /></ListingLink></span> : ""
  const body = l && <DossierBody key={l.id} l={l} onView={onView} />
  if (mobile)
    return (
      <Drawer open={!!l} onOpenChange={o => !o && select(null)}>
        <DrawerContent className="max-h-[92vh]" onEscapeKeyDown={e => (e.target as HTMLElement | null)?.closest?.("[data-notes-editor]") && e.preventDefault()}>
          <DrawerHeader className="flex-row items-center justify-between gap-3 text-left"><span className="min-w-0"><DrawerTitle>{title}</DrawerTitle><DrawerDescription>{l && eur(l.price)}</DrawerDescription></span>{l && <ShowIn l={l} onView={onView} />}</DrawerHeader>
          <StaleBar />
          <div className="overflow-y-auto px-4 pb-6">{body}</div>
        </DrawerContent>
      </Drawer>
    )
  return (
    <Sheet open={!!l} onOpenChange={o => !o && select(null)}>
      <SheetContent showCloseButton={false} className="gap-0 data-[side=right]:w-[min(720px,100vw)] data-[side=right]:sm:max-w-none" onEscapeKeyDown={e => (e.target as HTMLElement | null)?.closest?.("[data-notes-editor]") && e.preventDefault()}>
        {/* « Voir » and the close button side by side, both centered on the title */}
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b">
          <span className="min-w-0"><SheetTitle>{title}</SheetTitle><SheetDescription>{l && `${TYPE_LABEL[l.property_type ?? "flat"]} · ${eur(l.price)}`}</SheetDescription></span>
          <span className="flex shrink-0 items-center gap-1">
            {l && <ShowIn l={l} onView={onView} />}
            <SheetClose asChild><Button variant="ghost" size="icon-sm" aria-label="Fermer"><XIcon /></Button></SheetClose>
          </span>
        </SheetHeader>
        <StaleBar />
        {/* only the body scrolls: its scrollbar starts below the header */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
      </SheetContent>
    </Sheet>
  )
}

// The listing's parcel (the cadastre at its point, when the listing is placed at its address): its reference, its
// contenance against the land the listing states (a house, a plot), its zone in the urban plan, the sales DVF has on
// it; « Voir au cadastre » opens it in the « Cadastre » tab
function ParcelSection({ l, onView }: { l: Listing; onView: (v: string) => void }) {
  const { focusParcel, select } = useSearch()
  const point = l.location.point, precise = !!point && (l.location.accuracy === "PRECISE" || !!l.building?.ban)
  const [d, setD] = useState<Cadastre | "none" | "error" | null>(null)
  useEffect(() => {
    if (!precise || !point) return
    const ctl = new AbortController()
    api.cadastreAt(point, ctl.signal).then(setD, e => { if (!ctl.signal.aborted) setD(e.message === "not found" ? "none" : "error") })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precise, point?.join(",")])
  const t = typeOf(l), p = d && typeof d === "object" ? d.parcel : null
  const ref = p && `${p.prefix !== "000" ? `${p.prefix} ` : ""}${p.section.replace(/^0(?=[A-Z])/, "")} ${+p.number}`
  // the land the listing states against the parcel's contenance (a house, a plot): more than 10 % apart is worth asking
  const gap = (t === "house" || t === "land") && l.land_area && p?.area ? l.land_area / p.area - 1 : null
  const go = () => { if (typeof d !== "object" || !d) return; focusParcel(d.idu); select(null); onView("cadastre") }
  return (
    <Section title="Parcelle" action={d && typeof d === "object" && <Button size="xs" variant="outline" onClick={go}><LandPlotIcon data-icon="inline-start" />Voir au cadastre</Button>}>
      {!precise ? <p className="text-sm text-muted-foreground">L'annonce n'est pas placée à son adresse : sa parcelle n'est pas connue.</p>
        : d === null ? <p className="text-sm text-muted-foreground">Recherche de la parcelle…</p>
        : d === "none" ? <p className="text-sm text-muted-foreground">Aucune parcelle au point de l'annonce.</p>
        : d === "error" ? <p className="text-sm text-muted-foreground">Le cadastre ne répond pas pour l'instant.</p>
        : (
          <>
            <Row label="Référence" hint="La parcelle au point de l'annonce : celle de l'immeuble pour un appartement. À vérifier sur le titre de propriété.">{ref ? `section ${ref}` : d.idu} · {d.idu}</Row>
            <Row label="Contenance">{p ? `${p.area.toLocaleString("fr-FR")} m²` : "—"}{gap != null && Math.abs(gap) > 0.1 && <span className="ml-2 text-xs text-[var(--above)]">terrain annoncé {l.land_area} m² ({pct(gap)}) : le bien peut couvrir plusieurs parcelles, ou une partie</span>}</Row>
            {d.urbanism && <Row label="Urbanisme">{d.urbanism.rnu ? "RNU (pas de PLU)" : d.urbanism.zones.map(z => `zone ${z.label}`).join(", ") || "—"}{d.urbanism.document ? ` · ${d.urbanism.document.kind}` : ""}</Row>}
            {d.dvf && !d.dvf.alsace_moselle && <Row label="Ventes sur la parcelle">{d.dvf.sales.length ? `${d.dvf.sales.length} depuis ${d.dvf.years[0]}, la dernière le ${date(d.dvf.sales[0].date)} (${eur(d.dvf.sales[0].price)})` : `aucune depuis ${d.dvf.years[0] ?? "5 ans"}`}</Row>}
            {d.buildings[0] && <Row label="Bâtiment (BDNB)">{[d.buildings[0].year && `construit en ${d.buildings[0].year}`, d.buildings[0].levels && `${d.buildings[0].levels} niveaux`, d.buildings[0].homes && `${d.buildings[0].homes} logements`, d.buildings[0].monument && "abords d'un monument historique"].filter(Boolean).join(" · ") || "—"}</Row>}
          </>
        )}
    </Section>
  )
}

export function DossierBody({ l, onView, wide = false }: { l: Listing; onView: (v: string) => void; wide?: boolean }) {
  const halves = useMedia("(min-width: 1024px)") && wide
  const { slug, data, profile, marketFor, aidsFor, reload, compare, toggleCompare } = useSearch()
  const run = useRun()
  const t = typeOf(l) as PropertyType, home = isHome(t), { ref, stats: refStats } = marketFor(l), aids = aidsFor(l)
  const nego = negotiation(l, ref?.ppm2), days = daysOnline(l), drop = dropped(l)
  const b = l.building, dpeReg = b?.dpe.find(d => d.number === b.dpe_match)
  const near = nearby(l.location.point, Array.isArray(data.area.pois) ? data.area.pois : [])
  const travel = (data.area.isochrones ?? []).filter(i => i.geometry && l.location.point && inGeometry(l.location.point, i.geometry))
  const short = `${titleOf(l)}, ${eur(l.price)}${l.location.address ? `, ${l.location.address}` : ""}`
  // opened: no longer « Nouveau » (lib/rank unseen)
  useEffect(() => { if (!l.seen_at) api.listing(slug, l.id, { seen: true }).then(reload, () => {}) }, [slug, l.id, l.seen_at, reload])

  async function setStatus(s: string) {
    await api.listing(slug, l.id, { my_status: (s || null) as Status })
    await reload()
  }

  return (
    <div className="flex flex-col gap-3">
      <Photos l={l} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1">
          <span className="text-3xl font-bold tracking-tight">{eur(l.price)}</span>
          <FavoriteButton l={l} variant="inline" />
        </span>
        <span className="text-sm text-muted-foreground">
          {[l.area && `${l.area} m²`, l.land_area && `terrain de ${l.land_area} m²`, l.rooms && `${l.rooms} pièces`, t === "flat" && l.floor != null && (l.floor === 0 ? "rez-de-chaussée" : `${l.floor}ᵉ étage${l.floors ? ` sur ${l.floors}` : ""}`), perUnit(unitPrice(l), t)].filter(Boolean).join(" · ")}
        </span>
      </div>
      {/* found here, and first put online on a portal (the oldest of its adverts, engine lib/listings.js) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Origin l={l} variant="line" />
        {l.published_at && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarClockIcon className="size-4" />1ʳᵉ mise en ligne le <span className="font-medium text-foreground">{date(l.published_at)}</span>{days != null && ` (${days ? `il y a ${days} j` : "aujourd'hui"})`}
          </p>
        )}
      </div>
      <LocationLine l={l} />
      <Portals l={l} />
      <Contacts l={l} />
      <div className="flex flex-wrap items-center gap-2">
        {/* on a phone, the four statuses share the width instead of running off it */}
        <ToggleGroup type="single" variant="outline" size="sm" value={l.my_status ?? ""} onValueChange={setStatus} aria-label="Mon statut" className="w-full sm:w-auto">
          {Object.entries(STATUS_LABEL).map(([k, v]) => <ToggleGroupItem key={k} value={k} className="flex-1 gap-1 px-1.5 sm:flex-none sm:px-2.5"><StatusDot status={k as Status} />{v}</ToggleGroupItem>)}
        </ToggleGroup>
        <span className="flex flex-wrap gap-2 sm:ml-auto">
          <Button variant={compare.includes(l.id) ? "secondary" : "outline"} size="sm" aria-pressed={compare.includes(l.id)} onClick={() => toggleCompare(l.id)}>{compare.includes(l.id) ? <CheckIcon data-icon="inline-start" /> : <ScaleIcon data-icon="inline-start" />}Comparer</Button>
          <AskMenu l={l} short={short} analyse />
        </span>
      </div>
      <LabelsEditor l={l} />

      {/* the page (`wide`) on a wide screen: the blocks on two halves, on the right the conversation, the follow-up, the
          budget and renting or buying; narrower, the panel's order */}
      {halves ? (
        <div className="grid grid-cols-2 items-start gap-4">
          <div className="flex min-w-0 flex-col gap-3">
            <Synthesis l={l} aids={aids} />

            <Section title="Prix et négociation">
              <PriceChart l={l} sold={ref?.ppm2 ? (t === "parking" ? ref.ppm2 : l.area ? ref.ppm2 * l.area : null) : null} />
              {refStats && <Ruler stats={refStats} ticks={[{ id: l.id, ppm2: l.price_per_m2 }]} />}
              <Row label="Écart au prix vendu"><Gap ppm2={l.price_per_m2} refPpm2={ref?.ppm2} long /></Row>
              <Row label={`Vendu, ${{ recent: "zone (2 ans)", zone: "zone (5 ans)", commune: "commune" }[ref?.scope ?? "recent"]}`} hint={ref ? `${ref.count} ventes` : undefined}>{perUnit(ref?.ppm2, t)}</Row>
              {data.market.dvf?.[t]?.street?.count ? <Row label={`Vendu, ${data.search.street?.name ?? "rue"}`}>{perUnit(data.market.dvf[t]!.street!.median_ppm2, t)}</Row> : null}
              {asking(data.market, t) ? <Row label="Affiché, zone (dernier mois)">{m2(asking(data.market, t))}</Row> : null}
              <Row label="En ligne depuis">{days != null ? `${days} jours, depuis le ${date(l.published_at ?? l.first_seen)}` : "—"}{l.urgent ? " · urgent" : ""}{l.favorites ? ` · ${l.favorites} favoris` : ""}</Row>
              {drop > 0 && <Row label="Baisses déjà faites">{pct(-drop, 1)}</Row>}
              {/* the portals' changes and those the search saw: a change both saw, once */}
              {[...new Map([...l.price_changes.map(c => ({ date: c.date, text: `${eur(c.from)} → ${eur(c.to)}` })), ...(l.changes ?? []).filter(c => c.kind === "price_drop" || c.kind === "price_rise").map(c => ({ date: c.date, text: `${eur(c.from as number)} → ${eur(c.to as number)}` }))].map(c => [`${c.date.slice(0, 10)}|${c.text}`, c])).values()].map(c => (
                <Row key={`${c.date}|${c.text}`} label={date(c.date)}>{c.text}</Row>
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
              <Button size="xs" variant="outline" onClick={() => run({ cmd: "enrich", slug, args: { id: l.id }, label: "Analyse du bâtiment (gratuit)" })}><SearchCheckIcon data-icon="inline-start" />{b ? "Mettre à jour" : "Analyser"}</Button>
            }>
              <Row label="Localisation">{l.location.address ?? "—"} ({l.location_source ? placedBy(l.location) : ACCURACY_LABEL[l.location.accuracy ?? "UNKNOWN"] ?? "inconnue"})</Row>
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

            <ParcelSection l={l} onView={onView} />

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
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <Conversation l={l} short={short} />
            <FollowSection l={l} />
            <BudgetSection l={l} profileIncome={profile.net_income_monthly} />
            {home && <RentSection l={l} />}
          </div>
        </div>
      ) : (
        <>
          <Synthesis l={l} aids={aids} />

          <Section title="Prix et négociation">
            <PriceChart l={l} sold={ref?.ppm2 ? (t === "parking" ? ref.ppm2 : l.area ? ref.ppm2 * l.area : null) : null} />
            {refStats && <Ruler stats={refStats} ticks={[{ id: l.id, ppm2: l.price_per_m2 }]} />}
            <Row label="Écart au prix vendu"><Gap ppm2={l.price_per_m2} refPpm2={ref?.ppm2} long /></Row>
            <Row label={`Vendu, ${{ recent: "zone (2 ans)", zone: "zone (5 ans)", commune: "commune" }[ref?.scope ?? "recent"]}`} hint={ref ? `${ref.count} ventes` : undefined}>{perUnit(ref?.ppm2, t)}</Row>
            {data.market.dvf?.[t]?.street?.count ? <Row label={`Vendu, ${data.search.street?.name ?? "rue"}`}>{perUnit(data.market.dvf[t]!.street!.median_ppm2, t)}</Row> : null}
            {asking(data.market, t) ? <Row label="Affiché, zone (dernier mois)">{m2(asking(data.market, t))}</Row> : null}
            <Row label="En ligne depuis">{days != null ? `${days} jours, depuis le ${date(l.published_at ?? l.first_seen)}` : "—"}{l.urgent ? " · urgent" : ""}{l.favorites ? ` · ${l.favorites} favoris` : ""}</Row>
            {drop > 0 && <Row label="Baisses déjà faites">{pct(-drop, 1)}</Row>}
            {/* the portals' changes and those the search saw: a change both saw, once */}
            {[...new Map([...l.price_changes.map(c => ({ date: c.date, text: `${eur(c.from)} → ${eur(c.to)}` })), ...(l.changes ?? []).filter(c => c.kind === "price_drop" || c.kind === "price_rise").map(c => ({ date: c.date, text: `${eur(c.from as number)} → ${eur(c.to as number)}` }))].map(c => [`${c.date.slice(0, 10)}|${c.text}`, c])).values()].map(c => (
              <Row key={`${c.date}|${c.text}`} label={date(c.date)}>{c.text}</Row>
            ))}
            {nego ? (
              <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                <span className="text-xs text-muted-foreground">Marge de négociation estimée</span>
                <span className="text-2xl font-bold">{share(nego.low)} à {share(nego.high)}</span>
                <span className="text-xs text-muted-foreground">soit {eur(Math.round((l.price ?? 0) * nego.low))} à {eur(Math.round((l.price ?? 0) * nego.high))} · {["3 % d'écart habituel entre affiché et vendu", ...nego.reasons.map((r: unknown[]) => REASON[r[0] as string]?.(r[1] as number | boolean))].join(", ")}</span>
              </div>
            ) : <p className="text-sm text-muted-foreground">Pas de marge : le bien est sous offre, vendu ou retiré.</p>}
          </Section>

          <Conversation l={l} short={short} />

          <Section title="Bâtiment et risques" action={
            <Button size="xs" variant="outline" onClick={() => run({ cmd: "enrich", slug, args: { id: l.id }, label: "Analyse du bâtiment (gratuit)" })}><SearchCheckIcon data-icon="inline-start" />{b ? "Mettre à jour" : "Analyser"}</Button>
          }>
            <Row label="Localisation">{l.location.address ?? "—"} ({l.location_source ? placedBy(l.location) : ACCURACY_LABEL[l.location.accuracy ?? "UNKNOWN"] ?? "inconnue"})</Row>
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

          <ParcelSection l={l} onView={onView} />

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

          <FollowSection l={l} />
        </>
      )}
    </div>
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

// who sells it: the agency (or the private seller, « particulier » after their name) with a phone and an email to reach
// them, one line each; the pencil corrects a contact badly read (name, phone, email)
function Contacts({ l }: { l: Listing }) {
  if (!l.publishers.length) return null
  const link = "underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  return (
    <div className="flex flex-col gap-1 text-sm">
      {l.publishers.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <ContactRoundIcon className="size-4 text-muted-foreground" />{p.name ?? (p.type === "PRIVATE_INDIVIDUAL" ? "Particulier" : "Agence")}
            {p.name && p.type === "PRIVATE_INDIVIDUAL" && <span className="font-normal text-muted-foreground">particulier</span>}
            {p.card && <span className="font-normal text-muted-foreground">carte {p.card}</span>}
          </span>
          {p.phone && <a href={`tel:${p.phone.replace(/\s/g, "")}`} className={cn("flex items-center gap-1", link)}><PhoneIcon className="size-3.5" />{p.phone}</a>}
          {p.email && <a href={`mailto:${p.email}`} className={cn("flex items-center gap-1", link)}><MailIcon className="size-3.5" />{p.email}</a>}
          <EditContact l={l} index={i} />
        </div>
      ))}
    </div>
  )
}

// « Modifier le contact »: its name, phone and email by hand (blank clears), kept when the listing is refreshed; the
// conversation's messages to its old name take the new one
function EditContact({ l, index }: { l: Listing; index: number }) {
  const { slug, reload } = useSearch()
  const p = l.publishers[index]
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [v, setV] = useState({ name: "", phone: "", email: "" })
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.listing(slug, l.id, { contact: { index, ...v } })
      await reload()
      toast.success("Contact enregistré")
      setOpen(false)
    } catch (err) { toast.error("Le contact n'a pas été enregistré", { description: `Détail technique : ${(err as Error).message}` }) }
    setBusy(false)
  }
  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (o) setV({ name: p.name ?? "", phone: p.phone ?? "", email: p.email ?? "" }) }}>
      <DialogTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Modifier le contact" title="Modifier le contact"><PencilIcon /></Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Modifier le contact</DialogTitle>
            <DialogDescription>L'agence ou le vendeur. Les messages de la conversation prennent le nouveau nom, et une mise à jour de l'annonce garde ce contact.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field><FieldLabel htmlFor={`c-name-${index}`}>Prénom et nom</FieldLabel><Input id={`c-name-${index}`} value={v.name} onChange={set("name")} autoComplete="off" placeholder="Ex. : Claire Martin, ou l'agence" /></Field>
            <Field><FieldLabel htmlFor={`c-phone-${index}`}>Téléphone</FieldLabel><Input id={`c-phone-${index}`} type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} autoComplete="off" placeholder="facultatif" /></Field>
            <Field><FieldLabel htmlFor={`c-email-${index}`}>E-mail</FieldLabel><Input id={`c-email-${index}`} type="email" value={v.email} onChange={set("email")} autoComplete="off" placeholder="facultatif" /></Field>
          </FieldGroup>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
const hhmm = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" })
const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" })
const weekdayYear = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
const dayKey = (d: string) => new Date(d).toDateString()
// a day of the conversation: « Aujourd'hui », « Hier », « Dimanche 9 novembre » (with its year when not this one)
function dayLabel(d: string) {
  const x = new Date(d), now = new Date(), yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (x.toDateString() === now.toDateString()) return "Aujourd'hui"
  if (x.toDateString() === yesterday.toDateString()) return "Hier"
  const s = (x.getFullYear() === now.getFullYear() ? weekday : weekdayYear).format(x)
  return s[0].toUpperCase() + s.slice(1)
}
// whole days since a date, as lib/market.js daysOnline counts them
const daysSince = (d: string) => Math.floor((Date.now() - Date.parse(d)) / 864e5)
// a name's initials: its first and last words (« Fabienne Abouhab Denoncin » → « FD »)
const initials = (name: string) => { const w = name.trim().split(/\s+/); return `${w[0][0]}${w.length > 1 ? w.at(-1)![0] : ""}`.toUpperCase() }
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`
type Change = { sent?: boolean; delete?: boolean; document?: { id: string; type: string } }

// The conversation with the agency or the seller, in order, a separator a day: the other side's messages on the left on
// their light blue, the user's on the right (the agent's drafts dashed until sent). The thread keeps a height of its own
// and opens on the start of the latest message (an added one comes into view the same way). Under it, adding a
// message and writing one with the agent, the next step suggested:
// answering the last message received, or following up one left 3 days without an answer. The agent reads it all
// before writing the next one.
function Conversation({ l, short }: { l: Listing; short: string }) {
  const { slug, reload } = useSearch()
  const [ask, setAsk] = useState<"reply" | "follow_up" | null>(null)
  const ms = (l.messages ?? []).toSorted((a, b) => a.date.localeCompare(b.date)), t = typeOf(l) as PropertyType
  const docs = ms.reduce((n, m) => n + (m.documents?.length ?? 0), 0), last = ms.at(-1)
  const waiting = last && last.from !== "them" && last.sent_at ? daysSince(last.sent_at) : null
  const next = last?.from === "them" ? { ask: "reply" as const, label: "Répondre", icon: ReplyIcon }
    : waiting != null && waiting >= 3 ? { ask: "follow_up" as const, label: "Relancer", icon: BellRingIcon } : null
  async function change(m: Message, body: Change) {
    await api.listing(slug, l.id, { message: { id: m.id, ...body } })
    await reload()
    if (body.document) toast.success(`Type du document : ${DOC_LABEL[body.document.type]}`)
    else if (body.delete) toast.success("Message supprimé de la conversation")
    else if (body.sent) toast.success(m.kind === "offer" ? "Offre envoyée : le bien passe dans « Offre faite »" : "Message marqué comme envoyé")
    else if (body.sent === false) toast.success("Message remis en brouillon")
  }
  const write = (
    <span className="flex flex-wrap gap-2">
      {next && <Button size="sm" onClick={() => setAsk(next.ask)}><next.icon data-icon="inline-start" />{next.label}</Button>}
      <AskMenu l={l} short={short} />
    </span>
  )
  return (
    <Section title="Conversation" action={ms.length > 0 && <span className="text-xs text-muted-foreground">{plural(ms.length, "message")}{docs ? ` · ${plural(docs, "document")}` : ""}</span>}>
      {!ms.length ? (
        <Empty className="border border-dashed p-6 md:p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MessagesSquareIcon /></EmptyMedia>
            <EmptyTitle>Aucun message</EmptyTitle>
            <EmptyDescription>Gardez ici les réponses de l'agence, le résumé d'un appel ou les documents reçus. L'agent lit toute la conversation avant d'écrire.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center"><AddMessage l={l} />{write}</EmptyContent>
        </Empty>
      ) : (
        <>
          <MessageScrollerProvider defaultScrollPosition="last-anchor">
            {/* the scrollbar in the card's padding, kept off the bubbles */}
            <MessageScroller className="-mr-3 max-h-[min(36rem,65dvh)]">
              <MessageScrollerViewport aria-label="Messages de la conversation">
                <MessageScrollerContent className="gap-4 py-1 pr-3">
                  {ms.map((m, i) => (
                    <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={i === ms.length - 1} className="flex flex-col gap-4">
                      {(i === 0 || dayKey(ms[i - 1].date) !== dayKey(m.date)) && <Marker variant="separator"><MarkerContent>{dayLabel(m.date)}</MarkerContent></Marker>}
                      <MessageRow m={m} t={t} onChange={b => change(m, b)} />
                    </MessageScrollerItem>
                  ))}
                  {next?.ask === "follow_up" && (
                    <MessageScrollerItem messageId="waiting">
                      <Marker className="justify-center"><MarkerIcon><ClockIcon /></MarkerIcon><MarkerContent>Sans réponse depuis {waiting} jours</MarkerContent></Marker>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton title="Aller à la fin" />
            </MessageScroller>
          </MessageScrollerProvider>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><AddMessage l={l} />{write}</div>
        </>
      )}
      {ask && <AskDialog key={ask} ask={ask} l={l} short={short} onClose={() => setAsk(null)} />}
    </Section>
  )
}

// One message: who and what above it, its text (6 lines, then « Lire la suite »), the amount of an offer, its documents;
// under it the channel, the time and, for the user's, sent or a draft to mark sent. Copying, back to a draft and
// deleting sit in « ⋯ », shown on hover with a mouse and always on a touch screen (on the inner side: left of the
// user's messages).
function MessageRow({ m, t, onChange }: { m: Message; t: PropertyType; onChange: (b: Change) => void }) {
  const [full, setFull] = useState(false), [confirm, setConfirm] = useState(false)
  const mine = m.from !== "them", docs = m.documents ?? [], Icon = m.channel ? CHANNEL_ICON[m.channel] : MailIcon
  const long = m.text.split("\n").length > 6 || m.text.length > 420, kind = m.kind !== "other" ? MESSAGE_LABEL[m.kind] : null
  const who = (mine ? [kind, m.to && `à ${m.to}`] : [m.to ?? "L'agence ou le vendeur", kind]).filter(Boolean).join(" · ")
  return (
    <ChatMessage align={mine ? "end" : "start"}>
      {!mine && (
        <MessageAvatar>
          <Avatar><AvatarFallback className="bg-them font-medium text-foreground">{m.to?.trim() ? initials(m.to) : <ContactRoundIcon className="size-4" />}</AvatarFallback></Avatar>
        </MessageAvatar>
      )}
      <MessageContent>
        {who && <MessageHeader>{who}</MessageHeader>}
        {/* with documents, the whole width: room for their cards */}
        <Bubble variant={mine ? (m.sent_at ? "muted" : "draft") : "them"} align={mine ? "end" : "start"} className={cn(docs.length > 0 && "max-w-full")}>
          <BubbleContent className="flex flex-col gap-2">
            {m.amount ? <p className="text-lg font-semibold tabular-nums">{eur(m.amount)}</p> : null}
            {m.text && <p className={cn("whitespace-pre-line", long && !full && "line-clamp-6 mask-b-from-50%")}>{m.text}</p>}
            {long && <Button variant="link" size="xs" className="h-auto self-start p-0" aria-expanded={full} onClick={() => setFull(!full)}>{full ? "Réduire" : "Lire la suite"}</Button>}
            {docs.length > 0 && <Documents docs={docs} t={t} onChange={onChange} />}
          </BubbleContent>
        </Bubble>
        <MessageFooter className="flex-wrap gap-x-2 gap-y-1">
          <Icon className="size-3.5" aria-label={m.channel ? CHANNEL_LABEL[m.channel] : "Message"} />
          <time dateTime={m.date} title={dateTime(m.date)}>{hhmm.format(new Date(m.date))}</time>
          {mine && (m.sent_at
            ? <span className="flex items-center gap-1"><CheckIcon className="size-3.5" />Envoyé{dayKey(m.sent_at) !== dayKey(m.date) ? ` le ${date(m.sent_at)}` : ""}</span>
            : <><Badge variant="outline">Brouillon</Badge><Button size="xs" onClick={() => onChange({ sent: true })}><SendIcon data-icon="inline-start" />Marquer envoyé</Button></>)}
          {/* not modal: the dialog it opens gets the focus */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Actions du message" className={cn("pointer-fine:opacity-0 pointer-fine:group-hover/message:opacity-100 pointer-fine:group-focus-within/message:opacity-100 data-[state=open]:opacity-100", mine && "order-first")}><EllipsisIcon /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={mine ? "end" : "start"}>
              <DropdownMenuGroup>
                {m.text && <DropdownMenuItem onSelect={async () => { await navigator.clipboard.writeText(m.text); toast.success("Message copié") }}><CopyIcon />Copier le texte</DropdownMenuItem>}
                {mine && m.sent_at && <DropdownMenuItem onSelect={() => onChange({ sent: false })}><Undo2Icon />Remettre en brouillon</DropdownMenuItem>}
              </DropdownMenuGroup>
              {(m.text || (mine && m.sent_at)) && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}><Trash2Icon />Supprimer</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </MessageFooter>
      </MessageContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
            <AlertDialogDescription>Il sera retiré de la conversation{docs.length ? ` avec ${docs.length > 1 ? `ses ${docs.length} documents` : "son document"}, supprimé${docs.length > 1 ? "s" : ""} du dossier` : ""}, et l'agent ne le lira plus.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onChange({ delete: true })}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ChatMessage>
  )
}

// A message's documents, by type: a line counting each type, then a card each (a click opens it, the tag gives it its
// type, the one its name said to begin with); past four, the others fold under « + n autres documents »
const DOC_ORDER = Object.keys(DOC_LABEL)
function Documents({ docs, t, onChange }: { docs: Doc[]; t: PropertyType; onChange: (b: Change) => void }) {
  const { slug } = useSearch()
  const [all, setAll] = useState(false)
  const sorted = docs.map(d => ({ d, type: typeOfDoc(d) })).toSorted((a, b) => DOC_ORDER.indexOf(a.type) - DOC_ORDER.indexOf(b.type) || a.d.name.localeCompare(b.d.name))
  const count = new Map<string, number>()
  for (const x of sorted) count.set(x.type, (count.get(x.type) ?? 0) + 1)
  const shown = all || sorted.length <= 4 ? sorted : sorted.slice(0, 4), rest = sorted.length - 4
  return (
    <div className="flex flex-col gap-1.5">
      {docs.length > 1 && <p className="text-xs text-muted-foreground">{plural(docs.length, "document")} · {[...count].map(([k, n]) => `${DOC_LABEL[k]}${n > 1 ? ` ×${n}` : ""}`).join(" · ")}</p>}
      <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Documents">
        {shown.map(({ d, type }) => (
          <li key={d.id} className="min-w-0">
            <Attachment size="sm" className="w-full min-w-0">
              <AttachmentMedia><DocIcon name={d.name} /></AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{type !== "other" ? DOC_LABEL[type] : d.name}</AttachmentTitle>
                <AttachmentDescription>{type !== "other" ? `${d.name} · ` : ""}{bytes(d.size)}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentTrigger asChild><a href={docUrl(slug, d)} target="_blank" rel="noreferrer" title={d.name}><span className="sr-only">Ouvrir {d.name}</span></a></AttachmentTrigger>
              <AttachmentActions>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><AttachmentAction aria-label={`Type de ${d.name} : ${DOC_LABEL[type]}`}><TagIcon /></AttachmentAction></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto">
                    <DropdownMenuRadioGroup value={type} onValueChange={v => v !== type && onChange({ document: { id: d.id, type: v } })}>
                      {docTypesFor(t, type).map(g => (
                        <Fragment key={g.label}>
                          <DropdownMenuLabel className="text-xs text-muted-foreground">{g.label}</DropdownMenuLabel>
                          {g.items.map(x => <DropdownMenuRadioItem key={x.key} value={x.key}>{x.label}</DropdownMenuRadioItem>)}
                        </Fragment>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </AttachmentActions>
            </Attachment>
          </li>
        ))}
      </ul>
      {sorted.length > 4 && (
        <Button variant="ghost" size="xs" className="self-start" aria-expanded={all} onClick={() => setAll(!all)}>
          <ChevronDownIcon data-icon="inline-start" className={cn(all && "rotate-180")} />{all ? "Réduire" : `${plural(rest, "autre")} document${rest > 1 ? "s" : ""}`}
        </Button>
      )}
    </div>
  )
}

// now as a datetime-local value: "2026-10-27T18:30"
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
// the documents a message may carry, as the engine takes them (immo.mjs DOC_MIME): 20 of 25 MB at most
const DOC_EXT = ["pdf", "png", "jpg", "jpeg", "webp", "gif", "heic", "txt", "csv", "doc", "docx", "odt", "xls", "xlsx", "ods", "rtf", "eml"], DOC_MAX = 25e6, DOCS_MAX = 20
const base64 = (f: File) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => ko(r.error); r.readAsDataURL(f) })
// a message the user adds to the conversation: the agency's reply, a call summed up, or one they sent themselves, with
// its documents (the text is then optional)
function AddMessage({ l }: { l: Listing }) {
  const { slug, reload } = useSearch()
  const [open, setOpen] = useState(false), [from, setFrom] = useState<"them" | "me">("them"), [channel, setChannel] = useState<Channel>("email")
  const [when, setWhen] = useState(localNow), [text, setText] = useState(""), [amount, setAmount] = useState("")
  // each file with its type, the one its name says to begin with
  const [files, setFiles] = useState<{ f: File; type: string }[]>([]), [busy, setBusy] = useState(false), [over, setOver] = useState(false)
  const t = typeOf(l) as PropertyType
  function attach(list: FileList | null) {
    const all = [...(list ?? [])], ok = all.filter(f => DOC_EXT.includes(f.name.split(".").at(-1)?.toLowerCase() ?? "") && f.size > 0 && f.size <= DOC_MAX)
    if (ok.length < all.length) toast.error("Fichier refusé", { description: "PDF, image, Word, Excel ou texte, de 25 Mo au plus." })
    setFiles(fs => [...fs, ...ok.filter(f => !fs.some(x => x.f.name === f.name && x.f.size === f.size)).map(f => ({ f, type: typeOfDoc({ name: f.name } as Doc) }))].slice(0, DOCS_MAX))
  }
  async function save() {
    setBusy(true)
    try {
      const documents = await Promise.all(files.map(async ({ f, type }) => ({ name: f.name, type, data: await base64(f) })))
      await api.listing(slug, l.id, { message: { add: { from, channel, date: new Date(when).toISOString(), text, ...(amount ? { amount: Number(amount) } : {}), sent: from === "me", ...(documents.length ? { documents } : {}) } } })
    } catch (e) { setBusy(false); return toast.error("Le message n'a pas été ajouté", { description: `Détail technique : ${(e as Error).message}` }) }
    await reload()
    setBusy(false)
    toast.success(files.length ? `Message ajouté avec ${files.length > 1 ? `${files.length} documents` : "son document"}` : "Message ajouté à la conversation")
    setOpen(false)
    setText("")
    setAmount("")
    setFiles([])
  }
  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (o) setWhen(localNow()) }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><PlusIcon data-icon="inline-start" />Ajouter un message</Button></DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ajouter un message</DialogTitle>
          <DialogDescription>Une réponse de l'agence, le résumé d'un appel ou un message que vous avez envoyé, avec ses documents : l'agent le lira avant d'écrire le suivant.</DialogDescription>
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
          <Field>
            <FieldLabel htmlFor="m-files">Documents{files.length ? ` (${files.length})` : ""}</FieldLabel>
            <label onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); attach(e.dataTransfer.files) }}
              className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", over && "border-primary bg-primary/5")}>
              <PaperclipIcon className="size-5" />
              <span>Glissez les documents ici, ou <span className="font-medium text-foreground underline underline-offset-4">choisissez-les</span></span>
              <span className="text-xs">Diagnostics, PV d'AG, taxe foncière… PDF, image, Word, Excel ou texte, 25 Mo au plus chacun</span>
              <input id="m-files" type="file" multiple accept={DOC_EXT.map(x => `.${x}`).join(",")} className="sr-only" onChange={e => { attach(e.target.files); e.target.value = "" }} />
            </label>
            {files.length > 0 && (
              <ul className="flex flex-col gap-1">
                {files.map(x => (
                  <li key={`${x.f.name}|${x.f.size}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border py-1 pr-1 pl-2 text-sm">
                    <DocIcon name={x.f.name} className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{x.f.name}</span><span className="shrink-0 text-xs text-muted-foreground">{bytes(x.f.size)}</span>
                    <span className="flex items-center gap-1 max-sm:w-full">
                      <Select value={x.type} onValueChange={type => setFiles(fs => fs.map(y => (y === x ? { ...y, type } : y)))}>
                        <SelectTrigger size="sm" className="w-56 max-sm:flex-1" aria-label={`Type de ${x.f.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {docTypesFor(t).map(g => (
                            <SelectGroup key={g.label}>
                              <SelectLabel>{g.label}</SelectLabel>
                              {g.items.map(o => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon-xs" aria-label={`Retirer ${x.f.name}`} onClick={() => setFiles(fs => fs.filter(y => y !== x))}><XIcon /></Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </FieldGroup>
        <DialogFooter><Button onClick={save} disabled={busy || (!text.trim() && !files.length) || !when}>{busy ? "Envoi…" : "Ajouter à la conversation"}</Button></DialogFooter>
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
