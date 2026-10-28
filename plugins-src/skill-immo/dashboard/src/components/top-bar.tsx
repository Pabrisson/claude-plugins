import { WEIGHTS } from "@engine/decide.js"
import { matches } from "@engine/market.js"
import { BellIcon, CheckCheckIcon, ClipboardCopyIcon, DownloadIcon, HomeIcon, MessageSquarePlusIcon, MinusIcon, MoonIcon, PlusIcon, RefreshCwIcon, SlidersHorizontalIcon, SunIcon, Trash2Icon, UserRoundIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { LOOK, newsKey, NewsTile, newsTitle, UnreadDot, useNews, whenOf } from "@/components/news"
import { useRun } from "@/components/run-dialog"
import { CriteriaFields, criteriaArg, NewSearch, TypesField } from "@/components/search-form"
import { TypeIcon } from "@/components/type-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Criteria, type Profile, type PropertyType, type ScoreKey } from "@/lib/api"
import { criteriaLabels, eur, num, SCORE_LABEL, TYPE_PLURAL } from "@/lib/format"
import { useSearch, type Feedback } from "@/lib/store"
import { cn } from "@/lib/utils"


// the Copy prompt, as the skill's "apply this feedback" mode reads it
export const promptText = (slug: string, items: Feedback[]) =>
  `/skill-immo:property-search apply this feedback (recherche ${slug})\n${items.map((f, i) => `${i + 1}. [${f.kind}] ${f.text}`).join("\n")}`

export function TopBar({ onNews }: { onNews: () => void }) {
  const { slug, data, state } = useSearch()
  const run = useRun()
  const s = data.search, streamOn = state.stream_estate && s.mode === "stream-estate"
  const chips = criteriaLabels(s.criteria)
  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2 md:flex-nowrap md:px-4">
      <Button variant="ghost" size="icon-sm" asChild aria-label="Toutes les recherches"><a href="/"><HomeIcon /></a></Button>
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-bold md:text-base">{s.label}</h1>
          <Tooltip>
            <TooltipTrigger asChild><Badge variant={streamOn ? "default" : "secondary"} className="shrink-0">{s.mode === "stream-estate" ? "API payante" : "OpenData"}</Badge></TooltipTrigger>
            <TooltipContent>{s.mode === "stream-estate" ? (state.stream_estate ? "Annonces de tous les portails via l'API payante (payant, avec votre accord)" : "Mode API payante, mais la clé est absente : rien ne sera facturé") : "Open data et annonces trouvées par Claude : gratuit"}</TooltipContent>
          </Tooltip>
        </span>
        <span className="truncate text-xs text-muted-foreground">{s.zone.label}</span>
      </div>
      {/* the criteria in the middle of the room left between the title and the actions */}
      <span className="hidden flex-1 md:block" />
      <CriteriaPopover chips={chips} />
      <span className="flex-1" />
      <span className="flex flex-wrap items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" disabled={!streamOn} onClick={() => run({ cmd: "fetch", slug, label: "Annonces de l'API payante" })}>
                <DownloadIcon data-icon="inline-start" /><span className="max-sm:sr-only">Annonces</span>{s.stream?.total ? ` (${s.stream.total})` : ""}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{streamOn ? "Récupérer les annonces de la zone : le coût est annoncé avant" : state.stream_estate ? "Recherche en mode OpenData : demandez à Claude de chercher des annonces" : "Nécessite une clé de l'API payante. Sans clé, Claude cherche les annonces pour vous"}</TooltipContent>
        </Tooltip>
        <NewsBell onOpen={onNews} />
        <AddListing />
        <PromptButton />
        <ProfileDialog />
        <ThemeButton />
      </span>
    </header>
  )
}

