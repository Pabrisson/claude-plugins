import { BellIcon, CoinsIcon, DatabaseIcon, FlaskConicalIcon, GlobeIcon, PaletteIcon, RadarIcon, RefreshCwIcon, WalletIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Settings } from "@/lib/api"
import { date, num } from "@/lib/format"
import { useSearch } from "@/lib/store"

const WATCH = [[0, "Coupée"], [30, "30 min"], [60, "1 h"], [360, "6 h"], [720, "12 h"], [1440, "24 h"]] as const
const KEEP = [[30, "30 jours"], [90, "90 jours"], [365, "1 an"], [0, "Tout"]] as const
const clock = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })
const size = (b: number) => (b < 1e6 ? `${num(b / 1e3)} ko` : `${(b / 1e6).toFixed(1).replace(".", ",")} Mo`)

// The dashboard's settings (« Réglages », the searches folder's .settings.json, every search): the server's watch,
// the API and its automatic fetch, the Stream Estate account and the credits (the profile's), the desktop
// notifications, the reading of the news, the look and the cache. Each change is saved at once.
export function SettingsTab() {
  const { state, reload } = useSearch()
  const st = state.settings
  async function save(p: Partial<Settings>) {
    try { await api.saveSettings(p); await reload() } catch (e) { toast.error("Réglage non enregistré", { description: `Détail technique : ${(e as Error).message}` }) }
  }
  const month = new Date().toISOString().slice(0, 7), autoSpent = state.log.filter(e => e.by === "auto" && e.date.startsWith(month)).reduce((a, e) => a + (e.credits ?? 0), 0)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RadarIcon className="size-4" />Veille du serveur</CardTitle>
          <CardDescription>Gratuite : les nouveaux DPE, audits énergétiques et permis de la zone et de vos alertes, et le comptage des annonces de l'API, pour toutes les recherches.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={String(st.watch_minutes)} onValueChange={v => v && save({ watch_minutes: +v })} className="flex-wrap justify-start" aria-label="Fréquence de la veille">
            {WATCH.map(([m, l]) => <ToggleGroupItem key={m} value={String(m)}>{l}</ToggleGroupItem>)}
          </ToggleGroup>
          <Toggle id="s-pause" label="En pause" checked={st.watch_paused} disabled={st.watch_minutes === 0} onChange={v => save({ watch_paused: v })}
            hint="La veille s'arrête (DPE, audits, permis, comptage et récupération automatique de l'API) et garde sa fréquence : elle repart, tout de suite si elle est en retard, dès que vous la reprenez. « Vérifier maintenant » marche toujours." />
          <WatchNow />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><GlobeIcon className="size-4" />API Stream Estate</CardTitle>
          <CardDescription>{state.has_key ? "Les annonces de tous les portails, payées à l'annonce." : "Aucune clé : renseignez-la avec /plugin configure skill-immo@pabrisson, puis redémarrez Claude Code."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {state.test_api && (
            <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <FlaskConicalIcon className="size-4 shrink-0" />API de test : {state.test_api}. Annonces fictives, aucun crédit réel.
            </p>
          )}
          <Toggle id="s-api" label="Utiliser l'API" checked={st.api && state.has_key} disabled={!state.has_key} onChange={v => save({ api: v })}
            hint="Coupée : ni comptage, ni récupération, ni facturation ; l'actualisation ne reprend que les données ouvertes et Claude cherche les annonces sur le web. Les recherches gardent leur mode." />
          <Toggle id="s-auto" label="Récupération automatique" checked={st.auto_fetch} disabled={!state.stream_estate} onChange={v => save({ auto_fetch: v })}
            hint="À chaque veille, quand l'API a du nouveau, le serveur actualise seul les recherches en mode API, sans dépasser le budget mensuel que vous lui donnez ni votre plafond. Vos alertes s'appliquent aux annonces récupérées." />
          {st.auto_fetch && (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="s-auto-credits">Budget de la récupération automatique</FieldLabel>
                <FieldDescription>{num(autoSpent)} crédit{autoSpent > 1 ? "s" : ""} dépensé{autoSpent > 1 ? "s" : ""} ainsi ce mois-ci (1 crédit = {state.usage.eur_per_credit.toFixed(2).replace(".", ",")} €).</FieldDescription>
              </FieldContent>
              <NumberSetting id="s-auto-credits" value={st.auto_credits} suffix="crédits / mois" onSave={v => save({ auto_credits: v })} />
            </Field>
          )}
        </CardContent>
      </Card>

      {state.has_key && <AccountCard />}
      <CreditsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellIcon className="size-4" />Notifications de bureau</CardTitle>
          <CardDescription>Envoyées par le serveur quand la veille trouve des nouveautés que vos alertes retiennent.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Toggle id="s-notify" label="Notifications" checked={st.notify} onChange={v => save({ notify: v })} />
          <Toggle id="s-sound" label="Son" checked={st.sound} disabled={!st.notify} onChange={v => save({ sound: v })} />
          <Toggle id="s-quiet" label="Heures calmes" checked={!!st.quiet} disabled={!st.notify} onChange={v => save({ quiet: v ? ["22:00", "08:00"] : null })}
            hint="Aucune notification pendant ces heures ; les nouveautés attendent dans le suivi." />
          {st.quiet && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              De<Input type="time" className="h-8 w-28" value={st.quiet[0]} onChange={e => e.target.value && save({ quiet: [e.target.value, st.quiet![1]] })} aria-label="Début des heures calmes" />
              à<Input type="time" className="h-8 w-28" value={st.quiet[1]} onChange={e => e.target.value && save({ quiet: [st.quiet![0], e.target.value] })} aria-label="Fin des heures calmes" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCwIcon className="size-4" />Lecture et historique</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Toggle id="s-read" label="Marquer une nouveauté comme lue quand je l'ouvre" checked={st.read_on_open} onChange={v => save({ read_on_open: v })}
            hint="Sinon, seul « Tout marquer comme lu » (ou son bouton) la marque." />
          <Field>
            <FieldLabel>Garder les nouveautés</FieldLabel>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={String(st.keep_days)} onValueChange={v => v && save({ keep_days: +v })} className="flex-wrap justify-start" aria-label="Durée de conservation">
              {KEEP.map(([d, l]) => <ToggleGroupItem key={d} value={String(d)}>{l}</ToggleGroupItem>)}
            </ToggleGroup>
            <FieldDescription>Les plus anciennes disparaissent du suivi et de la cloche ; l'historique des prix des annonces reste.</FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><PaletteIcon className="size-4" />Apparence et données</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ThemeField />
          <CacheField />
        </CardContent>
      </Card>
    </div>
  )
}

// a switch with its label and hint
function Toggle({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hint && <FieldDescription>{hint}</FieldDescription>}
      </FieldContent>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </Field>
  )
}

