import { CopyIcon, ExternalLinkIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { t } from "@/lib/i18n"

// obsidian://open?path=<the case's Case.md>, with the separator of the system the server runs on (dir tells it)
export const obsidianHref = (dir: string) => `obsidian://open?path=${encodeURIComponent(`${dir}${dir.includes("\\") ? "\\" : "/"}Case.md`)}`
export const copyText = (text: string, what = t("Copied")) => navigator.clipboard.writeText(text).then(() => toast.success(what), () => toast.error(t("The clipboard refused")))

type Why = { dir: string; running?: boolean; missing?: boolean }
// « Open in Obsidian »: the server makes the case's investigation known to Obsidian when it can (Obsidian closed), then
// the link opens it; when it cannot, why and how to add the folder by hand
export function useObsidian() {
  const [why, setWhy] = useState<Why | null>(null)
  const open = (slug: string) => api.obsidian(slug).then(r => { if (r.ok) location.href = obsidianHref(r.dir); else setWhy(r) }, e => toast.error(t("Not opened in Obsidian"), { description: (e as Error).message }))
  const dialog = (
    <Dialog open={!!why} onOpenChange={o => !o && setWhy(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Open in Obsidian")}</DialogTitle>
          <DialogDescription>
            {why?.missing ? t("Obsidian was not found on this computer: install it and open it once, then click again.")
              : why?.running ? t("Obsidian is open and does not know this vault yet: in Obsidian, Open folder as vault › choose this folder. Or quit Obsidian and click again: the dashboard adds it, with its sub-cases.")
              : t("If Obsidian does not know this vault yet: Obsidian › Open folder as vault › choose this folder.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          <span className="flex-1">{why?.dir}</span>
          <Button variant="ghost" size="icon-xs" aria-label={t("Copy the folder's path")} onClick={() => why && copyText(why.dir, t("Path copied"))}><CopyIcon /></Button>
        </div>
        <DialogFooter>
          {why?.running && <Button variant="outline" asChild><a href="obsidian://choose-vault"><Icon name="gem" data-icon="inline-start" />{t("Obsidian's vaults")}</a></Button>}
          <Button asChild onClick={() => setWhy(null)}>
            <a href={why ? obsidianHref(why.dir) : "#"}><ExternalLinkIcon data-icon="inline-start" />{t("Open in Obsidian")}</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  return { open, dialog }
}
