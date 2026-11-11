import { review } from "@engine/decide.js"
import { DOC_GROUPS, DOC_TYPES, docTypeOf } from "@engine/documents.js"
import { negotiation, typeOf } from "@engine/market.js"
import {
  BadgeEuroIcon, BellRingIcon, Building2Icon, CalendarCheckIcon, CalendarDaysIcon, CalendarIcon, ChevronDownIcon, FileImageIcon, FileQuestionMarkIcon, FileSearchIcon, FileSpreadsheetIcon,
  FileStackIcon, FileTextIcon, HammerIcon, HandCoinsIcon, LandmarkIcon, MapPinnedIcon, MessageCircleQuestionMarkIcon, MessageSquarePlusIcon, MoonIcon, PenLineIcon, ReplyIcon,
  ScanSearchIcon, SearchCheckIcon, ShieldAlertIcon, TrendingUpIcon, WalletIcon, type LucideIcon, type LucideProps,
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
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Doc, Listing, PropertyType } from "@/lib/api"
import { bytes, date, eur, MESSAGE_LABEL } from "@/lib/format"
import { useSearch, type Feedback } from "@/lib/store"
import { cn } from "@/lib/utils"

// what the agent is asked to write: the prompt says what, the agent reads the conversation first
const DRAFTS = {
  offer: "une offre d'achat (montant et arguments à partir de la marge de négociation)", question: "les questions à poser à l'agence ou au vendeur", visit: "une demande de visite",
  reply: "une réponse au dernier message reçu, d'après toute la conversation", follow_up: "une relance du dernier message resté sans réponse",
  documents: "une demande des documents (diagnostics complets, PV des 3 dernières AG, relevé de charges, avis de taxe foncière, pré-état daté)",
} as const
type Draft = keyof typeof DRAFTS
// What the dossier's « Demander à l'agent » asks: an analysis, a summary of documents or a question on them, a message.
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
  analyse: { title: "Analyser ce bien", description: "L'agent l'analyse avec les ventes, le bâtiment, le quartier et votre budget. Dites-lui ce qui compte pour vous.", icon: SearchCheckIcon, text: "Instruction en plus", placeholder: "Ex. : je compte le louer meublé, est-ce rentable ?" },
  summary: { title: "Résumer des documents", description: "L'agent lit les documents choisis et les résume, en citant le document et la page. Vous pourrez garder le résumé dans « Mes notes ».", icon: FileSearchIcon, text: "Instruction en plus", placeholder: "Ex. : concentre-toi sur les travaux du toit et ce qu'ils coûteront au lot" },
  doc_question: { title: "Question sur les documents", description: "L'agent cherche la réponse dans les documents choisis, et dit où il l'a trouvée.", icon: FileQuestionMarkIcon, text: "Votre question", placeholder: "Ex. : le ravalement est-il déjà voté, et pour combien ?" },
  offer: { title: "Rédiger une offre d'achat", description: "L'agent l'écrit d'après la marge de négociation et la conversation.", icon: HandCoinsIcon, text: "Instruction en plus", placeholder: "Ex. : insiste sur les travaux de la toiture" },
  question: { title: "Rédiger les questions à l'agence", description: "Les questions de la synthèse que l'agent posera, et les vôtres. Il laisse de côté celles déjà répondues dans la conversation.", icon: MessageCircleQuestionMarkIcon, text: "Vos questions en plus", placeholder: "Une question par ligne" },
  visit: { title: "Rédiger une demande de visite", description: "L'agent propose vos disponibilités.", icon: CalendarCheckIcon, text: "Précisions", placeholder: "Ex. : jeudi 14 après 18 h, ou samedi matin" },
  documents: { title: "Rédiger une demande de documents", description: "Cochez les documents à demander. Ceux déjà reçus dans la conversation sont décochés.", icon: FileStackIcon, text: "Instruction en plus", placeholder: "Ex. : demande-les avant la visite" },
  reply: { title: "Répondre au dernier message", description: "L'agent répond au dernier message reçu, d'après toute la conversation.", icon: ReplyIcon, text: "Ce que vous voulez répondre", placeholder: "Ex. : accepter la visite mais refuser la contre-offre" },
  follow_up: { title: "Rédiger une relance", description: "L'agent relance le dernier message resté sans réponse.", icon: BellRingIcon, text: "Instruction en plus", placeholder: "Ex. : rappeler que mon financement est prêt" },
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