// a number saved when the field is left (or on Enter)
export function NumberSetting({ id, value, suffix, onSave, step = "1" }: { id: string; value: number; suffix: string; onSave: (v: number) => void; step?: string }) {
  const [v, setV] = useState(String(value)), [was, setWas] = useState(value)
  if (value !== was) { setWas(value); setV(String(value)) }
  const commit = () => { if (v !== "" && Number.isFinite(+v) && +v >= 0 && +v !== value) onSave(+v); else setV(String(value)) }
  return (
    <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
      <Input id={id} type="number" min={0} step={step} inputMode="decimal" className="h-8 w-24 text-right" value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => e.key === "Enter" && commit()} />{suffix}
    </span>
  )
}

// the last and the next watch, and one now
function WatchNow() {
  const { state, reload } = useSearch()
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try { await api.watchNow(); await reload(); toast.success("Veille faite", { description: "Ses nouveautés sont dans le suivi." }) } catch (e) { toast.error("La veille a échoué", { description: `Détail technique : ${(e as Error).message}` }) }
    setBusy(false)
  }
  const w = state.watch
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        {w.last ? `Dernière : ${clock.format(new Date(w.last))}` : "Pas encore faite depuis le démarrage du serveur"}
        {w.next ? ` · prochaine : ${clock.format(new Date(w.next))}` : " · veille coupée"}
      </span>
      <Button size="sm" variant="outline" disabled={busy || w.running} onClick={go}>{(busy || w.running) && <Spinner data-icon="inline-start" />}Vérifier maintenant</Button>
    </div>
  )
}

// the theme, in this browser: dark by default, light, or the system's
function ThemeField() {
  const { theme, setTheme } = useTheme()
  return (
    <Field>
      <FieldLabel>Thème</FieldLabel>
      <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={theme ?? "dark"} onValueChange={v => v && setTheme(v)} className="justify-start" aria-label="Thème">
        <ToggleGroupItem value="dark">Sombre</ToggleGroupItem>
        <ToggleGroupItem value="light">Clair</ToggleGroupItem>
        <ToggleGroupItem value="system">Système</ToggleGroupItem>
      </ToggleGroup>
      <FieldDescription>Pour ce navigateur.</FieldDescription>
    </Field>
  )
}

