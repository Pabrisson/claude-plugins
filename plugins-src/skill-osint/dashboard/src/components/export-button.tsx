import { CopyIcon, DownloadIcon, ExternalLinkIcon, FileCheckIcon, FileDownIcon, FileTextIcon, LoaderCircleIcon, PrinterIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { copyText } from "@/components/obsidian-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, exportsOf, fileUrl, printUrl, type CaseIndex, type ExportResult } from "@/lib/api"

const KEY = "osint-export-journal"
// the palette asks for the popover by this event (the button holds its own state: an export keeps running when the popover closes)
export const OPEN_EXPORT = "osint:open-export"
const remembered = () => { try { return localStorage.getItem(KEY) === "1" } catch { return false } }

// « Export PDF »: a local edit, the engine prints the case's print view in Exports/ (its SHA-256 goes to the Journal).
// With no Chromium-family browser here (code 3) nothing failed: Print view prints from any browser.
export function ExportButton({ slug, index }: { slug: string; index: CaseIndex }) {
  const [open, setOpen] = useState(false), [journal, setJournal] = useState(remembered), [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ExportResult | null>(null), [problem, setProblem] = useState<{ message: string; code?: number } | null>(null)
  useEffect(() => {
    const f = () => setOpen(true)
    addEventListener(OPEN_EXPORT, f)
    return () => removeEventListener(OPEN_EXPORT, f)
  }, [])
  const earlier = exportsOf(index.files).slice(0, 5)
  const setAppendix = (on: boolean) => { setJournal(on); try { localStorage.setItem(KEY, on ? "1" : "0") } catch { /* a per-browser convenience only */ } }
  async function run() {
    setBusy(true); setDone(null); setProblem(null)
    try {
      const r = await api.exportPdf(slug, journal)
      setDone(r)
      toast.success("PDF exported", { description: r.file, action: { label: "Download", onClick: () => { location.href = fileUrl(slug, r.file) } } })
    } catch (e) { setProblem({ message: (e as Error).message, code: (e as { code?: number }).code }) }
    setBusy(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Export PDF">
              {busy ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : <FileDownIcon data-icon="inline-start" />}
              <span className="hidden sm:inline">Export PDF</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Export the case as a PDF</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))]">
        <PopoverHeader>
          <PopoverTitle>Export PDF</PopoverTitle>
          <PopoverDescription>A dated PDF in Exports/ of the case folder, kept by git. Its SHA-256 goes to the Journal.</PopoverDescription>
        </PopoverHeader>
        <div className="flex items-center gap-2">
          <Switch id="export-journal" size="sm" checked={journal} onCheckedChange={setAppendix} disabled={busy} />
          <Label htmlFor="export-journal" className="text-sm font-normal">Add the Journal as an appendix</Label>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : <FileDownIcon data-icon="inline-start" />}
          {busy ? "Exporting…" : "Export"}
        </Button>
        {done && (
          <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3 text-sm" role="status">
            <div className="flex items-start gap-2">
              <FileCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs break-all">{done.file}</p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  SHA-256 <span className="font-mono" title={done.sha256}>{done.sha256.slice(0, 12)}…</span>
                  <Button variant="ghost" size="icon-xs" aria-label="Copy the SHA-256" onClick={() => copyText(done.sha256, "SHA-256 copied")}><CopyIcon /></Button>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="xs" asChild><a href={fileUrl(slug, done.file)} download><DownloadIcon data-icon="inline-start" />Download</a></Button>
              <Button variant="outline" size="xs" asChild><a href={fileUrl(slug, done.file)} target="_blank" rel="noreferrer"><ExternalLinkIcon data-icon="inline-start" />Open</a></Button>
            </div>
          </div>
        )}
        {problem && (
          <Alert variant={problem.code === 3 ? "default" : "destructive"}>
            {problem.code === 3 ? <PrinterIcon aria-hidden /> : <TriangleAlertIcon aria-hidden />}
            <AlertTitle>{problem.code === 3 ? "No browser to print with" : "The export failed"}</AlertTitle>
            <AlertDescription className="break-words">
              {problem.message}
              <Button variant="outline" size="xs" className="mt-2 w-fit" asChild><a href={printUrl(slug, journal)} target="_blank" rel="noreferrer"><PrinterIcon data-icon="inline-start" />Open Print view</a></Button>
            </AlertDescription>
          </Alert>
        )}
        {earlier.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">Earlier exports</p>
            <ul className="flex flex-col">
              {earlier.map(f => (
                <li key={f}>
                  <a href={fileUrl(slug, f)} download className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-muted"><FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{f.slice("Exports/".length)}</span></a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// « Print view »: the static page the browser prints or saves as PDF, in a new tab
export function PrintViewButton({ slug }: { slug: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" asChild>
          <a href={printUrl(slug)} target="_blank" rel="noreferrer" aria-label="Print view"><PrinterIcon data-icon="inline-start" /><span className="hidden sm:inline">Print view</span></a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>A page to print or save as PDF from this browser</TooltipContent>
    </Tooltip>
  )
}
