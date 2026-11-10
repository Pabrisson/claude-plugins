import { PlusIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/chips"
import { ElementField } from "@/components/element-field"
import { Listen } from "@/components/inputs"
import { cited, ELEMENT_TYPES, heard, type Field, type Mentionable, type Model } from "@/lib/api"
import { t } from "@/lib/i18n"

// a voice of one's own (a file) by the name the words cite it with: the one typed, else its file's
export const voiceName = (file: string, typed?: string) => (typed || file.split(/[\\/]/).pop()!.replace(/^\d+-/, "").replace(/\.\w+$/, "")).replace(/[^\w]/g, "_").slice(0, 20)
const ELEMENTS: Field = { key: "elements", label: t("Elements"), type: "element", multiple: true, types: ELEMENT_TYPES.map((t) => t.type).filter((t) => !heard(t)) }
// a name out of the words, once each, with the space after it
const drop = (text: string, name: string) => text.replace(new RegExp(`@${name}(?![\\w-])\\s?`, "g"), "")

// a model's references in all (omni references: Kling 4.0, Seedance, Wan 3.0…): each one's tag to cite it in the words,
// the Elements the words cite (picked here too), the name of each voice of one's own, and their count in all
export function OmniRefs({ mp, inputs, voiceNames, intent, items, onIntent, onVoiceNames }: {
  mp: Model["params"]
  inputs: Record<string, string[]>
  voiceNames: string[]
  intent: string
  items: Mentionable[]
  onIntent: (intent: string) => void
  onVoiceNames: (names: string[]) => void
}) {
  const images = inputs.references ?? [], videos = inputs.ref_videos ?? [], voices = inputs.ref_voices ?? []
  const said = cited(intent, items), elements = said.filter((i) => i.type !== "voice")
  const names = voices.map((f, i) => voiceName(f, voiceNames[i]))
  const tag = (t: string | undefined, n: number) => t?.replace("{n}", String(n))
  const tags = [
    ...images.map((_, i) => tag(mp.cite?.images, i + 1)),
    ...videos.map((_, i) => tag(mp.cite?.video, i + 1)),
    ...said.map((i) => `@${i.name}`),
    ...names.map((n) => `@${n}`),
  ].filter((t): t is string => !!t)
  const total = images.length + videos.length + said.length + voices.length
  const over = mp.materials != null && total > mp.materials
  const cite = (t: string) => onIntent(`${intent.trimEnd()}${intent.trim() ? " " : ""}${t} `)
  if (!tags.length && !mp.elements && !voices.length) return null
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label hint={mp.materials ? <span className={cn("tabular-nums", over && "font-medium text-destructive")}>{t("{n} / {max} in all", { n: total, max: mp.materials })}</span> : t("what the words can cite")}>{t("References")}</Label>
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tg) => {
              const used = new RegExp(`${tg}(?![\\w-])`).test(intent)
              return (
                <button
                  key={tg}
                  type="button"
                  onClick={() => cite(tg)}
                  title={used ? t("{tag} is in your words", { tag: tg }) : t("Cite {tag} in your words", { tag: tg })}
                  className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-muted hover:text-foreground", used ? "border-space/40 text-foreground" : "text-muted-foreground")}
                >
                  {tg}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("Images, videos, sounds and voices added above, and the Elements below, show here: a click cites one in your words.")}</p>
        )}
      </div>
      {!!mp.elements && (
        <ElementField
          field={ELEMENTS}
          value={elements.map((i) => `@${i.name}`).join(", ")}
          items={items.filter((i) => i.type !== "voice")}
          onChange={(v) => {
            const next = v.split(/[\s,]+/).filter(Boolean), now = elements.map((i) => `@${i.name}`)
            let text = now.filter((n) => !next.includes(n)).reduce((t, n) => drop(t, n.slice(1)), intent)
            for (const n of next.filter((x) => !now.includes(x))) text = `${text.trimEnd()}${text.trim() ? " " : ""}${n} `
            onIntent(text)
          }}
        />
      )}
      {voices.length > 0 && (
        <div>
          <Label hint={t("the name your words cite each by")}>{t("Your voices")}</Label>
          <div className="flex flex-col gap-1.5">
            {voices.map((f, i) => (
              <div key={f} className="flex items-center gap-2">
                <Listen path={f} />
                <span className="font-mono text-sm text-muted-foreground">@</span>
                <Input
                  value={voiceNames[i] ?? names[i]}
                  aria-label={t("Voice {n}: its name", { n: i + 1 })}
                  className="h-8 flex-1 font-mono text-sm"
                  onChange={(e) => onVoiceNames(voices.map((_, k) => (k === i ? e.target.value.replace(/[^\w]/g, "_").slice(0, 20) : (voiceNames[k] ?? names[k]))))}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export type SpokenLine = { who?: string; voice?: string; text: string }
// lines a video says, the lips in sync: who says what (a character of the Library, or a voice off screen), in which
// voice when the model takes voices of its own (Kling 4.0), written after the words
export function LinesEditor({ lines, onChange, characters, voices }: { lines: SpokenLine[]; onChange: (l: SpokenLine[]) => void; characters: Mentionable[]; voices: string[] | null }) {
  const set = (i: number, patch: Partial<SpokenLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const add = () => onChange([...lines, { who: lines.at(-2)?.who ?? (characters[0] ? `@${characters[0].name}` : undefined), voice: lines.at(-2)?.voice, text: "" }])
  if (!lines.length)
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={add} title={t("Who says what in the video: the lips follow the words")}>
        <PlusIcon data-icon="inline-start" /> {t("Add spoken lines")}
      </Button>
    )
  const pick = (value: string | undefined, onPick: (v: string | undefined) => void, label: string, none: string, groups: [string, string[]][]) => (
    <Select value={value ?? "-"} onValueChange={(v) => onPick(v === "-" ? undefined : v)}>
      <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        <SelectItem value="-">{none}</SelectItem>
        {groups.filter(([, list]) => list.length).map(([title, list]) => (
          <SelectGroup key={title}>
            <SelectLabel>{title}</SelectLabel>
            {list.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <div className="flex flex-col gap-2">
      <Label hint={t("the lips follow them")}>{t("Spoken lines")}</Label>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-2.5">
          <div className="flex items-center gap-2">
            {pick(l.who, (who) => set(i, { who }), t("Line {n}: who speaks", { n: i + 1 }), t("A voice off screen"), [[t("Characters"), characters.map((c) => `@${c.name}`)]])}
            {voices && pick(l.voice, (voice) => set(i, { voice }), t("Line {n}: in which voice", { n: i + 1 }), l.who ? t("Its own voice") : t("Any voice"), [[t("Voices"), voices]])}
            <Button size="icon-xs" variant="ghost" aria-label={t("Remove line {n}", { n: i + 1 })} title={t("Remove this line")} onClick={() => onChange(lines.filter((_, k) => k !== i))}>
              <XIcon />
            </Button>
          </div>
          <Input value={l.text} placeholder={t("What is said")} aria-label={t("Line {n}: words", { n: i + 1 })} className="h-8 text-sm" onChange={(e) => set(i, { text: e.target.value })} />
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={add}>
        <PlusIcon data-icon="inline-start" /> {t("Add a line")}
      </Button>
    </div>
  )
}
