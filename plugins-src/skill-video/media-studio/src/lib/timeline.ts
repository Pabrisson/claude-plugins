// The timeline's edits, as plain functions of it (the editor, the App's Bridge shots and takes, the drag previews all
// use them). The main track (the bottom video track) holds its shots end to end, in order, from 0; on the other
// tracks a clip sits where it is put, and pushes the ones it would cover to the right
import type { Clip, Kind, Place, Timeline, Tool, Track } from "./api.ts"

// what a file lays on the timeline: its path and the generation it is from
export type Shot = { path: string; job: string }

// a still's length when laid, a freeze frame's
export const STILL = 3
export const FREEZE = 2
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

// a result laid where it was asked (see Place): by its clip (a take keeps the clip's time and length, shorter if the
// file is; whole and from take the result's; after and before make a shot of their own), or in a cut of its track (a
// new track when it is gone)
export function place(t: Timeline, shot: Shot, p: Place, dur?: number): Timeline {
  const old = p.replace ? t.clips.find((c) => c.id === p.replace) : null
  const file = { job: shot.job, file: shot.path.split("/").pop()!, path: shot.path, ...(p.mute ? { volume: 0 } : {}) }
  if (old && (p.how === "after" || p.how === "before")) {
    const after = p.how === "after"
    return put(t, { ...clipOf(shot, old.track, dur), ...file }, old.track, after ? endOf(old) : old.at, onTrack(t, old.track).indexOf(old) + Number(after))
  }
  if (old && p.how === "from") {
    // the stretch cut out of the clip first (from `to`, then from `from`): the result takes its place, the rest stays
    const time = (s: number) => old.at + Math.min(Math.max(s, old.in), old.out) - old.in, mid = uid()
    const cut = split(p.to == null ? t : split(t, old.id, time(p.to)), old.id, time(p.from ?? old.in), mid)
    return place(cut, shot, { ...p, replace: cut.clips.some((c) => c.id === mid) ? mid : old.id, how: "whole" }, dur)
  }
  if (old) return edit(t, old.id, { ...file, in: 0, out: dur == null ? lenOf(old) : p.how === "whole" ? dur : Math.min(lenOf(old), dur), dur })
  const tr = t.tracks.find((x) => x.id === p.track)
  if (!tr) return layOnNewTrack(t, shot, dur, p.at)
  if (tr.kind !== trackKind(shot.path)) return lay(t, shot, dur, undefined, p.at)
  // into the cut: after the shots that end there
  return put(t, clipOf(shot, p.track, dur), p.track, p.at, onTrack(t, p.track).filter((c) => endOf(c) <= p.at + 1e-3).length)
}

// a clip cut in two at a time on the timeline (none within a frame or two of its ends); second: the id of its second half
export const inside = (c: Clip, at: number) => at > c.at + 0.05 && at < endOf(c) - 0.05
export function split(t: Timeline, id: string, at: number, second = uid()): Timeline {
  const c = t.clips.find((x) => x.id === id)
  if (!c || !inside(c, at)) return t
  const cut = c.in + (at - c.at)
  return { ...t, clips: t.clips.flatMap((x) => (x.id === id ? [{ ...c, out: cut }, { ...c, id: second, at, in: cut }] : [x])) }
}
// a still of a clip's frame at a time, laid there for FREEZE seconds: the clip cut around it, what follows moved on
export function freeze(t: Timeline, id: string, at: number, still: Shot): Timeline {
  const c = t.clips.find((x) => x.id === id)
  if (!c) return t
  const cut = split(t, id, at), left = cut.clips.find((x) => x.id === id)!
  return put(cut, { ...clipOf(still, c.track), out: FREEZE }, c.track, endOf(left), onTrack(cut, c.track).indexOf(left) + 1)
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
// the voice a talking avatar of a clip says: the sound under it on a track playing (the one at the playhead first, else
// the longest together), with the stretch they share on the timeline
export function voiceUnder(t: Timeline, c: Clip, time: number) {
  const from = (v: Clip) => Math.max(c.at, v.at), to = (v: Clip) => Math.min(endOf(c), endOf(v))
  const list = t.clips.filter((v) => t.tracks.some((x) => x.id === v.track && x.kind === "audio" && !x.off) && to(v) - from(v) > 0.1)
  const v = list.find((v) => time >= from(v) && time < to(v)) ?? list.sort((a, b) => to(b) - from(b) - (to(a) - from(a)))[0]
  return v && { voice: v, from: from(v), to: to(v) }
}

// a picture's size already in the edit's format (a hair off counts as in it)
export const fits = (w: number, h: number, ratio: string) => Math.abs(Math.log(w / h / (RATIOS[ratio as keyof typeof RATIOS] ?? 16 / 9))) < 0.02
// Expand's margins that bring a picture to a format, half on each side, at most its own width or height a side
export function marginsTo(w: number, h: number, ratio: string): Record<string, string> {
  const r = RATIOS[ratio as keyof typeof RATIOS] ?? 16 / 9, wider = w / h < r
  const side = String(+Math.min(1, wider ? (h * r - w) / w / 2 : (w / r - h) / h / 2).toFixed(3))
  return fits(w, h, ratio) ? {} : wider ? { left: side, right: side } : { top: side, bottom: side }
}

// what Generate offers a clip: the tools that take its medium, by what they make of it (edit it: the result replaces
// it; start from its frame: an image animated, a shot going on from a frame of it). Left out: Extend (its own items),
// and what an edit has no use for yet (a depth map, HDR, a cut-out without layers)
export type Offer = { title: "edit" | "frame"; items: { kind: Kind; tool: Tool }[] }
const NOT_HERE = ["extend", "depth-map", "sdr-to-hdr", "remove-background"]
export function offers(tools: Record<Kind, Tool[]>, c: Clip, kind: Track["kind"]): Offer[] {
  const of = (k: Kind, ok: (t: Tool) => boolean) => tools[k].filter((t) => !NOT_HERE.includes(t.id) && ok(t)).map((tool) => ({ kind: k, tool }))
  const takes = (t: Tool, key: string, k: string) => t.inputs.some((i) => i.key === key && i.kind === k)
  const sound = of("audio", (t) => t.inputs.some((i) => i.kind === "media"))
  if (kind === "audio") return [{ title: "edit", items: sound }]
  const frames = { title: "frame" as const, items: of("video", (t) => takes(t, "first_frame", "image")) }
  if (isStill(c.path)) return [{ title: "edit", items: of("image", (t) => t.mode === "edit" && takes(t, "image", "image")) }, frames]
  return [{ title: "edit", items: [...of("video", (t) => takes(t, "video", "video")), ...sound] }, frames]
}

// every time a clip starts or ends, for ⏮ ⏭ and ↑ ↓
export const marks = (t: Timeline) => [...new Set([0, ...t.clips.flatMap((c) => [c.at, endOf(c)])])].sort((a, b) => a - b)
