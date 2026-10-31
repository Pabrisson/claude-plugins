import type { CSSProperties, ReactNode } from "react"

// what a camera move does, drawn: a small icon (camera, subject, arrow) and a scene of three planes that the move
// animates (a zoom grows them alike, a dolly or a truck moves the near plane more, an orbit slides them apart)

const cam = <><rect x="2" y="9" width="7" height="6" rx="1.2" /><path d="M9 11l3-1.5v5L9 13" /></>
const camTop = <><rect x="8.5" y="11" width="7" height="6" rx="1.2" /><path d="M10.5 11l-1-3h5l-1 3" /></>
const person = <><circle cx="19" cy="8" r="2" /><path d="M19 10v6M16.5 13h5" /></>
const center = <><circle cx="12" cy="9" r="2" /><path d="M12 11v5M9.5 13.5h5" /></>
const right = <path d="M5 20h13M15 17.5l3 2.5-3 2.5" />
const left = <path d="M18 20H5M8 17.5L5 20l3 2.5" />
const lens = (plus: boolean) => <><circle cx="10.5" cy="10.5" r="6.5" /><path d={`M15.5 15.5L21 21M8 10.5h5${plus ? "M10.5 8v5" : ""}`} /></>
const drone = (x: number, y: number) => <><path d={`M${x - 3} ${y - 3}l6 6M${x + 3} ${y - 3}l-6 6`} /><circle cx={x - 3.5} cy={y - 3.5} r="1.4" /><circle cx={x + 3.5} cy={y - 3.5} r="1.4" /><circle cx={x - 3.5} cy={y + 3.5} r="1.4" /><circle cx={x + 3.5} cy={y + 3.5} r="1.4" /></>

