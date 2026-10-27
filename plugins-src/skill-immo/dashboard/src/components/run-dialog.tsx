import { createContext, useContext, useState, type ReactNode } from "react"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { api, type Estimate, type RunResult } from "@/lib/api"
import { credits as fmtCredits } from "@/lib/format"

type Job = { cmd: string; slug?: string; args?: Record<string, string | number | boolean>; label: string }
type Pending = Job & { estimate: Estimate; resolve: (ok: boolean) => void }

// Runs an engine command from the dashboard. A paid one asks the engine for its estimate first and, unless it costs
// nothing, waits for the user's yes in a dialog: the credits, the euros, what is left of the monthly cap, or « coût
// inconnu ». The key stays in the engine, which applies the same rules as for Claude.
const RunContext = createContext<(job: Job) => Promise<boolean>>(async () => false)
export const useRun = () => useContext(RunContext)

const lastLine = (s: string) => s.split("\n").filter(Boolean).at(-1) ?? ""
// what went wrong, in French: the engine's exit codes, else its message (technical, in English)
const failure = (r: RunResult) => ({
  2: "Cette action attend votre accord : relancez-la depuis le dashboard ou demandez-la à Claude.",
  3: "Stream Estate est indisponible (plus de crédits ou pas de clé) : demandez à Claude, il cherchera sans (mode assisté).",
  4: "Stream Estate ne connaît pas cette annonce : ajoutez-la par « Ajouter », Claude la lira.",
}[r.code] ?? `Échec. Détail technique : ${lastLine(r.err).replace(/^error: /, "")}`)

export function RunProvider({ children, onDone }: { children: ReactNode; onDone: () => void | Promise<void> }) {
  const [pending, setPending] = useState<Pending | null>(null)

  async function execute(job: Job, extra: { spend?: number; accept_unknown?: boolean } = {}) {
    const id = toast.loading(`${job.label}…`)
    const r = await api.run({ cmd: job.cmd, slug: job.slug, args: { ...job.args, ...(extra.spend ? { spend: extra.spend } : {}) }, accept_unknown: extra.accept_unknown })
    if (r.code === 0) toast.success(job.label, { id })
    else toast.error(job.label, { id, description: failure(r) })
    await onDone()
    return r.code === 0
  }

  async function run(job: Job) {
    const r = await api.run({ cmd: job.cmd, slug: job.slug, args: job.args, estimate: true })
    // a free path (classic mode, nothing to fetch) ran in full
    if (!r.estimate) {
      if (r.code === 0) { toast.success(job.label); await onDone(); return true }
      toast.error(job.label, { description: failure(r) })
      return false
    }
    if (r.estimate.credits === 0) return execute(job)
    const ok = await new Promise<boolean>(resolve => setPending({ ...job, estimate: r.estimate!, resolve }))
    setPending(null)
    return ok ? execute(job, r.estimate.unknown ? { accept_unknown: true } : { spend: r.estimate.credits! }) : false
  }

  const e = pending?.estimate
  return (
    <RunContext.Provider value={run}>
      {children}
      <AlertDialog open={!!pending} onOpenChange={open => !open && pending?.resolve(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              {e?.unknown
                ? "Coût inconnu : cette fonction de Stream Estate n'a pas encore été mesurée. Elle est probablement gratuite, mais ce n'est pas garanti."
                : e && `Coût estimé : ${fmtCredits(e.credits ?? 0, (e.eur ?? 0) / (e.credits || 1) || 0.01)}.`}{" "}
              {e && `Il reste ${e.remaining} crédits sur le plafond mensuel de ${e.cap} (${e.spent} dépensés ce mois).`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => pending?.resolve(false)}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending?.resolve(true)}>{e?.unknown ? "Lancer quand même" : `Dépenser ${e?.credits} crédits`}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RunContext.Provider>
  )
}
