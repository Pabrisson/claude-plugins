import { ChevronDownIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { ExportMenu } from "@/components/export-button"
import { Icon } from "@/components/icon"
import { ConfidenceBadge, LiveDot, STATUS, StatusBadge } from "@/components/status"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { WatchControl } from "@/components/watch-control"
import { api, type Manifest } from "@/lib/api"
import { tint, typeColor } from "@/lib/colors"
import { isLive } from "@/lib/format"
import { t } from "@/lib/i18n"
import { TONE } from "@/lib/tones"
import type { TreeCase } from "@/lib/tree"
import { cn } from "@/lib/utils"

export type SubView = { id: string; icon: string; label: string }
const MAX = 4 // chips shown before « +N »
const CHIP = "inline-flex h-7 max-w-72 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted"
// The sub-cases of an investigation on its head's Watch line, one chip each in tree order (« ↳ » below a sub-case): type,
// title, status, live, « N new ». A chip opens its panel: answer, status, phase, confidence, its own Refresh, Export ▾
// and Watch, its Case note and its type's views (opened in this page), delete with the cases below it.
export function SubCases({ cases, types, now, paused, viewsOf, onOpen, onView, onRefresh, onDeleted }: {
  cases: TreeCase[]; types: Manifest[]; now: number; paused: boolean; viewsOf: (m: Manifest | undefined) => SubView[]
  onOpen: (slug: string) => void; onView: (slug: string, tab: string) => void; onRefresh: (slug: string) => Promise<void>; onDeleted: () => void
}) {
  const [all, setAll] = useState(false), [busy, setBusy] = useState<string | null>(null), [removing, setRemoving] = useState<TreeCase | null>(null), [open, setOpen] = useState<string | null>(null)
  if (!cases.length) return null
  // the cases below one: those after it in the list, until one as high as it
  const below = (c: TreeCase) => { let n = 0; for (const x of cases.slice(cases.indexOf(c) + 1)) { if (x.depth <= c.depth) break; n++ } return n }
  const refresh = async (slug: string) => { setBusy(slug); await onRefresh(slug); setBusy(null) }
  const remove = (c: TreeCase) => api.remove(c.slug).then(r => { toast.success(t("{title} moved to .trash", { title: c.title }), { description: r.deleted.length > 1 ? t("With the {n} cases below it", { n: r.deleted.length - 1 }) : undefined }); onDeleted() }, e => toast.error(t("Not deleted"), { description: (e as Error).message }))
  const go = (f: () => void) => { setOpen(null); f() }
  const chip = (c: TreeCase) => {
    const ix = c.index, p = ix.props, m = types.find(x => x.id === ix.type), color = typeColor(ix.type, types), st = STATUS[String(p.status ?? "")] ?? STATUS.draft
    const phase = m?.phases.find(x => x.id === p.phase)?.label, views = viewsOf(m), up = c.depth > 1 ? cases.find(x => x.slug === c.parent) : undefined
    return (
      <Popover key={c.slug} open={open === c.slug} onOpenChange={o => setOpen(o ? c.slug : null)}>
        <PopoverTrigger asChild>
          <button type="button" className={CHIP} title={`${c.title} · ${m?.label ?? ix.type} · ${t(st.label)}`}>
            {up && <span className="text-muted-foreground" aria-hidden>↳</span>}
            <Icon name={m?.icon ?? "circle-help"} className="size-3.5 shrink-0" style={{ color }} aria-hidden />
            <span className="truncate">{c.title}</span>
            {busy === c.slug ? <Spinner className="size-3" /> : p.status === "running" || isLive(ix.last, now)
              ? <span className="text-sky-500"><LiveDot /></span>
              : <span className={cn("grid size-4 shrink-0 place-items-center rounded-full", TONE[st.tone])}><Icon name={st.icon} className="size-2.5" aria-hidden /></span>}
            <span className="sr-only">{t(st.label)}</span>
            {ix.counts.new > 0 && <Badge className={cn("h-4 px-1.5 text-[11px]", TONE.sky)}>{t("{n} new", { n: ix.counts.new })}</Badge>}
            <ChevronDownIcon className="size-3 shrink-0 opacity-60" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
          <div className="flex items-start gap-3 p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: tint(color), color }}><Icon name={m?.icon ?? "circle-help"} className="size-4" aria-hidden /></span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <button type="button" onClick={() => go(() => onOpen(c.slug))} className="rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">{c.title}</button>
              <span className="text-xs text-muted-foreground">{m?.label ?? ix.type}{up ? ` · ${t("under {title}", { title: up.title })}` : ""}</span>
              {p.answer || p.question ? <span className={cn("text-xs", p.answer ? "text-foreground" : "text-muted-foreground")}>{String(p.answer || p.question)}</span> : null}
              <span className="flex flex-wrap items-center gap-1.5 pt-1">
                <StatusBadge status={String(p.status ?? "")} />
                {phase && p.status !== "done" && <Badge variant="outline">{phase}</Badge>}
                {typeof p.confidence === "string" && <ConfidenceBadge value={p.confidence} />}
              </span>
            </div>
          </div>
          {m && (
            <div className="flex flex-col gap-3 border-t p-3">
              <span className="flex flex-wrap items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={() => refresh(c.slug)} disabled={busy === c.slug}>
                  {busy === c.slug ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}{t("Refresh")}
                </Button>
                <ExportMenu slug={c.slug} index={ix} small />
              </span>
              <WatchControl slug={c.slug} manifest={m} watch={ix.watch} paused={paused} compact />
            </div>
          )}
          <div className="flex flex-col border-t p-1">
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => go(() => onOpen(c.slug))}><Icon name="briefcase" data-icon="inline-start" />{t("Open its Case note")}</Button>
            {views.map(v => <Button key={v.id} variant="ghost" size="sm" className="justify-start" onClick={() => go(() => onView(c.slug, v.id))}><Icon name={v.icon} data-icon="inline-start" />{v.label}</Button>)}
            <Button variant="ghost" size="sm" className="justify-start text-destructive hover:text-destructive" onClick={() => go(() => setRemoving(c))}><Trash2Icon data-icon="inline-start" />{t("Delete sub-case")}</Button>
          </div>
        </PopoverContent>
      </Popover>
    )
  }
  const hidden = cases.length - MAX
  return (
    <div role="group" aria-label={t("Sub-cases")} className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon name="folder-tree" className="size-3.5" aria-hidden />{t("Sub-cases")}</span>
      {(all || hidden <= 0 ? cases : cases.slice(0, MAX)).map(chip)}
      {hidden > 0 && <button type="button" className={cn(CHIP, "text-muted-foreground")} aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? t("Fewer") : t("+{n}", { n: hidden })}</button>}
      <AlertDialog open={!!removing} onOpenChange={o => { if (!o) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete {title}?", { title: removing?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{!removing || !below(removing) ? t("The case moves to .trash in the cases folder.") : t(below(removing) === 1 ? "The case and its sub-case move to .trash in the cases folder." : "The case and its {n} sub-cases move to .trash in the cases folder.", { n: below(removing) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => removing && remove(removing)}>{t("Delete sub-case")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
