import { review } from "@engine/decide.js"
import { DOC_GROUPS, DOC_TYPES, docTypeOf } from "@engine/documents.js"
import { negotiation, typeOf } from "@engine/market.js"
import {
  BadgeCheckIcon, BadgeEuroIcon, BellRingIcon, CalculatorIcon, CalendarClockIcon, CalendarSearchIcon, CircleCheckIcon, CircleQuestionMarkIcon, Building2Icon, CalendarCheckIcon, CalendarDaysIcon, CalendarIcon, ChevronDownIcon, FileClockIcon, FileImageIcon, FileQuestionMarkIcon, FileSearchIcon, FileSpreadsheetIcon,
  FileStackIcon, FileTextIcon, HammerIcon, HandCoinsIcon, HandshakeIcon, HourglassIcon, HouseIcon, KeyRoundIcon, ListChecksIcon, MailIcon, PhoneIcon, LandmarkIcon, MapPinnedIcon, MessageCircleQuestionMarkIcon, MessageSquarePlusIcon, MoonIcon, PenLineIcon, RepeatIcon, ReplyIcon,
  ScanSearchIcon, SearchCheckIcon, ShieldAlertIcon, SproutIcon, TreePalmIcon, TrendingUpIcon, WalletIcon, ZapIcon, type LucideIcon, type LucideProps,
} from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Doc, type Listing, type PropertyType } from "@/lib/api"
import { bytes, date, eur, MESSAGE_LABEL } from "@/lib/format"
import { useSearch, type Feedback } from "@/lib/store"
import { cn } from "@/lib/utils"

// what the agent is asked to write: the prompt says what, the agent reads the conversation first
const DRAFTS = {
  contact: "une première prise de contact (dire que le bien peut m'intéresser, sans m'engager ni parler de budget ou de négociation)",
  offer: "une offre d'achat (montant et arguments à partir de la marge de négociation)", question: "les questions à poser à l'agence ou au vendeur", visit: "une demande de visite",
  reply: "une réponse au dernier message reçu, d'après toute la conversation", follow_up: "une relance du dernier message resté sans réponse",
  documents: "une demande des documents (diagnostics complets, PV des 3 dernières AG, relevé de charges, avis de taxe foncière, pré-état daté)",
} as const
type Draft = keyof typeof DRAFTS
// What the dossier's « Demander à l'IA » asks: an analysis, a summary of documents or a question on them, a message.
// Each opens a dialog to say more before it goes into the prompt.
type Ask = "analyse" | "summary" | "doc_question" | Draft

