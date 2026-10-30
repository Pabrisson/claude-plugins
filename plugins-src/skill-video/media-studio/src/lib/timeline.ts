// The timeline's edits, as plain functions of it (the editor, the App's Bridge shots and takes, the drag previews all
// use them). The main track (the bottom video track) holds its shots end to end, in order, from 0; on the other
// tracks a clip sits where it is put, and pushes the ones it would cover to the right
import type { Clip, Place, Timeline, Track } from "./api.ts"

// what a file lays on the timeline: its path and the generation it is from
export type Shot = { path: string; job: string }

// a still's length when laid
export const STILL = 3
export const FPS = 30
export const RATIOS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 } as const

export const uid = () => Math.random().toString(36).slice(2, 9)
export const lenOf = (c: Clip) => c.out - c.in
export const endOf = (c: Clip) => c.at + lenOf(c)
export const totalOf = (t: Timeline) => Math.max(0, ...t.clips.map(endOf))
export const trackKind = (path: string): Track["kind"] => (/\.(mp3|wav|m4a|flac|ogg)$/i.test(path) ? "audio" : "video")
export const isStill = (path: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(path)
// the closest of the formats to a width / height
export const nearest = (r: number) => (Object.keys(RATIOS) as (keyof typeof RATIOS)[]).sort((a, b) => Math.abs(Math.log(RATIOS[a] / r)) - Math.abs(Math.log(RATIOS[b] / r)))[0]

// the main track: the bottom video track
export const mainOf = (t: Timeline) => t.tracks.filter((x) => x.kind === "video").at(-1)?.id
const onTrack = (t: Timeline, track: string) => t.clips.filter((c) => c.track === track).sort((a, b) => a.at - b.at)

// a timeline always has its main track and an audio track, even empty
export function withTracks(t: Timeline): Timeline {
  const need: Track[] = [...(t.tracks.some((x) => x.kind === "video") ? [] : [{ id: "v1", kind: "video" as const }]), ...(t.tracks.some((x) => x.kind === "audio") ? [] : [{ id: "a1", kind: "audio" as const }])]
  if (!need.length) return t
  const video = [...t.tracks.filter((x) => x.kind === "video"), ...need.filter((x) => x.kind === "video")]
  return { ...t, tracks: [...video, ...t.tracks.filter((x) => x.kind === "audio"), ...need.filter((x) => x.kind === "audio")] }
}

// a track's name: V1 the main track, then up; A1 the top audio track
export function trackName(t: Timeline, tr: Track) {
  const same = t.tracks.filter((x) => x.kind === tr.kind)
  return tr.kind === "video" ? `V${same.length - same.indexOf(tr)}` : `A${same.indexOf(tr) + 1}`
}
// the main track's shots by number (#1 the first), and where any clip is, as a result's button shows it
export function numbers(t: Timeline) {
  const main = mainOf(t)
  return Object.fromEntries(main ? onTrack(t, main).map((c, i) => [c.id, i + 1]) : [])
}
export function placeOf(t: Timeline, c: Clip) {
  const n = numbers(t)[c.id], tr = t.tracks.find((x) => x.id === c.track)
  return n ? `#${n}` : tr ? trackName(t, tr) : ""
}

// a track back in shape: the main track's shots end to end in their order, another's pushed right where they meet; on
// a tie the clip just put (first) goes first
export function settle(t: Timeline, track: string, first?: string): Timeline {
  const list = t.clips.filter((c) => c.track === track).sort((a, b) => a.at - b.at || Number(b.id === first) - Number(a.id === first))
  const main = track === mainOf(t), moved = new Map<string, number>()
  let cur = main ? 0 : -Infinity
  for (const c of list) {
    const at = main ? cur : Math.max(c.at, cur)
    moved.set(c.id, at)
    cur = at + lenOf(c)
  }
  return { ...t, clips: t.clips.map((c) => (moved.has(c.id) ? { ...c, at: moved.get(c.id)! } : c)) }
}
// a clip put on a track at a time: on the main track into the cut nearest that time (by the clip's middle, or the
// index of the cut given), elsewhere right there
export function put(t: Timeline, clip: Clip, track: string, at: number, index?: number): Timeline {
  const rest = { ...t, clips: t.clips.filter((c) => c.id !== clip.id) }
  if (track !== mainOf(t)) return settle({ ...rest, clips: [...rest.clips, { ...clip, track, at: Math.max(0, at) }] }, track, clip.id)
  const shots = onTrack(rest, track), mid = at + lenOf(clip) / 2, i = index ?? shots.filter((c) => c.at + lenOf(c) / 2 < mid).length
  const ordered = [...shots.slice(0, i), { ...clip, track }, ...shots.slice(i)]
  let cur = 0
  const placed = new Map(ordered.map((c) => [c.id, (cur += lenOf(c)) - lenOf(c)]))
  return { ...rest, clips: [...rest.clips.filter((c) => c.track !== track), ...ordered.map((c) => ({ ...c, at: placed.get(c.id)! }))] }
}
// a clip moved: put on its new track and time, its old track closing the gap if it was the main one
export function move(t: Timeline, id: string, track: string, at: number): Timeline {
  const c = t.clips.find((x) => x.id === id)
  if (!c) return t
  const done = put(t, c, track, at)
  return c.track !== track && c.track === mainOf(t) ? settle(done, c.track) : done
}
export function remove(t: Timeline, id: string): Timeline {
  const c = t.clips.find((x) => x.id === id)
  const rest = { ...t, clips: t.clips.filter((x) => x.id !== id) }
  return c && c.track === mainOf(t) ? settle(rest, c.track) : rest
}
// a clip trimmed or its file swapped: its track settles around its new length
export function edit(t: Timeline, id: string, patch: Partial<Clip>): Timeline {
  const c = t.clips.find((x) => x.id === id)
  return c ? settle({ ...t, clips: t.clips.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, c.track, id) : t
}

// the track a file goes on: the one asked if of its kind, else the main track or the top audio track (made when there
// is none)
function trackFor(t: Timeline, kind: Track["kind"], want?: string): [Timeline, string] {
  const asked = t.tracks.find((x) => x.id === want && x.kind === kind)
  if (asked) return [t, asked.id]
  const same = t.tracks.filter((x) => x.kind === kind)
  if (same.length) return [t, (kind === "video" ? same.at(-1) : same[0])!.id]
  const id = `${kind[0]}${uid()}`
  return [{ ...t, tracks: kind === "video" ? [...t.tracks.filter((x) => x.kind === "video"), { id, kind }, ...t.tracks.filter((x) => x.kind !== "video")] : [...t.tracks, { id, kind }] }, id]
}
export const clipOf = (shot: Shot, track: string, dur?: number, id = uid()): Clip => ({ id, track, job: shot.job, file: shot.path.split("/").pop()!, path: shot.path, at: 0, in: 0, out: dur ?? STILL, ...(dur ? { dur } : {}) })

// a file laid on the timeline: at a time on a track, else after the last clip of its track; dur, its length (none for
// a still); id, to know it again (a drag's preview)
export function lay(t: Timeline, shot: Shot, dur?: number, track?: string, at?: number, id?: string): Timeline {
  const [t2, tr] = trackFor(t, trackKind(shot.path), track)
  return put(t2, clipOf(shot, tr, dur, id), tr, at ?? Math.max(0, ...t2.clips.filter((c) => c.track === tr).map(endOf)))
}
// a new track of a kind, a file laid on it: a video track goes on top, an audio track at the bottom
export function layOnNewTrack(t: Timeline, shot: Shot, dur?: number, at = 0, id?: string): Timeline {
  const kind = trackKind(shot.path), tr = `${kind[0]}${uid()}`
  const t2 = { ...t, tracks: kind === "video" ? [{ id: tr, kind }, ...t.tracks] : [...t.tracks, { id: tr, kind }] }
  return put(t2, clipOf(shot, tr, dur, id), tr, at)
}

// a result laid where its Bridge shot or take asked: in place of a clip (its time and length kept, shorter if the file
// is), or in a cut of its track
export function place(t: Timeline, shot: Shot, p: Place, dur?: number): Timeline {
  const old = p.replace ? t.clips.find((c) => c.id === p.replace) : null
  if (old) return edit(t, old.id, { job: shot.job, file: shot.path.split("/").pop()!, path: shot.path, in: 0, out: Math.min(lenOf(old), dur ?? STILL), dur })
  if (!t.tracks.some((x) => x.id === p.track && x.kind === trackKind(shot.path))) return lay(t, shot, dur, undefined, p.at)
  // into the cut: after the shots that end there
  return put(t, clipOf(shot, p.track, dur), p.track, p.at, onTrack(t, p.track).filter((c) => endOf(c) <= p.at + 1e-3).length)
}

// a clip cut in two at a time on the timeline
export function split(t: Timeline, id: string, at: number): Timeline {
  const c = t.clips.find((x) => x.id === id)
  if (!c || at <= c.at + 0.05 || at >= endOf(c) - 0.05) return t
  const cut = c.in + (at - c.at)
  return { ...t, clips: t.clips.flatMap((x) => (x.id === id ? [{ ...c, out: cut }, { ...c, id: uid(), at, in: cut }] : [x])) }
}
// a clip again, right after it
export function duplicate(t: Timeline, id: string): Timeline {
  const c = t.clips.find((x) => x.id === id)
  return c ? put(t, { ...c, id: uid() }, c.track, endOf(c), onTrack(t, c.track).indexOf(c) + 1) : t
}

// the cuts a Bridge shot can fill: two shots one after the other on the main track
export function cuts(t: Timeline) {
  const main = mainOf(t), list = main ? onTrack(t, main) : []
  return list.slice(1).map((b, i) => ({ a: list[i], b }))
}
// every time a clip starts or ends, for ⏮ ⏭ and ↑ ↓
export const marks = (t: Timeline) => [...new Set([0, ...t.clips.flatMap((c) => [c.at, endOf(c)])])].sort((a, b) => a - b)
