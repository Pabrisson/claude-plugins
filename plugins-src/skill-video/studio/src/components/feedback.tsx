import { useState, type RefObject } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  MessageSquareTextIcon,
  PencilIcon,
  RepeatIcon,
  ScissorsIcon,
  SparkleIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import { clock, minutes, when, type Comment, type Kind, type Range } from "@/lib/studio"
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

function Item({
  c,
  multiFormat,
  onSelect,
  onChange,
  onDelete,
}: {
  c: Comment
  multiFormat: boolean
  onSelect: () => void
  onChange?: (c: Comment) => void
  onDelete?: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const range = c.t1 > c.t0
  return (
    <div
      className="group/item flex cursor-pointer gap-2.5 rounded-lg border border-transparent p-2.5 hover:border-border hover:bg-card/50"
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
          <KindBadge type={c.type} />
          <Badge variant="outline" className="h-5 rounded-md font-mono">
            {range ? `${minutes(c.t0)} → ${minutes(c.t1)}` : minutes(c.t0)}
          </Badge>
          {multiFormat && c.format && <Badge variant="secondary">{c.format}</Badge>}
          {onChange && (
            <div className="ml-auto flex opacity-0 group-hover/item:opacity-100" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(c.text)}>
                <PencilIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={onDelete}>
                <Trash2Icon />
              </Button>
            </div>
          )}
        </div>
        {c.words && <p className="border-l-2 pl-3 text-[13px] text-muted-foreground italic">“{c.words}”</p>}
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
                onChange?.({ ...c, text: editing.trim() })
                setEditing(null)
              }
            }}
          />
        ) : (
          c.text && <p className={cn("text-sm leading-relaxed", c.resolved && "text-muted-foreground line-through")}>{c.text}</p>
        )}
        {c.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {c.images.map((img) => (
              <a key={img} href={`review/${img.split("/").pop()}`} target="_blank" onClick={(e) => e.stopPropagation()}>
                <img src={`review/${img.split("/").pop()}`} alt="Annotated frame" className="size-20 rounded-md object-cover ring-1 ring-foreground/10" />
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
  comments,
  previous,
  multiFormat,
  time,
  range,
  rangeWords,
  images,
  composer,
  onSelect,
  onSave,
  onAdd,
  onRemoveImage,
  onClearRange,
}: {
  version: number
  comments: Comment[]
  previous: { v: number; comments: Comment[] }[]
  multiFormat: boolean
  time: number
  range: Range | null
  rangeWords: string
  images: string[]
  composer: RefObject<HTMLTextAreaElement | null>
  onSelect: (c: Comment) => void
  onSave: (comments: Comment[]) => void
  onAdd: (kind: Kind, text: string) => boolean
  onRemoveImage: (img: string) => void
  onClearRange: () => void
}) {
  const [filter, setFilter] = useState<Filter>("open")
  const [kind, setKind] = useState<Kind>("comment")
  const [text, setText] = useState("")
  const counts = { open: comments.filter((c) => !c.resolved).length, resolved: comments.filter((c) => c.resolved).length, all: comments.length }
  const shown = comments.filter((c) => filter === "all" || c.resolved === (filter === "resolved"))
  const isRange = !!range && range.t1 > range.t0

  return (
    <aside className="flex h-[45%] min-h-0 shrink-0 flex-col border-t md:h-auto md:w-[clamp(19.5rem,27vw,32rem)] md:border-t-0 md:border-l">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Feedback</h2>
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {shown.map((c) => (
            <Item
              key={c.id}
              c={c}
              multiFormat={multiFormat}
              onSelect={() => onSelect(c)}
              onChange={(next) => onSave(comments.map((x) => (x.id === c.id ? next : x)))}
              onDelete={() => onSave(comments.filter((x) => x.id !== c.id))}
            />
          ))}
          {!comments.length && (
            <Empty className="px-4 py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareTextIcon />
                </EmptyMedia>
                <EmptyTitle className="text-sm">No feedback on this version (v{version})</EmptyTitle>
                <EmptyDescription className="text-xs">
                  Play the video, press <Kbd>C</Kbd> and write what you want to change.
                  To cut, select a range in the transcript or on the timeline, then press <Kbd>⌫</Kbd>. Drop an image anywhere to attach it.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {!!comments.length && !shown.length && <p className="py-10 text-center text-sm text-muted-foreground">Nothing {filter} on this version.</p>}

          {previous.map((p) => (
            <Collapsible key={p.v} className="mt-3">
              <CollapsibleTrigger className="group/prev flex w-full items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs font-medium">
                <ChevronDownIcon className="size-4 -rotate-90 transition-transform group-data-[state=open]/prev:rotate-0" />
                Previous version · v{p.v}
                <span className="ml-auto font-normal text-muted-foreground">
                  {p.comments.length} item{p.comments.length === 1 ? "" : "s"}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-1 pt-1">
                {p.comments.map((c) => (
                  <Item key={c.id} c={c} multiFormat={multiFormat} onSelect={() => {}} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
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
              <div key={img} className="relative">
                <img src={`review/${img.split("/").pop()}`} alt="Attached frame" className="size-20 rounded-md object-cover ring-1 ring-foreground/10" />
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
