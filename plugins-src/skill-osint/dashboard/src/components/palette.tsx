import { useEffect } from "react"
import { toast } from "sonner"

import { OPEN_EXPORT } from "@/components/export-button"
import { Icon } from "@/components/icon"
import { kindOf } from "@/components/shared-entities"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { printUrl } from "@/lib/api"
import { useBasket } from "@/lib/basket"
import { t } from "@/lib/i18n"
import type { TreeCase } from "@/lib/tree"

// ⌘K / Ctrl-K: the notes, entities and ids (C03, H02, S07, L01) of the case and of its sub-cases (each named), and a
// few actions
export function Palette({ open, setOpen, cases, onOpen, onRefresh, onObsidian }: {
  open: boolean; setOpen: (o: boolean) => void; cases: TreeCase[]; onOpen: (path: string, anchor: string | null, slug: string | null) => void; onRefresh?: () => void; onObsidian: () => void
}) {
  const { items, copy } = useBasket()
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen(!open) } }
    addEventListener("keydown", f)
    return () => removeEventListener("keydown", f)
  }, [open, setOpen])
  const run = (f: () => void) => { setOpen(false); f() }
  const index = cases[0].index, many = cases.length > 1
  // each note with its case (null: the top case's) and, in an investigation, the case's title to tell them apart
  const notes = cases.flatMap((c, i) => c.index.notes.map(n => ({ ...n, of: i ? c.slug : null, where: many ? c.title : "" })))
  const entities = notes.filter(n => n.folder === "Entities")
  const ids = notes.filter(n => typeof n.props.id === "string").map(n => ({ id: String(n.props.id), path: n.path, title: n.title, anchor: null as string | null, of: n.of, where: n.where }))
    .concat(cases.flatMap((c, i) => c.index.leads.map(l => ({ id: l.id, path: "Leads.md", title: l.label, anchor: `^${l.id.toLowerCase()}`, of: i ? c.slug : null, where: many ? c.title : "" }))))
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("Search the case")} description={t("Notes, entities, ids and actions")}>
      <Command>
      <CommandInput placeholder={t("Notes, entities, C03, H02, actions…")} />
      <CommandList>
        <CommandEmpty>{t("Nothing matches.")}</CommandEmpty>
        <CommandGroup heading={t("Ids")}>
          {ids.map(x => (
            <CommandItem key={`${x.of}-${x.id}-${x.path}`} value={`${x.id} ${x.title} ${x.where} ${x.of ?? ""}`} onSelect={() => run(() => onOpen(x.path, x.anchor, x.of))}>
              <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">{x.id}</span><span className="truncate">{x.title}</span>{x.where && <CommandShortcut className="max-w-40 truncate tracking-normal">{x.where}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t("Entities")}>
          {entities.map(n => { const k = kindOf(String(n.props.kind)); return (
            <CommandItem key={`${n.of}-${n.path}`} value={`${n.props.value ?? n.title} ${k.label} ${n.path} ${n.where} ${n.of ?? ""}`} onSelect={() => run(() => onOpen(n.path, null, n.of))}>
              <Icon name={k.icon} style={{ color: k.color }} aria-hidden /><span className="truncate">{String(n.props.value ?? n.title)}</span><CommandShortcut className="max-w-48 truncate tracking-normal">{n.where ? `${k.label} · ${n.where}` : k.label}</CommandShortcut>
            </CommandItem>
          ) })}
        </CommandGroup>
        <CommandGroup heading={t("Notes")}>
          {notes.filter(n => n.folder !== "Entities").map(n => (
            <CommandItem key={`${n.of}-${n.path}`} value={`${n.title} ${n.path} ${n.where} ${n.of ?? ""}`} onSelect={() => run(() => onOpen(n.path, null, n.of))}>
              <Icon name="file-text" aria-hidden /><span className="truncate">{n.title}</span><CommandShortcut className="max-w-48 truncate tracking-normal">{n.where ? `${n.where} · ${n.path}` : n.path}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t("Actions")}>
          <CommandItem value={t("Open in Obsidian")} onSelect={() => run(onObsidian)}><Icon name="gem" />{t("Open in Obsidian")}</CommandItem>
          {onRefresh && <CommandItem value={t("Refresh")} onSelect={() => run(onRefresh)}><Icon name="refresh-cw" />{t("Refresh")}</CommandItem>}
          <CommandItem value={t("Export PDF")} onSelect={() => run(() => dispatchEvent(new Event(OPEN_EXPORT)))}><Icon name="file-down" />{t("Export PDF")}</CommandItem>
          <CommandItem value={t("Print view")} onSelect={() => run(() => window.open(printUrl(index.slug), "_blank", "noopener"))}><Icon name="printer" />{t("Print view")}</CommandItem>
          <CommandItem value={t("Copy prompt")} onSelect={() => run(() => (items.length ? copy() : toast(t("The prompt is empty"), { description: t("Add next actions, pivots or a question first") })))}>
            <Icon name="clipboard-copy" />{t("Copy prompt")}<CommandShortcut>{t(items.length === 1 ? "{n} item" : "{n} items", { n: items.length })}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
