import { Fragment, useEffect, useRef, useState, type RefObject } from "react"
import {
  AudioWaveformIcon,
  CheckIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  FilmIcon,
  ClockIcon,
  MessageSquareTextIcon,
  MicIcon,
  MusicIcon,
  PencilIcon,
  TextQuoteIcon,
  RefreshCwIcon,
  RepeatIcon,
  ScissorsIcon,
  SparkleIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { follow, useStoredSize } from "@/components/panel"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { clock, colorOf, minutes, soundColor, soundLabel, visualColor, visualLabel, when, type Comment, type Image, type Kind, type Range, type SoundRef, type VideoItem, type VisualRef } from "@/lib/studio"
import { cn } from "@/lib/utils"

type Filter = "open" | "resolved" | "all"
const KIND = {
  comment: { label: "Comment", icon: MessageSquareTextIcon },
  cut: { label: "Cut", icon: ScissorsIcon },
}

function KindBadge({ type }: { type: Kind }) {
  const { label, icon: Icon } = KIND[type]
  return (
    <Badge variant="outline" className="h-5 rounded-md border-highlight/30 bg-highlight/10 text-highlight">
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  )
}

// a sound or a part picked for a comment, in its timeline color
function PickBadge({ label, color, icon: Icon, onRemove, onClick }: { label: string; color: string; icon: typeof FilmIcon; onRemove?: () => void; onClick?: () => void }) {
  return (
    <Badge
      variant="outline"
      className={cn("h-6 rounded-md font-mono font-normal", onRemove && "pr-0.5", onClick && "cursor-pointer hover:brightness-125")}
      title={onClick ? "Show where it is" : undefined}
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation()
          onClick()
        })
      }
      style={{ borderColor: `color-mix(in oklch, ${color} 45%, transparent)`, background: `color-mix(in oklch, ${color} 14%, transparent)` }}
    >
      <Icon data-icon="inline-start" style={{ color }} />
      {label}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            // not the badge's own click (it points), nor the comment's (it selects)
            e.stopPropagation()
            onRemove()
          }}
        >
          <XIcon />
        </Button>
      )}
    </Badge>
  )
}

// a thumbnail with its ratio, as the prompt gives it to Claude
function Thumb({ img }: { img: Image }) {
  return (
    <span className="relative block">
      <img src={`review/${img.path.split("/").pop()}`} alt="Attached frame" className="size-20 rounded-md object-cover ring-1 ring-foreground/10" />
      {img.ratio && (
        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">{img.ratio}</span>
      )}
    </span>
  )
}

// the badges of what a comment points at: sounds, then parts of the picture
function Picks({ transcript, sounds = [], visuals = [], onRemoveTranscript, onRemoveSound, onRemoveVisual, onPoint }: {
  // the comment was made on a selection of the transcript
  transcript?: boolean
  onRemoveTranscript?: () => void
  sounds?: SoundRef[]
  visuals?: VisualRef[]
  onRemoveSound?: (s: SoundRef) => void
  onRemoveVisual?: (x: VisualRef) => void
  onPoint?: (to: Point) => void
}) {
  if (!transcript && !sounds.length && !visuals.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {transcript && (
        <PickBadge label="Transcript" color={colorOf("transcript")} icon={TextQuoteIcon} onRemove={onRemoveTranscript} onClick={onPoint && (() => onPoint({}))} />
      )}
      {visuals.map((x, i) => (
        <PickBadge
          key={`v${i}`}
          label={visualLabel(x)}
          color={visualColor(x)}
          icon={FilmIcon}
          onRemove={onRemoveVisual && (() => onRemoveVisual(x))}
          onClick={onPoint && (() => onPoint({ visual: x }))}
        />
      ))}
      {sounds.map((s, i) => (
        <PickBadge
          key={`s${i}`}
          label={soundLabel(s)}
          color={soundColor(s)}
          icon={s === "voice" ? MicIcon : s === "music" ? MusicIcon : AudioWaveformIcon}
          onRemove={onRemoveSound && (() => onRemoveSound(s))}
          onClick={onPoint && (() => onPoint({ sound: s }))}
        />
      ))}
    </div>
  )
}

// the title of a version's feedback in the list
function Group({ label, count }: { label: string; count: number }) {
  return (
    <p className="flex items-center px-2.5 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase first:pt-1">
      {label}
      <span className="ml-auto font-normal tracking-normal tabular-nums">{count}</span>
    </p>
  )
}

