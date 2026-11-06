import { Icon } from "@/components/icon"
import { fileUrl, type CaseIndex, type OsintEvent } from "@/lib/api"
import { clock, EVENT_ICON, who } from "@/lib/format"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const plain = (s: string) => s.replace(/!?\[\[([^\]|]*?)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, a) => a ?? t).replace(/\s*\^[\w-]+$/, "").replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[.\]\s+)?/, "")
const BARE: Record<string, string> = { "hyp.rank": "ranked the hypotheses again", "case.new": "created the case", "phase.end": "phase done" }
export const eventText = (e: OsintEvent) =>
  !e.text && BARE[e.kind] ? t(BARE[e.kind]) : e.kind === "note.write" ? (e.by === "vault" ? e.text ?? t("edited {path}", { path: e.path ?? "" }) : t("wrote {path}", { path: e.path ?? "" })) : e.kind === "progress" && e.of ? `${e.text ?? t("progress")} (${e.n}/${e.of})` : e.text ?? e.kind

// Right of the note: who links to it (with the line), what it links to, and the live activity of the investigation
// (each step of a sub-case named, its notes opened in it: onOpenIn)
export function SidePanel({ index, path, events, onOpen, root, titles = {}, onOpenIn }: {
  index: CaseIndex; path: string | null; events: OsintEvent[]; onOpen: (p: string, anchor?: string | null) => void
  root?: string; titles?: Record<string, string>; onOpenIn?: (slug: string | null, path: string) => void
}) {
  const back = path ? index.backlinks[path] ?? [] : []
  const meta = index.notes.find(n => n.path === path)
  const out = [...new Set((meta?.links ?? []).map(l => l.path).filter((p): p is string => !!p && p !== path))]
  const title = (p: string) => index.notes.find(n => n.path === p)?.title ?? p
  const feed = [...events].reverse()
  return (
    <div className="flex flex-col gap-5 text-sm">
      {path && (
        <section aria-labelledby="bl">
          <h2 id="bl" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Icon name="link-2" className="size-3.5" />{t("Backlinks")} <span className="tabular-nums">{back.length}</span></h2>
          {!back.length ? <p className="text-xs text-muted-foreground">{t("No note links here.")}</p> : (
            <ul className="flex flex-col gap-1">
              {back.map((b, i) => (
                <li key={i}>
                  <button type="button" onClick={() => onOpen(b.from)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted">
                    <span className="block truncate font-medium">{title(b.from)}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{plain(b.text)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {path && out.length > 0 && (
        <section aria-labelledby="ol">
          <h2 id="ol" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Icon name="arrow-up-right" className="size-3.5" />{t("Links")} <span className="tabular-nums">{out.length}</span></h2>
          <ul className="flex flex-col">
            {out.map(p => <li key={p}><button type="button" onClick={() => onOpen(p)} className="w-full truncate rounded-md px-2 py-1 text-left hover:bg-muted" title={p}>{title(p)}</button></li>)}
          </ul>
        </section>
      )}
      <section aria-labelledby="ac" className="min-h-0">
        <h2 id="ac" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Icon name="activity" className="size-3.5" />{t("Activity")}</h2>
        {!feed.length && <p className="text-xs text-muted-foreground">{t("Nothing yet: the agent's and the engine's steps show here as they happen.")}</p>}
        <ol className="flex flex-col gap-1" aria-live="off">
          {feed.slice(0, 120).map((e, i) => {
            const fail = e.kind === "fail", pdf = e.kind === "export" && !!e.path, open = e.kind === "note.write" && e.path && !e.deleted
            const sub = e.case && root && e.case !== root ? e.case : null
            const body = (
              <>
                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", fail ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : e.by === "vault" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-muted text-muted-foreground")}>
                  <Icon name={EVENT_ICON[e.kind] ?? "circle"} className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground"><span className="font-medium text-foreground">{who(e)}</span> · {clock(e.t)}{sub && <> · <span className="inline-flex max-w-full items-center gap-0.5 align-bottom"><Icon name="folder-tree" className="size-3 shrink-0" aria-hidden /><span className="truncate">{titles[sub] ?? sub}</span></span></>}</span>
                  <span className={cn("block break-words", fail && "text-rose-700 dark:text-rose-300")}>{eventText(e)}</span>
                </span>
              </>
            )
            return (
              <li key={`${e.t}-${i}`}>
                {pdf ? <a href={fileUrl(e.case ?? index.slug, e.path!)} target="_blank" rel="noreferrer" className="flex w-full gap-2 rounded-md p-1.5 text-left hover:bg-muted">{body}</a>
                  : open ? <button type="button" onClick={() => (onOpenIn ? onOpenIn(sub, e.path!) : onOpen(e.path!))} className="flex w-full gap-2 rounded-md p-1.5 text-left hover:bg-muted">{body}</button>
                  : <div className={cn("flex gap-2 rounded-md p-1.5", fail && "bg-rose-500/10")}>{body}</div>}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
