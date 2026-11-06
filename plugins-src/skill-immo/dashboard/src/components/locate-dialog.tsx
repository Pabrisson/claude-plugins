import { ClipboardCopyIcon, GlobeIcon, HandIcon, ImagesIcon, LaptopIcon, MapIcon, MapPinIcon, MapPinnedIcon, SatelliteIcon, Undo2Icon } from "lucide-react"
import { Map as MapLibre, Marker, NavigationControl } from "maplibre-gl"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { cssColor, loadStyle, LOCALE, zoomOf } from "@/components/map-view"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Hit, type Listing, type Location, type Point } from "@/lib/api"
import { ACCURACY_LABEL, eur, titleOf } from "@/lib/format"
import { startOf, useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

// « Préciser l'adresse »: a listing placed where it really is, by its photos (a prompt for the agent's OSINT skill, which
// geolocates them and moves the listing with `immo.mjs locate`) or by hand (a pin, the address shown). Nothing is lost:
// the source's place waits aside (engine lib/listings.js locate) and « Revenir à l'origine » brings it back.

const CONFIDENCE = { high: "haute", medium: "moyenne", low: "faible" }
// how a listing the user placed got its place
export const placedBy = (loc: Location) =>
  loc.by === "osint" ? ["précisée par OSINT", loc.osint?.confidence && `confiance ${CONFIDENCE[loc.osint.confidence]}`, loc.osint?.radius_m && `± ${loc.osint.radius_m} m`].filter(Boolean).join(" · ") : "précisée à la main"
const latLon = (p: Point) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`
const accuracy = (loc: Location) => ACCURACY_LABEL[loc.accuracy ?? "UNKNOWN"] ?? "inconnue"
// how close the source's point is, said of a listing whose address it does not give
const POINT: Record<string, string> = { PRECISE: "point au numéro, selon la source", STREET: "point dans la rue", NEIGHBORHOOD: "point au quartier" }
const pointOf = (loc: Location) => (!loc.point ? "sans position" : POINT[loc.accuracy ?? ""] ?? "point approximatif")

// the prompt for the agent: the OSINT skill opens a geolocate-image case with its frame set, then moves the listing
export function osintPrompt(l: Listing, slug: string, zone: string, photos: string[], leave: boolean) {
  const src = l.location_source ?? l.location, at = l.location.point
  const placed = !at ? "sans position" : l.location_source ? `déjà ${placedBy(l.location)} au point ${latLon(at)}` : `placée aujourd'hui au point ${latLon(at)} (précision : ${accuracy(l.location)})`
  return [
    `osint : où a été prise cette photo ? Préciser l'adresse de l'annonce ${l.id} (recherche immo ${slug})`,
    `- photos : ${photos.map((p, i) => (i ? p : `${p} (principale)`)).join(", ")}`,
    `- annonce : ${[titleOf(l), l.price && eur(l.price), [src.city, src.postcode && `(${src.postcode})`].filter(Boolean).join(" ")].filter(Boolean).join(", ")}, ${placed} ; son texte et ses repères (vue, gare, école) : skill-immo \`immo.mjs show -p ${slug} --id ${l.id}\``,
    `- indice à tester : le bien est à vendre dans la zone de la recherche (${zone})`,
    `- cadre : achat immobilier, un bien publié à la vente localisé par les photos de sa propre annonce · person=false · noisy=never · image_may_leave=${leave}`,
    `- ensuite : point trouvé avec une confiance moyenne ou haute → skill-immo \`immo.mjs locate -p ${slug} --id ${l.id} --at <lat,lon> --osint <slug du cas> --confidence <high|medium> --radius <m>\` (avec --address "<numéro et rue>" si l'enquête les a lus) ; sinon dis ce que l'enquête a trouvé, sans déplacer l'annonce`,
  ].join("\n")
}

