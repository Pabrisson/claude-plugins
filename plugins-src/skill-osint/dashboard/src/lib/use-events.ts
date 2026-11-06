import { useEffect, useRef } from "react"
import type { CaseSummary, OsintEvent, Workspaces } from "@/lib/api"

// « Stop server » closed the server: no stream reconnects, no call is made again (components/watch-settings.tsx)
export const STOPPED = "osint-stopped"
export let stopped = false
export const markStopped = () => { stopped = true; dispatchEvent(new Event(STOPPED)) }
const close = (es: EventSource) => addEventListener(STOPPED, () => es.close(), { once: true })

type CaseHandlers = { event?: (e: OsintEvent) => void; view?: (widget: string, of?: string) => void; reset?: () => void }
// a case's live stream: EventSource reconnects by itself and resumes from the last id it got (the server's byte offset)
export function useCaseEvents(slug: string, handlers: CaseHandlers) {
  const ref = useRef(handlers)
  useEffect(() => { ref.current = handlers })
  useEffect(() => {
    const es = new EventSource(`/api/cases/${slug}/events`)
    close(es)
    es.onmessage = m => ref.current.event?.(JSON.parse(m.data))
    es.addEventListener("view", m => { const d = JSON.parse((m as MessageEvent).data); ref.current.view?.(d.widget, d.case) })
    es.addEventListener("reset", () => ref.current.reset?.())
    return () => es.close()
  }, [slug])
}
// the folder's stream, one per page whoever listens: a case's new summary, and the workspaces when they change
type HomeFn = (slug: string, summary: CaseSummary | null) => void
const homeFns = new Set<{ current: HomeFn }>(), wsFns = new Set<{ current: (w: Workspaces) => void }>()
let homeEs: EventSource | null = null
function homeStream() {
  if (homeEs || stopped) return
  homeEs = new EventSource("/api/events")
  close(homeEs)
  homeEs.onmessage = m => { const d = JSON.parse(m.data); homeFns.forEach(f => f.current(d.slug, d.summary)) }
  homeEs.addEventListener("workspaces", m => { const w = JSON.parse((m as MessageEvent).data); wsFns.forEach(f => f.current(w)) })
}
function useStream<T>(set: Set<{ current: T }>, fn: T) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => { homeStream(); set.add(ref); return () => { set.delete(ref) } }, [set])
}
export const useHomeEvents = (fn: HomeFn) => useStream(homeFns, fn)
export const useWorkspaceEvents = (fn: (w: Workspaces) => void) => useStream(wsFns, fn)
