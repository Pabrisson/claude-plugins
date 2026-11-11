import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon, ImageUpIcon, Trash2Icon, UserRoundIcon } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { api, base64, docUrl, fileUrl, type Doc, type Listing } from "@/lib/api"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

// a photo the dossier shows; `mine`: one the user added (they alone are deleted)
export type Photo = { src: string; mine?: Doc }
// A listing's photos: the portal's, then the user's. The portal's are its own gallery (engine lib/listings.js photosOf),
// which goes once the listing leaves the portal: those that fail drop out, and when none is left Stream Estate's copies
// (`se_pictures`, they stay) take their place; once it expired, the copies the engine downloaded into the search
// (`kept_pictures`, immo.mjs keepPhotos) replace them all.
export function photosOf(slug: string, l: Listing, failed: string[] = []): Photo[] {
  const ok = (ps: string[] = []) => ps.filter(p => !failed.includes(p))
  const kept = ok((l.kept_pictures ?? []).map(f => fileUrl(slug, f))), own = ok(l.pictures)
  const portal = kept.length ? kept : own.length ? own : ok(l.se_pictures)
  return [...portal.map(src => ({ src })), ...(l.my_pictures ?? []).map(d => ({ src: docUrl(slug, d), mine: d })).filter(p => !failed.includes(p.src))]
}

// the photos the engine takes (immo.mjs PHOTO_EXT): 25 MB at most each, 20 a call
const PHOTO_EXT = ["jpg", "jpeg", "png", "webp", "gif", "avif"], PHOTO_MAX = 25e6, PER_CALL = 20

// The strip of the dossier, each photo opening the viewer. Images dropped on it are the user's own, kept in the search
// beside its documents: while they are dragged over it a veil covers it (« Déposez vos photos ici »), the same while
// they upload; a listing without photos has a dashed zone in the strip's place, which a click opens on the files too.
export function Photos({ l }: { l: Listing }) {
  const { slug, reload } = useSearch()
  const [failed, setFailed] = useState<string[]>([]), [at, setAt] = useState<number | null>(null), [busy, setBusy] = useState(false), [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const photos = photosOf(slug, l, failed), fail = (p: string) => setFailed(f => [...f, p])
  async function add(list: FileList | null) {
    const all = [...(list ?? [])], ok = all.filter(f => PHOTO_EXT.includes(f.name.split(".").at(-1)?.toLowerCase() ?? "") && f.size > 0 && f.size <= PHOTO_MAX)
    if (ok.length < all.length) toast.error("Image refusée", { description: "JPEG, PNG, WebP, GIF ou AVIF, de 25 Mo au plus." })
    if (!ok.length) return
    setBusy(true)
    try {
      for (let i = 0; i < ok.length; i += PER_CALL) await api.listing(slug, l.id, { photos: { add: await Promise.all(ok.slice(i, i + PER_CALL).map(async f => ({ name: f.name, data: await base64(f) }))) } })
      await reload()
      toast.success(ok.length > 1 ? `${ok.length} photos ajoutées` : "Photo ajoutée")
    } catch (e) { toast.error("Les photos n'ont pas été ajoutées", { description: `Détail technique : ${(e as Error).message}` }) }
    setBusy(false)
    if (input.current) input.current.value = ""
  }
  async function remove(d: Doc) {
    try { await api.listing(slug, l.id, { photos: { delete: d.id } }) } catch (e) { return toast.error("La photo n'a pas été supprimée", { description: `Détail technique : ${(e as Error).message}` }) }
    if (photos.length === 1) setAt(null)
    await reload()
    toast.success("Photo supprimée")
  }
  return (
    <div className="relative"
      onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}>
      <input ref={input} type="file" multiple accept={PHOTO_EXT.map(x => `.${x}`).join(",")} hidden onChange={e => add(e.target.files)} />
      {photos.length ? (
        <div className="flex snap-x gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button key={p.src} type="button" onClick={() => setAt(i)} aria-label={`Agrandir la photo ${i + 1} sur ${photos.length}`}
              className="relative h-40 flex-none snap-start cursor-zoom-in overflow-hidden rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              <img src={p.src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-auto object-cover transition-transform hover:scale-[1.02]" onError={() => fail(p.src)} />
              {i === 0 && photos.length > 1 && (
                <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-background/85 px-1.5 text-xs leading-5 font-medium backdrop-blur-sm"><ImagesIcon className="size-3.5" />{photos.length} photos</span>
              )}
              {p.mine && <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md bg-background/85 px-1.5 text-xs leading-5 font-medium backdrop-blur-sm"><UserRoundIcon className="size-3.5" />Ajoutée</span>}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <ImageUpIcon className="size-6" /><span className="font-medium text-foreground">Glissez-déposez vos photos ici</span>ou cliquez pour les choisir
        </button>
      )}
      {(over || busy) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/85 text-sm font-medium backdrop-blur-sm">
          {busy ? <><Spinner className="size-5" />Ajout des photos…</> : <><ImageUpIcon className="size-5 text-primary" />Déposez vos photos ici</>}
        </div>
      )}
      <Viewer photos={photos} at={at} onAt={setAt} onFail={fail} onDelete={remove} />
    </div>
  )
}