// « Demander à l'agent » (the dossier's header: analyse, documents, write) or « Rédiger avec l'agent » (the conversation)
export function AskMenu({ l, short, analyse = false, size = "sm" }: { l: Listing; short: string; analyse?: boolean; size?: "sm" | "xs" }) {
  const [ask, setAsk] = useState<Ask | null>(null)
  const ms = l.messages ?? [], none = !docsOf(l).length
  const item = (k: Ask, disabled = false, hint?: string) => {
    const I = ASKS[k].icon
    return <DropdownMenuItem key={k} disabled={disabled} onSelect={() => setAsk(k)}><I />{{ analyse: "Analyser ce bien", summary: "Résumer des documents", doc_question: "Question sur les documents", offer: "Une offre d'achat", question: "Les questions à l'agence", visit: "Une demande de visite", documents: "Une demande de documents", reply: "Répondre au dernier message", follow_up: "Une relance" }[k]}…{hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}</DropdownMenuItem>
  }
  return (
    <>
      {/* not modal: the dialog it opens gets the focus */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size}>
            {analyse ? <MessageSquarePlusIcon data-icon="inline-start" /> : <PenLineIcon data-icon="inline-start" />}{analyse ? "Demander à l'agent" : "Rédiger avec l'agent"}<ChevronDownIcon data-icon="inline-end" />
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
          {(["offer", "question", "visit", "documents"] as const).map(k => item(k))}
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

function AskDialog({ ask, l, short, onClose }: { ask: Ask; l: Listing; short: string; onClose: () => void }) {
  const { addFeedback, marketFor, aidsFor } = useSearch()
  const a = ASKS[ask], t = typeOf(l) as PropertyType, docs = docsOf(l)
  const questions: string[] = ask === "question" ? review(l, aidsFor(l)).questions : []
  const nego = ask === "offer" && l.price ? negotiation(l, marketFor(l).ref?.ppm2) : null
  // what can be asked for this type of property, and when each type came (the newest; a DDT holds every diagnostic)
  const toAsk = docTypesFor(t).map(g => ({ ...g, items: g.items.filter((x: DocType) => x.request !== false) })).filter(g => g.items.length)
  const got = new Map<string, string>()
  for (const d of docs) if (!got.has(typeOfDoc(d))) got.set(typeOfDoc(d), d.date)
  const received = (x: DocType) => got.get(x.key) ?? (x.group === "diagnostics" ? got.get("ddt") : undefined)
  const [chips, setChips] = useState<string[]>([]), [funding, setFunding] = useState<string[]>([])
  const [picked, setPicked] = useState(() => docs.map(d => d.id)), [qs, setQs] = useState(questions)
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
      f = {
        kind: "message", text: `${MESSAGE_LABEL[ask].toLowerCase()} pour ${l.id} — ${short} : rédige ${what}${details([
          ["montant", !!amount && eur(Number(amount))], ["validité", ask === "offer" && !!days && `${days} jours`], ["financement", funding[0]],
          ["disponibilités", ask === "visit" && chips.join(", ")], [ask === "question" ? "questions en plus" : ask === "visit" ? "précisions" : "consigne", said],
        ])}`,
      }
    }
    addFeedback(f)
    toast.success(`Ajouté au prompt : copiez-le pour l'agent, ${ask === "analyse" ? "il analysera ce bien" : isDocs ? "il lira les documents" : "il rédigera le message et l'enregistrera ici"}`)
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
                <Field><FieldLabel htmlFor="ask-amount">Montant (€)</FieldLabel><Input id="ask-amount" type="number" inputMode="numeric" step={1000} placeholder="l'agent le propose" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
                <Field><FieldLabel htmlFor="ask-days">Validité (jours)</FieldLabel><Input id="ask-days" type="number" inputMode="numeric" min={1} value={days} onChange={e => setDays(e.target.value)} /></Field>
              </div>
              {nego && <FieldDescription>Marge estimée : une offre entre {eur(Math.round(l.price! * (1 - nego.high) / 1000) * 1000)} et {eur(Math.round(l.price! * (1 - nego.low) / 1000) * 1000)}.</FieldDescription>}
              <Field><FieldLabel>Financement</FieldLabel><Chips single opts={FUNDING} value={funding} onChange={setFunding} label="Financement" /></Field>
            </>
          )}
          {ask === "reply" && <Field><FieldLabel htmlFor="ask-amount">Montant à proposer (€)</FieldLabel><Input id="ask-amount" type="number" inputMode="numeric" step={1000} placeholder="facultatif" value={amount} onChange={e => setAmount(e.target.value)} /></Field>}
          {ask === "question" && (
            <Field>
              <FieldLabel>Questions de la synthèse</FieldLabel>
              {questions.length ? <Checks items={questions} value={qs} onChange={setQs} id={q => q} label={q => q} /> : <FieldDescription>La synthèse n'en propose aucune : écrivez les vôtres.</FieldDescription>}
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
