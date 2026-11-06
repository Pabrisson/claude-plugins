import { EVERY, watchSteps } from "@engine/watch-rules.js"
import { EyeIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Chips } from "@/components/chips"
import { Icon } from "@/components/icon"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Every, type Manifest, type Watch, type WatchState } from "@/lib/api"
import { exact, useNow, when } from "@/lib/format"
import { t } from "@/lib/i18n"
import { TONE } from "@/lib/tones"
import { useHomeEvents } from "@/lib/use-events"
import { cn } from "@/lib/utils"

// the folder's watch settings and watched cases, reloaded when a case changes (the server republishes its summary)
export function useWatchState() {
  const [state, setState] = useState<WatchState | null>(null)
  const load = useCallback(() => api.watch().then(setState, () => {}), [])
  useEffect(() => { load() }, [load])
  useHomeEvents(useCallback(() => { load() }, [load]))
  return { state, load }
}

export const STOPS = "No agent and no other watched case: this dashboard server stops in a few seconds. Ask the agent to open the dashboard again."
const NOTHING = "Nothing in this case type can be watched: its refresh steps are noisy, send an image, cost or need the agent"

// « Last: 2 hours ago · Next: in 22 hours », the exact time on hover; a failed last pass in an amber tile
export function WatchTimes({ watch, now, className }: { watch: Watch; now: number; className?: string }) {
  const time = (label: string, iso: string | null, empty: string) => (
    <Tooltip>
      <TooltipTrigger asChild><span className="cursor-default underline decoration-dotted underline-offset-2">{t(label, { when: iso ? when(iso, now) : t(empty) })}</span></TooltipTrigger>
      <TooltipContent>{iso ? exact(iso) : t("No pass yet")}</TooltipContent>
    </Tooltip>
  )
  return (
    <span className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      {time("Last: {when}", watch.last, "never")}<span aria-hidden>·</span>{time("Next: {when}", watch.next, "soon")}
      {watch.error && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("inline-flex size-5 items-center justify-center rounded-md", TONE.amber)} role="img" aria-label={t("Last pass failed: {error}", { error: watch.error })}><Icon name="triangle-alert" className="size-3.5" aria-hidden /></span>
          </TooltipTrigger>
          <TooltipContent className="max-w-80">{t("Last pass failed: {error}", { error: watch.error })}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}

// A case's Watch: a switch, its period as chips and its last and next pass. The state shown is the prop's: the page
// follows the case's stream, nothing local can drift from the file.
export function WatchControl({ slug, manifest, watch, paused, compact }: { slug: string; manifest: Manifest | undefined; watch: Watch | null; paused: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false), now = useNow()
  const can = !!manifest && watchSteps(manifest).length > 0
  async function set(every: Every | "off") {
    setBusy(true)
    try {
      const r = await api.setWatch(slug, every)
      if (r.stops) toast.warning(t("The dashboard server stops"), { description: t(STOPS) })
    } catch (e) { toast.error(t("Watch not changed"), { description: (e as Error).message }) }
    setBusy(false)
  }
  const sw = (
    <label className="inline-flex items-center gap-2 text-sm font-medium">
      <Switch size="sm" checked={!!watch} disabled={busy || !can} onCheckedChange={on => set(on ? watch?.every ?? "24h" : "off")} aria-label={t("Watch")} />
      <EyeIcon className="size-4 text-muted-foreground" aria-hidden />{t("Watch")}
    </label>
  )
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", compact && "gap-y-1")}>
      {can ? sw : (
        <Tooltip>
          <TooltipTrigger asChild><span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">{sw}</span></TooltipTrigger>
          <TooltipContent className="max-w-72">{t(NOTHING)}</TooltipContent>
        </Tooltip>
      )}
      {watch && <Chips label={t("Watch period")} size="xs" value={watch.every} disabled={busy} onChange={v => v !== watch.every && set(v as Every)} options={EVERY.map(o => ({ ...o, label: t(o.label) }))} className="gap-1" />}
      {watch && paused && (
        <Tooltip>
          <TooltipTrigger asChild><Badge asChild className={cn("gap-1", TONE.amber)}><a href="#/settings"><Icon name="pause" aria-hidden />{t("Paused in Settings")}</a></Badge></TooltipTrigger>
          <TooltipContent>{t("The folder's Watch switch is off: no pass runs, this case keeps its period")}</TooltipContent>
        </Tooltip>
      )}
      {watch && !compact && <WatchTimes watch={watch} now={now} className="basis-full" />}
    </div>
  )
}
export type { WatchState }