const ICONS: Record<string, ReactNode> = {
  "static shot": <>{cam}{person}<path d="M5.5 15l-2.5 6M5.5 15l2.5 6" /></>,
  "dolly in": <>{cam}{person}{right}</>,
  "dolly out": <>{cam}{person}{left}</>,
  "slow zoom in": lens(true),
  "slow zoom out": lens(false),
  "crash zoom": <>{lens(true)}<path d="M2.5 3.5l2 2M6.5 1.5v3M1.5 7.5h3" /></>,
  "dolly zoom": <><rect x="2.5" y="4.5" width="19" height="15" rx="1.5" /><rect x="8.5" y="9" width="7" height="6" rx="1" /><path d="M2.5 4.5l6 4.5M21.5 4.5l-6 4.5M2.5 19.5l6-4.5M21.5 19.5l-6-4.5" /></>,
  "pan left": <>{camTop}<path d="M17.5 7a7 7 0 0 0-11 0M6.5 7l.4-3M6.5 7l3 .8" /></>,
  "pan right": <>{camTop}<path d="M6.5 7a7 7 0 0 1 11 0M17.5 7l-.4-3M17.5 7l-3 .8" /></>,
  "whip pan": <>{camTop}<path d="M6.5 7a7 7 0 0 1 11 0M17.5 7l-.4-3M17.5 7l-3 .8M2 13h4M3 16h3" /></>,
  "tilt up": <>{cam}<path d="M18 18a7 7 0 0 0 0-12M18 6l-3 .6M18 6l.9 2.9" /></>,
  "tilt down": <>{cam}<path d="M18 6a7 7 0 0 1 0 12M18 18l-3-.6M18 18l.9-2.9" /></>,
  "truck left": <><rect x="8.5" y="6" width="7" height="6" rx="1.2" /><path d="M10.5 6l-1-3h5l-1 3" />{left}</>,
  "truck right": <><rect x="8.5" y="6" width="7" height="6" rx="1.2" /><path d="M10.5 6l-1-3h5l-1 3" />{right}</>,
  "side tracking": <><circle cx="12" cy="3.5" r="1.8" /><path d="M12 5.3v4.2M15 7.5h6M19 5.5l2 2-2 2" /><rect x="8.5" y="13" width="7" height="5" rx="1" /><path d="M15 21h6M19 19l2 2-2 2" /></>,
  "crane up": <><path d="M3 21h8M7 21v-3L16 9" /><rect x="14.5" y="4.5" width="6" height="5" rx="1" /><path d="M21.5 21v-7M19.5 16l2-2 2 2" /></>,
  "crane down": <><path d="M3 21h8M7 21v-3L16 9" /><rect x="14.5" y="4.5" width="6" height="5" rx="1" /><path d="M21.5 14v7M19.5 19l2 2 2-2" /></>,
  "pedestal up": <><path d="M8 21h6M11 21v-6" /><rect x="7.5" y="9" width="7" height="6" rx="1.2" /><path d="M19 14V4M16.5 6.5L19 4l2.5 2.5" /></>,
  "pedestal down": <><path d="M8 21h6M11 21v-6" /><rect x="7.5" y="9" width="7" height="6" rx="1.2" /><path d="M19 4v10M16.5 11.5L19 14l2.5-2.5" /></>,
  "arc left": <>{center}<path d="M19 17a7.5 4.5 0 0 1-14 0M5 17l.3-3M5 17l3 .4" /><circle cx="19" cy="17" r="1.4" /></>,
  "arc right": <>{center}<path d="M5 17a7.5 4.5 0 0 0 14 0M19 17l-.3-3M19 17l-3 .4" /><circle cx="5" cy="17" r="1.4" /></>,
  "orbit around the subject": <>{center}<ellipse cx="12" cy="15" rx="9.5" ry="4.5" /><path d="M14 19.5h-3M14 19.5l-2-2" /></>,
  "bullet time": <>{center}<ellipse cx="12" cy="15" rx="9.5" ry="4.5" strokeDasharray="2 2.2" /><path d="M18.5 2.5v4M21.5 2.5v4" /></>,
  "tracking shot following the subject": <>{cam}{person}<path d="M14 4h7M19 2l2 2-2 2" />{right}</>,
  handheld: <>{cam}<path d="M3 20l3-2.5 3 3 3-3 3 3 3-3 3 2.5" /></>,
  "Steadicam follow": <>{cam}{person}<path d="M2 20c3-3 5 3 8 0s5-3 8 0" /></>,
  "snorricam on the actor": <><circle cx="16" cy="7" r="3" /><path d="M16 10v9M13 14h6M16 15H8" /><rect x="2" y="4.5" width="5" height="5" rx="1" /><path d="M7 7l2 0M8 15V9.5" /></>,
  POV: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></>,
  "FPV drone dive": <>{drone(7, 7)}<path d="M12 12l8 8M15.5 20H20v-4.5" /></>,
  "drone orbit": <>{drone(12, 5)}<ellipse cx="12" cy="17" rx="9" ry="3.5" /><path d="M12 14v3" /></>,
  "aerial pullback": <><circle cx="5" cy="17" r="1.8" /><path d="M5 18.8V22M9 15L19 5M13.5 5H19v5.5" /></>,
  "helicopter shot": <><path d="M3 4h12M9 4v2.5" /><ellipse cx="9" cy="9.5" rx="4" ry="2.5" /><path d="M13 9.5h6l1.5-2" />{right}</>,
  "robot arm move": <><path d="M3 21h7M6.5 21v-4l6-6 4.5 2" /><circle cx="6.5" cy="17" r="1.3" /><circle cx="12.5" cy="11" r="1.3" /><rect x="17" y="10.5" width="5" height="5" rx="1" /></>,
  "rack focus": <><circle cx="7" cy="11" r="4.5" /><circle cx="18" cy="11" r="2.5" strokeDasharray="1.5 1.5" /><path d="M11 19.5h7M16 17.5l2 2-2 2" /></>,
}

export function MoveIcon({ move, className }: { move: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {ICONS[move] ?? cam}
    </svg>
  )
}