// ← or → over the whole height of the photo's side: the zone is the button, its round icon only shows it (no transform
// on what is pressed: a button that moved under the pointer lost its click)
function Side({ dir, onGo }: { dir: -1 | 1; onGo: (d: number) => void }) {
  const Icon = dir < 0 ? ChevronLeftIcon : ChevronRightIcon
  return (
    <button type="button" aria-label={dir < 0 ? "Photo précédente" : "Photo suivante"} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={() => onGo(dir)}
      className={cn("group/side absolute inset-y-0 flex w-1/5 max-w-40 min-w-14 cursor-pointer items-center outline-none", dir < 0 ? "left-0 justify-start pl-2" : "right-0 justify-end pr-2")}>
      <span className="grid size-11 place-items-center rounded-full bg-black/50 text-white transition-colors group-hover/side:bg-black/80 group-focus-visible/side:ring-3 group-focus-visible/side:ring-white/60 group-active/side:bg-black"><Icon className="size-6" /></span>
    </button>
  )
}

// a zoom: its scale (1 to 5) and the photo's offset in its box, kept inside it
type Zoom = { s: number; x: number; y: number }
const Z1: Zoom = { s: 1, x: 0, y: 0 }
const inside = (z: Zoom, w: number, h: number): Zoom => ({ s: z.s, x: Math.min(0, Math.max(w - w * z.s, z.x)), y: Math.min(0, Math.max(h - h * z.s, z.y)) })
// the scale s around the point (cx, cy) of the box: that point of the photo stays under the pointer
const zoomAt = (z: Zoom, s: number, cx: number, cy: number, w: number, h: number): Zoom => {
  const k = Math.min(5, Math.max(1, s)), f = k / z.s
  return inside({ s: k, x: cx - (cx - z.x) * f, y: cy - (cy - z.y) * f }, w, h)
}

