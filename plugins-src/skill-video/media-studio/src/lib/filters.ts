// What a list of results can be filtered and sorted by, from what the engine measured of each file (the pickers, the
// timeline's bin)
import { mediaKind, type Job } from "./api.ts"
import { RATIOS } from "./timeline.ts"

// what a result's file is, as the engine measured it: its size and length
export const factsOf = (i: { path: string; job: Job }) => i.job.meta?.[i.path.split("/").pop()!] ?? {}
// its format and quality, for the filters and the captions
export const RATIO_CHIPS = ["all", ...Object.keys(RATIOS), "other"]
export const RES_CHIPS = ["all", "≤480p", "720p", "1080p", "2K", "4K"]
export const ratioOf = (w: number, h: number) => Object.keys(RATIOS).find((k) => Math.abs(Math.log(RATIOS[k as keyof typeof RATIOS] / (w / h))) < 0.04) ?? "other"
export const resOf = (w: number, h: number) => {
  const s = Math.min(w, h)
  return s <= 480 ? "≤480p" : s <= 720 ? "720p" : s <= 1080 ? "1080p" : s <= 1440 ? "2K" : "4K"
}
// the filters a list of results takes: a medium, a format, a quality, the favorites
export type Filters = { kind: "all" | "image" | "video" | "audio"; ratio: string; res: string; favorites: boolean }
export const NO_FILTERS: Filters = { kind: "all", ratio: "all", res: "all", favorites: false }
export function passes(i: { path: string; job: Job }, f: Filters) {
  const { w, h } = factsOf(i)
  return (f.kind === "all" || mediaKind(i.path) === f.kind) && (!f.favorites || !!i.job.favorite) && (f.ratio === "all" || (!!w && !!h && ratioOf(w, h) === f.ratio)) && (f.res === "all" || (!!w && !!h && resOf(w, h) === f.res))
}

// the orders a list of results takes, within each medium; kept in this browser
export type Sort = "newest" | "oldest" | "longest" | "shortest" | "sharpest" | "softest" | "name"
export const SORTS: [Sort, string][] = [["newest", "Newest"], ["oldest", "Oldest"], ["longest", "Longest"], ["shortest", "Shortest"], ["sharpest", "Highest resolution"], ["softest", "Lowest resolution"], ["name", "Name A–Z"]]
// the results in that order (they come newest first); a file without the length or size sorted on goes last
export function sorted<T extends { path: string; job: Job }>(items: T[], sort: Sort): T[] {
  if (sort === "newest") return items
  if (sort === "oldest") return [...items].reverse()
  const name = (i: T) => `${i.job.label} ${i.path.split("/").pop()}`
  if (sort === "name") return [...items].sort((a, b) => name(a).localeCompare(name(b)))
  const value = (i: T) => {
    const { w, h, dur } = factsOf(i)
    return sort === "longest" || sort === "shortest" ? dur : w && h ? Math.min(w, h) : undefined
  }
  const dir = sort === "longest" || sort === "sharpest" ? -1 : 1
  return [...items].sort((a, b) => {
    const x = value(a), y = value(b)
    return x == null ? (y == null ? 0 : 1) : y == null ? -1 : dir * (x - y)
  })
}
