// What a list of results can be filtered and sorted by, from what the engine measured of each file (the pickers, the
// timeline's bin)
import { mediaKind, type Job } from "./api.ts"
import { locale, own, t } from "./i18n.ts"
import { RATIOS } from "./timeline.ts"

// what a result's file is, as the engine measured it: its size and length
export const factsOf = (i: { path: string; job: Job }) => i.job.meta?.[i.path.split(/[\\/]/).pop()!] ?? {}
// its format and quality, for the filters and the captions
export const RATIO_CHIPS = ["all", ...Object.keys(RATIOS), "other"]
export const RES_CHIPS = ["all", "≤480p", "720p", "1080p", "2K", "4K"]
export const ratioOf = (w: number, h: number) => Object.keys(RATIOS).find((k) => Math.abs(Math.log(RATIOS[k as keyof typeof RATIOS] / (w / h))) < 0.04) ?? "other"
export const resOf = (w: number, h: number) => {
  const s = Math.min(w, h)
  return s <= 480 ? "≤480p" : s <= 720 ? "720p" : s <= 1080 ? "1080p" : s <= 1440 ? "2K" : "4K"
}
// a sound's type, by the tool that made it (tools/audio.json's groups): a voice, a sound effect, an imported file, else
// music (Suno's too); and a file's format, by its extension
const VOICE_TOOLS = ["voice", "change-voice", "translate", "create-singer", "isolate-voice", "design-voice", "remix-voice", "transcribe"]
export const SOUND_TYPES = ["voice", "music", "sound", "import"] as const
export const SOUND_NAMES: Record<string, string> = { voice: t("Voice"), music: t("Music"), sound: t("Sound effect"), import: t("Imported") }
export const soundOf = (tool: string) => (tool === "sound-effect" ? "sound" : tool === "import" ? "import" : VOICE_TOOLS.includes(tool) ? "voice" : "music")
export const formatOf = (path: string) => path.split(".").pop()!.toLowerCase()
// the filters a list of results takes: a medium, then its own (a picture's format and quality, a sound's type and file
// format), the favorites
export type Filters = { kind: "all" | "image" | "video" | "audio"; ratio: string; res: string; type: string; format: string; favorites: boolean }
export const NO_FILTERS: Filters = { kind: "all", ratio: "all", res: "all", type: "all", format: "all", favorites: false }
export const activeFilters = (f: Filters) => [f.kind !== "all", f.ratio !== "all", f.res !== "all", f.type !== "all", f.format !== "all", f.favorites].filter(Boolean).length
export function passes(i: { path: string; job: Job }, f: Filters) {
  const { w, h } = factsOf(i)
  return (f.kind === "all" || mediaKind(i.path) === f.kind) && (!f.favorites || !!i.job.favorite) && (f.ratio === "all" || (!!w && !!h && ratioOf(w, h) === f.ratio)) && (f.res === "all" || (!!w && !!h && resOf(w, h) === f.res))
    && (f.type === "all" || (mediaKind(i.path) === "audio" && soundOf(i.job.tool) === f.type)) && (f.format === "all" || formatOf(i.path) === f.format)
}

// the orders a list of results takes, within each medium; kept in this browser
export type Sort = "newest" | "oldest" | "longest" | "shortest" | "sharpest" | "softest" | "name"
export const SORTS: [Sort, string][] = [["newest", t("Newest")], ["oldest", t("Oldest")], ["longest", t("Longest")], ["shortest", t("Shortest")], ["sharpest", t("Highest resolution")], ["softest", t("Lowest resolution")], ["name", t("Name A–Z")]]
// the results in that order (they come newest first); a file without the length or size sorted on goes last
export function sorted<T extends { path: string; job: Job }>(items: T[], sort: Sort): T[] {
  if (sort === "newest") return items
  if (sort === "oldest") return [...items].reverse()
  // by the tool's name as shown
  const name = (i: T) => `${own(i.job.label)} ${i.path.split(/[\\/]/).pop()}`
  if (sort === "name") return [...items].sort((a, b) => name(a).localeCompare(name(b), locale()))
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
