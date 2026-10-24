import { Block, Lanes, type Lane } from "@/components/lanes"
import { clock, sameSound, soundColor, TRACKS, type Range, type Sound, type SoundRef, type Track } from "@/lib/studio"

// px: a track's row, a kind of sound's row
const LANE = 34, ROW = 20

// a level lane (dB every `step` s) as a waveform mirrored around its middle
function Level({ db, step, scale, color }: { db: number[]; step: number; scale: number; color: string }) {
  const h = (d: number) => Math.min(Math.max((d + 40) / 40, 0), 1) * 0.95
  const top = db.map((d, i) => `${i},${1 - h(d)}`), bottom = db.map((d, i) => `${i},${1 + h(d)}`).reverse()
  return (
    <svg
      viewBox={`0 0 ${Math.max(db.length - 1, 1)} 2`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-y-0 left-0 h-full"
      style={{ width: (db.length - 1) * step * scale }}
    >
      <path d={`M${top.join("L")}L${bottom.join("L")}Z`} fill={color} fillOpacity={0.45} />
    </svg>
  )
}

// The version's sound: one row per track with its level, then one row per kind of cue under the effects, each in its
// color. A row's name picks all of it for the next comment, a cue that cue.
export function SoundTimeline({
  sound,
  duration,
  time,
  range,
  picked,
  onSeek,
  onRange,
  onPick,
}: {
  sound: Sound
  duration: number
  time: number
  range: Range | null
  picked: SoundRef[]
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onPick: (s: SoundRef) => void
}) {
  const isPicked = (s: SoundRef) => picked.some((p) => sameSound(p, s))
  const tracks = (["voice", "music", "fx"] as Track[]).filter((k) => sound.tracks[k] || (k === "fx" && sound.cues.length))
  // in order of first appearance
  const kinds = [...new Set(sound.cues.map((c) => c.kind))]
  const lanes: Lane[] = [
    ...tracks.map((k) => ({
      key: k,
      label: TRACKS[k],
      height: LANE,
      color: soundColor(k),
      picked: isPicked(k),
      title: `Comment on the whole ${TRACKS[k].toLowerCase()} track`,
      onPick: () => onPick(k),
      content: (scale: number) => sound.tracks[k] && <Level db={sound.tracks[k]} step={sound.step} scale={scale} color={soundColor(k)} />,
    })),
    ...kinds.map((kind) => {
      const cues = sound.cues.filter((c) => c.kind === kind)
      return {
        key: `kind-${kind}`,
        label: kind,
        height: ROW,
        sub: true,
        color: soundColor({ kind }),
        picked: isPicked({ kind }),
        title: `Comment on every ${kind}`,
        onPick: () => onPick({ kind }),
        count: cues.length,
        content: (scale: number) =>
          cues.map((c, i) => {
            const { t, ...data } = c
            return (
              <Block
                key={i}
                t0={t}
                t1={t + (Number(c.dur) || 0)}
                scale={scale}
                height={ROW}
                color={soundColor(c)}
                picked={isPicked(c)}
                title={[clock(t), ...Object.entries(data).map(([a, b]) => `${a} ${JSON.stringify(b)}`)].join(" · ")}
                onClick={() => {
                  onPick(c)
                  onSeek(t)
                }}
              />
            )
          }),
      }
    }),
  ]
  return <Lanes lanes={lanes} duration={duration} time={time} range={range} onSeek={onSeek} onRange={onRange} />
}
