import { cn } from "@/lib/utils"

// the official DPE colors, A to G, on the arrow shape of the label
const COLOR: Record<string, string> = {
  A: "bg-[#009c6d] text-white", B: "bg-[#52b153] text-black", C: "bg-[#a5cc74] text-black", D: "bg-[#f4e70f] text-black",
  E: "bg-[#f0b40f] text-black", F: "bg-[#eb8235] text-black", G: "bg-[#d7221f] text-white",
}

export function Dpe({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className={cn("text-xs text-muted-foreground", className)} title="DPE inconnu">DPE ?</span>
  return (
    <span className={cn("inline-grid h-5 w-6 place-items-center rounded-l-sm rounded-r-[10px] text-xs font-bold", COLOR[value], className)} title={`DPE ${value}`}>
      {value}
    </span>
  )
}
