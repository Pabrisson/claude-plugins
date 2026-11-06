import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ListChecksIcon, RefreshCwIcon } from "lucide-react"
import { useState, type ReactNode } from "react"

import { AskAgent } from "@/components/home"
import { Icon } from "@/components/icon"
import { ExportMenu } from "@/components/export-button"
import { PrivateBadge, TypeMissingBadge } from "@/components/private-badge"
import { CONFIDENCE, ConfidenceBadge, LiveDot, StatusBadge } from "@/components/status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { useWatchState, WatchControl } from "@/components/watch-control"
import type { CaseIndex, Manifest } from "@/lib/api"
import { tint } from "@/lib/colors"
import { isLive } from "@/lib/format"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// The case's head: its type, title, status and live dot, the phases as steps, the confidence (each level and its
// criteria on hover), Refresh, Next actions, Ask Agent, Export ▾ (Export PDF, Print view, Open in Obsidian), and on a
// second row Watch (its switch, period and last and next pass) then children (the sub-cases' chips). With sub-cases,
// Refresh ▾ refreshes the whole investigation or one of its cases, and Next actions covers them all.
export function CaseHeader({ index, m, color, now, onRefresh, refreshing, onNext, cases = [], onRefreshOne, children }: {
  index: CaseIndex; m: Manifest | undefined; color: string; now: number; onRefresh: () => void; refreshing: boolean; onNext: () => void
  cases?: { slug: string; title: string; icon: string; depth: number }[]; onRefreshOne?: (slug: string) => void; children?: ReactNode
}) {
  const p = index.props, title = index.notes.find(n => n.path === "Case.md")?.title ?? index.slug
  const { state } = useWatchState()
  const phases = m?.phases ?? [], cur = phases.findIndex(x => x.id === p.phase), done = p.status === "done"
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" size="icon-sm" asChild><a href="#/" aria-label={t("All cases")}><ArrowLeftIcon /></a></Button>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: tint(color), color }} title={m?.label ?? index.type}><Icon name={m?.icon ?? "circle-help"} className="size-4.5" aria-hidden /></span>
        <div className="min-w-40 flex-1">
          <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="truncate">{title}</span>
            {isLive(index.last, now) && <span className="text-sky-500" title={t("Live: an event less than a minute ago")}><LiveDot /></span>}
          </h1>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">{m ? <><span className="shrink-0">{m.label}</span>{m.private && <PrivateBadge id={m.id} className="h-4 px-1.5 text-[11px]" />}</> : <><span className="shrink-0 font-mono">{index.type}</span><TypeMissingBadge id={index.type} className="h-4 px-1.5 text-[11px]" /></>}<span aria-hidden>·</span><span className="truncate">{String(p.question ?? "")}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={String(p.status ?? "")} />
          <Confidence index={index} m={m} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {m && cases.length < 2 && <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>{refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}{t("Refresh")}</Button>}
          {m && cases.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={refreshing}>{refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}{t("Refresh")}<ChevronDownIcon data-icon="inline-end" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-64">
                <DropdownMenuItem onSelect={onRefresh}><Icon name="folder-tree" />{t("Whole investigation")}<span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{t("{n} cases", { n: cases.length })}</span></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("One case")}</DropdownMenuLabel>
                {cases.map(c => (
                  <DropdownMenuItem key={c.slug} onSelect={() => onRefreshOne?.(c.slug)} style={{ paddingLeft: `${0.5 + c.depth * 0.75}rem` }}><Icon name={c.icon} /><span className="truncate">{c.title}</span></DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="sm" onClick={onNext}><ListChecksIcon data-icon="inline-start" />{t("Next actions")}</Button>
          <AskAgent />
          <ExportMenu slug={index.slug} index={index} />
        </div>
      </div>
      {(m || cases.length > 1) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {m && <WatchControl slug={index.slug} manifest={m} watch={index.watch} paused={state ? !state.on : false} />}
          {children}
        </div>
      )}
      {phases.length > 0 && (
        <ol className="relative flex items-center gap-1 overflow-x-auto pb-1" aria-label={t("Phases")}>
          {phases.map((ph, i) => {
            const state = done || i < cur ? "done" : i === cur ? "current" : "next"
            return (
              <li key={ph.id} className="flex shrink-0 items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
                {i > 0 && <span className={cn("h-px w-4 sm:w-6", state === "next" ? "bg-border" : "bg-foreground/40")} aria-hidden />}
                <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs", state === "done" && "text-muted-foreground", state === "current" && "bg-primary font-medium text-primary-foreground", state === "next" && "text-muted-foreground/70 ring-1 ring-border")}>
                  {state === "done" ? <CheckIcon className="size-3" /> : state === "current" ? <span className="size-1.5 rounded-full bg-current" /> : <span className="size-1.5 rounded-full ring-1 ring-current" />}
                  {ph.label}
                  <span className="sr-only">{state === "done" ? t("(done)") : state === "current" ? t("(current)") : t("(to come)")}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function Confidence({ index, m }: { index: CaseIndex; m: Manifest | undefined }) {
  const [open, setOpen] = useState(false)
  const c = index.conclusion, value = String(index.props.confidence ?? "")
  const hover = { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild {...hover}>
        <button type="button" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {CONFIDENCE[value] ? <ConfidenceBadge value={value} named /> : <Badge variant="outline" className="gap-1"><Icon name="shield-question" aria-hidden />{t("Not concluded")}</Badge>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" {...hover}>
        <PopoverHeader>
          <PopoverTitle>{t("Confidence by level")}</PopoverTitle>
          <PopoverDescription>{c ? t("Each level, and the criteria it meets.") : t("Not concluded yet: the confidence comes with the conclusion.")}</PopoverDescription>
        </PopoverHeader>
        {c && (
          <ul className="flex flex-col gap-3 text-sm">
            {Object.entries(c.confidence).map(([level, v]) => (
              <li key={level} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2 font-medium">{m?.levels.find(l => l.id === level)?.label ?? level}<ConfidenceBadge value={v} /></span>
                <span className="text-xs text-muted-foreground">{c.criteria[level]}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