// One photo of the viewer: the wheel (or a trackpad's pinch) zooms it around the pointer, a drag then moves it, a
// double click zooms in or back; at 1× a swipe goes to the next one and `children` (the ← → zones) show. A new photo
// is a new one of these (its key), back at 1×.
function Zoomable({ src, alt, onGo, onFail, children }: { src: string; alt: string; onGo: (d: number) => void; onFail: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null), [z, setZ] = useState(Z1), from = useRef<{ px: number; py: number; z: Zoom } | null>(null)
  // a native listener: React's wheel listener is passive, and the page would zoom with the photo
  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1)
      setZ(z => zoomAt(z, z.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top, r.width, r.height))
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [])
  const local = (e: MouseEvent) => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height] as const }
  return (
    <div ref={box} className={cn("relative min-h-0 flex-1 touch-pan-y overflow-hidden select-none", z.s > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
      onPointerDown={e => { from.current = { px: e.clientX, py: e.clientY, z }; if (z.s > 1) e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={e => { const f = from.current; if (f && z.s > 1) { const r = box.current!.getBoundingClientRect(); setZ(inside({ ...f.z, x: f.z.x + e.clientX - f.px, y: f.z.y + e.clientY - f.py }, r.width, r.height)) } }}
      onPointerUp={e => { const f = from.current; from.current = null; if (f && f.z.s === 1 && Math.abs(e.clientX - f.px) > 50) onGo(e.clientX < f.px ? 1 : -1) }}
      onDoubleClick={e => { const [cx, cy, w, h] = local(e); setZ(z.s > 1 ? Z1 : zoomAt(z, 2.5, cx, cy, w, h)) }}>
      <img src={src} alt={alt} referrerPolicy="no-referrer" draggable={false} onError={onFail}
        style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})`, transformOrigin: "0 0" }} className="size-full object-contain" />
      {z.s === 1 && children}
    </div>
  )
}

// The photos full screen: ← and → (keys, buttons, a swipe), the count, the zoom, the thumbnails, Échap closes; a photo
// the user added has its « Supprimer »
function Viewer({ photos, at, onAt, onFail, onDelete }: { photos: Photo[]; at: number | null; onAt: (i: number | null) => void; onFail: (p: string) => void; onDelete: (d: Doc) => void }) {
  const n = photos.length, i = at == null ? 0 : Math.min(at, n - 1), strip = useRef<HTMLDivElement>(null), p = photos[i]
  const go = (d: number) => onAt((i + d + n) % n)
  useEffect(() => { strip.current?.children[i]?.scrollIntoView({ block: "nearest", inline: "center" }) }, [i, at])
  return (
    <Dialog open={at != null && n > 0} onOpenChange={o => !o && onAt(null)}>
      <DialogContent className="flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-3 bg-neutral-950 p-3 text-white ring-white/10 sm:max-w-6xl [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-white/10"
        onKeyDown={e => { if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1) }}>
        <DialogTitle className="sr-only">Photos de l'annonce</DialogTitle>
        <div className="flex min-h-8 items-center gap-3 pr-10">
          <DialogDescription className="text-sm text-white/70 tabular-nums">{i + 1} / {n}<span className="ml-3 hidden text-white/50 sm:inline">Molette pour zoomer, double-clic pour revenir</span></DialogDescription>
          {p?.mine && (
            <span className="ml-auto flex items-center gap-1">
              <span className="flex items-center gap-1 text-xs text-white/70"><UserRoundIcon className="size-3.5" />Ajoutée par vous</span>
              <Popover>
                <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Supprimer cette photo" className="text-white hover:bg-white/10 hover:text-white"><Trash2Icon /></Button></PopoverTrigger>
                <PopoverContent align="end" className="w-64">
                  <PopoverHeader>
                    <PopoverTitle>Supprimer cette photo ?</PopoverTitle>
                    <PopoverDescription>Son fichier est retiré du dossier de la recherche.</PopoverDescription>
                  </PopoverHeader>
                  <Button variant="destructive" size="sm" onClick={() => onDelete(p.mine!)}><Trash2Icon data-icon="inline-start" />Supprimer</Button>
                </PopoverContent>
              </Popover>
            </span>
          )}
        </div>
        {p && (
          <Zoomable key={p.src} src={p.src} alt={`Photo ${i + 1} sur ${n}`} onGo={go} onFail={() => onFail(p.src)}>
            {n > 1 && (
              <>
                <Side dir={-1} onGo={go} />
                <Side dir={1} onGo={go} />
              </>
            )}
          </Zoomable>
        )}
        {n > 1 && (
          <div ref={strip} className="flex flex-none gap-1.5 overflow-x-auto pb-1">
            {photos.map((x, k) => (
              <button key={x.src} type="button" onClick={() => onAt(k)} aria-label={`Photo ${k + 1}`} aria-current={k === i}
                className={cn("h-14 flex-none overflow-hidden rounded-md opacity-50 ring-2 ring-transparent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-white/60", k === i && "opacity-100 ring-white")}>
                <img src={x.src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-auto object-cover" onError={() => onFail(x.src)} />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
