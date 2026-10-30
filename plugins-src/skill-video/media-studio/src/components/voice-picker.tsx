import { useEffect, useState } from "react"
import { AudioLinesIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, plain, type Element, type Voice } from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, Label } from "@/components/chips"
import { Listen } from "@/components/inputs"

// the voice lists of Voice (a speech model's own voices) and Change voice (the Library's and ElevenLabs'): one
// searchable list, each voice with its circle to listen to its sample, and the ElevenLabs voices filtered on their
// language (the sample then in it), gender, age, accent, style and use. A voice of the Library has no such labels: it
// is always shown

// a row: what is picked (a voice id, a model's voice name, or @name), what is shown, its ElevenLabs voice if any, and
// the heading it sits under (none: one list without headings)
type Row = { value: string; title: string; note: string; voice?: Voice; file?: string; group?: string }

// the filters, kept for this browser and shared by both lists
type Filters = { language: string; gender: string; age: string; accent: string; descriptive: string; use_case: string }
const NONE: Filters = { language: "", gender: "", age: "", accent: "", descriptive: "", use_case: "" }
const KEY = "media-generator:voice-filters"
function useFilters() {
  const [f, setF] = useState<Filters>(() => {
    try {
      return { ...NONE, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }
    } catch {
      return NONE
    }
  })
  const set = (next: Filters) => {
    setF(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* private window: for this page only */
    }
  }
  return [f, set] as const
}

