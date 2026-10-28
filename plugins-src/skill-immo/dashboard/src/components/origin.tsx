import { PencilIcon, PlugZapIcon, SparklesIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { Listing } from "@/lib/api"
import { date, ORIGIN } from "@/lib/format"
import { cn } from "@/lib/utils"

// Where a listing was found: the paid API, Claude (a page it read, a text the user pasted), or the user's own typing.
// - badge: « API », « Claude » or « Vous » on a card or a table row, the detail on hover;
// - line: the dossier's « Trouvée par l'API Stream Estate le … », with the day this search first saw it.
export function Origin({ l, variant = "badge", className }: { l: Listing; variant?: "badge" | "line"; className?: string }) {
  const o = ORIGIN[l.source], Icon = l.source === "stream-estate" ? PlugZapIcon : l.source === "manual" ? PencilIcon : SparklesIcon
  if (variant === "line") return <p className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", className)}><Icon className="size-4" />{o.long} le {date(l.first_seen)}</p>
  return (
    <Badge variant="outline" className={cn("h-4 px-1.5 text-[10px] text-muted-foreground", className)} title={o.long}>
      <Icon data-icon="inline-start" />{o.short}
    </Badge>
  )
}
