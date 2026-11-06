import { actionsFor, itemOf, pivotsFor } from "@engine/prompt.js"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import type { Manifest } from "@/lib/api"
import { useBasket } from "@/lib/basket"
import { t } from "@/lib/i18n"

// Under an entity's properties: a new case of each installed type that takes its kind, and this type's actions on
// its kind; a click adds the item to the case's prompt
export function PivotButtons({ entity, manifest, types }: { entity: { kind: string; value: string; path: string; props?: Record<string, unknown> }; manifest: Manifest | undefined; types: Manifest[] }) {
  const { add } = useBasket()
  const pivots = pivotsFor(entity, types)
  const actions = manifest ? actionsFor(manifest, `entity:${entity.kind}`) : []
  if (!pivots.length && !actions.length) return null
  const put = (i: { tag: string; text: string }) => { add(i); toast.success(t("Added to the prompt"), { description: `[${i.tag}] ${i.text}` }) }
  return (
    <div className="flex flex-wrap gap-2" aria-label={t("Pivots and actions")}>
      {pivots.map(p => <Button key={p.type} variant="outline" size="sm" onClick={() => put(p.item)}><Icon name={p.icon} data-icon="inline-start" />{t("New {type} case on {value}", { type: types.find(x => x.id === p.type)?.label ?? p.type, value: entity.value })}</Button>)}
      {actions.map(a => <Button key={a.id} variant="outline" size="sm" onClick={() => put(itemOf(a.prompt, { value: entity.value }))}><Icon name={a.icon} data-icon="inline-start" />{a.label}</Button>)}
    </div>
  )
}