// The bell: the count of the news not read yet (the server's watch, Claude's refresh), a toast when more come in, and
// on a click the latest ones. A listing's opens its dossier, the others the follow-up on them.
function NewsBell({ onOpen }: { onOpen: () => void }) {
  const { slug, unread, stale, state, select, focusNews, reload } = useSearch()
  const { items, fresh } = useNews()
  const [open, setOpen] = useState(false)
  const before = useRef(unread), away = useRef(false)
  // a news picked: the panel closes on the follow-up or the dossier, and the focus goes there rather than to the bell
  const leave = () => { away.current = true; setOpen(false) }
  const follow = (key: string) => { focusNews(key); onOpen(); leave() }
  useEffect(() => {
    const more = unread - before.current
    if (more > 0) toast(`${more} nouveauté${more > 1 ? "s" : ""} dans le suivi`, { action: { label: "Voir", onClick: () => { focusNews("all"); onOpen() } } })
    before.current = unread
  }, [unread, onOpen, focusNews])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative" aria-label={unread ? `${unread} notification${unread > 1 ? "s" : ""} non lue${unread > 1 ? "s" : ""}` : "Notifications"}>
              <BellIcon />
              {unread > 0 && <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] tabular-nums">{unread > 99 ? "99+" : unread}</Badge>}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Nouveaux DPE et annonces{state.watch_hours ? ` : le serveur vérifie à son démarrage, puis toutes les ${num(state.watch_hours)} h` : ""}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0" onCloseAutoFocus={e => { if (away.current) e.preventDefault(); away.current = false }}>
        <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2">
          <p className="text-sm font-medium">Notifications</p>
          <p className="text-xs text-muted-foreground">{unread ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est lu"}</p>
        </div>
        {stale && (
          <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
            De nouvelles notifications sont arrivées.<Button size="xs" variant="secondary" onClick={() => location.reload()}>Recharger</Button>
          </div>
        )}
        {items.length ? (
          <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {items.slice(0, 6).map(n => (
              <li key={newsKey(n)}>
                <button type="button" onClick={() => { if ("l" in n) { select(n.l.id); leave() } else follow(newsKey(n)) }}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                  <NewsTile n={n} dim={!fresh(n)} className="size-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold" style={{ color: LOOK[n.kind].color }}>{LOOK[n.kind].label}{fresh(n) && <span className="sr-only">, non lue</span>}</span>
                    <span className={cn("block truncate text-sm", fresh(n) ? "font-medium" : "text-muted-foreground")}>{newsTitle(n)}</span>
                  </span>
                  <time dateTime={n.date} className="shrink-0 text-xs text-muted-foreground tabular-nums">{whenOf(n.date)}</time>
                  {fresh(n) ? <UnreadDot /> : <i aria-hidden className="size-2 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-sm text-muted-foreground">Aucune notification pour l'instant : le serveur vérifie les DPE et les annonces de la zone à son démarrage, puis régulièrement.</p>
        )}
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button variant="ghost" size="sm" disabled={!unread} onClick={async () => { await api.readFeed(slug); await reload() }}><CheckCheckIcon data-icon="inline-start" />Tout marquer comme lu</Button>
          <Button variant="secondary" size="sm" onClick={() => follow("all")}>Voir tout le suivi</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// The criteria, the types and the source of the search: what changed goes into the prompt as [affiner], in the engine's
// form (an emptied criterion is `k=`, which drops it) then in words. Claude runs the search with it: the dashboard
// starts nothing itself.
function CriteriaPopover({ chips }: { chips: string[] }) {
  const { data, state, addFeedback } = useSearch()
  const s = data.search, was = s.types ?? ["flat"]
  const [open, setOpen] = useState(false)
  const [c, setC] = useState(s.criteria), [mode, setMode] = useState(s.mode), [types, setTypes] = useState<PropertyType[]>(was)
  const before = s.criteria as Record<string, unknown>, now = c as Record<string, unknown>
  const diff = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(now)])].filter(k => (now[k] ?? null) !== (before[k] ?? null)).map(k => [k, now[k] ?? undefined])) as Criteria
  const typesChanged = types.join(",") !== was.join(",")
  const engine = [criteriaArg(diff), typesChanged && `types=${types.join(",")}`, mode !== s.mode && `mode=${mode}`].filter(Boolean).join(" ")
  function add() {
    const words = [criteriaLabels(c).join(", ") || "aucun critère", types.map(t => TYPE_PLURAL[t].toLowerCase()).join(", "), mode === "classic" ? "OpenData" : "API payante"].join(" · ")
    addFeedback({ kind: "affiner", text: `${engine} — ${words}` })
    toast.success("Ajouté au prompt : Claude enregistrera ces critères")
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) { setC(s.criteria); setMode(s.mode); setTypes(was) } }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-full">
          <SlidersHorizontalIcon data-icon="inline-start" />
          <span className="flex gap-0.5">{(data.search.types ?? ["flat"]).map(t => <TypeIcon key={t} type={t} />)}</span>
          <span className="truncate">{chips.length ? chips.join(" · ") : "Critères"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[80dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto" align="center">
        <PopoverHeader><PopoverTitle>Critères et source</PopoverTitle><PopoverDescription>Le prompt copié, Claude enregistre ces critères : la liste se filtre dessus, et l'API payante les applique aux prochaines annonces récupérées.</PopoverDescription></PopoverHeader>
        <div className="mt-3 flex flex-col gap-3">
          <TypesField value={types} onChange={setTypes} />
          <CriteriaFields value={c} onChange={setC} types={types} />
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={v => v && setMode(v as typeof mode)}>
            <ToggleGroupItem value="stream-estate" disabled={!state.stream_estate}>API payante</ToggleGroupItem>
            <ToggleGroupItem value="classic">OpenData</ToggleGroupItem>
          </ToggleGroup>
          <Button onClick={add} disabled={!engine}><MessageSquarePlusIcon data-icon="inline-start" />{engine ? "Ajouter au prompt" : "Rien n'a changé"}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// A listing by its link: Stream Estate looks it up (2 credits, with the user's yes); otherwise, or when it does not
// know it, Claude reads the page: the link goes into the prompt.
function AddListing() {
  const { slug, data, state, addFeedback } = useSearch()
  const run = useRun()
  const [open, setOpen] = useState(false), [value, setValue] = useState("")
  const streamOn = state.stream_estate && data.search.mode === "stream-estate", isUrl = /^https?:\/\//.test(value.trim())
  async function submit() {
    if (streamOn && isUrl && (await run({ cmd: "add", slug, args: { url: value.trim() }, label: "Ajout de l'annonce" }))) { setOpen(false); setValue(""); return }
    addFeedback({ kind: "ajouter", text: value.trim().replace(/\s+/g, " ") })
    toast.success("Ajouté au prompt : Claude lira l'annonce")
    setOpen(false)
    setValue("")
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><PlusIcon data-icon="inline-start" /><span className="max-sm:sr-only">Ajouter</span></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une annonce</DialogTitle>
          <DialogDescription>{streamOn ? "Un lien : l'API payante la retrouve (2 crédits, après votre accord). Sinon, ou pour un texte, Claude la lit." : "Collez son lien ou son texte : Claude la lira et l'ajoutera."}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="listing">Lien ou texte de l'annonce</FieldLabel>
          <Textarea id="listing" value={value} onChange={e => setValue(e.target.value)} placeholder="https://www.seloger.com/annonces/…" rows={4} />
        </Field>
        <DialogFooter><Button onClick={submit} disabled={!value.trim()}>{streamOn && isUrl ? "Chercher avec l'API payante" : "Ajouter au prompt"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Ways to widen the search, from what it holds: one wider zone, one higher budget, looser criteria and other types,
// each criterion with the listings already known that would come back into the criteria
type Way = { text: string; gain?: number }
function useWiden() {
  const { data, types } = useSearch()
  const s = data.search, c = s.criteria, z = s.zone, street = s.type === "street" && !!s.street
  const live = data.listings.filter(l => l.status !== "EXPIRED")
  const gain = (c2: Criteria, t2: PropertyType[] = types) => live.filter(l => !matches(l, c, types) && matches(l, c2, t2)).length
  const round = (x: number) => Math.round(x / 1000) * 1000
  const next = (d: string) => "ABCDEFG"["ABCDEFG".indexOf(d) + 1]
  const along = (m: number) => (street ? `${m} m de part et d'autre de la rue` : `${m} m autour du lieu`)
  const keep = (x: unknown[]) => x.filter(Boolean) as Way[]
  return {
    // the zone chosen with the three buttons, as the prompt's line ("" when it stays the same)
    zone: (how: string, radius: number): Way | null =>
      how === "radius" ? (z.how === "radius" && radius === z.radius_m ? null : { text: `zone : ${along(radius)} (au lieu de ${z.how === "radius" && z.radius_m ? `${z.radius_m} m` : z.label})` })
        : how === "iris" ? (z.how === "iris" ? null : { text: `zone : tout le quartier${data.area.iris ? ` (IRIS ${data.area.iris.name})` : ""}` })
          : how === "commune" ? (z.how === "commune" ? null : { text: `zone : toute la commune (${s.district ?? s.city})` }) : null,
    budget: (k: number): Way | null => (c.budget_max && k > 1 ? { text: `budget max ${eur(round(c.budget_max * k))} (au lieu de ${eur(c.budget_max)})`, gain: gain({ ...c, budget_max: round(c.budget_max * k) }) } : null),
    criteria: keep([
      c.rooms_min && c.rooms_min > 1 && { text: `${c.rooms_min - 1} pièces et plus (au lieu de ${c.rooms_min})`, gain: gain({ ...c, rooms_min: c.rooms_min - 1 }) },
      c.rooms_max && { text: `sans maximum de pièces (au lieu de ${c.rooms_max})`, gain: gain({ ...c, rooms_max: undefined }) },
      c.area_min && { text: `surface de ${Math.round(c.area_min * 0.9)} m² et plus (au lieu de ${c.area_min})`, gain: gain({ ...c, area_min: Math.round(c.area_min * 0.9) }) },
      c.area_max && { text: `sans surface maximum (au lieu de ${c.area_max} m²)`, gain: gain({ ...c, area_max: undefined }) },
      c.land_min && { text: `terrain de ${Math.round(c.land_min * 0.8)} m² et plus (au lieu de ${c.land_min})`, gain: gain({ ...c, land_min: Math.round(c.land_min * 0.8) }) },
      c.budget_min && { text: `sans budget minimum (au lieu de ${eur(c.budget_min)})`, gain: gain({ ...c, budget_min: undefined }) },
      c.dpe_max && next(c.dpe_max) && { text: `DPE jusqu'à ${next(c.dpe_max)} (au lieu de ${c.dpe_max})`, gain: gain({ ...c, dpe_max: next(c.dpe_max) }) },
      c.floor_min != null && c.floor_min > 0 && { text: `dès le rez-de-chaussée (au lieu du ${c.floor_min}ᵉ étage)`, gain: gain({ ...c, floor_min: undefined }) },
      c.elevator && { text: "sans exiger d'ascenseur", gain: gain({ ...c, elevator: undefined }) },
      c.outdoor && { text: "sans exiger d'extérieur", gain: gain({ ...c, outdoor: undefined }) },
      types.includes("flat") && !types.includes("house") && { text: "inclure les maisons", gain: gain(c, [...types, "house"]) },
      types.includes("house") && !types.includes("flat") && { text: "inclure les appartements", gain: gain(c, [...types, "flat"]) },
      (types.includes("flat") || types.includes("house")) && !types.includes("parking") && { text: "chercher aussi une place de parking ou un box dans la zone" },
      (types.includes("flat") || types.includes("house")) && { text: "inclure le neuf (programmes et ventes sur plan)" },
      s.mode === "classic" && { text: "chercher aussi chez les notaires et les agences du quartier" },
    ]),
  }
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1)
// "Budget max 355 000 € (au lieu de 340 000 €) · 2 biens déjà connus y entrent"
function WayLabel({ w, htmlFor }: { w: Way; htmlFor: string }) {
  return (
    <FieldLabel htmlFor={htmlFor} className="font-normal">
      {cap(w.text)}{w.gain ? <span className="text-muted-foreground"> · {w.gain} bien{w.gain > 1 ? "s" : ""} déjà connu{w.gain > 1 ? "s" : ""} y entre{w.gain > 1 ? "nt" : ""}</span> : null}
    </FieldLabel>
  )
}
// The zone in three buttons, as the map's layers had them: along the street (or around the place) with its width, the
// IRIS, the commune. None pressed: the zone stays.
function ZonePicker({ how, setHow, radius, setRadius, way }: { how: string; setHow: (v: string) => void; radius: number; setRadius: (v: number) => void; way: Way | null }) {
  const { data } = useSearch()
  const s = data.search, street = s.type === "street" && !!s.street
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="text-muted-foreground">Zone</FieldLegend>
      <ToggleGroup type="single" variant="outline" size="sm" value={how} onValueChange={setHow} className="flex-wrap justify-start" aria-label="Zone">
        <ToggleGroupItem value="radius">{street ? "Le long de la rue" : "Autour du lieu"}</ToggleGroupItem>
        <ToggleGroupItem value="iris">Quartier</ToggleGroupItem>
        <ToggleGroupItem value="commune">Commune</ToggleGroupItem>
      </ToggleGroup>
      {how === "radius" && <Slider className="my-3" min={100} max={1500} step={50} value={[radius]} onValueChange={([v]) => setRadius(v)} aria-label={street ? "Largeur de la zone" : "Rayon de la zone"} />}
      <span className="text-sm text-muted-foreground">{way ? cap(way.text.replace(/^zone : /, "")) : `Zone actuelle : ${s.zone.label}`}</span>
    </FieldSet>
  )
}

// the budget raised by a share of it: a preset, or any percentage typed or stepped with − and +
const PRESETS = { 0: "Garder", 5: "+5 %", 10: "+10 %" } as const
function BudgetPicker({ pct, setPct, way }: { pct: number; setPct: (v: number) => void; way: Way | null }) {
  const { data } = useSearch()
  const set = (v: number) => setPct(Math.max(0, Math.min(50, Math.round(v) || 0)))
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="text-muted-foreground">Budget</FieldLegend>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={pct in PRESETS ? String(pct) : ""} onValueChange={v => set(Number(v))} className="justify-start" aria-label="Budget">
          {Object.entries(PRESETS).map(([k, v]) => <ToggleGroupItem key={k} value={k}>{v}</ToggleGroupItem>)}
        </ToggleGroup>
        <InputGroup className="h-8 w-32">
          <InputGroupAddon><InputGroupButton size="icon-xs" aria-label="Baisser de 1 %" disabled={pct <= 0} onClick={() => set(pct - 1)}><MinusIcon /></InputGroupButton></InputGroupAddon>
          <InputGroupInput type="number" inputMode="numeric" min={0} max={50} value={pct} onChange={e => set(Number(e.target.value))} className="text-center" aria-label="Hausse du budget, en %" />
          <InputGroupAddon align="inline-end">%<InputGroupButton size="icon-xs" aria-label="Monter de 1 %" disabled={pct >= 50} onClick={() => set(pct + 1)}><PlusIcon /></InputGroupButton></InputGroupAddon>
        </InputGroup>
      </div>
      <span className="text-sm text-muted-foreground">
        {way ? <>{cap(way.text)}{way.gain ? ` · ${way.gain} bien${way.gain > 1 ? "s" : ""} déjà connu${way.gain > 1 ? "s" : ""} y entre${way.gain > 1 ? "nt" : ""}` : ""}</> : `Budget actuel : ${eur(data.search.criteria.budget_max)}`}
      </span>
    </FieldSet>
  )
}
function PromptButton() {
  const { slug, data, feedback, removeFeedback, clearFeedback } = useSearch()
  const widen = useWiden()
  const [question, setQuestion] = useState(""), [picked, setPicked] = useState<string[]>([]), [other, setOther] = useState("")
  const z = data.search.zone, start = z.radius_m ? z.radius_m + 200 : data.search.type === "street" ? 300 : 500
  const [how, setHow] = useState(""), [radius, setRadius] = useState(start), [pct, setPct] = useState(0)
  const zoneWay = widen.zone(how, radius), budgetWay = widen.budget(1 + pct / 100)
  const ways = [zoneWay?.text, budgetWay?.text, ...picked, other.trim()].filter(Boolean) as string[]
  const items = [...feedback, ...ways.map(text => ({ kind: "élargir" as const, text })), ...(question.trim() ? [{ kind: "question" as const, text: question.trim() }] : [])]
  async function copy() {
    await navigator.clipboard.writeText(promptText(slug, items))
    toast.success("Prompt copié : collez-le dans Claude Code")
    clearFeedback()
    setQuestion("")
    setPicked([])
    setOther("")
    setHow("")
    setRadius(start)
    setPct(0)
  }
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm"><ClipboardCopyIcon data-icon="inline-start" /><span className="max-sm:sr-only">Copier le prompt</span>{feedback.length ? ` (${feedback.length})` : ""}</Button></PopoverTrigger>
      <PopoverContent align="end" className="max-h-[85dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto">
        <PopoverHeader><PopoverTitle>Pour Claude</PopoverTitle><PopoverDescription>Ce que vous avez demandé dans le dashboard, à coller dans Claude Code.</PopoverDescription></PopoverHeader>
        <div className="mt-3 flex flex-col gap-3">
          {feedback.map((f, i) => (
            <div key={i} className="flex items-start justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm">
              <span className="min-w-0 break-words"><b>{f.kind}</b> {f.text}</span>
              <Button variant="ghost" size="icon-xs" aria-label="Retirer" onClick={() => removeFeedback(i)}><Trash2Icon /></Button>
            </div>
          ))}
          <FieldGroup className="gap-3">
            <FieldLabel>Élargir la recherche</FieldLabel>
            <ZonePicker how={how} setHow={setHow} radius={radius} setRadius={setRadius} way={zoneWay} />
            {data.search.criteria.budget_max && <BudgetPicker pct={pct} setPct={setPct} way={budgetWay} />}
            <FieldSet className="gap-2">
              <FieldLegend variant="label" className="text-muted-foreground">Critères et types</FieldLegend>
              {widen.criteria.map(w => (
                <Field key={w.text} orientation="horizontal" className="items-start">
                  <Checkbox id={w.text} checked={picked.includes(w.text)} onCheckedChange={v => setPicked(p => (v ? [...p, w.text] : p.filter(x => x !== w.text)))} />
                  <WayLabel w={w} htmlFor={w.text} />
                </Field>
              ))}
            </FieldSet>
            <Input value={other} onChange={e => setOther(e.target.value)} placeholder="Autre : la rue voisine, une autre commune…" aria-label="Autre façon d'élargir" />
            <FieldDescription>Claude change la zone ou les critères (gratuit), puis cherche les nouvelles annonces : en mode API payante, le coût est annoncé avant.</FieldDescription>
          </FieldGroup>
          <Separator />
          <Field>
            <FieldLabel htmlFor="question">Votre demande</FieldLabel>
            <Textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="Affine à 3 pièces, compare les deux T3 du haut…" rows={3} />
          </Field>
          <Button onClick={copy} disabled={!items.length}><ClipboardCopyIcon data-icon="inline-start" />Copier{items.length ? ` (${items.length})` : ""}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// the buyer's profile: the numbers of the budget and the credits cap (the places go through Claude: setup)
export function ProfileDialog() {
  const { profile, setProfile } = useSearch()
  const [p, setP] = useState<Profile>(profile)
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) })
  const weights = { ...WEIGHTS, ...p.weights } as Record<ScoreKey, number>
  const fields: [keyof Profile, string, string?][] = [
    ["down_payment", "Apport (€)"], ["net_income_monthly", "Revenus nets du foyer (€/mois)"], ["other_loans_monthly", "Autres crédits (€/mois)"],
    ["rate", "Taux du crédit (%)"], ["years", "Durée (ans)"], ["insurance_rate", "Assurance (% par an)"],
    ["notary_old", "Frais de notaire, ancien", "0,075 = 7,5 %"], ["notary_new", "Frais de notaire, neuf", "0,025 = 2,5 %"],
    ["monthly_credit_cap", "Plafond de crédits de l'API payante par mois"], ["eur_per_credit", "Prix d'un crédit (€)"],
  ]
  return (
    <Dialog onOpenChange={o => o && setP(profile)}>
      <DialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Mon profil"><UserRoundIcon /></Button></DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Mon profil</DialogTitle><DialogDescription>Gardé sur cette machine (.profile.json). Les lieux clés se règlent avec Claude : « setup ».</DialogDescription></DialogHeader>
        <FieldGroup className="grid grid-cols-2 gap-3">
          {fields.map(([k, label, hint]) => (
            <Field key={k}><FieldLabel htmlFor={k}>{label}</FieldLabel><Input id={k} type="number" step="any" value={p[k] as number} onChange={set(k)} />{hint && <FieldDescription>{hint}</FieldDescription>}</Field>
          ))}
        </FieldGroup>
        {profile.places.length > 0 && <p className="text-sm text-muted-foreground">Lieux clés : {profile.places.map(x => x.label).join(", ")}</p>}
        <Separator />
        <FieldGroup className="gap-3">
          <FieldLabel>Priorités du score</FieldLabel>
          <FieldDescription>Le poids de chaque critère dans le score sur 100 des biens : 0 l'ignore, 3 compte le plus.</FieldDescription>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {(Object.keys(SCORE_LABEL) as ScoreKey[]).map(k => (
              <Field key={k}>
                <FieldLabel htmlFor={`w-${k}`} className="flex justify-between font-normal">{SCORE_LABEL[k]}<span className="text-muted-foreground">{["Ignoré", "Faible", "Moyen", "Fort"][weights[k]]}</span></FieldLabel>
                <Slider id={`w-${k}`} min={0} max={3} step={1} value={[weights[k]]} onValueChange={([v]) => setP({ ...p, weights: { ...weights, [k]: v } })} aria-label={`Poids : ${SCORE_LABEL[k]}`} />
              </Field>
            ))}
          </div>
        </FieldGroup>
        <DialogFooter><Button onClick={async () => { setProfile(await api.saveProfile(p)); toast.success("Profil enregistré") }}>Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// what Claude changed while the page was open: a bar to reload the page, which keeps the tab and the dossier open.
// The dossier shows it too: while open, it keeps the page behind it from being clicked.
export function StaleBar() {
  const { stale } = useSearch()
  if (!stale) return null
  return (
    <div role="status" className="flex items-center justify-center gap-3 border-b bg-primary px-3 py-1.5 text-sm text-primary-foreground">
      <RefreshCwIcon className="size-4" />De nouvelles informations sont arrivées (Claude ou la veille du serveur ont mis la recherche à jour).
      <Button size="xs" variant="secondary" onClick={() => location.reload()}>Recharger</Button>
    </div>
  )
}

export function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon-sm" aria-label={resolvedTheme === "dark" ? "Thème clair" : "Thème sombre"} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

export { NewSearch }
