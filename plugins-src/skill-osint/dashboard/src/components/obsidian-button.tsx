import { CopyIcon, ExternalLinkIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { t } from "@/lib/i18n"

// obsidian://open?path=<the case's Case.md>, with the separator of the system the server runs on (dir tells it)
export const obsidianHref = (dir: string) => `obsidian://open?path=${encodeURIComponent(`${dir}${dir.includes("\\") ? "\\" : "/"}Case.md`)}`
export const caseDirOf = (home: string, slug: string) => `${home}${home.includes("\\") ? "\\" : "/"}${slug}`
const HELP = "osint-obsidian-help"
const helped = () => { try { return !!localStorage.getItem(HELP) } catch { return false } }
export const copyText = (text: string, what = t("Copied")) => navigator.clipboard.writeText(text).then(() => toast.success(what), () => toast.error(t("The clipboard refused")))

// « Open in Obsidian »: the first time, how to make the case folder a vault, its path to copy, then the link
export function useObsidian() {
  const [dir, setDir] = useState<string | null>(null)
  const open = (d: string) => { if (helped()) location.href = obsidianHref(d); else setDir(d) }
  const dialog = (
    <Dialog open={!!dir} onOpenChange={o => !o && setDir(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Open in Obsidian")}</DialogTitle>
          <DialogDescription>{t("If Obsidian does not know this vault yet: Obsidian › Open folder as vault › choose this folder.")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          <span className="flex-1">{dir}</span>
          <Button variant="ghost" size="icon-xs" aria-label={t("Copy the folder's path")} onClick={() => dir && copyText(dir, t("Path copied"))}><CopyIcon /></Button>
        </div>
        <DialogFooter>
          <Button asChild onClick={() => { try { localStorage.setItem(HELP, "1") } catch { /* asked again next time */ } setDir(null) }}>
            <a href={dir ? obsidianHref(dir) : "#"}><ExternalLinkIcon data-icon="inline-start" />{t("Open in Obsidian")}</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  return { open, dialog }
}
