import { makeTimeline } from "@engine/timeline.js"

// screen: a line of what the video shows (no speech), one per moment
export type Word = { w: string; t0: number; t1: number; screen?: boolean }
// a transcript word placed on one version's video time
export type VWord = Word & { v0: number; v1: number }
export type VideoFile = { file: string; url: string; size: number; mtime: string }
// a video of the folder, for the switcher: its last version and its poster (a file of its output/)
export type VideoItem = { slug: string; versions: number; rendered: string | null; duration: number | null; poster: string | null }
export type Version = {
  v: number
  rough?: boolean
  // a review draft (render --draft): the main format in 720p, sharp
  draft?: boolean
  rendered: string
  duration: number
  timeline: { speed: number; segments: [number, number][] } | null
  files: Record<string, VideoFile | null>
}
// what is being done on the video (the project's .cache/progress.json): the engine's commands and Claude's own steps
export type Step = {
  id: string
  label: string
  by: "engine" | "claude"
  state: "running" | "done" | "failed"
  t0: string
  t1?: string
  // the chunks of a render
  done?: number
  total?: number
}
// touched: the file Claude changed last (About.md, source/…), the work going on between two logged steps
// started: when the project was created (null for an older one), the start of the total time
export type Progress = { updated: string | null; steps: Step[]; touched: { file: string; mtime: string } | null; started?: string | null }
export type Project = {
  slug: string
  dir: string
  formats: string[]
  fps: number
  // the codec's label (H.264…); missing from an older server
  codec?: string
  source: boolean
  rules: string[]
  words: Word[] | null
  versions: Version[]
}
// the project's pack (api/rules), as Claude reads it: its text, and the params the engine follows with the project's
// overrides. body null: a pack no longer installed
export type Pack = { name: string; description: string | null; origin: string | null; file: string | null; body: string | null }
export type Rules = { params: Record<string, unknown>; overrides: Record<string, unknown>; packs: Pack[] }
export type Kind = "comment" | "cut"
// the parts of the mix: the voice, sound.py's music and effects buses, the media clips' own sound
export type Track = "voice" | "music" | "fx" | "clips"
// one of the scene's cue(kind, t, data) calls, t in video seconds
export type Cue = { kind: string; t: number; [data: string]: unknown }
// a version's sound (files/sound/vN.json): its cues, and each track's level in dB every `step` seconds
export type Sound = { cues: Cue[]; step: number; tracks: Partial<Record<Track, number[]>> }
// what a comment points at in the sound: a whole track, one cue, or every cue of a kind
export type SoundRef = Track | Cue | { kind: string }
// one of the scene's part(kind, t0, t1, data) calls (video seconds): a sequence, a title, a clip, a take of the
// source… `color`: the palette color of its `field`
export type Part = { kind: string; t0: number; t1: number; name?: string; color?: string; [data: string]: unknown }
// a sheet of thumbnails, one every `every` s, `cols` per row, `w`×`h` px each
export type Strip = { file: string; every: number; count: number; cols: number; w: number; h: number }
// a version's Clip tab (files/video/vN.json): its parts, and a strip per format
export type Visual = { parts: Part[]; strips: Record<string, Strip> }
// what a comment points at in the picture: one part, or every part of a kind
export type VisualRef = Part | { kind: string }
// size and ratio are missing on images attached before they were recorded
export type Image = { path: string; size?: [number, number]; ratio?: string }
// t0/t1: video seconds of the reviewed version; s0/s1: source seconds
export type Comment = {
  id: string
  type: Kind
  t0: number
  t1: number
  s0?: number
  s1?: number
  text: string
  words: string
  images: Image[]
  sounds?: SoundRef[]
  visuals?: VisualRef[]
  resolved: boolean
  reply?: string
  created: string
  format?: string
  // "transcript": made on a selection of the transcript
  from?: "transcript"
  // a line of what the video shows, corrected in the transcript
  fix?: { from: string; to: string }
}
// from: where the selection was made, when it was the transcript
export type Range = { t0: number; t1: number; from?: "transcript" }

