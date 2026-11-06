import { toast } from "sonner"
import { itemOf } from "@engine/prompt.js"

import { api } from "@/lib/api"
import { addToStored, type Item } from "@/lib/basket"
import { t } from "@/lib/i18n"
import { caseHref, go } from "@/lib/route"

// Refresh: the engine's steps run here (a local edit), the toast sums up what changed; the agent's steps go to the
// case's prompt (the page's basket, or the case's own from the home page, with « Open case »)
export async function runRefresh(slug: string, add?: (i: Item) => void, agentOnly = false) {
  // a private type's engine.js is code from the cases folder: the dashboard never runs it, the Agent reads it and does
  if (agentOnly) {
    const item = itemOf("[refresh]")
    if (add) add(item)
    else addToStored({ slug }, [item])
    toast.success(t("Refresh added to the case's prompt"), { description: t("This type's engine.js runs only through the Agent, who reads it first."), action: add ? undefined : { label: t("Open case"), onClick: () => go(caseHref(slug)) } })
    return
  }
  try {
    const r = await api.refresh(slug)
    const real = r.diffs.filter(d => !d.first), n = (k: "added" | "removed" | "changed") => real.reduce((s, d) => s + d[k].length, 0)
    const items = r.agent.map(a => itemOf(a.prompt))
    if (add) items.forEach(add)
    else addToStored({ slug }, items)
    toast.success(t("{added} added, {removed} removed, {changed} changed", { added: n("added"), removed: n("removed"), changed: n("changed") }), {
      description: [
        items.length ? t(items.length > 1 ? "{n} agent steps added to the case's prompt" : "{n} agent step added to the case's prompt", { n: items.length }) : real.length ? undefined : t("First collection: the next Refresh compares with it"),
        r.skipped?.length ? t("Noisy, left for the agent (it needs your yes): {list}", { list: r.skipped.join(", ") }) : undefined,
      ].filter(Boolean).join(". ") || undefined,
      action: add ? undefined : { label: t("Open case"), onClick: () => go(caseHref(slug)) },
    })
  } catch (e) {
    toast.error(t("Refresh failed"), { description: (e as Error).message })
  }
}
