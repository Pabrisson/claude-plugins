import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon, SearchIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Table as T, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type CaseIndex, type View } from "@/lib/api"
import { caseHref } from "@/lib/route"

type Row = Record<string, unknown> & { __path?: string }
const cell = (v: unknown): string => (Array.isArray(v) ? v.map(cell).join(", ") : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v))
// a column name for a person: first_seen → First seen
const head = (c: string) => (c === "value" ? "Value" : c.replace(/_/g, " ").replace(/^./, x => x.toUpperCase()))

// A table of the case: the entities of one kind that match `where`, or the rows a type wrote to a view
// (.osint/views/<view>.json); the manifest's columns, sortable, with a filter
export function TableWidget({ index, view, pulse }: { index: CaseIndex; view: View & { view?: string }; pulse: number }) {
  const [viewRows, setViewRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState(""), [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null)
  useEffect(() => { if (view.view) api.view<Row[]>(index.slug, view.view).then(r => setViewRows(Array.isArray(r) ? r : []), () => setViewRows([])) }, [index.slug, view.view, pulse])
  const rows: Row[] = view.view ? viewRows ?? [] : index.notes
    .filter(n => n.folder === "Entities" && n.props.kind === view.kind && Object.entries(view.where ?? {}).every(([k, v]) => cell(n.props[k]) === cell(v)))
    .map(n => ({ ...n.props, __path: n.path }))
  const cols = view.columns ?? Object.keys(rows[0] ?? {}).filter(k => k !== "__path")
  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r => !needle || cols.some(c => cell(r[c]).toLowerCase().includes(needle)))
  if (sort) shown.sort((a, b) => cell(a[sort.col]).localeCompare(cell(b[sort.col]), undefined, { numeric: true }) * sort.dir)
  const by = (c: string) => setSort(s => (s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center gap-3">
        <InputGroup className="max-w-xs">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" aria-label="Filter the rows" />
        </InputGroup>
        <span className="text-sm text-muted-foreground tabular-nums" role="status">{shown.length === rows.length ? `${rows.length} rows` : `${shown.length} of ${rows.length} rows`}</span>
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <T>
          <TableHeader>
            <TableRow>
              {cols.map(c => (
                <TableHead key={c} aria-sort={sort?.col === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => by(c)} className="inline-flex items-center gap-1 hover:text-foreground">
                    {head(c)}{sort?.col === c && (sort.dir === 1 ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!shown.length && <TableRow><TableCell colSpan={cols.length} className="py-8 text-center text-muted-foreground">{rows.length ? "No row matches." : "Nothing here yet."}</TableCell></TableRow>}
            {shown.map((r, i) => (
              <TableRow key={r.__path ?? i}>
                {cols.map(c => {
                  const v = cell(r[c])
                  return (
                    <TableCell key={c} className="max-w-96 truncate">
                      {c === "value" && r.__path ? <a href={caseHref(index.slug, "brain", r.__path)} className="font-medium hover:underline">{v}</a>
                        : /^https?:\/\/\S+$/.test(v) ? <a href={v} target="_blank" rel="noopener noreferrer" title={v} className="inline-flex max-w-[28ch] items-center gap-1 text-primary underline underline-offset-2"><span className="truncate">{v.replace(/^https?:\/\//, "")}</span><ExternalLinkIcon className="size-3 shrink-0" aria-hidden /></a>
                        : v || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </T>
      </div>
    </div>
  )
}
