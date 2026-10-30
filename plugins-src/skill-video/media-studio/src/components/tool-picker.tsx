import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { type Model, type Tool } from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, ToolIcon } from "@/components/chips"
import { ModelLogo } from "@/components/model-logo"
import { shortName } from "@/components/model-picker"
import { isLocal } from "@/lib/api"

const needs = (t: Tool) => {
  const req = t.inputs.filter((i) => !i.optional)
  if (!req.length) return ["prompt"]
  const counts = new Map<string, number>()
  for (const i of req) counts.set(i.kind === "sketch" ? "sketch" : i.kind, (counts.get(i.kind) ?? 0) + 1)
  return [...counts].map(([k, n]) => (k === "sketch" ? "a sketch" : `${n} ${k === "media" ? "clip" : k}${n > 1 ? "s" : ""}`))
}

// a tool's picture: its icon on the space's color, always (a last result made the list hard to read)
function Tile({ tool }: { tool: Tool }) {
  return (
    <span className="grid size-13 shrink-0 place-items-center rounded-lg border bg-linear-to-br from-space/20 to-space/5 text-space">
      <ToolIcon name={tool.icon} className="size-5" />
    </span>
  )
}

// the tool button and its list, beside the composer like the model's: search, a group at a time, each tool with its
// picture, what it needs, the model it suits and its price
export function ToolPicker({
  tools,
  value,
  onPick,
  models,
  prices,
  onOpen,
}: {
  tools: Tool[]
  value: Tool
  onPick: (t: Tool) => void
  models: Model[]
  prices: Record<string, string>
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState<string | null>(null)
  const groups = [...new Set(tools.map((t) => t.group))]
  const modelOf = (id?: string) => (id ? models.find((m) => m.model === id) : undefined)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) onOpen()
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="flex w-full items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition-colors hover:border-space/40 hover:bg-muted/60" aria-label={`Tool: ${value.label}. Change the tool`}>
          <Tile tool={value} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{value.label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {value.group} · needs {needs(value).join(", ")}
            </span>
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* beside the composer, where the room is, and never taller than the screen: the list scrolls */}
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12} className="flex max-h-(--radix-popover-content-available-height) w-[min(520px,calc(100vw-2rem))] flex-col p-0">
        <Command loop className="min-h-0 flex-1">
          <CommandInput placeholder="Search tools" aria-label="Search tools" />
          {groups.length > 1 && (
            <div className="flex flex-wrap gap-1.5 border-b p-2">
              {groups.map((g) => (
                <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(group === g ? null : g)} className={cn(CHIP, "px-2.5 py-0.5 text-xs", group === g ? CHIP_ON : CHIP_OFF)}>
                  {g}
                </button>
              ))}
            </div>
          )}
          <CommandList className="max-h-[min(620px,80vh)] min-h-0 flex-1">
            <CommandEmpty>No tool matches.</CommandEmpty>
            {groups.filter((g) => !group || g === group).map((g) => (
              <CommandGroup key={g} heading={g}>
                {tools.filter((t) => t.group === g).map((t) => {
                  const m = modelOf(t.models?.[0])
                  return (
                    <CommandItem
                      key={t.id}
                      value={`${t.label} ${t.group} ${t.description}`}
                      onSelect={() => (onPick(t), setOpen(false))}
                      data-checked={t.id === value.id}
                      className="items-start gap-3 py-2.5"
                    >
                      <Tile tool={t} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate font-semibold">{t.label}</span>
                          {prices[t.id] && <span className="ml-auto text-xs font-semibold whitespace-nowrap text-cost tabular-nums">{prices[t.id]}</span>}
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">{t.description}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {needs(t).map((n) => (
                            <Badge key={n} variant="outline" className="font-normal text-muted-foreground">{n}</Badge>
                          ))}
                          <span className="ml-auto flex min-w-0 items-center gap-1.5">
                            {isLocal(t) ? (
                              "Local, free"
                            ) : t.provider === "elevenlabs" ? (
                              "ElevenLabs"
                            ) : m ? (
                              <>
                                <ModelLogo model={m.model} lab={m.lab} className="size-4 rounded-sm bg-transparent p-0" />
                                <span className="truncate">{shortName(m)}</span>
                              </>
                            ) : (
                              "Any model"
                            )}
                          </span>
                        </span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
