import { useState } from "react"
import { ArrowRightToLineIcon, Disc3Icon, ImageIcon, LayoutGridIcon, MusicIcon, PaintbrushIcon, PlusIcon, SearchIcon, SparklesIcon, SpeechIcon, Trash2Icon, UserIcon, VideoIcon, Volume2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, fileUrl, plain, type Kind, type SavedStyle, type SoundFamily, type State } from "@/lib/api"
import { Chips, Label } from "@/components/chips"
import { ConfirmDelete, FilesEditor, type Use } from "@/components/elements"
import { Main, Side } from "@/components/pages"
import { FAMILIES, familyArt, GroupIcon, lastIn, StyleCard, StyleThumb, styleKey, type Preset } from "@/components/style-picker"
import { own, t } from "@/lib/i18n"

type Open = { preset: Preset } | { yours: string }
const SOUND_FAMILIES = ["music", "voice", "sound"] as const
// how a sound style reads, by its family: the placeholder of its words, what the agent is asked to write them
const WORDS: Record<SoundFamily, { placeholder: string; parts: string }> = {
  music: { placeholder: t("warm analog synths, breathy female vocals, 90 BPM"), parts: "genre, instruments, tempo, mood and vocals, an artist's sound described without their name" },
  voice: { placeholder: t("a calm narrator, slow and warm, gentle pauses"), parts: "the delivery: pace, pitch, mood, how close to the microphone" },
  sound: { placeholder: t("dry close-miked foley, no music"), parts: "its texture, its space, how real or stylized" },
}