// back to the source's place (the building data read again there)
function useReset(l: Listing) {
  const { slug, reload } = useSearch(), [busy, setBusy] = useState(false)
  const reset = async () => {
    setBusy(true)
    try {
      await api.listing(slug, l.id, { location: null })
      await reload()
      toast.success("Annonce remise à sa position d'origine")
    } catch (e) { toast.error("Impossible de revenir à l'origine", { description: (e as Error).message }) } finally { setBusy(false) }
  }
  return { reset, busy }
}

// The dossier's line of the listing's place: its address (or what its source says of it), how it was placed, and the
// two actions
export function LocationLine({ l }: { l: Listing }) {
  const src = l.location_source, { reset, busy } = useReset(l)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <MapPinIcon className="size-4 shrink-0" />
        <span className="font-medium text-foreground">{l.location.address ?? (src ? "point sans adresse" : [l.location.city, "adresse non donnée"].filter(Boolean).join(", "))}</span>
        <span>· {src ? placedBy(l.location) : l.location.address ? accuracy(l.location) : pointOf(l.location)}</span>
      </p>
      <span className="flex gap-1.5 sm:ml-auto">
        {src && <Button size="xs" variant="ghost" disabled={busy} onClick={reset} title={`Position d'origine : ${src.address ?? pointOf(src)}`}>{busy ? <Spinner data-icon="inline-start" /> : <Undo2Icon data-icon="inline-start" />}Revenir à l'origine</Button>}
        <LocateDialog l={l} trigger={<Button size="xs" variant="outline"><MapPinnedIcon data-icon="inline-start" />Préciser l'adresse</Button>} />
      </span>
    </div>
  )
}

export function LocateDialog({ l, trigger }: { l: Listing; trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const hasPhotos = !!(l.pictures?.length || l.se_pictures?.length)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Préciser l'adresse</DialogTitle>
          <DialogDescription>L'annonce est déplacée sans rien perdre : sa position d'origine reste gardée et « Revenir à l'origine » la remet.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={hasPhotos ? "photos" : "hand"}>
          <TabsList className="w-full">
            <TabsTrigger value="photos" disabled={!hasPhotos}><ImagesIcon />Par les photos (OSINT)</TabsTrigger>
            <TabsTrigger value="hand"><HandIcon />À la main</TabsTrigger>
          </TabsList>
          <TabsContent value="photos" className="pt-2"><ByPhotos l={l} onDone={() => setOpen(false)} /></TabsContent>
          <TabsContent value="hand" className="pt-2"><ByHand l={l} onDone={() => setOpen(false)} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// the photos to send (1 to 4, the first chosen the main one), whether they may leave this computer, the prompt
function ByPhotos({ l, onDone }: { l: Listing; onDone: () => void }) {
  const { slug, data } = useSearch()
  const [failed, setFailed] = useState<string[]>([]), [chosen, setChosen] = useState<string[]>([]), [leave, setLeave] = useState("")
  const ok = (ps: string[] = []) => ps.filter(p => !failed.includes(p)), own = ok(l.pictures), photos = own.length ? own : ok(l.se_pictures)
  const flip = (p: string) => setChosen(c => (c.includes(p) ? c.filter(x => x !== p) : c.length < 4 ? [...c, p] : c))
  const ready = chosen.length > 0 && !!leave
  const prompt = ready ? osintPrompt(l, slug, data.search.zone?.label ?? data.search.label, chosen, leave === "yes") : ""
  async function copy() {
    try { await navigator.clipboard.writeText(prompt) } catch { return toast.error("Copie impossible") }
    toast.success("Prompt copié : collez-le dans votre agent", { description: "Son skill OSINT localise la photo puis déplace l'annonce ; le tableau de bord affichera « Recharger »." })
    onDone()
  }
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel>Photos à localiser</FieldLabel>
        <FieldDescription>Une à quatre, la première choisie en principale : une façade, la rue, une vue dégagée ou un repère se localisent le mieux.</FieldDescription>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map(p => {
            const n = chosen.indexOf(p)
            return (
              <button key={p} type="button" aria-pressed={n >= 0} onClick={() => flip(p)} disabled={n < 0 && chosen.length >= 4}
                className={cn("relative aspect-[4/3] overflow-hidden rounded-lg ring-2 ring-transparent transition focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40", n >= 0 ? "ring-primary" : "opacity-80 hover:opacity-100")}>
                <img src={p} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(f => [...f, p])} />
                {n >= 0 && <span className="absolute top-1.5 left-1.5 rounded-md bg-primary px-1.5 text-xs leading-5 font-medium text-primary-foreground">{n ? n + 1 : "1 · principale"}</span>}
              </button>
            )
          })}
        </div>
      </Field>
      <Field>
        <FieldLabel>Les photos peuvent-elles quitter cet ordinateur ?</FieldLabel>
        <ToggleGroup type="single" variant="outline" value={leave} onValueChange={setLeave} className="flex-wrap justify-start" aria-label="Les photos peuvent-elles quitter cet ordinateur ?">
          <ToggleGroupItem value="yes"><GlobeIcon />Oui, recherche inversée</ToggleGroupItem>
          <ToggleGroupItem value="no"><LaptopIcon />Non, sur cet ordinateur</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>Oui : Lens, Bing et TinEye retrouvent souvent la même annonce chez une autre agence, parfois avec l'adresse. Non : seuls les modèles locaux et les vues de rue servent.</FieldDescription>
      </Field>
      {/* fixed: grown to its content, its long links would widen the dialog */}
      {ready && <Textarea readOnly value={prompt} rows={9} className="field-sizing-fixed font-mono text-xs break-all md:text-xs" aria-label="Le prompt" />}
      <DialogFooter>
        <Button onClick={copy} disabled={!ready}><ClipboardCopyIcon data-icon="inline-start" />Copier le prompt pour l'agent</Button>
      </DialogFooter>
    </div>
  )
}

