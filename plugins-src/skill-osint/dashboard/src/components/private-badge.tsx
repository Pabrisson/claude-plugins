import { Icon } from "@/components/icon"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { t } from "@/lib/i18n"
import { TONE } from "@/lib/tones"
import { cn } from "@/lib/utils"

// A case type of the cases folder's own (.osint-types/<id>/): its engine.js is code that runs with the engine's rights
export function PrivateBadge({ id, className }: { id: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("gap-1", className)}><Icon name="lock-keyhole" className="size-3" aria-hidden />{t("Private")}</Badge>
      </TooltipTrigger>
      <TooltipContent>{t("A case type of this cases folder (.osint-types/{id}). Its engine.js runs with the engine's rights.", { id })}</TooltipContent>
    </Tooltip>
  )
}

// A case whose type is not loaded: a private type removed, or refused while it is being edited
export function TypeMissingBadge({ id, className }: { id: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("gap-1 border-amber-500/50", TONE.amber, className)}><Icon name="triangle-alert" className="size-3" aria-hidden />{t("Type missing")}</Badge>
      </TooltipTrigger>
      <TooltipContent>{t("The case type {id} is not loaded: Settings › Types says why.", { id })}</TooltipContent>
    </Tooltip>
  )
}
