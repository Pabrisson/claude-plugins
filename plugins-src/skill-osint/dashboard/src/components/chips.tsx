import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

export type ChipOption = { value: string; label: string; icon: string; count?: number; title?: string }
type Props = { options: ChipOption[]; label?: string; size?: "sm" | "xs"; className?: string; disabled?: boolean } & (
  | { multiple?: false; value: string | null; onChange: (v: string) => void }
  | { multiple: true; value: string[]; onChange: (v: string[]) => void }
)
// A row of chips, each with its icon before its label: one choice (a radio group) or several (a group of toggles).
// Active = filled; never a colored band on an edge.
export function Chips(p: Props) {
  const on = (v: string) => (p.multiple ? p.value.includes(v) : p.value === v)
  const pick = (v: string) => {
    if (p.multiple) p.onChange(on(v) ? p.value.filter(x => x !== v) : [...p.value, v])
    else p.onChange(v)
  }
  return (
    <div role={p.multiple ? "group" : "radiogroup"} aria-label={p.label} className={cn("flex flex-wrap gap-1.5", p.className)}>
      {p.options.map(o => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={p.disabled}
          role={p.multiple ? undefined : "radio"}
          aria-checked={p.multiple ? undefined : on(o.value)}
          aria-pressed={p.multiple ? on(o.value) : undefined}
          onClick={() => pick(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            p.size === "xs" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs",
            on(o.value) ? "border-transparent bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted dark:bg-input/30 dark:hover:bg-input/50",
          )}
        >
          <Icon name={o.icon} className="size-3.5 shrink-0" aria-hidden />
          {o.label}
          {o.count != null && <span className={cn("tabular-nums", on(o.value) ? "opacity-70" : "text-muted-foreground")}>{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
