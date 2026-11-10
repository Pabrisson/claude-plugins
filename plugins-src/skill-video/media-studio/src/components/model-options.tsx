import { FileIcon, PlusIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Chips, Label, ToolIcon, valueIcon } from "@/components/chips"
import { upload } from "@/components/inputs"
import type { Line, ModelOption, OptionValue, Shot } from "@/lib/api"
import { t, own, locale } from "@/lib/i18n"

const valueOf = (v: OptionValue) => (typeof v === "object" ? v.value : v)
// (as shown: a value's label is the catalog's)
const labelOf = (v: OptionValue) => (typeof v === "object" ? own(v.label) : String(v))
// a value's own icon when its model names one (ElevenLabs' Tracks), else the one its value reads as
const iconOf = (o: ModelOption, x: string | number) => {
  const named = o.values?.find((y) => valueOf(y) === x)
  return typeof named === "object" && named.icon ? <ToolIcon name={named.icon} /> : valueIcon(x)
}

// a model's own settings (its params.options), one control each; only a value moved off its default is kept, so the
// model's own default goes when nothing is touched
export function ModelOptions({ options, value, onChange }: { options: ModelOption[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown> | undefined) => void }) {
  const put = (o: ModelOption, v: unknown) => {
    const rest = { ...value }
    delete rest[o.key]
    const next = v === o.default || v === undefined || v === "" ? rest : { ...rest, [o.key]: v }
    onChange(Object.keys(next).length ? next : undefined)
  }
  return (
    <>
      {options.map((o) => {
        const v = value[o.key] ?? o.default
        // a switch: its name and what it does on two lines, the switch at the right, never wider than the panel
        if (o.type === "switch")
          return (
            <label key={o.key} className="flex min-w-0 cursor-pointer items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-xs font-semibold tracking-wider text-foreground/70 uppercase">{own(o.label)}</span>
                {o.hint && <span className="block text-xs text-muted-foreground">{own(o.hint)}</span>}
              </span>
              <Switch checked={!!v} onCheckedChange={(c) => put(o, c)} aria-label={own(o.label)} className="mt-0.5" />
            </label>
          )
        if (o.type === "slider")
          return (
            <div key={o.key}>
              <Label hint={own(o.hint)} stacked>{own(o.label)}</Label>
              <div className="flex items-center gap-3">
                <Slider min={o.min} max={o.max} step={o.step ?? 0.05} value={[Number(v ?? o.min ?? 0)]} onValueChange={([x]) => put(o, +x.toFixed(2))} aria-label={own(o.label)} />
                <span className="w-10 text-right text-sm tabular-nums">{Number(v ?? 0).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          )
        if (o.type === "choice")
          return (
            <div key={o.key}>
              <Label hint={own(o.hint)} stacked>{own(o.label)}</Label>
              <Chips options={(o.values ?? []).map(valueOf)} value={v as string | number} label={(x) => labelOf(o.values!.find((y) => valueOf(y) === x)!)} icon={(x) => iconOf(o, x)} onChange={(x) => put(o, x)} />
            </div>
          )
        if (o.type === "select")
          return (
            <div key={o.key}>
              <Label hint={own(o.hint)} stacked>{own(o.label)}</Label>
              <Select value={String(v ?? "") || "auto"} onValueChange={(x) => put(o, x === "auto" ? "" : (o.values ?? []).map(valueOf).find((y) => String(y) === x))}>
                <SelectTrigger className="w-full" aria-label={own(o.label)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {!o.default && <SelectItem value="auto">{t("Auto")}</SelectItem>}
                  {(o.values ?? []).map((x) => (
                    <SelectItem key={String(valueOf(x))} value={String(valueOf(x))}>
                      {labelOf(x)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        if (o.type === "file")
          return (
            <div key={o.key}>
              <Label hint={own(o.hint)} stacked>{own(o.label)}</Label>
              {value[o.key] ? (
                <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{String(value[o.key]).split(/[\\/]/).pop()?.replace(/^\d+-/, "")}</span>
                  <Button size="icon-xs" variant="ghost" aria-label={t("Remove the {what}", { what: own(o.label).toLowerCase() })} onClick={() => put(o, undefined)}>
                    <XIcon />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" asChild>
                  <label className="relative cursor-pointer">
                    <PlusIcon data-icon="inline-start" />
                    {t("Choose a file")}
                    <input type="file" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) put(o, await upload(f)) }} />
                  </label>
                </Button>
              )}
            </div>
          )
        return (
          <div key={o.key}>
            <Label hint={own(o.hint)} stacked>{own(o.label)}</Label>
            <Input
              inputMode={o.type === "number" ? "decimal" : undefined}
              placeholder={o.default != null ? String(o.default) : t("Auto")}
              value={value[o.key] == null ? "" : String(value[o.key])}
              onChange={(e) => put(o, o.type === "number" ? (e.target.value === "" || Number.isNaN(+e.target.value) ? undefined : +e.target.value) : e.target.value)}
              aria-label={own(o.label)}
            />
          </div>
        )
      })}
    </>
  )
}

// the audio tags v4 and v3 read in the text: a few to start from, added at the end of the words
const TAGS = ["[whispers]", "[laughs]", "[sighs]", "[excited]", "[sarcastic]", "[shouts]", "[pause]"]
export function AudioTags({ onAdd }: { onAdd: (tag: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-muted-foreground">{t("Audio tags")}</span>
      {TAGS.map((tag) => (
        <button key={tag} type="button" onClick={() => onAdd(tag)} className="rounded-md border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
          {tag}
        </button>
      ))}
    </div>
  )
}

// a dialogue (ElevenLabs v4 and v3, Gemini on Kie): its lines, each its voice (the model's own picker) and words; a
// new line takes the voice of the one before the last, so two voices alternate by themselves
export function DialogueEditor({ lines, onChange, picker, max, tags, speakers }: {
  lines: Line[]
  onChange: (l: Line[]) => void
  picker: (value: string, onVoice: (v: string) => void, label: string) => React.ReactNode
  max?: number
  tags: boolean
  speakers?: number
}) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const chars = lines.reduce((n, l) => n + l.text.length, 0)
  return (
    <div className="flex flex-col gap-3">
      <Label hint={[max ? t("{n} / {max} characters", { n: chars.toLocaleString(locale()), max: max.toLocaleString(locale()) }) : "", speakers ? t("{n} voices at most", { n: speakers }) : ""].filter(Boolean).join(" · ")}>{t("Lines")}</Label>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">{picker(l.voice, (voice) => set(i, { voice }), t("Line {n}", { n: i + 1 }))}</div>
            {lines.length > 1 && (
              <Button size="icon-xs" variant="ghost" aria-label={t("Remove line {n}", { n: i + 1 })} title={t("Remove this line")} onClick={() => onChange(lines.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            )}
          </div>
          <Textarea value={l.text} placeholder={tags ? t("What this voice says. [laughs] and other tags steer it.") : t("What this voice says")} aria-label={t("Line {n}: words", { n: i + 1 })} className="min-h-14 text-sm" onChange={(e) => set(i, { text: e.target.value })} />
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...lines, { voice: lines.at(-2)?.voice ?? "", text: "" }])}>
        <PlusIcon data-icon="inline-start" />
        {t("Add a line")}
      </Button>
    </div>
  )
}

// Kling's shots (Kie): each its words and seconds, the video as long as their sum
export function ShotsEditor({ shots, onChange, max, each, lengths }: { shots: Shot[]; onChange: (s: Shot[]) => void; max: number; each: [number, number]; lengths: number[] }) {
  const set = (i: number, patch: Partial<Shot>) => onChange(shots.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const total = shots.reduce((n, x) => n + x.duration, 0), fits = !lengths.length || lengths.includes(total)
  const seconds = Array.from({ length: each[1] - each[0] + 1 }, (_, k) => each[0] + k)
  return (
    <div className="flex flex-col gap-3">
      <Label hint={fits ? t("{total} s in all · {max} shots at most", { total, max }) : t("{total} s in all: {from} to {to} s · {max} shots at most", { total, from: lengths[0], to: lengths.at(-1)!, max })}>{t("Shots")}</Label>
      {shots.map((x, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider text-foreground/70 uppercase">{t("Shot {n}", { n: i + 1 })}</span>
            <Select value={String(x.duration)} onValueChange={(v) => set(i, { duration: +v })}>
              <SelectTrigger size="sm" className="ml-auto h-7! w-auto gap-1 px-2 text-xs" aria-label={t("Shot {n}: seconds", { n: i + 1 })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {seconds.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {shots.length > 1 && (
              <Button size="icon-xs" variant="ghost" aria-label={t("Remove shot {n}", { n: i + 1 })} title={t("Remove this shot")} onClick={() => onChange(shots.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            )}
          </div>
          <Textarea value={x.prompt} placeholder={t("What this shot shows; @name cites an element.")} aria-label={t("Shot {n}: words", { n: i + 1 })} className="min-h-14 text-sm" onChange={(e) => set(i, { prompt: e.target.value })} />
        </div>
      ))}
      {shots.length < max && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...shots, { prompt: "", duration: Math.min(each[1], Math.max(each[0], 3)) }])}>
          <PlusIcon data-icon="inline-start" />
          {t("Add a shot")}
        </Button>
      )}
    </div>
  )
}
