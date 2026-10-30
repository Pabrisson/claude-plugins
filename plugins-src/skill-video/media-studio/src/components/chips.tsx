import {
  AudioLinesIcon,
  BetweenHorizontalStartIcon,
  BombIcon,
  BoxIcon,
  BrushIcon,
  CameraIcon,
  ClapperboardIcon,
  CropIcon,
  EarthIcon,
  EraserIcon,
  ExpandIcon,
  FastForwardIcon,
  FlameIcon,
  GaugeIcon,
  GemIcon,
  HandIcon,
  LayersIcon,
  LanguagesIcon,
  MapPinIcon,
  MaximizeIcon,
  MessageCircleIcon,
  PackageIcon,
  PaintbrushIcon,
  PaletteIcon,
  PersonStandingIcon,
  PlaneIcon,
  PlayIcon,
  RepeatIcon,
  ReplaceIcon,
  Rotate3dIcon,
  ScanFaceIcon,
  ScissorsIcon,
  ShirtIcon,
  SnowflakeIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  SunMediumIcon,
  TypeIcon,
  UserIcon,
  UsersIcon,
  WandIcon,
  WindIcon,
  ZoomInIcon,
  type LucideIcon,
} from "lucide-react"
import { createElement } from "react"
import { cn } from "cn"

// the catalog's icon names (tools/*.json), drawn with lucide
const ICONS: Record<string, LucideIcon> = {
  "audio-lines": AudioLinesIcon,
  "between-horizontal-start": BetweenHorizontalStartIcon,
  bomb: BombIcon,
  box: BoxIcon,
  brush: BrushIcon,
  camera: CameraIcon,
  clapperboard: ClapperboardIcon,
  crop: CropIcon,
  earth: EarthIcon,
  eraser: EraserIcon,
  expand: ExpandIcon,
  "fast-forward": FastForwardIcon,
  flame: FlameIcon,
  gauge: GaugeIcon,
  gem: GemIcon,
  hand: HandIcon,
  languages: LanguagesIcon,
  layers: LayersIcon,
  "map-pin": MapPinIcon,
  maximize: MaximizeIcon,
  "message-circle": MessageCircleIcon,
  package: PackageIcon,
  paintbrush: PaintbrushIcon,
  palette: PaletteIcon,
  "person-standing": PersonStandingIcon,
  plane: PlaneIcon,
  play: PlayIcon,
  repeat: RepeatIcon,
  replace: ReplaceIcon,
  "rotate-3d": Rotate3dIcon,
  "scan-face": ScanFaceIcon,
  scissors: ScissorsIcon,
  shirt: ShirtIcon,
  snowflake: SnowflakeIcon,
  sparkles: SparklesIcon,
  square: SquareIcon,
  sun: SunIcon,
  "sun-medium": SunMediumIcon,
  type: TypeIcon,
  user: UserIcon,
  users: UsersIcon,
  wand: WandIcon,
  wind: WindIcon,
  "zoom-in": ZoomInIcon,
}
export function ToolIcon({ name, className }: { name: string; className?: string }) {
  return createElement(ICONS[name] ?? SparklesIcon, { className })
}

// a chip, and a chosen one: tinted with the space's color, not a white block that outshines the prompt
export const CHIP = "rounded-full border px-3 py-1 text-sm transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
export const CHIP_ON = "border-space/50 bg-space/15 font-medium text-space"
export const CHIP_OFF = "border-border text-muted-foreground hover:bg-muted hover:text-foreground"

// single-choice chips: the dashboard's control for every list of values
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label = (v) => String(v),
  className,
}: {
  options: readonly T[]
  value: T | undefined
  onChange: (v: T) => void
  label?: (v: T) => string
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn(CHIP, o === value ? CHIP_ON : CHIP_OFF)}
        >
          {label(o)}
        </button>
      ))}
    </div>
  )
}

// several choices at once, same look
export function MultiChips<T extends string>({
  options,
  value,
  onChange,
  label = (v) => v,
}: {
  options: readonly T[]
  value: T[]
  onChange: (v: T[]) => void
  label?: (v: T) => string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
          >
            {label(o)}
          </button>
        )
      })}
    </div>
  )
}

// a price: amber, the one color the dashboard keeps for money
export function Price({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-md bg-cost/12 px-1.5 py-0.5 text-[13px] font-semibold whitespace-nowrap text-cost tabular-nums", className)}>
      {children}
    </span>
  )
}

// a section's title: small capitals, its hint in plain words beside it
export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-1.5 text-xs text-muted-foreground">
      <span className="font-semibold tracking-wider text-foreground/70 uppercase">{children}</span>
      {hint && <span className="truncate">· {hint}</span>}
    </div>
  )
}
