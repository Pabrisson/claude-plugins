import { useCallback, useEffect, useRef, useState } from "react"
import { api, type CaseIndex, type OsintEvent } from "@/lib/api"
import { useCaseEvents } from "@/lib/use-events"

// a case's index, live: reloaded after each event (300 ms apart at most), the last 200 events for the activity feed;
// notePulse tells the open note its file changed, views[widget] counts the changes of a widget's data
export function useCase(slug: string) {
  const [index, setIndex] = useState<CaseIndex | null>(null)
  const [events, setEvents] = useState<OsintEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notePulse, setNotePulse] = useState<{ path: string; n: number } | null>(null)
  const [views, setViews] = useState<Record<string, number>>({})
  const timer = useRef<number | undefined>(undefined)
  const load = useCallback(() => api.case(slug).then(ix => { setIndex(ix); setError(null) }, (e: Error) => setError(e.message)), [slug])
  const reload = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(load, 300)
  }, [load])
  useEffect(() => { load() }, [load])
  useCaseEvents(slug, {
    event: e => {
      setEvents(xs => [...xs.slice(-199), e])
      if (e.kind === "note.write" && e.path) setNotePulse(p => ({ path: e.path!, n: (p?.n ?? 0) + 1 }))
      reload()
    },
    view: w => setViews(v => ({ ...v, [w]: (v[w] ?? 0) + 1 })),
    reset: () => { setEvents([]); setNotePulse(p => ({ path: "*", n: (p?.n ?? 0) + 1 })); reload() },
  })
  return { index, events, error, notePulse, views }
}
