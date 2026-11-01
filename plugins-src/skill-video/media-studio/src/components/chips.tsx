import {
  ArrowDownToDotIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowRightToLineIcon,
  AudioLinesIcon,
  AudioWaveformIcon,
  BetweenHorizontalStartIcon,
  BlendIcon,
  BombIcon,
  BoxIcon,
  BrushIcon,
  CameraIcon,
  CaptionsIcon,
  CircleIcon,
  ClapperboardIcon,
  Clock3Icon,
  Clock6Icon,
  CombineIcon,
  ContrastIcon,
  CropIcon,
  CrosshairIcon,
  Disc3Icon,
  DropletIcon,
  DropletsIcon,
  EarthIcon,
  EqualIcon,
  EraserIcon,
  ExpandIcon,
  FastForwardIcon,
  FileAudioIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  FlameIcon,
  FolderOpenIcon,
  GaugeIcon,
  GemIcon,
  GuitarIcon,
  HandIcon,
  ImageIcon,
  InfinityIcon,
  LanguagesIcon,
  LaptopIcon,
  LayersIcon,
  LayoutGridIcon,
  LockIcon,
  MapPinIcon,
  MaximizeIcon,
  MessageCircleIcon,
  MicIcon,
  MicVocalIcon,
  MonitorIcon,
  MoonIcon,
  MusicIcon,
  NetworkIcon,
  PackageIcon,
  PaintbrushIcon,
  PaletteIcon,
  PauseIcon,
  PenLineIcon,
  PersonStandingIcon,
  PianoIcon,
  PlaneIcon,
  PlayIcon,
  RabbitIcon,
  RectangleHorizontalIcon,
  RectangleVerticalIcon,
  RepeatIcon,
  ReplaceIcon,
  Rotate3dIcon,
  RotateCcwIcon,
  RotateCwIcon,
  RouteIcon,
  ScalingIcon,
  ScanFaceIcon,
  ScissorsIcon,
  ShapesIcon,
  ShirtIcon,
  SignalHighIcon,
  SignalIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SnailIcon,
  SnowflakeIcon,
  SparklesIcon,
  SpeechIcon,
  SplitIcon,
  SquareDashedIcon,
  SquareIcon,
  StarIcon,
  SunDimIcon,
  SunIcon,
  SunMediumIcon,
  ThermometerSnowflakeIcon,
  ThermometerSunIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  TornadoIcon,
  TurtleIcon,
  TypeIcon,
  UserIcon,
  UserRoundPlusIcon,
  UsersIcon,
  VideoIcon,
  Volume2Icon,
  VolumeXIcon,
  WandIcon,
  WandSparklesIcon,
  WavesIcon,
  WindIcon,
  ZapIcon,
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
  speech: SpeechIcon,
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
  music: MusicIcon,
  "volume-2": Volume2Icon,
  "arrow-right-to-line": ArrowRightToLineIcon,
  "disc-3": Disc3Icon,
  "mic-vocal": MicVocalIcon,
  guitar: GuitarIcon,
  combine: CombineIcon,
  "audio-waveform": AudioWaveformIcon,
  "file-audio": FileAudioIcon,
  captions: CaptionsIcon,
  piano: PianoIcon,
  "user-round-plus": UserRoundPlusIcon,
  "file-text": FileTextIcon,
  "pen-line": PenLineIcon,
  "volume-x": VolumeXIcon,
  split: SplitIcon,
  "arrow-down-to-dot": ArrowDownToDotIcon,
  "arrow-left": ArrowLeftIcon,
  "arrow-right": ArrowRightIcon,
  blend: BlendIcon,
  circle: CircleIcon,
  "clock-3": Clock3Icon,
  "clock-6": Clock6Icon,
  contrast: ContrastIcon,
  crosshair: CrosshairIcon,
  droplet: DropletIcon,
  droplets: DropletsIcon,
  equal: EqualIcon,
  infinity: InfinityIcon,
  lock: LockIcon,
  moon: MoonIcon,
  pause: PauseIcon,
  rabbit: RabbitIcon,
  "rectangle-horizontal": RectangleHorizontalIcon,
  "rectangle-vertical": RectangleVerticalIcon,
  "rotate-ccw": RotateCcwIcon,
  "rotate-cw": RotateCwIcon,
  scaling: ScalingIcon,
  snail: SnailIcon,
  "square-dashed": SquareDashedIcon,
  "sun-dim": SunDimIcon,
  "thermometer-snowflake": ThermometerSnowflakeIcon,
  "thermometer-sun": ThermometerSunIcon,
  tornado: TornadoIcon,
  turtle: TurtleIcon,
  video: VideoIcon,
  "wand-sparkles": WandSparklesIcon,
  waves: WavesIcon,
  zap: ZapIcon,
}
export function ToolIcon({ name, className }: { name: string; className?: string }) {
  return createElement(ICONS[name] ?? SparklesIcon, { className })
}

