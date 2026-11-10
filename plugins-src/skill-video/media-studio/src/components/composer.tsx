import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronRightIcon, CopyIcon, EllipsisVerticalIcon, EraserIcon, FilmIcon, LanguagesIcon, ListVideoIcon, LoaderCircleIcon, MessagesSquareIcon, MicIcon, MinusIcon, PencilLineIcon, PlusIcon, SparklesIcon, TimerIcon, TypeIcon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Slider } from "@/components/ui/slider"
import {
  api,
  bareModel,
  cited,
  currentOf,
  defaultKeys,
  fill,
  imageInputs,
  isLocal,
  mentionables,
  needsPhrase,
  mentionFrom,
  ownPrompt,
  plain,
  priceLabel,
  ROUTER_NAME,
  type Draft,
  type Element,
  type EstimateAnswer,
  type Field,
  type Kind,
  type Input as InputT,
  type Line,
  type Shot,
  type Model,
  type Place,
  type Spec,
  type State,
  type Submitted,
  type Tool,
  withLooks,
  withMentions,
} from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, Chips, Label, Price, valueIcon } from "@/components/chips"
import { FieldInput, Recolors, sections, Setups } from "@/components/fields"
import { LightRig } from "@/components/light-rig"
import { CameraRig } from "@/components/camera-rig"
import { ElementField } from "@/components/element-field"
import { StyleField } from "@/components/style-picker"
import { ExpandPreview, marginsOf } from "@/components/expand"
import { ExtendPanel } from "@/components/extend"
import { KeyframePanel } from "@/components/keyframe"
import { frameCap, KeyframeStrip } from "@/components/keyframes"
import { LinesEditor, OmniRefs, voiceName, type SpokenLine } from "@/components/omni"
import { InputSlots, slotFor, upload } from "@/components/inputs"
import { MentionTextarea } from "@/components/mention"
import { ToolPicker } from "@/components/tool-picker"
import { LibraryVoices, ModelVoices, SingerPicker, VoicePicker } from "@/components/voice-picker"
import { AudioTags, DialogueEditor, ModelOptions, ShotsEditor } from "@/components/model-options"
import { capsOf, ModelPicker, type Priced } from "@/components/model-picker"
import { t, own, locale } from "@/lib/i18n"

// what the composer of one space holds: kept per space, so switching spaces loses nothing
export type Compose = {
  tool: string
  model?: string
  intent: string
  raw: boolean
  rawText: string
  fields: Record<string, string>
  inputs: Record<string, string[]>
  params: Record<string, unknown>
  // the same generation 1 to 4 times
  batch?: number
  // where the result goes on a workspace's timeline once done (a Bridge shot, a take)
  place?: Place
}
export const blank = (kind: Kind, tool = kind === "audio" ? "voice" : "free"): Compose => ({
  tool,
  intent: "",
  raw: false,
  rawText: "",
  fields: {},
  inputs: {},
  params: {},
})

const pick = <T,>(list: T[] | null | undefined, ...want: (T | undefined)[]) =>
  list?.length ? (want.find((w) => w !== undefined && list.includes(w)) ?? list[0]) : undefined

// the models a tool can run on: its recommended ones first, then the rest of the kind that fits
export function modelsFor(tool: Tool, kind: Kind, models: Model[]) {
  if (isLocal(tool) || tool.provider === "elevenlabs") return { recommended: [], others: [] }
  const listed = (ids?: string[]) => (ids ?? []).map((id) => models.find((m) => m.model === id)).filter((m): m is Model => !!m)
  const recommended = listed(tool.models), also = listed(tool.also)
  // edits, upscales and avatars run only on the models made for them, and the ones the tool also names
  if (kind === "video" && (tool.mode === "edit" ? tool.id !== "extend" : recommended.length > 0 && recommended.every((m) => m.role !== "generate")))
    return { recommended, others: also }
  // music, sounds and their edits run on the models they name; Voice on any voice
  if (kind === "audio" && tool.id !== "voice") return { recommended, others: also }
  // an image tool's forced settings (Remove background's transparency, Upscale's 4K) only on the models that have them
  const can = (m: Model) =>
    (!tool.params?.background || (m.params.background ?? []).includes(String(tool.params.background))) &&
    (!tool.params?.resolution || (m.params.resolution ?? []).includes(String(tool.params.resolution)))
  const ok = (m: Model) =>
    kind === "video"
      ? m.role === "generate" && (tool.id !== "extend" || (m.params.frames?.length ?? 0) > 0)
      : kind === "image"
        ? // a create tool takes the models that make an image from words (an upscaler or a cut-out needs one), an edit tool those that take one
          (tool.mode === "create" ? m.role !== "edit" : m.role !== "create") && can(m)
        : m.role === "speech"
  return { recommended, others: [...also, ...models.filter((m) => ok(m) && !recommended.includes(m) && !also.includes(m))] }
}

const COMMON_LANGS = ["en", "fr", "es", "de", "it", "pt", "ja", "zh"]

// the tool a space's mode opens on: Custom's in image and video, Voice in audio and the first of its edits
const firstOf = (kind: Kind, mode: "create" | "edit", tools: Tool[]) =>
  kind !== "audio" ? (mode === "create" ? "free" : "free-edit") : mode === "create" ? "voice" : (tools.find((t) => t.mode === "edit" && !t.hidden)?.id ?? "voice")
// a field, an input or a model option shown while the tool's other fields have these values (Music's lyrics in Write,
// when sung); a key the tool has no field for holds nothing back (Suno's options on Extend), as the engine does
const shownWhen = (tool: Tool, fields: Record<string, string>) => (when?: Record<string, string>) =>
  !when ||
  Object.entries(when).every(([k, v]) => {
    const f = tool.fields.find((x) => x.key === k)
    return !f || (fields[k] ?? String(f.default ?? "")) === v
  })

// where the result goes, as the composer says it (back: Extend going back in time, before its clip)
const sec = (n: number) => n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function placeText(p: Place, kind: Kind, back: boolean) {
  if (!p.replace) return kind === "audio" ? t("The voice goes in at {at} s", { at: sec(p.at) }) : t("The result goes into the cut at {at} s", { at: sec(p.at) })
  if (p.how === "after") return back ? t("The result goes right before its clip") : t("The result goes right after its clip")
  if (p.how === "from") return p.to == null ? t("The result replaces its clip from {at} s", { at: sec(p.at) }) : t("The result replaces its clip from {at} s, for the voice's {length} s", { at: sec(p.at), length: sec(p.to - (p.from ?? 0)) })
  return p.how === "whole" ? t("The result replaces its clip") : t("The result takes its clip's place")
}

// the tool list's prices for the session, per space, tool and model (a probe estimate, before any input)
const PRICES = new Map<string, string>()
// the agent's words typed into the composer in so many steps of 30 ms, whatever their length
const TYPED = 40