// what a badge of a comment points at: a sound, a part, or (neither) its time in the transcript
export type Point = { sound?: SoundRef; visual?: VisualRef }

function Item({
  c,
  n,
  flash,
  multiFormat,
  onPoint,
  onSelect,
  onChange,
  onDelete,
}: {
  c: Comment
  // its number in the version (#3)
  n: number
  // pointed at from a mark: it flashes once
  flash?: boolean
  multiFormat: boolean
  // a click on a badge shows what it names in the timelines or the transcript
  onPoint?: (to: Point) => void
  onSelect: () => void
  onChange?: (c: Comment) => void
  onDelete?: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const commit = () => {
    onChange?.({ ...c, text: editing!.trim() })
    setEditing(null)
  }
  const range = c.t1 > c.t0
  return (
    <div
      data-comment={c.id}
      className="group/item flex scroll-mb-2 cursor-pointer gap-2.5 rounded-lg border border-transparent p-2.5 hover:border-border hover:bg-card/50"
      style={flash ? { animation: "flash 2s ease-out" } : undefined}
      onClick={onSelect}
    >
      <div className="flex h-5 items-center" onClick={(e) => e.stopPropagation()}>
        {c.resolved ? (
          <button aria-label="Reopen" className="text-done disabled:cursor-default" disabled={!onChange} onClick={() => onChange?.({ ...c, resolved: false })}>
            <CheckIcon className="size-4" />
          </button>
        ) : (
          <Checkbox aria-label="Resolved" disabled={!onChange} onCheckedChange={() => onChange?.({ ...c, resolved: true })} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">#{n}</span>
          <KindBadge type={c.type} />
          <Badge
            variant="outline"
            className={cn("h-5 rounded-md font-mono", onPoint && "cursor-pointer hover:bg-muted")}
            title={onPoint ? "Show it in the transcript" : undefined}
            onClick={
              onPoint &&
              ((e) => {
                e.stopPropagation()
                onPoint({})
              })
            }
          >
            {range ? `${minutes(c.t0)} → ${minutes(c.t1)}` : minutes(c.t0)}
          </Badge>
          {multiFormat && c.format && <Badge variant="secondary">{c.format}</Badge>}
          {onChange && (
            <div className={cn("ml-auto flex opacity-0 group-hover/item:opacity-100", editing !== null && "opacity-100")} onClick={(e) => e.stopPropagation()}>
              {/* while it is edited, the pencil saves */}
              {editing !== null ? (
                <Button variant="ghost" size="icon-sm" aria-label="Save" onClick={commit}>
                  <CheckIcon />
                </Button>
              ) : (
                <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(c.text)}>
                  <PencilIcon />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={onDelete}>
                <Trash2Icon />
              </Button>
            </div>
          )}
        </div>
        {c.words && <p className="border-l-2 pl-3 text-[13px] text-muted-foreground italic">“{c.words}”</p>}
        {c.fix && (
          <p className="border-l-2 pl-3 text-[13px]">
            <span className="text-muted-foreground line-through">{c.fix.from}</span>
            <span className="px-1.5 text-muted-foreground">→</span>
            {c.fix.to}
          </p>
        )}
        {editing !== null ? (
          <Textarea
            autoFocus
            value={editing}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null)
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                commit()
              }
            }}
          />
        ) : (
          c.text && <p className={cn("text-sm leading-relaxed", c.resolved && "text-muted-foreground line-through")}>{c.text}</p>
        )}
        <Picks
          transcript={c.from === "transcript"}
          sounds={c.sounds}
          visuals={c.visuals}
          onPoint={onPoint}
          // while it is edited, its badges can go
          {...(editing !== null &&
            onChange && {
              onRemoveTranscript: () => onChange({ ...c, from: undefined }),
              onRemoveSound: (s: SoundRef) => onChange({ ...c, sounds: c.sounds?.filter((x) => x !== s) }),
              onRemoveVisual: (x: VisualRef) => onChange({ ...c, visuals: c.visuals?.filter((v) => v !== x) }),
            })}
        />
        {c.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {c.images.map((img) => (
              <a key={img.path} href={`review/${img.path.split("/").pop()}`} target="_blank" onClick={(e) => e.stopPropagation()}>
                <Thumb img={img} />
              </a>
            ))}
          </div>
        )}
        {c.reply && (
          <p className="flex gap-2 text-sm leading-relaxed">
            <SparkleIcon className="mt-0.5 size-3.5 shrink-0 text-done" />
            {c.reply}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {when(c.created)}
          {range && ` · ${(c.t1 - c.t0).toFixed(2)} s`}
        </p>
      </div>
    </div>
  )
}

export function Feedback({
  version,
  newer,
  comments,
  focus,
  onPoint,
  previous,
  multiFormat,
  time,
  range,
  rangeWords,
  images,
  sounds,
  visuals,
  composer,
  onSelect,
  onSave,
  onAdd,
  onRemoveImage,
  onRemoveSound,
  onRemoveVisual,
  onClearRange,
}: {
  version: number
  // this video with a version newer than the one shown, once a render lands
  newer: VideoItem | null
  comments: Comment[]
  // the comments a mark points at (n: the click, so a second one flashes again)
  focus: { ids: string[]; n: number } | null
  onPoint: (c: Comment, to: Point) => void
  previous: { v: number; comments: Comment[] }[]
  multiFormat: boolean
  time: number
  range: Range | null
  rangeWords: string
  images: Image[]
  sounds: SoundRef[]
  visuals: VisualRef[]
  composer: RefObject<HTMLTextAreaElement | null>
  onSelect: (c: Comment) => void
  onSave: (comments: Comment[]) => void
  onAdd: (kind: Kind, text: string) => boolean
  onRemoveImage: (img: Image) => void
  onRemoveSound: (s: SoundRef) => void
  onRemoveVisual: (x: VisualRef) => void
  onClearRange: () => void
}) {
  const [filter, setFilter] = useState<Filter>("open")
  const [kind, setKind] = useState<Kind>("comment")
  const [text, setText] = useState("")
  // the earlier versions' feedback is done with: it shows under Resolved and All, a group per version, newest first
  const old = filter === "open" ? [] : previous
  const before = previous.reduce((n, p) => n + p.comments.length, 0)
  const counts = { open: comments.filter((c) => !c.resolved).length, resolved: comments.filter((c) => c.resolved).length + before, all: comments.length + before }
  // a comment pointed at stays in view, whatever the filter
  const shown = comments.filter((c) => filter === "all" || c.resolved === (filter === "resolved") || focus?.ids.includes(c.id))
  const isRange = !!range && range.t1 > range.t0
  // side by side (md and up): the left edge drags the column wider, the button gives it half the window
  const [width, keepWidth] = useStoredSize("video-editor.feedback-width")
  const aside = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focus) aside.current?.querySelector(`[data-comment="${focus.ids[0]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [focus])
  // a feedback just added: the list goes down to it (its bottom, under Open)
  const count = useRef(comments.length)
  useEffect(() => {
    if (comments.length > count.current) aside.current?.querySelector(`[data-comment="${comments.at(-1)!.id}"]`)?.scrollIntoView({ block: "end", behavior: "smooth" })
    count.current = comments.length
  }, [comments])
  const resize = (e: React.PointerEvent) => {
    const w0 = aside.current?.offsetWidth ?? 400
    // the player keeps at least 30rem
    follow(e, (dx) => keepWidth(Math.max(300, Math.min(window.innerWidth - 480, w0 - dx))))
  }

  return (
    <aside
      ref={aside}
      className={cn(
        "relative flex h-[45%] min-h-0 shrink-0 flex-col border-t md:h-auto md:max-w-[calc(100vw-30rem)] md:border-t-0 md:border-l",
        width ? "md:w-(--feedback-width)" : "md:w-[clamp(19.5rem,27vw,32rem)]"
      )}
      style={width ? ({ "--feedback-width": `${width}px` } as React.CSSProperties) : undefined}
    >
      <div
        className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-highlight md:block"
        onPointerDown={resize}
        onDoubleClick={() => keepWidth(null)}
        title="Drag to resize, double-click to reset"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">Feedback</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="hidden md:inline-flex"
                aria-label={width ? "Reset the width" : "Widen"}
                onClick={() => keepWidth(width ? null : Math.min(window.innerWidth / 2, window.innerWidth - 480))}
              >
                {width ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{width ? "Reset the width" : "Widen"}</TooltipContent>
          </Tooltip>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            {(["open", "resolved", "all"] as const).map((f) => (
              <TabsTrigger key={f} value={f} className="text-xs capitalize">
                {f} <span className="text-muted-foreground tabular-nums">{counts[f]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {newer && (
        <div className="border-b p-2">
          <Alert>
            <RefreshCwIcon />
            <AlertTitle>Version v{newer.versions} is ready</AlertTitle>
            <AlertDescription className="text-xs">
              {newer.rendered && `Rendered ${when(newer.rendered)}. `}Reload to review it: the feedback on v{version} moves under Resolved.
            </AlertDescription>
            <AlertAction>
              <Button size="xs" onClick={() => location.reload()}>
                Reload
              </Button>
            </AlertAction>
          </Alert>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {old.length > 0 && shown.length > 0 && <Group label={`Version ${version} · current`} count={shown.length} />}
          {shown.map((c) => (
            <Item
              key={focus?.ids.includes(c.id) ? `${c.id}-${focus.n}` : c.id}
              c={c}
              n={comments.indexOf(c) + 1}
              flash={focus?.ids.includes(c.id)}
              onPoint={(to) => onPoint(c, to)}
              multiFormat={multiFormat}
              onSelect={() => onSelect(c)}
              onChange={(next) => onSave(comments.map((x) => (x.id === c.id ? next : x)))}
              onDelete={() => onSave(comments.filter((x) => x.id !== c.id))}
            />
          ))}
          {old.map((p) => (
            <Fragment key={p.v}>
              <Group label={`Version ${p.v}`} count={p.comments.length} />
              {p.comments.map((c, i) => (
                <Item key={c.id} c={c} n={i + 1} multiFormat={multiFormat} onSelect={() => {}} />
              ))}
            </Fragment>
          ))}
          {!comments.length && !old.length && (
            <Empty className="px-4 py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareTextIcon />
                </EmptyMedia>
                <EmptyTitle className="text-sm">No feedback on this version (v{version})</EmptyTitle>
                <EmptyDescription className="text-xs">
                  Play the video, press <Kbd>C</Kbd> and write what you want to change.
                  To cut, select a range in the transcript or on the timeline (or mark it with <Kbd>I</Kbd> and <Kbd>O</Kbd>), then press <Kbd>⌫</Kbd>. Drop an image anywhere to attach it.
                  To comment on a part of the picture or of the sound, pick it in the Clip or Sound tab.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {!!comments.length && !shown.length && !old.length && <p className="py-10 text-center text-sm text-muted-foreground">Nothing {filter} on this version.</p>}
        </div>
      </ScrollArea>

      <div className="flex flex-col gap-2.5 border-t p-3">
        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList>
            <TabsTrigger value="comment" className="text-xs">
              <MessageSquareTextIcon data-icon="inline-start" />
              Comment
            </TabsTrigger>
            <TabsTrigger value="cut" className="text-xs">
              <ScissorsIcon data-icon="inline-start" />
              Cut
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {!isRange && "At"}
          <Badge variant="outline" className="h-6 rounded-md font-mono text-xs text-foreground">
            {isRange ? <RepeatIcon data-icon="inline-start" /> : <ClockIcon data-icon="inline-start" />}
            {isRange ? `${clock(range.t0)} → ${clock(range.t1)}` : clock(time)}
          </Badge>
          {isRange && (
            <>
              <span className="font-mono tabular-nums">{(range.t1 - range.t0).toFixed(1)} s</span>
              <Button variant="ghost" size="icon-xs" aria-label="Clear the range" onClick={onClearRange}>
                <XIcon />
              </Button>
            </>
          )}
        </div>
        {isRange && rangeWords && <p className="truncate text-xs text-muted-foreground italic">“{rangeWords}”</p>}
        <Picks sounds={sounds} visuals={visuals} onRemoveSound={onRemoveSound} onRemoveVisual={onRemoveVisual} />
        <Textarea
          ref={composer}
          value={text}
          placeholder={kind === "cut" ? "Why cut it? (optional)" : "Describe what you want to change…"}
          className="min-h-16 resize-none text-sm md:text-sm"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (onAdd(kind, text)) setText("")
          }}
        />
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img) => (
              <div key={img.path} className="relative">
                <Thumb img={img} />
                <Button variant="secondary" size="icon-xs" className="absolute -top-2 -right-2 rounded-full" aria-label="Remove the image" onClick={() => onRemoveImage(img)}>
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Kbd>C</Kbd> write · <Kbd>Enter</Kbd> add
        </p>
      </div>
    </aside>
  )
}
