import { CopyIcon } from "lucide-react"

import { Icon } from "@/components/icon"
import { copyText } from "@/components/obsidian-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CaseIndex } from "@/lib/api"
import { day } from "@/lib/format"
import { caseHref } from "@/lib/route"
import { TONE, type Tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

// the Admiralty reliability of a source: A completely reliable … F cannot be judged
const RELIABILITY: Record<string, { label: string; tone: Tone }> = {
  A: { label: "Completely reliable", tone: "emerald" }, B: { label: "Usually reliable", tone: "emerald" }, C: { label: "Fairly reliable", tone: "sky" },
  D: { label: "Not usually reliable", tone: "amber" }, E: { label: "Unreliable", tone: "rose" }, F: { label: "Cannot be judged", tone: "neutral" },
}
// The sources: what was read, when, how reliable, the capture kept and its SHA-256
export function Sources({ index }: { index: CaseIndex }) {
  const rows = index.notes.filter(n => n.folder === "Sources").sort((a, b) => String(a.props.id).localeCompare(String(b.props.id)))
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">No source yet.</p>
  return (
    <div className="py-4">
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Id</TableHead><TableHead>Title</TableHead><TableHead>URL</TableHead><TableHead>Read</TableHead><TableHead>Reliability</TableHead><TableHead>Capture</TableHead><TableHead>Archive</TableHead><TableHead>SHA-256</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(n => {
              const p = n.props, id = String(p.id ?? ""), rel = RELIABILITY[String(p.reliability ?? "F")] ?? RELIABILITY.F
              const capture = index.files.find(f => f.startsWith(`Evidence/captures/${id}.`)), sha = String(p.sha256 ?? "")
              return (
                <TableRow key={n.path}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{id}</TableCell>
                  <TableCell className="max-w-72"><a href={caseHref(index.slug, "brain", n.path)} className="block truncate font-medium hover:underline">{n.title.replace(new RegExp(`^${id}\\s+`), "")}</a></TableCell>
                  <TableCell className="max-w-64">{p.url ? <a href={String(p.url)} target="_blank" rel="noreferrer" className="block truncate text-primary underline underline-offset-2">{String(p.url)}</a> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{p.accessed ? day(String(p.accessed)) : "—"}</TableCell>
                  <TableCell><Badge className={cn("gap-1", TONE[rel.tone])} title={rel.label}><Icon name="gauge" aria-hidden />{String(p.reliability ?? "F")}<span className="sr-only">{rel.label}</span></Badge></TableCell>
                  <TableCell>{capture ? <a href={caseHref(index.slug, "brain", capture)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Icon name="camera" className="size-3.5" />{capture.slice(capture.lastIndexOf("/") + 1)}</a> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{p.archive ? <a href={String(p.archive)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Icon name="history" className="size-3.5" />Wayback</a> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{sha ? (
                    <span className="flex items-center gap-1 font-mono text-xs" title={sha}>{sha.slice(0, 12)}…
                      <Button variant="ghost" size="icon-xs" aria-label={`Copy the SHA-256 of ${id}`} onClick={() => copyText(sha, "SHA-256 copied")}><CopyIcon /></Button>
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
