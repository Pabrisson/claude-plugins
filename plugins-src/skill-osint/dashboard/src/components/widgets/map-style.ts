import type { StyleSpecification } from "maplibre-gl"

// OpenFreeMap: free vector tiles, no key, a light and a dark style (checked 2026-11-03: 200, application/json)
export const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" }
const cache: Partial<Record<"light" | "dark", Promise<StyleSpecification>>> = {}
export const loadStyle = (dark: boolean) => (cache[dark ? "dark" : "light"] ??= fetch(STYLES[dark ? "dark" : "light"]).then(r => r.json() as Promise<StyleSpecification>))

export const ROLES: Record<string, { label: string; icon: string }> = {
  candidate: { label: "Candidate", icon: "map-pin" },
  excluded: { label: "Excluded", icon: "circle-slash" },
  sightline: { label: "Sight line", icon: "move-up-right" },
  pano: { label: "Panorama", icon: "camera" },
  place: { label: "Place", icon: "map-pinned" },
}

// a CSS color (oklch included) as rgb, which MapLibre reads
export function cssColor(name: string) {
  const c = document.createElement("canvas").getContext("2d")!
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"
  c.fillRect(0, 0, 1, 1)
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data
  return `rgb(${r},${g},${b})`
}
export const roleColor = (role: string) => cssColor(`--role-${role}`)

// a triangle pointing up, an SDF icon: tinted by the layer, turned by the bearing
export function arrowImage(): ImageData {
  const s = 32, c = document.createElement("canvas")
  c.width = c.height = s
  const g = c.getContext("2d")!
  g.fillStyle = "#fff"
  g.beginPath(); g.moveTo(s / 2, 2); g.lineTo(s - 6, s - 4); g.lineTo(s / 2, s - 10); g.lineTo(6, s - 4); g.closePath(); g.fill()
  return g.getImageData(0, 0, s, s)
}
