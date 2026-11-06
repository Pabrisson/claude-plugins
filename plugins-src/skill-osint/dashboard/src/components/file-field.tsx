import { accepts, isUrl } from "@engine/mime.js"
import { useEffect, useId, useRef, useState } from "react"

import { Chips } from "@/components/chips"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, type Input as InputDef } from "@/lib/api"
import { cn } from "@/lib/utils"

const MAX = 2e9
const nf = new Intl.NumberFormat("en", { maximumFractionDigits: 1 })
const size = (n: number) => (n >= 1e6 ? `${nf.format(n / 1e6)} MB` : `${nf.format(n / 1e3)} KB`)
const plain = (accept?: string) => (accept?.startsWith("video/") ? "Videos" : accept?.startsWith("image/") ? "Images" : (accept ?? "Any file"))
const BROWSER_IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i
type Sent = { file: File; path: string; preview: string | null }

// A `file` input of a type's form: a drop zone that sends the file at once (POST /api/uploads) and hands the form the
// path the server gives back; with `link`, a File / Link switch (a link is kept as it is). Never a colored edge band.
export function FileField({ input, value, onChange, onBusy, error }: { input: InputDef; value: string | undefined; onChange: (v: string | undefined) => void; onBusy: (b: boolean) => void; error?: string | null }) {
  const id = useId(), describe = `${id}-err`
  const picker = useRef<HTMLInputElement>(null), abort = useRef<AbortController | null>(null)
  const [mode, setMode] = useState<"upload" | "link">(input.link && value && isUrl(value) ? "link" : "upload")
  const [sent, setSent] = useState<Sent | null>(null), [share, setShare] = useState<number | null>(null)
  const [over, setOver] = useState(false), [msg, setMsg] = useState<string | null>(null), [link, setLink] = useState(mode === "link" ? (value ?? "") : "")
  const preview = sent?.preview
  useEffect(() => () => { abort.current?.abort(); if (preview) URL.revokeObjectURL(preview) }, [preview])

  function drop() { abort.current?.abort(); setSent(null); setShare(null); setMsg(null); onChange(undefined); onBusy(false) }
  function switchTo(m: "upload" | "link") { drop(); setLink(""); setMode(m) }
  async function take(file: File | undefined) {
    if (!file) return
    setMsg(null)
    if (input.accept && !accepts(input.accept, file.name)) return setMsg(`${file.name} is not ${input.accept}`)
    if (file.size > MAX) return setMsg("Files over 2 GB: give this one to the agent by its path")
    abort.current?.abort()
    const ctl = (abort.current = new AbortController())
    setSent(null); setShare(0); onBusy(true)
    try {
      const r = await api.upload(file, setShare, ctl.signal)
      setSent({ file, path: r.path, preview: BROWSER_IMAGE.test(file.name) ? URL.createObjectURL(file) : null })
      onChange(r.path)
    } catch (e) { if ((e as Error).name !== "AbortError") setMsg((e as Error).message) }
    setShare(null); onBusy(false)
  }
  const kind = input.accept?.startsWith("video/") ? "file-video" : "image-up"
  const shown = msg ?? error
  return (
    <div className="flex flex-col gap-2">
      {input.link && <Chips label={`${input.label}: file or link`} size="xs" value={mode} onChange={m => switchTo(m as "upload" | "link")} options={[{ value: "upload", label: "File", icon: "upload" }, { value: "link", label: "Link", icon: "link" }]} />}
      {mode === "link" ? (
        <Input id={id} type="url" value={link} placeholder="https://…" autoComplete="off" spellCheck={false} aria-invalid={!!shown || undefined} aria-describedby={shown ? describe : undefined}
          onChange={e => { const v = e.target.value.trim(); setLink(e.target.value); if (v && !isUrl(v)) { setMsg("A link starts with https://"); onChange(undefined) } else { setMsg(null); onChange(v || undefined) } }} />
      ) : share != null ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-4" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(share * 100)}%` }} /></div>
          <div className="flex items-center justify-between text-sm"><span>Uploading {Math.round(share * 100)} %</span><Button type="button" variant="ghost" size="sm" onClick={drop}>Cancel</Button></div>
        </div>
      ) : sent ? (
        <div className="flex items-center gap-3 rounded-xl p-2 ring-1 ring-foreground/10">
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
            {sent.preview ? <img src={sent.preview} alt="" className="size-full object-cover" /> : <Icon name={sent.file.type.startsWith("video/") || /\.(mov|mp4|mkv|webm|avi|m4v|3gp)$/i.test(sent.file.name) ? "file-video" : "file-image"} className="size-5" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{sent.file.name}</span><span className="text-xs text-muted-foreground">{size(sent.file.size)}</span></span>
          <Button type="button" variant="outline" size="sm" onClick={() => picker.current?.click()}>Replace</Button>
          <Button type="button" variant="ghost" size="sm" onClick={drop}>Remove</Button>
        </div>
      ) : (
        <div role="button" tabIndex={0} aria-describedby={shown ? describe : undefined}
          onClick={() => picker.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }}
          className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50", over && "ring-2 ring-primary", shown && "border-destructive")}>
          <Icon name={kind} className="size-6" aria-hidden />
          <span className="font-medium text-foreground">Drop a file here or choose one</span>
          <span className="text-xs">{plain(input.accept)}</span>
        </div>
      )}
      <input ref={picker} id={`${id}-file`} type="file" accept={input.accept} className="sr-only" tabIndex={-1} aria-hidden onChange={e => { take(e.target.files?.[0]); e.target.value = "" }} />
      {shown && <p id={describe} role="alert" className="text-sm text-destructive">{shown}</p>}
    </div>
  )
}