type Opt = { value: string; label: string; icon: LucideIcon }
const AXES: Opt[] = [
  { value: "prix et négociation", label: "Prix et négociation", icon: BadgeEuroIcon },
  { value: "travaux et énergie", label: "Travaux et énergie", icon: HammerIcon },
  { value: "copropriété", label: "Copropriété", icon: Building2Icon },
  { value: "quartier et trajets", label: "Quartier et trajets", icon: MapPinnedIcon },
  { value: "revente", label: "Revente", icon: TrendingUpIcon },
]
const FOCUS: Opt[] = [
  { value: "travaux votés ou à venir", label: "Travaux votés ou à venir", icon: HammerIcon },
  { value: "charges et impayés", label: "Charges et impayés", icon: WalletIcon },
  { value: "procédures en cours", label: "Procédures en cours", icon: ShieldAlertIcon },
  { value: "cohérence avec l'annonce (surface, DPE, charges)", label: "Cohérence avec l'annonce", icon: ScanSearchIcon },
]
const SLOTS: Opt[] = [
  { value: "en semaine en journée", label: "En semaine", icon: CalendarIcon },
  { value: "en soirée", label: "En soirée", icon: MoonIcon },
  { value: "le samedi", label: "Le samedi", icon: CalendarDaysIcon },
]
// A first contact, in modules: what it asks (and when to call or visit), who the buyer is, their financing, the
// questions that spare a visit for nothing, the signature. A formula ticks them (the user changes them after) and says
// how long the email is; who the buyer is, their financing and signature come from the profile (`buyer`), kept when sent.
const CONTACT: Opt[] = [
  { value: "s'il est toujours disponible", label: "Toujours disponible ?", icon: CircleQuestionMarkIcon },
  { value: "un appel", label: "Un appel", icon: PhoneIcon },
  { value: "une visite", label: "Une visite", icon: CalendarCheckIcon },
]
const FORMULAS: Opt[] = [
  { value: "juste un appel", label: "Juste un appel", icon: PhoneIcon },
  { value: "standard", label: "Standard", icon: MailIcon },
  { value: "complet", label: "Complet", icon: ListChecksIcon },
]
const WHEN: Opt[] = [{ value: "leurs disponibilités", label: "Leurs disponibilités", icon: CalendarSearchIcon }, ...SLOTS]
const PROJECT: Opt[] = [
  { value: "résidence principale", label: "Résidence principale", icon: HouseIcon },
  { value: "investissement locatif", label: "Investissement locatif", icon: KeyRoundIcon },
  { value: "résidence secondaire", label: "Résidence secondaire", icon: TreePalmIcon },
]
const SITUATION: Opt[] = [
  { value: "primo-accédant", label: "Primo-accédant", icon: SproutIcon },
  { value: "sans bien à vendre", label: "Sans bien à vendre", icon: CircleCheckIcon },
  { value: "un bien à vendre en cours", label: "Bien à vendre en cours", icon: RepeatIcon },
]
const TIMING: Opt[] = [
  { value: "prêt à me positionner vite", label: "Prêt à me positionner vite", icon: ZapIcon },
  { value: "achat sous 3 mois", label: "Sous 3 mois", icon: CalendarClockIcon },
  { value: "sans urgence", label: "Sans urgence", icon: HourglassIcon },
]
const FINANCING: Opt[] = [
  { value: "comptant", label: "Comptant", icon: WalletIcon },
  { value: "accord de principe de la banque", label: "Accord de principe", icon: BadgeCheckIcon },
  { value: "simulation d'un courtier", label: "Simulation courtier", icon: CalculatorIcon },
  { value: "crédit à l'étude", label: "Crédit à l'étude", icon: FileClockIcon },
]
const FIRST_QUESTIONS = [
  { value: "depuis quand le bien est en vente", label: "Depuis quand en vente" },
  { value: "les visites et offres déjà reçues", label: "Visites et offres déjà reçues" },
  { value: "la raison de la vente", label: "Raison de la vente" },
  { value: "s'il est libre ou loué, et à quelle date il se libère", label: "Libre ou loué, date de libération" },
  { value: "les charges et la taxe foncière", label: "Charges et taxe foncière" },
  { value: "le DPE et les travaux votés ou à prévoir", label: "DPE et travaux votés ou à prévoir" },
  { value: "les 2 questions les plus utiles de la synthèse", label: "Les 2 questions clés de la synthèse" },
]
const Q = FIRST_QUESTIONS.map(q => q.value)
const PRESETS: Record<string, { ask: string[]; when: string[]; about: boolean; questions: string[] }> = {
  "juste un appel": { ask: ["un appel"], when: ["leurs disponibilités"], about: false, questions: [] },
  standard: { ask: ["s'il est toujours disponible", "une visite"], when: [], about: true, questions: [Q[0], Q[3]] },
  complet: { ask: ["s'il est toujours disponible", "un appel", "une visite"], when: [], about: true, questions: [Q[0], Q[1], Q[3], Q[4], Q[5]] },
}
const FUNDING: Opt[] = [
  { value: "crédit immobilier", label: "Crédit immobilier", icon: LandmarkIcon },
  { value: "comptant", label: "Comptant", icon: WalletIcon },
]

// The types of documents (engine lib/documents.js): a document's own, else the one its name says (one added before
// the types); those a property type has, by group, and the one a document already has
type DocType = (typeof DOC_TYPES)[number]
export const typeOfDoc = (d: Doc) => d.type ?? docTypeOf(d.name)
export const DOC_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES.map(d => [d.key, d.label]))
export const docTypesFor = (t: PropertyType, current?: string) =>
  DOC_GROUPS.map(([g, label]) => ({ label, items: DOC_TYPES.filter((x: DocType) => x.group === g && ((x.types as string[]).includes(t) || x.key === current)) })).filter(g => g.items.length)

