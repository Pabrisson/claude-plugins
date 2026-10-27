import { ClipboardCopyIcon, DownloadIcon, HomeIcon, MoonIcon, PlusIcon, SlidersHorizontalIcon, SunIcon, Trash2Icon, UserRoundIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useState } from "react"
import { toast } from "sonner"

import { useRun } from "@/components/run-dialog"
import { CriteriaFields, criteriaArg, NewSearch } from "@/components/search-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Criteria, type Profile } from "@/lib/api"
import { eur } from "@/lib/format"
import { useSearch, type Feedback } from "@/lib/store"

const CRIT_LABEL = (c: Criteria) => [
  c.budget_max && `≤ ${eur(c.budget_max)}`, c.budget_min && `≥ ${eur(c.budget_min)}`, c.rooms_min && `${c.rooms_min}+ pièces`, c.rooms_max && `≤ ${c.rooms_max} pièces`,
  c.area_min && `≥ ${c.area_min} m²`, c.floor_min != null && `étage ≥ ${c.floor_min}`, c.dpe_max && `DPE ≤ ${c.dpe_max}`, c.elevator && "ascenseur", c.outdoor && "extérieur",
].filter(Boolean) as string[]

// the Copy prompt, as the skill's "apply this feedback" mode reads it
export const promptText = (slug: string, items: Feedback[]) =>
  `/skill-immo:apartment-search apply this feedback (recherche ${slug})\n${items.map((f, i) => `${i + 1}. [${f.kind}] ${f.text}`).join("\n")}`

export function TopBar() {
  const { slug, data, state } = useSearch()
  const run = useRun()
  const s = data.search, streamOn = state.stream_estate && s.mode === "stream-estate"
  const chips = CRIT_LABEL(s.criteria)
  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2 md:flex-nowrap md:px-4">
      <Button variant="ghost" size="icon-sm" asChild aria-label="Toutes les recherches"><a href="/"><HomeIcon /></a></Button>
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-sm font-bold md:text-base">{s.label}</h1>
        <span className="truncate text-xs text-muted-foreground">{s.zone.label}</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild><Badge variant={streamOn ? "default" : "secondary"}>{s.mode === "stream-estate" ? "Stream Estate" : "Classique"}</Badge></TooltipTrigger>
        <TooltipContent>{s.mode === "stream-estate" ? (state.stream_estate ? "Annonces de tous les portails via Stream Estate (payant, avec votre accord)" : "Mode Stream Estate, mais la clé est absente : rien ne sera facturé") : "Open data et annonces trouvées par Claude : gratuit"}</TooltipContent>
      </Tooltip>
      <CriteriaPopover chips={chips} />
      <span className="flex-1" />
      <span className="flex flex-wrap items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" disabled={!streamOn} onClick={() => run({ cmd: "fetch", slug, label: "Annonces Stream Estate" })}>
                <DownloadIcon data-icon="inline-start" /><span className="max-sm:sr-only">Annonces</span>{s.stream?.total ? ` (${s.stream.total})` : ""}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{streamOn ? "Récupérer les annonces de la zone : le coût est annoncé avant" : state.stream_estate ? "Recherche en mode Classique : demandez à Claude de chercher des annonces" : "Nécessite une clé Stream Estate. Sans clé, Claude cherche les annonces pour vous"}</TooltipContent>
        </Tooltip>
        <AddListing />
        <PromptButton />
        <ProfileDialog />
        <ThemeButton />
      </span>
    </header>
  )
}

