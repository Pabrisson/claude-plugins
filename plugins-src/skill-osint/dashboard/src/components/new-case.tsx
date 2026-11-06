import { basisParts, checkInputs, defaults, LEGAL_BASES, shown } from "@engine/inputs.js"
import { formatPrompt } from "@engine/prompt.js"
import { ArrowLeftIcon, CircleCheckIcon, CopyIcon, FolderOpenIcon, PlusIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Chips } from "@/components/chips"
import { InputField, type Value } from "@/components/field"
import { Icon } from "@/components/icon"
import { copyText } from "@/components/obsidian-button"
import { PrivateBadge } from "@/components/private-badge"
import { TopBar } from "@/components/top-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, type Doctor, type Manifest } from "@/lib/api"
import { tint, typeColor } from "@/lib/colors"
import { caseHref, go } from "@/lib/route"
import { TONE } from "@/lib/tones"
import { cn } from "@/lib/utils"

const LANG_KEY = "osint-lang"
const defaultLang = () => { try { const l = localStorage.getItem(LANG_KEY); if (l) return l } catch { /* none kept */ } return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en" }

// New case: the type, then its form drawn from the manifest (a field whose `when` is false is hidden and not sent),
// the case's title and language, the frame; « Create case » makes the case here, then the prompt that starts it.
export function NewCase({ type }: { type: string | null }) {
  const [types, setTypes] = useState<Manifest[] | null>(null)
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  useEffect(() => { api.types().then(setTypes, () => setTypes([])); api.doctor().then(setDoctor, () => {}) }, [])
  const m = types?.find(t => t.id === type)
  return (
    <>
      <TopBar />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild><a href={type ? "#/new" : "#/"} aria-label={type ? "Choose another type" : "All cases"}><ArrowLeftIcon /></a></Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">New case{m ? `: ${m.label}` : ""}</h1>
            <p className="text-sm text-muted-foreground">{m ? m.description : "What does the case start from?"}</p>
          </div>
        </div>
        {!types ? <Skeleton className="h-40 rounded-xl" /> : m ? <CaseForm key={m.id} m={m} color={typeColor(m.id, types)} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {types.map(t => {
              const d = doctor?.types.find(x => x.id === t.id && !x.refused), ready = d?.ready !== false
              return (
                <button key={t.id} type="button" disabled={!ready} onClick={() => go(`#/new/${t.id}`)}
                  className="flex items-start gap-3 rounded-xl p-4 text-left ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg" style={{ background: tint(typeColor(t.id, types)), color: typeColor(t.id, types) }}><Icon name={t.icon} className="size-5" aria-hidden /></span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 font-medium">{t.label}{t.private && <PrivateBadge id={t.id} />}</span>
                    <span className="text-sm text-muted-foreground">{t.description}</span>
                    {d && !d.ready && <Badge className={cn("mt-1", TONE.amber)}>Needs {d.missing.join(", ")}</Badge>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}

function CaseForm({ m, color }: { m: Manifest; color: string }) {
  const frameOf = (id: string) => m.frame.map(f => (typeof f === "string" ? { id: f } : f)).find(f => f.id === id)
  const fPerson = frameOf("person"), fImage = frameOf("image"), fNoisy = frameOf("noisy")
  const proposed = basisParts(fPerson?.legal_basis)
  const [values, setValues] = useState<Record<string, Value>>(() => defaults(m))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [title, setTitle] = useState(""), [lang, setLang] = useState(defaultLang)
  const [question, setQuestion] = useState(""), [purpose, setPurpose] = useState(""), [scope, setScope] = useState("")
  const [person, setPerson] = useState(!!fPerson?.always)
  const [basis, setBasis] = useState(proposed.base ?? ""), [precision, setPrecision] = useState(proposed.detail)
  const [image, setImage] = useState<string | null>(null), [noisy, setNoisy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState<Record<string, boolean>>({}), [error, setError] = useState<string | null>(null), [slug, setSlug] = useState<string | null>(null)

  const visible = m.inputs.filter(i => shown(i, values))
  // only the fields shown, and only those given: what the engine receives
  const inputs = useMemo(() => Object.fromEntries(visible.filter(i => values[i.id] != null && values[i.id] !== "").map(i => [i.id, values[i.id]])), [visible, values])
  const check = checkInputs(m, inputs)
  const fieldError = (id: string) => (check.error && touched[id] && new RegExp(`(?:input |--in )${id}\\b`).test(check.error) ? (/^--in \S+?: at least one/.test(check.error) ? "Choose at least one" : check.error.replace(/^--in \S+?: /, "")) : null)
  const missing = [
    ...visible.filter(i => i.required && inputs[i.id] == null).map(i => i.label),
    !question.trim() && "the question", !purpose.trim() && "the purpose",
    person && !basis && "the legal basis", fImage && !image && "whether the image may leave", fNoisy && !noisy && "the noisy actions",
  ].filter(Boolean) as string[]
  const ready = !missing.length && !check.error && !busy && !Object.values(uploading).some(Boolean)

  async function create() {
    setBusy(true); setError(null)
    const frame: Record<string, string | boolean> = { purpose: purpose.trim(), scope: scope.trim() }
    if (fPerson) { frame.person = person; if (person) frame.legal_basis = `${basis}${precision.trim() ? ` — ${precision.trim()}` : ""}` }
    if (fImage && image) frame.image_may_leave = image === "yes"
    if (fNoisy && noisy) frame.noisy = noisy
    try {
      const r = await api.create({ type: m.id, inputs, frame, question: question.trim(), title: title.trim() || undefined, lang })
      try { localStorage.setItem(LANG_KEY, lang) } catch { /* the browser's language next time */ }
      setSlug(r.slug)
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  if (slug) {
    const prompt = formatPrompt({ start: slug })
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CircleCheckIcon className="size-5 text-emerald-600 dark:text-emerald-400" />Case created</CardTitle>
          <CardDescription>The case folder is ready. Paste this prompt to the agent to start the investigation.</CardDescription>
        </CardHeader>
        <CardContent><pre className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{prompt}</pre></CardContent>
        <CardFooter className="gap-2">
          <Button onClick={() => copyText(prompt, "Prompt copied: paste it to the agent")}><CopyIcon data-icon="inline-start" />Copy prompt</Button>
          <Button variant="outline" asChild><a href={caseHref(slug)}><FolderOpenIcon data-icon="inline-start" />Open case</a></Button>
        </CardFooter>
      </Card>
    )
  }
  const set = (id: string) => (v: Value) => { setValues(x => ({ ...x, [id]: v })); setTouched(t => ({ ...t, [id]: true })) }
  return (
    <form className="flex flex-col gap-8" onSubmit={e => { e.preventDefault(); if (ready) create() }}>
      <FieldSet>
        <FieldLegend className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md" style={{ background: tint(color), color }}><Icon name={m.icon} className="size-3.5" aria-hidden /></span>{m.label}
        </FieldLegend>
        <FieldGroup>
          {visible.map(i => <InputField key={i.id} input={i} value={values[i.id]} onChange={set(i.id)} error={fieldError(i.id)} onBusy={b => setUploading(u => ({ ...u, [i.id]: b }))} />)}
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Frame</FieldLegend>
        <FieldDescription>What the case must answer, and within which limits. The agent keeps to it.</FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="question">Question</FieldLabel>
            <Textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} rows={2} placeholder="Who runs this website?" />
          </Field>
          <Field>
            <FieldLabel htmlFor="purpose">Purpose{fPerson?.purpose && <span aria-hidden> *</span>}</FieldLabel>
            <Input id="purpose" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Check a seller before a large order" aria-required={fPerson?.purpose || undefined} aria-describedby={fPerson?.purpose ? "purpose-help" : undefined} />
            {fPerson?.purpose && <FieldDescription id="purpose-help">Each identifier is weighed against it.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="scope">Scope (optional)</FieldLabel>
            <Input id="scope" value={scope} onChange={e => setScope(e.target.value)} placeholder="Public sources only, the last five years" />
          </Field>
          {fPerson && (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="person">Subject is a person</FieldLabel>
                <FieldDescription>{fPerson.always ? "Always, for this type of case." : "A person's data needs a legal basis (GDPR)."}</FieldDescription>
              </FieldContent>
              <Switch id="person" checked={person} disabled={!!fPerson.always} onCheckedChange={setPerson} />
            </Field>
          )}
          {fPerson && person && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="basis">Legal basis</FieldLabel>
                <Select value={basis} onValueChange={setBasis}>
                  <SelectTrigger id="basis" className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent><SelectGroup>{LEGAL_BASES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="precision">Details (optional)</FieldLabel>
                <Input id="precision" value={precision} onChange={e => setPrecision(e.target.value)} placeholder="public registry data" />
              </Field>
            </div>
          )}
          {fImage && (
            <Field>
              <FieldLabel>Image may leave this machine</FieldLabel>
              <Chips label="Image may leave this machine" value={image} onChange={setImage} options={[{ value: "yes", label: "Yes", icon: "upload" }, { value: "no", label: "No", icon: "hard-drive" }]} />
              <FieldDescription>Reverse image search sends it to search engines. No default: choose.</FieldDescription>
            </Field>
          )}
          {fNoisy && (
            <Field>
              <FieldLabel>Noisy actions</FieldLabel>
              <Chips label="Noisy actions" value={noisy} onChange={setNoisy} options={[{ value: "ask", label: "Ask", icon: "hand" }, { value: "never", label: "Never", icon: "ban" }]} />
              <FieldDescription>An action the target could notice (a sign-up probe…): the agent asks you first, or never runs it. No default: choose.</FieldDescription>
            </Field>
          )}
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Case</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="title">Title (optional)</FieldLabel>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Named after the input" />
          </Field>
          <Field>
            <FieldLabel htmlFor="lang">Language of the notes</FieldLabel>
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger id="lang" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="en">English</SelectItem><SelectItem value="fr">Français</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </FieldSet>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!ready}>{busy ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}Create case</Button>
          {missing.length > 0 && <span className="text-sm text-muted-foreground">Still needed: {missing.join(", ")}</span>}
        </div>
        {error && <p role="alert" className="text-sm whitespace-pre-wrap text-destructive">{error}</p>}
      </div>
    </form>
  )
}