const ASKS: Record<Ask, { title: string; description: string; icon: LucideIcon; text: string; placeholder: string }> = {
  analyse: { title: "Analyser ce bien", description: "L'IA l'analyse avec les ventes, le bâtiment, le quartier et votre budget. Dites-lui ce qui compte pour vous.", icon: SearchCheckIcon, text: "Instruction en plus", placeholder: "Ex. : je compte le louer meublé, est-ce rentable ?" },
  summary: { title: "Résumer des documents", description: "L'IA lit les documents choisis et les résume, en citant le document et la page. Vous pourrez garder le résumé dans « Mes notes ».", icon: FileSearchIcon, text: "Instruction en plus", placeholder: "Ex. : concentre-toi sur les travaux du toit et ce qu'ils coûteront au lot" },
  doc_question: { title: "Question sur les documents", description: "L'IA cherche la réponse dans les documents choisis, et dit où elle l'a trouvée.", icon: FileQuestionMarkIcon, text: "Votre question", placeholder: "Ex. : le ravalement est-il déjà voté, et pour combien ?" },
  contact: { title: "Rédiger une prise de contact", description: "Un e-mail qui dit votre intérêt pour le bien, sans parler de votre budget ni négocier. Choisissez une formule, puis ajoutez ou retirez ce que vous voulez.", icon: HandshakeIcon, text: "Instruction en plus", placeholder: "Ex. : je connais bien le quartier, j'y habite déjà" },
  offer: { title: "Rédiger une offre d'achat", description: "L'IA l'écrit d'après la marge de négociation et la conversation.", icon: HandCoinsIcon, text: "Instruction en plus", placeholder: "Ex. : insiste sur les travaux de la toiture" },
  question: { title: "Rédiger les questions à l'agence", description: "Les questions de la synthèse et celles à demander de vos notes que l'IA posera, et les vôtres. Elle laisse de côté celles déjà répondues dans la conversation.", icon: MessageCircleQuestionMarkIcon, text: "Vos questions en plus", placeholder: "Une question par ligne" },
  visit: { title: "Rédiger une demande de visite", description: "L'IA propose vos disponibilités.", icon: CalendarCheckIcon, text: "Précisions", placeholder: "Ex. : jeudi 14 après 18 h, ou samedi matin" },
  documents: { title: "Rédiger une demande de documents", description: "Cochez les documents à demander. Ceux déjà reçus dans la conversation sont décochés.", icon: FileStackIcon, text: "Instruction en plus", placeholder: "Ex. : demande-les avant la visite" },
  reply: { title: "Répondre au dernier message", description: "L'IA répond au dernier message reçu, d'après toute la conversation.", icon: ReplyIcon, text: "Ce que vous voulez répondre", placeholder: "Ex. : accepter la visite mais refuser la contre-offre" },
  follow_up: { title: "Rédiger une relance", description: "L'IA relance le dernier message resté sans réponse.", icon: BellRingIcon, text: "Instruction en plus", placeholder: "Ex. : rappeler que mon financement est prêt" },
}