function CriteriaPopover({ chips }: { chips: string[] }) {
  const { slug, data, state } = useSearch()
  const run = useRun()
  const [c, setC] = useState(data.search.criteria), [mode, setMode] = useState(data.search.mode)
  async function apply() {
    const cleared = Object.fromEntries(Object.keys(data.search.criteria).filter(k => !(k in c) || c[k as keyof Criteria] == null).map(k => [k, undefined]))
    await run({ cmd: "search", slug, args: { criteria: criteriaArg({ ...cleared, ...c }), mode }, label: "Critères enregistrés" })
  }
  return (
    <Popover onOpenChange={o => o && (setC(data.search.criteria), setMode(data.search.mode))}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-full">
          <SlidersHorizontalIcon data-icon="inline-start" /><span className="truncate">{chips.length ? chips.join(" · ") : "Critères"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(30rem,calc(100vw-2rem))]" align="start">
        <PopoverHeader><PopoverTitle>Critères et source</PopoverTitle><PopoverDescription>La liste se filtre sur ces critères ; Stream Estate les applique aux prochaines annonces récupérées.</PopoverDescription></PopoverHeader>
        <div className="mt-3 flex flex-col gap-3">
          <CriteriaFields value={c} onChange={setC} />
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={v => v && setMode(v as typeof mode)}>
            <ToggleGroupItem value="stream-estate" disabled={!state.stream_estate}>Stream Estate</ToggleGroupItem>
            <ToggleGroupItem value="classic">Classique</ToggleGroupItem>
          </ToggleGroup>
          <Button onClick={apply}>Enregistrer</Button>
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
          <DialogDescription>{streamOn ? "Un lien : Stream Estate la retrouve (2 crédits, après votre accord). Sinon, ou pour un texte, Claude la lit." : "Collez son lien ou son texte : Claude la lira et l'ajoutera."}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="listing">Lien ou texte de l'annonce</FieldLabel>
          <Textarea id="listing" value={value} onChange={e => setValue(e.target.value)} placeholder="https://www.seloger.com/annonces/…" rows={4} />
        </Field>
        <DialogFooter><Button onClick={submit} disabled={!value.trim()}>{streamOn && isUrl ? "Chercher dans Stream Estate" : "Ajouter au prompt"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PromptButton() {
  const { slug, feedback, removeFeedback, clearFeedback } = useSearch()
  const [question, setQuestion] = useState("")
  async function copy() {
    const items = question.trim() ? [...feedback, { kind: "question" as const, text: question.trim() }] : feedback
    await navigator.clipboard.writeText(promptText(slug, items))
    toast.success("Prompt copié : collez-le dans Claude Code")
    clearFeedback()
    setQuestion("")
  }
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm"><ClipboardCopyIcon data-icon="inline-start" /><span className="max-sm:sr-only">Copier le prompt</span>{feedback.length ? ` (${feedback.length})` : ""}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))]">
        <PopoverHeader><PopoverTitle>Pour Claude</PopoverTitle><PopoverDescription>Ce que vous avez demandé dans le dashboard, à coller dans Claude Code.</PopoverDescription></PopoverHeader>
        <div className="mt-3 flex flex-col gap-2">
          {feedback.map((f, i) => (
            <div key={i} className="flex items-start justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm">
              <span className="min-w-0 break-words"><b>{f.kind}</b> {f.text}</span>
              <Button variant="ghost" size="icon-xs" aria-label="Retirer" onClick={() => removeFeedback(i)}><Trash2Icon /></Button>
            </div>
          ))}
          <Field>
            <FieldLabel htmlFor="question">Votre demande</FieldLabel>
            <Textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="Affine à 3 pièces, cherche aussi côté Guillotière…" rows={3} />
          </Field>
          <Button onClick={copy} disabled={!feedback.length && !question.trim()}><ClipboardCopyIcon data-icon="inline-start" />Copier</Button>
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
  const fields: [keyof Profile, string, string?][] = [
    ["down_payment", "Apport (€)"], ["net_income_monthly", "Revenus nets du foyer (€/mois)"], ["other_loans_monthly", "Autres crédits (€/mois)"],
    ["rate", "Taux du crédit (%)"], ["years", "Durée (ans)"], ["insurance_rate", "Assurance (% par an)"],
    ["notary_old", "Frais de notaire, ancien", "0,075 = 7,5 %"], ["notary_new", "Frais de notaire, neuf", "0,025 = 2,5 %"],
    ["monthly_credit_cap", "Plafond de crédits Stream Estate par mois"], ["eur_per_credit", "Prix d'un crédit (€)"],
  ]
  return (
    <Dialog onOpenChange={o => o && setP(profile)}>
      <DialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Mon profil"><UserRoundIcon /></Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Mon profil</DialogTitle><DialogDescription>Gardé sur cette machine (.profile.json). Les lieux clés se règlent avec Claude : « setup ».</DialogDescription></DialogHeader>
        <FieldGroup className="grid grid-cols-2 gap-3">
          {fields.map(([k, label, hint]) => (
            <Field key={k}><FieldLabel htmlFor={k}>{label}</FieldLabel><Input id={k} type="number" step="any" value={p[k] as number} onChange={set(k)} />{hint && <FieldDescription>{hint}</FieldDescription>}</Field>
          ))}
        </FieldGroup>
        {profile.places.length > 0 && <p className="text-sm text-muted-foreground">Lieux clés : {profile.places.map(x => x.label).join(", ")}</p>}
        <DialogFooter><Button onClick={async () => { setProfile(await api.saveProfile(p)); toast.success("Profil enregistré") }}>Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
