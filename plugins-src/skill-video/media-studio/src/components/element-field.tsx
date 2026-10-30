import { useState } from "react"
import { ChevronDownIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ELEMENT_TYPES, fileUrl, typeLabel, type Field, type Mentionable } from "@/lib/api"
import { Label } from "@/components/chips"

// an Element of the Library picked for a field (Object swap's new object, Character swap's character): its value is
// @name, which the engine cites like the words' own; its images count among the model's references
export function ElementField({ field: f, value, items, blocked, onChange }: { field: Field; value?: string; items: Mentionable[]; blocked?: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const fits = items.filter((i) => !f.types || f.types.includes(i.type))
  const current = fits.find((i) => `@${i.name}` === value)
  const groups = ELEMENT_TYPES.filter((t) => fits.some((i) => i.type === t.type))
  return (
    <div>
      <Label hint={blocked ?? (current ? `${current.files.length} image${current.files.length > 1 ? "s" : ""} sent` : f.required ? "from the Library" : "optional")}>{f.label}</Label>
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
          <PopoverContent align="start" className="w-80 p-0">
            <Command loop>
              {fits.length > 6 && <CommandInput placeholder="Search the Library" aria-label="Search the Library" />}
              <CommandList className="max-h-80">
                <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {fits.length ? "Nothing matches." : <>No {(f.types ?? []).map(typeLabel).join(" or ").toLowerCase()} in the Library yet: <a href="#library/elements" className="underline underline-offset-2">make one</a>.</>}
                </CommandEmpty>
                {groups.map((g) => (
                  <CommandGroup key={g.type} heading={g.plural}>
                    {fits
                      .filter((i) => i.type === g.type)
                      .map((i) => (
                        <CommandItem key={i.name} value={`${i.name} ${i.words}`} data-checked={`@${i.name}` === value} onSelect={() => (onChange(`@${i.name}`), setOpen(false))}>
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
