import { StarIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { api, type Listing } from "@/lib/api"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

// the star of a favorite listing, filled and golden
export const Star = ({ on, className }: { on: boolean; className?: string }) => (
  <StarIcon className={cn(on ? "fill-amber-400 text-amber-400" : "text-muted-foreground", className)} />
)

// The user's star on a listing, kept in listings.json (git keeps it, a refresh keeps it, Claude reads it).
// - card: a round button over a card's corner, its empty star shown only when the card (a `group`) is hovered;
// - inline: next to the dossier's price, always shown.
export function FavoriteButton({ l, variant = "card", className }: { l: Listing; variant?: "card" | "inline"; className?: string }) {
  const { slug, reload } = useSearch()
  const on = !!l.favorite, name = on ? "Retirer des favoris" : "Ajouter aux favoris"
  async function toggle() {
    await api.listing(slug, l.id, { favorite: !on })
    await reload()
    toast.success(on ? "Retiré des favoris" : "Ajouté aux favoris")
  }
  return (
    <Button variant="ghost" size={variant === "inline" ? "icon-sm" : "icon-xs"} aria-pressed={on} aria-label={name} title={name} onClick={e => { e.stopPropagation(); toggle() }}
      className={cn(variant === "card" && ["z-10 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background", !on && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"], className)}>
      <Star on={on} className={cn(variant === "inline" && "size-5")} />
    </Button>
  )
}
