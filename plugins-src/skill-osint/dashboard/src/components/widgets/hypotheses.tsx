import { consistency } from "@engine/analysis.js"
import { useState } from "react"

import { Chips } from "@/components/chips"
import { Icon } from "@/components/icon"
import { Markdown } from "@/components/markdown"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { CaseIndex, Manifest, NoteMeta } from "@/lib/api"
import { caseHref, go } from "@/lib/route"
import { TONE, type Tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

export const HYP_STATUS: Record<string, { label: string; icon: string; tone: Tone }> = {
  active: { label: "Active", icon: "circle-dot", tone: "sky" },
  excluded: { label: "Excluded", icon: "circle-slash", tone: "neutral" },
  retained: { label: "Retained", icon: "circle-check", tone: "emerald" },
}
const CNI = { C: { label: "Consistent", v: "--ach-c" }, N: { label: "Neutral", v: "--ach-n" }, I: { label: "Inconsistent", v: "--ach-i" } } as const
const pct = (x: number) => `${Math.round(x * 100)} %`
const open = (slug: string, p: string) => go(caseHref(slug, "brain", p))

// Hypotheses: per level (the manifest's order, the frontier marked), each with its status, share and refutation
// condition, an excluded one with its reason; or the ACH matrix, a view of the same cells
export function Hypotheses({ index, manifest }: { index: CaseIndex; manifest: Manifest }) {
  const [mode, setMode] = useState("shares")
  const slug = index.slug, a = index.analysis
  const hyp = (id: string) => index.notes.find(n => n.folder === "Hypotheses" && n.props.id === id)
  const clue = (id: string) => index.notes.find(n => n.folder === "Clues" && n.props.id === id)
  const levels = [...manifest.levels.map(l => l.id).filter(l => a.ranked[l]), ...Object.keys(a.ranked).filter(l => !manifest.levels.some(x => x.id === l))]
  const onOpen = (p: string, anchor?: string | null) => open(slug, `${p}${anchor ? `#${anchor}` : ""}`)
  if (!levels.length) return <p className="py-10 text-center text-sm text-muted-foreground">No hypothesis yet: they come with the analysis.</p>
  return (
    <div className="flex flex-col gap-4 py-4">
      <Chips label="Hypotheses view" size="xs" value={mode} onChange={setMode} options={[{ value: "shares", label: "Shares", icon: "bar-chart-3" }, { value: "ach", label: "ACH", icon: "grid-3x3" }]} />
      {mode === "shares" ? levels.map(level => (
        <section key={level} className="flex flex-col gap-2" aria-labelledby={`lv-${level}`}>
          <h2 id={`lv-${level}`} className="flex items-center gap-2 text-sm font-semibold">
            {manifest.levels.find(l => l.id === level)?.label ?? level}
            {a.frontier === level && <Badge title="The finest level that still has two or more active hypotheses (the levels are not a hierarchy: the answer can be read at any of them)" className={cn("gap-1", TONE.violet)}><Icon name="target" aria-hidden />Frontier</Badge>}
          </h2>
          <ul className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
            {a.ranked[level].map(r => {
              const n = hyp(r.id), st = HYP_STATUS[r.status] ?? HYP_STATUS.active
              return (
                <li key={r.id} className={cn("flex flex-col gap-2 p-3", r.status === "excluded" && "text-muted-foreground")}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button type="button" onClick={() => n && open(slug, n.path)} className="min-w-0 flex-1 truncate text-left font-medium hover:underline">
                      <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.id}</span>{n?.title ?? r.id}
                    </button>
                    <Badge className={cn("gap-1", TONE[st.tone])}><Icon name={st.icon} aria-hidden />{st.label}</Badge>
                    <span className="flex w-40 items-center gap-2" aria-label={`Share ${pct(r.share)}`}>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: pct(r.share) }} /></span>
                      <span className="w-10 text-right text-xs tabular-nums">{pct(r.share)}</span>
                    </span>
                  </div>
                  {n?.props.refute_if != null && <p className="text-xs"><span className="text-muted-foreground">Refuted if: </span>{String(n.props.refute_if)}</p>}
                  {r.status === "excluded" && n?.props.reason != null && (
                    <p className="flex gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs"><Icon name="circle-slash" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span><Markdown text={String(n.props.reason)} slug={slug} files={index.files} onOpen={onOpen} inline /></span></p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )) : <Ach index={index} levels={levels} hyp={hyp} clue={clue} />}
    </div>
  )
}

function Ach({ index, levels, hyp, clue }: { index: CaseIndex; levels: string[]; hyp: (id: string) => NoteMeta | undefined; clue: (id: string) => NoteMeta | undefined }) {
  const slug = index.slug, a = index.analysis
  const cols = levels.flatMap(l => a.ranked[l].map(r => ({ ...r, level: l })).sort((x, y) => x.id.localeCompare(y.id)))
  const rows = [...new Set(a.cells.map(c => c.clue))].sort()
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">No clue weighed yet: the matrix fills as the agent weighs the clues (hyp lr).</p>
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Analysis of competing hypotheses: each clue against each hypothesis</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="p-2 text-left font-medium text-muted-foreground">Clue</th>
              {cols.map(h => (
                <th key={h.id} scope="col" className={cn("min-w-20 p-2 text-center font-medium", h.status === "excluded" && "opacity-40")}>
                  <Tooltip><TooltipTrigger asChild><button type="button" onClick={() => { const n = hyp(h.id); if (n) open(slug, n.path) }} className="font-mono hover:underline">{h.id}</button></TooltipTrigger><TooltipContent>{hyp(h.id)?.title} · {h.level} · {h.status}</TooltipContent></Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(cl => {
              const n = clue(cl), status = a.cells.find(c => c.clue === cl)?.status
              return (
                <tr key={cl} className="border-b last:border-0">
                  <th scope="row" className="max-w-80 p-2 text-left font-normal">
                    <button type="button" onClick={() => n && open(slug, n.path)} className="block w-full truncate text-left hover:underline"><span className="mr-1.5 font-mono text-xs text-muted-foreground">{cl}</span>{n?.title ?? cl}</button>
                    <span className="text-xs text-muted-foreground">{status}</span>
                  </th>
                  {cols.map(h => {
                    const c = a.cells.find(x => x.clue === cl && x.hyp === h.id)
                    if (!c) return <td key={h.id} className={cn("p-1", h.status === "excluded" && "opacity-40")} />
                    const k = consistency(c.lr) as keyof typeof CNI
                    return (
                      <td key={h.id} className={cn("p-1", h.status === "excluded" && "opacity-40")}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" onClick={() => c.journal && open(slug, `Journal.md#^${c.journal}`)} aria-label={`${CNI[k].label}, likelihood ratio ${c.lr}: ${c.why}`}
                              className="flex h-9 w-full items-center justify-center gap-1 rounded-md text-xs font-medium tabular-nums" style={{ background: `color-mix(in oklch, var(${CNI[k].v}) 22%, transparent)` }}>
                              <span className="size-2 rounded-full" style={{ background: `var(${CNI[k].v})` }} aria-hidden />{k} ×{c.lr}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72">{c.why}{c.journal && <span className="block opacity-70">Journal {c.journal} · click to open</span>}</TooltipContent>
                        </Tooltip>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {Object.entries(CNI).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: `var(${c.v})` }} />{k} {c.label}</span>)}
        <span>· ×LR: the likelihood ratio, capped by what the clue rests on · a greyed column is excluded</span>
      </p>
    </div>
  )
}