// the documents of a listing's conversation, newest first
export const docsOf = (l: Listing) => (l.messages ?? []).toSorted((a, b) => b.date.localeCompare(a.date)).flatMap(m => (m.documents ?? []).map(d => ({ ...d, date: m.date })))
export function DocIcon({ name, ...props }: { name: string } & LucideProps) {
  const ext = name.split(".").at(-1)?.toLowerCase() ?? ""
  const I = ["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext) ? FileImageIcon : ["xls", "xlsx", "ods", "csv"].includes(ext) ? FileSpreadsheetIcon : FileTextIcon
  return <I {...props} />
}

const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" })
// one line of the prompt: a text on one line, its details after « ; »
const one = (s: string) => s.trim().replace(/\s*\n\s*/g, " / ")
const details = (xs: [string, string | false | null | undefined][]) => xs.filter(([, v]) => v).map(([k, v]) => ` ; ${k} : ${v}`).join("")

// « Demander à l'IA » (the dossier's header: analyse, documents, write) or « Rédiger avec l'IA » (the conversation)
export function AskMenu({ l, short, analyse = false, size = "sm" }: { l: Listing; short: string; analyse?: boolean; size?: "sm" | "xs" }) {
  const [ask, setAsk] = useState<Ask | null>(null)
  const ms = l.messages ?? [], none = !docsOf(l).length
  const item = (k: Ask, disabled = false, hint?: string) => {
    const I = ASKS[k].icon
    return <DropdownMenuItem key={k} disabled={disabled} onSelect={() => setAsk(k)}><I />{{ analyse: "Analyser ce bien", summary: "Résumer des documents", doc_question: "Question sur les documents", contact: "Une prise de contact", offer: "Une offre d'achat", question: "Les questions à l'agence", visit: "Une demande de visite", documents: "Une demande de documents", reply: "Répondre au dernier message", follow_up: "Une relance" }[k]}…{hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}</DropdownMenuItem>
  }
  return (
    <>
      {/* not modal: the dialog it opens gets the focus */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size}>
            {analyse ? <MessageSquarePlusIcon data-icon="inline-start" /> : <PenLineIcon data-icon="inline-start" />}{analyse ? "Demander à l'IA" : "Rédiger avec l'IA"}<ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {analyse && (
            <>
              {item("analyse")}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Documents de la conversation</DropdownMenuLabel>
              {item("summary", none, none ? "aucun" : undefined)}
              {item("doc_question", none, none ? "aucun" : undefined)}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Rédiger</DropdownMenuLabel>
            </>
          )}
          {(["contact", "offer", "question", "visit", "documents"] as const).map(k => item(k))}
          <DropdownMenuSeparator />
          {item("reply", !ms.some(m => m.from === "them"))}
          {item("follow_up", !ms.some(m => m.from !== "them" && m.sent_at))}
        </DropdownMenuContent>
      </DropdownMenu>
      {ask && <AskDialog key={ask} ask={ask} l={l} short={short} onClose={() => setAsk(null)} />}
    </>
  )
}

function Chips({ opts, value, onChange, label, single }: { opts: Opt[]; value: string[]; onChange: (v: string[]) => void; label: string; single?: boolean }) {
  const items = opts.map(o => <ToggleGroupItem key={o.value} value={o.value}><o.icon />{o.label}</ToggleGroupItem>)
  return single
    ? <ToggleGroup type="single" variant="outline" size="sm" value={value[0] ?? ""} onValueChange={v => onChange(v ? [v] : [])} className="flex-wrap justify-start" aria-label={label}>{items}</ToggleGroup>
    : <ToggleGroup type="multiple" variant="outline" size="sm" value={value} onValueChange={onChange} className="flex-wrap justify-start" aria-label={label}>{items}</ToggleGroup>
}
// a module of the first contact the user takes in or leaves out, its choices kept either way
function Module({ title, on, onChange, children }: { title: string; on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-2"><FieldLabel>{title}</FieldLabel><Switch checked={on} onCheckedChange={onChange} aria-label={`${title} : ${on ? "dans le message" : "laissé de côté"}`} /></div>
      {on && children}
    </Field>
  )
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => <div className="flex flex-col gap-1.5"><span className="text-xs text-muted-foreground">{label}</span>{children}</div>

function Checks<T>({ items, value, onChange, id, label, columns }: { items: T[]; value: string[]; onChange: (v: string[]) => void; id: (x: T) => string; label: (x: T) => ReactNode; columns?: boolean }) {
  return (
    <ul className={columns ? "grid gap-2 sm:grid-cols-2" : "flex flex-col gap-2"}>
      {items.map(x => (
        <li key={id(x)}>
          <Label className="items-start font-normal leading-snug"><Checkbox className="mt-0.5" checked={value.includes(id(x))} onCheckedChange={on => onChange(on ? [...value, id(x)] : value.filter(v => v !== id(x)))} />{label(x)}</Label>
        </li>
      ))}
    </ul>
  )
}

// the boxes of « Mes notes » not ticked yet (an « À demander »): still to ask, their Markdown marks left out
const openAsks = (notes: string) => [...notes.matchAll(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[ \][ \t]+(.+)$/gm)].map(m => m[1].replace(/\*\*|`/g, "").trim())

export function AskDialog({ ask, l, short, onClose }: { ask: Ask; l: Listing; short: string; onClose: () => void }) {
  const { addFeedback, marketFor, aidsFor, profile, setProfile } = useSearch()
  const a = ASKS[ask], t = typeOf(l) as PropertyType, docs = docsOf(l), b = profile.buyer ?? {}
  const kept = (v?: string) => (v ? [v] : [])
  const questions: string[] = ask === "question" ? review(l, aidsFor(l)).questions : []
  const noted = ask === "question" ? openAsks(l.notes ?? "").filter(q => !questions.includes(q)) : []
  const nego = ask === "offer" && l.price ? negotiation(l, marketFor(l).ref?.ppm2) : null
  // what can be asked for this type of property, and when each type came (the newest; a DDT holds every diagnostic)
  const toAsk = docTypesFor(t).map(g => ({ ...g, items: g.items.filter((x: DocType) => x.request !== false) })).filter(g => g.items.length)
  const got = new Map<string, string>()
  for (const d of docs) if (!got.has(typeOfDoc(d))) got.set(typeOfDoc(d), d.date)
  const received = (x: DocType) => got.get(x.key) ?? (x.group === "diagnostics" ? got.get("ddt") : undefined)
  const [chips, setChips] = useState<string[]>(() => ask === "contact" ? PRESETS.standard.ask : []), [funding, setFunding] = useState<string[]>(() => ask === "contact" ? kept(b.financing) : [])
  // a first contact's modules (the standard formula's at first), the buyer from the profile
  const [formula, setFormula] = useState(["standard"]), [when, setWhen] = useState(PRESETS.standard.when), [firstQs, setFirstQs] = useState(PRESETS.standard.questions)
  const [about, setAbout] = useState(true), [money, setMoney] = useState(true), [remember, setRemember] = useState(true)
  const [project, setProject] = useState(kept(b.project)), [situation, setSituation] = useState(kept(b.situation)), [timing, setTiming] = useState(kept(b.timing))
  const [name, setName] = useState(b.name ?? ""), [phone, setPhone] = useState(b.phone ?? ""), [email, setEmail] = useState(b.email ?? "")
  const pick = (v: string) => { const p = PRESETS[v]; setFormula([v]); setChips(p.ask); setWhen(p.when); setAbout(p.about); setMoney(p.about); setFirstQs(p.questions) }
  const meeting = chips.includes("un appel") || chips.includes("une visite")
  const [picked, setPicked] = useState(() => docs.map(d => d.id)), [qs, setQs] = useState(() => [...questions, ...noted])
  const [asked, setAsked] = useState(() => toAsk.flatMap(g => g.items.filter((x: DocType) => x.on && !received(x)).map((x: DocType) => x.key)))
  const [amount, setAmount] = useState(""), [days, setDays] = useState("10"), [text, setText] = useState("")
  const isDocs = ask === "summary" || ask === "doc_question"
  const ready = isDocs ? picked.length > 0 && (ask === "summary" || !!text.trim()) : ask === "documents" ? asked.length > 0 : ask === "question" ? qs.length > 0 || !!text.trim() : true

  function submit() {
    const said = one(text), names = docs.filter(d => picked.includes(d.id)).map(d => `« ${d.name} » (${typeOfDoc(d) !== "other" ? `${DOC_LABEL[typeOfDoc(d)]}, ` : ""}${d.id})`).join(", ")
    let f: Feedback
    if (ask === "analyse") f = { kind: "analyser", text: `${l.id} — ${short}${details([["axes", chips.join(", ")], ["consigne", said]])}` }
    else if (ask === "summary") f = { kind: "documents", text: `résumé pour ${l.id} — ${short} : ${names}${details([["points", chips.join(", ")], ["consigne", said]])}` }
    else if (ask === "doc_question") f = { kind: "documents", text: `question pour ${l.id} — ${short} : ${names}${details([["question", said]])}` }
    else {
      const what = ask === "documents" ? `une demande des documents suivants : ${toAsk.flatMap(g => g.items).filter((x: DocType) => asked.includes(x.key)).map((x: DocType) => x.request || x.label).join(", ")}` : ask === "question" && qs.length ? `${DRAFTS.question} : ${qs.map((q, i) => `${i + 1}) ${q}`).join(" ")}` : DRAFTS[ask]
      // every message signed with what the buyer gave (the first contact's fields, else the profile)
      const contact = ask === "contact", sign = (contact ? [name, phone, email] : [b.name, b.phone, b.email]).map(x => x?.trim()).filter(Boolean).join(", ")
      f = {
        kind: "message", text: `${MESSAGE_LABEL[ask].toLowerCase()} pour ${l.id} — ${short} : rédige ${what}${details([
          ["formule", contact && formula[0]], ["demander", contact && chips.join(", ")], ["créneaux", contact && meeting && when.join(", ")],
          ["me présenter", contact && about && [...project, ...situation, ...timing].join(", ")],
          ["montant", !!amount && eur(Number(amount))], ["validité", ask === "offer" && !!days && `${days} jours`], ["financement", (!contact || money) && funding[0]],
          ["questions", contact && FIRST_QUESTIONS.filter(q => firstQs.includes(q.value)).map((q, i) => `${i + 1}) ${q.value}`).join(" ")],
          ["disponibilités", ask === "visit" && chips.join(", ")], [ask === "question" ? "questions en plus" : ask === "visit" ? "précisions" : "consigne", said], ["signer", sign],
        ])}`,
      }
      if (contact && remember) {
        const buyer = { project: project[0] ?? "", situation: situation[0] ?? "", timing: timing[0] ?? "", financing: funding[0] ?? "", name, phone, email }
        api.saveProfile({ buyer }).then(setProfile, e => toast.error("Profil d'acheteur non enregistré", { description: `Détail technique : ${(e as Error).message}` }))
      }
    }
    addFeedback(f)
    toast.success(`Ajouté au prompt : copiez-le pour l'IA, ${ask === "analyse" ? "elle analysera ce bien" : isDocs ? "elle lira les documents" : "elle rédigera le message et l'enregistrera ici"}`)
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><a.icon className="size-4 text-muted-foreground" />{a.title}</DialogTitle>
          <DialogDescription>{a.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {ask === "analyse" && <Field><FieldLabel>Axes à creuser</FieldLabel><Chips opts={AXES} value={chips} onChange={setChips} label="Axes à creuser" /></Field>}
          {isDocs && (
            <Field>
              <FieldLabel>Documents</FieldLabel>
              <Checks items={docs} value={picked} onChange={setPicked} id={d => d.id}
                label={(d: Doc & { date: string }) => <span className="flex min-w-0 items-center gap-1.5"><DocIcon name={d.name} className="size-4 shrink-0 text-muted-foreground" />{typeOfDoc(d) !== "other" && <span className="shrink-0">{DOC_LABEL[typeOfDoc(d)]}</span>}<span className={cn("truncate", typeOfDoc(d) !== "other" && "text-muted-foreground")}>{d.name}</span><span className="shrink-0 text-xs text-muted-foreground">{date(d.date)} · {bytes(d.size)}</span></span>} />
            </Field>
          )}
          {ask === "summary" && <Field><FieldLabel>Points à faire ressortir</FieldLabel><Chips opts={FOCUS} value={chips} onChange={setChips} label="Points à faire ressortir" /></Field>}
          {ask === "offer" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field><FieldLabel htmlFor="ask-amount">Montant (€)</FieldLabel><Input id="ask-amount" type="number" inputMode="numeric" step={1000} placeholder="l'IA le propose" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
                <Field><FieldLabel htmlFor="ask-days">Validité (jours)</FieldLabel><Input id="ask-days" type="number" inputMode="numeric" min={1} value={days} onChange={e => setDays(e.target.value)} /></Field>
              </div>
              {nego && <FieldDescription>Marge estimée : une offre entre {eur(Math.round(l.price! * (1 - nego.high) / 1000) * 1000)} et {eur(Math.round(l.price! * (1 - nego.low) / 1000) * 1000)}.</FieldDescription>}
              <Field><FieldLabel>Financement</FieldLabel><Chips single opts={FUNDING} value={funding} onChange={setFunding} label="Financement" /></Field>
            </>
          )}
          {ask === "contact" && (
            <>
              <Field>
                <FieldLabel>Formule</FieldLabel>
                <Chips single opts={FORMULAS} value={formula} onChange={v => v[0] && pick(v[0])} label="Formule" />
                <FieldDescription>{{ "juste un appel": "2 à 4 lignes : le bien, et quand s'appeler.", standard: "5 à 8 lignes : vous, votre financement, 2 questions, une visite.", complet: "8 à 14 lignes : tout ce qui vous présente et les questions avant la visite." }[formula[0]]}</FieldDescription>
              </Field>
              <Field><FieldLabel>Demander</FieldLabel><Chips opts={CONTACT} value={chips} onChange={setChips} label="Demander" /></Field>
              {meeting && <Field><FieldLabel>Créneaux</FieldLabel><Chips opts={WHEN} value={when} onChange={setWhen} label="Créneaux" /></Field>}
              <Module title="Me présenter" on={about} onChange={setAbout}>
                <Row label="Projet"><Chips single opts={PROJECT} value={project} onChange={setProject} label="Projet" /></Row>
                <Row label="Situation"><Chips single opts={SITUATION} value={situation} onChange={setSituation} label="Situation" /></Row>
                <Row label="Calendrier"><Chips single opts={TIMING} value={timing} onChange={setTiming} label="Calendrier" /></Row>
              </Module>
              <Module title="Mon financement" on={money} onChange={setMoney}>
                <Chips single opts={FINANCING} value={funding} onChange={setFunding} label="Financement" />
                <FieldDescription>Jamais de montant : ni budget, ni apport, ni revenus.</FieldDescription>
              </Module>
              <Field>
                <FieldLabel>Questions</FieldLabel>
                <Checks columns items={FIRST_QUESTIONS} value={firstQs} onChange={setFirstQs} id={q => q.value} label={q => q.label} />
              </Field>
              <Field>
                <FieldLabel>Signer avec</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input aria-label="Nom" placeholder="Nom" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
                  <Input aria-label="Téléphone" placeholder="Téléphone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} />
                  <Input aria-label="E-mail" placeholder="E-mail" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <Label className="font-normal"><Checkbox checked={remember} onCheckedChange={v => setRemember(v === true)} />Retenir ma présentation, mon financement et ma signature</Label>
              </Field>
            </>
          )}
          {ask === "reply" && <Field><FieldLabel htmlFor="ask-amount">Montant à proposer (€)</FieldLabel><Input id="ask-amount" type="number" inputMode="numeric" step={1000} placeholder="facultatif" value={amount} onChange={e => setAmount(e.target.value)} /></Field>}
          {ask === "question" && (
            <Field>
              <FieldLabel>Questions de la synthèse</FieldLabel>
              {questions.length ? <Checks items={questions} value={qs} onChange={setQs} id={q => q} label={q => q} /> : <FieldDescription>La synthèse n'en propose aucune{noted.length ? "" : " : écrivez les vôtres"}.</FieldDescription>}
            </Field>
          )}
          {noted.length > 0 && (
            <Field>
              <FieldLabel>À demander, de vos notes</FieldLabel>
              <Checks items={noted} value={qs} onChange={setQs} id={q => q} label={q => q} />
            </Field>
          )}
          {ask === "visit" && <Field><FieldLabel>Disponibilités</FieldLabel><Chips opts={SLOTS} value={chips} onChange={setChips} label="Disponibilités" /></Field>}
          {ask === "documents" && toAsk.map(g => (
            <Field key={g.label}>
              <FieldLabel>{g.label}</FieldLabel>
              <Checks columns items={g.items} value={asked} onChange={setAsked} id={(x: DocType) => x.key}
                label={(x: DocType) => <span>{x.request || x.label}{received(x) && <span className="ml-1.5 text-xs text-muted-foreground">reçu le {dayMonth.format(new Date(received(x)!))}</span>}</span>} />
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor="ask-text">{a.text}{ask === "doc_question" ? "" : " (facultatif)"}</FieldLabel>
            <Textarea id="ask-text" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={a.placeholder} />
          </Field>
        </FieldGroup>
        <DialogFooter><Button onClick={submit} disabled={!ready}>Ajouter au prompt</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
