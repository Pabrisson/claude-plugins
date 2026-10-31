import { useState } from "react"
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ELEMENT_TYPES, fileUrl, typeLabel, type Field, type Mentionable } from "@/lib/api"
import { Label } from "@/components/chips"

// the names a field holds: one @name, or several (« @Papi, @Coat ») on a field that takes them
const namesOf = (value?: string) => String(value ?? "").split(/[\s,]+/).filter((x) => x.startsWith("@"))

// Elements of the Library picked for a field (Object swap's « With », Character swap's character): its value is @name,
// or several joined on a multiple field, which the engine cites like the words' own; their images count among the
// model's references
export function ElementField({ field: f, value, items, blocked, onChange }: { field: Field; value?: string; items: Mentionable[]; blocked?: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const fits = items.filter((i) => !f.types || f.types.includes(i.type))
  const picked = namesOf(value).map((n) => fits.find((i) => `@${i.name}` === n)).filter((i): i is Mentionable => !!i)
  const current = f.multiple ? undefined : picked[0]
  const groups = ELEMENT_TYPES.filter((t) => fits.some((i) => i.type === t.type))
  const images = picked.reduce((n, i) => n + i.files.length, 0)
  const pick = (name: string) => {
    if (!f.multiple) return (onChange(name), setOpen(false))
    const now = picked.map((i) => `@${i.name}`)
    onChange((now.includes(name) ? now.filter((n) => n !== name) : [...now, name]).join(", "))
  }
  const list = (
    <PopoverContent align="start" collisionPadding={12} className="flex max-h-(--radix-popover-content-available-height) w-80 flex-col p-0">
      <Command loop className="min-h-0">
        {fits.length > 6 && <CommandInput placeholder="Search the Library" aria-label="Search the Library" />}
        <CommandList className="max-h-80 min-h-0 flex-1">
          <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">
            {fits.length ? "Nothing matches." : <>No {(f.types ?? []).map(typeLabel).join(" or ").toLowerCase()} in the Library yet: <a href="#library/elements" className="underline underline-offset-2">make one</a>.</>}
          </CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g.type} heading={g.plural}>
              {fits
                .filter((i) => i.type === g.type)
                .map((i) => (
                  <CommandItem key={i.name} value={`${i.name} ${i.words}`} data-checked={picked.includes(i)} onSelect={() => pick(`@${i.name}`)}>
                    <img src={fileUrl(i.files[0])} alt="" className="size-8 shrink-0 rounded-md object-cover ring-1 ring-foreground/10" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">@{i.name}</span>
                      {i.words && <span className="block truncate text-xs text-muted-foreground">{i.words}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{i.files.length}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </PopoverContent>
  )
  const hint = blocked ?? (picked.length ? `${images} image${images > 1 ? "s" : ""} sent` : f.required ? "from the Library" : f.multiple ? "one or several, any type" : "optional")
  if (f.multiple)
    return (
      <div>
        <Label hint={hint}>{f.label}</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {picked.map((i) => (
            <span key={i.name} className="flex h-9 max-w-full items-center gap-2 rounded-lg border border-input py-1 pr-1 pl-1 dark:bg-input/30">
              <img src={fileUrl(i.files[0])} alt="" className="size-7 shrink-0 rounded-md object-cover ring-1 ring-foreground/10" />
              <span className="min-w-0">
                <span className="block truncate text-sm leading-tight font-medium">@{i.name}</span>
                <span className="block truncate text-[11px] leading-tight text-muted-foreground">{typeLabel(i.type)}</span>
              </span>
              <button type="button" aria-label={`Remove @${i.name}`} title="Remove" onClick={() => pick(`@${i.name}`)} className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                <XIcon className="size-3.5" />
              </button>
            </span>
          ))}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground data-[state=open]:border-space/60">
                <PlusIcon className="size-4" /> {picked.length ? "Add" : "Pick from the Library"}
              </button>
            </PopoverTrigger>
            {list}
          </Popover>
        </div>
      </div>
    )
  return (
    <div>
      <Label hint={hint}>{f.label}</Label>
      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${f.label}: ${current ? `@${current.name}` : "none"}. Change it`}
              className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-input px-2 text-left shadow-xs transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:border-space/60 dark:bg-input/30 dark:hover:bg-input/50"
            >
              {current ? (
                <img src={fileUrl(current.files[0])} alt="" className="size-8 shrink-0 rounded-md object-cover ring-1 ring-foreground/10" />
              ) : (
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">@</span>
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm font-medium", !current && "text-muted-foreground")}>{current ? `@${current.name}` : `Pick from the Library`}</span>
                <span className="block truncate text-xs text-muted-foreground">{current ? current.words || typeLabel(current.type) : (f.types ?? []).map(typeLabel).join(", ")}</span>
              </span>
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          {list}
        </Popover>
        {current && (
          <button type="button" aria-label={`Clear ${f.label.toLowerCase()}`} title="Clear" onClick={() => onChange("")} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <XIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