const NAMES = new Intl.DisplayNames(["en"], { type: "language" })
const langName = (code: string) => {
  try {
    return NAMES.of(code) ?? code
  } catch {
    return code
  }
}
// « middle_aged » reads « Middle-aged », « narrative_story » « Narrative story »
const words = (v: string) => (v === "middle_aged" ? "Middle-aged" : (v[0]?.toUpperCase() ?? "") + v.slice(1).replaceAll("_", " "))
const labelsOf = (v: Voice): Record<string, string> => (Array.isArray(v.labels) ? {} : (v.labels ?? {}))
const sample = (v: Voice | undefined, lang: string) => (v && ((lang && v.previews?.[lang]) || v.preview_url)) || undefined
// « George - Warm, Captivating Storyteller »: its name, then the line on it
const titleOf = (v: Voice) => v.name.split(/\s-\s/)[0]
function noteOf(v: Voice) {
  const l = labelsOf(v), line = v.name.split(/\s-\s/)[1]
  return [line, [l.gender, l.age && words(l.age).toLowerCase(), l.accent].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || (v.category === "cloned" ? "cloned" : v.category ? "ElevenLabs" : "")
}
const LABELS = ["gender", "age", "accent", "descriptive", "use_case"] as const
function passes(r: Row, f: Filters) {
  if (!r.voice) return true
  const l = labelsOf(r.voice)
  return (!f.language || (r.voice.languages ?? []).includes(f.language)) && LABELS.every((k) => !f[k] || l[k] === f[k])
}

// the values each filter can take among these voices, with how many voices have it
function choices(rows: Row[]) {
  const out = Object.fromEntries(Object.keys(NONE).map((k) => [k, new Map<string, number>()])) as Record<keyof Filters, Map<string, number>>
  const add = (k: keyof Filters, v: string) => out[k].set(v, (out[k].get(v) ?? 0) + 1)
  for (const r of rows) {
    if (!r.voice) continue
    for (const l of r.voice.languages ?? []) add("language", l)
    const l = labelsOf(r.voice)
    for (const k of LABELS) if (l[k]) add(k, l[k])
  }
  return out
}

// a filter is worth showing when it leaves voices out: two values or more, or one that not every voice has
const useful = (options: Map<string, number>, total: number) => options.size > 1 || (options.size === 1 && [...options.values()][0] < total)

function FilterSelect({ label, value, options, total, name = words, onChange }: { label: string; value: string; options: Map<string, number>; total: number; name?: (v: string) => string; onChange: (v: string) => void }) {
  if (!useful(options, total)) return null
  const list = [...options].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])))
  return (
    <Select value={value || "any"} onValueChange={(v) => onChange(v === "any" ? "" : v)}>
      <SelectTrigger size="sm" className={cn("h-7! w-auto gap-1 px-2 text-xs", value && "border-space/50 text-space")} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value="any">Any {label.toLowerCase()}</SelectItem>
        {list.map(([v, n]) => (
          <SelectItem key={v} value={v}>
            {name(v)} <span className="text-muted-foreground tabular-nums">{n}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FilterChips({ label, value, options, total, onChange }: { label: string; value: string; options: Map<string, number>; total: number; onChange: (v: string) => void }) {
  if (!useful(options, total)) return null
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {[...options].sort((a, b) => b[1] - a[1]).map(([v]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(value === v ? "" : v)} className={cn(CHIP, "px-2 py-0 text-xs", value === v ? CHIP_ON : CHIP_OFF)}>
          {words(v)}
        </button>
      ))}
    </div>
  )
}

// the circle before a voice: its sample to listen to (a press plays, it does not pick), else a plain mark; a voice
// with nothing to hear (another lab's) has none
function Circle({ row, lang, play }: { row?: Row; lang: string; play: boolean }) {
  const src = sample(row?.voice, lang)
  if (row && !src && !row.file) return null
  if (play && row)
    return (
      <span onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Listen key={src ?? row.file} path={row.file ?? ""} src={src} />
      </span>
    )
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", row ? "bg-aud text-background" : "border border-dashed text-muted-foreground")} aria-hidden>
      <AudioLinesIcon className="size-3.5" />
    </span>
  )
}

function VoiceList({ label, hint, rows, value, onChange, placeholder, status, footer }: { label: string; hint?: string; rows: Row[]; value?: string; onChange: (v: string) => void; placeholder: string; status?: string; footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useFilters()
  const c = choices(rows), labelled = rows.some((r) => r.voice), total = rows.filter((r) => r.voice).length
  const on = labelled && Object.values(f).some(Boolean)
  // the voice in use stays in the list whatever the filters
  const shown = rows.filter((r) => r.value === value || !labelled || passes(r, f))
  const current = rows.find((r) => r.value === value)
  const put = (k: keyof Filters) => (v: string) => setF({ ...f, [k]: v })
  // the headings in the rows' order; the ElevenLabs one says the language its samples are in
  const groups = [...new Set(shown.map((r) => r.group ?? ""))].map((g) => ({
    heading: g === "ElevenLabs" && f.language && labelled ? `ElevenLabs · samples in ${langName(f.language)}` : g,
    list: shown.filter((r) => (r.group ?? "") === g),
  }))
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${current?.title ?? "none"}. Change it`}
            className="flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-lg border border-input px-2 py-1.5 text-left shadow-xs transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:border-space/60 dark:bg-input/30 dark:hover:bg-input/50"
          >
            <Circle row={current} lang={labelled ? f.language : ""} play={false} />
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm font-medium", !current && "text-muted-foreground")}>{current?.title ?? placeholder}</span>
              {(current?.note || status) && <span className="block truncate text-xs text-muted-foreground">{current?.note || status}</span>}
            </span>
            {on && <span className="rounded-full bg-space/15 px-1.5 text-[11px] font-medium text-space tabular-nums">{shown.filter((r) => r.voice).length}</span>}
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {/* beside the composer, like the tool and model pickers: the screen's height, moved up to stay on it */}
        <PopoverContent side="right" align="start" sideOffset={24} collisionPadding={12} className="flex max-h-[min(680px,calc(100vh-1.5rem))] w-[26rem] flex-col p-0">
          <Command loop className="min-h-0 flex-1">
            {rows.length > 6 && <CommandInput placeholder="Search voices" aria-label="Search voices" />}
            {labelled && (
              <div className="flex flex-col gap-1.5 border-b p-2">
                <div className="flex flex-wrap items-center gap-1">
                  <FilterSelect label="Language" value={f.language} options={c.language} total={total} name={langName} onChange={put("language")} />
                  <FilterSelect label="Accent" value={f.accent} options={c.accent} total={total} onChange={put("accent")} />
                  <FilterSelect label="Style" value={f.descriptive} options={c.descriptive} total={total} onChange={put("descriptive")} />
                  <FilterSelect label="Use" value={f.use_case} options={c.use_case} total={total} onChange={put("use_case")} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <FilterChips label="Gender" value={f.gender} options={c.gender} total={total} onChange={put("gender")} />
                  <FilterChips label="Age" value={f.age} options={c.age} total={total} onChange={put("age")} />
                  {on && (
                    <button type="button" onClick={() => setF(NONE)} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <XIcon className="size-3" /> Clear
                    </button>
                  )}
                </div>
              </div>
            )}
            <CommandList className="max-h-none min-h-0 flex-1">
              <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">{status ?? (on ? "No voice with these filters." : "No voice matches.")}</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.heading || "voices"} heading={g.heading || undefined}>
                  {g.list.map((r) => (
                    <CommandItem key={r.value} value={`${r.value} ${r.title} ${r.note}`} data-checked={r.value === value} onSelect={() => (onChange(r.value), setOpen(false))}>
                      <Circle row={r} lang={labelled ? f.language : ""} play />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.title}</span>
                        {r.note && <span className="block truncate text-xs text-muted-foreground">{r.note}</span>}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
            {footer && <div className="border-t px-3 py-2 text-xs text-muted-foreground">{footer}</div>}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// the account's ElevenLabs voices, asked once a list needs them
function useElevenVoices(enabled: boolean) {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    api.voices().then(
      (v) => setVoices(Array.isArray(v) ? v : v.voices),
      (e) => setError(plain(e.message))
    )
  }, [enabled])
  return { voices, error }
}

// Change voice's new voice: the Library's voices (one not on ElevenLabs yet goes there when the job runs) and the
// ElevenLabs voices (its default ones and the account's own). Its value is a voice id, or @name for a Library voice
export function VoicePicker({ enabled, value, onChange, library }: { enabled: boolean; value?: string; onChange: (v: string) => void; library: Element[] }) {
  const { voices, error } = useElevenVoices(enabled)
  if (!enabled) return null
  const ours = library.filter((e) => e.type === "voice" && e.files.length)
  const rows: Row[] = [
    ...ours.map((e) => ({
      value: e.voice_id ?? `@${e.name}`,
      title: `@${e.name}`,
      note: [e.words, e.voice_id ? "" : "goes to ElevenLabs at first use (paid plan)"].filter(Boolean).join(" · ") || `${e.files.length} clip${e.files.length > 1 ? "s" : ""}`,
      file: e.files[0],
      group: "Your voices",
    })),
    // a Library voice already on the account is listed once, under its @name
    ...(voices ?? []).filter((v) => !ours.some((e) => e.voice_id === v.voice_id)).map((v) => ({ value: v.voice_id, title: titleOf(v), note: noteOf(v), voice: v, group: ours.length ? "ElevenLabs" : undefined })),
  ]
  return (
    <VoiceList
      label="New voice"
      hint={ours.length ? `${ours.length} of yours, ${voices?.length ?? "…"} on ElevenLabs` : "ElevenLabs' and your own"}
      rows={rows}
      value={value}
      onChange={onChange}
      placeholder="Pick the new voice"
      status={error ?? (voices ? undefined : "Loading the voices…")}
      footer={
        <>
          {ours.length ? "A voice of your own" : "No voice of your own yet"}: 1 to 3 clean clips in{" "}
          <a href="#library/elements" className="underline underline-offset-2 hover:text-foreground">
            Library › Elements
          </a>
          .
        </>
      }
    />
  )
}

// Gemini's voices as Google describes them (ai.google.dev, speech generation, 2026-10-30): a style each, no gender
const GEMINI: Record<string, string> = {
  Zephyr: "Bright", Puck: "Upbeat", Charon: "Informative", Kore: "Firm", Fenrir: "Excitable", Leda: "Youthful", Orus: "Firm", Aoede: "Breezy",
  Callirrhoe: "Easy-going", Autonoe: "Bright", Enceladus: "Breathy", Iapetus: "Clear", Umbriel: "Easy-going", Algieba: "Smooth", Despina: "Smooth",
  Erinome: "Clear", Algenib: "Gravelly", Rasalgethi: "Informative", Laomedeia: "Upbeat", Achernar: "Soft", Alnilam: "Firm", Schedar: "Even",
  Gacrux: "Mature", Pulcherrima: "Forward", Achird: "Friendly", Zubenelgenubi: "Casual", Vindemiatrix: "Gentle", Sadachbia: "Lively",
  Sadaltager: "Knowledgeable", Sulafat: "Warm",
}
// MiniMax names say what each voice is: « English_CalmWoman », « English_Wiselady »: its language, and the gender
// and age its words give, only when they say it (the search finds the rest: calm, deep, whispering…)
const LANG = { English: "en", French: "fr", Spanish: "es", German: "de", Italian: "it", Portuguese: "pt", Japanese: "ja", Korean: "ko", Chinese: "zh" } as Record<string, string>
function minimax(name: string): Voice {
  const [prefix, ...rest] = name.split("_")
  const said = rest.join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/(\D)(\d)/g, "$1 $2").toLowerCase()
  const has = (re: RegExp) => re.test(said)
  const gender = has(/(girl|lady|woman|female|queen)\b/) ? "female" : has(/(man|boy|bloke|guy|male)\b/) ? "male" : ""
  const age = has(/\b(girl|boy|teen|young)\b/) ? "young" : ""
  const title = said.charAt(0).toUpperCase() + said.slice(1)
  return { voice_id: name, name: title, labels: { ...(gender && { gender }), ...(age && { age }) }, languages: LANG[prefix] ? [LANG[prefix]] : [] }
}

// a speech model's own voices; an ElevenLabs model's are the account's default ones (the router's « george » is
// « George - Warm, Captivating Storyteller »), with their samples, labels and filters; Gemini's and MiniMax's with
// what their makers say of them, filtered the same, without a sample. The Library's voices stay in their own field
export function ModelVoices({ model, voices, value, onChange, elevenlabs }: { model: string; voices: string[]; value: string; onChange: (v: string) => void; elevenlabs: boolean }) {
  const eleven = model.startsWith("elevenlabs/") && elevenlabs
  const { voices: account } = useElevenVoices(eleven)
  const byName = new Map((account ?? []).map((v) => [titleOf(v).toLowerCase(), v]))
  const rows: Row[] = voices.map((name) => {
    const v = eleven
      ? byName.get(name.toLowerCase())
      : model.startsWith("google/") && GEMINI[name]
        ? { voice_id: name, name: `${name} - ${GEMINI[name]}`, labels: { descriptive: GEMINI[name].toLowerCase() } }
        : model.startsWith("minimax/")
          ? minimax(name)
          : undefined
    return v ? { value: name, title: titleOf(v), note: noteOf(v), voice: v } : { value: name, title: name, note: "" }
  })
  return <VoiceList label="Voice" hint={`${voices.length} voices of this model`} rows={rows} value={value} onChange={onChange} placeholder="Pick a voice" />
}

// Voice's own field for the Library's voices: one picked sends its clips to be cloned and says how it sounds; « The
// model's voices » leaves the choice to the list below
export function LibraryVoices({ voices, value, onChange }: { voices: Element[]; value: string | null; onChange: (name: string | null) => void }) {
  if (!voices.length)
    return (
      <div>
        <Label hint="cloned from its clips">Your voices</Label>
        <p className="text-xs text-muted-foreground">
          No voice in the Library yet: a Voice element is 1 to 3 clean clips. <a href="#library/elements" className="underline underline-offset-2 hover:text-foreground">Make one</a>, or use the model's voices below.
        </p>
      </div>
    )
  const rows: Row[] = [
    { value: "-", title: "The model's voices", note: "A preset voice, or clips to clone below", group: "Models" },
    ...voices.map((v) => ({ value: v.name, title: `@${v.name}`, note: v.words || `${v.files.length} clip${v.files.length > 1 ? "s" : ""}`, file: v.files[0], group: "Your voices" })),
  ]
  return <VoiceList label="Your voices" hint={`cloned from its clips · ${voices.length} in the Library`} rows={rows} value={value ?? "-"} onChange={(v) => onChange(v === "-" ? null : v)} placeholder="The model's voices" />
}
