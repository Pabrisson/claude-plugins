import { useState } from "react"
import { CheckIcon, ChevronDownIcon, WrenchIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Job, Kind } from "@/lib/api"

// a result's tool, kept apart by its space (Custom is an image tool and a video tool)
export const toolKey = (j: Job) => `${j.kind}:${j.tool}`
const KINDS: Kind[] = ["image", "video", "audio"]
const SPACE = { image: "Image", video: "Video", audio: "Audio" }

// the results of one tool: the tools of these results, by space, each with how many; "" is all of them. A searchable
// list, as long as the tools are many
export function ToolFilter({ jobs, value, onChange, compact }: { jobs: Job[]; value: string; onChange: (v: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const tools = new Map<string, { kind: Kind; label: string; n: number }>()
  for (const j of jobs) {
    const k = toolKey(j), t = tools.get(k)
    tools.set(k, { kind: j.kind, label: j.label, n: (t?.n ?? 0) + 1 })
  }
  const picked = value ? (tools.get(value) ?? { kind: value.split(":")[0] as Kind, label: value.split(":")[1], n: 0 }) : null
  const groups = KINDS.map((kind) => ({ kind, list: [...tools].filter(([, t]) => t.kind === kind).sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label)) })).filter((g) => g.list.length)
  const one = groups.length === 1
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className={cn("flex min-w-0 items-center", compact ? "" : "w-full")}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Tool: ${picked?.label ?? "all"}. Change it`}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-md border border-input text-left transition-colors hover:bg-muted/40 dark:bg-input/30",
              compact ? "h-7 px-2 text-xs" : "h-9 w-full px-2.5 text-sm",
              picked && "border-space/50 text-space"
            )}
          >
            <WrenchIcon className="size-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{picked ? `${one || compact ? "" : `${SPACE[picked.kind]} · `}${picked.label}` : "All tools"}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        {picked && (
          <button type="button" aria-label="All tools" title="All tools" onClick={() => onChange("")} className="ml-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <XIcon className="size-3.5" />
          </button>
        )}
      </span>
      <PopoverContent align={compact ? "end" : "start"} className="w-72 p-0">
        <Command loop>
          <CommandInput placeholder="Search tools" aria-label="Search tools" />
          <CommandList className="max-h-80">
            <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">No tool matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all tools" data-checked={!value} onSelect={() => (onChange(""), setOpen(false))}>
                <span className="flex-1">All tools</span>
                <Picked on={!value} />
                <CommandShortcut className="ml-0 tracking-normal tabular-nums">{jobs.length}</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            {groups.map((g) => (
              <CommandGroup key={g.kind} heading={one ? undefined : SPACE[g.kind]}>
                {g.list.map(([k, t]) => (
                  <CommandItem key={k} value={`${k} ${t.label}`} data-checked={value === k} onSelect={() => (onChange(k), setOpen(false))}>
                    <span className="min-w-0 flex-1 truncate">{t.label}</span>
                    <Picked on={value === k} />
                    <CommandShortcut className="ml-0 tracking-normal tabular-nums">{t.n}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// the one picked, its check left of its count (a count in a shortcut hides the list's own check, at the far right); the
// place kept on every row so the counts line up
const Picked = ({ on }: { on: boolean }) => <CheckIcon className={cn("size-4", on ? "opacity-100" : "opacity-0")} aria-hidden />
