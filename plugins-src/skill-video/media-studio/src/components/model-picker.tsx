import { useState } from "react"
import { ChevronDownIcon, SparklesIcon } from "lucide-react"
import { cn } from "cn"

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Kind, Model } from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON } from "@/components/chips"
import { ModelLogo } from "@/components/model-logo"

export type Priced = { label: string; amount: number | null }

const RES = ["360p", "432p", "480p", "540p", "720p", "768p", "1080p", "1440p", "512", "768", "1K", "1.5K", "2K", "4K"]
const rank = (r?: string | null) => (r ? RES.indexOf(r) : -1)
const top = (m: Model) => m.params.resolution?.at(-1)
const longest = (m: Model) => m.params.duration?.at(-1) ?? 0

// a model's name without its lab, which its logo already says
export const shortName = (m: Model) => (m.lab && m.name.startsWith(`${m.lab}: `) ? m.name.slice(m.lab.length + 2) : m.name)

// what a model can do, in a few words
export function capsOf(m: Model) {
  const p = m.params
  return [
    p.duration?.length ? `up to ${p.duration.at(-1)} s` : null,
    p.resolution?.length ? (p.resolution.length > 1 ? `${p.resolution[0]}–${p.resolution.at(-1)}` : p.resolution[0]) : null,
    p.audio ? "sound" : null,
    p.frames?.includes("last_frame") ? "first + last frame" : p.frames?.length ? "first frame" : null,
    p.references ? `${p.references} reference${p.references > 1 ? "s" : ""}` : null,
    p.n && p.n.max > 1 ? `up to ${p.n.max} at once` : null,
    p.voices?.length ? `${p.voices.length} voices` : null,
  ].filter((c): c is string => !!c)
}

// the list's filters: those of a group exclude each other; a filter shows only when it splits the list
type Filter = { id: string; label: string; group?: string; test: (m: Model) => boolean }
const FILTERS: Record<Kind, Filter[]> = {
  video: [
    { id: "d10", group: "length", label: "10 s+", test: (m) => longest(m) >= 10 },
    { id: "d15", group: "length", label: "15 s+", test: (m) => longest(m) >= 15 },
    { id: "d30", group: "length", label: "30 s", test: (m) => longest(m) >= 30 },
    { id: "r1080", group: "res", label: "1080p+", test: (m) => rank(top(m)) >= rank("1080p") },
    { id: "r2k", group: "res", label: "2K+", test: (m) => rank(top(m)) >= rank("2K") },
    { id: "r4k", group: "res", label: "4K", test: (m) => rank(top(m)) >= rank("4K") },
    { id: "sound", label: "Sound", test: (m) => !!m.params.audio },
    { id: "last", label: "Last frame", test: (m) => !!m.params.frames?.includes("last_frame") },
    { id: "seed", label: "Seed", test: (m) => !!m.params.seed },
  ],
  image: [
    { id: "r2k", group: "res", label: "2K+", test: (m) => rank(top(m)) >= rank("2K") },
    { id: "r4k", group: "res", label: "4K", test: (m) => rank(top(m)) >= rank("4K") },
    { id: "refs", label: "References", test: (m) => (m.params.references ?? 0) > 0 },
    { id: "many", label: "Several at once", test: (m) => (m.params.n?.max ?? 1) > 1 },
    { id: "seed", label: "Seed", test: (m) => !!m.params.seed },
  ],
  audio: [
    { id: "voices", label: "20+ voices", test: (m) => (m.params.voices?.length ?? 0) >= 20 },
    { id: "free", label: "No cost", test: (m) => m.model.endsWith(":free") },
  ],
}

