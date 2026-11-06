import { useEffect, useRef } from "react"
import type { CaseSummary, OsintEvent } from "@/lib/api"

// « Stop server » closed the server: no stream reconnects, no call is made again (components/watch-settings.tsx)
export const STOPPED = "osint-stopped"
export let stopped = false
export const markStopped = () => { stopped = true; dispatchEvent(new Event(STOPPED)) }
const close = (es: EventSource) => addEventListener(STOPPED, () => es.close(), { once: true })

type CaseHandlers = { event?: (e: OsintEvent) => void; view?: (widget: string) => void; reset?: () => void }
// a case's live stream: EventSource reconnects by itself and resumes from the last id it got (the server's byte offset)
export function useCaseEvents(slug: string, handlers: CaseHandlers) {
  const ref = useRef(handlers)
  useEffect(() => { ref.current = handlers })
  useEffect(() => {
    const es = new EventSource(`/api/cases/${slug}/events`)
    close(es)
    es.onmessage = m => ref.current.event?.(JSON.parse(m.data))
    es.addEventListener("view", m => ref.current.view?.(JSON.parse((m as MessageEvent).data).widget))
    es.addEventListener("reset", () => ref.current.reset?.())
    return () => es.close()
  }, [slug])
}
export function useHomeEvents(fn: (slug: string, summary: CaseSummary | null) => void) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => {
    const es = new EventSource("/api/events")
    close(es)
    es.onmessage = m => { const d = JSON.parse(m.data); ref.current(d.slug, d.summary) }
    return () => es.close()
  }, [])
}