export function Composer({
  kind,
  tools,
  models,
  state,
  engine,
  value,
  onChange,
  draftSeen,
  onDraftSeen,
}: {
  kind: Kind
  tools: Tool[]
  models: Model[]
  state: State
  engine: string
  value: Compose
  onChange: (c: Compose) => void
  draftSeen: string
  onDraftSeen: (at: string) => void
}) {
  const tool = tools.find((t) => t.id === value.tool) ?? tools[0]
  const mode = tool.mode
  const set = (patch: Partial<Compose>) => onChange({ ...value, ...patch })
  const eleven = tool.provider === "elevenlabs", local = isLocal(tool), shown = shownWhen(tool, value.fields)

  // the model: the user's pick, else their default for this tool when it fits (its own, its use's, its kind's: Settings ›
  // Default models, the engine's order too), else the tool's first
  const { recommended, others } = useMemo(() => modelsFor(tool, kind, models), [tool, kind, models])
  const fitting = [...recommended, ...others]
  const defaults = state.settings.defaults
  const def = defaultKeys(kind, tool).map((k) => defaults[k]).flatMap((id) => (id ? fitting.filter((m) => m.model === bareModel(id)) : []))[0]
  const modelId = eleven || local ? undefined : (value.model && fitting.some((m) => m.id === value.model) ? value.model : (def?.id ?? fitting[0]?.id))
  const model = models.find((m) => m.id === modelId)
  // ElevenLabs straight: a voice of the account or of the Library, whole (no clips; « How it sounds » only on v4 and
  // v3, a preset sent as its audio tags), or a dialogue's lines on v4 and v3
  // (its other models, sounds, music, voice design, transcripts, need its key and no voice of their own)
  const elevenModel = model?.provider === "elevenlabs", direct = elevenModel && model?.role === "speech"
  // Voice before its models arrive: nothing that depends on them (no clips, no « How it sounds » shown a moment)
  const waiting = tool.id === "voice" && !model
  const mp = model?.params
  // a dialogue (ElevenLabs v4 and v3, Gemini on Kie): its lines, at most so many voices
  const dialogue = tool.id === "voice" && mp?.dialogue && Array.isArray(value.params.dialogue) ? (value.params.dialogue as Line[]) : null
  const dialogueChars = dialogue?.reduce((n, l) => n + l.text.length, 0) ?? 0
  const dialogueVoices = new Set(dialogue?.filter((l) => l.text.trim()).map((l) => l.voice)).size
  // Kling's shots (on Custom): each its words and seconds, their sum the length
  const shots = tool.id === "free" && mp?.shots && Array.isArray(value.params.shots) ? (value.params.shots as Shot[]) : null
  const shotsTotal = shots?.reduce((n, x) => n + x.duration, 0) ?? 0
  const shotLengths = (mp?.duration ?? []).filter((d) => !mp?.shots || d <= mp.shots.total)
  // Seedance 2.5's final, made from a draft
  const draftOf = kind === "video" && mp?.draft ? (value.params.draft_of as string | undefined) : undefined
  // the model's own inputs, among the tool's right after its first frame (the photo of a talking avatar): OmniHuman's
  // mask of who speaks on the photo
  const framedTool = tool.inputs.some((i) => i.key === "first_frame")
  const modelInputs: InputT[] = !framedTool ? [] : [
    ...(tool.id === "talking-avatar" && mp?.masks ? [{ key: "speaker_masks", kind: "mask" as const, label: t("Who speaks"), optional: true }] : []),
  ]
  // a model with middle frames (Kling 4.0, Grok): its first, middle and last frames in one strip, in order
  const strip = kind === "video" && framedTool && !!mp?.mid_frames
  const seconds = Number(pick(mp?.duration, value.params.duration as number, 5) ?? 5)
  const frameCount = (value.inputs.mid_frames?.length ?? 0) + (value.inputs.first_frame?.length ?? 0) + (value.inputs.last_frame?.length ?? 0)
  const cap = strip ? frameCap(mp!.mid_frames!, seconds) : null
  // a voice model that clones nothing (Kie's) or takes voices whole (ElevenLabs): no clips, no Library voice field
  const noClone = model?.params.clone === false || direct || waiting
  const toolInputs = tool.inputs.filter((i) => shown(i.when) && !(noClone && i.key === "voice_clips") && !(strip && ["first_frame", "last_frame"].includes(i.key))), first = toolInputs.findIndex((i) => i.key === "first_frame")
  // a new video's references beyond images (omni references: Kling 4.0, Seedance, Wan 3.0, Hailuo 3, Vidu Q4): videos,
  // sounds, and voices of one's own (Kling 4.0), after the tool's references
  const omni = kind === "video" && mode === "create" && model?.role === "generate" && tool.inputs.some((i) => i.key === "references")
  const refInputs: InputT[] = !omni ? [] : [
    ...((mp?.videos ?? 0) > 0 ? [{ key: "ref_videos", kind: "video" as const, label: t("Videos"), optional: true, multiple: true }] : []),
    ...((mp?.audios ?? 0) > 0 ? [{ key: "ref_audios", kind: "audio" as const, label: t("Sounds"), optional: true, multiple: true }] : []),
    ...((mp?.named_voices ?? 0) > 0 ? [{ key: "ref_voices", kind: "audio" as const, label: t("Voices"), optional: true, multiple: true }] : []),
  ]
  const slotTool = { ...tool, inputs: [...(first < 0 ? toolInputs : [...toolInputs.slice(0, first + 1), ...modelInputs, ...toolInputs.slice(first + 1)]), ...refInputs] }
  // the words and the prompt, unless the model takes none (Volcengine's lip sync)
  const words = !!tool.template && mp?.prompt !== false
  // Lip sync on a talking head: from the frame of the video at this second
  const lipFrame = tool.id === "lip-sync" && model?.role === "avatar"
  // Aleph 2 on a tool with a keyframe recipe: the keyframe made from this video (kept with its time), sent with it
  const keyframing = kind === "video" && !!tool.keyframe && model?.model === "runway/aleph-2"
  const keyframe = keyframing && value.params.keyframe_video === value.inputs.video?.[0] ? value.inputs.keyframe?.[0] : undefined
  const promptTool = keyframe ? { ...tool, template: tool.keyframe!.apply } : tool

  // the prompt sent: the tool's template filled with its fields and the user's words, or the agent's prompt (a draft)
  // with the user's words after it
  const prompt = value.raw ? [value.rawText, value.intent].filter(Boolean).join(" ").trim() : fill(promptTool, withLooks(tool, value.fields, state.styles ?? []), value.intent, kind, value.inputs)
  // the same, read only, with what is still to fill as {key}, and the @names as the model reads them
  const filled = value.raw ? prompt : fill(promptTool, withLooks(tool, value.fields, state.styles ?? []), value.intent, kind, value.inputs, true)
  const shownPrompt = kind === "audio" ? filled : withMentions(filled, kind, mentionFrom(kind, tool, value.inputs), state)
  // what the words can cite with @name (a voice's text is read as written), and the images those bring
  // the current workspace's Elements first in the @ list
  const ws = currentOf(state)
  // Kling 4.0 cites the Library's voices too (@Narrator)
  const items = kind === "audio" ? [] : [...mentionables(state), ...(mp?.named_voices ? (state.elements ?? []).filter((e) => e.type === "voice" && e.files.length) : [])]
  // (the words' own and an element field's: the prompt holds both)
  // (one image of each on a model that takes its subject's main view alone: Wan 2.2 Animate Replace)
  const mentioned = cited(prompt, items).reduce((n, i) => n + (mp?.element_views === 1 ? 1 : i.files.length), 0)
  // the user writes the whole prompt (Custom, speech), or adds words to the one the tool builds; those are needed on
  // Custom and Custom edit (no prompt of their own), optional beside a tool's
  const whole = ownPrompt(tool), takesWords = tool.template.includes("{prompt}")
  const custom = tool.id === "free" || tool.id === "free-edit"
  const missing = tool.inputs.find((i) => !i.optional && !value.inputs[i.key]?.length)
  // a keyframe carries the change: the Element or photos it was made with are not asked again (the user's own one)
  const unpicked = keyframe ? undefined : tool.fields.find((f) => f.required && !String(value.fields[f.key] ?? f.default ?? "").trim())
  // a References tool: a job a sheet, so no batch; it needs words or photos
  const sheets = tool.fields.find((f) => f.type === "sheets")
  const sheetCount = sheets ? String(value.fields[sheets.key] ?? sheets.default ?? "").split(",").filter((x) => x.trim()).length : 0
  const unsaid = !keyframe && tool.one_of && !tool.one_of.some((k) => value.inputs[k]?.length || value.fields[k]?.trim())
  // the reference images the model takes, and those this sends: the tool's image inputs and a Library style's; an
  // input of several takes what is left (« 2 / 13 »)
  // with a frame, OpenRouter keeps a video's frames and drops its reference images (Seedance on Kie refuses both):
  // none then, unless the model takes both (mix)
  const framed = kind === "video" && model?.role !== "avatar" && !model?.params.mix && ["first_frame", "last_frame", ...(strip ? ["mid_frames"] : [])].some((k) => (value.inputs[k]?.length ?? 0) > 0)
  // a keyframe's images (an Element, a painted frame, references) go to the image that makes it, not to Aleph
  const maxRefs = keyframing ? undefined : framed ? 0 : model?.params.references
  const styleField = tool.fields.find((f) => f.type === "style")
  const styleImages = (styleField && state.styles?.find((s) => s.name === (value.fields[styleField.key] ?? styleField.default))?.files.length) || 0
  // Kling's named elements (Kie) carry the @Elements apart from the reference images
  const usedRefs = imageInputs(kind, tool).reduce((n, i) => n + (value.inputs[i.key]?.length ?? 0), 0) + styleImages + (kind === "video" && model?.params.elements ? 0 : mentioned)
  const overRefs = maxRefs != null ? usedRefs - maxRefs : 0
  const limits = maxRefs == null ? {} : Object.fromEntries(imageInputs(kind, tool).filter((i) => i.multiple).map((i) => [i.key, Math.max(0, (value.inputs[i.key]?.length ?? 0) + maxRefs - usedRefs)]))
  // (each of the others at the model's count; none beside a frame)
  const libraryVoices = cited(prompt, items).filter((i) => i.type === "voice").length
  const slotLimits = { ...limits, ...Object.fromEntries(refInputs.map((i) => [i.key, framed ? 0 : Math.max(0, i.key === "ref_videos" ? mp!.videos! : i.key === "ref_audios" ? mp!.audios! : mp!.named_voices! - libraryVoices)])) }
  // a new video's spoken lines, the lips in sync, on a model with sound
  const speaks = kind === "video" && mode === "create" && model?.role === "generate" && !!mp?.audio && tool.template.includes("{prompt}") && !shots && !draftOf
  const lines = speaks && Array.isArray(value.params.lines) ? (value.params.lines as SpokenLine[]) : []

  // a keyframe and its time go only with Aleph 2 and the video they were made from
  // (a model's own inputs and editors go only with a model that has them)
  const ownInputs = Object.fromEntries(Object.entries(value.inputs).filter(([k]) => k !== "keyframe" && shown(tool.inputs.find((i) => i.key === k)?.when) && (!["mid_frames", "speaker_masks", "ref_videos", "ref_audios", "ref_voices"].includes(k) || [...modelInputs, ...refInputs].some((i) => i.key === k) || (k === "mid_frames" && strip))))
  const ownParams = Object.fromEntries(Object.entries(value.params).filter(([k]) => k !== "keyframe_video" && (k !== "frame" || lipFrame) && (k !== "dialogue" || !!dialogue) && (k !== "shots" || !!shots)
    && (k !== "mid_times" || !!mp?.mid_frames?.timed) && (k !== "draft_of" || !!draftOf) && (k !== "lines" || speaks) && (k !== "voice_names" || refInputs.some((i) => i.key === "ref_voices"))))
  // a model's options only in the mode they go with (Eleven Music's Length in Describe): the others hidden, not sent
  const shownModel = useMemo(
    () => (model?.params.options?.some((o) => o.when) ? { ...model, params: { ...model.params, options: model.params.options.filter((o) => shown(o.when)) } } : model),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, value.fields]
  )
  const hiddenOptions = (model?.params.options ?? []).filter((o) => !shown(o.when)).map((o) => o.key)
  if (hiddenOptions.length && ownParams.options) ownParams.options = Object.fromEntries(Object.entries(ownParams.options as Record<string, unknown>).filter(([k]) => !hiddenOptions.includes(k)))
  // a field of another mode stays here, not sent; ElevenLabs sings in no singer of the Library, takes no Suno split
  const sentFields = Object.fromEntries(
    Object.entries(value.fields).filter(([k]) => {
      const f = tool.fields.find((x) => x.key === k)
      return !f || (shown(f.when) && !(elevenModel && (f.type === "singer" || f.suno)))
    })
  )
  const spec: Spec = useMemo(
    () => ({
      kind,
      tool: tool.id,
      model: modelId,
      prompt: value.raw ? prompt : value.intent,
      ...(value.raw ? { raw: true } : {}),
      fields: sentFields,
      inputs: keyframe ? { ...ownInputs, keyframe: [keyframe] } : ownInputs,
      params: keyframe ? { ...ownParams, frame: value.params.frame } : ownParams,
      ...(value.batch && value.batch > 1 && !eleven && !local && !sheets ? { batch: value.batch } : {}),
      ...(value.place ? { place: value.place } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, tool.id, modelId, value, eleven, elevenModel, local, prompt, sheets, keyframe, lipFrame]
  )

  // the estimate, again after every change (debounced)
  // what is missing, as the button's words until it can run
  const expand = tool.local === "expand", extend = tool.local === "extend"
  const blocker = missing
    ? missing.kind === "mask" || missing.kind === "sketch" ? own(missing.label) : t("Add {what}", { what: own(missing.label).toLowerCase() })
    : unpicked
      ? unpicked.type === "element" ? (unpicked.label === "With" ? t("Pick an element") : t("Pick a {what}", { what: own(unpicked.label).toLowerCase() })) : t("Fill {what}", { what: own(unpicked.label).toLowerCase() })
    : keyframing && tool.keyframe!.required && !keyframe
      ? t("Make the keyframe first")
    : overRefs > 0 && model
      ? usedRefs === styleImages
        ? framed ? t("Frames or your style, not both") : t("Pick a model for your style")
        : framed ? t("Frames or references, not both") : maxRefs === 0 ? t("Pick a model that takes images") : overRefs > 1 ? t("Remove {n} images", { n: overRefs }) : t("Remove {n} image", { n: overRefs })
    : expand && !Object.values(marginsOf(value.fields)).some(Boolean)
      ? t("Set the frame")
    : sheets && !sheetCount
      ? t("Pick a sheet")
    : unsaid
      ? tool.fields.some((f) => f.type === "element" && tool.one_of?.includes(f.key)) ? t("Pick an element or add photos") : t("Describe it or add photos")
      : draftOf
      ? null
      : shots
      ? !shots.some((x) => x.prompt.trim()) ? t("Write the shots") : shotLengths.length && !shotLengths.includes(shotsTotal) ? t("Shots last {total} s: {from} to {to} s", { total: shotsTotal, from: shotLengths[0], to: shotLengths.at(-1)! }) : null
      : dialogue
      ? !dialogue.some((l) => l.text.trim()) ? t("Write the lines") : dialogue.some((l) => l.text.trim() && !l.voice) ? t("Pick each line's voice") : mp?.speakers && dialogueVoices > mp.speakers ? t("{n} voices at most", { n: mp.speakers }) : dialogueChars > (direct ? 2000 : 5000) ? t("Shorten the dialogue") : null
      : cap != null && frameCount > cap
      ? t("{n} frames at most at {s} s", { n: cap, s: seconds })
      : strip && mp?.mid_frames?.timed && (value.inputs.mid_frames?.length ?? 0) > 0 && (value.inputs.mid_frames ?? []).some((_, i) => !(((value.params.mid_times as number[] | undefined)?.[i] ?? 0) > 0))
      ? t("Time each middle frame")
      : !eleven && !local && words && !((whole || custom) && !value.raw ? value.intent.trim() : prompt) && tool.id !== "upscale" && !lines.some((l) => l.text.trim())
      ? kind === "audio" ? (tool.id === "voice" ? t("Write the text") : t("Describe it")) : t("Write a prompt")
      : direct && !value.params.voice
        ? t("Pick a voice")
      : direct && model?.params.max_chars && value.intent.length > model.params.max_chars
        ? t("Shorten the text")
      : tool.id === "translate" && !value.fields.to?.trim()
        ? t("Pick the languages")
      : tool.id === "change-voice" && !value.params.voice
        ? t("Pick the new voice")
      : tool.id === "remix-voice" && !value.params.voice
        ? t("Pick the voice")
      : (tool.id === "design-voice" || tool.id === "remix-voice") && !value.fields.description?.trim()
        ? tool.id === "design-voice" ? t("Describe the voice") : t("Say what changes")
      : tool.id === "create-singer" && !value.fields.voice?.trim()
        ? t("Describe the voice")
      : tool.id === "music"
        ? (value.fields.mode ?? "describe") === "describe"
          ? !value.fields.description?.trim() && !["references", "ref_videos", "ref_audios"].some((k) => value.inputs[k]?.length) ? t("Describe the song") : null
          : !value.fields.title?.trim() && !elevenModel ? t("Give it a title") : !value.fields.style?.trim() && !value.fields.lyrics?.trim() ? t("Give its style or lyrics") : null
        : null
  // (with the spec it answers: the agent's fill and submit wait for the one of what the composer holds)
  const [est, setEst] = useState<{ key?: string; answer?: EstimateAnswer; error?: string }>({})
  const specKey = JSON.stringify(spec)
  useEffect(() => {
    if (blocker) return
    const t = setTimeout(() => {
      api.estimate(spec).then(
        (answer) => setEst({ key: specKey, answer }),
        (e) => setEst({ key: specKey, error: plain(e.message) })
      )
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, blocker])

  // until it can run, the button shows this tool's price on this model and settings, before the inputs and words
  // (not a voice's: it is priced by its text)
  const probeSpec = (model?: string): Spec => ({ kind, tool: tool.id, model, prompt: "", fields: sentFields, inputs: {}, params: value.params, probe: true, ...(spec.batch ? { batch: spec.batch } : {}) })
  const probeKey = JSON.stringify(probeSpec(modelId))
  const [probe, setProbe] = useState<{ key: string; label: string | null }>({ key: "", label: null })
  useEffect(() => {
    if (!blocker || (kind === "audio" && tool.id === "voice")) return
    const t = setTimeout(() => api.estimate(probeSpec(modelId)).then((a) => setProbe({ key: probeKey, label: priceLabel(a) }), () => {}), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey, !!blocker])
  // the model list's prices: each model on these settings, asked when the list opens (a voice's on its text, once written)
  const [modelPrices, setModelPrices] = useState<{ key: string; prices: Record<string, Priced> }>({ key: "", prices: {} })
  function priceModels() {
    const speech = kind === "audio" && tool.id === "voice"
    if (speech && !prompt && !dialogue) return
    // a model's own options stay with it: the others are priced on their defaults
    const listSpec = (model?: string): Spec => ({ ...probeSpec(model), batch: undefined, params: { ...spec.params, options: undefined }, ...(speech ? { prompt } : {}) })
    const key = JSON.stringify(listSpec())
    if (modelPrices.key === key) return
    setModelPrices({ key, prices: {} })
    // only the models that can do what is asked of their own editors (shots, a dialogue, middle frames, a draft's final)
    const can = (m: Model) => (!shots || !!m.params.shots) && (!dialogue || !!m.params.dialogue) && (!value.inputs.mid_frames?.length || !!m.params.mid_frames) && (!draftOf || !!m.params.draft)
    for (const m of fitting.filter(can))
      api.estimate(listSpec(m.id)).then(
        (a) => setModelPrices((p) => (p.key === key ? { key, prices: { ...p.prices, [m.id]: { label: priceLabel(a), amount: a.estimate.amount } } } : p)),
        () => {}
      )
  }

  // prices in the tool list: a probe estimate per tool on its recommended model, once a session
  const listed = tools.filter((t) => t.mode === mode && !t.hidden)
  // (each router its own prices)
  const priceKey = (t: Tool) => `${state.router}:${kind}:${t.id}:${t.models?.[0] ?? ""}`
  const [, setPriced] = useState(0)
  const prices = Object.fromEntries(listed.flatMap((t) => (PRICES.has(priceKey(t)) ? [[t.id, PRICES.get(priceKey(t))!]] : [])))
  function priceTools() {
    for (const t of listed.filter((t) => !PRICES.has(priceKey(t)))) {
      PRICES.set(priceKey(t), "")
      api.estimate({ kind, tool: t.id, prompt: "", fields: {}, inputs: {}, params: {}, probe: true }).then(
        (a) => (PRICES.set(priceKey(t), priceLabel(a)), setPriced((n) => n + 1)),
        () => PRICES.delete(priceKey(t))
      )
    }
  }

  // Generate: the click is the yes, unless a threshold, the cap or an unknown price asks again
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<{ needs: string; shown: string } | null>(null)
  // (what it did, for the agent's submit)
  async function go(confirm = false): Promise<Submitted> {
    setBusy(true)
    try {
      const r = await api.generate(spec, confirm)
      setAsk(null)
      // one result takes the place on the timeline: the next generation is a plain one
      if (value.place) onChange({ ...value, place: undefined })
      toast.success(sheetCount > 1 ? t("{n} sheets started", { n: sheetCount }) : spec.batch ? t("{n} × {tool} started", { n: spec.batch, tool: own(tool.label) }) : t("{tool} started", { tool: own(tool.label) }), {
        description: sheetCount > 1 ? t("The first sets the look, the others follow it. They keep running if you close this page.") : t("It keeps running if you close this page."),
      })
      return { started: r.ids }
    } catch (e) {
      const err = e as Error & { status?: number; body?: { needs: string; shown: string } }
      if (err.status === 409 && err.body) return setAsk(err.body), { asks: err.body.needs }
      toast.error(plain(err.message))
      return { error: plain(err.message) }
    } finally {
      setBusy(false)
    }
  }

  // Copy prompt: the agent writes the prompt that suits this model into the composer; nothing is generated
  // the composer emptied, the tool, its model and the count kept; undone from the toast
  function clear() {
    const before = value
    onChange({ ...blank(kind, tool.id), model: value.model, batch: value.batch })
    toast(t("Composer cleared"), { action: { label: t("Undo"), onClick: () => onChange(before) } })
  }
  function copyPrompt() {
    const files = Object.entries(value.inputs).filter(([, f]) => f.length).map(([k, f]) => `${k}: ${f.join(", ")}`)
    const fields = tool.fields.map((f) => `${f.key} = ${value.fields[f.key] ?? f.default ?? ""}`)
    const text = [
      "/skill-video:media-generator Write the best prompt for this generation. Do not generate anything.",
      `Space: ${kind} (${mode}). Tool: ${tool.label} (${tool.id}). Model: ${modelId ?? "the tool's default"}${model ? ` (${model.name})` : ""}.`,
      fields.length ? `Fields: ${fields.join("; ")}.` : "",
      files.length ? `Inputs: ${files.join("; ")}.` : "",
      `What I want: ${prompt || "(nothing written yet, infer it from the tool and the inputs)"}`,
      "",
      "Write the prompt this model handles best (its syntax, strengths and ideal length), then put it in the dashboard's composer with (the tool's fields as --field, the words it adds as --prompt; --raw only to replace the tool's own prompt):",
      `node "${engine}/media.mjs" draft --space ${kind} --tool ${tool.id}${modelId ? ` --model ${modelId}` : ""} [--field <key>="<value>"]… --prompt "<the words>"`,
      "I will read it and click Generate myself.",
    ].filter((l) => l !== "").join("\n")
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("Prompt copied"), { description: t("Paste it in your agent: it writes the prompt here, without generating.") }),
      () => toast.error(t("The clipboard refused the copy"))
    )
  }

  // the agent fills this composer (media.mjs draft, within the hour): the tool, model, fields, files and settings at
  // once, its words and text fields typed in as the user watches; undone from the toast. Its words are the ones the
  // tool adds to its prompt, or (raw) the whole prompt in place of the tool's, shown read only
  const draft = state.drafts[kind]
  const [typing, setTyping] = useState(false)
  // the last fill typed in, and the last one the agent heard of
  const [told, setTold] = useState<string | null>(null)
  const heard = useRef<string | null>(null)
  useEffect(() => {
    const d = draft
    if (!d?.at || d.at <= draftSeen || Date.now() - Date.parse(d.at) > 36e5) return
    const when = d.at
    onDraftSeen(when)
    const before = value, dt = tools.find((x) => x.id === d.tool) ?? tool, same = dt.id === value.tool
    // the files the composer holds stay, in the inputs the tool has
    const kept = Object.fromEntries(Object.entries(value.inputs).filter(([k]) => same || dt.inputs.some((i) => i.key === k)))
    const raw = !!d.raw && !ownPrompt(dt), words = d.prompt ?? ""
    const base: Compose = {
      ...blank(kind, dt.id),
      model: d.model ?? (same ? value.model : undefined),
      fields: { ...(same ? value.fields : {}), ...d.fields },
      inputs: { ...kept, ...d.inputs },
      params: { ...(same ? value.params : {}), ...d.params },
      batch: d.batch ?? value.batch,
      place: value.place,
      raw,
    }
    const texts = Object.keys(d.fields ?? {}).filter((k) => dt.fields.find((f) => f.key === k)?.type === "text")
    const typed = (n: number) => {
      const part = (x: string) => x.slice(0, Math.ceil((x.length * n) / TYPED))
      return { ...base, fields: { ...base.fields, ...Object.fromEntries(texts.map((k) => [k, part(base.fields[k])])) }, ...(raw ? { rawText: part(words) } : { intent: part(words) }) }
    }
    let n = 0
    const timer = setInterval(() => {
      onChange(typed(++n))
      if (n === 1) setTyping(true)
      if (n < TYPED) return
      clearInterval(timer)
      setTyping(false)
      setTold(when)
    }, 30)
    toast(t("The agent filled the composer"), { description: own(dt.label), action: { label: t("Undo"), onClick: () => onChange(before) } })
    // the page left before the end: all of it, at once
    return () => {
      if (n >= TYPED) return
      clearInterval(timer)
      onChange(typed(TYPED))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.at])

  // the agent submits this composer (media.mjs submit, once the user said yes to its price): one page takes it, then
  // clicks Generate on what the composer holds, within that price
  const sub = draft?.submit
  const [submitting, setSubmitting] = useState<NonNullable<Draft["submit"]> | null>(null)
  const submitted = useRef<string | null>(null)
  useEffect(() => {
    if (!sub || sub.claimed || Date.now() - Date.parse(sub.at) > 6e4) return
    api.draft({ space: kind, at: sub.at, claim: true }).then(() => setSubmitting(sub), () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub?.at])

  const label = keyframe ? t("Apply to the shot") : tool.id === "change-voice" ? t("Change voice") : tool.id === "translate" ? t("Translate") : local ? own(tool.label) : t("Generate")
  const a = blocker ? undefined : est.answer
  const price = a ? priceLabel(a) : blocker && probe.key === probeKey ? probe.label : null
  // (the agent hears the price in priceLabel's words; the button shows it in the dashboard's)
  const priceShown = price && t(price)
  const ready = !busy && !!a && (eleven || elevenModel ? state.keys.elevenlabs : local || state.keys[state.router])

  // what the agent hears back, once the words are typed in and the composer priced (or held back by what it misses),
  // the models of the space there
  const settled = !typing && (local || eleven || models.length > 0) && (!!blocker || (est.key === specKey && !!(est.answer || est.error)))
  useEffect(() => {
    if (!told || heard.current === told || !settled) return
    heard.current = told
    const f = blocker ? { blocker, price } : est.error ? { error: est.error } : { price: priceLabel(est.answer!), amount: est.answer!.estimate.amount, known: est.answer!.estimate.known }
    api.draft({ space: kind, at: told, filled: f }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [told, settled])
  useEffect(() => {
    // (after the fill's answer, when one is due)
    if (!submitting || submitted.current === submitting.at || (told && heard.current !== told) || busy || !settled) return
    const s = submitting
    submitted.current = s.at
    const answer = (done: Submitted) => void api.draft({ space: kind, at: s.at, submitted: done }).catch(() => {})
    if (blocker) return answer({ blocker })
    if (est.error) return answer({ error: est.error })
    const e = est.answer!.estimate, shown = priceLabel(est.answer!)
    // more than the user said yes to, or an unknown price without their yes to that
    if (e.known ? !(e.amount != null && e.amount <= (s.spend ?? -1) * 1.001 + 1e-9) : !s.unknown) return answer({ over: shown })
    if (!ready) return answer({ error: `no key for ${eleven || elevenModel ? "ElevenLabs" : ROUTER_NAME[state.router]} on this dashboard` })
    // (Generate's click, a moment after this render)
    Promise.resolve().then(() => go()).then((r) => answer({ ...r, price: shown }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, told, busy, settled])

  // a file pasted or dropped anywhere on the composer goes to the first input that takes it
  async function take(files: File[]) {
    let inputs = value.inputs
    for (const f of files) {
      const slot = slotFor(tool, inputs, f.name, limits)
      if (!slot) continue
      try {
        const path = await upload(f)
        inputs = { ...inputs, [slot.key]: slot.multiple ? [...(inputs[slot.key] ?? []), path] : [path] }
      } catch (e) {
        toast.error(plain((e as Error).message))
      }
    }
    if (inputs !== value.inputs) set({ inputs })
    else if (files.length) toast.error(t("{tool} takes no such file here", { tool: own(tool.label) }))
  }

  return (
    <aside
      className="flex min-h-0 flex-col border-r bg-background"
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || !ready) return
        e.preventDefault()
        go()
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files]
        if (!files.length || !tool.inputs.length) return
        e.preventDefault()
        take(files)
      }}
      onDragOver={(e) => tool.inputs.length && e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        take([...e.dataTransfer.files])
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4">
        {value.place && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
            <ListVideoIcon className="size-4 shrink-0 text-space" aria-hidden />
            <span className="flex-1">
              {t("{place} on the timeline of {workspace}.", {
                place: placeText(value.place, kind, tool.id === "extend" && value.fields.direction === "prequel"),
                workspace: state.workspaces.find((w) => w.slug === value.place!.workspace)?.name ?? t("its workspace"),
              })}
            </span>
            <Button size="icon-xs" variant="ghost" aria-label={t("Do not lay the result on the timeline")} title={t("Do not lay it on the timeline")} onClick={() => set({ place: undefined })}>
              <XIcon />
            </Button>
          </div>
        )}

        <Chips
          className="grid grid-cols-2"
          options={["create", "edit"] as const}
          value={mode}
          label={(m) => (m === "create" ? t("Create") : t("Edit"))}
          icon={(m) => (m === "create" ? <SparklesIcon /> : <PencilLineIcon />)}
          onChange={(m) => onChange({ ...blank(kind, firstOf(kind, m, tools)), batch: value.batch, ...(kind === "audio" && value.inputs.clip ? { inputs: { clip: value.inputs.clip } } : {}) })}
        />
        <ToolPicker
          tools={listed}
          value={tool}
          models={models}
          prices={prices}
          onOpen={priceTools}
          // the files a tool takes too stay (a clip from one sound tool to the next)
          onPick={(t) => onChange({ ...blank(kind, t.id), batch: value.batch, inputs: Object.fromEntries(Object.entries(value.inputs).filter(([k]) => t.inputs.some((i) => i.key === k))) })}
        />

        {!words && <InputSlots tool={slotTool} value={value.inputs} onChange={(inputs) => set({ inputs })} home={state.home} media={state.media} limits={limits} none={framed ? t("Not with a frame") : undefined} fields={value.fields} onField={(k, v) => set({ fields: { ...value.fields, [k]: v }, raw: false })} />}

        {tool.presets && <Setups tool={tool} fields={value.fields} onPick={(fields) => set({ fields: { ...value.fields, ...fields }, raw: false })} />}

        {/* the fields, those of one section under its heading (selects as tiles, two a row); Expand's margins and
            Extend's direction and join have their own panels below */}
        {sections(tool.fields.filter((f) => shown(f.when) && f.type !== "margin" && !(extend && ["direction", "join"].includes(f.key)) && !(((direct && !mp?.tags) || waiting) && f.key === "instructions") && !(elevenModel && (f.type === "singer" || f.suno)))).map(({ section, fields }, i) =>
          section ? (
            <div key={section}>
              <Label>{own(section)}</Label>
              <div className="grid grid-cols-2 gap-2">
                {fields.map((f) =>
                  f.type === "select" ? (
                    <FieldInput key={f.key} field={f} value={value.fields[f.key]} tile onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
                  ) : (
                    <div key={f.key} className="col-span-2 mt-2">
                      <FieldInput field={f} value={value.fields[f.key]} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            fields.map((f) =>
              tool.id === "translate" && f.key === "to" ? (
                <div key={f.key}>
                  <Label>{own(f.label)}</Label>
                  <Input value={value.fields.to ?? ""} placeholder={own(f.placeholder)} onChange={(e) => set({ fields: { ...value.fields, to: e.target.value } })} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COMMON_LANGS.map((l) => {
                      const list = (value.fields.to ?? "").split(/[,\s]+/).filter(Boolean), on = list.includes(l)
                      return (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set({ fields: { ...value.fields, to: (on ? list.filter((x) => x !== l) : [...list, l]).join(", ") } })}
                          className={cn(CHIP, "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs", on ? CHIP_ON : CHIP_OFF)}
                        >
                          <LanguagesIcon className="size-3.5" />
                          {l}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : tool.id === "translate" && f.key === "quality" ? (
                <DubModels key={f.key} spec={spec} value={value.fields.quality ?? "dubbing_v1"} ready={!missing && !!value.fields.to} onChange={(q) => set({ fields: { ...value.fields, quality: q } })} />
              ) : f.type === "singer" ? (
                <SingerField key={f.key} field={f} value={value.fields[f.key]} elements={state.elements ?? []} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v } })} />
              ) : f.type === "lines" ? (
                // a song's words: Suno writes the lyrics from a theme (Kie)
                <SongText
                  key={f.key}
                  field={f}
                  value={value.fields[f.key] ?? ""}
                  onChange={(v) => set({ fields: { ...value.fields, [f.key]: v } })}
                  help={state.router === "kie" && tool.id === "music" && f.key === "lyrics"}
                  theme={[value.fields.title, value.fields.style].filter(Boolean).join(", ")}
                  onTitle={(title) => !value.fields.title?.trim() && set({ fields: { ...value.fields, [f.key]: value.fields[f.key] ?? "", title } })}
                />
              ) : f.type === "style" ? (
                <StyleField key={f.key} field={f} value={value.fields[f.key]} kind={kind} styles={state.styles ?? []} media={state.media} home={state.home} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
              ) : f.type === "light" ? (
                <LightRig key={`${f.key}-${i}`} field={f} fields={value.fields} video={kind === "video"} onChange={(patch) => set({ fields: { ...value.fields, ...patch }, raw: false })} />
              ) : f.type === "camera" ? (
                <CameraRig key={f.key} field={f} fields={value.fields} onChange={(patch) => set({ fields: { ...value.fields, ...patch }, raw: false })} />
              ) : f.type === "recolors" ? (
                <Recolors key={f.key} field={f} fields={value.fields} onChange={(patch) => set({ fields: { ...value.fields, ...patch }, raw: false })} />
              ) : f.type === "element" ? (
                <ElementField key={f.key} field={f} value={value.fields[f.key]} items={items} views={mp?.element_views} blocked={maxRefs === 0 ? (framed ? t("not with a frame") : t("not on this model")) : undefined} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
              ) : (
                <FieldInput key={f.key} field={f} value={value.fields[f.key]} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
              )
            )
          )
        )}

        {tool.id === "change-voice" && (
          <VoicePicker enabled={state.keys.elevenlabs} value={value.params.voice as string | undefined} onChange={(voice) => set({ params: { ...value.params, voice } })} library={state.elements ?? []} />
        )}
        {tool.id === "remix-voice" && (
          <VoicePicker enabled={state.keys.elevenlabs} label={t("Voice to remix")} placeholder={t("Pick the voice")} value={value.params.voice as string | undefined} onChange={(voice) => set({ params: { ...value.params, voice } })} library={state.elements ?? []} />
        )}
        {tool.id === "voice" && !noClone && (
          <LibraryVoices
            voices={(state.elements ?? []).filter((e) => e.type === "voice" && e.files.length)}
            value={String(value.params.voice ?? "").startsWith("@") ? String(value.params.voice).slice(1) : null}
            onChange={(name) => {
              const { voice_clips, ...inputs } = value.inputs
              set(name ? { params: { ...value.params, voice: `@${name}` }, inputs } : { params: { ...value.params, voice: undefined }, inputs: { ...inputs, ...(voice_clips ? { voice_clips } : {}) } })
            }}
          />
        )}
        {tool.id === "voice" && mp?.dialogue && (
          <Chips
            className="grid grid-cols-2"
            options={["one", "dialogue"] as const}
            value={dialogue ? "dialogue" : "one"}
            label={(m) => (m === "one" ? t("One voice") : t("Dialogue"))}
            icon={(m) => (m === "one" ? <MicIcon /> : <MessagesSquareIcon />)}
            onChange={(m) => {
              const { dialogue: _, ...rest } = value.params
              set({ params: m === "one" ? rest : { ...rest, dialogue: [{ voice: String(value.params.voice ?? ""), text: value.intent }, { voice: "", text: "" }] } })
            }}
          />
        )}
        {tool.id === "voice" && direct && !dialogue && (
          <VoicePicker enabled={state.keys.elevenlabs} label={t("Voice")} placeholder={t("Pick a voice")} value={value.params.voice as string | undefined} onChange={(voice) => set({ params: { ...value.params, voice } })} library={state.elements ?? []} />
        )}
        {dialogue && (
          <DialogueEditor
            lines={dialogue}
            onChange={(lines) => set({ params: { ...value.params, dialogue: lines } })}
            max={direct ? 2000 : 5000}
            speakers={mp?.speakers}
            tags={!!mp?.tags}
            picker={(voice, onVoice, label) =>
              direct ? (
                <VoicePicker enabled={state.keys.elevenlabs} value={voice || undefined} onChange={onVoice} library={state.elements ?? []} label={label} placeholder={t("Pick its voice")} hint="" />
              ) : (
                <ModelVoices model={model!.model} voices={mp?.voices ?? []} info={mp?.voice_info} value={voice} onChange={onVoice} label={label} placeholder={t("Pick its voice")} />
              )
            }
          />
        )}
        {tool.id === "free" && mp?.shots && !draftOf && (
          <Chips
            className="grid grid-cols-2"
            options={["one", "shots"] as const}
            value={shots ? "shots" : "one"}
            label={(m) => (m === "one" ? t("One prompt") : t("Shots"))}
            icon={(m) => (m === "one" ? <TypeIcon /> : <FilmIcon />)}
            onChange={(m) => {
              const { shots: _, ...rest } = value.params
              set({ params: m === "one" ? rest : { ...rest, shots: [{ prompt: value.intent, duration: 3 }, { prompt: "", duration: 3 }] } })
            }}
          />
        )}
        {shots && mp?.shots && <ShotsEditor shots={shots} onChange={(s) => set({ params: { ...value.params, shots: s } })} max={mp.shots.max} each={mp.shots.each} lengths={shotLengths} />}
        {/* with shots, the tool's files stay: its frames and references */}
        {shots && slotTool.inputs.length > 0 && (
          <InputSlots tool={slotTool} value={value.inputs} onChange={(inputs) => set({ inputs })} home={state.home} media={state.media} limits={slotLimits} none={framed ? t("Not with a frame") : undefined} fields={value.fields} onField={(k, v) => set({ fields: { ...value.fields, [k]: v }, raw: false })} />
        )}
        {draftOf && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
            <span className="flex-1">{t("The final of the draft {draft}, in 1080p: no prompt, it is the draft's. Kie lists no price for it.", { draft: draftOf })}</span>
            <Button size="icon-xs" variant="ghost" aria-label={t("Not from the draft")} title={t("Not from the draft")} onClick={() => { const { draft_of: _, ...rest } = value.params; set({ params: rest }) }}>
              <XIcon />
            </Button>
          </div>
        )}

        {strip && !draftOf && (
          <KeyframeStrip
            inputs={value.inputs}
            times={(value.params.mid_times as (number | undefined)[] | undefined) ?? []}
            mf={mp!.mid_frames!}
            cite={mp?.cite}
            seconds={seconds}
            media={state.media}
            home={state.home}
            onChange={(inputs, times) => set({ inputs, ...(mp?.mid_frames?.timed ? { params: { ...value.params, mid_times: times } } : {}) })}
            onCite={(tag) => set({ intent: `${value.intent.trimEnd()}${value.intent.trim() ? " " : ""}${tag} ` })}
          />
        )}

        {words && (
          <div className="flex flex-col gap-3">
            {/* the prompt the tool builds, read only: what goes to the model */}
            {!whole && (
              <div>
                <Label hint={value.raw ? t("written by the agent") : t("built by the tool, with your words")}>{t("Prompt")}</Label>
                <div className="relative">
                  <Textarea
                    readOnly
                    value={keyframe && est.answer?.prompt ? est.answer.prompt : shownPrompt}
                    aria-label={t("Prompt sent to the model")}
                    className="max-h-[calc(6lh+1rem)] min-h-16 resize-none border-dashed bg-muted/40 py-2 pr-10 pl-3 text-sm leading-relaxed text-foreground/80 focus-visible:ring-0 md:text-sm dark:bg-muted/30"
                  />
                  <CopyText text={keyframe && est.answer?.prompt ? est.answer.prompt : shownPrompt} what={t("Prompt")} />
                </div>
                {value.raw && (
                  <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => set({ raw: false })}>
                    {t("Back to the tool's prompt")}
                  </button>
                )}
              </div>
            )}
            {/* the user's own words, with the tool's files */}
            {(takesWords || slotTool.inputs.length > 0) && !dialogue && !shots && !draftOf && (
              <div>
                <Label hint={direct && model?.params.max_chars ? t("{n} / {max} characters", { n: value.intent.length.toLocaleString(locale()), max: model.params.max_chars.toLocaleString(locale()) }) : whole ? undefined : custom ? t("added to the tool's prompt") : t("optional, added to the tool's prompt")}>{kind === "audio" ? (tool.id === "voice" ? t("Text to speak") : t("What it sounds like")) : whole ? t("Prompt") : t("Your words")}</Label>
                <InputGroup className="h-auto flex-col rounded-xl bg-input/20 has-[[data-slot=input-group-control]:focus-visible]:border-space/60 has-[[data-slot=input-group-control]:focus-visible]:ring-space/20">
                  {takesWords && kind === "audio" && (
                    <InputGroupTextarea
                      value={value.intent}
                      aria-label={tool.id === "voice" ? t("Text to speak") : t("What it sounds like")}
                      placeholder={tool.id === "voice" ? t("What the voice says") : t("rain on a tin roof, distant thunder")}
                      className={cn("max-h-[calc(6lh+1.25rem)] py-2.5 pr-10 pl-3 text-[15px] leading-relaxed md:text-[15px]", whole ? "min-h-28" : "min-h-16")}
                      onChange={(e) => set({ intent: e.target.value })}
                    />
                  )}
                  {takesWords && <CopyText text={value.intent} what={kind === "audio" ? t("Text") : t("Prompt")} />}
                  {takesWords && kind !== "audio" && (
                    <MentionTextarea
                      value={value.intent}
                      items={items}
                      first={ws?.linked}
                      firstLabel={ws?.name}
                      blocked={maxRefs === 0 ? (framed ? t("Not with a frame: with a first or last frame, the model takes no reference image.") : t("{model} takes no reference image: pick another model to cite one.", { model: model?.name ?? t("This model") })) : undefined}
                      aria-label={whole ? t("Prompt") : t("Your words")}
                      placeholder={t("{text} Type @ to cite an element.", { text: whole ? own(tool.description) : custom ? t("What to change.") : t("Anything to add: details, style, what must not change.") })}
                      className={cn("max-h-[calc(6lh+1.25rem)] py-2.5 pr-10 pl-3 text-[15px] leading-relaxed md:text-[15px]", whole ? "min-h-28" : "min-h-16")}
                      onChange={(intent) => set({ intent })}
                    />
                  )}
                  {slotTool.inputs.length > 0 && (
                    <InputGroupAddon align="block-end" className={cn("px-3 pt-3 pb-3 font-normal", takesWords && "border-t")}>
                      <InputSlots tool={slotTool} value={value.inputs} onChange={(inputs) => set({ inputs })} home={state.home} media={state.media} label={false} limits={slotLimits} none={framed ? t("Not with a frame") : undefined} fields={value.fields} onField={(k, v) => set({ fields: { ...value.fields, [k]: v }, raw: false })} />
                    </InputGroupAddon>
                  )}
                </InputGroup>
                {kind === "audio" && model?.params.tags && !dialogue && (
                  <div className="mt-2">
                    <AudioTags onAdd={(t) => set({ intent: `${value.intent.trimEnd()}${value.intent.trim() ? " " : ""}${t} ` })} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {speaks && (
          <LinesEditor
            lines={lines}
            onChange={(l) => set({ params: { ...value.params, lines: l.length ? l : undefined } })}
            characters={mentionables(state).filter((i) => i.type === "character")}
            voices={mp?.named_voices ? [...(state.elements ?? []).filter((e) => e.type === "voice" && e.files.length).map((e) => `@${e.name}`), ...(value.inputs.ref_voices ?? []).map((f, i) => `@${voiceName(f, (value.params.voice_names as string[] | undefined)?.[i])}`)] : null}
          />
        )}
        {omni && model && (
          <OmniRefs
            mp={model.params}
            inputs={ownInputs}
            voiceNames={(value.params.voice_names as string[] | undefined) ?? []}
            intent={value.intent}
            items={items}
            onIntent={(intent) => set({ intent })}
            onVoiceNames={(voice_names) => set({ params: { ...value.params, voice_names } })}
          />
        )}

        {expand && <ExpandPreview image={value.inputs.image?.[0]} fields={value.fields} onChange={(patch) => set({ fields: { ...value.fields, ...patch } })} />}
        {extend && (
          <ExtendPanel
            video={value.inputs.video?.[0]}
            fields={value.fields}
            join={tool.fields.find((f) => f.key === "join")}
            durations={model?.params.duration ?? []}
            duration={value.params.duration as number | undefined}
            onFields={(patch) => set({ fields: { ...value.fields, ...patch } })}
            onDuration={(duration) => set({ params: { ...value.params, duration } })}
          />
        )}

        {model && shownModel && (
          <ModelBlock
            kind={kind}
            why={tool.why ?? {}}
            recommended={recommended}
            others={others}
            model={shownModel}
            params={value.params}
            onModel={(id) => {
              // a model's options are its own
              const { options: _, ...params } = value.params
              set({ model: id, params })
            }}
            onParams={(params) => set({ params })}
            prices={modelPrices.prices}
            onOpenModels={priceModels}
            // the image a result can take its ratio from: any for an image, a first or last frame (an avatar's photo) for a video
            hasImageInput={kind === "video" ? ["first_frame", "last_frame"].some((k) => (value.inputs[k]?.length ?? 0) > 0) : tool.inputs.some((i) => i.kind === "image" && (value.inputs[i.key]?.length ?? 0) > 0)}
            hasVideoInput={tool.inputs.some((i) => i.kind === "video") && !extend}
            // settings a tool's own panel sets: Extend's length and ratio (its source's), Expand's ratio (its frame's)
            own={[...(extend ? ["duration", "aspect_ratio"] : expand || sheets ? ["aspect_ratio"] : []), ...(shots ? ["duration"] : []), ...(dialogue ? ["voice"] : [])]}
            cloning={(value.inputs.voice_clips?.length ?? 0) > 0 || String(value.params.voice ?? "").startsWith("@")}
          />
        )}

        {keyframing && (
          <KeyframePanel
            key={`${tool.id}:${value.inputs.video?.[0] ?? ""}`}
            tool={tool}
            spec={spec}
            video={value.inputs.video?.[0]}
            keyframe={keyframe}
            at={value.params.frame as number | undefined}
            state={state}
            onModel={(id) => set({ params: { ...value.params, keyframe_model: id } })}
            onSet={(k) =>
              set(k ? { inputs: { ...value.inputs, keyframe: [k.path] }, params: { ...value.params, frame: k.at, keyframe_video: value.inputs.video?.[0] } } : { inputs: ownInputs, params: ownParams })
            }
          />
        )}

        {lipFrame && (
          <div>
            <Label hint={t("the talking head starts from it: 0 is the first frame")}>{t("From the frame at")}</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} step={0.1} className="w-24" value={(value.params.frame as number | undefined) ?? 0} onChange={(e) => set({ params: { ...value.params, frame: Math.max(0, Number(e.target.value) || 0) } })} aria-label={t("Second of the video's frame")} />
              <span className="text-sm text-muted-foreground">{t("s into the video")}</span>
            </div>
          </div>
        )}

        {!blocker && est.error && (
          <Alert variant="destructive">
            <AlertDescription>{est.error}</AlertDescription>
          </Alert>
        )}
        {tool.id === "change-voice" && (
          <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            {t("Keeps the delivery: pauses, emotion and rhythm stay, only the timbre changes. Up to 5 min goes in one call; a longer clip is sent in pieces.")}
          </p>
        )}
        {(tool.id === "design-voice" || tool.id === "remix-voice") && (
          <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            {t("Three previews come back: open the one you like and « {keep} » makes it a voice of your ElevenLabs account and of the Library, for {voice}, {change} and the others. Keeping it is free.", { keep: t("Keep this voice"), voice: own("Voice"), change: own("Change voice") })}
          </p>
        )}
        {tool.id === "transcribe" && (
          <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            {t("The text, its captions (SRT) and each word's time. Given its text, the words are not guessed: they are timed exactly as written.")}
          </p>
        )}
        {tool.id === "isolate-voice" && (
          <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            {t("The voice alone: music, noise and room taken out. A video comes back with only its voice, a sound as an MP3. ElevenLabs' Voice Isolator, whichever router.")}
          </p>
        )}
        {tool.id === "translate" && (
          <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            {t("No lip-sync: the voices are dubbed in their own timbre, the lips keep the original language. Subtitles come with each language.")}
          </p>
        )}
        {(eleven || elevenModel) && !state.keys.elevenlabs && (
          <p className="rounded-lg border p-3 text-xs text-destructive">{t("No ElevenLabs key: set it with /plugin configure skill-video@pabrisson or ELEVENLABS_API_KEY, then restart your agent.")}</p>
        )}
        {!eleven && !elevenModel && !local && !state.keys[state.router] && (
          <p className="rounded-lg border p-3 text-xs text-destructive">{t("No {router} key: prices show, nothing can be generated. Set it with /plugin configure skill-video@pabrisson, or pick the other router in Settings.", { router: ROUTER_NAME[state.router] })}</p>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex gap-2">
          {/* the prompt for the agent and the composer cleared, in one menu where the copy button was */}
          {!eleven && !local && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" className="size-11" aria-label={t("Prompt and composer")}>
                  <EllipsisVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-72">
                <DropdownMenuItem onSelect={copyPrompt} className="items-start">
                  <CopyIcon className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{t("Copy prompt")}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("A request for the agent with this tool, {model} and your inputs: paste it in your agent, the agent writes the prompt this model handles best here. Nothing is generated, nothing is spent.", { model: model ? model.name : t("the model") })}
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={clear} className="items-start">
                  <EraserIcon className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{t("Clear")}</span>
                    <span className="text-xs text-muted-foreground">{t("Empties the words, files and settings; keeps the tool and the model.")}</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!eleven && !local && !sheets && <Batch value={value.batch ?? 1} onChange={(batch) => set({ batch })} />}
          {/* the whole name on hover, the button cut short beside its price (a disabled one hovers through its span) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 flex-1">
                <Button variant="space" className={cn("h-11 w-full min-w-0 px-4 text-[15px]", blocker && !price ? "justify-center" : "justify-between")} disabled={!ready} onClick={() => go()}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{blocker ?? label}</span>
                    {/* the shortcut gives way to a long price (« ≈ 49 credits »): the tooltip still says it */}
                    {!blocker && (priceShown?.length ?? 0) < 8 && <Kbd className="shrink-0 bg-space-foreground/15 px-1.5 text-space-foreground/80">⌘↵</Kbd>}
                  </span>
                  {priceShown && <Price className="bg-space-foreground/15 text-space-foreground">{priceShown}</Price>}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {blocker ?? label}
              {priceShown ? ` · ${priceShown}` : ""}
              {!blocker && ready ? " · ⌘↵" : ""}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          <DialogTitle>{ask?.needs === "cap" ? t("Over this month's cap") : ask?.needs === "unknown" ? t("Unknown cost") : t("Over your confirmation threshold")}</DialogTitle>
          <DialogDescription>
            {ask?.needs === "unknown"
              ? t("This model lists no price for these settings: the actual cost shows in Credits once it is done.")
              : ask?.needs === "cap"
                ? t("This would take this month's spend over the cap you set in Settings: {price}.", { price: ask?.shown ?? "" })
                : t("This costs {price}, above the threshold you set in Settings.", { price: ask?.shown ?? "" })}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAsk(null)}>{t("Cancel")}</Button>
            <Button disabled={busy} onClick={() => go(true)}>{t("{label} anyway", { label })}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

// how many times to run it: 1 to 4 jobs, each its own result and cost; the button shows the total
function Batch({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex h-11 items-center rounded-md border bg-background dark:border-input dark:bg-input/30" role="group" aria-label={t("Batch: how many to generate")}>
      <button type="button" aria-label={t("One less")} disabled={value <= 1} onClick={() => onChange(value - 1)} className="grid h-full w-7 place-items-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        <MinusIcon className="size-3.5" />
      </button>
      <span className="w-9 text-center text-sm font-medium tabular-nums" aria-live="polite" title={t("Batch: how many to generate")}>
        {value}/4
      </span>
      <button type="button" aria-label={t("One more")} disabled={value >= 4} onClick={() => onChange(value + 1)} className="grid h-full w-7 place-items-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  )
}

// a quality's words (the value sent stays the model's own)
const QUALITY: Record<string, string> = { auto: t("auto"), low: t("low"), medium: t("medium"), high: t("high"), xhigh: t("xhigh"), max: t("max") }

// the model and the settings it accepts: only what this model lists
function ModelBlock({
  kind,
  recommended,
  others,
  model,
  params,
  onModel,
  onParams,
  hasImageInput,
  hasVideoInput,
  cloning,
  prices,
  onOpenModels,
  own = [],
  why,
}: {
  kind: Kind
  recommended: Model[]
  others: Model[]
  model: Model
  params: Record<string, unknown>
  onModel: (id: string) => void
  onParams: (p: Record<string, unknown>) => void
  hasImageInput: boolean
  hasVideoInput: boolean
  cloning: boolean
  prices: Record<string, Priced>
  onOpenModels: () => void
  own?: string[]
  why: Record<string, string>
}) {
  const p = model.params, put = (k: string, v: unknown) => onParams({ ...params, [k]: v })
  // the model's options shown from the start: closed only by hand
  const [moreOpen, setMoreOpen] = useState(true)
  const caps = capsOf(model)
  const durations = own.includes("duration") ? [] : (p.duration ?? [])
  const edit = kind === "video" && hasVideoInput

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>{t("Model")}</Label>
        <ModelPicker kind={kind} recommended={recommended} others={others} value={model.id} onChange={(id) => id && onModel(id)} prices={prices} onOpen={onOpenModels} why={why} />
        {caps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {caps.map((c) => <Badge key={c} variant="outline" className="font-normal text-muted-foreground">{c}</Badge>)}
          </div>
        )}
      </div>

      {kind === "video" && !edit && durations.length > 0 && (
        <div>
          <Label>{t("Duration")}</Label>
          {durations.length > 6 ? (
            <div className="flex items-center gap-3">
              <Slider min={durations[0]} max={durations.at(-1)} step={1} value={[pick(durations, params.duration as number, 5)!]} onValueChange={([d]) => put("duration", d)} aria-label={t("Duration")} />
              <span className="w-10 text-right text-sm tabular-nums">{pick(durations, params.duration as number, 5)} s</span>
            </div>
          ) : (
            <Chips options={durations} value={pick(durations, params.duration as number, 5)} label={(d) => `${d} s`} icon={() => <TimerIcon />} onChange={(d) => put("duration", d)} />
          )}
        </div>
      )}
      {!edit && !own.includes("aspect_ratio") && p.aspect_ratio?.length ? (
        <div>
          <Label>{t("Ratio")}</Label>
          {hasImageInput ? (
            <Chips
              options={["same", ...p.aspect_ratio]}
              value={(params.aspect_ratio as string) ?? "same"}
              label={(r) => (r === "same" ? t("Same as the image") : r)}
              icon={valueIcon}
              onChange={(r) => put("aspect_ratio", r === "same" ? undefined : r)}
            />
          ) : (
            <Chips options={p.aspect_ratio} value={pick(p.aspect_ratio, params.aspect_ratio as string, kind === "video" ? "16:9" : "1:1")} icon={valueIcon} onChange={(r) => put("aspect_ratio", r)} />
          )}
        </div>
      ) : null}
      {(params.options as Record<string, unknown> | undefined)?.draft ? (
        <div>
          <Label>{t("Resolution")}</Label>
          <p className="text-sm text-muted-foreground">{t("480p: a draft, its 1080p final made from it later")}</p>
        </div>
      ) : p.resolution?.length && model.role !== "upscale" ? (
        <div>
          <Label>{t("Resolution")}</Label>
          <Chips options={p.resolution} value={pick(p.resolution, params.resolution as string, kind === "image" ? "2K" : "1080p", kind === "image" ? "1K" : "720p")} icon={valueIcon} onChange={(r) => put("resolution", r)} />
        </div>
      ) : kind !== "audio" && model.role !== "upscale" && model.role !== "avatar" ? (
        <div>
          <Label>{t("Resolution")}</Label>
          <p className="text-sm text-muted-foreground">{edit ? t("Same as the source video") : t("Set by the model")}</p>
        </div>
      ) : null}

      {kind === "video" && p.audio ? (
        <div>
          <Label>{t("Sound")}</Label>
          <Chips options={["on", "off"] as const} value={params.sound === false ? "off" : "on"} label={(s) => (s === "on" ? t("On") : t("Off"))} icon={(s) => (s === "on" ? <Volume2Icon /> : <VolumeXIcon />)} onChange={(s) => put("sound", s === "on")} />
        </div>
      ) : null}
      {kind === "audio" && p.voices?.length && !cloning && !own.includes("voice") ? (
        <ModelVoices model={model.model} voices={p.voices} info={p.voice_info} value={(params.voice as string) ?? p.voices[0]} onChange={(v) => put("voice", v)} />
      ) : null}
      {p.quality?.length || p.seed || p.options?.length ? (
        // opened by the user, or already open when something is set; never closed under them when a value goes back to its default
        <details className="group/more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary className="flex list-none items-center gap-1 text-xs font-semibold tracking-wider text-foreground/70 uppercase hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 transition-transform group-open/more:rotate-90" /> {t("Options")}
            {params.options != null && (
              <button type="button" className="ml-auto text-[11px] font-normal tracking-normal normal-case text-muted-foreground hover:text-foreground" onClick={(e) => (e.preventDefault(), put("options", undefined))}>
                {t("Back to the defaults")}
              </button>
            )}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {p.options?.length ? <ModelOptions options={p.options} value={(params.options as Record<string, unknown>) ?? {}} onChange={(o) => put("options", o)} /> : null}
            {p.quality?.length ? (
              <div>
                <Label>{t("Quality")}</Label>
                <Chips options={p.quality} value={pick(p.quality, params.quality as string, "high")} label={(q) => QUALITY[q] ?? q} icon={valueIcon} onChange={(q) => put("quality", q)} />
              </div>
            ) : null}
            {p.seed && (
              <div>
                <Label hint={t("the same seed gives the same result")} stacked>{t("Seed")}</Label>
                <Input
                  inputMode="numeric"
                  placeholder={t("random")}
                  value={(params.seed as number | undefined) ?? ""}
                  onChange={(e) => put("seed", e.target.value === "" ? undefined : Number(e.target.value.replace(/\D/g, "")))}
                />
              </div>
            )}
          </div>
        </details>
      ) : null}
    </div>
  )
}

// a song's style or words: one line or several; on Kie, Suno writes lyrics from a theme (its versions to pick from) or
// the style out richer, each a small priced request of its own in the ledger
function SongText({ field: f, value, onChange, help, theme, onTitle }: { field: Field; value: string; onChange: (v: string) => void; help?: boolean; theme: string; onTitle: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [about, setAbout] = useState("")
  const [versions, setVersions] = useState<{ title: string; text: string }[] | null>(null)
  const subject = (about || theme).trim().slice(0, 200)
  async function run(confirm = false) {
    setBusy(true)
    try {
      setVersions((await api.assist("lyrics", subject, confirm)).texts)
    } catch (e) {
      const err = e as Error & { status?: number; body?: { shown?: string } }
      if (err.status === 409) toast(t("This costs {price}, above your threshold", { price: err.body?.shown ?? t("more") }), { action: { label: t("Go on"), onClick: () => run(true) } })
      else toast.error(plain(err.message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <Label>{own(f.label)}</Label>
        {help && (
          <Button size="xs" variant="ghost" className="-mt-1.5 ml-auto" title={t("Suno writes two versions from what it is about (a small request, in Credits)")} disabled={busy || !subject} onClick={() => run()}>
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
            {t("Write lyrics")}
          </Button>
        )}
      </div>
      {help && <Input className="mb-2" value={about} placeholder={theme ? t("About: {theme}", { theme }) : t("What the song is about, for Write lyrics")} onChange={(e) => setAbout(e.target.value)} aria-label={t("What the song is about")} />}
      <Textarea id={`song-${f.key}`} value={value} placeholder={own(f.placeholder)} onChange={(e) => onChange(e.target.value)} className="max-h-[calc(10lh+1rem)] min-h-28 text-sm leading-relaxed" />
      {versions && (
        <div className="mt-2 flex flex-col gap-2">
          {versions.map((v, i) => (
            <div key={i} className="rounded-lg border bg-muted/40 p-2.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{v.title || t("Version {n}", { n: i + 1 })}</span>
                <Button size="xs" className="ml-auto" onClick={() => (onChange(v.text), v.title && onTitle(v.title), setVersions(null))}>
                  {t("Use")}
                </Button>
              </div>
              <p className="mt-1 line-clamp-4 text-xs whitespace-pre-line text-muted-foreground">{v.text}</p>
            </div>
          ))}
          <button type="button" className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setVersions(null)}>
            {t("Keep mine")}
          </button>
        </div>
      )}
    </div>
  )
}

// a song's singer: a singer of the Library that Suno has (a persona of a song, or one's own sung voice), else Suno's own
function SingerField({ field: f, value, elements, onChange }: { field: Field; value?: string; elements: Element[]; onChange: (v: string) => void }) {
  // a singer still waiting for its phrase is listed, never picked
  const singers = elements.filter((e) => e.type === "singer" && e.files.length)
  const picked = singers.find((e) => `@${e.name}` === value && !needsPhrase(e))
  return <SingerPicker singers={singers} value={picked ? value! : ""} onChange={onChange} label={own(f.label)} />
}

// the two dubbing models, each with its price for this clip
function DubModels({ spec, value, ready, onChange }: { spec: Spec; value: string; ready: boolean; onChange: (q: string) => void }) {
  const [prices, setPrices] = useState<Record<string, string>>({})
  const key = JSON.stringify([spec.inputs.clip, spec.fields.to])
  useEffect(() => {
    if (!ready) return
    for (const q of ["dubbing_v1", "dubbing_v2"])
      api.estimate({ ...spec, fields: { ...spec.fields, quality: q } }).then(
        (a) => setPrices((p) => ({ ...p, [q]: `≈ ${a.shown}` })),
        () => {}
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready])
  return (
    <div>
      <Label>{t("Model")}</Label>
      <div className="grid gap-1.5">
        {[
          ["dubbing_v1", "Dubbing v1", t("automatic speaker detection, the cheaper one")],
          ["dubbing_v2", "Dubbing v2", t("keeps the voices' emotion, much dearer")],
        ].map(([id, name, note]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            onClick={() => onChange(id)}
            className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-left", value === id ? "border-foreground" : "hover:bg-muted")}
          >
            <span className="flex-1">
              <span className="block text-sm font-medium">{name}</span>
              <span className="block text-xs text-muted-foreground">{note}</span>
            </span>
            {prices[id] && <Price>{prices[id]}</Price>}
          </button>
        ))}
      </div>
    </div>
  )
}

// a box's words to the clipboard, from a button floating at its top right
function CopyText({ text, what }: { text: string; what: string }) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={t("Copy the {what}", { what: what.toLowerCase() })}
      title={t("Copy the {what}", { what: what.toLowerCase() })}
      disabled={!text.trim()}
      onClick={() => navigator.clipboard.writeText(text).then(() => toast.success(t("{what} copied", { what })), () => toast.error(t("The clipboard refused the copy")))}
      className="absolute top-1.5 right-1.5 z-10 bg-background/70 text-muted-foreground backdrop-blur-sm hover:text-foreground"
    >
      <CopyIcon />
    </Button>
  )
}
