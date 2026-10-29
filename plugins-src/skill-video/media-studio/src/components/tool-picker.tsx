import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fileUrl, mediaKind, outputPath, type Job, type Model, type Tool } from "@/lib/api"
import { ToolIcon } from "@/components/chips"

const needs = (t: Tool) => {
  const req = t.inputs.filter((i) => !i.optional)
  if (!req.length) return ["prompt"]
  const counts = new Map<string, number>()
  for (const i of req) counts.set(i.kind === "sketch" ? "sketch" : i.kind, (counts.get(i.kind) ?? 0) + 1)
  return [...counts].map(([k, n]) => (k === "sketch" ? "a sketch" : `${n} ${k === "media" ? "clip" : k}${n > 1 ? "s" : ""}`))
}

// the user's last result with a tool, as its picture in the list
function lastOutput(tool: Tool, kind: string, media: Job[], home: string) {
  const j = media.find((x) => x.kind === kind && x.tool === tool.id && x.status === "done" && x.outputs.length)
  return j ? outputPath(home, j, j.outputs.find((o) => mediaKind(o) !== "other") ?? j.outputs[0]) : null
}

function Tile({ tool, last }: { tool: Tool; last: string | null }) {
  const k = last ? mediaKind(last) : null
  return (
    <span className="grid size-13 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
      {k === "image" ? (
        <img src={fileUrl(last!)} alt="" className="size-full object-cover" />
      ) : k === "video" ? (
        <video src={fileUrl(last!)} muted preload="metadata" className="size-full object-cover" />
      ) : (
        <ToolIcon name={tool.icon} className="size-5" />
      )}
    </span>
  )
}

// the tool button and its searchable list: groups on the side of each item, inputs, the model it suits, a price
export function ToolPicker({
  kind,
  tools,
  value,
  onPick,
  media,
  home,
  models,
  prices,
  onOpen,
}: {
  kind: string
  tools: Tool[]
  value: Tool
  onPick: (t: Tool) => void
  media: Job[]
  home: string
  models: Model[]
  prices: Record<string, string>
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const groups = [...new Set(tools.map((t) => t.group))]
  const modelName = (id?: string) => (id ? (models.find((m) => m.model === id)?.name ?? id.split("/").pop()) : null)
  const last = lastOutput(value, kind, media, home)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) onOpen()
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="flex w-full items-center gap-3 rounded-xl border bg-card p-2.5 text-left hover:bg-muted/60" aria-label={`Tool: ${value.label}. Change the tool`}>
          {last ? <Tile tool={value} last={last} /> : (
            <span className="grid size-13 shrink-0 place-items-center rounded-lg border bg-muted"><ToolIcon name={value.icon} className="size-5" /></span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{value.label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {value.group} · needs {needs(value).join(", ")}
            </span>
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(640px,calc(100vw-2rem))] p-0">
        <Command loop>
          <CommandInput placeholder="Search tools" aria-label="Search tools" />
          <CommandList className="max-h-[min(520px,70vh)]">
            <CommandEmpty>No tool matches.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g} heading={g}>
                {tools.filter((t) => t.group === g).map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.label} ${t.group} ${t.description}`}
                    onSelect={() => {
                      onPick(t)
                      setOpen(false)
                    }}
                    className="items-center gap-3 py-2"
                    data-checked={t.id === value.id}
                  >
                    <Tile tool={t} last={lastOutput(t, kind, media, home)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t.label}</span>
                      <span className="block text-xs text-muted-foreground">{t.description}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {needs(t).map((n) => (
                          <span key={n} className="rounded border px-1.5 text-[11px] text-muted-foreground">{n}</span>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {t.local === "reframe" ? "local" : t.provider === "elevenlabs" ? "ElevenLabs" : (modelName(t.models?.[0]) ?? "any model")}
                      {prices[t.id] && <span className="block text-[13px] font-semibold text-cost">{prices[t.id]}</span>}
                    </span>
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
