import { Building2Icon, ClipboardCheckIcon, HammerIcon, LandPlotIcon, type LucideIcon } from "lucide-react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

import { DPE_HEX, dpeInk } from "@/components/dpe"
import type { PermitKind } from "@/lib/api"
import { cn } from "@/lib/utils"

// The badges of the « Prospection » sources, the same on the map, in its column, its legend and the follow-up: an
// energy audit's rounded square in its DPE class's color with a checked clipboard, a permit's disc in its kind's color
// (index.css --permit-*) with a building, a hammer or a plot
export const PERMIT_ICON: Record<PermitKind, LucideIcon> = { build: Building2Icon, demolish: HammerIcon, develop: LandPlotIcon }

// without a class (the legend), in the ink's colors
export function AuditBadge({ energy, className }: { energy?: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded-[4px]", !energy && "bg-foreground text-background", className)} style={energy ? { background: DPE_HEX[energy], color: dpeInk(energy) } : undefined}>
      <ClipboardCheckIcon className="size-[72%]" strokeWidth={2.5} />
    </span>
  )
}

export function PermitBadge({ kind, className }: { kind: PermitKind; className?: string }) {
  const Icon = PERMIT_ICON[kind]
  return (
    <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded-full text-white", className)} style={{ background: `var(--permit-${kind})` }}>
      <Icon className="size-[66%]" strokeWidth={2.5} />
    </span>
  )
}

// The same badges as MapLibre images, drawn once per map (its theme's colors) at twice their size, ringed in `ring`:
// audit-A … audit-G, permit-build, permit-demolish, permit-develop
const SIZE = 22
export async function mapBadges(color: (cssVar: string) => string, ring: string) {
  // out of the effect that asks for them: React renders nothing (flushSync) while it runs one
  await new Promise(ok => setTimeout(ok))
  const draw = async (round: boolean, fill: string, ink: string, Icon: LucideIcon) => {
    // the icon's SVG, rendered once in a detached node; an image needs its namespace, which innerHTML drops and
    // XMLSerializer writes, and its stroke's color in full
    const node = document.createElement("div"), root = createRoot(node)
    flushSync(() => root.render(<Icon strokeWidth={2.5} />))
    const svg = new XMLSerializer().serializeToString(node.firstElementChild!).replaceAll("currentColor", ink)
    root.unmount()
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await img.decode()
    const s = SIZE * 2, g = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d")!
    g.fillStyle = fill
    g.strokeStyle = ring
    g.lineWidth = 3
    g.beginPath()
    if (round) g.arc(s / 2, s / 2, s / 2 - 2, 0, 2 * Math.PI)
    else g.roundRect(2, 2, s - 4, s - 4, 9)
    g.fill()
    g.stroke()
    g.drawImage(img, s * 0.2, s * 0.2, s * 0.6, s * 0.6)
    return g.getImageData(0, 0, s, s)
  }
  const audits = Object.entries(DPE_HEX).map(async ([k, hex]) => [`audit-${k}`, await draw(false, hex, dpeInk(k), ClipboardCheckIcon)] as const)
  const permits = (Object.keys(PERMIT_ICON) as PermitKind[]).map(async k => [`permit-${k}`, await draw(true, color(`--permit-${k}`), "#fff", PERMIT_ICON[k])] as const)
  return Object.fromEntries(await Promise.all([...audits, ...permits]))
}
