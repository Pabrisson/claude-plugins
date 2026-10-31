import { useEffect, useRef, useState } from "react"
import { Columns2Icon, LoaderCircleIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/chips"
import { api, fileUrl, outputPath, per1000, plain, priceLabel, type Model, type Spec, type State, type Tool } from "@/lib/api"
import { CompareDialog } from "@/components/compare"
import { ModelPicker, type Priced } from "@/components/model-picker"
import { modelsFor } from "@/components/composer"

// the image model that makes a keyframe unless another is picked (the engine's own default)
const KEYFRAME_MODEL = "bytedance-seed/seedream-5-0-flash"

// a video edit on Aleph 2 by its keyframe: the frame at a time edited as an image first (a few cents), looked at, then
// carried through the whole shot by Generate. The keyframe's job is an image result like any other (Remix, Library)
export function KeyframePanel({
  tool,
  spec,
  video,
  keyframe,
  at,
  state,
  onSet,
  onModel,
}: {
  tool: Tool
  spec: Spec
  video?: string
  keyframe?: string
  at?: number
  state: State
  onSet: (k: { path: string; at: number } | null) => void
  onModel: (id: string) => void
}) {
  const [t, setT] = useState(at ?? 0)
  const [length, setLength] = useState(0)
  const [frame, setFrame] = useState<string>()
  const [price, setPrice] = useState<string | null>(null)
  const [job, setJob] = useState<string | null>(null)
  const asked = useRef(0)
  // the first step: the video tool's spec at that time, without a keyframe (the engine makes the image job)
  const inputs = Object.fromEntries(Object.entries(spec.inputs).filter(([k]) => k !== "keyframe"))
  const step: Spec = { ...spec, inputs, params: { ...spec.params, frame: t }, batch: undefined }
  const stepKey = JSON.stringify(step)

  // the image models that can make it: those of the image tool the recipe names (Custom edit otherwise), the default
  // first; each priced for this keyframe when the list opens
  const [image, setImage] = useState<{ tool?: Tool; models: Model[] }>({ models: [] })
  useEffect(() => {
    Promise.all([api.tools(), api.models("image")]).then(([tools, models]) => setImage({ tool: tools.image.find((x) => x.id === (tool.keyframe?.tool ?? "free-edit")), models }), () => {})
  }, [tool.keyframe?.tool])
  const fit = image.tool ? modelsFor(image.tool, "image", image.models) : { recommended: [], others: [] }
  const first = image.models.find((m) => m.model === KEYFRAME_MODEL)
  const recommended = first ? [first, ...fit.recommended.filter((m) => m !== first)] : fit.recommended
  const others = fit.others.filter((m) => m !== first)
  const chosen = String(spec.params.keyframe_model ?? first?.id ?? "")
  const [prices, setPrices] = useState<{ key: string; list: Record<string, Priced> }>({ key: "", list: {} })
  function priceModels() {
    if (!video || prices.key === stepKey) return
    setPrices({ key: stepKey, list: {} })
    for (const m of [...recommended, ...others])
      api.estimate({ ...step, params: { ...step.params, keyframe_model: m.id } }).then(
        (a) => setPrices((p) => (p.key === stepKey ? { key: stepKey, list: { ...p.list, [m.id]: { label: priceLabel(a), amount: a.estimate.amount } } } : p)),
        () => {}
      )
  }

  // the frame at t, shown until a keyframe is made
  useEffect(() => {
    if (!video) return
    const n = ++asked.current
    const wait = setTimeout(() => api.frame(video, false, t).then(({ path }) => n === asked.current && setFrame(fileUrl(path)), () => {}), 250)
    return () => clearTimeout(wait)
  }, [video, t])
  // what the keyframe costs
  useEffect(() => {
    if (!video) return
    const wait = setTimeout(() => api.estimate(step).then((a) => setPrice(priceLabel(a)), () => setPrice(null)), 400)
    return () => clearTimeout(wait)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, video])
  // its job's end: the result becomes the keyframe
  const running = job ? state.media.find((j) => j.id === job) : undefined
  // busy from the click on: the request is planned on the server first (the frame, its images), then its job runs
  const [starting, setStarting] = useState(false)
  const busy = starting || (!!job && running?.status !== "done" && running?.status !== "failed")
  useEffect(() => {
    if (running?.status === "done") onSet({ path: outputPath(state.home, running, running.outputs[0]), at: t })
    else if (running?.status === "failed") toast.error(plain(running.error ?? "The keyframe failed"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.status])

  async function make(confirm = false) {
    setStarting(true)
    try {
      setJob((await api.generate(step, confirm)).id)
      toast.success("Keyframe started", { description: "It shows here once made; Apply to the shot then carries it through." })
    } catch (e) {
      const err = e as Error & { status?: number; body?: { shown: string } }
      if (err.status === 409 && err.body) {
        if (window.confirm(`The keyframe costs ${err.body.shown}. Make it?`)) return make(true)
      } else toast.error(plain(err.message))
    } finally {
      setStarting(false)
    }
  }

  // the keyframe's own job, for Compare: A the keyframe, B its frame (the job's input) unless another is picked
  const made = keyframe ? state.media.find((j) => j.outputs.some((o) => outputPath(state.home, j, o) === keyframe)) : undefined
  const [comparing, setComparing] = useState(false)

  const verb = tool.id.endsWith("swap") ? "Swap on the frame" : "Edit the frame"
  return (
    <div>
      <Label hint={keyframe ? `at ${(at ?? 0).toFixed(1)} s: Apply to the shot carries it through` : "the change made on one frame first"}>Keyframe</Label>
      <div className="flex flex-col gap-2 rounded-xl border p-2">
        <div className="relative overflow-hidden rounded-lg bg-muted">
          {(keyframe || frame) && <img src={keyframe ? fileUrl(keyframe) : frame} alt={keyframe ? "The keyframe" : `The frame at ${t.toFixed(1)} s`} className="w-full" />}
          {keyframe && made && (
            <Button variant="secondary" size="sm" className="absolute top-2 left-2 bg-black/45 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-black/60" onClick={() => setComparing(true)}>
              <Columns2Icon data-icon="inline-start" /> Compare
            </Button>
          )}
          {busy && (
            <div role="status" aria-label="Making the keyframe" className="absolute inset-0 grid place-items-center bg-black/55">
              <LoaderCircleIcon className="size-8 animate-spin text-white" />
            </div>
          )}
          {keyframe && (
            <Button size="icon-xs" variant="secondary" className="absolute top-2 right-2" aria-label="Remove the keyframe" title="Remove the keyframe" onClick={() => onSet(null)}>
              <XIcon />
            </Button>
          )}
        </div>
        {!keyframe && video && (
          <div className="flex items-center gap-3 px-1">
            <video src={fileUrl(video)} preload="metadata" hidden onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)} />
            <Slider className="flex-1" min={0} max={Math.max(0.1, length - 0.1)} step={0.1} value={[t]} disabled={!length || busy} onValueChange={([v]) => setT(v)} aria-label="The frame to edit" />
            <span className="w-12 text-right text-sm tabular-nums">{t.toFixed(1)} s</span>
          </div>
        )}
        {keyframe && made && <CompareDialog open={comparing} onOpenChange={setComparing} origin={made} file={keyframe} jobs={state.media} home={state.home} per1000={per1000(state)} ready />}
        {recommended.length > 0 && (
          <ModelPicker kind="image" label="Keyframe model" recommended={recommended} others={others} value={chosen} onChange={(id) => id && onModel(id)} prices={prices.list} onOpen={priceModels} />
        )}
        {!video ? (
          <p className="px-1 text-xs text-muted-foreground">Add the video first.</p>
        ) : (
          <Button variant={keyframe ? "outline" : "secondary"} disabled={busy} onClick={() => (keyframe && onSet(null), make())}>
            {keyframe ? (
              <>
                <RefreshCwIcon /> Redo the keyframe
              </>
            ) : (
              `${verb}${price ? ` · ${price}` : ""}`
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
