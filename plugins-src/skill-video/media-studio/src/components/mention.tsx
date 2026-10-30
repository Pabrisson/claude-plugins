import { useEffect, useRef, useState } from "react"
import { cn } from "cn"

import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cited, ELEMENT_TYPES, fileUrl, typeLabel, type Mentionable } from "@/lib/api"

// the picker's groups, in the Library's order (a voice is picked as Audio's voice)
const GROUPS = ELEMENT_TYPES.filter((t) => t.type !== "voice").map((t) => ({ type: t.type, heading: t.plural }))

// the @ just typed before the caret, and what follows it
const typing = (el: HTMLTextAreaElement) => {
  const caret = el.selectionStart, m = el.value.slice(0, caret).match(/(?:^|[^\w@])@([\w-]*)$/)
  return m && el.selectionStart === el.selectionEnd ? { start: caret - m[1].length - 1, query: m[1] } : null
}

// the prompt's words: typing @ opens the Library's Elements, filtered as it goes, the highlighted one shown large; Enter
// or Tab writes @name. Each one cited shows as a badge in the words, drawn behind the textarea (its own text stays on top,
// so the caret, undo and paste are the browser's, and whatever changes the words redraws them)
export function MentionTextarea({
  value,
  onChange,
  items,
  first = [],
  firstLabel,
  blocked,
  className,
  ...props
}: Omit<React.ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string
  onChange: (v: string) => void
  items: Mentionable[]
  // the names listed first, under their own heading (the current workspace's Elements)
  first?: string[]
  firstLabel?: string
  // why nothing can be cited on this model (it takes no reference image, a frame is set)
  blocked?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState("")
  const q = at?.query.toLowerCase() ?? ""
  // the names that start with the words first, then those that hold them
  const found = items
    .filter((i) => `${i.name} ${i.words}`.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
  const groups = [
    { type: "first", heading: firstLabel ? `In ${firstLabel}` : "First", items: found.filter((i) => first.includes(i.name)) },
    ...GROUPS.map((g) => ({ ...g, items: found.filter((i) => i.type === g.type && !first.includes(i.name)) })),
  ].filter((g) => g.items.length)
  const order = groups.flatMap((g) => g.items)
  const shown = order.find((i) => i.name === active) ?? order[0]
  const images = cited(value, items).reduce((n, i) => n + i.files.length, 0)
  const known = new Set(items.map((i) => i.name))

  useEffect(() => {
    list.current?.querySelector("[data-selected=true]")?.scrollIntoView({ block: "nearest" })
  }, [shown?.name])
  // the badges scroll with the words (a long prompt, a paste that grows it)
  useEffect(() => {
    if (back.current && ref.current) back.current.scrollTop = ref.current.scrollTop
  }, [value])

  const look = () => ref.current && setAt(typing(ref.current))
  function write(name: string) {
    const el = ref.current
    if (!el || !at || blocked) return
    const rest = value.slice(el.selectionStart).replace(/^[\w-]*/, "")
    const before = `${value.slice(0, at.start)}@${name} `
    onChange(before + rest.replace(/^ /, ""))
    setAt(null)
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(before.length, before.length)))
  }

  return (
    <>
      <div className="relative w-full">
        {/* the same box, font and wrapping as the textarea: only the badges show */}
        <div
          ref={back}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden px-2.5 py-2 text-base break-words whitespace-pre-wrap text-transparent [scrollbar-gutter:stable] md:text-sm",
            className
          )}
        >
          {value.split(/(@[\w-]+)/g).map((part, i) =>
            part.startsWith("@") && known.has(part.slice(1)) ? (
              <mark key={i} className={cn("rounded-[4px] text-transparent ring-2 box-decoration-clone", blocked ? "bg-destructive/20 ring-destructive/20" : "bg-space/25 ring-space/25")}>
                {part}
              </mark>
            ) : (
              part
            )
          )}
          {"​"}
        </div>
        <Popover open={!!at} onOpenChange={(o) => !o && setAt(null)}>
          <PopoverAnchor asChild>
            <InputGroupTextarea
              ref={ref}
              value={value}
              className={cn("relative [scrollbar-gutter:stable]", className)}
              onChange={(e) => (onChange(e.target.value), setAt(typing(e.target)))}
              onScroll={(e) => back.current && (back.current.scrollTop = e.currentTarget.scrollTop)}
              onClick={look}
              onKeyUp={(e) => ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && look()}
              onBlur={() => setTimeout(() => !list.current?.contains(document.activeElement) && setAt(null), 120)}
              onKeyDown={(e) => {
                if (!at) return
                if (e.key === "Escape") return (e.preventDefault(), e.stopPropagation(), setAt(null))
                if (!order.length) return
                const i = Math.max(0, order.indexOf(shown!))
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault()
                  setActive(order[(i + (e.key === "ArrowDown" ? 1 : order.length - 1)) % order.length].name)
                } else if ((e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey && !blocked) {
                  e.preventDefault()
                  write(shown!.name)
                }
              }}
              aria-autocomplete="list"
              aria-expanded={!!at}
              {...props}
            />
          </PopoverAnchor>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={6}
            className="w-[min(560px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.target === ref.current && e.preventDefault()}
          >
            {blocked && <p className="border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{blocked}</p>}
            <div className="grid grid-cols-[1fr_210px]">
              <Command shouldFilter={false} value={shown?.name ?? ""} onValueChange={setActive} className="rounded-none!">
                <CommandList ref={list} className="max-h-80">
                  <CommandEmpty className="px-4 text-muted-foreground">
                    {items.length ? `No element named “${at?.query}”.` : "No element yet: make your characters, outfits, objects and places in Library › Elements."}
                  </CommandEmpty>
                  {groups.map((g) => (
                    <CommandGroup key={g.type} heading={g.heading}>
                      {g.items.map((it) => (
                        <CommandItem key={it.name} value={it.name} disabled={!!blocked} onSelect={() => write(it.name)} onMouseDown={(e) => e.preventDefault()}>
                          <img src={fileUrl(it.files[0])} alt="" className="size-8 shrink-0 rounded-md object-cover ring-1 ring-foreground/10" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">@{it.name}</span>
                            {it.words && <span className="block truncate text-xs text-muted-foreground">{it.words}</span>}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">{it.files.length}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
              <Preview item={shown} />
            </div>
            <div className="flex items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
              <span>↑↓ to pick</span>
              <span>↵ or Tab to cite</span>
              <span>Esc to close</span>
              <span className="flex-1" />
              <a href="#library/elements" className="underline-offset-2 hover:text-foreground hover:underline" onMouseDown={(e) => e.preventDefault()}>
                Library
              </a>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {images > 0 && (
        <InputGroupAddon align="block-end" className="justify-end px-3 pt-0 pb-2 font-normal">
          <span className={cn("text-xs tabular-nums", blocked ? "text-destructive" : "text-muted-foreground")}>
            {blocked ? "Not on this model" : `+${images} image${images > 1 ? "s" : ""} from the elements`}
          </span>
        </InputGroupAddon>
      )}
    </>
  )
}

// the highlighted one, large: its images, what it is, its words
function Preview({ item }: { item?: Mentionable }) {
  if (!item) return <div className="border-l bg-muted/30" />
  return (
    <div className="flex min-w-0 flex-col gap-2 border-l bg-muted/30 p-2.5">
      <img src={fileUrl(item.files[0])} alt={`@${item.name}`} className="aspect-square w-full rounded-lg object-cover ring-1 ring-foreground/10" />
      {item.files.length > 1 && (
        <div className="grid grid-cols-4 gap-1">
          {item.files.slice(1, 5).map((f) => <img key={f} src={fileUrl(f)} alt="" className="aspect-square w-full rounded-md object-cover" />)}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">@{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {typeLabel(item.type)} · {item.files.length} image{item.files.length > 1 ? "s" : ""} sent
        </div>
        {item.words && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{item.words}</p>}
      </div>
    </div>
  )
}