async function json(r: Response) {
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? r.statusText)
  return r.json()
}

// relative URLs: the page lives at /<slug>/
export const api = {
  project: (): Promise<Project> => fetch("api/project").then(json),
  projects: (): Promise<VideoItem[]> => fetch("api/projects").then(json),
  reviews: (v: number): Promise<{ comments: Comment[] }> =>
    fetch(`api/reviews/v${v}`)
      .then(json)
      // images used to be bare paths
      .then((r) => ({
        comments: r.comments.map((c: Comment) => ({
          ...c,
          images: (c.images ?? []).map((i: Image | string) => (typeof i === "string" ? { path: i } : i)),
        })),
      })),
  // null for a version without sound (a rough cut, a silent video)
  sound: (v: number): Promise<Sound | null> =>
    fetch(`project/files/sound/v${v}.json`).then((r) => (r.ok ? r.json() : null)),
  // null for a version made before the Clip tab
  video: (v: number): Promise<Visual | null> =>
    fetch(`project/files/video/v${v}.json`).then((r) => (r.ok ? r.json() : null)),
  save: (v: number, comments: Comment[]) =>
    fetch(`api/reviews/v${v}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments }),
    }).then(json),
  progress: (): Promise<Progress> => fetch("api/progress").then(json),
  rules: (): Promise<Rules> => fetch("api/rules").then(json),
  image: (id: string, png: Blob): Promise<{ path: string }> =>
    fetch(`api/review-image?id=${id}`, { method: "POST", body: png }).then(json),
}

const RATIOS = ["16:9", "9:16", "1:1", "4:5", "5:4", "4:3", "3:4", "3:2", "2:3", "16:10", "21:9"]
// 1080×1920 → 9:16; an odd size keeps its plain ratio (1.53:1)
export function ratioName(w: number, h: number) {
  const near = RATIOS.find((r) => {
    const [a, b] = r.split(":").map(Number)
    return Math.abs((a / b) * (h / w) - 1) < 0.015
  })
  return near ?? `${(w / h).toFixed(2)}:1`
}

export const TRACKS: Record<Track, string> = { voice: "Voice", music: "Music", fx: "Effects", clips: "Clips" }
export const sameSound = (a: SoundRef, b: SoundRef) =>
  typeof a === "string" || typeof b === "string" ? a === b : a.kind === b.kind && (a as Cue).t === (b as Cue).t
export const soundLabel = (s: SoundRef) =>
  typeof s === "string" ? TRACKS[s] : "t" in s ? `${s.kind} ${minutes((s as Cue).t)}` : `every ${s.kind}`
// one hue per name (a track, a kind), the same in the timeline and on the badges
export function colorOf(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `oklch(0.74 0.14 ${(h * 137.508) % 360})`
}
export const soundColor = (s: SoundRef) => colorOf(typeof s === "string" ? s : s.kind)
// where a sound or a part sits in the Sound and Clip tabs (data-spot), for a badge to point at it
export const soundSpot = (s: SoundRef) =>
  typeof s === "string" ? `sound:${s}` : "t" in s ? `sound:${s.kind}@${(s as Cue).t}` : `sound:${s.kind}`
export const visualSpot = (x: VisualRef) => ("t0" in x ? `visual:${x.kind}@${(x as Part).t0}` : `visual:${x.kind}`)
export const sameVisual = (a: VisualRef, b: VisualRef) => a.kind === b.kind && (a as Part).t0 === (b as Part).t0
export const visualLabel = (x: VisualRef) =>
  "t0" in x ? `${(x as Part).name ?? x.kind} ${minutes((x as Part).t0)}` : `every ${x.kind}`
// a part on its field's color, otherwise its kind's
export const visualColor = (x: VisualRef) => (x as Part).color ?? colorOf(x.kind)

export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// 00:36.87
export const clock = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`
// 0:10
export const minutes = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
// 6 Oct, 10:19
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

export const timeline = (ver: Version) => makeTimeline(ver.timeline)

// the source words this version kept, on its video time
export function versionWords(words: Word[], ver: Version): VWord[] {
  const segs = ver.timeline?.segments, tl = timeline(ver)
  // whisper's word edges are loose: a word touching a kept segment is kept
  const kept = (w: Word) => !segs || segs.some(([a, b]) => w.t1 > a && w.t0 < b)
  return words
    .filter(kept)
    .map((w) => ({ ...w, v0: tl.toVideo(w.t0), v1: tl.toVideo(w.t1) }))
}

// the words said (or shown) over a range; a point takes the second around it
export function wordsIn(words: VWord[], { t0, t1 }: Range) {
  const [a, b] = t1 > t0 ? [t0, t1] : [t0 - 1, t0 + 1]
  return words
    .filter((w) => w.v1 > a && w.v0 < b)
    .map((w) => w.w)
    .join(words[0]?.screen ? " / " : " ")
}

const secs = (t: number) => `${t.toFixed(2)} s`

// a comment's number in its version (#3), the same in the studio and in the prompt
export const numberOf = (all: Comment[], c: Comment) => all.indexOf(c) + 1

// the mark of the open comments that `hit` finds: their numbers ("#2", "#2 +1"), and a click that shows them
export type Marks = { label: string; title: string; onClick: () => void } | undefined
export function markOf(all: Comment[], hit: (c: Comment) => boolean, show: (ids: string[]) => void): Marks {
  const ns = all.filter((c) => !c.resolved && hit(c)).map((c) => numberOf(all, c))
  if (!ns.length) return undefined
  return {
    label: `#${ns[0]}${ns.length > 1 ? ` +${ns.length - 1}` : ""}`,
    title: `Feedback ${ns.map((n) => `#${n}`).join(", ")}`,
    onClick: () => show(ns.map((n) => all[n - 1].id)),
  }
}

// the text Claude receives: every open item with both clocks, the words and the id
export function buildPrompt(p: Project, ver: Version, all: Comment[]) {
  const open = all.filter((c) => !c.resolved)
  const video = ver.files[p.formats[0]] ?? Object.values(ver.files).find(Boolean)
  const lines = [
    `/skill-video:video-editor apply this feedback to the video ${p.slug} (${p.dir})`,
    "",
    `Reviewed video: ${p.dir}/output/${video?.file}, version v${ver.v} of ${when(ver.rendered)}, length ${clock(ver.duration)} (${secs(ver.duration)}).`,
    `${open.length} change${open.length > 1 ? "s" : ""} to apply:`,
  ]
  open.forEach((c) => {
    const range = c.t1 > c.t0
    const where = range
      ? `from ${clock(c.t0)} to ${clock(c.t1)} (VIDEO ${secs(c.t0)} → ${secs(c.t1)}, ${secs(c.t1 - c.t0)})`
      : `at ${clock(c.t0)} (VIDEO ${secs(c.t0)})`
    // SCENE: the scene's own seconds without a source, which a cut moves away from the video's
    const own = p.source ? "SOURCE" : "SCENE"
    const source =
      c.s0 === undefined
        ? ""
        : range && c.s1 !== undefined
          ? ` · ${own} ${secs(c.s0)} → ${secs(c.s1)}`
          : ` · ${own} ${secs(c.s0)}`
    const format = p.formats.length > 1 && c.format ? ` [format ${c.format}]` : ""
    lines.push(`${numberOf(all, c)}. ${c.type.toUpperCase()} ${where}${source} [id ${c.id}]${format}`)
    if (c.words) lines.push(`   ${p.words?.[0]?.screen ? "On screen" : "Words"}${c.from === "transcript" ? " (selected in the transcript)" : ""}: "${c.words}"`)
    if (c.fix) lines.push(`   Text fix: "${c.fix.from}" → "${c.fix.to}"`)
    if (c.text) lines.push(`   Request: ${c.text}`)
    for (const s of c.sounds ?? []) {
      if (typeof s === "string")
        lines.push(`   Sound: the ${s} track${s === "voice" ? "" : s === "clips" ? " (the media clips' own sound)" : ` (sound.py's ${s} bus)`}`)
      else if (!("t" in s)) lines.push(`   Sound: every "${s.kind}" cue (the sound sound.py designs for this kind)`)
      else {
        const { kind, t, ...data } = s as Cue
        const extra = Object.entries(data).map(([k, x]) => `${k} ${JSON.stringify(x)}`).join(", ")
        lines.push(`   Sound: cue "${kind}" at ${clock(t)} (VIDEO ${secs(t)} · ${p.source ? "SOURCE" : "SCENE"} ${secs(timeline(ver).toSource(t))})${extra ? ` ${extra}` : ""}`)
      }
    }
    for (const x of c.visuals ?? []) {
      if (!("t0" in x)) lines.push(`   Visual: every "${x.kind}" part`)
      else {
        const { kind, t0, t1, name, ...data } = x as Part, tl = timeline(ver)
        const extra = Object.entries(data).filter(([k]) => k !== "color").map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ")
        lines.push(`   Visual: ${kind}${name ? ` "${name}"` : ""} from ${clock(t0)} to ${clock(t1)} (VIDEO ${secs(t0)} → ${secs(t1)} · ${own} ${secs(tl.toSource(t0))} → ${secs(tl.toSource(t1))})${extra ? ` ${extra}` : ""}`)
      }
    }
    for (const img of c.images)
      lines.push(`   Image${img.ratio ? ` (${img.ratio}, ${img.size?.join("×")} px)` : ""}: ${p.dir}/${img.path}`)
  })
  // how to read the list and where to answer, so the prompt stands on its own
  lines.push(
    "",
    "Times: mm:ss.cc = minutes:seconds.hundredths (00:12.50 = 12.50 s), the same value as the seconds in parentheses.",
    p.source
      ? "Types: CUT = remove the range (it goes in `cut`, in SOURCE time); COMMENT = any other request (visual, text, caption, sound, pace), at a moment or over a range."
      : "Types: CUT = remove the range from the video (it goes in `cut` in source/edit.json, in SCENE time: the scene's own seconds); COMMENT = any other request (visual, text, sound, pace), at a moment or over a range.",
    ...(open.some((c) => c.fix)
      ? [
          p.words?.[0]?.screen
            ? "Text fix: the user corrected a line of what the video shows: write the new text in the scene at that moment, as given, and change nothing else."
            : `Text fix: the user corrected a word of the transcript (the captions and subtitles show it): run \`video.mjs fix <SOURCE seconds> "<new text>" -p ${p.slug}\` with the comment's SOURCE time; "" removes the word.`,
        ]
      : []),
    ...(open.some((c) => c.sounds?.length)
      ? [`Sound: a track is a part of the mix (voice, sound.py's music or fx bus, or clips: the media clips' own sound, set by their volume in edit.json) over the comment's time; a cue is the scene's cue(kind, t, data) call, heard as the sound sound.py designs for its kind ("every" means all the cues of that kind). This version's cues and track levels: ${p.dir}/files/sound/v${ver.v}.json.`]
      : []),
    ...(open.some((c) => c.visuals?.length)
      ? [`Visual: a part is the scene's part(kind, t0, t1, data) call: find it in source/scene.js by its kind, name and times ("every" means all the parts of that kind; a take is a kept piece of the source, a clip a media of edit.json). This version's parts: ${p.dir}/files/video/v${ver.v}.json.`]
      : []),
    "",
    `Feedback file: ${p.dir}/files/reviews/v${ver.v}.json (video version v${ver.v}, same ids). For each change applied, set "resolved": true and write what you did in one sentence in "reply", the studio shows it.`,
    `Change only these points and keep the rest of the edit identical. Times are VIDEO time (or ${p.source ? "SOURCE" : "SCENE"} when stated). Rerun the steps needed (${p.source ? "prepare, rough, " : ""}stills, render, audio, final): the new render opens the next version, and the open studio offers to reload it.`
  )
  return lines.join("\n")
}
