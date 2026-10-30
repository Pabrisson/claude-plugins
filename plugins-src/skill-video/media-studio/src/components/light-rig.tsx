import { useId, useRef } from "react"
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, PlusIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { opt, type Field, type Light } from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, Chips, Label } from "@/components/chips"

// the lights a relight field places around the subject (Higgsfield's relight): a stage to drag them on, six quick
// directions, their softness, brightness and color. The field's value stays words, so the CLI's --field light="…" and
// a remix keep working; the stage's own state rides along in fields["<key>:rig"]
type Mode = "preset" | "custom" | "describe"
type Rig = { mode: Mode; lights: Light[]; active: number }

const QUICK = [
  { label: "Top", az: 0, el: 80 },
  { label: "Front", az: 0, el: 0 },
  { label: "Right", az: 90, el: 0 },
  { label: "Left", az: -90, el: 0 },
  { label: "Back", az: 180, el: 0 },
  { label: "Bottom", az: 0, el: -80 },
]
const SWATCHES = [
  { color: "#ff9329", label: "Candle" },
  { color: "#ffc58f", label: "Tungsten" },
  { color: "#ffffff", label: "Daylight" },
  { color: "#c9e2ff", label: "Sky" },
  { color: "#ff3fb4", label: "Magenta" },
  { color: "#2fd6ff", label: "Cyan" },
]
const LIGHT: Light = { az: -90, el: 0, color: "#ffffff", brightness: 50, diffuse: 75 }
// the lights added after the first: a cool fill, then a rim from behind
const MORE: Light[] = [
  { az: -45, el: 15, color: "#c9e2ff", brightness: 40, diffuse: 70 },
  { az: 160, el: 30, color: "#ffffff", brightness: 60, diffuse: 35 },
]

const rad = Math.PI / 180
const wrap = (az: number) => ((((az + 180) % 360) + 360) % 360) - 180
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

// where a light sits in words: eight sides around, then above, below or level
function direction(az: number, el: number) {
  if (el > 65) return "directly above"
  if (el < -65) return "directly below"
  const side = ["the front", "the front-right", "the right", "behind on the right", "behind", "behind on the left", "the left", "the front-left"][Math.round((((az % 360) + 360) % 360) / 45) % 8]
  return `${side}${el > 20 ? " and above" : el < -20 ? " and below" : ", at eye level"}`
}

// a color in words a model reads, with its hex: white, warm white, orange (#ffb15c)…
function colorWords(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d + 6) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  if (s < 0.12 || (l > 0.92 && s < 0.5)) return l > 0.92 && s >= 0.12 ? `${h < 90 ? "warm" : "cool"} white` : "white"
  const name = [[15, "red"], [40, "orange"], [52, "amber"], [70, "yellow"], [160, "green"], [195, "cyan"], [250, "blue"], [285, "violet"], [330, "magenta"], [361, "red"]].find(([to]) => h < (to as number))![1]
  return `${l > 0.75 ? "pale " : l < 0.3 ? "deep " : ""}${name} (${hex})`
}

// several lights: their number, then each one
const lightsWords = (lights: Light[], video: boolean) =>
  lights.length > 1 ? `${["", "", "two", "three", "four"][lights.length]} lights: ${lights.map((l) => words(l, video)).join("; ")}` : words(lights[0], video)

function words(l: Light, video: boolean) {
  // a video's diffusion in three steps; an image's soft or hard, as its chips say
  const soft = video ? (l.diffuse >= 60 ? "soft" : l.diffuse >= 35 ? "medium-soft" : "hard") : l.diffuse >= 50 ? "soft" : "hard"
  return `a ${soft} ${colorWords(l.color)} light coming from ${direction(l.az, l.el)}, at ${l.brightness}% brightness${video ? `, ${l.diffuse}% diffusion` : ""}`
}

// a light on the screen: the camera a little above the subject, so the lights in front sink and the top leans back
const PITCH = 18 * rad
function project(az: number, el: number, c: number, r: number) {
  const x = Math.sin(az * rad) * Math.cos(el * rad), y = Math.sin(el * rad), z = Math.cos(az * rad) * Math.cos(el * rad)
  return { x: c + x * r, y: c - (y * Math.cos(PITCH) - z * Math.sin(PITCH)) * r, depth: z * Math.cos(PITCH) + y * Math.sin(PITCH) }
}

