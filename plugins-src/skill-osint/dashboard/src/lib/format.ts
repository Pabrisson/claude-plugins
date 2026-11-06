import { useEffect, useState } from "react"

import type { OsintEvent } from "@/lib/api"
import { getLang, locale, t } from "@/lib/i18n"

// who wrote an event, for a person: never the agent's product name
export const who = (e: Pick<OsintEvent, "by">) => t(({ agent: "Agent", vault: "Vault", dashboard: "Dashboard", watch: "Watch" } as Record<string, string>)[e.by] ?? "Engine")
const rtfs: Record<string, Intl.RelativeTimeFormat> = {}
const rtf = { format: (n: number, unit: Intl.RelativeTimeFormatUnit) => (rtfs[getLang()] ??= new Intl.RelativeTimeFormat(getLang(), { numeric: "auto" })).format(n, unit) }
// « 3 minutes ago », « yesterday »… from an ISO date
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return ""
  const s = Math.min(0, (Date.parse(iso) - now) / 1000) // an event newer than the last tick is « just now »
  for (const [unit, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]] as const)
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit)
  return Math.abs(s) < 10 ? t("just now") : rtf.format(Math.round(s), "second")
}
// « in 22 hours », « tomorrow », or « 3 hours ago » for a time already gone, from an ISO date (the watch's next pass)
export function when(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return ""
  const s = (Date.parse(iso) - now) / 1000
  for (const [unit, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]] as const)
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit)
  return Math.abs(s) < 10 ? t("just now") : rtf.format(Math.round(s), "second")
}
// the exact time, in this machine's zone, for a hover
export const exact = (iso: string) => new Date(iso).toLocaleString(getLang() === "fr" ? "fr-FR" : "en", { dateStyle: "medium", timeStyle: "short" })
export const isLive = (e: OsintEvent | null | undefined, now = Date.now()) => !!e && now - Date.parse(e.t) < 60_000
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })
export const day = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })
export const slugOf = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
// an icon per event kind, for the activity feeds
export const EVENT_ICON: Record<string, string> = {
  "case.new": "folder-plus", "case.status": "flag", "phase.start": "play", "phase.end": "square", log: "message-square", "cmd.start": "terminal",
  "cmd.end": "terminal", progress: "loader", fail: "octagon-x", "note.write": "file-pen", "entity.add": "boxes", "clue.add": "search",
  "source.add": "file-text", "evidence.add": "image", "hyp.add": "lightbulb", "hyp.rank": "scale", "hyp.status": "circle-dot", "lead.add": "signpost",
  "refresh.diff": "refresh-cw", export: "file-down",
}
// a re-render each `ms` (relative times, live dots)
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}
export function useMedia(query: string) {
  const [on, setOn] = useState(() => matchMedia(query).matches)
  useEffect(() => { const m = matchMedia(query), f = () => setOn(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f) }, [query])
  return on
}
