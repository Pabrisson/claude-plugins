import { BarChart3Icon, EllipsisIcon, ListIcon, MapIcon, PlusIcon, ReceiptEuroIcon, RouteIcon, ScaleIcon, SquareKanbanIcon } from "lucide-react"
import { ThemeProvider } from "next-themes"
import { useEffect, useState } from "react"

import { CompareTab } from "@/components/compare-tab"
import { CostsTab } from "@/components/costs-tab"
import { Dossier } from "@/components/dossier"
import { FollowTab } from "@/components/follow-tab"
import { KanbanTab } from "@/components/kanban-tab"
import { ListTab } from "@/components/list-tab"
import { ListingList } from "@/components/listing-list"
import { MapView } from "@/components/map-view"
import { MarketTab } from "@/components/market-tab"
import { RunProvider } from "@/components/run-dialog"
import { NewSearch, ThemeButton, TopBar } from "@/components/top-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TypeIcon } from "@/components/type-icon"
import { api, slugOfUrl, type Profile, type SearchData, type SearchSummary, type State } from "@/lib/api"
import { date, TYPE_PLURAL } from "@/lib/format"
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
  { id: "listings", label: "Cartes", icon: MapIcon },
  { id: "kanban", label: "Kanban", icon: SquareKanbanIcon },
  { id: "list", label: "Liste", icon: ListIcon },
  { id: "market", label: "Marché", icon: BarChart3Icon },
  { id: "compare", label: "Comparer", icon: ScaleIcon },
  { id: "follow", label: "Suivi", icon: RouteIcon },
  { id: "costs", label: "Coûts API", icon: ReceiptEuroIcon },
] as const
// a phone's bar holds five: the rest goes under "Plus"
const BAR = ["listings", "kanban", "list", "follow"]

// The map and the listings' cards side by side (one or the other on a phone), the kanban and the list of every
// listing, each listing's dossier on top; market, comparison, follow-up as tabs, the API costs apart on the right
function Workspace() {
  const { reload, compare } = useSearch()
  const mobile = useIsMobile()
  const [view, setView] = useState<string>("listings"), [showMap, setShowMap] = useState("list")
  const more = VIEWS.filter(v => !BAR.includes(v.id))
  return (
    <RunProvider onDone={reload}>
      <div className="flex h-dvh flex-col">
        <TopBar />
        <Tabs value={view} onValueChange={setView} className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" className="hidden w-full justify-start rounded-none border-b bg-card px-3 md:flex">
            {VIEWS.map(v => (
              <TabsTrigger key={v.id} value={v.id} className={cn("flex-none", v.id === "costs" && "ml-auto")}><v.icon />{v.label}{v.id === "compare" && compare.length > 0 && <Badge variant="secondary">{compare.length}</Badge>}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="listings" className="min-h-0">
            {mobile ? (
              <div className="relative flex h-full flex-col">
                <ToggleGroup type="single" variant="outline" size="sm" value={showMap} onValueChange={v => v && setShowMap(v)} className="m-3 mb-0 self-start" aria-label="Affichage">
                  <ToggleGroupItem value="list"><ListIcon />Liste</ToggleGroupItem>
                  <ToggleGroupItem value="map"><MapIcon />Carte</ToggleGroupItem>
                </ToggleGroup>
                {showMap === "map" ? <MapView className="relative mt-3 min-h-0 flex-1 mb-16" /> : <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-20"><ListingList /></div>}
              </div>
            ) : (
              <div className="grid h-full md:grid-cols-[1fr_minmax(380px,440px)]">
                <MapView className="relative" />
                <div className="overflow-y-auto border-l p-3"><ListingList /></div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="kanban" className="min-h-0 pb-16 md:pb-0"><KanbanTab /></TabsContent>
          <TabsContent value="list" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><ListTab /></TabsContent>
          <TabsContent value="market" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><MarketTab /></TabsContent>
          <TabsContent value="compare" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><CompareTab /></TabsContent>
          <TabsContent value="follow" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><FollowTab /></TabsContent>
          <TabsContent value="costs" className="min-h-0 overflow-y-auto pb-16 md:pb-0"><CostsTab /></TabsContent>
        </Tabs>
        {mobile && (
          <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)]" aria-label="Vues">
            {VIEWS.filter(v => BAR.includes(v.id)).map(v => (
              <button key={v.id} type="button" onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined}
                className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground", view === v.id && "text-foreground")}>
                <v.icon className="size-5" />{v.label}
              </button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-current={more.some(v => v.id === view) ? "page" : undefined}
                  className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground", more.some(v => v.id === view) && "text-foreground")}>
                  <EllipsisIcon className="size-5" />Plus
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                {more.map(v => <DropdownMenuItem key={v.id} onSelect={() => setView(v.id)}><v.icon />{v.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
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
          <h1 className="text-2xl font-bold tracking-tight">Recherche immobilière</h1>
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
                  <CardTitle className="flex items-center gap-2">{s.label}<span className="flex gap-1 text-muted-foreground">{(s.types ?? ["flat"]).map(t => <TypeIcon key={t} type={t} className="size-4" />)}</span></CardTitle>
                  <CardDescription>{(s.types ?? ["flat"]).map(t => TYPE_PLURAL[t]).join(", ")} · {s.zone} · {s.online} annonce{s.online > 1 ? "s" : ""} en ligne · créée le {date(s.created)}</CardDescription>
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
