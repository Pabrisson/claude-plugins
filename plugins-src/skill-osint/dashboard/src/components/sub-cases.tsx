import { ChevronDownIcon, EllipsisIcon, EyeIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { ExportMenu } from "@/components/export-button"
import { Icon } from "@/components/icon"
import { ConfidenceBadge, LiveDot, StatusBadge } from "@/components/status"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
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
const SHUT = "osint-subcases-shut" // folded or not: this browser's choice
// The sub-cases of an investigation under its head, one row each (indented by depth): type, title, status, phase,
// confidence and answer, live, « N new »; and its own Refresh, Watch, Export ▾ and a menu (its Case.md and its type's
// views, both opened in this page; delete with the cases below it). Folded with a click on its title row.
export function SubCases({ cases, types, now, paused, viewsOf, onOpen, onView, onRefresh, onDeleted }: {
  cases: TreeCase[]; types: Manifest[]; now: number; paused: boolean; viewsOf: (m: Manifest | undefined) => SubView[]
  onOpen: (slug: string) => void; onView: (slug: string, tab: string) => void; onRefresh: (slug: string) => Promise<void>; onDeleted: () => void
}) {
  const [shut, setShutState] = useState(() => { try { return localStorage.getItem(SHUT) === "1" } catch { return false } }), [busy, setBusy] = useState<string | null>(null), [removing, setRemoving] = useState<TreeCase | null>(null)
  if (!cases.length) return null
  // the cases below one: those after it in the list, until one as high as it
  const below = (c: TreeCase) => { let n = 0; for (const x of cases.slice(cases.indexOf(c) + 1)) { if (x.depth <= c.depth) break; n++ } return n }
  const setShut = (f: (s: boolean) => boolean) => setShutState(s => { const v = f(s); try { localStorage.setItem(SHUT, v ? "1" : "0") } catch { /* this visit only */ } return v })
  const refresh = async (slug: string) => { setBusy(slug); await onRefresh(slug); setBusy(null) }
  const remove = (c: TreeCase) => api.remove(c.slug).then(r => { toast.success(t("{title} moved to .trash", { title: c.title }), { description: r.deleted.length > 1 ? t("With the {n} cases below it", { n: r.deleted.length - 1 }) : undefined }); onDeleted() }, e => toast.error(t("Not deleted"), { description: (e as Error).message }))
  return (
    <section aria-label={t("Sub-cases")} className="rounded-xl border bg-muted/20">
      <button type="button" onClick={() => setShut(s => !s)} aria-expanded={!shut} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <Icon name="folder-tree" className="size-3.5" aria-hidden />{t("Sub-cases")}<span className="tabular-nums">{cases.length}</span>
        <span className="flex-1" /><ChevronDownIcon className={cn("size-4 transition-transform", shut && "-rotate-90")} />
      </button>
      {!shut && (
        <ul className="max-h-[min(17rem,30dvh)] divide-y overflow-y-auto border-t">
          {cases.map(c => {
            const ix = c.index, p = ix.props, m = types.find(x => x.id === ix.type), color = typeColor(ix.type, types)
            const phase = m?.phases.find(x => x.id === p.phase)?.label, views = viewsOf(m)
            return (
              <li key={c.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2" style={{ paddingLeft: `${0.75 + (c.depth - 1) * 1.5}rem` }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: tint(color), color }} title={m?.label ?? ix.type}><Icon name={m?.icon ?? "circle-help"} className="size-4" aria-hidden /></span>
                <button type="button" onClick={() => onOpen(c.slug)} className="min-w-40 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className="truncate hover:underline">{c.title}</span>
                    {isLive(ix.last, now) && <span className="text-sky-500" title={t("Live: an event less than a minute ago")}><LiveDot /></span>}
                    {ix.counts.new > 0 && <Badge className={cn("gap-1", TONE.sky)}><span className="size-1.5 rounded-full bg-current" aria-hidden />{t("{n} new", { n: ix.counts.new })}</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{m?.label ?? ix.type}{p.answer ? <> · <span className="text-foreground">{String(p.answer)}</span></> : p.question ? ` · ${String(p.question)}` : ""}</span>
                </button>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={String(p.status ?? "")} />
                  {phase && p.status !== "done" && <Badge variant="outline">{phase}</Badge>}
                  {typeof p.confidence === "string" && <ConfidenceBadge value={p.confidence} />}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {m && (
                    <Button variant="outline" size="xs" onClick={() => refresh(c.slug)} disabled={busy === c.slug}>
                      {busy === c.slug ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}{t("Refresh")}
                    </Button>
                  )}
                  {m && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="xs"><EyeIcon data-icon="inline-start" />{ix.watch ? t("Watched · {every}", { every: ix.watch.every }) : t("Watch")}</Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-80">
                        <PopoverHeader><PopoverTitle>{t("Watch {title}", { title: c.title })}</PopoverTitle><PopoverDescription>{t("Its refresh again on a period, by itself.")}</PopoverDescription></PopoverHeader>
                        <WatchControl slug={c.slug} manifest={m} watch={ix.watch} paused={paused} />
                      </PopoverContent>
                    </Popover>
                  )}
                  <ExportMenu slug={c.slug} index={ix} small />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t("More for {title}", { title: c.title })}><EllipsisIcon /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-52">
                      <DropdownMenuItem onSelect={() => onOpen(c.slug)}><Icon name="briefcase" />{t("Open its Case note")}</DropdownMenuItem>
                      {views.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>{t("Its views")}</DropdownMenuLabel></>}
                      {views.map(v => <DropdownMenuItem key={v.id} onSelect={() => onView(c.slug, v.id)}><Icon name={v.icon} />{v.label}</DropdownMenuItem>)}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(c)}><Trash2Icon />{t("Delete sub-case")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </li>
            )
          })}
        </ul>
      )}
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
    </section>
  )
}
