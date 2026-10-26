import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { api, type Rules } from "@/lib/studio"
import { cn } from "@/lib/utils"

// a param's value as read: on/off, none, 30–75, sentence 0.08 · comma 0.05
const show = (v: unknown): string =>
  v === true
    ? "on"
    : v === false
      ? "off"
      : v === null
        ? "none"
        : Array.isArray(v)
          ? v.join("–")
          : typeof v === "object"
            ? Object.entries(v)
                .map(([k, x]) => `${k} ${show(x)}`)
                .join(" · ")
            : String(v)
// a section's lines: a line wrapped in the file goes back onto its item ("- …", "- [ ] …")
const lines = (text: string) =>
  text
    .trim()
    .replace(/\n[ \t]+/g, " ")
    .split(/\n+/)

// The video's rule pack as Claude reads it, opened from its name in the header. Read on each opening: an edit of the
// pack or a `rules set` shows without a reload.
export function RulesDialog({ names }: { names: string[] }) {
  const [rules, setRules] = useState<Rules | null>(null)
  const [error, setError] = useState("")

  return (
    <Dialog
      onOpenChange={(o) =>
        o && api.rules().then(setRules, (e) => setError(e.message))
      }
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="cursor-pointer text-foreground/80 underline-offset-2 hover:underline"
        >
          {names.join(", ")}
        </button>
      </DialogTrigger>
      <DialogContent className="gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rules: {names.join(", ")}</DialogTitle>
          <DialogDescription>
            {error ||
              (rules
                ? rules.packs
                    .map((p) => p.description)
                    .filter(Boolean)
                    .join(" · ")
                : "Loading…")}
          </DialogDescription>
        </DialogHeader>
        {rules && (
          <div className="-mx-4 flex max-h-[65svh] flex-col gap-3 overflow-y-auto px-4 text-sm">
            <h3 className="font-semibold">Params</h3>
            {/* the params the engine follows: off ones faded, the video's own overrides outlined */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(rules.params).map(([k, v]) => (
                <Badge
                  key={k}
                  variant={k in rules.overrides ? "outline" : "secondary"}
                  title={
                    k in rules.overrides ? "Changed for this video" : undefined
                  }
                  className={cn(
                    "h-6 gap-1.5 px-2.5",
                    (v === false || v === null) && "opacity-50"
                  )}
                >
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-mono">{show(v)}</span>
                </Badge>
              ))}
            </div>
            {Object.keys(rules.overrides).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Outlined: changed for this video.
              </p>
            )}
            {rules.packs.map((p) =>
              p.body === null ? (
                <p key={p.name}>The pack {p.name} is no longer installed.</p>
              ) : (
                // the pack's Markdown: its ## headings set apart, the rest as written
                p.body.split(/^## (.*)$/m).map((x, i) =>
                  i % 2 ? (
                    <h3 key={`${p.name}${i}`} className="mt-2 font-semibold">
                      {x}
                    </h3>
                  ) : (
                    x.trim() && (
                      <ul
                        key={`${p.name}${i}`}
                        className="flex flex-col gap-1.5 pl-4 leading-relaxed"
                      >
                        {lines(x).map((l, j) => (
                          <li
                            key={j}
                            className={
                              l.startsWith("-")
                                ? "list-disc"
                                : "-ml-4 list-none"
                            }
                          >
                            {l.replace(/^- (\[ \] )?/, "")}
                          </li>
                        ))}
                      </ul>
                    )
                  )
                )
              )
            )}
            {rules.packs.map(
              (p) =>
                p.file && (
                  <p
                    key={p.file}
                    className="font-mono text-xs text-muted-foreground"
                  >
                    {p.file} ({p.origin})
                  </p>
                )
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
