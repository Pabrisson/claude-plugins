// What a video is delivered with besides its MP4s: subtitles (SRT, WebVTT) and its description with YouTube's chapters.
// Every time here is in VIDEO seconds. And the render's raw stream, joined from its chunks.
import fs from 'node:fs'

// the head (IVF's file header, or nothing), then every chunk, one at a time: a long 4K stream outgrows the 2 GiB a
// single write takes
export function joinChunks(dest, files, head = Buffer.alloc(0)) {
  fs.writeFileSync(dest, head)
  for (const x of files) fs.appendFileSync(dest, fs.readFileSync(x))
}

const r2 = x => Math.round(x * 100) / 100
const pad = (n, k = 2) => String(n).padStart(k, '0')
const clock = t => `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}`
// hh:mm:ss,mmm (SRT) or hh:mm:ss.mmm (WebVTT)
const stamp = (t, sep) => {
  const m = Math.round(t * 1000)
  return `${pad(Math.floor(m / 3600000))}:${pad(Math.floor(m / 60000) % 60)}:${pad(Math.floor(m / 1000) % 60)}${sep}${pad(m % 1000, 3)}`
}

// The speech's words ({ w, v0, v1 }) as subtitle lines: 42 characters at most, a new one after a sentence or a pause
// of 0.5 s; each up from its first word to its last, 0.8 s at least, never over the next
export function speechCues(words, max = 42) {
  const cues = []
  for (const w of words) {
    const c = cues.at(-1), text = c && `${c.text} ${w.w}`
    if (!c || text.length > max || /[.!?…][»"”)]*$/.test(c.text) || w.v0 - c.v1 > 0.5) cues.push({ v0: w.v0, v1: w.v1, text: w.w })
    else Object.assign(c, { v1: w.v1, text })
  }
  cues.forEach((c, i) => (c.v1 = Math.min(Math.max(c.v1, c.v0 + 0.8), cues[i + 1]?.v0 ?? Infinity)))
  return cues
}

export const srt = cues => cues.map((c, i) => `${i + 1}\n${stamp(c.v0, ',')} --> ${stamp(c.v1, ',')}\n${c.text}\n`).join('\n')
export const vtt = cues => `WEBVTT\n\n${cues.map(c => `${stamp(c.v0, '.')} --> ${stamp(c.v1, '.')}\n${c.text}\n`).join('\n')}`

// YouTube's chapters from the part('sequence') calls: it shows them only with 3 or more, the first at 0:00, each 10 s
// or more. problems is empty when they qualify; text is the list for the description
export function chapters(parts) {
  const seqs = parts.filter(x => x.kind === 'sequence'), problems = []
  if (seqs.length < 3) problems.push(`${seqs.length} chapters, YouTube needs 3 or more (one part('sequence') each)`)
  if (seqs.length && seqs[0].t0 > 0.05) problems.push(`the first starts at ${r2(seqs[0].t0)} s, YouTube needs 0:00`)
  for (const x of seqs) if (x.t1 - x.t0 < 10) problems.push(`chapter "${x.name ?? '(no name)'}" lasts ${r2(x.t1 - x.t0)} s, YouTube needs 10 s or more`)
  return { count: seqs.length, problems, text: seqs.map(x => `${clock(x.t0)} ${x.name ?? ''}`.trim()).join('\n') }
}

// The text to paste under the video: About.md's "## Description" section (title, lines, hashtags written by Claude),
// then the chapters when YouTube would show them; '' when there is neither
export function description(about, parts) {
  const own = about.match(/^## Description\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1].trim(), ch = chapters(parts)
  return [own, !ch.problems.length && ch.text].filter(Boolean).join('\n\n')
}
