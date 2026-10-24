import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { CopyIcon, EllipsisIcon, FilmIcon, LayoutGridIcon, TriangleAlertIcon } from "lucide-react"

import { Feedback } from "@/components/feedback"
import { Panel, type Tab } from "@/components/panel"
import { PromptDialog } from "@/components/prompt-dialog"
import { fullscreen, Player, toggle, useVideoTime } from "@/components/player"
import { SoundTimeline } from "@/components/sound"
import { VideoTimeline } from "@/components/video"
import { Transcript } from "@/components/transcript"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  api,
  buildPrompt,
  clock,
  minutes,
  newId,
  ratioName,
  sameSound,
  sameVisual,
  timeline,
  versionWords,
  when,
  wordsIn,
  type Comment,
  type Image,
  type Kind,
  type Project,
  type Range,
  type Sound,
  type SoundRef,
  type Visual,
  type VisualRef,
} from "@/lib/studio"

const r3 = (x: number) => Math.round(x * 1000) / 1000
const ratioOf = (format: string) => {
  const [w, h] = format.split(":").map(Number)
  return w && h ? w / h : 16 / 9
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState("")
  const [reviews, setReviews] = useState<Record<number, Comment[]>>({})
  const [format, setFormat] = useState("")
  const [range, setRange] = useState<Range | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [images, setImages] = useState<Image[]>([])
  // the version's sound, and the tracks or cues picked for the next comment
  const [sound, setSound] = useState<Sound | null>(null)
  const [sounds, setSounds] = useState<SoundRef[]>([])
  // the version's parts and thumbnails, and the parts picked for the next comment
  const [visual, setVisual] = useState<Visual | null>(null)
  const [visuals, setVisuals] = useState<VisualRef[]>([])
  const [tab, setTab] = useState("transcript")
  // the prompt shown in the dialog before copying, null when closed
  const [prompt, setPrompt] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const time = useVideoTime(video)

  useEffect(() => {
    api
      .project()
      .then(async (p) => {
        const all = await Promise.all(p.versions.map((v) => api.reviews(v.v)))
        if (p.versions.length) {
          const v = p.versions.at(-1)!.v
          const [s, vis] = await Promise.all([api.sound(v), api.video(v)])
          setSound(s)
          setVisual(vis)
        }
        setReviews(Object.fromEntries(p.versions.map((v, i) => [v.v, all[i].comments])))
        setProject(p)
        setFormat(p.formats.find((f) => p.versions.at(-1)?.files[f]) ?? p.formats[0])
      })
      .catch((e) => setError(e.message))
  }, [])

  // the studio always reviews the latest version; older ones only show their feedback
  const ver = project?.versions.at(-1)
  const words = useMemo(() => (project?.words && ver ? versionWords(project.words, ver) : null), [project, ver])
  const comments = useMemo(() => (ver && reviews[ver.v]) || [], [ver, reviews])
  const open = comments.filter((c) => !c.resolved)
  const src = ver?.files[format]?.url

  const seek = useCallback((t: number) => {
    const v = video.current
    if (v) v.currentTime = Math.min(Math.max(t, 0), v.duration || t)
  }, [])

  function save(next: Comment[]) {
    if (!ver) return
    setReviews((r) => ({ ...r, [ver.v]: next }))
    api.save(ver.v, next).catch((e) => toast.error(`Feedback not saved: ${e.message}`))
  }

  function add(kind: Kind, text: string) {
    if (!project || !ver) return false
    const r = range && range.t1 > range.t0 ? range : null
    if (kind === "cut" && !r) {
      toast("Select what to cut: drag on the timeline or across the transcript.")
      return false
    }
    if (kind === "comment" && !text.trim() && !images.length) return false
    const [t0, t1] = r ? [r.t0, r.t1] : [time, time], tl = timeline(ver)
    const c: Comment = {
      id: newId(),
      type: kind,
      t0: r3(t0),
      t1: r3(t1),
      // the source's seconds, or the scene's own seconds without a source (they differ once something is cut)
      s0: r3(tl.toSource(t0)),
      s1: r3(tl.toSource(t1)),
      text: text.trim(),
      words: words ? wordsIn(words, { t0, t1 }) : "",
      images,
      ...(sounds.length ? { sounds } : {}),
      ...(visuals.length ? { visuals } : {}),
      resolved: false,
      created: new Date().toISOString(),
      ...(project.formats.length > 1 ? { format } : {}),
    }
    save([...comments, c])
    setImages([])
    setSounds([])
    setVisuals([])
    setRange(null)
    // back to the shortcuts (Space, C, P, ⌫)
    composer.current?.blur()
    toast(`Feedback added · ${kind === "cut" ? "Cut" : "Comment"} at ${clock(t0)}`)
    return true
  }

  async function attach(png: Blob) {
    try {
      const [{ path }, bmp] = await Promise.all([api.image(newId(), png), createImageBitmap(png)])
      const ratio = ratioName(bmp.width, bmp.height), n = images.length + 1
      setImages([...images, { path, size: [bmp.width, bmp.height], ratio }])
      setDrawing(false)
      toast(`${n} image${n > 1 ? "s" : ""} ready for this feedback (${ratio})`)
      composer.current?.focus()
    } catch (e) {
      toast.error(`Image not saved: ${(e as Error).message}`)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setPrompt(null)
      toast.success("Prompt copied. Paste it into Claude.")
    } catch {
      toast.error("Copy refused by the browser: select the text and copy it by hand.")
    }
  }

  const pick = (s: SoundRef) =>
    setSounds((xs) => (xs.some((x) => sameSound(x, s)) ? xs.filter((x) => !sameSound(x, s)) : [...xs, s]))
  const pickVisual = (v: VisualRef) =>
    setVisuals((xs) => (xs.some((x) => sameVisual(x, v)) ? xs.filter((x) => !sameVisual(x, v)) : [...xs, v]))
  const clear = () => {
    setVisuals([])
    setRange(null)
    setSounds([])
  }

  function select(c: Comment) {
    if (c.format && c.format !== format && ver?.files[c.format]) setFormat(c.format)
    seek(c.t0)
    setRange(c.t1 > c.t0 ? { t0: c.t0, t1: c.t1 } : null)
  }

  // shortcuts: Space play · C write · P draw · F full screen · ⌫ cut the selection · Esc close or clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the prompt dialog has its own keys (Esc, ⌘↵)
      if (prompt !== null) return
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement
      if (e.key === "Escape") {
        if (drawing) setDrawing(false)
        else if (typing) (e.target as HTMLElement).blur()
        else clear()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === " ") toggle(video.current)
      else if (e.key === "c") composer.current?.focus()
      else if (e.key === "p") setDrawing((d) => !d)
      else if (e.key === "f") fullscreen(video.current)
      else if ((e.key === "Backspace" || e.key === "Delete") && range) add("cut", "")
      else return
      e.preventDefault()
    }
    // an image dropped anywhere joins the next feedback
    const over = (e: DragEvent) => e.preventDefault()
    const drop = async (e: DragEvent) => {
      e.preventDefault()
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"))
      if (!file) return
      const bmp = await createImageBitmap(file), c = document.createElement("canvas")
      c.width = bmp.width
      c.height = bmp.height
      c.getContext("2d")!.drawImage(bmp, 0, 0)
      c.toBlob((png) => png && attach(png), "image/png")
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("dragover", over)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("dragover", over)
      window.removeEventListener("drop", drop)
    }
  })

  if (error || !project)
    return (
      <Empty className="h-svh">
        {error && (
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>The studio could not load this project</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        )}
      </Empty>
    )

  const tabs: Tab[] = [
    ...(words
      ? [
          {
            value: "transcript",
            label: "Transcript",
            badge: words[0]?.screen ? `On screen · ${words.length}` : undefined,
            info: words[0]?.screen
              ? "What the video shows, moment by moment. Click a line to select it, drag across lines to select several, then comment."
              : "Click a word to jump there. Drag across words to select their range, then cut it or comment on it.",
          },
        ]
      : []),
    ...(visual
      ? [
          {
            value: "video",
            label: "Video",
            badge: visual.parts.length ? String(visual.parts.length) : undefined,
            info: "The frames, then one row per kind of part the scene declared (sequences, titles…). Click a row's name to comment on all of it, or one block (several if you like). Hover the frames to see them. On the rows, click to jump, drag to select a range. Pinch or ⌘-scroll to zoom.",
          },
        ]
      : []),
    ...(sound
      ? [
          {
            value: "sound",
            label: "Sound",
            badge: sound.cues.length ? String(sound.cues.length) : undefined,
            info: "One row per track and per kind of sound. Click a row's name to comment on all of it, or one cue (several if you like). On the rows, click to jump, drag to select a range. Pinch or ⌘-scroll to zoom.",
          },
        ]
      : []),
  ]
  const shown = tabs.find((t) => t.value === tab)?.value ?? tabs[0]?.value
  // the sequence on screen, named in the Video tab's header
  const playing = visual?.parts.findLast((p) => p.kind === "sequence" && p.t0 <= time && time < p.t1)

  const meta = (label: string, value: string) => (
    <>
      {label} <span className="text-foreground/80">{value}</span>
    </>
  )

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b px-3 py-2.5 lg:gap-4 lg:px-5">
          {/* decorative: one studio per project, no project picker */}
          <div aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <LayoutGridIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{project.slug}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {meta("Format", format)}
              {ver && (
                <>
                  {" · "}
                  {meta("", minutes(ver.duration))}
                  {" · "}
                  {meta("Rendered", when(ver.rendered))}
                  {" · "}
                  {meta("Feedback", `v${ver.v}`)}
                </>
              )}
              {" · "}
              {meta("Rules", project.rules.join(", ") || "none")}
            </p>
          </div>
          {project.formats.length > 1 && (
            <Tabs value={format} onValueChange={setFormat} className="shrink-0">
              <TabsList>
                {project.formats.map((f) => (
                  <TabsTrigger key={f} value={f} disabled={!ver?.files[f]} className="font-mono text-xs">
                    {f}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(project.dir).then(() => toast("Project path copied"))}>
                    Copy the project path
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!src} onSelect={() => window.open(src)}>
                    Open the video
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => location.reload()}>Reload</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant={open.length ? "default" : "secondary"} disabled={!open.length} onClick={() => ver && setPrompt(buildPrompt(project, ver, open))}>
              <CopyIcon data-icon="inline-start" />
              <span className="hidden sm:inline">Copy prompt</span>
              <Badge variant="secondary" className="min-w-5 rounded-full px-1.5 tabular-nums">
                {open.length}
              </Badge>
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <main className="@container flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3 lg:gap-4 lg:p-5">
            {src ? (
              <Player
                video={video}
                src={src}
                ratio={ratioOf(format)}
                time={time}
                comments={comments}
                range={range}
                drawing={drawing}
                onSeek={seek}
                onRange={setRange}
                onDraw={setDrawing}
                onAttach={attach}
              />
            ) : (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilmIcon />
                  </EmptyMedia>
                  <EmptyTitle>No video to review yet</EmptyTitle>
                  <EmptyDescription>Make a rough cut (with a source video) or a render, then reload the studio.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {ver && tabs.length > 0 && (
              <Panel
                className="h-[clamp(7.5rem,26%,17rem)] shrink-0"
                tabs={tabs}
                tab={shown}
                range={range}
                picked={[
                  sounds.length && `${sounds.length} sound${sounds.length > 1 ? "s" : ""}`,
                  visuals.length && `${visuals.length} visual${visuals.length > 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                status={shown === "video" && playing ? (playing.name ?? "sequence") : undefined}
                onTab={setTab}
                onCut={() => add("cut", "")}
                onComment={() => composer.current?.focus()}
                onClear={clear}
              >
                {shown === "video" && visual ? (
                  <VideoTimeline
                    visual={visual}
                    format={format}
                    duration={ver.duration}
                    time={time}
                    range={range}
                    picked={visuals}
                    onSeek={seek}
                    onRange={setRange}
                    onPick={pickVisual}
                  />
                ) : shown === "sound" && sound ? (
                  <SoundTimeline
                    sound={sound}
                    duration={ver.duration}
                    time={time}
                    range={range}
                    picked={sounds}
                    onSeek={seek}
                    onRange={setRange}
                    onPick={pick}
                  />
                ) : (
                  words && (
                    <Transcript
                      words={words}
                      time={time}
                      range={range}
                      marked={comments.filter((c) => c.t1 > c.t0)}
                      onSeek={seek}
                      onRange={setRange}
                    />
                  )
                )}
              </Panel>
            )}
          </main>

          {ver && (
            <Feedback
              version={ver.v}
              comments={comments}
              previous={project.versions
                .slice(0, -1)
                .reverse()
                .map((v) => ({ v: v.v, comments: reviews[v.v] ?? [] }))
                .filter((p) => p.comments.length)}
              multiFormat={project.formats.length > 1}
              time={time}
              range={range}
              rangeWords={range && words ? wordsIn(words, range) : ""}
              images={images}
              sounds={sounds}
              visuals={visuals}
              composer={composer}
              onSelect={select}
              onSave={save}
              onAdd={add}
              onRemoveImage={(img) => setImages(images.filter((i) => i !== img))}
              onRemoveSound={pick}
              onRemoveVisual={pickVisual}
              onClearRange={() => setRange(null)}
            />
          )}
        </div>
      </div>
      <PromptDialog prompt={prompt} count={open.length} onCopy={copy} onClose={() => setPrompt(null)} />
      <Toaster theme="dark" position="top-center" offset={84} />
    </TooltipProvider>
  )
}
