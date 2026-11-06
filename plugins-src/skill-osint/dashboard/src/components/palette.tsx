import { useEffect } from "react"
import { toast } from "sonner"

import { OPEN_EXPORT } from "@/components/export-button"
import { Icon } from "@/components/icon"
import { kindOf } from "@/components/shared-entities"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { printUrl, type CaseIndex } from "@/lib/api"
import { useBasket } from "@/lib/basket"

// ⌘K / Ctrl-K: the case's notes, its entities, its ids (C03, H02, S07, L01) and a few actions
export function Palette({ open, setOpen, index, onOpen, onRefresh, onObsidian }: {
  open: boolean; setOpen: (o: boolean) => void; index: CaseIndex; onOpen: (path: string, anchor?: string | null) => void; onRefresh?: () => void; onObsidian: () => void
}) {
  const { items, copy } = useBasket()
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen(!open) } }
    addEventListener("keydown", f)
    return () => removeEventListener("keydown", f)
  }, [open, setOpen])
  const run = (f: () => void) => { setOpen(false); f() }
  const entities = index.notes.filter(n => n.folder === "Entities")
  const ids = index.notes.filter(n => typeof n.props.id === "string").map(n => ({ id: String(n.props.id), path: n.path, title: n.title, anchor: null as string | null }))
    .concat(index.leads.map(l => ({ id: l.id, path: "Leads.md", title: l.label, anchor: `^${l.id.toLowerCase()}` })))
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search the case" description="Notes, entities, ids and actions">
      <Command>
      <CommandInput placeholder="Notes, entities, C03, H02, actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Ids">
          {ids.map(x => (
            <CommandItem key={`${x.id}-${x.path}`} value={`${x.id} ${x.title}`} onSelect={() => run(() => onOpen(x.path, x.anchor))}>
              <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">{x.id}</span><span className="truncate">{x.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Entities">
          {entities.map(n => { const k = kindOf(String(n.props.kind)); return (
            <CommandItem key={n.path} value={`${n.props.value ?? n.title} ${k.label} ${n.path}`} onSelect={() => run(() => onOpen(n.path))}>
              <Icon name={k.icon} style={{ color: k.color }} aria-hidden /><span className="truncate">{String(n.props.value ?? n.title)}</span><CommandShortcut>{k.label}</CommandShortcut>
            </CommandItem>
          ) })}
        </CommandGroup>
        <CommandGroup heading="Notes">
          {index.notes.filter(n => n.folder !== "Entities").map(n => (
            <CommandItem key={n.path} value={`${n.title} ${n.path}`} onSelect={() => run(() => onOpen(n.path))}>
              <Icon name="file-text" aria-hidden /><span className="truncate">{n.title}</span><CommandShortcut className="max-w-48 truncate tracking-normal">{n.path}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="Open in Obsidian" onSelect={() => run(onObsidian)}><Icon name="gem" />Open in Obsidian</CommandItem>
          {onRefresh && <CommandItem value="Refresh" onSelect={() => run(onRefresh)}><Icon name="refresh-cw" />Refresh</CommandItem>}
          <CommandItem value="Export PDF" onSelect={() => run(() => dispatchEvent(new Event(OPEN_EXPORT)))}><Icon name="file-down" />Export PDF</CommandItem>
          <CommandItem value="Print view" onSelect={() => run(() => window.open(printUrl(index.slug), "_blank", "noopener"))}><Icon name="printer" />Print view</CommandItem>
          <CommandItem value="Copy prompt" onSelect={() => run(() => (items.length ? copy() : toast("The prompt is empty", { description: "Add next actions, pivots or a question first" })))}>
            <Icon name="clipboard-copy" />Copy prompt<CommandShortcut>{items.length} item{items.length === 1 ? "" : "s"}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
