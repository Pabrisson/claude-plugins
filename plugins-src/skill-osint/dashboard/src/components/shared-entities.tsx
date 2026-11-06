import { KINDS } from "@engine/kinds.js"
import { FilterIcon } from "lucide-react"

import { Icon } from "@/components/icon"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import type { SharedEntity } from "@/lib/api"
import { t } from "@/lib/i18n"
import { caseHref } from "@/lib/route"
import { cn } from "@/lib/utils"

// called at render: the label in the dashboard's language
export const kindOf = (k: string) => { const m = (KINDS as Record<string, { icon: string; color: string; label: string }>)[k]; return m ? { ...m, label: t(m.label) } : { icon: "circle", color: "var(--muted-foreground)", label: k } }

// The entities found in two investigations or more: a click on one keeps the cards of its cases; its case chips open the
// entity's note in that case.
export function SharedEntities({ list, titles, active, onPick }: { list: SharedEntity[] | null; titles: Record<string, string>; active: string | null; onPick: (e: SharedEntity) => void }) {
  if (!list) return <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14" />)}</div>
  if (!list.length) return (
    <Empty className="border border-dashed p-6">
      <EmptyHeader><EmptyTitle className="text-sm">{t("Nothing shared yet")}</EmptyTitle><EmptyDescription>{t("An entity found in two investigations shows here.")}</EmptyDescription></EmptyHeader>
    </Empty>
  )
  return (
    <ul className="flex flex-col gap-1">
      {list.map(e => {
        const k = kindOf(e.kind)
        return (
          <li key={e.key} className={cn("rounded-lg p-2 transition-colors hover:bg-muted/60", active === e.key && "bg-muted")}>
            <button type="button" onClick={() => onPick(e)} className="flex w-full min-w-0 items-center gap-2 rounded-md text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" title={t("Show the cases of {value}", { value: e.value })} aria-pressed={active === e.key}>
              <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklch, ${k.color} 18%, transparent)`, color: k.color }}><Icon name={k.icon} className="size-3.5" aria-hidden /></span>
              <span className="min-w-0 flex-1 truncate font-medium">{e.value}</span>
              <span className="sr-only">{k.label}</span>
              <FilterIcon className={cn("size-3.5 shrink-0 text-muted-foreground", active !== e.key && "opacity-0")} aria-hidden />
            </button>
            <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
              {e.cases.map(c => (
                <a key={c.slug} href={caseHref(c.slug, "brain", c.path)} className="inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-1.5 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground">
                  <Icon name="folder-open" className="size-3 shrink-0" aria-hidden /><span className="truncate">{titles[c.slug] ?? c.slug}</span>
                </a>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
