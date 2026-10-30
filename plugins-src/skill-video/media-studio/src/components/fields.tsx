import { useRef, useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { opt, sentence, shown, type Field, type Tool } from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, Chips, Label } from "@/components/chips"
import { colorWords } from "@/components/light-rig"

// a multi field's value: its moves in order, joined the way the prompt says them
const THEN = ", then "

// a list opens beside the composer, whatever the column of its button: the gap from the button to the composer's edge
function useBeside() {
  const ref = useRef<HTMLButtonElement>(null)
  const [offset, setOffset] = useState(8)
  const measure = () => {
    const b = ref.current, aside = b?.closest("aside")
    if (b && aside) setOffset(aside.getBoundingClientRect().right - b.getBoundingClientRect().right + 8)
  }
  return [ref, offset, measure] as const
}

// the fields in the order of the catalog, those of one section together under its heading
export function sections(fields: Field[]) {
  const out: { section?: string; fields: Field[] }[] = []
  for (const f of fields) {
    const last = out.at(-1)
    if (last && f.section && last.section === f.section) last.fields.push(f)
    else out.push({ section: f.section, fields: [f] })
  }
  return out
}

// one field: chips for a few values, a rich select, ordered moves, a slider, a color or words
export function FieldInput({ field: f, value, onChange, tile }: { field: Field; value?: string; onChange: (v: string) => void; tile?: boolean }) {
  const v = value ?? (f.default != null ? String(f.default) : "")
  if (f.type === "select") return <RichSelect field={f} value={v} onChange={onChange} tile={tile} />
  if (f.type === "multi") return <Moves field={f} value={v} onChange={onChange} />
  if (f.type === "sheets") return <Sheets field={f} value={v} onChange={onChange} />
  return (
    <div>
      <Label>{f.label}</Label>
      {f.type === "choice" ? (
        <Chips options={(f.options ?? []).map((o) => opt(o).value)} value={v} onChange={onChange} label={(o) => shown(f, o)} />
      ) : f.type === "number" ? (
        <div className="flex items-center gap-3">
          <Slider min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1} value={[Number(v)]} onValueChange={([n]) => onChange(String(n))} aria-label={f.label} />
          <span className="w-12 text-right text-sm tabular-nums">
            {v}
            {f.unit ?? ""}
          </span>
        </div>
      ) : f.type === "color" ? (
        <div className="flex items-center gap-2">
          <input type="color" value={v || "#ffffff"} onChange={(e) => onChange(e.target.value)} aria-label={f.label} className="h-9 w-14 cursor-pointer rounded-md border bg-transparent" />
          <span className="text-sm text-muted-foreground tabular-nums">{v}</span>
        </div>
      ) : (
        <Input value={value ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

// a References tool's sheets: each picked one is a job and an image of its own, at its ratio; the first sets the look
function Sheets({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const options = (f.options ?? []).map(opt)
  const on = value.split(",").map((x) => x.trim().toLowerCase())
  const toggle = (label: string) => {
    const next = options.filter((o) => (o.label === label ? !on.includes(label.toLowerCase()) : on.includes(o.label.toLowerCase())))
    onChange(next.map((o) => o.label).join(", "))
  }
  const count = options.filter((o) => on.includes(o.label.toLowerCase())).length
  return (
    <div>
      <Label hint={count > 1 ? `${count} images, the first sets the look` : count === 1 ? "1 image" : undefined}>{f.label}</Label>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => {
          const picked = on.includes(o.label.toLowerCase())
          const [w, h] = (o.ratio ?? "1:1").split(":").map(Number)
          return (
            <button
              key={o.label}
              type="button"
              aria-pressed={picked}
              onClick={() => toggle(o.label)}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                picked ? "border-space/50 bg-space/10" : "hover:bg-muted/60"
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center" aria-hidden>
                <span className={cn("rounded-[3px] border-2", picked ? "border-space" : "border-muted-foreground/50")} style={{ width: w >= h ? 28 : (28 * w) / h, height: h >= w ? 28 : (28 * h) / w }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", picked && "font-medium text-space")}>{o.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{o.note}</span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{o.ratio}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// a long list of values as a button that opens beside the composer: searchable, grouped, a line on what each does.
// In a section it is a tile (its label, its value, its group), alone a full-width row
function RichSelect({ field: f, value, onChange, tile, hint }: { field: Field; value: string; onChange: (v: string) => void; tile?: boolean; hint?: string }) {
  const [open, setOpen] = useState(false)
  const [anchor, offset, measure] = useBeside()
  const options = (f.options ?? []).map(opt)
  const current = options.find((o) => o.value === value)
  const groups = [...new Set(options.map((o) => o.group ?? ""))]
  const button = (
    <button
      ref={anchor}
      type="button"
      aria-label={`${f.label}: ${shown(f, value)}. Change it`}
      className={cn(
        "flex w-full min-w-0 flex-col items-start rounded-lg border border-input bg-transparent text-left shadow-xs transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:border-space/60 dark:bg-input/30 dark:hover:bg-input/50",
        tile ? "gap-0.5 px-3 py-2" : "h-10 justify-center px-3"
      )}
    >
      {tile && <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{f.label}</span>}
      <span className={cn("w-full truncate text-sm font-medium", !value && "text-muted-foreground")}>{shown(f, value)}</span>
      {tile && <span className="w-full truncate text-xs text-muted-foreground">{(value && current?.group) || current?.note || " "}</span>}
    </button>
  )
  return (
    <div className="min-w-0">
      {!tile && <Label hint={hint}>{f.label}</Label>}
      <Popover open={open} onOpenChange={(o) => (o && measure(), setOpen(o))}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={offset} collisionPadding={12} className="flex max-h-(--radix-popover-content-available-height) w-80 flex-col p-0">
          <Command loop className="min-h-0 flex-1">
            {options.length > 8 && <CommandInput placeholder={`Search ${f.label.toLowerCase()}`} aria-label={`Search ${f.label.toLowerCase()}`} />}
            <CommandList className="max-h-[min(480px,70vh)] min-h-0 flex-1">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g} heading={g || undefined}>
                  {options
                    .filter((o) => (o.group ?? "") === g)
                    .map((o) => (
                      <CommandItem key={o.value} value={`${o.label} ${o.note ?? ""}`} data-checked={o.value === value} onSelect={() => (onChange(o.value), setOpen(false))} className="py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{sentence(o.label) || "Auto"}</span>
                          {o.note && <span className="block truncate text-xs text-muted-foreground">{o.note}</span>}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// several values in the order they were picked (camera moves): numbered chips, × takes one out, + adds from the list
function Moves({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [anchor, offset, measure] = useBeside()
  const options = (f.options ?? []).map(opt)
  const picked = value ? value.split(THEN) : []
  const groups = [...new Set(options.map((o) => o.group ?? ""))]
  const set = (list: string[]) => onChange(list.join(THEN))
  return (
    <div className="col-span-2">
      <Label hint="several, in order">{f.label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {picked.map((m, i) => (
          <span key={`${m}-${i}`} className={cn(CHIP, CHIP_ON, "flex items-center gap-1.5 py-0.5 pr-1 pl-1")}>
            <span className="grid size-5 place-items-center rounded-full bg-space text-[11px] font-semibold text-space-foreground tabular-nums">{i + 1}</span>
            {sentence(shown(f, m))}
            <button type="button" aria-label={`Remove ${shown(f, m)}`} onClick={() => set(picked.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded-full hover:bg-space/20">
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <Popover open={open} onOpenChange={(o) => (o && measure(), setOpen(o))}>
          <PopoverTrigger asChild>
            <button ref={anchor} type="button" className={cn(CHIP, CHIP_OFF, "flex items-center gap-1 border-dashed")}>
              <PlusIcon className="size-3.5" /> {picked.length ? "Then" : "Add a move"}
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" sideOffset={offset} collisionPadding={12} className="flex max-h-(--radix-popover-content-available-height) w-72 flex-col p-0">
            <Command loop className="min-h-0 flex-1">
              <CommandInput placeholder="Search moves" aria-label="Search camera moves" />
              <CommandList className="max-h-[min(480px,70vh)] min-h-0 flex-1">
                <CommandEmpty>No such move.</CommandEmpty>
                {groups.map((g) => (
                  <CommandGroup key={g} heading={g || undefined}>
                    {options
                      .filter((o) => (o.group ?? "") === g)
                      .map((o) => (
                        <CommandItem key={o.value} value={o.label} onSelect={() => (set([...picked, o.value]), setOpen(false))}>
                          <span className="flex-1">{sentence(o.label)}</span>
                          {picked.includes(o.value) && <span className="text-xs text-space tabular-nums">#{picked.indexOf(o.value) + 1}</span>}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

// a tool's setups, a searchable list grouped by genre: one pick sets every field a setup can touch (those it leaves
// out back to their default), so the one the fields match shows as picked; any change after makes it « Your own »
export function Setups({ tool, fields, onPick }: { tool: Tool; fields: Record<string, string>; onPick: (f: Record<string, string>) => void }) {
  const presets = tool.presets!
  const keys = [...new Set(presets.flatMap((p) => Object.keys(p.fields)))]
  const all = (p: (typeof presets)[number]) => Object.fromEntries(keys.map((k) => [k, p.fields[k] ?? String(tool.fields.find((f) => f.key === k)?.default ?? "")]))
  const value = (k: string) => fields[k] ?? String(tool.fields.find((f) => f.key === k)?.default ?? "")
  const on = presets.find((p) => Object.entries(all(p)).every(([k, v]) => value(k) === v))
  const field: Field = {
    key: "setup",
    label: "Setup",
    type: "select",
    options: [{ value: "", label: "Your own", note: "The fields below, as you set them" }, ...presets.map((p) => ({ value: p.label, label: p.label, group: p.group, note: p.note }))],
  }
  return (
    <RichSelect
      field={field}
      hint="sets the whole rig at once"
      value={on?.label ?? ""}
      onChange={(label) => {
        const p = presets.find((x) => x.label === label)
        if (p) onPick(all(p))
      }}
    />
  )
}

// Recolor's items, each a thing of the video and its new color: « the jacket becomes pale yellow (#f5e663) »; the rows
// themselves ride along in fields["<key>:rows"]
type Row = { item: string; color: string }
export function Recolors({ field: f, fields, onChange }: { field: Field; fields: Record<string, string>; onChange: (patch: Record<string, string>) => void }) {
  let rows: Row[] = []
  try {
    rows = JSON.parse(fields[`${f.key}:rows`] ?? "[]")
  } catch {
    /* none yet */
  }
  const save = (next: Row[]) =>
    onChange({ [f.key]: next.filter((r) => r.item.trim()).map((r) => `${r.item.trim()} becomes ${colorWords(r.color)}`).join("; "), [`${f.key}:rows`]: JSON.stringify(next) })
  const put = (i: number, patch: Partial<Row>) => save(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div>
      <Label hint={`up to ${f.max ?? 3}`}>{f.label}</Label>
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input value={r.item} placeholder={["the jacket", "the car", "the walls"][i] ?? "the item"} aria-label={`Item ${i + 1}`} onChange={(e) => put(i, { item: e.target.value })} className="min-w-0 flex-1" />
            <span className="shrink-0 text-xs text-muted-foreground">becomes</span>
            <label className="relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground tabular-nums hover:bg-muted">
              <span className="size-4 rounded-full ring-1 ring-foreground/20" style={{ background: r.color }} />
              {colorWords(r.color).replace(/ \(.*/, "")}
              <input type="color" value={r.color} onChange={(e) => put(i, { color: e.target.value })} aria-label={`Color of item ${i + 1}`} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => save(rows.filter((_, j) => j !== i))} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <XIcon className="size-4" />
            </button>
          </div>
        ))}
        {rows.length < (f.max ?? 3) && (
          <button type="button" onClick={() => save([...rows, { item: "", color: ["#f5c518", "#e63946", "#2a9d8f"][rows.length] ?? "#ffffff" }])} className={cn(CHIP, CHIP_OFF, "flex w-fit items-center gap-1 border-dashed")}>
            <PlusIcon className="size-3.5" /> {rows.length ? "Another item" : "Recolor an item"}
          </button>
        )}
      </div>
    </div>
  )
}