// the IGN's aerial photos, under the plan's names
const ORTHO = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
type Address = { address: string; postcode: string | null; city: string | null }

// a pin on the plan or the aerial photo (dragged, or put down with a click) and the address shown, apart: the pin moved
// proposes the address at its point until the user gives theirs (typed, or one of the address base's picked)
function ByHand({ l, onDone }: { l: Listing; onDone: () => void }) {
  const { slug, data, reload } = useSearch(), { resolvedTheme } = useTheme()
  const [point, setPoint] = useState<Point>(l.location.point ?? startOf(data.search))
  const [addr, setAddr] = useState<Address>({ address: l.location_source ? l.location.address ?? "" : "", postcode: null, city: null })
  const [own, setOwn] = useState(!!addr.address), [hits, setHits] = useState<Hit[]>([]), [picked, setPicked] = useState(true)
  const [view, setView] = useState("aerial"), [saving, setSaving] = useState(false)
  const box = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null), pin = useRef<Marker | null>(null), ownRef = useRef(own), viewRef = useRef(view)
  useEffect(() => { ownRef.current = own; viewRef.current = view })

  // the address at the pin's point, while the user gave none
  const moved = (p: Point) => {
    setPoint(p)
    if (!ownRef.current) api.reverse(p).then(a => { if (!ownRef.current && a.address) setAddr({ address: a.address, postcode: a.postcode ?? null, city: a.city ?? null }) }, () => {})
  }
  const movedRef = useRef(moved)
  useEffect(() => { movedRef.current = moved })

  // the map, made again when the theme changes
  useEffect(() => {
    let gone = false
    loadStyle(resolvedTheme === "dark").then(style => {
      if (gone || !box.current) return
      const at = (pin.current?.getLngLat().toArray() as Point | undefined) ?? point
      const m = new MapLibre({ container: box.current, style, center: at, zoom: l.location.point ? 18 : 15, attributionControl: { compact: true }, locale: LOCALE })
      map.current = m
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      const mk = new Marker({ draggable: true, color: cssColor("--highlight") }).setLngLat(at).addTo(m)
      pin.current = mk
      mk.on("dragend", () => movedRef.current(mk.getLngLat().toArray() as Point))
      m.on("click", e => { mk.setLngLat(e.lngLat); movedRef.current(e.lngLat.toArray() as Point) })
      m.on("load", () => {
        m.resize()
        m.addSource("ortho", { type: "raster", tiles: [ORTHO], tileSize: 256, maxzoom: 19, attribution: "IGN" })
        // over the plan's areas and roads, under its names (the style mixes names among them: the last run of names)
        const layers = m.getStyle().layers, names = layers[layers.findLastIndex(x => x.type !== "symbol") + 1]?.id
        m.addLayer({ id: "ortho", type: "raster", source: "ortho", layout: { visibility: viewRef.current === "aerial" ? "visible" : "none" } }, names)
      })
    })
    return () => { gone = true; map.current?.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])
  useEffect(() => { if (map.current?.getLayer("ortho")) map.current.setLayoutProperty("ortho", "visibility", view === "aerial" ? "visible" : "none") }, [view])

  // the address base's suggestions for what the user types
  useEffect(() => {
    if (picked || addr.address.length < 3) return
    const t = setTimeout(() => api.autocomplete(addr.address).then(setHits, () => setHits([])), 200)
    return () => clearTimeout(t)
  }, [addr.address, picked])
  const pick = (h: Hit) => {
    const p: Point = [h.x, h.y]
    setPicked(true); setOwn(true); setHits([])
    setAddr({ address: h.fulltext.split(", ")[0], postcode: h.zipcode || null, city: h.city || null })
    setPoint(p); pin.current?.setLngLat(p); map.current?.flyTo({ center: p, zoom: Math.max(zoomOf(h), 17) })
  }

  async function save() {
    setSaving(true)
    try {
      await api.listing(slug, l.id, { location: { point, address: addr.address.trim() || null, postcode: addr.postcode, city: addr.city } })
      await reload()
      toast.success("Annonce déplacée", { description: "Le bâtiment est relu à cette adresse ; la position d'origine reste gardée." })
      onDone()
    } catch (e) { toast.error("Impossible de déplacer l'annonce", { description: (e as Error).message }) } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel>Adresse affichée</FieldLabel>
        <Command shouldFilter={false} className="h-auto rounded-lg border">
          <CommandInput placeholder="Déplacez l'épingle, ou tapez une adresse" aria-label="Adresse affichée" value={addr.address}
            onValueChange={v => { setAddr({ address: v, postcode: null, city: null }); setOwn(!!v.trim()); setPicked(false) }} />
          {!picked && addr.address.length >= 3 && (
            <CommandList>
              <CommandEmpty>Aucune adresse trouvée : celle tapée sera affichée telle quelle.</CommandEmpty>
              <CommandGroup>
                {hits.map(h => <CommandItem key={`${h.fulltext}|${h.kind}`} value={`${h.fulltext}|${h.kind}`} onSelect={() => pick(h)}><MapPinIcon />{h.fulltext}</CommandItem>)}
              </CommandGroup>
            </CommandList>
          )}
        </Command>
        <FieldDescription>Vide : l'adresse au point de l'épingle. L'épingle et l'adresse restent indépendantes : placez l'épingle sur la maison, gardez l'adresse de son portail.</FieldDescription>
      </Field>
      <Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLabel>Position sur la carte</FieldLabel>
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={v => v && setView(v)} aria-label="Fond de carte">
            <ToggleGroupItem value="aerial" className="h-7 px-2 text-xs"><SatelliteIcon />Photo aérienne</ToggleGroupItem>
            <ToggleGroupItem value="plan" className="h-7 px-2 text-xs"><MapIcon />Plan</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div ref={box} className="h-72 w-full overflow-hidden rounded-lg border" />
        <FieldDescription>Glissez l'épingle, ou cliquez sur la carte pour la poser. {latLon(point)}</FieldDescription>
      </Field>
      <DialogFooter>
        <Button onClick={save} disabled={saving}>{saving ? <Spinner data-icon="inline-start" /> : <MapPinnedIcon data-icon="inline-start" />}Enregistrer</Button>
      </DialogFooter>
    </div>
  )
}