// the open data cache: its size, emptied once confirmed (the credits log stays)
function CacheField() {
  const [c, setC] = useState<{ files: number; bytes: number } | null>(null)
  useEffect(() => { api.cache().then(setC, () => {}) }, [])
  async function clear() {
    try { setC(await api.cache(true)); toast.success("Cache vidé", { description: "Les données ouvertes seront retéléchargées au besoin." }) } catch (e) { toast.error("Le cache n'a pas été vidé", { description: `Détail technique : ${(e as Error).message}` }) }
  }
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel className="flex items-center gap-2"><DatabaseIcon className="size-4" />Cache des données ouvertes</FieldLabel>
        <FieldDescription>{c ? `${num(c.files)} fichiers, ${size(c.bytes)}` : "…"} : DVF, DPE, quartier, cartes. Le journal des crédits reste.</FieldDescription>
      </FieldContent>
      <AlertDialog>
        <AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={!c?.files}>Vider le cache</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vider le cache ?</AlertDialogTitle>
            <AlertDialogDescription>Les données ouvertes seront retéléchargées à la prochaine actualisation, plus lentement. Les alertes hors zone reprennent leur relevé : les DPE parus entre-temps ne seront pas signalés.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={clear}>Vider</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Field>
  )
}

// a change of the profile (the credits, the account), saved then shown
function useSaveProfile() {
  const { reload, setProfile } = useSearch()
  return async (p: Parameters<typeof api.saveProfile>[0], done?: string) => {
    try { setProfile(await api.saveProfile(p)); await reload(); if (done) toast.success(done) } catch (e) { toast.error("Non enregistré", { description: `Détail technique : ${(e as Error).message}` }) }
  }
}