// the model button and its searchable list: logos, what each can do, filters, its price on the current settings
export function ModelPicker({
  kind,
  recommended,
  others,
  value,
  onChange,
  prices = {},
  onOpen,
  none,
  label = "Model",
}: {
  kind: Kind
  recommended: Model[]
  others: Model[]
  value: string | null
  onChange: (id: string | null) => void
  prices?: Record<string, Priced>
  onOpen?: () => void
  // the choice of no model, with its words ("The tool's choice")
  none?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [on, setOn] = useState<string[]>([])
  const [cheap, setCheap] = useState(false)
  const all = [...recommended, ...others]
  const model = all.find((m) => m.id === value)
  const filters = FILTERS[kind].filter((f) => { const n = all.filter(f.test).length; return n > 0 && n < all.length })
  const pass = (m: Model) => on.every((id) => filters.find((f) => f.id === id)?.test(m) ?? true)
  const toggle = (f: Filter) =>
    setOn((list) => (list.includes(f.id) ? list.filter((x) => x !== f.id) : [...list.filter((x) => !f.group || filters.find((g) => g.id === x)?.group !== f.group), f.id]))
  const byPrice = (list: Model[]) => (cheap ? list.toSorted((a, b) => (prices[a.id]?.amount ?? Infinity) - (prices[b.id]?.amount ?? Infinity)) : list)
  const groups = cheap
    ? [{ heading: "By price", list: byPrice(all.filter(pass)) }]
    : [
        { heading: recommended.length ? "Recommended" : "", list: recommended.filter(pass) },
        { heading: recommended.length ? "Other models" : "", list: others.filter(pass) },
      ]

  const item = (m: Model) => (
    <CommandItem
      key={m.id}
      value={`${m.name} ${m.model}`}
      data-checked={m.id === value}
      onSelect={() => (onChange(m.id), setOpen(false))}
      className="gap-3 py-2"
    >
      <ModelLogo model={m.model} lab={m.lab} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{shortName(m)}</span>
        <span className="block truncate text-xs text-muted-foreground">{[m.lab, ...capsOf(m)].filter(Boolean).join(" · ")}</span>
      </span>
      {prices[m.id] && <span className="text-xs font-semibold whitespace-nowrap text-cost tabular-nums">{prices[m.id].label}</span>}
    </CommandItem>
  )

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) onOpen?.()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${model ? model.name : none}. Change the model`}
          className="flex h-11 w-full items-center gap-2.5 rounded-md border border-input bg-transparent px-2 text-left text-sm shadow-xs transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          {model ? <ModelLogo model={model.model} lab={model.lab} /> : <span className="grid size-7 place-items-center rounded-md bg-muted"><SparklesIcon className="size-4 text-muted-foreground" /></span>}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{model ? shortName(model) : none}</span>
            {model?.lab && <span className="block truncate text-xs text-muted-foreground">{model.lab}</span>}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* beside the composer, where the room is, and never taller than the screen: the list scrolls, the search and
          filters stay */}
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12} className="flex max-h-(--radix-popover-content-available-height) w-[min(460px,calc(100vw-2rem))] flex-col p-0">
        <Command loop className="min-h-0 flex-1">
          <CommandInput placeholder="Search models" aria-label="Search models" />
          {(filters.length > 0 || Object.keys(prices).length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 border-b p-2">
              {filters.map((f) => (
                <button key={f.id} type="button" aria-pressed={on.includes(f.id)} onClick={() => toggle(f)} className={cn(CHIP, "px-2.5 py-0.5 text-xs", on.includes(f.id) ? CHIP_ON : CHIP_OFF)}>
                  {f.label}
                </button>
              ))}
              <span className="flex-1" />
              {Object.keys(prices).length > 0 && (
                <button type="button" aria-pressed={cheap} onClick={() => setCheap(!cheap)} className={cn(CHIP, "px-2.5 py-0.5 text-xs", cheap ? CHIP_ON : CHIP_OFF)}>
                  Cheapest first
                </button>
              )}
            </div>
          )}
          <CommandList className="max-h-[min(560px,75vh)] min-h-0 flex-1">
            <CommandEmpty>No model matches.</CommandEmpty>
            {none && !on.length && (
              <CommandGroup>
                <CommandItem value={none} data-checked={!value} onSelect={() => (onChange(null), setOpen(false))} className="gap-3 py-2">
                  <span className="grid size-7 place-items-center rounded-md bg-muted"><SparklesIcon className="size-4 text-muted-foreground" /></span>
                  <span className="flex-1 font-medium">{none}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((g, i) => (g.list.length ? <CommandGroup key={i} heading={g.heading || undefined}>{g.list.map(item)}</CommandGroup> : null))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
