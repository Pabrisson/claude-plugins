import type { CaseIndex, CaseSummary } from "@/lib/api"

// The folder's investigations: each case at a top (no parent, or its parent gone to .trash) with the cases below it,
// depth first in the order they were made. The home page shows one card per investigation.
export type Below = CaseSummary & { depth: number }
export type Investigation = { root: CaseSummary; below: Below[]; all: CaseSummary[] }
export function investigations(cases: CaseSummary[]): Investigation[] {
  const by = new Map(cases.map(c => [c.slug, c])), kids = new Map<string, CaseSummary[]>()
  for (const c of cases) if (c.parent && c.parent !== c.slug && by.has(c.parent)) kids.set(c.parent, [...(kids.get(c.parent) ?? []), c])
  return cases.filter(c => !c.parent || !by.has(c.parent)).map(root => {
    const below: Below[] = [], seen = new Set([root.slug])
    const walk = (s: string, depth: number) => {
      for (const k of [...(kids.get(s) ?? [])].sort((a, b) => a.created.localeCompare(b.created))) {
        if (seen.has(k.slug)) continue
        seen.add(k.slug); below.push({ ...k, depth }); walk(k.slug, depth + 1)
      }
    }
    walk(root.slug, 1)
    return { root, below, all: [root, ...below] }
  })
}
// an investigation as one card: the most active status of its cases (running, then blocked, else its top case's),
// their latest activity, their counts and news added up; its picture from the first case that has one
export function aggregate({ root, all }: Investigation): CaseSummary & { thumbCase: string } {
  const status = all.some(c => c.status === "running") ? "running" : all.some(c => c.status === "blocked") ? "blocked" : root.status
  const last = all.map(c => c.last).filter(e => !!e).sort((a, b) => b!.t.localeCompare(a!.t))[0] ?? null
  const sum = (k: keyof CaseSummary["counts"]) => all.reduce((n, c) => n + c.counts[k], 0)
  const pic = all.find(c => c.thumb)
  return { ...root, status, last, new: all.reduce((n, c) => n + c.new, 0), thumb: pic?.thumb ?? null, thumbCase: pic?.slug ?? root.slug, counts: { entities: sum("entities"), sources: sum("sources"), leads_open: sum("leads_open") } }
}

// a case of the investigation shown in its page: its index, where it sits, its title (the top case first)
export type TreeCase = { slug: string; index: CaseIndex; parent: string | null; depth: number; title: string }
export const titleOf = (ix: CaseIndex) => ix.notes.find(n => n.path === "Case.md")?.title ?? ix.slug
export const treeOf = (ix: CaseIndex): TreeCase[] => [
  { slug: ix.slug, index: ix, parent: null, depth: 0, title: titleOf(ix) },
  ...(ix.subcases ?? []).map(s => ({ slug: s.slug, index: s, parent: s.parent, depth: s.depth, title: titleOf(s) })),
]
