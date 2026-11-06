import { useState, type ReactNode } from "react"
import { toast } from "sonner"

import { setAppState, useAppState } from "@/components/top-bar"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Switch } from "@/components/ui/switch"
import { api, type AppState } from "@/lib/api"
import { t } from "@/lib/i18n"

// Going from the fake APIs to the real services while a watch is armed or a command runs asks first: the real
// services get called. `go` runs the change (a call that answers with the new state); `real` says it leaves the fakes.
export function useFakeGuard() {
  const [pending, setPending] = useState<(() => Promise<AppState>) | null>(null)
  const state = useAppState()
  async function change(real: boolean, go: () => Promise<AppState>) {
    if (real) {
      const w = await api.watch().catch(() => null)
      if (state.busy || w?.running || w?.cases.some(c => c.armed)) return setPending(() => go)
    }
    await apply(go)
  }
  async function apply(go: () => Promise<AppState>) {
    try { setAppState(await go()) } catch (e) { toast.error(t("Not changed"), { description: (e as Error).message }) }
  }
  const dialog: ReactNode = (
    <AlertDialog open={!!pending} onOpenChange={o => !o && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Call the real services?")}</AlertDialogTitle>
          <AlertDialogDescription>{t("The real services will be called: by the watched cases' passes and by every command from now on. A command already running ends on the fake APIs.")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Keep the fake APIs")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { const go = pending; setPending(null); if (go) void apply(go) }}>{t("Use the real services")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { change, dialog }
}

// the bar's « Fake APIs » switch, shown in developer mode on a server that has fake APIs
export function FakeSwitch() {
  const { fake, fake_url } = useAppState(), { change, dialog } = useFakeGuard()
  return (
    <>
      {!fake && <span className="text-xs font-medium text-muted-foreground max-sm:sr-only" aria-hidden>{t("Fake APIs off")}</span>}
      <Switch size="sm" checked={fake} onCheckedChange={on => change(!on, () => api.fake(on))} aria-label={t("Fake APIs")}
        title={fake ? t("On: the services answer from fake APIs. Off: the real services are called") : t("Off: the real services are called. On: the fake APIs at {url}", { url: fake_url ?? "" })} />
      {dialog}
    </>
  )
}
