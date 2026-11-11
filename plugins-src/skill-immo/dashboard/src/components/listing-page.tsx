import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useLayoutEffect } from "react"

import { DossierBody, ShowIn } from "@/components/dossier"
import { StaleBar, TopBar } from "@/components/top-bar"
import { TypeIcon } from "@/components/type-icon"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { eur, titleOf } from "@/lib/format"
import { useSearch } from "@/lib/store"

// A listing's own page (/<slug>/annonce/<id>, its name in the dashboard): the dossier of the panel on the right, on a
// whole page, under the search's header (its actions; ← back to the search, the listing's title, « Voir »). Back to the search, its view shows with no dossier open; « Voir » and « Voir au cadastre » go back to the tab asked,
// the listing or the parcel pointed at (handed over through this tab's sessionStorage, store handoff).
export function ListingPage({ id }: { id: string }) {
  const { slug, data, select, spot, parcelFocus, newsFocus } = useSearch()
  const l = data.listings.find(x => x.id === id), back = `/${slug}/`
  useEffect(() => { select(null) }, [id, select])
  useEffect(() => { document.title = l ? `${titleOf(l)} · ${data.search.label}` : "Annonce introuvable" }, [l, data.search.label])
  // written as soon as « Voir » sets them, before the page leaves
  useLayoutEffect(() => {
    try {
      if (spot) sessionStorage.setItem(`immo:${slug}:spot`, spot)
      if (parcelFocus) sessionStorage.setItem(`immo:${slug}:parcel`, parcelFocus)
      if (newsFocus) sessionStorage.setItem(`immo:${slug}:news`, newsFocus)
    } catch { /* private window */ }
  }, [slug, spot, parcelFocus, newsFocus])
  const leave = (view: string) => {
    try { sessionStorage.setItem(`immo:${slug}:view`, JSON.stringify(view)) } catch { /* private window */ }
    setTimeout(() => location.assign(back))
  }
  return (
    // the header and the stale bar stay put, only the dossier under them scrolls (its scrollbar starts below the header)
    <div className="flex h-dvh flex-col">
      <TopBar onNews={() => leave("follow")} onSettings={() => leave("settings")} page={{
        back,
        title: l ? <span className="flex min-w-0 items-center gap-2"><TypeIcon type={l.property_type} className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{titleOf(l)}</span></span> : "Annonce introuvable",
        sub: l ? `${data.search.label} · ${eur(l.price)}` : data.search.label,
        extra: l && <ShowIn l={l} onView={leave} />,
      }} />
      <StaleBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-4">
        {l ? (
          <DossierBody l={l} onView={leave} wide />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Annonce introuvable</EmptyTitle>
              <EmptyDescription>Elle n'est pas (ou plus) dans la recherche « {data.search.label} ».</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><Button asChild><a href={back}><ArrowLeftIcon data-icon="inline-start" />Retour à la recherche</a></Button></EmptyContent>
          </Empty>
        )}
      </main>
      </div>
    </div>
  )
}