// the credits, for every search: the monthly cap, the price of one, the most a fetch takes
function CreditsCard() {
  const { state } = useSearch()
  const save = useSaveProfile(), u = state.usage
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CoinsIcon className="size-4" />Crédits</CardTitle>
        <CardDescription>Pour toutes les recherches. Une annonce récupérée coûte un crédit.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field orientation="horizontal">
          <FieldContent><FieldLabel htmlFor="c-cap">Plafond mensuel</FieldLabel><FieldDescription>Au-delà, le moteur s'arrête et demande votre accord.</FieldDescription></FieldContent>
          <NumberSetting id="c-cap" value={u.cap} suffix="crédits" onSave={v => save({ monthly_credit_cap: v })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent><FieldLabel htmlFor="c-rate">Prix d'un crédit</FieldLabel><FieldDescription>0,01 € à l'unité ; moins avec un forfait.</FieldDescription></FieldContent>
          <NumberSetting id="c-rate" value={u.eur_per_credit} step="0.001" suffix="€" onSave={v => save({ eur_per_credit: v })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent><FieldLabel htmlFor="c-max">Annonces au plus par récupération</FieldLabel></FieldContent>
          <NumberSetting id="c-max" value={u.max_fetch} suffix="annonces" onSave={v => save({ max_fetch: Math.round(v) })} />
        </Field>
      </CardContent>
    </Card>
  )
}

// The account as Stream Estate's console shows it (pay as you go): the euros deposited and « API items returned », the
// items billed since it opened. The API gives neither: the user types them once, then adds a top-up when they put money
// in, or sets the console's count again; the items the log counts since come off. Out at the pace of the last 30 days.
const BILLING = "https://stream.estate/console/billing"
const Billing = ({ children }: { children: React.ReactNode }) => <a href={BILLING} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{children}</a>
export function AccountCard() {
  const { state } = useSearch()
  const onSave = useSaveProfile(), [now] = useState(() => Date.now())
  const a = state.usage.account, rate = state.usage.eur_per_credit
  const pace = Object.entries(state.usage.daily).filter(([d]) => d >= new Date(now - 30 * 864e5).toISOString().slice(0, 10)).reduce((n, [, v]) => n + v, 0) / 30
  const out = a && pace > 0 && a.left_items > 0 ? now + (a.left_items / pace) * 864e5 : null
  const [topup, setTopup] = useState(""), [items, setItems] = useState("")
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><WalletIcon className="size-4" />Compte Stream Estate</CardTitle>
        <CardDescription>Paiement à l'usage : la <Billing>console de facturation</Billing> montre l'argent déposé et les requêtes totales, les crédits consommés depuis l'ouverture ({rate.toFixed(2).replace(".", ",")} € le crédit). L'API ne donne ni l'un ni l'autre.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {a ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold tracking-tight">{a.left.toFixed(2).replace(".", ",")} €</span>
              <span className="text-muted-foreground">{num(a.left_items)} crédits</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Part du dépôt consommée" aria-valuenow={a.used * rate} aria-valuemin={0} aria-valuemax={a.deposited}>
              <div className={a.left_items < 50 ? "h-full bg-destructive" : "h-full bg-foreground"} style={{ width: `${a.deposited ? Math.min(100, (a.used * rate / a.deposited) * 100) : 100}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {a.deposited.toFixed(2).replace(".", ",")} € déposés · {num(a.items)} crédit{a.items > 1 ? "s" : ""} consommé{a.items > 1 ? "s" : ""} à la console le {date(a.at)} · {num(a.since)} depuis selon le journal.{out ? ` À ce rythme, épuisé vers le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(out)}.` : ""}
            </p>
            {a.topups.length > 0 && <p className="text-xs text-muted-foreground">Recharges : {a.topups.slice(-3).reverse().map(t => `+${t.eur.toFixed(2).replace(".", ",")} € le ${date(t.date)}`).join(" · ")}</p>}
            <form className="flex flex-wrap items-center gap-2" onSubmit={async e => { e.preventDefault(); await onSave({ account_set: { topup: +topup } }, `Recharge de ${topup} € ajoutée`); setTopup("") }}>
              <FieldLabel htmlFor="c-topup" className="min-w-40">J'ai rajouté</FieldLabel>
              <Input id="c-topup" type="number" min={0} step="0.01" inputMode="decimal" className="h-8 w-24 text-right" value={topup} onChange={e => setTopup(e.target.value)} placeholder="30" />€
              <Button size="sm" variant="outline" type="submit" disabled={!(+topup > 0)}>Ajouter la recharge</Button>
            </form>
            <form className="flex flex-wrap items-center gap-2" onSubmit={async e => { e.preventDefault(); await onSave({ account_set: { items: +items } }, "Compte recalé sur la console"); setItems("") }}>
              <FieldLabel htmlFor="c-items" className="min-w-40">Requêtes totales</FieldLabel>
              <Input id="c-items" type="number" min={0} step={1} inputMode="numeric" className="h-8 w-24 text-right" value={items} onChange={e => setItems(e.target.value)} placeholder={String(a.used)} />
              <Button size="sm" variant="outline" type="submit" disabled={items === "" || !(+items >= 0)}>Recaler sur la console</Button>
            </form>
          </>
        ) : <AccountForm onSave={x => onSave({ account_set: x }, "Compte enregistré")} />}
      </CardContent>
    </Card>
  )
}

// the console's two figures, the first time
function AccountForm({ onSave, footer }: { onSave: (x: { deposited: number; items: number }) => void; footer?: (ready: boolean) => React.ReactNode }) {
  const [deposited, setDeposited] = useState(""), [items, setItems] = useState("")
  const ready = deposited !== "" && +deposited >= 0 && items !== "" && +items >= 0
  return (
    <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (ready) onSave({ deposited: +deposited, items: +items }) }}>
      <Field>
        <FieldLabel htmlFor="a-deposited">Argent déposé sur le compte</FieldLabel>
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><Input id="a-deposited" type="number" min={0} step="0.01" inputMode="decimal" className="w-32" value={deposited} onChange={e => setDeposited(e.target.value)} placeholder="5" autoFocus />€, au total</span>
      </Field>
      <Field>
        <FieldLabel htmlFor="a-items">Requêtes totales</FieldLabel>
        <Input id="a-items" type="number" min={0} step={1} inputMode="numeric" className="w-32" value={items} onChange={e => setItems(e.target.value)} placeholder="4" />
        <FieldDescription>Les crédits consommés depuis l'ouverture du compte (« API items returned » dans la <Billing>console de facturation</Billing>).</FieldDescription>
      </Field>
      {footer ? footer(ready) : <Button type="submit" size="sm" className="self-start" disabled={!ready}>Enregistrer</Button>}
    </form>
  )
}

// At the dashboard's start, with a key and no account yet: the console's figures, asked once (« Plus tard » waits for
// the next session of this browser tab)
const LATER = "immo:account-later"
export function AccountDialog({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let later = false
    try { later = !!sessionStorage.getItem(LATER) } catch { /* private window */ }
    if (!later) api.state().then(s => setOpen(s.has_key && !s.usage.account), () => {})
  }, [])
  const close = () => { try { sessionStorage.setItem(LATER, "1") } catch { /* private window */ } setOpen(false) }
  async function save(x: { deposited: number; items: number }) {
    try { await api.saveProfile({ account_set: x }); setOpen(false); onSaved?.(); toast.success("Compte enregistré", { description: "Réglages en retire ce que vous dépensez." }) } catch (err) { toast.error("Non enregistré", { description: `Détail technique : ${(err as Error).message}` }) }
  }
  return (
    <Dialog open={open} onOpenChange={o => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Votre compte Stream Estate</DialogTitle>
          <DialogDescription>L'API ne donne pas le solde. La <Billing>console de facturation</Billing> de Stream Estate montre l'argent déposé et les requêtes totales : recopiez-les, le dashboard suivra le solde dans « Réglages ».</DialogDescription>
        </DialogHeader>
        <AccountForm onSave={save} footer={ready => (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Plus tard</Button>
            <Button type="submit" disabled={!ready}>Enregistrer</Button>
          </DialogFooter>
        )} />
      </DialogContent>
    </Dialog>
  )
}
