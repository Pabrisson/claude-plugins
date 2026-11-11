import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useLayoutEffect } from "react"

import { DossierBody, ShowIn } from "@/components/dossier"
import { PromptButton, StaleBar, ThemeButton } from "@/components/top-bar"
import { TypeIcon } from "@/components/type-icon"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { eur, titleOf, TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"

// A listing's own page (/<slug>/annonce/<id>, its name in the dashboard): the dossier of the panel on the right, on a
// whole page. Back to the search, its panel opens on it; « Voir » and « Voir au cadastre » go back to the tab asked,
// the listing or the parcel pointed at (handed over through this tab's sessionStorage, store handoff).
export function ListingPage({ id }: { id: string }) {
  const { slug, data, select, spot, parcelFocus } = useSearch()
  const l = data.listings.find(x => x.id === id), back = `/${slug}/`
  useEffect(() => { select(id) }, [id, select])
  useEffect(() => { document.title = l ? `${titleOf(l)} · ${data.search.label}` : "Annonce introuvable" }, [l, data.search.label])
  // written as soon as « Voir » sets them, before the page leaves
  useLayoutEffect(() => {
    try {
      if (spot) sessionStorage.setItem(`immo:${slug}:spot`, spot)
      if (parcelFocus) sessionStorage.setItem(`immo:${slug}:parcel`, parcelFocus)
    } catch { /* private window */ }
  }, [slug, spot, parcelFocus])
  const leave = (view: string) => {
    try { sessionStorage.setItem(`immo:${slug}:view`, JSON.stringify(view)) } catch { /* private window */ }
    setTimeout(() => location.assign(back))
  }
  return (
    // the header and the stale bar stay put, only the dossier under them scrolls (its scrollbar starts below the header)
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 md:px-4">
        <Button variant="ghost" size="sm" className="min-w-0" asChild><a href={back}><ArrowLeftIcon data-icon="inline-start" /><span className="truncate">{data.search.label}</span></a></Button>
        <span className="flex-1" />
        {l && <ShowIn l={l} onView={leave} />}
        <PromptButton />
        <ThemeButton />
      </header>
      <StaleBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-4">
        {l ? (
          <>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold"><TypeIcon type={l.property_type} className="size-5 shrink-0 text-muted-foreground" />{titleOf(l)}</h1>
              <p className="text-sm text-muted-foreground">{TYPE_LABEL[l.property_type ?? "flat"]} · {eur(l.price)}</p>
            </div>
            <DossierBody l={l} onView={leave} wide />
          </>
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
