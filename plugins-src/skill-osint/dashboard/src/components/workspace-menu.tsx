import { CheckIcon, ChevronDownIcon, FolderInputIcon, FolderKanbanIcon, LayersIcon, PencilLineIcon, PlusIcon, SettingsIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { api, type Workspaces } from "@/lib/api"
import { t } from "@/lib/i18n"
import { useWorkspaceEvents } from "@/lib/use-events"

// the folder's workspaces, shared by every bar and page, live (the agent's `workspaces` command too)
let cache: Workspaces | null = null, asked = false
const subs = new Set<() => void>()
export const setWorkspaces = (w: Workspaces) => { cache = w; subs.forEach(f => f()) }
export function useWorkspaces() {
  const [w, set] = useState(cache)
  useEffect(() => {
    const f = () => set(cache)
    subs.add(f)
    if (!asked) { asked = true; api.workspaces().then(setWorkspaces, () => { asked = false }) }
    f()
    return () => { subs.delete(f) }
  }, [])
  useWorkspaceEvents(setWorkspaces)
  return w
}
// what the home page shows: the current workspace, or all of them (this browser's choice)
const VIEW = "osint-workspace-view"
const views = new Set<() => void>()
const readView = () => { try { return localStorage.getItem(VIEW) === "all" ? "all" : "current" } catch { return "current" } }
export function setWorkspaceView(v: "all" | "current") { try { localStorage.setItem(VIEW, v) } catch { /* this visit only */ } views.forEach(f => f()) }
export function useWorkspaceView() {
  const [v, set] = useState(readView)
  useEffect(() => { const f = () => set(readView()); views.add(f); return () => { views.delete(f) } }, [])
  return v
}
// the default workspace's own name is the dashboard's word for it until the user renames it
export const shownName = (x: { slug: string; name: string }) => (x.slug === "default" && x.name === "Default workspace" ? t("Default workspace") : x.name)
export const nameOf = (w: Workspaces | null, slug: string) => shownName(w?.list.find(x => x.slug === slug) ?? { slug, name: slug === "default" ? "Default workspace" : slug })
export const fail = (e: unknown) => toast.error(t("Not changed"), { description: (e as Error).message })

// a name asked for: a new workspace, or a new name for one (its caller's key starts it again for each)
export function NameDialog({ open, onOpenChange, title, description, action, value = "", onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; action: string; value?: string; onSubmit: (name: string) => Promise<unknown>
}) {
  const [name, setName] = useState(value), [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try { await onSubmit(name.trim()); onOpenChange(false) } catch (err) { fail(err) }
    setBusy(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
          <Input autoFocus value={name} maxLength={60} placeholder={t("Client Durand")} onChange={e => setName(e.target.value)} aria-label={t("Name")} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
export function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <NameDialog key={String(open)} open={open} onOpenChange={onOpenChange} title={t("New workspace")} action={t("Create workspace")}
      description={t("A group of investigations. It becomes the current one: the cases you start next join it.")}
      onSubmit={name => api.workspace({ new: name }).then(w => { setWorkspaces(w); setWorkspaceView("current"); toast.success(t("{name} is the current workspace", { name })) })} />
  )
}

// The bar's workspace switch: the current one (new cases join it), All workspaces, a new one, Settings to manage them
export function WorkspaceMenu() {
  const w = useWorkspaces(), view = useWorkspaceView()
  const [making, setMaking] = useState(false)
  if (!w) return null
  const all = view === "all", home = () => { if (!/^#?\/?$/.test(location.hash)) location.hash = "#/" }
  const use = (slug: string) => api.workspace({ slug, use: true }).then(x => { setWorkspaces(x); setWorkspaceView("current"); home() }, fail)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-2" title={t("The current workspace: the cases you start join it")}>
            {all ? <LayersIcon className="text-muted-foreground" /> : <FolderKanbanIcon className="text-muted-foreground" />}
            <span className="max-w-40 truncate max-sm:sr-only">{all ? t("All workspaces") : nameOf(w, w.current)}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <DropdownMenuLabel>{t("Workspaces")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={all ? "" : w.current} onValueChange={use}>
            {w.list.map(x => <DropdownMenuRadioItem key={x.slug} value={x.slug}><span className="truncate">{shownName(x)}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { setWorkspaceView(all ? "current" : "all"); home() }}>
            <LayersIcon />{t("All workspaces")}{all && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMaking(true)}><PlusIcon />{t("New workspace…")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { location.hash = "#/settings?at=workspaces" }}><SettingsIcon />{t("Manage workspaces")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewWorkspaceDialog open={making} onOpenChange={setMaking} />
    </>
  )
}

// « Move to workspace » in a card's menu: the investigation, its sub-cases with it
export function MoveToWorkspace({ slug, current }: { slug: string; current: string }) {
  const w = useWorkspaces()
  if (!w || w.list.length < 2) return null
  const move = (to: string) => api.workspace({ slug: to, move: slug }).then(() => toast.success(t("Moved to {name}", { name: nameOf(w, to) })), fail)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger><FolderInputIcon />{t("Move to workspace")}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={current} onValueChange={v => v !== current && move(v)}>
          {w.list.map(x => <DropdownMenuRadioItem key={x.slug} value={x.slug}><span className="truncate">{shownName(x)}</span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

// Settings › Workspaces: each one with its investigations' count, current or not; make one current, rename it,
// delete it (its investigations go back to the default workspace), or make a new one
export function WorkspacesCard({ counts }: { counts: Record<string, number> }) {
  const w = useWorkspaces()
  const [making, setMaking] = useState(false), [renaming, setRenaming] = useState<{ slug: string; name: string } | null>(null), [removing, setRemoving] = useState<{ slug: string; name: string } | null>(null)
  const run = (b: Parameters<typeof api.workspace>[0], done?: string) => api.workspace(b).then(x => { setWorkspaces(x); if (done) toast.success(done) }, fail)
  return (
    <Card id="workspaces" data-toc className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FolderKanbanIcon className="size-4" />{t("Workspaces")}</CardTitle>
        <CardDescription>{t("Groups of investigations. A new case joins the current one; a sub-case always lives in its investigation's. Nothing moves on disk.")}</CardDescription>
        <CardAction><Button size="sm" variant="outline" onClick={() => setMaking(true)}><PlusIcon data-icon="inline-start" />{t("New workspace…")}</Button></CardAction>
      </CardHeader>
      <CardContent>
        {!w ? <p className="text-sm text-muted-foreground">…</p> : (
          <ul className="divide-y">
            {w.list.map(x => {
              const on = x.slug === w.current, n = counts[x.slug] ?? 0
              return (
                <li key={x.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <FolderKanbanIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{shownName(x)}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{t(n === 1 ? "{n} investigation" : "{n} investigations", { n })}</span>
                  </span>
                  {on ? <Badge variant="secondary" className="gap-1"><CheckIcon aria-hidden />{t("Current")}</Badge>
                    : <Button size="xs" variant="outline" onClick={() => run({ slug: x.slug, use: true }, t("{name} is the current workspace", { name: shownName(x) }))}>{t("Make current")}</Button>}
                  <Button size="icon-xs" variant="ghost" aria-label={t("Rename {name}", { name: shownName(x) })} onClick={() => setRenaming({ slug: x.slug, name: shownName(x) })}><PencilLineIcon /></Button>
                  {x.slug !== "default" && <Button size="icon-xs" variant="ghost" aria-label={t("Delete {name}", { name: shownName(x) })} onClick={() => setRemoving({ slug: x.slug, name: shownName(x) })}><Trash2Icon /></Button>}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <NewWorkspaceDialog open={making} onOpenChange={setMaking} />
      <NameDialog key={renaming?.slug ?? ""} open={!!renaming} onOpenChange={o => { if (!o) setRenaming(null) }} title={t("Rename the workspace")} description={t("Its investigations stay in it.")} action={t("Rename")} value={renaming?.name ?? ""}
        onSubmit={name => api.workspace({ slug: renaming!.slug, rename: name }).then(setWorkspaces)} />
      <AlertDialog open={!!removing} onOpenChange={o => { if (!o) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete {name}?", { name: removing?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("Its investigations go back to the default workspace; no case is deleted.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => removing && run({ slug: removing.slug, remove: true })}>{t("Delete workspace")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
