import { actionsFor, itemOf, pivotsFor } from "@engine/prompt.js"
import { ListPlusIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
import { kindOf } from "@/components/shared-entities"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { Action, CaseIndex, Manifest } from "@/lib/api"
import { useBasket, type Item } from "@/lib/basket"
import { t } from "@/lib/i18n"

type Pick = { key: string; label: ReactNode; sub?: ReactNode; icon: string; color?: string; item: Item; minutes?: number | null; noisy?: boolean }
const TARGET: Record<string, string> = { case: "On the case", hyp: "On a hypothesis", evidence: "On a piece of evidence" }

// Next actions: the type's actions on their targets, the open leads, the pivots to a new case; the ones checked go to
// the case's prompt
export function NextActions({ open, setOpen, index, manifest, types }: { open: boolean; setOpen: (o: boolean) => void; index: CaseIndex; manifest: Manifest; types: Manifest[] }) {
  const { add } = useBasket()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const notes = index.notes, input = String(index.props.input ?? "")
  const entities = notes.filter(n => n.folder === "Entities")
  const targets = (a: Action): Pick[] => {
    const base = (key: string, label: ReactNode, vars: Record<string, string>, extra: Partial<Pick> = {}): Pick => ({ key: `${a.id}|${key}`, label, icon: a.icon, item: itemOf(a.prompt, vars), minutes: a.minutes, noisy: a.noisy, ...extra })
    if (a.target === "case") return [base("case", a.label, { value: input })]
    if (a.target === "hyp") return notes.filter(n => n.folder === "Hypotheses" && n.props.status !== "excluded").map(n => base(n.path, a.label, { value: input, hyp: `${n.props.id} ${n.title}` }, { sub: `${n.props.id} ${n.title}` }))
    if (a.target === "evidence") return index.files.filter(f => f.startsWith("Evidence/")).map(f => base(f, a.label, { value: input, file: f }, { sub: f }))
    const kind = a.target.replace(/^entity:/, "")
    return entities.filter(n => n.props.kind === kind).map(n => base(n.path, a.label, { value: String(n.props.value ?? n.title) }, { sub: String(n.props.value ?? n.title), color: kindOf(kind).color }))
  }
  const groups: [string, Pick[]][] = []
  for (const tg of [...new Set(manifest.actions.map(a => a.target))]) {
    const picks = actionsFor(manifest, tg).flatMap(targets)
    if (picks.length) groups.push([TARGET[tg] ? t(TARGET[tg]) : t("On {kind} entities", { kind: kindOf(tg.replace(/^entity:/, "")).label.toLowerCase() }), picks])
  }
  const leads: Pick[] = index.leads.filter(l => !l.done).map(l => ({ key: `lead|${l.id}`, label: l.label, sub: l.why, icon: "signpost", item: itemOf(l.prompt || `[lead:${l.id}] ${l.label}`), minutes: l.minutes, noisy: l.noisy }))
  const pivots: Pick[] = entities.flatMap(n => pivotsFor({ kind: String(n.props.kind), value: String(n.props.value ?? n.title), path: n.path, props: n.props }, types)
    .map(p => ({ key: `pivot|${p.type}|${n.path}`, label: t("New {type} case on {value}", { type: types.find(x => x.id === p.type)?.label ?? p.type, value: String(n.props.value ?? n.title) }), icon: p.icon, color: kindOf(String(n.props.kind)).color, item: p.item })))
  const all = [...groups.flatMap(([, p]) => p), ...leads, ...pivots]
  const toggle = (k: string) => setChecked(s => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x })
  const addChecked = () => {
    const picks = all.filter(p => checked.has(p.key))
    picks.forEach(p => add(p.item))
    toast.success(t(picks.length > 1 ? "{n} items added to the prompt" : "{n} item added to the prompt", { n: picks.length }))
    setChecked(new Set()); setOpen(false)
  }
  const row = (p: Pick) => (
    <li key={p.key}>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted/60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
        <Checkbox checked={checked.has(p.key)} onCheckedChange={() => toggle(p.key)} className="mt-0.5" />
        <Icon name={p.icon} className="mt-0.5 size-4 shrink-0" style={p.color ? { color: p.color } : undefined} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <span className="font-medium">{p.label}</span>
          {p.sub && <span className="text-xs text-muted-foreground">{p.sub}</span>}
          {(p.minutes || p.noisy) && (
            <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {p.minutes ? <span className="inline-flex items-center gap-1"><Icon name="clock" className="size-3" aria-hidden />~{p.minutes} min</span> : null}
              {p.noisy && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><Icon name="volume-2" className="size-3" aria-hidden />{t("Noisy: the agent asks you first")}</span>}
            </span>
          )}
        </span>
      </label>
    </li>
  )
  const section = (title: string, icon: string, picks: Pick[], empty: string) => (
    <section key={title} className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Icon name={icon} className="size-3.5" aria-hidden />{title}</h3>
      {picks.length ? <ul className="flex flex-col">{picks.map(row)}</ul> : <p className="px-2 text-xs text-muted-foreground">{empty}</p>}
    </section>
  )
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("Next actions")}</SheetTitle>
          <SheetDescription>{t("Check what the agent should do next; « Add to prompt » puts it in the case's prompt.")}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4">
          {groups.map(([title, picks]) => section(t("{type}: {target}", { type: manifest.label, target: title.toLowerCase() }), manifest.icon, picks, ""))}
          {section(t("Leads"), "signpost", leads, t("No open lead."))}
          {section(t("Pivots"), "git-branch", pivots, t("No entity a new case could start from."))}
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t">
          <span className="text-sm text-muted-foreground tabular-nums">{t("{n} checked", { n: checked.size })}</span>
          <Button onClick={addChecked} disabled={!checked.size}><ListPlusIcon data-icon="inline-start" />{t("Add to prompt")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
