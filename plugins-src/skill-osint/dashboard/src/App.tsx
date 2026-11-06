import { ThemeProvider } from "next-themes"
import { useEffect, useMemo, useState } from "react"

import { BasketBar } from "@/components/basket-bar"
import { CasePage } from "@/components/case-page"
import { Home } from "@/components/home"
import { NewCase } from "@/components/new-case"
import { Settings } from "@/components/settings"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ServerStopped } from "@/components/watch-settings"
import { BasketProvider, type Scope } from "@/lib/basket"
import { useRoute } from "@/lib/route"
import { STOPPED, stopped } from "@/lib/use-events"

export default function App() {
  const route = useRoute()
  // « Stop server » (Settings): the whole page says so, and nothing calls the server again
  const [off, setOff] = useState(stopped)
  useEffect(() => { const f = () => setOff(true); addEventListener(STOPPED, f); return () => removeEventListener(STOPPED, f) }, [])
  const slug = route.page === "case" ? route.slug : null
  // a case's page has its own basket; the other pages share the « all cases » one
  const scope = useMemo<Scope>(() => (slug ? { slug } : { all: true }), [slug])
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <TooltipProvider>
        <BasketProvider scope={scope}>
          {route.page === "case" ? <CasePage key={route.slug} slug={route.slug} tab={route.tab} note={route.note} /> : route.page === "new" ? <NewCase type={route.type} /> : route.page === "settings" ? <Settings /> : <Home />}
          <BasketBar />
        </BasketProvider>
        {off && <ServerStopped />}
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
