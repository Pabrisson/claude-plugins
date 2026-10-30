import { useEffect, useMemo, useState } from "react"
import { ChevronRightIcon, CopyIcon, ListVideoIcon, MinusIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react"
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
import { Slider } from "@/components/ui/slider"
import {
  api,
  cited,
  currentOf,
  fill,
  imageInputs,
  isLocal,
  mentionables,
  mentionFrom,
  ownPrompt,
  plain,
  priceLabel,
  type EstimateAnswer,
  type Kind,
  type Model,
  type Place,
  type Spec,
  type State,
  type Tool,
  withLooks,
  withMentions,
} from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, Chips, Label, Price } from "@/components/chips"
import { FieldInput, Recolors, sections, Setups } from "@/components/fields"
import { LightRig } from "@/components/light-rig"
import { CameraRig } from "@/components/camera-rig"
import { ElementField } from "@/components/element-field"
import { StyleField } from "@/components/style-picker"
import { ExpandPreview, marginsOf } from "@/components/expand"
import { ExtendPanel } from "@/components/extend"
import { InputSlots, slotFor, upload } from "@/components/inputs"
import { MentionTextarea } from "@/components/mention"
import { ToolPicker } from "@/components/tool-picker"
import { LibraryVoices, ModelVoices, VoicePicker } from "@/components/voice-picker"
import { capsOf, ModelPicker, type Priced } from "@/components/model-picker"

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
  // an image tool's forced settings (Remove background's transparency, Upscale's 4K) only on the models that have them
  const can = (m: Model) =>
    (!tool.params?.background || (m.params.background ?? []).includes(String(tool.params.background))) &&
    (!tool.params?.resolution || (m.params.resolution ?? []).includes(String(tool.params.resolution)))
  const ok = (m: Model) =>
    kind === "video"
      ? m.role === "generate" && (tool.id !== "extend" || (m.params.frames?.length ?? 0) > 0)
      : kind === "image"
        ? (tool.mode === "create" || m.role !== "create") && can(m)
        : true
  return { recommended, others: [...also, ...models.filter((m) => ok(m) && !recommended.includes(m) && !also.includes(m))] }
}

const COMMON_LANGS = ["en", "fr", "es", "de", "it", "pt", "ja", "zh"]

