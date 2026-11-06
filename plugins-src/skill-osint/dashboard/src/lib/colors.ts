import type { Manifest } from "@/lib/api"

// a color per case type, in the order of the manifests (a CSS variable: its light and dark steps follow the theme);
// past the palette's eight hues a type is neutral, its icon and label carry it (never a generated hue)
export function typeColor(typeId: string, types: Pick<Manifest, "id">[]) {
  const i = types.findIndex(t => t.id === typeId)
  return i >= 0 && i < 8 ? `var(--type-${i + 1})` : "var(--muted-foreground)"
}
// a color at a share of its strength over the surface: the tiles' backgrounds
export const tint = (color: string, pct = 15) => `color-mix(in oklch, ${color} ${pct}%, transparent)`
