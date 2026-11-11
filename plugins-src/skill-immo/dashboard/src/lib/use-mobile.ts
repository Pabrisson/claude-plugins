import { useSyncExternalStore } from "react"

// whether a media query matches, following it
export const useMedia = (query: string) => useSyncExternalStore(cb => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb) }, () => matchMedia(query).matches)

// below the md breakpoint: the map and the list become tabs, the dossier a bottom drawer
export const useIsMobile = () => useMedia("(max-width: 767px)")
