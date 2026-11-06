import { Icon } from "@/components/icon"
import { Badge } from "@/components/ui/badge"
import { TONE, type Tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

export const STATUS: Record<string, { label: string; icon: string; tone: Tone }> = {
  draft: { label: "Draft", icon: "file-pen", tone: "neutral" },
  running: { label: "Running", icon: "activity", tone: "sky" },
  done: { label: "Done", icon: "circle-check", tone: "emerald" },
  blocked: { label: "Blocked", icon: "octagon-pause", tone: "amber" },
}
export const CONFIDENCE: Record<string, { label: string; icon: string; tone: Tone }> = {
  high: { label: "High", icon: "shield-check", tone: "emerald" },
  medium: { label: "Medium", icon: "shield", tone: "amber" },
  low: { label: "Low", icon: "shield-alert", tone: "rose" },
}

// a case's status, its color inside the badge; Running carries a pulsing dot
export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = STATUS[status ?? ""] ?? STATUS.draft
  return (
    <Badge className={cn("gap-1", TONE[s.tone], className)}>
      {status === "running" ? <LiveDot /> : <Icon name={s.icon} aria-hidden />}
      {s.label}
    </Badge>
  )
}
export function ConfidenceBadge({ value, className, prefix = "" }: { value: string; className?: string; prefix?: string }) {
  const c = CONFIDENCE[value]
  if (!c) return null
  return <Badge className={cn("gap-1", TONE[c.tone], className)}><Icon name={c.icon} aria-hidden />{prefix}{c.label}</Badge>
}
// the case is live (an event less than a minute old): a dot that pulses
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  )
}
