import { MoonIcon, PlusIcon, RefreshCwIcon, ScanSearchIcon, SearchIcon, SettingsIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FakeSwitch } from "@/components/fake-switch"
import { api, type AppState } from "@/lib/api"
import { t } from "@/lib/i18n"
import { TONE } from "@/lib/tones"

const NONE: AppState = { home: "", version: "", developer: false, fake: false, fake_available: false, fake_url: null, busy: false }
let cache = NONE, state: Promise<AppState> | null = null
const subs = new Set<() => void>()
export const appState = () => (state ??= api.state().then(s => (cache = s), () => NONE))
// a new state (the Fake APIs switch, developer mode): every bar and Settings follow
export function setAppState(s: AppState) { cache = s; state = Promise.resolve(s); subs.forEach(f => f()) }
export function useAppState() {
  const [s, set] = useState(cache)
  useEffect(() => {
    appState().then(() => set(cache))
    const f = () => set(cache)
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  return s
}

// The sticky bar on every page: « OSINT » home, the page's search, New case, Settings, the theme, « Fake APIs » in the
// demo (an OSINT_BASE_* variable is set: every service answers from the tests' fixtures) with its switch in developer mode
export function TopBar({ search, children }: { search?: { value: string; onChange: (v: string) => void; placeholder?: string }; children?: ReactNode }) {
  const { fake, developer, fake_available } = useAppState()
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-4">
        <a href="#/" className="flex shrink-0 items-center gap-2 rounded-md pr-1 font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"><ScanSearchIcon className="size-4" /></span>
          <span className="max-sm:sr-only">OSINT</span>
        </a>
        {fake && (
          <Tooltip>
            <TooltipTrigger asChild><Badge className={TONE.amber}>{t("Fake APIs")}</Badge></TooltipTrigger>
            <TooltipContent>{t("Every service answers from the tests' recorded fixtures: fictitious data, nothing leaves this machine. Switch them off in the bar or in Settings › Development.")}</TooltipContent>
          </Tooltip>
        )}
        {developer && fake_available && <FakeSwitch />}
        {children}
        <span className="flex-1" />
        {search && (
          <InputGroup className="w-40 sm:w-64">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput type="search" value={search.value} onChange={e => search.onChange(e.target.value)} placeholder={search.placeholder ?? t("Search cases")} aria-label={search.placeholder ?? t("Search cases")} />
          </InputGroup>
        )}
        <Button size="sm" asChild><a href="#/new"><PlusIcon data-icon="inline-start" /><span className="max-sm:sr-only">{t("New case")}</span></a></Button>
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" asChild><a href="#/settings" aria-label={t("Settings")}><SettingsIcon /></a></Button></TooltipTrigger>
          <TooltipContent>{t("Settings")}</TooltipContent>
        </Tooltip>
        <ThemeButton />
      </div>
      <StaleBar />
    </header>
  )
}

export function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme()
  const label = resolvedTheme === "dark" ? t("Light theme") : t("Dark theme")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>{resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// The cases are live; only the dashboard itself cannot follow: when the server serves another build than this page's
// (rebuilt, plugin updated), a bar offers to reload. Checked every 30 s and when the window comes back.
const bundle = (html: string) => /\/assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null
function StaleBar() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const mine = bundle(document.documentElement.innerHTML)
    if (!mine) return // npm run dev
    const check = () => fetch("/", { cache: "no-store" }).then(r => r.text()).then(h => { const b = bundle(h); if (b && b !== mine) setStale(true) }, () => {})
    const t = setInterval(check, 30_000)
    addEventListener("focus", check)
    return () => { clearInterval(t); removeEventListener("focus", check) }
  }, [])
  if (!stale) return null
  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-primary px-3 py-1.5 text-sm text-primary-foreground">
      <RefreshCwIcon className="size-4" />{t("A new version of the dashboard is ready.")}
      <Button size="xs" variant="secondary" onClick={() => location.reload()}>{t("Reload")}</Button>
    </div>
  )
}
