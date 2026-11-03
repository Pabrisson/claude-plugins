import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { Listing } from "@/lib/api"
import { cn } from "@/lib/utils"

// A listing's photos: a strip in its dossier, each opening the viewer. They are the portal's own gallery (engine
// lib/listings.js photosOf) and go once the listing leaves the portal: those that fail drop out, and when none is left
// Stream Estate's copies (`se_pictures`, they stay) take their place.
export function Photos({ l }: { l: Listing }) {
  const [failed, setFailed] = useState<string[]>([]), [at, setAt] = useState<number | null>(null)
  const ok = (ps: string[] = []) => ps.filter(p => !failed.includes(p)), own = ok(l.pictures), photos = own.length ? own : ok(l.se_pictures)
  const fail = (p: string) => setFailed(f => [...f, p])
  if (!photos.length) return null
  return (
    <>
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {photos.map((p, i) => (
          <button key={p} type="button" onClick={() => setAt(i)} aria-label={`Agrandir la photo ${i + 1} sur ${photos.length}`}
            className="relative h-40 flex-none snap-start cursor-zoom-in overflow-hidden rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <img src={p} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-auto object-cover transition-transform hover:scale-[1.02]" onError={() => fail(p)} />
            {i === 0 && photos.length > 1 && (
              <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-background/85 px-1.5 text-xs leading-5 font-medium backdrop-blur-sm"><ImagesIcon className="size-3.5" />{photos.length} photos</span>
            )}
          </button>
        ))}
      </div>
      <Viewer photos={photos} at={at} onAt={setAt} onFail={fail} />
    </>
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

// The photos full screen: ← and → (keys, buttons, a swipe), the count, the thumbnails, Échap closes
function Viewer({ photos, at, onAt, onFail }: { photos: string[]; at: number | null; onAt: (i: number | null) => void; onFail: (p: string) => void }) {
  const n = photos.length, i = at == null ? 0 : Math.min(at, n - 1), x0 = useRef<number | null>(null), strip = useRef<HTMLDivElement>(null)
  const go = (d: number) => onAt((i + d + n) % n)
  useEffect(() => { strip.current?.children[i]?.scrollIntoView({ block: "nearest", inline: "center" }) }, [i, at])
  return (
    <Dialog open={at != null} onOpenChange={o => !o && onAt(null)}>
      <DialogContent className="flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-3 bg-neutral-950 p-3 text-white ring-white/10 sm:max-w-6xl [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-white/10"
        onKeyDown={e => { if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1) }}>
        <DialogTitle className="sr-only">Photos de l'annonce</DialogTitle>
        <DialogDescription className="text-sm text-white/70 tabular-nums">{i + 1} / {n}</DialogDescription>
        <div className="relative min-h-0 flex-1 touch-pan-y select-none"
          onPointerDown={e => { x0.current = e.clientX }} onPointerUp={e => { if (x0.current != null && Math.abs(e.clientX - x0.current) > 50) go(e.clientX < x0.current ? 1 : -1); x0.current = null }}>
          {photos[i] && <img key={photos[i]} src={photos[i]} alt={`Photo ${i + 1} sur ${n}`} referrerPolicy="no-referrer" draggable={false} className="size-full object-contain" onError={() => onFail(photos[i])} />}
          {n > 1 && (
            <>
              <Side dir={-1} onGo={go} />
              <Side dir={1} onGo={go} />
            </>
          )}
        </div>
        {n > 1 && (
          <div ref={strip} className="flex flex-none gap-1.5 overflow-x-auto pb-1">
            {photos.map((p, k) => (
              <button key={p} type="button" onClick={() => onAt(k)} aria-label={`Photo ${k + 1}`} aria-current={k === i}
                className={cn("h-14 flex-none overflow-hidden rounded-md opacity-50 ring-2 ring-transparent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-white/60", k === i && "opacity-100 ring-white")}>
                <img src={p} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-auto object-cover" onError={() => onFail(p)} />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