// the tool list's prices for the session, per space, tool and model (a probe estimate, before any input)
const PRICES = new Map<string, string>()

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
  const eleven = tool.provider === "elevenlabs", local = isLocal(tool)

  // the model: the user's pick, else the folder's default when it fits, else the tool's first
  const { recommended, others } = useMemo(() => modelsFor(tool, kind, models), [tool, kind, models])
  const fitting = [...recommended, ...others]
  const def = state.settings.defaults[kind]
  const modelId = eleven || local ? undefined : (value.model && fitting.some((m) => m.id === value.model) ? value.model : def && fitting.some((m) => m.id === def) ? def : fitting[0]?.id)
  const model = models.find((m) => m.id === modelId)

  // the prompt sent: the tool's template filled with its fields and the user's words, or Claude's prompt (a draft)
  // with the user's words after it
  const prompt = value.raw ? [value.rawText, value.intent].filter(Boolean).join(" ").trim() : fill(tool, withLooks(tool, value.fields, state.styles ?? []), value.intent, kind, value.inputs)
  // the same, read only, with what is still to fill as {key}, and the @names as the model reads them
  const filled = value.raw ? prompt : fill(tool, withLooks(tool, value.fields, state.styles ?? []), value.intent, kind, value.inputs, true)
  const shownPrompt = kind === "audio" ? filled : withMentions(filled, kind, mentionFrom(kind, tool, value.inputs), state)
  // what the words can cite with @name (a voice's text is read as written), and the images those bring
  // the current workspace's Elements first in the @ list
  const ws = currentOf(state)
  const items = kind === "audio" ? [] : mentionables(state)
  // (the words' own and an element field's: the prompt holds both)
  const mentioned = cited(prompt, items).reduce((n, i) => n + i.files.length, 0)
  // the user writes the whole prompt (Custom, speech), or adds words to the one the tool builds; those are needed on
  // Custom and Custom edit (no prompt of their own), optional beside a tool's
  const whole = ownPrompt(tool), takesWords = tool.template.includes("{prompt}")
  const custom = tool.id === "free" || tool.id === "free-edit"
  const missing = tool.inputs.find((i) => !i.optional && !value.inputs[i.key]?.length)
  const unpicked = tool.fields.find((f) => f.required && !String(value.fields[f.key] ?? f.default ?? "").trim())
  // a References tool: a job a sheet, so no batch; it needs words or photos
  const sheets = tool.fields.find((f) => f.type === "sheets")
  const sheetCount = sheets ? String(value.fields[sheets.key] ?? sheets.default ?? "").split(",").filter((x) => x.trim()).length : 0
  const unsaid = tool.one_of && !tool.one_of.some((k) => value.inputs[k]?.length || value.fields[k]?.trim())
  // the reference images the model takes, and those this sends: the tool's image inputs and a Library style's; an
  // input of several takes what is left (« 2 / 13 »)
  // with a frame, OpenRouter keeps a video's frames and drops its reference images: none then
  const framed = kind === "video" && model?.role !== "avatar" && ["first_frame", "last_frame"].some((k) => (value.inputs[k]?.length ?? 0) > 0)
  const maxRefs = framed ? 0 : model?.params.references
  const styleField = tool.fields.find((f) => f.type === "style")
  const styleImages = (styleField && state.styles?.find((s) => s.name === (value.fields[styleField.key] ?? styleField.default))?.files.length) || 0
  const usedRefs = imageInputs(kind, tool).reduce((n, i) => n + (value.inputs[i.key]?.length ?? 0), 0) + styleImages + mentioned
  const overRefs = maxRefs != null ? usedRefs - maxRefs : 0
  const limits = maxRefs == null ? {} : Object.fromEntries(imageInputs(kind, tool).filter((i) => i.multiple).map((i) => [i.key, Math.max(0, (value.inputs[i.key]?.length ?? 0) + maxRefs - usedRefs)]))

  const spec: Spec = useMemo(
    () => ({
      kind,
      tool: tool.id,
      model: modelId,
      prompt: value.raw ? prompt : value.intent,
      ...(value.raw ? { raw: true } : {}),
      fields: value.fields,
      inputs: value.inputs,
      params: value.params,
      ...(value.batch && value.batch > 1 && !eleven && !local && !sheets ? { batch: value.batch } : {}),
      ...(value.place ? { place: value.place } : {}),
    }),
    [kind, tool.id, modelId, value, eleven, local, prompt, sheets]
  )

  // the estimate, again after every change (debounced)
  // what is missing, as the button's words until it can run
  const expand = tool.local === "expand", extend = tool.local === "extend"
  const blocker = missing
    ? missing.kind === "mask" || missing.kind === "sketch" ? missing.label : `Add ${missing.label.toLowerCase()}`
    : unpicked
      ? unpicked.type === "element" ? `Pick ${unpicked.label === "With" ? "an element" : `a ${unpicked.label.toLowerCase()}`}` : `Fill ${unpicked.label.toLowerCase()}`
    : overRefs > 0 && model
      ? usedRefs === styleImages
        ? framed ? "Frames or your style, not both" : "Pick a model for your style"
        : framed ? "Frames or references, not both" : maxRefs === 0 ? "Pick a model that takes images" : `Remove ${overRefs} image${overRefs > 1 ? "s" : ""}`
    : expand && !Object.values(marginsOf(value.fields)).some(Boolean)
      ? "Set the frame"
    : sheets && !sheetCount
      ? "Pick a sheet"
    : unsaid
      ? "Describe it or add photos"
      : !eleven && !local && !((whole || custom) && !value.raw ? value.intent.trim() : prompt) && tool.id !== "upscale"
      ? kind === "audio" ? "Write the text" : "Write a prompt"
      : tool.id === "translate" && !value.fields.to?.trim()
        ? "Pick the languages"
        : tool.id === "change-voice" && !value.params.voice
          ? "Pick the new voice"
          : null
  const [est, setEst] = useState<{ answer?: EstimateAnswer; error?: string }>({})
  const specKey = JSON.stringify(spec)
  useEffect(() => {
    if (blocker) return
    const t = setTimeout(() => {
      api.estimate(spec).then(
        (answer) => setEst({ answer }),
        (e) => setEst({ error: plain(e.message) })
      )
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, blocker])

  // until it can run, the button shows this tool's price on this model and settings, before the inputs and words
  // (not a voice's: it is priced by its text)
  const probeSpec = (model?: string): Spec => ({ kind, tool: tool.id, model, prompt: "", fields: value.fields, inputs: {}, params: value.params, probe: true, ...(spec.batch ? { batch: spec.batch } : {}) })
  const probeKey = JSON.stringify(probeSpec(modelId))
  const [probe, setProbe] = useState<{ key: string; label: string | null }>({ key: "", label: null })
  useEffect(() => {
    if (!blocker || (kind === "audio" && !eleven)) return
    const t = setTimeout(() => api.estimate(probeSpec(modelId)).then((a) => setProbe({ key: probeKey, label: priceLabel(a) }), () => {}), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey, !!blocker])
  // the model list's prices: each model on these settings, asked when the list opens (a voice's on its text, once written)
  const [modelPrices, setModelPrices] = useState<{ key: string; prices: Record<string, Priced> }>({ key: "", prices: {} })
  function priceModels() {
    const speech = kind === "audio" && !eleven
    if (speech && !prompt) return
    const listSpec = (model?: string): Spec => ({ ...probeSpec(model), batch: undefined, ...(speech ? { prompt } : {}) })
    const key = JSON.stringify(listSpec())
    if (modelPrices.key === key) return
    setModelPrices({ key, prices: {} })
    for (const m of fitting)
      api.estimate(listSpec(m.id)).then(
        (a) => setModelPrices((p) => (p.key === key ? { key, prices: { ...p.prices, [m.id]: { label: priceLabel(a), amount: a.estimate.amount } } } : p)),
        () => {}
      )
  }

  // prices in the tool list: a probe estimate per tool on its recommended model, once a session
  const listed = kind === "audio" ? tools : tools.filter((t) => t.mode === mode)
  const priceKey = (t: Tool) => `${kind}:${t.id}:${t.models?.[0] ?? ""}`
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
  async function go(confirm = false) {
    setBusy(true)
    try {
      await api.generate(spec, confirm)
      setAsk(null)
      // one result takes the place on the timeline: the next generation is a plain one
      if (value.place) onChange({ ...value, place: undefined })
      toast.success(sheetCount > 1 ? `${sheetCount} sheets started` : `${spec.batch ? `${spec.batch} × ` : ""}${tool.label} started`, {
        description: sheetCount > 1 ? "The first sets the look, the others follow it. They keep running if you close this page." : "It keeps running if you close this page.",
      })
    } catch (e) {
      const err = e as Error & { status?: number; body?: { needs: string; shown: string } }
      if (err.status === 409 && err.body) setAsk(err.body)
      else toast.error(plain(err.message))
    } finally {
      setBusy(false)
    }
  }

  // Copy prompt: Claude writes the prompt that suits this model into the composer; nothing is generated
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
      "Write the prompt this model handles best (its syntax, strengths and ideal length), then put it in the dashboard's composer with:",
      `node "${engine}/media.mjs" draft --space ${kind} --tool ${tool.id}${modelId ? ` --model ${modelId}` : ""} --prompt "<the prompt>"`,
      "I will read it and click Generate myself.",
    ].filter((l) => l !== "").join("\n")
    navigator.clipboard.writeText(text).then(
      () => toast.success("Prompt copied", { description: "Paste it in Claude Code: it writes the prompt here, without generating." }),
      () => toast.error("The clipboard refused the copy")
    )
  }

  // a prompt Claude wrote with `media.mjs draft`
  const draft = state.drafts[kind]
  const newDraft = draft && draft.at > draftSeen
  function applyDraft() {
    if (!draft) return
    const t = tools.find((x) => x.id === draft.tool) ?? tool
    // Claude's prompt replaces the tool's (shown read-only, the user's words still go after it); for a tool whose
    // prompt is the user's own, it is those words
    const own = ownPrompt(t) && !!draft.prompt
    onChange({ ...value, tool: t.id, model: draft.model ?? value.model, fields: { ...value.fields, ...draft.fields }, raw: !!draft.prompt && !own,
      rawText: draft.prompt ?? value.rawText, intent: draft.prompt ? (own ? draft.prompt : "") : value.intent })
    onDraftSeen(draft.at)
  }

  const label = tool.id === "change-voice" ? "Change voice" : tool.id === "translate" ? "Translate" : local ? tool.label : "Generate"
  const a = blocker ? undefined : est.answer
  const price = a ? priceLabel(a) : blocker && probe.key === probeKey ? probe.label : null
  const ready = !busy && !!a && (eleven ? state.keys.elevenlabs : local || state.keys.openrouter)

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
    else if (files.length) toast.error(`${tool.label} takes no such file here`)
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
        {newDraft && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
            <span className="size-2 shrink-0 rounded-full bg-highlight" aria-hidden />
            <span className="flex-1">Claude wrote a prompt for this space.</span>
            <Button size="sm" onClick={applyDraft}>
              <RefreshCwIcon /> Reload
            </Button>
          </div>
        )}

        {value.place && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
            <ListVideoIcon className="size-4 shrink-0 text-space" aria-hidden />
            <span className="flex-1">
              {value.place.replace ? "The result takes its clip's place" : `The result goes into the cut at ${value.place.at.toFixed(1)} s`} on the timeline of{" "}
              {state.workspaces.find((w) => w.slug === value.place!.workspace)?.name ?? "its workspace"}.
            </span>
            <Button size="icon-xs" variant="ghost" aria-label="Do not lay the result on the timeline" title="Do not lay it on the timeline" onClick={() => set({ place: undefined })}>
              <XIcon />
            </Button>
          </div>
        )}

        {kind === "audio" ? (
          // three tools: the picker alone, a clip kept from one voice tool to the other
          <ToolPicker tools={tools} value={tool} models={models} prices={prices} onOpen={priceTools} onPick={(t) => onChange({ ...blank(kind, t.id), inputs: value.inputs.clip ? { clip: value.inputs.clip } : {} })} />
        ) : (
          <>
            <Chips
              className="grid grid-cols-2"
              options={["create", "edit"] as const}
              value={mode}
              label={(m) => (m === "create" ? "Create" : "Edit")}
              onChange={(m) => onChange({ ...blank(kind, m === "create" ? "free" : "free-edit"), batch: value.batch })}
            />
            <ToolPicker
              tools={tools.filter((t) => t.mode === mode)}
              value={tool}
              models={models}
              prices={prices}
              onOpen={priceTools}
              onPick={(t) => onChange({ ...blank(kind, t.id), batch: value.batch, inputs: Object.fromEntries(Object.entries(value.inputs).filter(([k]) => t.inputs.some((i) => i.key === k))) })}
            />
          </>
        )}

        {!tool.template && <InputSlots tool={tool} value={value.inputs} onChange={(inputs) => set({ inputs })} home={state.home} media={state.media} limits={limits} none={framed ? "Not with a frame" : undefined} fields={value.fields} onField={(k, v) => set({ fields: { ...value.fields, [k]: v }, raw: false })} />}

        {tool.presets && <Setups tool={tool} fields={value.fields} onPick={(fields) => set({ fields: { ...value.fields, ...fields }, raw: false })} />}

        {/* the fields, those of one section under its heading (selects as tiles, two a row); Expand's margins and
            Extend's direction and join have their own panels below */}
        {sections(tool.fields.filter((f) => f.type !== "margin" && !(extend && ["direction", "join"].includes(f.key)))).map(({ section, fields }, i) =>
          section ? (
            <div key={section}>
              <Label>{section}</Label>
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
                  <Label>{f.label}</Label>
                  <Input value={value.fields.to ?? ""} placeholder={f.placeholder} onChange={(e) => set({ fields: { ...value.fields, to: e.target.value } })} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COMMON_LANGS.map((l) => {
                      const list = (value.fields.to ?? "").split(/[,\s]+/).filter(Boolean), on = list.includes(l)
                      return (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set({ fields: { ...value.fields, to: (on ? list.filter((x) => x !== l) : [...list, l]).join(", ") } })}
                          className={cn(CHIP, "px-2.5 py-0.5 text-xs", on ? CHIP_ON : CHIP_OFF)}
                        >
                          {l}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : tool.id === "translate" && f.key === "quality" ? (
                <DubModels key={f.key} spec={spec} value={value.fields.quality ?? "dubbing_v1"} ready={!missing && !!value.fields.to} onChange={(q) => set({ fields: { ...value.fields, quality: q } })} />
              ) : f.type === "style" ? (
                <StyleField key={f.key} field={f} value={value.fields[f.key]} kind={kind} styles={state.styles ?? []} media={state.media} home={state.home} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
              ) : f.type === "light" ? (
                <LightRig key={`${f.key}-${i}`} field={f} fields={value.fields} video={kind === "video"} onChange={(patch) => set({ fields: { ...value.fields, ...patch }, raw: false })} />
              ) : f.type === "camera" ? (
                <CameraRig key={f.key} field={f} fields={value.fields} onChange={(patch) => set({ fields: { ...value.fields, ...patch }, raw: false })} />
              ) : f.type === "recolors" ? (
                <Recolors key={f.key} field={f} fields={value.fields} onChange={(patch) => set({ fields: { ...value.fields, ...patch }, raw: false })} />
              ) : f.type === "element" ? (
                <ElementField key={f.key} field={f} value={value.fields[f.key]} items={items} blocked={maxRefs === 0 ? (framed ? "not with a frame" : "not on this model") : undefined} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
              ) : (
                <FieldInput key={f.key} field={f} value={value.fields[f.key]} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v }, raw: false })} />
              )
            )
          )
        )}

        {tool.id === "change-voice" && (
          <VoicePicker enabled={state.keys.elevenlabs} value={value.params.voice as string | undefined} onChange={(voice) => set({ params: { ...value.params, voice } })} library={state.elements ?? []} />
        )}
        {tool.id === "voice" && (
          <LibraryVoices
            voices={(state.elements ?? []).filter((e) => e.type === "voice" && e.files.length)}
            value={String(value.params.voice ?? "").startsWith("@") ? String(value.params.voice).slice(1) : null}
            onChange={(name) => {
              const { voice_clips, ...inputs } = value.inputs
              set(name ? { params: { ...value.params, voice: `@${name}` }, inputs } : { params: { ...value.params, voice: undefined }, inputs: { ...inputs, ...(voice_clips ? { voice_clips } : {}) } })
            }}
          />
        )}

        {tool.template && (
          <div className="flex flex-col gap-3">
            {/* the prompt the tool builds, read only: what goes to the model */}
            {!whole && (
              <div>
                <Label hint={value.raw ? "written by Claude" : "built by the tool, with your words"}>Prompt</Label>
                <div className="relative">
                  <Textarea
                    readOnly
                    value={shownPrompt}
                    aria-label="Prompt sent to the model"
                    className="max-h-[calc(6lh+1rem)] min-h-16 resize-none border-dashed bg-muted/40 py-2 pr-10 pl-3 text-sm leading-relaxed text-foreground/80 focus-visible:ring-0 md:text-sm dark:bg-muted/30"
                  />
                  <CopyText text={shownPrompt} what="Prompt" />
                </div>
                {value.raw && (
                  <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => set({ raw: false })}>
                    Back to the tool's prompt
                  </button>
                )}
              </div>
            )}
            {/* the user's own words, with the tool's files */}
            {(takesWords || tool.inputs.length > 0) && (
              <div>
                <Label hint={whole ? undefined : custom ? "added to the tool's prompt" : "optional, added to the tool's prompt"}>{kind === "audio" ? "Text to speak" : whole ? "Prompt" : "Your words"}</Label>
                <InputGroup className="h-auto flex-col rounded-xl bg-input/20 has-[[data-slot=input-group-control]:focus-visible]:border-space/60 has-[[data-slot=input-group-control]:focus-visible]:ring-space/20">
                  {takesWords && kind === "audio" && (
                    <InputGroupTextarea
                      value={value.intent}
                      aria-label="Text to speak"
                      placeholder="What the voice says"
                      className={cn("max-h-[calc(6lh+1.25rem)] py-2.5 pr-10 pl-3 text-[15px] leading-relaxed md:text-[15px]", whole ? "min-h-28" : "min-h-16")}
                      onChange={(e) => set({ intent: e.target.value })}
                    />
                  )}
                  {takesWords && <CopyText text={value.intent} what={kind === "audio" ? "Text" : "Prompt"} />}
                  {takesWords && kind !== "audio" && (
                    <MentionTextarea
                      value={value.intent}
                      items={items}
                      first={ws?.linked}
                      firstLabel={ws?.name}
                      blocked={maxRefs === 0 ? (framed ? "Not with a frame: with a first or last frame, the model takes no reference image." : `${model?.name ?? "This model"} takes no reference image: pick another model to cite one.`) : undefined}
                      aria-label={whole ? "Prompt" : "Your words"}
                      placeholder={`${whole ? tool.description : custom ? "What to change." : "Anything to add: details, style, what must not change."} Type @ to cite an element.`}
                      className={cn("max-h-[calc(6lh+1.25rem)] py-2.5 pr-10 pl-3 text-[15px] leading-relaxed md:text-[15px]", whole ? "min-h-28" : "min-h-16")}
                      onChange={(intent) => set({ intent })}
                    />
                  )}
                  {tool.inputs.length > 0 && (
                    <InputGroupAddon align="block-end" className={cn("px-3 pt-3 pb-3 font-normal", takesWords && "border-t")}>
                      <InputSlots tool={tool} value={value.inputs} onChange={(inputs) => set({ inputs })} home={state.home} media={state.media} label={false} limits={limits} none={framed ? "Not with a frame" : undefined} fields={value.fields} onField={(k, v) => set({ fields: { ...value.fields, [k]: v }, raw: false })} />
                    </InputGroupAddon>
                  )}
                </InputGroup>
              </div>
            )}
          </div>
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

        {model && (
          <ModelBlock
            kind={kind}
            recommended={recommended}
            others={others}
            model={model}
            params={value.params}
            onModel={(id) => set({ model: id })}
            onParams={(params) => set({ params })}
            prices={modelPrices.prices}
            onOpenModels={priceModels}
            // the image a result can take its ratio from: any for an image, a first or last frame (an avatar's photo) for a video
            hasImageInput={kind === "video" ? ["first_frame", "last_frame"].some((k) => (value.inputs[k]?.length ?? 0) > 0) : tool.inputs.some((i) => i.kind === "image" && (value.inputs[i.key]?.length ?? 0) > 0)}
            hasVideoInput={tool.inputs.some((i) => i.kind === "video") && !extend}
            // settings a tool's own panel sets: Extend's length and ratio (its source's), Expand's ratio (its frame's)
            own={extend ? ["duration", "aspect_ratio"] : expand || sheets ? ["aspect_ratio"] : []}
            cloning={(value.inputs.voice_clips?.length ?? 0) > 0 || String(value.params.voice ?? "").startsWith("@")}
            elevenlabs={state.keys.elevenlabs}
          />
        )}

        {!blocker && est.error && (
          <Alert variant="destructive">
            <AlertDescription>{est.error}</AlertDescription>
          </Alert>
        )}
        {tool.id === "change-voice" && (
          <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            Keeps the delivery: pauses, emotion and rhythm stay, only the timbre changes. Up to 5 min goes in one call; a longer clip is sent in pieces.
          </p>
        )}
        {tool.id === "translate" && (
          <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            No lip-sync: the voices are dubbed in their own timbre, the lips keep the original language. Subtitles come with each language.
          </p>
        )}
        {eleven && !state.keys.elevenlabs && (
          <p className="rounded-lg border p-3 text-xs text-destructive">No ElevenLabs key: set it with /plugin configure skill-video@pabrisson, then restart Claude Code.</p>
        )}
        {!eleven && !local && !state.keys.openrouter && (
          <p className="rounded-lg border p-3 text-xs text-destructive">No OpenRouter key: prices show, nothing can be generated. Set it with /plugin configure skill-video@pabrisson.</p>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex gap-2">
          {!eleven && !local && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-lg" className="size-11" onClick={copyPrompt} aria-label="Copy prompt">
                  <CopyIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-72 p-3 text-left">
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">Copy prompt</p>
                  <p className="opacity-90">
                    Copies a request for Claude with this tool, {model ? model.name : "the model"} and your inputs. Paste it in Claude Code: Claude writes the prompt this model handles best, here in the composer.
                  </p>
                  <p className="font-medium">Nothing is generated, nothing is spent.</p>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {!eleven && !local && !sheets && <Batch value={value.batch ?? 1} onChange={(batch) => set({ batch })} />}
          <Button variant="space" className={cn("h-11 min-w-0 flex-1 px-4 text-[15px]", blocker && !price ? "justify-center" : "justify-between")} disabled={!ready} onClick={() => go()}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{blocker ?? label}</span>
              {!blocker && <Kbd className="bg-space-foreground/15 text-space-foreground/80">⌘↵</Kbd>}
            </span>
            {price && <Price className="bg-space-foreground/15 text-space-foreground">{price}</Price>}
          </Button>
        </div>
      </div>

      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          <DialogTitle>{ask?.needs === "cap" ? "Over this month's cap" : ask?.needs === "unknown" ? "Unknown cost" : "Over your confirmation threshold"}</DialogTitle>
          <DialogDescription>
            {ask?.needs === "unknown"
              ? "This model lists no price for these settings: the actual cost shows in Credits once it is done."
              : ask?.needs === "cap"
                ? `This would take this month's spend over the cap you set in Settings: ${ask?.shown}.`
                : `This costs ${ask?.shown}, above the threshold you set in Settings.`}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAsk(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => go(true)}>{label} anyway</Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

// how many times to run it: 1 to 4 jobs, each its own result and cost; the button shows the total
function Batch({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex h-11 items-center rounded-md border bg-background dark:border-input dark:bg-input/30" role="group" aria-label="Batch: how many to generate">
      <button type="button" aria-label="One less" disabled={value <= 1} onClick={() => onChange(value - 1)} className="grid h-full w-7 place-items-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        <MinusIcon className="size-3.5" />
      </button>
      <span className="w-9 text-center text-sm font-medium tabular-nums" aria-live="polite" title="Batch: how many to generate">
        {value}/4
      </span>
      <button type="button" aria-label="One more" disabled={value >= 4} onClick={() => onChange(value + 1)} className="grid h-full w-7 place-items-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  )
}

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
  elevenlabs,
  prices,
  onOpenModels,
  own = [],
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
  // an ElevenLabs key: its voices' samples to listen to
  elevenlabs: boolean
  prices: Record<string, Priced>
  onOpenModels: () => void
  own?: string[]
}) {
  const p = model.params, put = (k: string, v: unknown) => onParams({ ...params, [k]: v })
  const caps = capsOf(model)
  const durations = own.includes("duration") ? [] : (p.duration ?? [])
  const edit = kind === "video" && hasVideoInput

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Model</Label>
        <ModelPicker kind={kind} recommended={recommended} others={others} value={model.id} onChange={(id) => id && onModel(id)} prices={prices} onOpen={onOpenModels} />
        {caps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {caps.map((c) => <Badge key={c} variant="outline" className="font-normal text-muted-foreground">{c}</Badge>)}
          </div>
        )}
      </div>

      {kind === "video" && !edit && durations.length > 0 && (
        <div>
          <Label>Duration</Label>
          {durations.length > 6 ? (
            <div className="flex items-center gap-3">
              <Slider min={durations[0]} max={durations.at(-1)} step={1} value={[pick(durations, params.duration as number, 5)!]} onValueChange={([d]) => put("duration", d)} aria-label="Duration" />
              <span className="w-10 text-right text-sm tabular-nums">{pick(durations, params.duration as number, 5)} s</span>
            </div>
          ) : (
            <Chips options={durations} value={pick(durations, params.duration as number, 5)} label={(d) => `${d} s`} onChange={(d) => put("duration", d)} />
          )}
        </div>
      )}
      {!edit && !own.includes("aspect_ratio") && p.aspect_ratio?.length ? (
        <div>
          <Label>Ratio</Label>
          {hasImageInput ? (
            <Chips
              options={["same", ...p.aspect_ratio]}
              value={(params.aspect_ratio as string) ?? "same"}
              label={(r) => (r === "same" ? "Same as the image" : r)}
              onChange={(r) => put("aspect_ratio", r === "same" ? undefined : r)}
            />
          ) : (
            <Chips options={p.aspect_ratio} value={pick(p.aspect_ratio, params.aspect_ratio as string, kind === "video" ? "16:9" : "1:1")} onChange={(r) => put("aspect_ratio", r)} />
          )}
        </div>
      ) : null}
      {p.resolution?.length && model.role !== "upscale" ? (
        <div>
          <Label>Resolution</Label>
          <Chips options={p.resolution} value={pick(p.resolution, params.resolution as string, kind === "image" ? "2K" : "1080p", kind === "image" ? "1K" : "720p")} onChange={(r) => put("resolution", r)} />
        </div>
      ) : kind !== "audio" && model.role !== "upscale" && model.role !== "avatar" ? (
        <div>
          <Label>Resolution</Label>
          <p className="text-sm text-muted-foreground">{edit ? "Same as the source video" : "Set by the model"}</p>
        </div>
      ) : null}

      {kind === "video" && p.audio ? (
        <div>
          <Label>Sound</Label>
          <Chips options={["on", "off"] as const} value={params.sound === false ? "off" : "on"} label={(s) => (s === "on" ? "On" : "Off")} onChange={(s) => put("sound", s === "on")} />
        </div>
      ) : null}
      {kind === "audio" && p.voices?.length && !cloning ? (
        <ModelVoices model={model.model} voices={p.voices} value={(params.voice as string) ?? p.voices[0]} onChange={(v) => put("voice", v)} elevenlabs={elevenlabs} />
      ) : null}
      {(p.quality?.length || p.seed) && (
        <details className="group/more" open={params.seed != null || (params.quality != null && params.quality !== "high") || undefined}>
          <summary className="flex list-none items-center gap-1 text-xs font-semibold tracking-wider text-foreground/70 uppercase hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 transition-transform group-open/more:rotate-90" /> More
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {p.quality?.length ? (
              <div>
                <Label>Quality</Label>
                <Chips options={p.quality} value={pick(p.quality, params.quality as string, "high")} onChange={(q) => put("quality", q)} />
              </div>
            ) : null}
            {p.seed && (
              <div>
                <Label hint="the same seed gives the same result">Seed</Label>
                <Input
                  inputMode="numeric"
                  placeholder="random"
                  value={(params.seed as number | undefined) ?? ""}
                  onChange={(e) => put("seed", e.target.value === "" ? undefined : Number(e.target.value.replace(/\D/g, "")))}
                />
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
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
      <Label>Model</Label>
      <div className="grid gap-1.5">
        {[
          ["dubbing_v1", "Dubbing v1", "automatic speaker detection, the cheaper one"],
          ["dubbing_v2", "Dubbing v2", "keeps the voices' emotion, much dearer"],
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
      aria-label={`Copy the ${what.toLowerCase()}`}
      title={`Copy the ${what.toLowerCase()}`}
      disabled={!text.trim()}
      onClick={() => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error("The clipboard refused the copy"))}
      className="absolute top-1.5 right-1.5 z-10 bg-background/70 text-muted-foreground backdrop-blur-sm hover:text-foreground"
    >
      <CopyIcon />
    </Button>
  )
}
