import { useSyncExternalStore } from "react"

const query = "(max-width: 767px)"
const subscribe = (cb: () => void) => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb) }

// below the md breakpoint: the map and the list become tabs, the dossier a bottom drawer
export const useIsMobile = () => useSyncExternalStore(subscribe, () => matchMedia(query).matches)
