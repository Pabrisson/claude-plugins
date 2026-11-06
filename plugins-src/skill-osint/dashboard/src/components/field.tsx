import { CheckCheckIcon, EraserIcon } from "lucide-react"

import { Chips } from "@/components/chips"
import { FileField } from "@/components/file-field"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { Input as InputDef } from "@/lib/api"
import { t } from "@/lib/i18n"

export type Value = string | string[] | boolean | undefined
// One field of a case type's form, drawn from its manifest entry: text (or a text area), url, select, chips (one or
// several), toggle, file (its drop zone sends the file at once); its help under it, its error under it.
export function InputField({ input: i, value, onChange, error, onBusy }: { input: InputDef; value: Value; onChange: (v: Value) => void; error?: string | null; onBusy?: (b: boolean) => void }) {
  const id = `in-${i.id}`, label = i.required || i.default !== undefined || i.kind === "chips" ? i.label : t("{label} (optional)", { label: i.label })
  const help = i.help && <FieldDescription id={`${id}-help`}>{i.help}</FieldDescription>
  const err = error && <FieldError>{error}</FieldError>
  if (i.kind === "toggle") return (
    <Field orientation="horizontal" data-invalid={!!error || undefined}>
      <FieldContent><FieldLabel htmlFor={id}>{i.label}</FieldLabel>{help}{err}</FieldContent>
      <Switch id={id} checked={value === true} onCheckedChange={v => onChange(v)} aria-invalid={!!error || undefined} />
    </Field>
  )
  return (
    <Field data-invalid={!!error || undefined}>
      {i.kind === "chips" && i.multiple ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground tabular-nums" role="status">{t("{n} of {total}", { n: ((value as string[] | undefined) ?? []).length, total: (i.options ?? []).length })}</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => onChange((i.options ?? []).map(o => o.value))}><CheckCheckIcon data-icon="inline-start" />{t("All")}</Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => onChange([])}><EraserIcon data-icon="inline-start" />{t("None")}</Button>
          </div>
        </div>
      ) : <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      {i.kind === "file" ? (
        <FileField input={i} value={value as string | undefined} onChange={onChange} onBusy={onBusy ?? (() => {})} error={error} />
      ) : i.kind === "chips" ? (
        i.multiple
          ? <Chips multiple label={i.label} options={i.options ?? []} value={(value as string[] | undefined) ?? []} onChange={onChange} />
          : <Chips label={i.label} options={i.options ?? []} value={(value as string | undefined) ?? null} onChange={onChange} />
      ) : i.kind === "select" ? (
        <Select value={(value as string | undefined) ?? ""} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full" aria-invalid={!!error || undefined}><SelectValue placeholder={t("Choose…")} /></SelectTrigger>
          <SelectContent><SelectGroup>{(i.options ?? []).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      ) : i.kind === "text" && i.multiline ? (
        <Textarea id={id} value={(value as string | undefined) ?? ""} onChange={e => onChange(e.target.value)} placeholder={i.placeholder} rows={Math.max(4, (i.placeholder?.split("\n").length ?? 0) + 1)} aria-invalid={!!error || undefined} aria-describedby={i.help ? `${id}-help` : undefined} />
      ) : (
        <Input id={id} type={i.kind === "url" ? "url" : "text"} value={(value as string | undefined) ?? ""} onChange={e => onChange(e.target.value)} placeholder={i.placeholder} aria-invalid={!!error || undefined} aria-describedby={i.help ? `${id}-help` : undefined} autoComplete="off" spellCheck={false} />
      )}
      {help}
      {i.kind !== "file" && err}
    </Field>
  )
}
