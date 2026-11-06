import { CornerDownRightIcon, EllipsisIcon, FolderKanbanIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
import { caseDirOf, useObsidian } from "@/components/obsidian-button"
import { PrivateBadge, TypeMissingBadge } from "@/components/private-badge"
import { ConfidenceBadge, LiveDot, StatusBadge } from "@/components/status"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MoveToWorkspace, nameOf, useWorkspaces } from "@/components/workspace-menu"
import { api, fileUrl, type CaseSummary, type Manifest } from "@/lib/api"
import { tint } from "@/lib/colors"
import { t } from "@/lib/i18n"
import { ago, isLive, when, who } from "@/lib/format"
import { runRefresh } from "@/lib/refresh"
import { caseHref } from "@/lib/route"
import { TONE } from "@/lib/tones"
import type { Below } from "@/lib/tree"
import { cn } from "@/lib/utils"

// An investigation on the home page: its top case's type tile, title, confidence and answer; the status, activity,
// counts and « N new » of all its cases; its sub-cases (each opens in the investigation's page); Refresh of all of
// them; a menu (Obsidian, move to a workspace, delete with its sub-cases). The card's title is the link;
// the color lives in the tile and the badges, never in a band on an edge. The thumbnail is a fixed tile beside the
// answer and the footer sits at the bottom: the cards of a row line up, with an image or without.
export function CaseCard({ summary: c, below = [], types = [], type, color, home, titles, now, workspace = "default", showWorkspace }: {
  summary: CaseSummary & { thumbCase?: string }; below?: Below[]; types?: Manifest[]; type: Manifest | undefined; color: string; home: string; titles: Record<string, string>; now: number; workspace?: string; showWorkspace?: boolean
}) {
  const [busy, setBusy] = useState(false), [ask, setAsk] = useState(false)
  const obsidian = useObsidian(), ws = useWorkspaces()
  const live = isLive(c.last, now), phase = type?.phases.find(p => p.id === c.phase)?.label
  const typeOf = (id: string) => types.find(x => x.id === id)
  const refresh = async () => {
    setBusy(true)
    await runRefresh(c.slug, undefined, type?.private, [c, ...below].map(x => ({ slug: x.slug, type: x.type, private: typeOf(x.type)?.private, parent: x.slug === c.slug ? null : x.parent })))
    setBusy(false)
  }
  const remove = () => api.remove(c.slug).then(() => toast.success(t("{title} moved to .trash", { title: c.title })), e => toast.error(t("Not deleted"), { description: (e as Error).message }))
  const activity = c.last && (c.last.kind === "note.write" && c.last.by === "vault" ? t("edited {path}", { path: c.last.path ?? "" }) : c.last.text ?? c.last.kind)
  return (
    <Card size="sm" className="relative transition-colors hover:bg-muted/40 has-[a.stretched:focus-visible]:ring-3 has-[a.stretched:focus-visible]:ring-ring/50">
      <CardHeader className="gap-x-3 has-data-[slot=card-action]:grid-cols-[auto_1fr_auto]">
        <span className="row-span-2 grid size-10 place-items-center rounded-lg" style={{ background: tint(color), color }} aria-hidden>
          <Icon name={type?.icon ?? "circle-help"} className="size-5" />
        </span>
        <CardTitle className="min-w-0 truncate leading-snug">
          <a href={caseHref(c.slug)} className="stretched outline-none after:absolute after:inset-0 after:rounded-xl">{c.title}</a>
        </CardTitle>
        <CardDescription className="flex min-w-0 items-center gap-1.5 truncate text-xs">
          {type ? <span className="shrink-0">{type.label}</span> : <><span className="shrink-0 font-mono">{c.type}</span><TypeMissingBadge id={c.type} className="relative z-10 h-4 px-1.5 text-[11px]" /></>}<span aria-hidden>·</span><span className="truncate font-mono">{c.slug}</span>
        </CardDescription>
        <CardAction className="relative z-10 col-start-3 flex items-center gap-1">
          {showWorkspace && <Badge variant="outline" className="max-w-32 gap-1"><FolderKanbanIcon aria-hidden /><span className="truncate">{nameOf(ws, workspace)}</span></Badge>}
          {c.watch && (
            <Tooltip>
              <TooltipTrigger asChild><Badge variant="outline" className="gap-1"><Icon name="eye" aria-hidden />{t("Watched · {every}", { every: c.watch.every })}</Badge></TooltipTrigger>
              <TooltipContent>{t("Next pass {when}", { when: when(c.watch.next, now) })}</TooltipContent>
            </Tooltip>
          )}
          {c.new > 0 && (
            <Badge className={cn("gap-1", TONE.sky)} role="status" aria-atomic="true">
              <span className="size-1.5 rounded-full bg-current" aria-hidden />{t("{n} new", { n: c.new })}
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("More for {title}", { title: c.title })}><EllipsisIcon /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => obsidian.open(caseDirOf(home, c.slug))}><Icon name="gem" />{t("Open in Obsidian")}</DropdownMenuItem>
                <MoveToWorkspace slug={c.slug} current={workspace} />
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onSelect={() => setAsk(true)}><Trash2Icon />{t("Delete case")}</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={c.status} />
              {type?.private && <PrivateBadge id={type.id} className="relative z-10" />}
              {c.confidence && <ConfidenceBadge value={c.confidence} named />}
              {c.phase && c.status !== "done" && <Badge variant="outline" className={phase ? undefined : "capitalize"}>{phase ?? c.phase}</Badge>}
            </div>
            {c.answer && <p className="line-clamp-3 text-sm">{c.answer}</p>}
          </div>
          {c.thumb && <img src={fileUrl(c.thumbCase ?? c.slug, c.thumb)} alt="" loading="lazy" className="aspect-[4/3] w-24 shrink-0 self-start rounded-md object-cover ring-1 ring-foreground/10 sm:w-28" />}
        </div>
        <p className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", live && "text-foreground")}>
          {live ? <LiveDot className="text-sky-500" /> : <Icon name="activity" className="size-3.5 shrink-0" aria-hidden />}
          {c.last ? (
            <span className="min-w-0 truncate"><span className="font-medium">{t("{who}:", { who: who(c.last) })}</span> {activity}</span>
          ) : <span>{t("No activity yet")}</span>}
          {c.last && <span className="ml-auto shrink-0 tabular-nums">{ago(c.last.t, now)}</span>}
        </p>
      </CardContent>
      <CardFooter className="relative z-10 mt-auto flex-wrap gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1" title={t("Entities")}><Icon name="boxes" className="size-3.5" aria-hidden />{c.counts.entities}<span className="sr-only">{t("entities")}</span></span>
        <span className="flex items-center gap-1" title={t("Sources")}><Icon name="file-text" className="size-3.5" aria-hidden />{c.counts.sources}<span className="sr-only">{t("sources")}</span></span>
        <span className="flex items-center gap-1" title={t("Open leads")}><Icon name="signpost" className="size-3.5" aria-hidden />{c.counts.leads_open}<span className="sr-only">{t("open leads")}</span></span>
        {below.map(k => (
          <a key={k.slug} href={caseHref(k.slug)} className="inline-flex h-6 max-w-44 items-center gap-1 rounded-full border px-2 hover:bg-muted" title={t("Sub-case: {type}", { type: typeOf(k.type)?.label ?? k.type })}>
            {k.depth > 1 && <CornerDownRightIcon className="size-3 shrink-0" aria-hidden />}<Icon name={typeOf(k.type)?.icon ?? "circle-help"} className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{titles[k.slug] ?? k.slug}</span>
          </a>
        ))}
        <span className="flex-1" />
        {type && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" onClick={refresh} disabled={busy}>
                {busy ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}{t("Refresh")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{type.private ? t("This type's engine.js runs only through the Agent: adds a refresh to the case's prompt") : below.length ? t("Refresh the whole investigation: the case and its sub-cases; the agent's steps go to the case's prompt") : t("Run the engine's collection again and show what changed; the agent's steps go to the case's prompt")}</TooltipContent>
          </Tooltip>
        )}
      </CardFooter>
      {obsidian.dialog}
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete {title}?", { title: c.title })}</AlertDialogTitle>
            <AlertDialogDescription>{below.length ? t(below.length === 1 ? "The case and its sub-case move to .trash in the cases folder." : "The case and its {n} sub-cases move to .trash in the cases folder.", { n: below.length }) : t("The case moves to .trash in the cases folder.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>{t("Delete case")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
