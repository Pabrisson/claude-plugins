import { cn } from "@/lib/utils"

// the official DPE colors, A to G; A and G take white text, the others black
export const DPE_HEX: Record<string, string> = { A: "#009c6d", B: "#52b153", C: "#a5cc74", D: "#f4e70f", E: "#f0b40f", F: "#eb8235", G: "#d7221f" }
export const dpeInk = (c: string) => ("AG".includes(c) ? "#fff" : "#000")

// a class on the arrow shape of the label
export function Dpe({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className={cn("text-xs text-muted-foreground", className)} title="DPE inconnu">DPE ?</span>
  return (
    <span className={cn("inline-grid h-5 w-6 place-items-center rounded-l-sm rounded-r-[10px] text-xs font-bold", className)} style={{ background: DPE_HEX[value], color: dpeInk(value) }} title={`DPE ${value}`}>
      {value}
    </span>
  )
}