// the Library's styles, visual (a look, from images) or sound (in words, for music, a voice or a sound effect): the
// presets and the user's own in one gallery, each opened to use it or, for one's own, to change it
export function StylesTab({ tabs, state, presets, sound = false, engine, onUse, onChanged }: { tabs: React.ReactNode; state: State; presets: Preset[]; sound?: boolean; engine: string; onUse: Use; onChanged: () => void }) {
  const yours = (state.styles ?? []).filter((s) => !!s.for === sound)
  const [source, setSource] = useState<"all" | "presets" | "yours">("all")
  const [family, setFamily] = useState<SoundFamily | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Open | null>(null)
  const [creating, setCreating] = useState(false)
  const q = query.trim().toLowerCase()
  const ofFamily = presets.filter((p) => !family || p.for === family)
  const groups = [...new Set(ofFamily.map((p) => p.group ?? ""))]
  const mine = source === "presets" || group ? [] : yours.filter((s) => (!family || s.for === family) && (!q || `${s.name} ${s.words}`.toLowerCase().includes(q)))
  const theirs = source === "yours" ? [] : ofFamily.filter((p) => (!group || p.group === group) && (!q || `${p.label} ${p.note ?? ""} ${p.group ?? ""} ${own(p.label)} ${own(p.note) ?? ""} ${own(p.group) ?? ""}`.toLowerCase().includes(q)))
  // a visual preset's card: the last image made in it; a sound's is painted, its last result heard in its dialog
  const thumb = (p: Preset) => (sound ? null : lastIn(p.value, p.label, "image", state.media, state.home))
  const heard = (value: string, label: string | undefined, f?: SoundFamily) => lastIn(value, label, "audio", state.media, state.home, styleKey(f))
  const shownYours = open && "yours" in open ? yours.find((s) => s.name === open.yours) : undefined
  const familyOf = (g: string) => presets.find((p) => p.group === g)?.for

  return (
    <>
      <Side
        head={
          <>
            {tabs}
            <Button variant="space" onClick={() => setCreating(true)}>
              <PlusIcon /> {t("New style")}
            </Button>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search styles")} aria-label={t("Search styles")} className="pl-8" />
            </div>
          </>
        }
      >
        <div>
          <Label>{t("Show")}</Label>
          <Chips
            options={["all", "yours", "presets"] as const}
            value={source}
            label={(s) => (s === "all" ? t("All") : s === "yours" ? t("Yours · {n}", { n: yours.length }) : t("Presets · {n}", { n: presets.length }))}
            icon={(s) => (s === "all" ? <LayoutGridIcon /> : s === "yours" ? <UserIcon /> : <SparklesIcon />)}
            onChange={(s) => (setSource(s), s === "yours" && setGroup(null))}
          />
        </div>
        {sound && (
          <div>
            <Label>{t("For")}</Label>
            <Chips
              options={["all", ...SOUND_FAMILIES] as const}
              value={family ?? "all"}
              label={(f) => (f === "all" ? t("All") : FAMILIES[f].label)}
              icon={(f) => {
                const Icon = f === "all" ? LayoutGridIcon : FAMILIES[f].icon
                return <Icon />
              }}
              onChange={(f) => (setFamily(f === "all" ? null : f), setGroup(null))}
            />
          </div>
        )}
        {source !== "yours" && (
          <nav aria-label={t("Groups")} className="-mx-1 flex flex-col gap-0.5">
            {[null, ...groups].map((g) => (
              <button
                key={g ?? "all"}
                type="button"
                aria-current={group === g ? "true" : undefined}
                onClick={() => setGroup(g)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  group === g ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <GroupIcon group={g} className="size-4 shrink-0" />
                <span className="flex-1">{own(g) ?? t("Every group")}</span>
                <span className="text-xs tabular-nums">{g ? ofFamily.filter((p) => p.group === g).length : ofFamily.length}</span>
              </button>
            ))}
          </nav>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {sound
            ? t("A sound style is how it sounds: a genre and its instruments, a voice's delivery, a sound's texture. Use one in Music, Cover, Extend, Voice, Sound effect… Yours are a few words of your own.")
            : t("A style is a look: medium, palette, line and texture, never what is in the picture. Use one in Restyle or Custom. Yours are made from 1 to 5 images that share the look.")}
        </p>
      </Side>
      <Main title={sound ? t("Sound styles") : t("Visual styles")} aside={<span className="text-sm text-muted-foreground">{t("{n} styles", { n: mine.length + theirs.length })}</span>}>
        {source !== "presets" && !group && (
          <section className="flex flex-col gap-3" aria-label={t("Yours")}>
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("Yours")}</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
              {mine.map((s) => (
                <StyleCard
                  key={s.name}
                  radio={false}
                  on={false}
                  title={s.name}
                  note={s.for ? `${FAMILIES[s.for].label} · ${s.words}` : s.words || t(s.files.length > 1 ? "{n} images" : "{n} image", { n: s.files.length })}
                  onPick={() => setOpen({ yours: s.name })}
                  thumb={<StyleThumb file={s.files[0] ?? null} preset={s.for ? familyArt(s) : undefined} className="absolute inset-0" />}
                />
              ))}
              {!q && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors outline-none hover:border-space/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <PlusIcon className="size-5" />
                  {t("New style")}
                  <span className="px-6 text-center text-xs">{sound ? t("A few words of how it sounds") : t("From 1 to 5 images of the look")}</span>
                </button>
              )}
            </div>
          </section>
        )}
        {(group ? [group] : groups).map((g) => {
          const list = theirs.filter((p) => (p.group ?? "") === g), f = familyOf(g)
          return list.length ? (
            <section key={g} className="flex flex-col gap-3" aria-label={own(g)}>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                <GroupIcon group={g} className="size-3.5" />
                {f && !family ? `${FAMILIES[f].label} · ${own(g)}` : own(g)}
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
                {list.map((p) => (
                  <StyleCard key={p.value} radio={false} on={false} title={own(p.label)} note={own(p.note)} sample={sound ? p.preview : undefined} onPick={() => setOpen({ preset: p })} thumb={<StyleThumb file={thumb(p)} preset={p} className="absolute inset-0" />} />
                ))}
              </div>
            </section>
          ) : null
        })}
        {!mine.length && !theirs.length && (source === "presets" || q) && <p className="py-8 text-center text-sm text-muted-foreground">{t("No style matches.")}</p>}
      </Main>
      {open && "preset" in open && (
        <PresetDialog preset={open.preset} file={thumb(open.preset)} heard={sound ? heard(open.preset.value, open.preset.label, open.preset.for) : null} onClose={() => setOpen(null)} onUse={onUse} />
      )}
      {shownYours && <YourStyle style={shownYours} state={state} heard={shownYours.for ? heard(shownYours.name, undefined, shownYours.for) : null} onClose={() => setOpen(null)} onUse={onUse} onChanged={onChanged} />}
      {creating && <NewStyle state={state} engine={engine} sound={sound} onClose={() => setCreating(false)} onSaved={(name) => (setCreating(false), onChanged(), setOpen({ yours: name }))} />}
    </>
  )
}

// where a style goes: Restyle an image or a video, or Custom image with it; a sound style, its family's tools
function UseButtons({ value, family, onUse, onClose }: { value: string; family?: SoundFamily; onUse: Use; onClose: () => void }) {
  const go = (kind: Kind, tool: string) => (onClose(), onUse(kind, tool, { fields: { [styleKey(family)]: value } }))
  if (family === "music")
    return (
      <>
        <Button variant="space" onClick={() => go("audio", "music")}>
          <MusicIcon /> {t("Make music")}
        </Button>
        <Button variant="outline" onClick={() => go("audio", "cover")}>
          <Disc3Icon /> {t("Cover a song")}
        </Button>
        <Button variant="outline" onClick={() => go("audio", "extend-music")}>
          <ArrowRightToLineIcon /> {t("Extend a song")}
        </Button>
      </>
    )
  if (family === "voice")
    return (
      <Button variant="space" onClick={() => go("audio", "voice")}>
        <SpeechIcon /> {t("Speak with it")}
      </Button>
    )
  if (family === "sound")
    return (
      <Button variant="space" onClick={() => go("audio", "sound-effect")}>
        <Volume2Icon /> {t("Make a sound")}
      </Button>
    )
  return (
    <>
      <Button variant="space" onClick={() => go("image", "restyle")}>
        <PaintbrushIcon /> {t("Restyle an image")}
      </Button>
      <Button variant="outline" onClick={() => go("video", "restyle")}>
        <VideoIcon /> {t("Restyle a video")}
      </Button>
      <Button variant="outline" onClick={() => go("image", "free")}>
        <ImageIcon /> {t("Create with it")}
      </Button>
    </>
  )
}

// the last sound made in a style, to hear it
function Heard({ file }: { file: string | null }) {
  return file ? (
    <div>
      <Label hint={t("your last result in it")}>{t("Heard")}</Label>
      <audio controls preload="metadata" src={fileUrl(file)} className="w-full" />
    </div>
  ) : null
}

function PresetDialog({ preset, file, heard, onClose, onUse }: { preset: Preset; file: string | null; heard: string | null; onClose: () => void; onUse: Use }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[600px]">
        <div className="pr-8">
          <DialogTitle>{own(preset.label)}</DialogTitle>
          <DialogDescription className="mt-1">
            {preset.for && `${FAMILIES[preset.for].label} · `}
            {own(preset.group)} · {own(preset.note)}
            {file || preset.for || preset.preview ? "" : ` · ${t("its card is painted from its palette until you make something in it")}`}
          </DialogDescription>
        </div>
        <StyleThumb file={file} preset={preset} className={cn("w-full rounded-xl border", preset.for ? "aspect-[3/1]" : "aspect-video")} />
        <p className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">{preset.value}</p>
        {preset.for && preset.preview && (
          <div>
            <Label hint={t("how it sounds")}>{t("Sample")}</Label>
            <audio controls preload="none" src={preset.preview} className="w-full" />
          </div>
        )}
        <Heard file={heard} />
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <UseButtons value={preset.value} family={preset.for} onUse={onUse} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// one of the user's styles, open: its images (a sound style: its words) to change, where it goes
function YourStyle({ style, state, heard, onClose, onUse, onChanged }: { style: SavedStyle; state: State; heard: string | null; onClose: () => void; onUse: Use; onChanged: () => void }) {
  const [words, setWords] = useState(style.words)
  const [confirm, setConfirm] = useState(false)
  async function save(body: { paths?: string[]; words?: string; drop?: string[]; remove?: boolean }) {
    try {
      await api.styles({ name: style.name, ...body })
      onChanged()
    } catch (e) {
      toast.error(plain((e as Error).message))
    }
  }
  const f = style.for
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-5 overflow-auto sm:max-w-[640px]">
        <div className="pr-8">
          <DialogTitle>{style.name}</DialogTitle>
          <DialogDescription className="mt-1">
            {f ? t("Your {family} style: its words go with the request as they are.", { family: FAMILIES[f].label.toLowerCase() }) : t("Your style: its images go with the request, the model takes their look, never their subject.")}
          </DialogDescription>
        </div>
        {f ? (
          <StyleThumb preset={familyArt(style)} file={null} className="aspect-[3/1] w-full rounded-xl border" />
        ) : (
          <div className={cn("grid gap-1 overflow-hidden rounded-xl border", style.files.length > 1 && "grid-cols-2")}>
            {style.files.slice(0, 4).map((x) => <img key={x} src={fileUrl(x)} alt="" className="aspect-video w-full object-cover" />)}
          </div>
        )}
        {f ? (
          <div>
            <Label>{t("How it sounds")}</Label>
            <Textarea value={words} placeholder={WORDS[f].placeholder} onChange={(e) => setWords(e.target.value)} onBlur={() => words.trim() && words !== style.words && save({ words })} className="min-h-20 text-sm" />
          </div>
        ) : (
          <>
            <div>
              <Label hint={t("optional, sent with it")}>{t("The look in words")}</Label>
              <Input value={words} placeholder={t("loose sumi ink washes, rice paper, one red accent")} onChange={(e) => setWords(e.target.value)} onBlur={() => words !== style.words && save({ words })} />
            </div>
            <FilesEditor files={style.files} kind="image" state={state} label={t("Images of the look")} max={5} onAdd={(paths) => save({ paths })} onDrop={(x) => save({ drop: [x.split(/[\\/]/).pop()!] })} />
          </>
        )}
        <Heard file={heard} />
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <UseButtons value={style.name} family={f} onUse={onUse} onClose={onClose} />
          <span className="flex-1" />
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
            <Trash2Icon /> {t("Delete")}
          </Button>
        </div>
        <ConfirmDelete what={style.name} open={confirm} onCancel={() => setConfirm(false)} onConfirm={() => (setConfirm(false), onClose(), save({ remove: true }))} />
      </DialogContent>
    </Dialog>
  )
}

function NewStyle({ state, engine, sound, onClose, onSaved }: { state: State; engine: string; sound: boolean; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState("")
  const [words, setWords] = useState("")
  const [family, setFamily] = useState<SoundFamily>("music")
  const [paths, setPaths] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const taken = (state.styles ?? []).some((s) => s.name === name)
  async function save() {
    setBusy(true)
    try {
      await api.styles(sound ? { name, words, for: family } : { name, words: words || undefined, paths })
      toast.success(t("Style {name} saved", { name }), { description: sound ? t("Pick it in a Style field.") : t("Use it in Restyle or Custom.") })
      onSaved(name)
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  function askAgent() {
    const n = name || "<a short name>"
    const text = sound
      ? [
          `/skill-video:media-generator Make the ${family} style ${n} in my Library.`,
          words ? `How it sounds: ${words}.` : `Ask me what it should sound like (a song, a sound I like, a mood), then write it in a few words: ${WORDS[family].parts}.`,
          `Save it with: node "${engine}/media.mjs" styles add ${n} --for ${family} --words "…"`,
          "Then tell me how to use it.",
        ]
      : [
          `/skill-video:media-generator Make the style ${n} in my Library.`,
          paths.length ? `Its images: ${paths.join(", ")}.` : "No image yet: ask me for 1 to 5 images that share the look.",
          words ? `The look in words: ${words}.` : "Look at the images and write their look in a few words: medium, palette, line, texture, light; never their subject.",
          `Save it with: node "${engine}/media.mjs" styles add ${n} <images…> --words "…" (--from <generation> takes a result's images).`,
          "Then tell me how to use it.",
        ]
    navigator.clipboard.writeText(text.join("\n")).then(
      () => toast.success(t("Prompt copied"), { description: t("Paste it in your agent: the agent makes the style.") }),
      () => toast.error(t("The clipboard refused the copy"))
    )
  }
  const ready = sound ? !!words.trim() && !taken : paths.length > 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-5 overflow-auto sm:max-w-[640px]">
        <div>
          <DialogTitle>{sound ? t("New sound style") : t("New style")}</DialogTitle>
          <DialogDescription className="mt-1">
            {sound
              ? t("How something sounds, in a few words: a genre and its instruments, a voice's delivery, a sound's texture. It goes with the request as written.")
              : t("A look taken from 1 to 5 images: a painting, a film frame, an illustration. The model copies the look, never what is in them.")}
          </DialogDescription>
        </div>
        {sound ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <div>
                <Label hint={taken ? t("taken") : undefined}>{t("Name")}</Label>
                <Input value={name} placeholder={t("Brand-sound")} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} />
              </div>
              <div>
                <Label>{t("For")}</Label>
                <Chips
                  options={SOUND_FAMILIES}
                  value={family}
                  label={(x) => FAMILIES[x].label}
                  icon={(x) => {
                    const Icon = FAMILIES[x].icon
                    return <Icon />
                  }}
                  onChange={setFamily}
                />
              </div>
            </div>
            <div>
              <Label>{t("How it sounds")}</Label>
              <Textarea value={words} placeholder={WORDS[family].placeholder} onChange={(e) => setWords(e.target.value)} className="min-h-20 text-sm" />
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <div>
                <Label hint={taken ? t("adds to it") : undefined}>{t("Name")}</Label>
                <Input value={name} placeholder={t("Ink-wash")} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} />
              </div>
              <div>
                <Label hint={t("optional")}>{t("The look in words")}</Label>
                <Input value={words} placeholder={t("loose sumi ink washes, rice paper, one red accent")} onChange={(e) => setWords(e.target.value)} />
              </div>
            </div>
            <FilesEditor files={paths} kind="image" state={state} label={t("Images of the look")} max={5} onAdd={(more) => setPaths((p) => [...p, ...more.filter((m) => !p.includes(m))].slice(0, 5))} onDrop={(f) => setPaths((p) => p.filter((x) => x !== f))} />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button variant="outline" onClick={askAgent} title={t("Copies a request for the agent: it writes the words and saves the style")}>
            <SparklesIcon /> {t("Ask Agent")}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="space" disabled={busy || !name || !ready} onClick={save}>
            {!name ? t("Name it") : sound ? (taken ? t("{name} is taken", { name }) : !words.trim() ? t("Say how it sounds") : t("Save style")) : !paths.length ? t("Add an image") : taken ? t("Add to {name}", { name }) : t("Save style")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
