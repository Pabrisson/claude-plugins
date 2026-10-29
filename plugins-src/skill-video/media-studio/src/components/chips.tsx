import {
  AudioLinesIcon,
  BetweenHorizontalStartIcon,
  BombIcon,
  BrushIcon,
  CameraIcon,
  CropIcon,
  EarthIcon,
  EraserIcon,
  ExpandIcon,
  FastForwardIcon,
  FlameIcon,
  GemIcon,
  HandIcon,
  LanguagesIcon,
  MaximizeIcon,
  MessageCircleIcon,
  PackageIcon,
  PaletteIcon,
  PlaneIcon,
  PlayIcon,
  RepeatIcon,
  ReplaceIcon,
  Rotate3dIcon,
  ScanFaceIcon,
  ScissorsIcon,
  SnowflakeIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
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
  brush: BrushIcon,
  camera: CameraIcon,
  crop: CropIcon,
  earth: EarthIcon,
  eraser: EraserIcon,
  expand: ExpandIcon,
  "fast-forward": FastForwardIcon,
  flame: FlameIcon,
  gem: GemIcon,
  hand: HandIcon,
  languages: LanguagesIcon,
  maximize: MaximizeIcon,
  "message-circle": MessageCircleIcon,
  package: PackageIcon,
  palette: PaletteIcon,
  plane: PlaneIcon,
  play: PlayIcon,
  repeat: RepeatIcon,
  replace: ReplaceIcon,
  "rotate-3d": Rotate3dIcon,
  "scan-face": ScanFaceIcon,
  scissors: ScissorsIcon,
  snowflake: SnowflakeIcon,
  sparkles: SparklesIcon,
  square: SquareIcon,
  sun: SunIcon,
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
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            o === value
              ? "border-foreground bg-foreground text-background"
              : "border-border hover:bg-muted"
          )}
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
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
            )}
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

export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-xs text-muted-foreground">
      {children}
      {hint && <span className="ml-1 opacity-80">· {hint}</span>}
    </div>
  )
}