// the stage: a wire globe, a bust in its middle lit by each light, the lights themselves (dimmer behind the bust)
function Stage({ lights, active }: { lights: Light[]; active?: number }) {
  const id = useId(), C = 120, R = 92
  const pts = lights.map((l, i) => ({ l, i, ...project(l.az, l.el, C, R) }))
  const bust = (fill: string, key?: number) => (
    <g key={key} fill={fill}>
      <circle cx={C} cy={C - 16} r={23} />
      <path d={`M${C - 46},${C + 48} Q${C - 42},${C + 14} ${C},${C + 12} Q${C + 42},${C + 14} ${C + 46},${C + 48} Z`} />
    </g>
  )
  const dot = (p: (typeof pts)[number]) => (
    <g key={`d${p.i}`} opacity={p.depth < 0 ? 0.5 : 1}>
      {p.i === active && <circle cx={p.x} cy={p.y} r={14} fill="none" stroke="currentColor" strokeOpacity={0.9} strokeWidth={2} />}
      <circle cx={p.x} cy={p.y} r={9} fill={p.l.color} stroke="black" strokeOpacity={0.35} />
    </g>
  )
  return (
    <svg viewBox="0 0 240 240" className="size-full" aria-hidden>
      <defs>
        {pts.map((p) => (
          <radialGradient key={p.i} id={`${id}g${p.i}`} gradientUnits="userSpaceOnUse" cx={C + (p.x - C) * 0.5} cy={C + (p.y - C) * 0.5} r={38 + p.l.diffuse * 0.55}>
            <stop offset="0" stopColor={p.l.color} stopOpacity={(0.25 + p.l.brightness / 140) * (p.depth < 0 ? 0.6 : 1)} />
            <stop offset="1" stopColor={p.l.color} stopOpacity={0} />
          </radialGradient>
        ))}
        {pts.map((p) => (
          <linearGradient key={`b${p.i}`} id={`${id}b${p.i}`} gradientUnits="userSpaceOnUse" x1={p.x} y1={p.y} x2={C} y2={C}>
            <stop offset="0" stopColor={p.l.color} stopOpacity={0.55 * (0.4 + p.l.brightness / 170)} />
            <stop offset="1" stopColor={p.l.color} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      <g fill="none" stroke="currentColor" strokeOpacity={0.14}>
        <circle cx={C} cy={C} r={R} />
        <ellipse cx={C} cy={C} rx={R} ry={R * Math.sin(PITCH)} />
        {[-45, 45].map((lat) => (
          <ellipse key={lat} cx={C} cy={C - Math.sin(lat * rad) * Math.cos(PITCH) * R} rx={R * Math.cos(lat * rad)} ry={R * Math.cos(lat * rad) * Math.sin(PITCH)} strokeDasharray="3 4" />
        ))}
      </g>
      {pts.filter((p) => p.depth < 0).map(dot)}
      {bust("currentColor")}
      <g opacity={0.82}>{bust("black")}</g>
      {pts.map((p) => bust(`url(#${id}g${p.i})`, p.i))}
      {pts
        .filter((p) => p.depth >= 0)
        .map((p) => {
          const a = Math.atan2(C - p.y, C - p.x), w = 7 + p.l.diffuse * 0.16
          const side = (k: number) => `${C + Math.cos(a + (k * Math.PI) / 2) * w * 2.4},${C + Math.sin(a + (k * Math.PI) / 2) * w * 2.4}`
          return <polygon key={`beam${p.i}`} points={`${p.x},${p.y} ${side(1)} ${side(-1)}`} fill={`url(#${id}b${p.i})`} />
        })}
      {pts.filter((p) => p.depth >= 0).map(dot)}
    </svg>
  )
}

function readRig(field: Field, fields: Record<string, string>): Rig {
  try {
    const r = JSON.parse(fields[`${field.key}:rig`] ?? "")
    if (r?.lights?.length) return r
  } catch {
    /* no stage saved: from the value below */
  }
  const value = fields[field.key] ?? String(field.default ?? "")
  const preset = field.options?.map(opt).find((o) => o.value === value)
  if (preset?.rig) return { mode: "preset", lights: preset.rig, active: 0 }
  return { mode: field.options?.length && value !== field.default ? "describe" : "custom", lights: [LIGHT], active: 0 }
}

// the field: Preset, Custom (the stage) or Describe when it has presets (a video's); the stage alone otherwise. Up to
// field.lights lights, each added and removed by its chip; a video's say their diffusion, an image's soft or hard
export function LightRig({ field, fields, video, onChange }: { field: Field; fields: Record<string, string>; video: boolean; onChange: (patch: Record<string, string>) => void }) {
  const rig = readRig(field, fields)
  const max = field.lights ?? 1, presets = (field.options ?? []).map(opt)
  const value = fields[field.key] ?? String(field.default ?? "")
  const light = rig.lights[Math.min(rig.active, rig.lights.length - 1)]
  const save = (next: Rig, text?: string) =>
    onChange({
      [field.key]: text ?? (next.mode === "custom" ? lightsWords(next.lights, video) : value),
      [`${field.key}:rig`]: JSON.stringify(next),
    })
  const put = (patch: Partial<Light>) => save({ ...rig, mode: "custom", lights: rig.lights.map((l, i) => (i === rig.active ? { ...l, ...patch } : l)) })

  // a drag anywhere on the stage turns the light around the subject; a press near another light picks it first
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; az: number; el: number; i: number } | null>(null)
  function down(e: React.PointerEvent) {
    const r = stage.current!.getBoundingClientRect(), k = 240 / r.width
    const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k
    const near = rig.lights.map((l, i) => ({ i, d: Math.hypot(project(l.az, l.el, 120, 92).x - px, project(l.az, l.el, 120, 92).y - py) })).sort((a, b) => a.d - b.d)[0]
    const i = near && near.d < 22 ? near.i : rig.active
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, az: rig.lights[i].az, el: rig.lights[i].el, i }
    if (i !== rig.active) save({ ...rig, active: i })
  }
  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const k = 240 / stage.current!.getBoundingClientRect().width
    const next = { az: Math.round(wrap(d.az + (e.clientX - d.x) * k * 1.1)), el: Math.round(clamp(d.el - (e.clientY - d.y) * k * 1.1, -89, 89)) }
    save({ ...rig, mode: "custom", active: d.i, lights: rig.lights.map((l, i) => (i === d.i ? { ...l, ...next } : l)) })
  }
  const nudge = (daz: number, del: number) => put({ az: wrap(light.az + daz), el: clamp(light.el + del, -89, 89) })

  return (
    <div className="flex flex-col gap-4">
      {presets.length > 0 && (
        <Chips
          className="grid grid-cols-3 [&>button]:px-1"
          options={["preset", "custom", "describe"] as const}
          value={rig.mode}
          label={(m) => ({ preset: "Preset", custom: "Custom", describe: "Describe" })[m]}
          onChange={(mode) => save({ ...rig, mode }, mode === "preset" ? (presets.find((p) => p.value === value)?.value ?? presets[0].value) : mode === "describe" ? value : undefined)}
        />
      )}

      {rig.mode === "preset" && (
        <div className="grid grid-cols-3 gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={p.value === value}
              title={p.value}
              onClick={() => save({ ...rig, lights: p.rig ?? rig.lights, active: 0 }, p.value)}
              className={cn("flex flex-col overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50", p.value === value ? "border-space ring-1 ring-space" : "hover:border-foreground/30")}
            >
              <span className="aspect-square bg-black/85 text-white">{p.rig && <Stage lights={p.rig} />}</span>
              <span className={cn("truncate px-2 py-1.5 text-xs", p.value === value ? "font-medium text-space" : "text-muted-foreground")}>{p.label}</span>
            </button>
          ))}
        </div>
      )}

      {rig.mode === "describe" && (
        <div>
          <Label>Describe the light</Label>
          <Textarea value={value} placeholder={`Where each light is, its color, brightness and softness (up to ${max})`} onChange={(e) => onChange({ [field.key]: e.target.value, [`${field.key}:rig`]: JSON.stringify(rig) })} className="min-h-24" />
        </div>
      )}

      {rig.mode === "custom" && (
        <>
          <div>
            <Label>Quick select</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {QUICK.map((q) => (
                <button key={q.label} type="button" aria-pressed={light.az === q.az && light.el === q.el} onClick={() => put({ az: q.az, el: q.el })} className={cn(CHIP, "rounded-md", light.az === q.az && light.el === q.el ? CHIP_ON : CHIP_OFF)}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative overflow-hidden rounded-xl bg-black/85 text-white">
            <div
              ref={stage}
              role="application"
              tabIndex={0}
              aria-label={`Light${rig.lights.length > 1 ? ` ${rig.active + 1}` : ""}: from ${direction(light.az, light.el)}. Drag, or use the arrow keys, to move it around the subject`}
              className="mx-auto aspect-square w-full max-w-72 cursor-grab touch-none outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 45 : 15, by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
                if (!by) return
                e.preventDefault()
                nudge(by[0], by[1])
              }}
            >
              <Stage lights={rig.lights} active={rig.lights.length > 1 ? rig.active : undefined} />
            </div>
            <span className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs text-white/60">Drag to move the light</span>
            {(
              [
                [ChevronLeftIcon, "Turn the light left", -15, 0, "left-1 top-1/2 -translate-y-1/2"],
                [ChevronRightIcon, "Turn the light right", 15, 0, "right-1 top-1/2 -translate-y-1/2"],
                [ChevronUpIcon, "Raise the light", 0, 15, "top-6 left-1/2 -translate-x-1/2"],
                [ChevronDownIcon, "Lower the light", 0, -15, "bottom-1 left-1/2 -translate-x-1/2"],
              ] as const
            ).map(([Icon, label, daz, del, at]) => (
              <button key={label} type="button" aria-label={label} title={label} onClick={() => nudge(daz, del)} className={cn("absolute grid size-8 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white", at)}>
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <p className="-mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
            From {direction(light.az, light.el)}
          </p>

          {max > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {rig.lights.map((_, i) => (
                <span key={i} className={cn(CHIP, "flex items-center gap-1 py-0.5 pr-1", i === rig.active ? CHIP_ON : CHIP_OFF)}>
                  <button type="button" aria-pressed={i === rig.active} onClick={() => save({ ...rig, active: i })} className="px-1">
                    Light {i + 1}
                  </button>
                  {i > 0 && (
                    <button type="button" aria-label={`Remove light ${i + 1}`} onClick={() => save({ ...rig, mode: "custom", active: 0, lights: rig.lights.filter((__, j) => j !== i) })} className="grid size-5 place-items-center rounded-full hover:bg-space/20">
                      <XIcon className="size-3" />
                    </button>
                  )}
                </span>
              ))}
              {rig.lights.length < max && (
                <button type="button" onClick={() => save({ ...rig, mode: "custom", lights: [...rig.lights, MORE[(rig.lights.length - 1) % MORE.length]], active: rig.lights.length })} className={cn(CHIP, CHIP_OFF, "flex items-center gap-1 border-dashed")}>
                  <PlusIcon className="size-3.5" /> Add a light
                </button>
              )}
            </div>
          )}

          {video ? (
            <Level label="Diffuse" value={light.diffuse} onChange={(diffuse) => put({ diffuse })} />
          ) : (
            <div>
              <Label>Light</Label>
              <Chips className="grid grid-cols-2" options={["soft", "hard"] as const} value={light.diffuse >= 50 ? "soft" : "hard"} label={(s) => (s === "soft" ? "Soft" : "Hard")} onChange={(s) => put({ diffuse: s === "soft" ? 75 : 20 })} />
            </div>
          )}
          <Level label="Brightness" value={light.brightness} onChange={(brightness) => put({ brightness })} />
          <div>
            <Label hint={colorWords(light.color).replace(/ \(.*/, "")}>Color</Label>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((s) => (
                <button
                  key={s.color}
                  type="button"
                  aria-label={s.label}
                  title={s.label}
                  aria-pressed={light.color === s.color}
                  onClick={() => put({ color: s.color })}
                  className={cn("size-7 rounded-full ring-1 ring-foreground/20 transition-transform outline-none hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50", light.color === s.color && "ring-2 ring-space ring-offset-2 ring-offset-background")}
                  style={{ background: s.color }}
                />
              ))}
              <label className="relative ml-auto flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm text-muted-foreground tabular-nums hover:bg-muted">
                <span className="size-4 rounded-full ring-1 ring-foreground/20" style={{ background: light.color }} />
                {light.color}
                <input type="color" value={light.color} onChange={(e) => put({ color: e.target.value })} aria-label="Pick any color" className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Level({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Slider min={0} max={100} step={5} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={label} />
        <span className="w-10 text-right text-sm tabular-nums">{value}%</span>
      </div>
    </div>
  )
}
