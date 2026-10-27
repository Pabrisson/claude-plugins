import { BarChart3Icon, ListIcon, MapIcon, PlusIcon, ReceiptEuroIcon, RouteIcon, ScaleIcon } from "lucide-react"
import { ThemeProvider } from "next-themes"
import { useEffect, useState } from "react"

import { CompareTab } from "@/components/compare-tab"
import { CostsTab } from "@/components/costs-tab"
import { Dossier } from "@/components/dossier"
import { FollowTab } from "@/components/follow-tab"
import { ListingList } from "@/components/listing-list"
import { MapView } from "@/components/map-view"
import { MarketTab } from "@/components/market-tab"
import { RunProvider } from "@/components/run-dialog"
import { NewSearch, ThemeButton, TopBar } from "@/components/top-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, slugOfUrl, type Profile, type SearchData, type SearchSummary, type State } from "@/lib/api"
import { date } from "@/lib/format"
import { SearchProvider, useSearch } from "@/lib/store"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <TooltipProvider>
        {slugOfUrl() ? <SearchPage slug={slugOfUrl()!} /> : <Home />}
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}

function SearchPage({ slug }: { slug: string }) {
  const [boot, setBoot] = useState<{ data: SearchData; state: State; profile: Profile; lastVisit: string | null } | { error: string } | null>(null)
  useEffect(() => {
    // the visit is recorded once the page has what changed since the previous one
    Promise.all([api.search(slug), api.state(), api.profile(), api.visit(slug)])
      .then(([data, state, profile, v]) => setBoot({ data, state, profile, lastVisit: v.last_visit }), e => setBoot({ error: e.message }))
  }, [slug])
  if (!boot) return <div className="grid h-dvh grid-rows-[auto_1fr] gap-2 p-3"><Skeleton className="h-12" /><Skeleton /></div>
  if ("error" in boot) return <Home error={`Recherche « ${slug} » introuvable (${boot.error}).`} />
  return (
    <SearchProvider slug={slug} initial={boot.data} state={boot.state} profile={boot.profile} lastVisit={boot.lastVisit}>
      <Workspace />
    </SearchProvider>
  )
}

const VIEWS = [
  { id: "listings", label: "Annonces", icon: ListIcon },
  { id: "map", label: "Carte", icon: MapIcon, mobileOnly: true },
  { id: "market", label: "Marché", icon: BarChart3Icon },
  { id: "compare", label: "Comparer", icon: ScaleIcon },
  { id: "follow", label: "Suivi", icon: RouteIcon },
  { id: "costs", label: "Coûts API", icon: ReceiptEuroIcon },
] as const

// A + C: the map and the list side by side (tabs on a phone), each listing's dossier on top; market, comparison,
// follow-up and API costs as tabs
function Workspace() {
  const { reload, compare } = useSearch()
  const mobile = useIsMobile()
  const [view, setView] = useState<string>("listings")
  const views = VIEWS.filter(v => mobile || !("mobileOnly" in v)).filter(v => !mobile || v.id !== "costs")
  return (
    <RunProvider onDone={reload}>
      <div className="flex h-dvh flex-col">
        <TopBar />
        <Tabs value={view} onValueChange={setView} className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" className="hidden w-full justify-start rounded-none border-b bg-card px-3 md:flex">
            {views.map(v => (
              <TabsTrigger key={v.id} value={v.id} className="flex-none"><v.icon />{v.label}{v.id === "compare" && compare.length > 0 && <Badge variant="secondary">{compare.length}</Badge>}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="listings" className="min-h-0">
            <div className="grid h-full md:grid-cols-[1fr_minmax(380px,440px)]">
              {!mobile && <MapView className="relative" />}
              <div className="overflow-y-auto border-l p-3 pb-20 md:pb-3"><ListingList /></div>
            </div>
          </TabsContent>
          {mobile && <TabsContent value="map" className="relative min-h-0"><MapView className="absolute inset-0 bottom-16" /></TabsContent>}
          <TabsContent value="market" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><MarketTab /></TabsContent>
          <TabsContent value="compare" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><CompareTab /></TabsContent>
          <TabsContent value="follow" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><FollowTab /></TabsContent>
          <TabsContent value="costs" className="min-h-0 overflow-y-auto"><CostsTab /></TabsContent>
        </Tabs>
        {mobile && (
          <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)]" aria-label="Vues">
            {views.map(v => (
              <button key={v.id} type="button" onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined}
                className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground", view === v.id && "text-foreground")}>
                <v.icon className="size-5" />{v.label}
              </button>
            ))}
          </nav>
        )}
        <Dossier />
      </div>
    </RunProvider>
  )
}

function Home({ error }: { error?: string }) {
  const [list, setList] = useState<SearchSummary[] | null>(null), [stream, setStream] = useState(false)
  useEffect(() => {
    api.searches().then(setList, () => setList([]))
    api.state().then(s => setStream(s.stream_estate), () => {})
  }, [])
  const trigger = <Button><PlusIcon data-icon="inline-start" />Nouvelle recherche</Button>
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recherche d'appartement</h1>
          <p className="text-sm text-muted-foreground">{stream ? "Stream Estate activé" : "Mode classique : open data et annonces trouvées par Claude"}</p>
        </div>
        <span className="flex gap-1.5"><NewSearch streamEstate={stream} trigger={trigger} /><ThemeButton /></span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {list === null ? <Skeleton className="h-24" /> : list.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map(s => (
            <a key={s.slug} href={`/${s.slug}/`} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader>
                  <CardTitle>{s.label}</CardTitle>
                  <CardDescription>{s.zone} · {s.online} annonce{s.online > 1 ? "s" : ""} en ligne · créée le {date(s.created)}</CardDescription>
                  <Badge variant={s.mode === "stream-estate" ? "default" : "secondary"} className="w-fit">{s.mode === "stream-estate" ? "Stream Estate" : "Classique"}</Badge>
                </CardHeader>
              </Card>
            </a>
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader><EmptyTitle>Aucune recherche</EmptyTitle><EmptyDescription>Commencez par une adresse, une rue ou un quartier, ici ou en demandant à Claude.</EmptyDescription></EmptyHeader>
          <EmptyContent><NewSearch streamEstate={stream} trigger={trigger} /></EmptyContent>
        </Empty>
      )}
    </main>
  )
}
