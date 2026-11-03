import { PlusIcon, TagIcon, XIcon } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, type Listing } from "@/lib/api"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

// The user's free labels (listings.json `labels`, kept through every refresh, read by the agent): a search's labels are
// those its listings carry, each in the color its name picks
const TONES = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
]
const tone = (name: string) => TONES[[...name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7) % TONES.length]

// every label of the search, in alphabetical order
export function useLabels() {
  const { data } = useSearch()
  return useMemo(() => [...new Set(data.listings.flatMap(l => l.labels ?? []))].toSorted((a, b) => a.localeCompare(b, "fr")), [data.listings])
}

export function LabelChip({ name, onRemove, className }: { name: string; onRemove?: () => void; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("max-w-full", tone(name), onRemove && "pr-0.5", className)}>
      <TagIcon data-icon="inline-start" /><span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" aria-label={`Retirer le label ${name}`} onClick={e => { e.stopPropagation(); onRemove() }}
          className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          <XIcon className="size-3" />
        </button>
      )}
    </Badge>
  )
}

// A search field over the search's labels: one ticked or unticked, a new name created. `chosen`: those already on.
export function LabelPicker({ chosen, onPick, children, align = "start" }: { chosen: string[]; onPick: (name: string, on: boolean) => void; children: ReactNode; align?: "start" | "end" }) {
  const all = useLabels(), [q, setQ] = useState(""), name = q.trim().slice(0, 40)
  const known = all.find(x => x.toLowerCase() === name.toLowerCase())
  return (
    <Popover onOpenChange={o => !o && setQ("")}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <Command>
          <CommandInput value={q} onValueChange={setQ} placeholder="Chercher ou créer un label…" maxLength={40} aria-label="Label" />
          <CommandList>
            {!name && <CommandEmpty className="px-3 py-4 text-muted-foreground">Tapez un nom pour créer votre premier label.</CommandEmpty>}
            {all.length > 0 && (
              <CommandGroup>
                {all.map(x => <CommandItem key={x} value={x} data-checked={chosen.includes(x)} onSelect={() => onPick(x, !chosen.includes(x))}><TagIcon />{x}</CommandItem>)}
              </CommandGroup>
            )}
            {name && !known && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`+ ${name}`} onSelect={() => { onPick(name, true); setQ("") }}><PlusIcon />Créer « {name} »</CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// The dossier's labels: each with its ×, « Label » to tick one or create one
export function LabelsEditor({ l }: { l: Listing }) {
  const { slug, reload } = useSearch(), labels = l.labels ?? []
  async function pick(name: string, on: boolean) {
    try {
      await api.listing(slug, l.id, { labels: on ? [...labels, name] : labels.filter(x => x !== name) })
      await reload()
    } catch (e) { toast.error("Label non enregistré", { description: `Détail technique : ${(e as Error).message}` }) }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map(x => <LabelChip key={x} name={x} onRemove={() => pick(x, false)} />)}
      <LabelPicker chosen={labels} onPick={pick}>
        <Button size="xs" variant="outline"><PlusIcon data-icon="inline-start" />Label</Button>
      </LabelPicker>
    </div>
  )
}
