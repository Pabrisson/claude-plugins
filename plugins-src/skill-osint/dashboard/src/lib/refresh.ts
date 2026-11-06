import { toast } from "sonner"
import { itemOf } from "@engine/prompt.js"

import { api } from "@/lib/api"
import { addToStored, type Item } from "@/lib/basket"
import { caseHref, go } from "@/lib/route"

// Refresh: the engine's steps run here (a local edit), the toast sums up what changed; the agent's steps go to the
// case's prompt (the page's basket, or the case's own from the home page, with « Open case »)
export async function runRefresh(slug: string, add?: (i: Item) => void, agentOnly = false) {
  // a private type's engine.js is code from the cases folder: the dashboard never runs it, the Agent reads it and does
  if (agentOnly) {
    const item = itemOf("[refresh]")
    if (add) add(item)
    else addToStored({ slug }, [item])
    toast.success("Refresh added to the case's prompt", { description: "This type's engine.js runs only through the Agent, who reads it first.", action: add ? undefined : { label: "Open case", onClick: () => go(caseHref(slug)) } })
    return
  }
  try {
    const r = await api.refresh(slug)
    const real = r.diffs.filter(d => !d.first), n = (k: "added" | "removed" | "changed") => real.reduce((s, d) => s + d[k].length, 0)
    const items = r.agent.map(a => itemOf(a.prompt))
    if (add) items.forEach(add)
    else addToStored({ slug }, items)
    toast.success(`${n("added")} added, ${n("removed")} removed, ${n("changed")} changed`, {
      description: [
        items.length ? `${items.length} agent step${items.length > 1 ? "s" : ""} added to the case's prompt` : real.length ? undefined : "First collection: the next Refresh compares with it",
        r.skipped?.length ? `Noisy, left for the agent (it needs your yes): ${r.skipped.join(", ")}` : undefined,
      ].filter(Boolean).join(". ") || undefined,
      action: add ? undefined : { label: "Open case", onClick: () => go(caseHref(slug)) },
    })
  } catch (e) {
    toast.error("Refresh failed", { description: (e as Error).message })
  }
}
