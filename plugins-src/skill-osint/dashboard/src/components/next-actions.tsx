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
import { inCase, useBasket, type Item } from "@/lib/basket"
import { t } from "@/lib/i18n"
import type { TreeCase } from "@/lib/tree"

type Pick = { key: string; label: ReactNode; sub?: ReactNode; icon: string; color?: string; item: Item; minutes?: number | null; noisy?: boolean; of: string | null }
const TARGET: Record<string, string> = { case: "On the case", hyp: "On a hypothesis", evidence: "On a piece of evidence" }

// one case's choices: its type's actions on their targets, its open leads, its pivots to a new case (of: a sub-case,
// whose items end with « (case <slug>) » in the prompt)
function picksOf(index: CaseIndex, manifest: Manifest | undefined, types: Manifest[], of: string | null) {
  const notes = index.notes, input = String(index.props.input ?? ""), pre = `${index.slug}|`
  const entities = notes.filter(n => n.folder === "Entities")
  const targets = (a: Action): Pick[] => {
    const base = (key: string, label: ReactNode, vars: Record<string, string>, extra: Partial<Pick> = {}): Pick => ({ key: `${pre}${a.id}|${key}`, label, icon: a.icon, item: itemOf(a.prompt, vars), minutes: a.minutes, noisy: a.noisy, of, ...extra })
    if (a.target === "case") return [base("case", a.label, { value: input })]
    if (a.target === "hyp") return notes.filter(n => n.folder === "Hypotheses" && n.props.status !== "excluded").map(n => base(n.path, a.label, { value: input, hyp: `${n.props.id} ${n.title}` }, { sub: `${n.props.id} ${n.title}` }))
    if (a.target === "evidence") return index.files.filter(f => f.startsWith("Evidence/")).map(f => base(f, a.label, { value: input, file: f }, { sub: f }))
    const kind = a.target.replace(/^entity:/, "")
    return entities.filter(n => n.props.kind === kind).map(n => base(n.path, a.label, { value: String(n.props.value ?? n.title) }, { sub: String(n.props.value ?? n.title), color: kindOf(kind).color }))
  }
  const groups: [string, Pick[]][] = []
  for (const tg of manifest ? [...new Set(manifest.actions.map(a => a.target))] : []) {
    const picks = actionsFor(manifest!, tg).flatMap(targets)
    if (picks.length) groups.push([TARGET[tg] ? t(TARGET[tg]) : t("On {kind} entities", { kind: kindOf(tg.replace(/^entity:/, "")).label.toLowerCase() }), picks])
  }
  const leads: Pick[] = index.leads.filter(l => !l.done).map(l => ({ key: `${pre}lead|${l.id}`, label: l.label, sub: l.why, icon: "signpost", item: itemOf(l.prompt || `[lead:${l.id}] ${l.label}`), minutes: l.minutes, noisy: l.noisy, of }))
  const pivots: Pick[] = entities.flatMap(n => pivotsFor({ kind: String(n.props.kind), value: String(n.props.value ?? n.title), path: n.path, props: n.props }, types)
    .map(p => ({ key: `${pre}pivot|${p.type}|${n.path}`, label: t("New {type} case on {value}", { type: types.find(x => x.id === p.type)?.label ?? p.type, value: String(n.props.value ?? n.title) }), icon: p.icon, color: kindOf(String(n.props.kind)).color, item: p.item, of })))
  return { groups, leads, pivots }
}

// Next actions of the investigation: for its top case, then for each sub-case, the type's actions, the open leads and
// the pivots; the ones checked go to the page's prompt (a sub-case's marked with its case)
export function NextActions({ open, setOpen, cases, types }: { open: boolean; setOpen: (o: boolean) => void; cases: TreeCase[]; types: Manifest[] }) {
  const { add } = useBasket()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const many = cases.length > 1
  const blocks = cases.map((c, i) => { const m = types.find(x => x.id === c.index.type); return { c, m, ...picksOf(c.index, m, types, i ? c.slug : null) } })
  const all = blocks.flatMap(b => [...b.groups.flatMap(([, p]) => p), ...b.leads, ...b.pivots])
  const toggle = (k: string) => setChecked(s => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x })
  const addChecked = () => {
    const picks = all.filter(p => checked.has(p.key))
    picks.forEach(p => add(p.of ? inCase(p.item, p.of) : p.item))
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
  const section = (key: string, title: string, icon: string, picks: Pick[], empty: string) => (!picks.length && !empty ? null : (
    <section key={key} className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Icon name={icon} className="size-3.5" aria-hidden />{title}</h3>
      {picks.length ? <ul className="flex flex-col">{picks.map(row)}</ul> : <p className="px-2 text-xs text-muted-foreground">{empty}</p>}
    </section>
  ))
  // a sub-case says nothing of what it lacks: only what it offers
  const body = (b: (typeof blocks)[number], quiet: boolean) => [
    ...b.groups.map(([title, picks]) => section(`${b.c.slug}|${title}`, t("{type}: {target}", { type: b.m?.label ?? b.c.index.type, target: title.toLowerCase() }), b.m?.icon ?? "circle-help", picks, "")),
    section(`${b.c.slug}|leads`, t("Leads"), "signpost", b.leads, quiet ? "" : t("No open lead.")),
    section(`${b.c.slug}|pivots`, t("Pivots"), "git-branch", b.pivots, quiet ? "" : t("No entity a new case could start from.")),
  ]
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("Next actions")}</SheetTitle>
          <SheetDescription>{many ? t("For the case and each of its sub-cases: check what the agent should do next; « Add to prompt » puts it in the case's prompt.") : t("Check what the agent should do next; « Add to prompt » puts it in the case's prompt.")}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4">
          {!many ? body(blocks[0], false) : blocks.map((b, i) => {
            const n = [...b.groups.flatMap(([, p]) => p), ...b.leads, ...b.pivots].length
            return (
              <div key={b.c.slug} className="flex flex-col gap-3" style={{ paddingLeft: `${Math.max(0, b.c.depth - 1) * 0.75}rem` }}>
                <h2 className="flex items-center gap-2 border-b pb-1.5 text-sm font-semibold">
                  <Icon name={b.m?.icon ?? "circle-help"} className="size-4 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{b.c.title}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">{i ? b.m?.label ?? b.c.index.type : t("Top case")}</span>
                </h2>
                {n ? body(b, true) : <p className="px-2 text-xs text-muted-foreground">{t("Nothing to do here for now.")}</p>}
              </div>
            )
          })}
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t">
          <span className="text-sm text-muted-foreground tabular-nums">{t("{n} checked", { n: checked.size })}</span>
          <Button onClick={addChecked} disabled={!checked.size}><ListPlusIcon data-icon="inline-start" />{t("Add to prompt")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
