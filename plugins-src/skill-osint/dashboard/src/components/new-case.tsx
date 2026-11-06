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
import { t } from "@/lib/i18n"
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
          <Button variant="ghost" size="icon-sm" asChild><a href={type ? "#/new" : "#/"} aria-label={type ? t("Choose another type") : t("All cases")}><ArrowLeftIcon /></a></Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{m ? t("New case: {type}", { type: m.label }) : t("New case")}</h1>
            <p className="text-sm text-muted-foreground">{m ? m.description : t("What does the case start from?")}</p>
          </div>
        </div>
        {!types ? <Skeleton className="h-40 rounded-xl" /> : m ? <CaseForm key={m.id} m={m} color={typeColor(m.id, types)} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {types.map(ty => {
              const d = doctor?.types.find(x => x.id === ty.id && !x.refused), ready = d?.ready !== false
              return (
                <button key={ty.id} type="button" disabled={!ready} onClick={() => go(`#/new/${ty.id}`)}
                  className="flex items-start gap-3 rounded-xl p-4 text-left ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg" style={{ background: tint(typeColor(ty.id, types)), color: typeColor(ty.id, types) }}><Icon name={ty.icon} className="size-5" aria-hidden /></span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 font-medium">{ty.label}{ty.private && <PrivateBadge id={ty.id} />}</span>
                    <span className="text-sm text-muted-foreground">{ty.description}</span>
                    {d && !d.ready && <Badge className={cn("mt-1", TONE.amber)}>{t("Needs {list}", { list: d.missing.join(", ") })}</Badge>}
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
  const fieldError = (id: string) => (check.error && touched[id] && new RegExp(`(?:input |--in )${id}\\b`).test(check.error) ? (/^--in \S+?: at least one/.test(check.error) ? t("Choose at least one") : check.error.replace(/^--in \S+?: /, "")) : null)
  const missing = [
    ...visible.filter(i => i.required && inputs[i.id] == null).map(i => i.label),
    !question.trim() && t("the question"), !purpose.trim() && t("the purpose"),
    person && !basis && t("the legal basis"), fImage && !image && t("whether the image may leave"), fNoisy && !noisy && t("the noisy actions"),
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
          <CardTitle className="flex items-center gap-2"><CircleCheckIcon className="size-5 text-emerald-600 dark:text-emerald-400" />{t("Case created")}</CardTitle>
          <CardDescription>{t("The case folder is ready. Paste this prompt to the agent to start the investigation.")}</CardDescription>
        </CardHeader>
        <CardContent><pre className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{prompt}</pre></CardContent>
        <CardFooter className="gap-2">
          <Button onClick={() => copyText(prompt, t("Prompt copied: paste it to the agent"))}><CopyIcon data-icon="inline-start" />{t("Copy prompt")}</Button>
          <Button variant="outline" asChild><a href={caseHref(slug)}><FolderOpenIcon data-icon="inline-start" />{t("Open case")}</a></Button>
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
        <FieldLegend>{t("Frame")}</FieldLegend>
        <FieldDescription>{t("What the case must answer, and within which limits. The agent keeps to it.")}</FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="question">{t("Question")}</FieldLabel>
            <Textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} rows={2} placeholder={t("Who runs this website?")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="purpose">{t("Purpose")}{fPerson?.purpose && <span aria-hidden> *</span>}</FieldLabel>
            <Input id="purpose" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder={t("Check a seller before a large order")} aria-required={fPerson?.purpose || undefined} aria-describedby={fPerson?.purpose ? "purpose-help" : undefined} />
            {fPerson?.purpose && <FieldDescription id="purpose-help">{t("Each identifier is weighed against it.")}</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="scope">{t("Scope (optional)")}</FieldLabel>
            <Input id="scope" value={scope} onChange={e => setScope(e.target.value)} placeholder={t("Public sources only, the last five years")} />
          </Field>
          {fPerson && (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="person">{t("Subject is a person")}</FieldLabel>
                <FieldDescription>{fPerson.always ? t("Always, for this type of case.") : t("A person's data needs a legal basis (GDPR).")}</FieldDescription>
              </FieldContent>
              <Switch id="person" checked={person} disabled={!!fPerson.always} onCheckedChange={setPerson} />
            </Field>
          )}
          {fPerson && person && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="basis">{t("Legal basis")}</FieldLabel>
                <Select value={basis} onValueChange={setBasis}>
                  <SelectTrigger id="basis" className="w-full"><SelectValue placeholder={t("Choose…")} /></SelectTrigger>
                  <SelectContent><SelectGroup>{LEGAL_BASES.map(b => <SelectItem key={b} value={b}>{t(b)}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="precision">{t("Details (optional)")}</FieldLabel>
                <Input id="precision" value={precision} onChange={e => setPrecision(e.target.value)} placeholder={t("public registry data")} />
              </Field>
            </div>
          )}
          {fImage && (
            <Field>
              <FieldLabel>{t("Image may leave this machine")}</FieldLabel>
              <Chips label={t("Image may leave this machine")} value={image} onChange={setImage} options={[{ value: "yes", label: t("Yes"), icon: "upload" }, { value: "no", label: t("No"), icon: "hard-drive" }]} />
              <FieldDescription>{t("Reverse image search sends it to search engines. No default: choose.")}</FieldDescription>
            </Field>
          )}
          {fNoisy && (
            <Field>
              <FieldLabel>{t("Noisy actions")}</FieldLabel>
              <Chips label={t("Noisy actions")} value={noisy} onChange={setNoisy} options={[{ value: "ask", label: t("Ask"), icon: "hand" }, { value: "never", label: t("Never"), icon: "ban" }]} />
              <FieldDescription>{t("An action the target could notice (a sign-up probe…): the agent asks you first, or never runs it. No default: choose.")}</FieldDescription>
            </Field>
          )}
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>{t("Case")}</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="title">{t("Title (optional)")}</FieldLabel>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder={t("Named after the input")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lang">{t("Language of the notes")}</FieldLabel>
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger id="lang" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="en">English</SelectItem><SelectItem value="fr">Français</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </FieldSet>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!ready}>{busy ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}{t("Create case")}</Button>
          {missing.length > 0 && <span className="text-sm text-muted-foreground">{t("Still needed: {list}", { list: missing.join(", ") })}</span>}
        </div>
        {error && <p role="alert" className="text-sm whitespace-pre-wrap text-destructive">{error}</p>}
      </div>
    </form>
  )
}
