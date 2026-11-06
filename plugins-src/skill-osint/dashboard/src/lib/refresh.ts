import { toast } from "sonner"
import { itemOf } from "@engine/prompt.js"

import { api } from "@/lib/api"
import { addToStored, inCase, type Item } from "@/lib/basket"
import { t } from "@/lib/i18n"
import { caseHref, go } from "@/lib/route"

export type RefreshCase = { slug: string; type: string; private?: boolean; parent?: string | null }
// one case's Refresh: the engine's steps run here (a local edit); a private type's engine.js is code from the cases
// folder that the dashboard never runs (the Agent reads it first): a [refresh] item instead
async function once(c: RefreshCase) {
  if (c.private) return { items: [itemOf("[refresh]")], added: 0, removed: 0, changed: 0, first: false, skipped: [] as string[], agentOnly: true }
  const r = await api.refresh(c.slug), real = r.diffs.filter(d => !d.first), n = (k: "added" | "removed" | "changed") => real.reduce((s, d) => s + d[k].length, 0)
  return { items: r.agent.map(a => itemOf(a.prompt)), added: n("added"), removed: n("removed"), changed: n("changed"), first: !real.length, skipped: r.skipped ?? [], agentOnly: false }
}

// Refresh of a case, or of a whole investigation (its top case first, then each sub-case; a person case's own Refresh
// already runs the cases below it). The toast sums up what changed; the agent's steps go to the top case's prompt,
// a sub-case's marked with its case (the page's basket, or the case's own from the home page, with « Open case »)
export async function runRefresh(slug: string, add?: (i: Item) => void, agentOnly = false, cases?: RefreshCase[]) {
  const list = cases ?? [{ slug, type: "", private: agentOnly }]
  const person = new Set(list.filter(c => c.type === "person").map(c => c.slug)), byParent = new Map(list.map(c => [c.slug, c.parent ?? null]))
  const under = (s: string) => { for (let p = byParent.get(s); p; p = byParent.get(p)) if (person.has(p)) return true; return false }
  const todo = list.filter(c => !under(c.slug))
  const items: Item[] = [], sum = { added: 0, removed: 0, changed: 0 }, skipped: string[] = []
  let first = true, onlyAgent = true, failed: string | null = null
  try {
    for (const c of todo) {
      const r = await once(c)
      items.push(...r.items.map(i => (c.slug === slug ? i : inCase(i, c.slug))))
      sum.added += r.added; sum.removed += r.removed; sum.changed += r.changed
      skipped.push(...r.skipped.map(s => (c.slug === slug ? s : `${s} (${c.slug})`)))
      first &&= r.first; onlyAgent &&= r.agentOnly
    }
  } catch (e) { failed = (e as Error).message }
  if (add) items.forEach(add)
  else addToStored({ slug }, items)
  if (failed) return void toast.error(t("Refresh failed"), { description: failed })
  const open = add ? undefined : { label: t("Open case"), onClick: () => go(caseHref(slug)) }
  if (onlyAgent) return void toast.success(t("Refresh added to the case's prompt"), { description: t("This type's engine.js runs only through the Agent, who reads it first."), action: open })
  toast.success(t("{added} added, {removed} removed, {changed} changed", sum), {
    description: [
      todo.length > 1 ? t("{n} cases refreshed", { n: todo.length }) : undefined,
      items.length ? t(items.length > 1 ? "{n} agent steps added to the case's prompt" : "{n} agent step added to the case's prompt", { n: items.length }) : first ? t("First collection: the next Refresh compares with it") : undefined,
      skipped.length ? t("Noisy, left for the agent (it needs your yes): {list}", { list: skipped.join(", ") }) : undefined,
    ].filter(Boolean).join(". ") || undefined,
    action: open,
  })
}
