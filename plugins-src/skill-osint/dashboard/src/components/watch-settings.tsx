import { CopyIcon, PowerIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { useTypes } from "@/components/case-page"
import { Icon } from "@/components/icon"
import { copyText } from "@/components/obsidian-button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { STOPS, useWatchState, WatchControl, WatchTimes } from "@/components/watch-control"
import { api, type CaseSummary, type WatchedCase } from "@/lib/api"
import { tint, typeColor } from "@/lib/colors"
import { useNow } from "@/lib/format"
import { caseHref } from "@/lib/route"
import { markStopped } from "@/lib/use-events"
import { cn } from "@/lib/utils"

// what a pass found: « +3 · −0 · ~1 », or « nothing changed »
const result = (r: WatchedCase["result"]) => (r && r.added + r.removed + r.changed > 0 ? `+${r.added} · −${r.removed} · ~${r.changed}` : "nothing changed")

// Settings › Watch: the folder's switch and notifications, the watched cases with their last and next pass, « Stop server »
export function WatchSettings() {
  const { state, load } = useWatchState(), types = useTypes(), now = useNow()
  const [titles, setTitles] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false)
  useEffect(() => { api.cases().then((cs: CaseSummary[]) => setTitles(Object.fromEntries(cs.map(c => [c.slug, c.title]))), () => {}) }, [state?.cases.length])
  async function patch(p: { on?: boolean; notify?: boolean }) {
    setBusy(true)
    try {
      const s = await api.watchSettings(p)
      if (s.stops) toast.warning("The dashboard server stops", { description: STOPS })
      load()
    } catch (e) { toast.error("Not saved", { description: (e as Error).message }) }
    setBusy(false)
  }
  async function stop() {
    try { await api.stopServer() } catch { /* it may close before it answers */ }
    markStopped()
  }
  // `brew install terminal-notifier`, `sudo apt install libnotify-bin`: the command inside the hint, to copy
  const cmd = state?.click_hint?.match(/(?:brew|sudo apt) install [\w-]+/)?.[0] ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon name="eye" className="size-4" />Watch</CardTitle>
        <CardDescription>The dashboard server runs a watched case's free steps on its period, and tells you what changed.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!state ? <Spinner /> : (
          <>
            <label className="flex items-start gap-3">
              <Switch checked={state.on} disabled={busy} onCheckedChange={on => patch({ on })} aria-label="Watch" className="mt-0.5" />
              <span className="min-w-0 text-sm"><span className="flex items-center gap-1.5 font-medium"><Icon name="eye" className="size-4 text-muted-foreground" aria-hidden />Watch</span>
                <span className="text-muted-foreground">Runs the watched cases' free engine steps on their period. Off: no pass runs, each case keeps its period.</span></span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-3">
                <Switch checked={state.notify} disabled={busy} onCheckedChange={notify => patch({ notify })} aria-label="Desktop notifications" className="mt-0.5" />
                <span className="min-w-0 text-sm"><span className="flex items-center gap-1.5 font-medium"><Icon name="bell" className="size-4 text-muted-foreground" aria-hidden />Desktop notifications</span>
                  <span className="text-muted-foreground">A notification when a pass finds something; a click opens the case.</span></span>
              </label>
              {state.click_hint && (
                <div className="ml-10 flex flex-col gap-1.5 text-xs text-muted-foreground">
                  <p>{state.click_hint}</p>
                  {cmd && (
                    <code className="flex w-fit max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{cmd}
                      <Button variant="ghost" size="icon-xs" aria-label={`Copy: ${cmd}`} onClick={() => copyText(cmd, "Command copied")}><CopyIcon /></Button>
                    </code>
                  )}
                </div>
              )}
            </div>
            <section aria-labelledby="watched" className="flex flex-col gap-2">
              <h3 id="watched" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Watched cases</h3>
              {state.running && <p className="flex items-center gap-2 text-sm"><Spinner />A pass is running</p>}
              {!state.cases.length ? (
                <Empty className="border border-dashed py-6"><EmptyHeader><EmptyTitle>No case is watched</EmptyTitle><EmptyDescription>Turn Watch on in a case's header.</EmptyDescription></EmptyHeader></Empty>
              ) : (
                <ul className="divide-y">
                  {state.cases.map(w => {
                    const m = types?.find(t => t.id === w.type)
                    return (
                      <li key={w.slug} className="flex flex-col gap-1.5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: tint(typeColor(w.type, types ?? [])), color: typeColor(w.type, types ?? []) }} aria-hidden><Icon name={m?.icon ?? "circle-help"} className="size-3.5" /></span>
                          <a href={caseHref(w.slug)} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">{titles[w.slug] ?? w.slug}</a>
                          <span className={cn("shrink-0 text-xs", w.error ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")} title={w.error ? `Last pass failed: ${w.error}` : undefined}>{w.error ? "failed" : result(w.result)}</span>
                        </div>
                        <div className="ml-9.5 flex flex-col gap-1">
                          <WatchControl slug={w.slug} manifest={m} watch={w} paused={!state.on} compact />
                          <WatchTimes watch={w} now={now} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="outline" className="self-start text-destructive hover:text-destructive"><PowerIcon data-icon="inline-start" />Stop server</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop the dashboard server?</AlertDialogTitle>
                  <AlertDialogDescription>The watched cases wait until the next <code>osint.mjs dashboard</code> (ask the agent to open the dashboard) starts it again; a missed pass then runs once.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={stop}>Stop server</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// the whole page once the server is stopped: nothing here calls it again
export function ServerStopped() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="power" className="size-4" />The dashboard server is stopped</CardTitle><CardDescription>Ask the agent to open the OSINT dashboard again.</CardDescription></CardHeader>
      </Card>
    </div>
  )
}
