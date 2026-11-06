import { CornerDownRightIcon, CornerLeftUpIcon, EllipsisIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
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
import { api, fileUrl, type CaseSummary, type Manifest } from "@/lib/api"
import { tint } from "@/lib/colors"
import { ago, isLive, when, who } from "@/lib/format"
import { runRefresh } from "@/lib/refresh"
import { caseHref } from "@/lib/route"
import { TONE } from "@/lib/tones"
import { cn } from "@/lib/utils"

// A case on the home page: its type's tile, title, status and confidence, the live activity line, the thumbnail, the
// counts, its parent and children, « N new », Refresh, and a menu (Obsidian, delete). The card's title is the link;
// the color lives in the tile and the badges, never in a band on an edge.
export function CaseCard({ summary: c, type, color, home, titles, now }: { summary: CaseSummary; type: Manifest | undefined; color: string; home: string; titles: Record<string, string>; now: number }) {
  const [busy, setBusy] = useState(false), [ask, setAsk] = useState(false)
  const obsidian = useObsidian()
  const live = isLive(c.last, now)
  const refresh = async () => { setBusy(true); await runRefresh(c.slug, undefined, type?.private); setBusy(false) }
  const remove = () => api.remove(c.slug).then(() => toast.success(`${c.title} moved to .trash`), e => toast.error("Not deleted", { description: (e as Error).message }))
  const activity = c.last && (c.last.kind === "note.write" && c.last.by === "vault" ? `edited ${c.last.path}` : c.last.text ?? c.last.kind)
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
          {c.watch && (
            <Tooltip>
              <TooltipTrigger asChild><Badge variant="outline" className="gap-1"><Icon name="eye" aria-hidden />Watched · {c.watch.every}</Badge></TooltipTrigger>
              <TooltipContent>Next pass {when(c.watch.next, now)}</TooltipContent>
            </Tooltip>
          )}
          {c.new > 0 && (
            <Badge className={cn("gap-1", TONE.sky)} role="status" aria-atomic="true">
              <span className="size-1.5 rounded-full bg-current" aria-hidden />{c.new} new
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${c.title}`}><EllipsisIcon /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => obsidian.open(caseDirOf(home, c.slug))}><Icon name="gem" />Open in Obsidian</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onSelect={() => setAsk(true)}><Trash2Icon />Delete case</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={c.status} />
          {type?.private && <PrivateBadge id={type.id} className="relative z-10" />}
          {c.confidence && <ConfidenceBadge value={c.confidence} prefix="Confidence " />}
          {c.phase && c.status !== "done" && <Badge variant="outline" className="capitalize">{c.phase}</Badge>}
        </div>
        {c.answer && <p className="line-clamp-2 text-sm">{c.answer}</p>}
        {c.thumb && <img src={fileUrl(c.slug, c.thumb)} alt="" loading="lazy" className="aspect-video w-full rounded-md object-cover" />}
        <p className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", live && "text-foreground")}>
          {live ? <LiveDot className="text-sky-500" /> : <Icon name="activity" className="size-3.5 shrink-0" aria-hidden />}
          {c.last ? (
            <span className="min-w-0 truncate"><span className="font-medium">{who(c.last)}:</span> {activity}</span>
          ) : <span>No activity yet</span>}
          {c.last && <span className="ml-auto shrink-0 tabular-nums">{ago(c.last.t, now)}</span>}
        </p>
      </CardContent>
      <CardFooter className="relative z-10 flex-wrap gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1" title="Entities"><Icon name="boxes" className="size-3.5" aria-hidden />{c.counts.entities}<span className="sr-only">entities</span></span>
        <span className="flex items-center gap-1" title="Sources"><Icon name="file-text" className="size-3.5" aria-hidden />{c.counts.sources}<span className="sr-only">sources</span></span>
        <span className="flex items-center gap-1" title="Open leads"><Icon name="signpost" className="size-3.5" aria-hidden />{c.counts.leads_open}<span className="sr-only">open leads</span></span>
        {c.parent && (
          <a href={caseHref(c.parent)} className="inline-flex h-6 max-w-40 items-center gap-1 rounded-full border px-2 hover:bg-muted" title="Parent case">
            <CornerLeftUpIcon className="size-3.5 shrink-0" /><span className="truncate">{titles[c.parent] ?? c.parent}</span>
          </a>
        )}
        {c.children.map(k => (
          <a key={k} href={caseHref(k)} className="inline-flex h-6 max-w-40 items-center gap-1 rounded-full border px-2 hover:bg-muted" title="Child case">
            <CornerDownRightIcon className="size-3.5 shrink-0" /><span className="truncate">{titles[k] ?? k}</span>
          </a>
        ))}
        <span className="flex-1" />
        {type && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" onClick={refresh} disabled={busy}>
                {busy ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}Refresh
              </Button>
            </TooltipTrigger>
            <TooltipContent>{type.private ? "This type's engine.js runs only through the Agent: adds a refresh to the case's prompt" : "Run the engine's collection again and show what changed; the agent's steps go to the case's prompt"}</TooltipContent>
          </Tooltip>
        )}
      </CardFooter>
      {obsidian.dialog}
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {c.title}?</AlertDialogTitle>
            <AlertDialogDescription>The case moves to .trash in the cases folder.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>Delete case</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