// a value's icon by what it is: a ratio by its shape, a resolution, a file format, a level, a medium, a provider, on/off…
// ponytail: keyword heuristic, a bare 3–4 digit number reads as a resolution and an unknown word gets no icon; give the
// option an "icon" in its catalog when one matters
const FORMATS = (list: string, icon: LucideIcon) => Object.fromEntries(list.split(" ").map((f) => [f, icon]))
// a provider's icon, the same wherever it is named: its chips, the header's balances, Settings, Credits
const PROVIDER_ICONS: Record<string, LucideIcon> = { kie: RouteIcon, openrouter: NetworkIcon, elevenlabs: AudioWaveformIcon, local: LaptopIcon }
export function ProviderIcon({ id, className }: { id: string; className?: string }) {
  return PROVIDER_ICONS[id] ? createElement(PROVIDER_ICONS[id], { className, "aria-hidden": true }) : null
}
const NAMED: Record<string, LucideIcon> = {
  all: LayoutGridIcon, favorites: StarIcon, image: ImageIcon, video: VideoIcon, audio: AudioLinesIcon, other: ShapesIcon,
  voice: MicIcon, music: MusicIcon, sound: Volume2Icon, import: FolderOpenIcon,
  ...PROVIDER_ICONS,
  "": WandSparklesIcon, auto: WandSparklesIcon, same: EqualIcon, on: ToggleRightIcon, true: ToggleRightIcon, off: ToggleLeftIcon, false: ToggleLeftIcon,
  low: SignalLowIcon, medium: SignalMediumIcon, high: SignalHighIcon, xhigh: SignalIcon, max: SignalIcon,
  ...FORMATS("png jpg jpeg webp gif avif heic", FileImageIcon), ...FORMATS("mp4 mov webm mkv", FileVideoIcon), ...FORMATS("mp3 wav flac ogg m4a aac opus pcm", FileAudioIcon),
}
export function valueIcon(v: string | number, className?: string) {
  const s = String(v).toLowerCase(), r = s.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  const icon = r ? (+r[1] > +r[2] ? RectangleHorizontalIcon : +r[1] < +r[2] ? RectangleVerticalIcon : SquareIcon) : /^≤?\d{3,4}p?$|^\d+(\.\d+)?k$/.test(s) ? MonitorIcon : Object.hasOwn(NAMED, s) ? NAMED[s] : null
  return icon ? createElement(icon, { className }) : null
}

// a chip, and a chosen one: tinted with the space's color, not a white block that outshines the prompt
export const CHIP = "rounded-full border px-3 py-1 text-sm transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
export const CHIP_ON = "border-space/50 bg-space/15 font-medium text-space"
export const CHIP_OFF = "border-border text-muted-foreground hover:bg-muted hover:text-foreground"

// a chip's icon before its label, sized for it
const WITH_ICON = "inline-flex items-center justify-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0"

// single-choice chips: the dashboard's control for every list of values, each with its icon
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label = (v) => String(v),
  icon,
  className,
}: {
  options: readonly T[]
  value: T | undefined
  onChange: (v: T) => void
  label?: (v: T) => string
  icon?: (v: T) => React.ReactNode
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
          className={cn(CHIP, WITH_ICON, o === value ? CHIP_ON : CHIP_OFF)}
        >
          {icon?.(o)}
          <span className="min-w-0 truncate">{label(o)}</span>
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
  icon,
}: {
  options: readonly T[]
  value: T[]
  onChange: (v: T[]) => void
  label?: (v: T) => string
  icon?: (v: T) => React.ReactNode
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
            className={cn(CHIP, WITH_ICON, on ? CHIP_ON : CHIP_OFF)}
          >
            {icon?.(o)}
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
// stacked: the title, then its hint on a line of its own (a model's options, whose hints are long)
export function Label({ children, hint, stacked }: { children: React.ReactNode; hint?: React.ReactNode; stacked?: boolean }) {
  if (stacked)
    return (
      <div className="mb-2 text-xs text-muted-foreground">
        <span className="block font-semibold tracking-wider text-foreground/70 uppercase">{children}</span>
        {hint && <span className="mt-0.5 block">{hint}</span>}
      </div>
    )
  return (
    <div className="mb-2 flex items-baseline gap-1.5 text-xs text-muted-foreground">
      <span className="font-semibold tracking-wider text-foreground/70 uppercase">{children}</span>
      {hint && <span className="truncate">· {hint}</span>}
    </div>
  )
}
