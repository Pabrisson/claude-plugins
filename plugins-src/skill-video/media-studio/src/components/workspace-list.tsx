import { useState } from "react"
import { CheckIcon, EllipsisIcon, FolderKanbanIcon, LayersIcon, PencilLineIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { api, inWorkspace, mediaKind, money, outputPath, per1000, plain, spentIn, type State, type Workspace } from "@/lib/api"
import { Label } from "@/components/chips"
import { ConfirmDelete } from "@/components/elements"
import { Thumb } from "@/components/inputs"
import { t } from "@/lib/i18n"

// what a workspace's generations cost, in words
export function costLine(s: State, slug: string) {
  const { usd, credits } = spentIn(s, slug)
  return [usd || !credits ? money(usd, "usd") : "", credits ? money(credits, "credits", per1000(s)) : ""].filter(Boolean).join(" · ")
}

// a name asked for: a new workspace, or a new name for one (its key starts it again for each)
function NameDialog({ open, title, description, value = "", action, onClose, onSubmit }: { open: boolean; title: string; description: string; value?: string; action: string; onClose: () => void; onSubmit: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(value)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (err) {
      toast.error(plain((err as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="mt-1">{description}</DialogDescription>
          </div>
          <div>
            <Label>{t("Name")}</Label>
            <Input autoFocus value={name} maxLength={60} placeholder={t("Spring campaign")} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{action}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NewWorkspaceDialog({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  return (
    <NameDialog
      key={String(open)}
      open={open}
      title={t("New workspace")}
      description={t("A project's media, Elements and timeline. It becomes the current one: what you generate next lands in it.")}
      action={t("Create workspace")}
      onClose={onClose}
      onSubmit={(name) => api.workspaces({ new: name }).then((r) => (onChanged(), toast.success(t("{name} is the current workspace", { name: r.workspaces.find((w) => w.slug === r.current)?.name ?? "" }))))}
    />
  )
}

// the workspaces as rows: their first picture, their name, how many items (and on the Workspace page what they cost);
// the one picked is checked, « All workspaces » first. On the Workspace page a click makes it the current one and each
// can be renamed or deleted; in the Library's Elements they filter
export function WorkspaceRows({
  state,
  value,
  onPick,
  count,
  unit,
  all,
  manage,
  onChanged,
}: {
  state: State
  value: string
  onPick: (slug: string) => void
  count: (slug: string) => number
  unit: string
  all?: boolean
  manage?: boolean
  onChanged?: () => void
}) {
  const [making, setMaking] = useState(false)
  const [renaming, setRenaming] = useState<Workspace | null>(null)
  const [removing, setRemoving] = useState<Workspace | null>(null)
  const changed = () => onChanged?.()
  const rows = [...(all ? [{ slug: "all", name: t("All workspaces") } as Workspace] : []), ...state.workspaces]
  // how many: elements (the Library's), else items
  const n = (k: number) => (unit === "element" ? (k === 1 ? t("{n} element", { n: k }) : t("{n} elements", { n: k })) : k === 1 ? t("{n} item", { n: k }) : t("{n} items", { n: k }))
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label>{t("Workspaces")}</Label>
        {manage && (
          <Button size="xs" variant="ghost" className="-mt-2" onClick={() => setMaking(true)}>
            <PlusIcon data-icon="inline-start" /> {t("New")}
          </Button>
        )}
      </div>
      <div className="-mx-1 flex max-h-56 flex-col gap-0.5 overflow-auto p-0.5">
        {rows.map((w) => {
          const cover = w.slug === "all" ? null : state.media.filter((j) => inWorkspace(j, w.slug) && j.status === "done").flatMap((j) => j.outputs.filter((o) => ["image", "video"].includes(mediaKind(o))).map((o) => outputPath(state.home, j, o)))[0]
          const on = w.slug === value
          return (
            <div key={w.slug} className={cn("group flex items-center gap-1 rounded-lg transition-colors", on ? "bg-muted" : "hover:bg-muted/60")}>
              <button type="button" aria-current={on ? "true" : undefined} onClick={() => onPick(w.slug)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted-foreground/10 text-muted-foreground">
                  {cover ? <Thumb path={cover} /> : w.slug === "all" ? <LayersIcon className="size-4" /> : <FolderKanbanIcon className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", on && "font-medium")}>{w.name}</span>
                  <span className="block truncate text-xs text-muted-foreground tabular-nums">
                    {n(count(w.slug))}
                    {manage && w.slug !== "all" && (
                      <>
                        {" · "}
                        <span className="text-cost">{costLine(state, w.slug)}</span>
                      </>
                    )}
                  </span>
                </span>
                {on && <CheckIcon className="size-4 shrink-0 text-foreground/70" aria-label={manage && w.slug !== "all" ? t("Current") : t("Shown")} />}
              </button>
              {manage && w.slug !== "all" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-xs" variant="ghost" aria-label={t("{name}: rename or delete", { name: w.name })} className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100">
                      <EllipsisIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(w)}>
                      <PencilLineIcon /> {t("Rename")}
                    </DropdownMenuItem>
                    {w.slug !== "default" && (
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(w)}>
                        <Trash2Icon /> {t("Delete")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        })}
      </div>
      {manage && (
        <>
          <NewWorkspaceDialog open={making} onClose={() => setMaking(false)} onChanged={changed} />
          <NameDialog
            key={renaming?.slug ?? ""}
            open={!!renaming}
            title={t("Rename the workspace")}
            description={t("Its media, Elements and timeline stay as they are.")}
            value={renaming?.name}
            action={t("Rename")}
            onClose={() => setRenaming(null)}
            onSubmit={(name) => api.workspaces({ slug: renaming!.slug, name }).then(changed)}
          />
          <ConfirmDelete
            what={t("the workspace {name}", { name: removing?.name ?? "" })}
            text={t("Its timeline goes. Its media and Elements stay in the Library.")}
            open={!!removing}
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              api.workspaces({ slug: removing!.slug, remove: true }).then(changed, (e) => toast.error(plain(e.message)))
              setRemoving(null)
            }}
          />
        </>
      )}
    </div>
  )
}