// each move: an animation for the whole frame, or for the far, middle (the subject) and near planes apart
type Planes = { all?: string; bg?: string; mid?: string; fg?: string }
const loop = (name: string, s = 2.6, how = "ease-in-out", dir = "alternate") => `${name} ${s}s ${how} infinite ${dir}`
const MOVES: Record<string, Planes> = {
  "static shot": {},
  "dolly in": { fg: loop("mv-in-fg"), mid: loop("mv-in-mid"), bg: loop("mv-in-bg") },
  "dolly out": { fg: loop("mv-in-fg", 2.6, "ease-in-out", "alternate-reverse"), mid: loop("mv-in-mid", 2.6, "ease-in-out", "alternate-reverse"), bg: loop("mv-in-bg", 2.6, "ease-in-out", "alternate-reverse") },
  "slow zoom in": { all: loop("mv-zoom") },
  "slow zoom out": { all: loop("mv-zoom", 2.6, "ease-in-out", "alternate-reverse") },
  "crash zoom": { all: loop("mv-crash", 2.2, "ease-in", "alternate") },
  "dolly zoom": { bg: loop("mv-vertigo") },
  "pan left": { all: loop("mv-pan") },
  "pan right": { all: loop("mv-pan", 2.6, "ease-in-out", "alternate-reverse") },
  "whip pan": { all: loop("mv-whip", 1.8, "ease-in-out") },
  "tilt up": { all: loop("mv-tilt") },
  "tilt down": { all: loop("mv-tilt", 2.6, "ease-in-out", "alternate-reverse") },
  "truck left": { fg: loop("mv-tr-fg", 2.6, "ease-in-out", "alternate-reverse"), mid: loop("mv-tr-mid", 2.6, "ease-in-out", "alternate-reverse"), bg: loop("mv-tr-bg", 2.6, "ease-in-out", "alternate-reverse") },
  "truck right": { fg: loop("mv-tr-fg"), mid: loop("mv-tr-mid"), bg: loop("mv-tr-bg") },
  "side tracking": { fg: loop("mv-tr-fg"), bg: loop("mv-tr-bg"), mid: loop("mv-bob", 0.45) },
  "crane up": { fg: loop("mv-up-fg"), mid: loop("mv-up-mid"), bg: loop("mv-up-bg") },
  "crane down": { fg: loop("mv-up-fg", 2.6, "ease-in-out", "alternate-reverse"), mid: loop("mv-up-mid", 2.6, "ease-in-out", "alternate-reverse"), bg: loop("mv-up-bg", 2.6, "ease-in-out", "alternate-reverse") },
  "pedestal up": { all: loop("mv-tilt") },
  "pedestal down": { all: loop("mv-tilt", 2.6, "ease-in-out", "alternate-reverse") },
  "arc left": { fg: loop("mv-orb-fg"), bg: loop("mv-orb-bg") },
  "arc right": { fg: loop("mv-orb-fg", 2.6, "ease-in-out", "alternate-reverse"), bg: loop("mv-orb-bg", 2.6, "ease-in-out", "alternate-reverse") },
  "orbit around the subject": { fg: loop("mv-orb-fg", 3, "linear"), bg: loop("mv-orb-bg", 3, "linear") },
  "bullet time": { fg: loop("mv-orb-fg", 5, "linear"), bg: loop("mv-orb-bg", 5, "linear") },
  "tracking shot following the subject": { fg: loop("mv-track-fg", 1.6, "linear", "normal"), bg: loop("mv-track-bg", 1.6, "linear", "normal"), mid: loop("mv-bob", 0.4) },
  handheld: { all: loop("mv-shake", 0.9, "linear", "normal") },
  "Steadicam follow": { all: loop("mv-float", 3) },
  "snorricam on the actor": { bg: loop("mv-sway", 1.2), fg: loop("mv-sway", 1.2) },
  POV: { all: loop("mv-pov", 2.4) },
  "FPV drone dive": { all: loop("mv-dive", 1.6, "ease-in") },
  "drone orbit": { all: loop("mv-high", 3), fg: loop("mv-orb-fg", 3, "linear"), bg: loop("mv-orb-bg", 3, "linear") },
  "aerial pullback": { all: loop("mv-pull", 3) },
  "helicopter shot": { all: loop("mv-heli", 4) },
  "robot arm move": { all: loop("mv-robot", 2, "cubic-bezier(.7,0,.3,1)") },
  "rack focus": { fg: loop("mv-blur-out", 1.8), mid: loop("mv-blur-in", 1.8), bg: loop("mv-blur-in", 1.8) },
}

