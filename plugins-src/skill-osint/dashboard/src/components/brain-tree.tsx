import { ChevronRightIcon } from "lucide-react"
import { useState } from "react"

import { Icon } from "@/components/icon"
import { kindOf } from "@/components/shared-entities"
import type { CaseIndex, NoteMeta } from "@/lib/api"
import { cn } from "@/lib/utils"

const ROOT = ["Case.md", "Report.md", "Leads.md", "Journal.md"]
const ROOT_ICON: Record<string, string> = { "Case.md": "briefcase", "Report.md": "file-check", "Leads.md": "signpost", "Journal.md": "scroll-text", "Profile.md": "id-card" }
const FOLDERS = [["Entities", "boxes"], ["Clues", "search"], ["Hypotheses", "lightbulb"], ["Sources", "library"]] as const
const HYP_ICON: Record<string, string> = { active: "circle-dot", excluded: "circle-slash", retained: "circle-check" }

// The vault as a tree: the case's notes, its folders (folded, with their count), Evidence's files. An entity wears its
// kind's icon and color; a dot marks a note written while the page is open and not read yet.
export function BrainTree({ index, open, fresh, onOpen }: { index: CaseIndex; open: string | null; fresh: Set<string>; onOpen: (path: string) => void }) {
  const [shut, setShut] = useState<Set<string>>(new Set())
  const notes = index.notes, root = [...ROOT.filter(p => notes.some(n => n.path === p)), ...notes.filter(n => !n.folder && !ROOT.includes(n.path)).map(n => n.path)]
  const evidence = index.files.filter(f => f.startsWith("Evidence/"))
  const toggle = (f: string) => setShut(s => { const x = new Set(s); if (x.has(f)) x.delete(f); else x.add(f); return x })
  const item = (path: string, label: string, icon: string, color?: string, indent = false) => (
    <li key={path}>
      <button type="button" onClick={() => onOpen(path)} aria-current={open === path ? "page" : undefined} title={path}
        className={cn("flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50", indent && "pl-6", open === path && "bg-muted font-medium")}>
        <Icon name={icon} className="size-3.5 shrink-0" style={color ? { color } : undefined} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {fresh.has(path) && <span className="size-1.5 shrink-0 rounded-full bg-sky-500" aria-label="new" />}
      </button>
    </li>
  )
  const label = (n: NoteMeta) => (n.folder === "Entities" ? String(n.props.value ?? n.title) : n.title)
  const icon = (n: NoteMeta) => (n.folder === "Entities" ? kindOf(String(n.props.kind)).icon : n.folder === "Hypotheses" ? HYP_ICON[String(n.props.status)] ?? "lightbulb" : n.folder === "Sources" ? "file-text" : "search")
  return (
    <nav aria-label="Notes" className="flex flex-col gap-3">
      <ul>{root.map(p => item(p, p.replace(/\.md$/, ""), ROOT_ICON[p] ?? "file-text"))}</ul>
      {[...FOLDERS.map(([f, i]) => [f, i, notes.filter(n => n.folder === f)] as const), ["Evidence", "image", null] as const].map(([f, i, list]) => {
        const count = list ? list.length : evidence.length
        if (!count) return null
        const fold = shut.has(f), freshIn = (list ?? []).some(n => fresh.has(n.path))
        return (
          <div key={f}>
            <button type="button" onClick={() => toggle(f)} aria-expanded={!fold} className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
              <ChevronRightIcon className={cn("size-3.5 transition-transform", !fold && "rotate-90")} />
              <Icon name={i} className="size-3.5" aria-hidden />{f}
              <span className="ml-auto tabular-nums">{count}</span>
              {fold && freshIn && <span className="size-1.5 rounded-full bg-sky-500" aria-label="new notes inside" />}
            </button>
            {!fold && (
              <ul>
                {list ? [...list].sort((a, b) => label(a).localeCompare(label(b))).map(n => item(n.path, label(n), icon(n), n.folder === "Entities" ? kindOf(String(n.props.kind)).color : undefined, true))
                  : evidence.map(p => item(p, p.slice(9), /\.(jpe?g|png|webp|gif|avif)$/i.test(p) ? "image" : p.endsWith(".html") ? "globe" : "file", undefined, true))}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}
