import type { CSSProperties } from "react"

import { Badge } from "@/components/ui/badge"
import type { Status } from "@/lib/api"
import { STATUS_LABEL } from "@/lib/format"
import { cn } from "@/lib/utils"

// the color of the user's status (index.css), the same in every tab
export const statusColor = (s: Status) => (s ? `var(--status-${s})` : null)
// a thin band on the left edge of a row, without moving its content
export const statusBand = (s: Status): CSSProperties => (s ? { boxShadow: `inset 3px 0 0 ${statusColor(s)}` } : {})
// a card's background in its status' color, a little of it on a base halfway between the card and the page: a dark
// tint in the dark theme, a pale one in the light theme, a bit more on hover. Without a status, the card's own.
export const statusTint = (s: Status) => (s ? ({ "--tint": statusColor(s) } as CSSProperties) : {})
export const tint = (s: Status) => (s
  ? "bg-[color-mix(in_oklab,var(--tint)_14%,color-mix(in_oklab,var(--card),var(--background)))] hover:bg-[color-mix(in_oklab,var(--tint)_20%,color-mix(in_oklab,var(--card),var(--background)))] transition-colors"
  : "bg-card hover:bg-accent transition-colors")

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return status ? <i aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: statusColor(status)! }} /> : null
}

export function StatusBadge({ status }: { status: Status }) {
  return status ? <Badge variant="secondary"><StatusDot status={status} />{STATUS_LABEL[status]}</Badge> : null
}