const KEYFRAMES = `
@keyframes mv-zoom { to { transform: scale(1.4) } }
@keyframes mv-crash { 0%, 35% { transform: scale(1) } 50%, 100% { transform: scale(2.1) } }
@keyframes mv-in-fg { to { transform: scale(1.8) } }
@keyframes mv-in-mid { to { transform: scale(1.4) } }
@keyframes mv-in-bg { to { transform: scale(1.12) } }
@keyframes mv-vertigo { to { transform: scale(1.7) } }
@keyframes mv-pan { to { transform: translateX(34px) } }
@keyframes mv-whip { 0%, 30% { transform: translateX(0); filter: blur(0) } 50% { filter: blur(4px) } 70%, 100% { transform: translateX(-70px); filter: blur(0) } }
@keyframes mv-tilt { to { transform: translateY(22px) } }
@keyframes mv-tr-fg { to { transform: translateX(-46px) } }
@keyframes mv-tr-mid { to { transform: translateX(-22px) } }
@keyframes mv-tr-bg { to { transform: translateX(-8px) } }
@keyframes mv-up-fg { to { transform: translateY(34px) } }
@keyframes mv-up-mid { to { transform: translateY(18px) } }
@keyframes mv-up-bg { to { transform: translateY(6px) } }
@keyframes mv-orb-fg { from { transform: translateX(42px) } to { transform: translateX(-42px) } }
@keyframes mv-orb-bg { from { transform: translateX(-26px) } to { transform: translateX(26px) } }
@keyframes mv-track-fg { to { transform: translateX(-120px) } }
@keyframes mv-track-bg { to { transform: translateX(-40px) } }
@keyframes mv-bob { to { transform: translateY(-2px) } }
@keyframes mv-shake { 0% { transform: translate(0, 0) rotate(0) } 25% { transform: translate(1.5px, -1px) rotate(.6deg) } 50% { transform: translate(-1px, 1.5px) rotate(-.5deg) } 75% { transform: translate(1px, 1px) rotate(.3deg) } 100% { transform: translate(0, 0) rotate(0) } }
@keyframes mv-float { 0% { transform: translate(0, 0) scale(1) } 50% { transform: translate(-4px, -2px) scale(1.06) } 100% { transform: translate(4px, 1px) scale(1.12) } }
@keyframes mv-sway { from { transform: rotate(-7deg) } to { transform: rotate(7deg) } }
@keyframes mv-pov { 0% { transform: scale(1) translateY(0) } 25% { transform: scale(1.04) translateY(-2px) } 50% { transform: scale(1.08) translateY(1px) } 75% { transform: scale(1.12) translateY(-2px) } 100% { transform: scale(1.16) translateY(0) } }
@keyframes mv-dive { from { transform: scale(1) rotate(0) translateY(-10px) } to { transform: scale(1.9) rotate(9deg) translateY(10px) } }
@keyframes mv-high { from, to { transform: scale(.8) } }
@keyframes mv-pull { from { transform: scale(1.9) translateY(8px) } to { transform: scale(1) translateY(0) } }
@keyframes mv-heli { from { transform: translateX(14px) rotate(-1deg) scale(1.05) } to { transform: translateX(-14px) rotate(1deg) scale(1.05) } }
@keyframes mv-robot { 0% { transform: scale(1) translateX(0) rotate(0) } 60%, 100% { transform: scale(1.3) translateX(-16px) rotate(-3deg) } }
@keyframes mv-blur-out { from { filter: blur(0) } to { filter: blur(2.5px) } }
@keyframes mv-blur-in { from { filter: blur(2.5px) } to { filter: blur(0) } }
@media (prefers-reduced-motion: reduce) { .mv-scene * { animation: none !important } }
`

// a plane turns and grows around the subject, at the frame's middle
const plane = (animation?: string): CSSProperties => ({ animation, transformBox: "view-box", transformOrigin: "80px 52px" })

export function MovePreview({ move }: { move: string }) {
  const m = MOVES[move] ?? {}
  return (
    <svg viewBox="0 0 160 90" className="mv-scene block aspect-video w-full bg-muted" role="img" aria-label={`${move}, as an animation`}>
      <style>{KEYFRAMES}</style>
      <g key={move} style={plane(m.all)}>
        <g style={plane(m.bg)}>
          <circle cx="128" cy="18" r="8" className="fill-muted-foreground/25" />
          <path d="M-90 62 Q-50 40 -10 58 T70 52 T150 56 T230 50 V150 H-90Z" className="fill-muted-foreground/20" />
          <rect x="96" y="40" width="22" height="16" className="fill-muted-foreground/40" />
          <path d="M93 41 L107 30 L121 41Z" className="fill-muted-foreground/40" />
          <rect x="-100" y="64" width="360" height="90" className="fill-muted-foreground/15" />
        </g>
        <g style={plane(m.mid)}>
          <ellipse cx="80" cy="68" rx="10" ry="2" className="fill-foreground/15" />
          <circle cx="80" cy="42" r="5" className="fill-space" />
          <rect x="73" y="48" width="14" height="19" rx="6" className="fill-space" />
        </g>
        <g style={plane(m.fg)}>
          <rect x="16" y="30" width="7" height="80" rx="2" className="fill-foreground/45" />
          <circle cx="19.5" cy="26" r="15" className="fill-foreground/35" />
          <path d="M120 90 l6 -16 l4 16 M134 90 l4 -12 l3 12" className="fill-none stroke-foreground/40" strokeWidth="2" />
        </g>
      </g>
    </svg>
  )
}
