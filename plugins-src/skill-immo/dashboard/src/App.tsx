import { BarChart3Icon, EllipsisIcon, ListIcon, MapIcon, PlusIcon, ReceiptEuroIcon, RefreshCwIcon, RouteIcon, ScaleIcon, SquareKanbanIcon, Trash2Icon } from "lucide-react"
import { ThemeProvider } from "next-themes"
import { useEffect, useState } from "react"
import { toast } from "sonner"

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
import { NewSearch, StaleBar, ThemeButton, TopBar } from "@/components/top-bar"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
import { SearchProvider, useSearch, useTabState } from "@/lib/store"
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
    // the visit first (it writes search.json): the data read after it carries the version the page starts from
    api.visit(slug).then(v => Promise.all([api.search(slug), api.state(), api.profile()]).then(([data, state, profile]) => ({ data, state, profile, lastVisit: v.last_visit })))
      .then(setBoot, e => setBoot({ error: e.message }))
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
  { id: "list", label: "Liste", icon: ListIcon },
  { id: "kanban", label: "Kanban", icon: SquareKanbanIcon },
  { id: "market", label: "Marché", icon: BarChart3Icon },
  { id: "compare", label: "Comparer", icon: ScaleIcon },
  { id: "follow", label: "Suivi", icon: RouteIcon },
  { id: "costs", label: "Coûts API", icon: ReceiptEuroIcon },
] as const
// a phone's bar holds five: the rest goes under "Plus"
const BAR = ["listings", "list", "kanban", "follow"]

// The map and the listings' cards side by side (one or the other on a phone), the kanban and the list of every
// listing, each listing's dossier on top; market, comparison, follow-up as tabs, the API costs apart on the right
function Workspace() {
  const { slug, reload, compare } = useSearch()
  const mobile = useIsMobile()
  const [view, setView] = useTabState(`immo:${slug}:view`, "listings"), [showMap, setShowMap] = useState("list")
  const more = VIEWS.filter(v => !BAR.includes(v.id))
  return (
    <RunProvider onDone={reload}>
      <div className="flex h-dvh flex-col">
        <TopBar onNews={() => setView("follow")} />
        <StaleBar />
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
              // the map under both columns, a bit see-through: the layers on its left, the listings on its right (darker)
              <div className="relative h-full">
                <MapView className="absolute inset-0" right={440} />
                <div className="absolute inset-y-0 right-0 z-10 w-[440px] overflow-y-auto border-l bg-background/60 p-3 backdrop-blur-md"><ListingList /></div>
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
  const [list, setList] = useState<SearchSummary[] | null>(null), [stream, setStream] = useState(false), [fresh, setFresh] = useState(false)
  const load = () => api.searches().then(l => { setList(l); setFresh(false) }, () => setList([]))
  useEffect(() => {
    load()
    api.state().then(s => setStream(s.stream_estate), () => {})
  }, [])
  // a search Claude created or changed since: the same bar as in a search
  useEffect(() => {
    if (!list) return
    const t = setInterval(() => {
      if (document.visibilityState === "visible") api.searches().then(l => JSON.stringify(l) !== JSON.stringify(list) && setFresh(true), () => {})
    }, 4000)
    return () => clearInterval(t)
  }, [list])
  const trigger = <Button><PlusIcon data-icon="inline-start" />Nouvelle recherche</Button>
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-8">
      {fresh && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          <span className="flex items-center gap-2"><RefreshCwIcon className="size-4" />Claude a créé ou mis à jour une recherche.</span>
          <Button size="xs" variant="secondary" onClick={() => location.reload()}>Recharger</Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recherche immobilière</h1>
          <p className="text-sm text-muted-foreground">{stream ? "API payante activée" : "Mode OpenData : open data et annonces trouvées par Claude"}</p>
        </div>
        <span className="flex gap-1.5"><NewSearch streamEstate={stream} trigger={trigger} /><ThemeButton /></span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {list === null ? <Skeleton className="h-24" /> : list.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map(s => <SearchCard key={s.slug} s={s} onDeleted={load} />)}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader><EmptyTitle>Aucune recherche</EmptyTitle><EmptyDescription>Commencez par une adresse, une rue ou un quartier : copiez le prompt pour Claude, ou demandez-lui directement.</EmptyDescription></EmptyHeader>
          <EmptyContent><NewSearch streamEstate={stream} trigger={trigger} /></EmptyContent>
        </Empty>
      )}
    </main>
  )
}

// a search on the home page: the whole card opens it, its bin deletes it once confirmed
function SearchCard({ s, onDeleted }: { s: SearchSummary; onDeleted: () => void }) {
  async function remove() {
    try {
      await api.deleteSearch(s.slug)
      toast.success(`Recherche « ${s.label} » supprimée`)
      onDeleted()
    } catch (e) {
      toast.error("La recherche n'a pas été supprimée", { description: (e as Error).message === "alert" ? "Elle a une alerte de l'API payante : supprimez d'abord l'alerte, dans son onglet Suivi." : `Détail technique : ${(e as Error).message}` })
    }
  }
  return (
    <Card className="relative h-full transition-colors has-[a:hover]:bg-accent/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 pr-8">
          <a href={`/${s.slug}/`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50">{s.label}</a>
          <span className="flex gap-1 text-muted-foreground">{(s.types ?? ["flat"]).map(t => <TypeIcon key={t} type={t} className="size-4" />)}</span>
        </CardTitle>
        <CardDescription>{(s.types ?? ["flat"]).map(t => TYPE_PLURAL[t]).join(", ")} · {s.zone} · {s.online} annonce{s.online > 1 ? "s" : ""} en ligne · créée le {date(s.created)}</CardDescription>
        <Badge variant={s.mode === "stream-estate" ? "default" : "secondary"} className="w-fit">{s.mode === "stream-estate" ? "API payante" : "OpenData"}</Badge>
      </CardHeader>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3 z-10" aria-label={`Supprimer la recherche ${s.label}`}><Trash2Icon /></Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la recherche « {s.label} » ?</AlertDialogTitle>
            <AlertDialogDescription>{s.listings ? `Ses ${s.listings} annonce${s.listings > 1 ? "s" : ""}, vos statuts, vos notes et les messages préparés` : "Sa zone et son marché"} seront effacés de cette machine. C'est définitif.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
