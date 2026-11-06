import { actionsFor, itemOf } from "@engine/prompt.js"
import { ENGINES, sendable } from "@engine/reverse.js"
import { evidenceItems, SECTIONS } from "@engine/widgets.js"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Chips } from "@/components/chips"
import { Icon } from "@/components/icon"
import { copyText } from "@/components/obsidian-button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, fileUrl, type CaseIndex, type EvidenceView, type Manifest, type TunnelState, type Verdict } from "@/lib/api"
import { useBasket } from "@/lib/basket"
import { t } from "@/lib/i18n"
import { caseHref, go } from "@/lib/route"
import { useCaseEvents } from "@/lib/use-events"
import { cn } from "@/lib/utils"
import { TONE } from "@/lib/tones"

type Item = ReturnType<typeof evidenceItems>[number]
const TITLE: Record<string, string> = { original: "Originals", masked: "Masked copies", frame: "Video frames", candidate: "Similar images", crop: "Crops and sheets", capture: "Captures", remote: "Remote images" }
const VERDICT: Record<string, { label: string; icon: string; tone: keyof typeof TONE }> = {
  match: { label: "match", icon: "circle-check", tone: "emerald" }, "no match": { label: "no match", icon: "circle-x", tone: "rose" }, unsure: { label: "unsure", icon: "circle-help", tone: "amber" },
}
const ENGINE_ICON: Record<string, string> = { lens: "scan-search", yandex: "search", bing: "search", tineye: "eye", baidu: "search" }
const UNREADABLE = /\.(heic|heif|tiff?)$/i
const src = (slug: string, it: Item) => (it.file ? fileUrl(slug, it.file) : String(it.url))
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16)

function VerdictChip({ v }: { v: string | undefined }) {
  const x = v ? VERDICT[v] : null
  return <Badge className={cn("gap-1", x ? TONE[x.tone] : "")} variant={x ? "default" : "outline"}><Icon name={x?.icon ?? "circle-dashed"} aria-hidden />{x ? t(x.label) : t("Not judged yet")}</Badge>
}

export function EvidenceWidget({ index, manifest, pulse }: { index: CaseIndex; manifest: Manifest; pulse: number }) {
  const slug = index.slug, basket = useBasket()
  const [view, setView] = useState<EvidenceView | null>(null), [full, setFull] = useState<Item | null>(null)
  useEffect(() => { api.view<EvidenceView>(slug, "evidence").then(setView, () => setView(null)) }, [slug, pulse])
  const items = useMemo(() => evidenceItems(index, view) as Item[], [index, view])
  return (
    <div className="flex flex-col gap-6 py-4">
      <ReversePanel index={index} items={items} unmaskedOk={manifest.id === "verify-media"} />
      {SECTIONS.map(s => {
        const xs = items.filter(i => i.section === s)
        if (!xs.length) return null
        return (
          <section key={s} aria-labelledby={`ev-${s}`} className="flex flex-col gap-2">
            <h2 id={`ev-${s}`} className="text-sm font-semibold">{t(TITLE[s])} <span className="font-normal text-muted-foreground tabular-nums">{xs.length}</span></h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {xs.map(it => <Card key={it.file ?? it.url} slug={slug} it={it} onOpen={() => setFull(it)} />)}
            </ul>
          </section>
        )
      })}
      {!items.length && <p className="py-10 text-center text-sm text-muted-foreground">{t("No picture or video in Evidence yet.")}</p>}
      <Verdicts index={index} />
      <FullScreen slug={slug} it={full} manifest={manifest} onClose={() => setFull(null)} onAdd={basket.add} />
    </div>
  )
}

// A picture another service hosts (a ground image: its thumbnail, its page). The thumbnail is asked for only when its host
// is a real one (the reserved names .example .test .invalid .localhost never are), and a thumbnail that fails to load
// (a signed link that expired, a provider down) gives way to a tile that still links to the page.
const RESERVED_HOST = /(^|\.)(example|test|invalid|localhost)$/i
const remoteHost = (u?: string) => { try { return new URL(String(u)).hostname } catch { return "" } }
const canLoad = (u?: string) => /^https?:\/\//i.test(String(u)) && !!remoteHost(u) && !RESERVED_HOST.test(remoteHost(u))
function RemoteThumb({ it, className }: { it: Item; className?: string }) {
  const [broken, setBroken] = useState(false), site = it.site ?? remoteHost(it.page ?? it.url)
  if (broken || !canLoad(it.url)) return <span className={cn("grid place-items-center gap-1 bg-muted p-2 text-center text-xs text-muted-foreground", className)}><Icon name="image-off" className="size-6" aria-hidden />{t("Image unavailable — open it on {site}", { site })}</span>
  return <img src={String(it.url)} alt={it.label} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn("object-cover", className)} />
}
function RemoteMeta({ it }: { it: Item }) {
  const site = it.site ?? remoteHost(it.page ?? it.url)
  return (
    <span className="flex flex-col gap-0.5 text-muted-foreground">
      <span className="flex flex-wrap items-center gap-x-2">
        {it.date && <span className="tabular-nums">{it.date}</span>}
        {it.heading != null && <span className="inline-flex items-center gap-1 tabular-nums" title={t("Bearing the camera looked at")}><Icon name="navigation-2" className="size-3" style={{ transform: `rotate(${it.heading}deg)` }} aria-hidden />{it.heading}°</span>}
      </span>
      <span>{it.license ? t("Licence: {license}", { license: it.license }) : t("Licence: see {site}", { site })}{it.author ? ` · ${it.author}` : ""}</span>
      {it.page && /^https?:\/\//i.test(it.page) && <a href={it.page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2"><Icon name="external-link" className="size-3" aria-hidden />{t("Open on {site}", { site })}</a>}
    </span>
  )
}
function RemoteCard({ it, onOpen }: { it: Item; onOpen: () => void }) {
  return (
    <li data-testid="remote-card" className="flex flex-col overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <button type="button" onClick={onOpen} aria-label={t("Open {label}", { label: it.label })} className="aspect-[4/3] w-full bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><RemoteThumb it={it} className="size-full" /></button>
      <div className="flex flex-col gap-1 p-2 text-xs"><span className="truncate font-medium" title={it.label}>{it.label}</span><RemoteMeta it={it} /></div>
    </li>
  )
}

function Card({ slug, it, onOpen }: { slug: string; it: Item; onOpen: () => void }) {
  if (it.section === "remote") return <RemoteCard it={it} onOpen={onOpen} />
  return (
    <li className="flex flex-col overflow-hidden rounded-xl ring-1 ring-foreground/10">
      {it.video ? <video src={src(slug, it)} preload="metadata" controls className="aspect-[4/3] w-full bg-muted object-contain" />
        : it.file && UNREADABLE.test(it.file) ? <button type="button" onClick={onOpen} className="grid aspect-[4/3] w-full place-items-center gap-1 bg-muted p-2 text-center text-xs text-muted-foreground"><Icon name="file-image" className="size-6" aria-hidden />{t("Open in Obsidian")}</button>
        : <button type="button" onClick={onOpen} aria-label={t("Open {label}", { label: it.label })} className="aspect-[4/3] w-full bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><img src={src(slug, it)} alt={it.label} loading="lazy" className="size-full object-cover" /></button>}
      <div className="flex flex-col gap-1 p-2 text-xs">
        <span className="truncate font-medium" title={it.label}>{it.label}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          {it.section === "original" && <><Badge variant="outline" className="font-mono">{it.id}</Badge>{it.kind === "thumbnail" && <Badge variant="secondary" className="gap-1"><Icon name="images" aria-hidden />{t("Thumbnail")}</Badge>}<span className="inline-flex items-center gap-1"><Icon name="lock" className="size-3" aria-hidden />{t("read-only")}</span></>}
          {it.section === "masked" && <span className="inline-flex items-center gap-1"><Icon name="eraser" className="size-3" aria-hidden />{t("masked copy of {of}", { of: String(it.of ?? "") })}</span>}
          {it.section === "candidate" && <><span>#{it.rank}</span>{it.site && <span className="truncate">{it.site}</span>}{it.score != null && <span className="tabular-nums">{it.score}</span>}<VerdictChip v={it.verdict} /></>}
          {it.section === "frame" && it.t != null && <span className="tabular-nums">{Number(it.t).toFixed(1)} s</span>}
          {it.section === "remote" && <span>{[it.license, it.author].filter(Boolean).join(" · ")}</span>}
        </span>
      </div>
    </li>
  )
}

function FullScreen({ slug, it, manifest, onClose, onAdd }: { slug: string; it: Item | null; manifest: Manifest; onClose: () => void; onAdd: (i: { tag: string; text: string }) => void }) {
  const acts = actionsFor(manifest, "evidence") as Manifest["actions"]
  return (
    <Dialog open={!!it} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[95vh] overflow-auto sm:max-w-4xl">
        {it && <>
          <DialogHeader><DialogTitle className="truncate">{it.label}</DialogTitle><DialogDescription className="font-mono break-all">{it.file ?? it.page ?? it.url}</DialogDescription></DialogHeader>
          {it.video ? <video src={src(slug, it)} controls className="max-h-[60vh] w-full" /> : it.section === "remote" ? <RemoteThumb it={it} className="max-h-[60vh] min-h-40 w-full object-contain" /> : <img src={src(slug, it)} alt={it.label} className="max-h-[60vh] w-full object-contain" />}
          {it.section === "remote" && <div className="text-xs"><RemoteMeta it={it} /></div>}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {it.sha256 ? <><span className="font-mono break-all" data-testid="sha256">{it.sha256}</span><Button type="button" size="xs" variant="outline" onClick={() => copyText(it.sha256!, t("SHA-256 copied"))}><Icon name="copy" data-icon="inline-start" aria-hidden />{t("Copy")}</Button></> : <span className="text-muted-foreground">{t("Not hashed: the engine makes it again")}</span>}
            {it.page && <Button type="button" size="xs" variant="outline" asChild><a href={it.page} target="_blank" rel="noreferrer"><Icon name="external-link" data-icon="inline-start" aria-hidden />{t("Open the page")}</a></Button>}
          </div>
          <DialogFooter className="flex-wrap sm:justify-start">
            {it.file && acts.map(a => <Button key={a.id} type="button" size="sm" variant="outline" onClick={() => { onAdd(itemOf(a.prompt, { file: it.file! })); toast.success(t("Added to the prompt")) }}><Icon name={a.icon} data-icon="inline-start" aria-hidden />{a.label}</Button>)}
            <Button type="button" size="sm" variant="outline" onClick={() => { onAdd({ tag: "question", text: `About ${it.file ?? it.url}: ` }); toast.success(t("Added to the prompt")) }}><Icon name="message-circle-question" data-icon="inline-start" aria-hidden />{t("Ask Agent about this file")}</Button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  )
}

function Verdicts({ index }: { index: CaseIndex }) {
  const vs = index.reverse?.verdicts ?? []
  if (!vs.length) return null
  return (
    <section aria-labelledby="ev-verdicts" className="flex flex-col gap-2">
      <h2 id="ev-verdicts" className="text-sm font-semibold">{t("Verdicts")} <span className="font-normal text-muted-foreground tabular-nums">{vs.length}</span></h2>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground"><tr><th className="p-2 font-medium">{t("Candidate")}</th><th className="p-2 font-medium">{t("Verdict")}</th><th className="p-2 font-medium">{t("Reason")}</th><th className="p-2 font-medium">{t("Compared")}</th><th className="p-2 font-medium">{t("Journal")}</th></tr></thead>
          <tbody className="divide-y">
            {vs.map((v: Verdict, i) => (
              <tr key={i} className="align-top">
                <td className="p-2 font-mono">{v.candidate}</td><td className="p-2"><VerdictChip v={v.verdict} /></td><td className="p-2">{v.reason}</td><td className="p-2">{v.compared.join(", ") || "—"}</td>
                <td className="p-2"><button type="button" className="font-mono underline" onClick={() => go(caseHref(index.slug, "brain", `Journal.md#^${v.journal}`))}>{v.journal}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Reverse search: the tunnel (open, close, one button per engine), and « Paste results »
function ReversePanel({ index, items, unmaskedOk }: { index: CaseIndex; items: Item[]; unmaskedOk: boolean }) {
  const slug = index.slug, basket = useBasket(), keeps = index.props.image_may_leave !== true
  const [tun, setTun] = useState<TunnelState | null>(null), [picked, setPicked] = useState<string[]>([]), [minutes, setMinutes] = useState("15"), [busy, setBusy] = useState(false)
  const [paste, setPaste] = useState(false), [ask, setAsk] = useState(false), [now, setNow] = useState(() => Date.now())
  const load = useCallback(() => { api.tunnel(slug).then(setTun, () => setTun(null)) }, [slug])
  useEffect(() => { if (!keeps) load() }, [load, keeps])
  useCaseEvents(slug, { event: e => { if (e.kind === "tunnel.open" || e.kind === "tunnel.close") load() } })
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(i) }, [])
  const ok = useMemo(() => (rel: string) => sendable(rel, { evidence: index.evidence as never[], clear: index.reverse?.clear ?? {} }) as { ok: boolean; why: string }, [index.evidence, index.reverse])
  const files = items.filter(i => i.file && /\.(jpe?g|png|webp|gif)$/i.test(i.file) && i.section !== "capture") as (Item & { file: string })[]
  if (keeps) return <div className="flex items-center gap-2 rounded-xl p-3 text-sm ring-1 ring-foreground/10"><Icon name="hard-drive" className="size-4 text-muted-foreground" aria-hidden />{t("The frame keeps the image on this machine: no reverse search by link")}</div>
  // verify-media alone may send a picture people show on, unmasked (the engine, sendList, refuses it for any other type)
  const bare = (rel: string) => unmaskedOk && !ok(rel).ok && ok(rel).why.startsWith("people may show") && /\.(jpe?g|png|webp|gif)$/i.test(rel) && !rel.startsWith("Evidence/captures/")
  const unmasked = picked.some(bare)
  async function openIt() {
    setBusy(true)
    try { await api.openTunnel(slug, picked, Number(minutes), unmasked); load() } catch (e) { toast.error((e as Error).message) }
    setBusy(false)
  }
  const left = tun?.open ? Math.max(0, Math.round((new Date(tun.until).getTime() - now) / 60000)) : 0
  return (
    <section aria-labelledby="ev-reverse" className="flex flex-col gap-3 rounded-xl p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ev-reverse" className="mr-auto flex items-center gap-2 text-sm font-semibold"><Icon name="globe" className="size-4" aria-hidden />{t("Reverse search")}</h2>
        <Button type="button" size="sm" variant="outline" onClick={() => setPaste(true)}><Icon name="clipboard-paste" data-icon="inline-start" aria-hidden />{t("Paste results")}</Button>
      </div>
      {tun && !tun.open && !tun.cloudflared && (
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>{t("cloudflared is missing: reverse search by link is off; Yandex and Baidu still run in recon")}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => { basket.add({ tag: "install", text: "cloudflared" }); toast.success(t("Added to the prompt")) }}>{t("Install cloudflared")}</Button></div>
      )}
      {tun && !tun.open && tun.cloudflared && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1.5">
            {files.map(f => { const s = ok(f.file), b = bare(f.file), can = s.ok || b; return (
              <li key={f.file} className={cn("flex items-center gap-2 text-sm", !can && "opacity-50")} title={b ? t("verify-media looks for exact copies: this picture can leave as it is") : s.why}>
                <Checkbox id={`rv-${f.file}`} checked={picked.includes(f.file)} disabled={!can} onCheckedChange={c => setPicked(p => (c ? [...p, f.file] : p.filter(x => x !== f.file)))} />
                <img src={fileUrl(slug, f.file)} alt="" className="size-8 rounded object-cover" loading="lazy" /><label htmlFor={`rv-${f.file}`} className="min-w-0 flex-1 truncate">{f.label}</label>
                {b && <Badge variant="outline" className="gap-1"><Icon name="scan-eye" aria-hidden />{t("unmasked")}</Badge>}
                {!can && <span className="hidden text-xs text-muted-foreground sm:inline">{s.why}</span>}
              </li>) })}
            {!files.length && <li className="text-sm text-muted-foreground">{t("No picture to send yet.")}</li>}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Chips label={t("Tunnel duration")} size="xs" value={minutes} onChange={setMinutes} options={["15", "30", "60"].map(m => ({ value: m, label: `${m} min`, icon: "timer" }))} />
            <Button type="button" size="sm" disabled={!picked.length || busy} onClick={() => (unmasked ? setAsk(true) : openIt())}><Icon name={unmasked ? "scan-eye" : "globe"} data-icon="inline-start" aria-hidden />{unmasked ? t("Open unmasked") : t("Open tunnel")}</Button>
          </div>
        </div>
      )}
      {tun?.open && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span>{t("Tunnel open until {time} · {left} min left", { time: hhmm(tun.until), left })}</span><span className="text-muted-foreground">{t(tun.served === 1 ? "fetched {n} time" : "fetched {n} times", { n: tun.served })}</span>
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => api.closeTunnel(slug).then(load, e => toast.error((e as Error).message))}><Icon name="circle-x" data-icon="inline-start" aria-hidden />{t("Close tunnel")}</Button></div>
          <ul className="flex flex-col gap-2">
            {tun.files.map(f => (
              <li key={f.file} className="flex flex-wrap items-center gap-2">
                <img src={fileUrl(slug, f.file)} alt="" className="size-10 rounded object-cover" /><span className="min-w-0 flex-1 truncate text-sm">{f.file.split("/").pop()}</span>
                {f.links.map(l => <Button key={l.engine} type="button" size="xs" variant="outline" asChild title={l.verified ? t("checked on {date}", { date: l.verified }) : t("link form not checked yet")}><a href={l.url} target="_blank" rel="noreferrer"><Icon name={ENGINE_ICON[l.engine] ?? "search"} data-icon="inline-start" aria-hidden />{l.label}</a></Button>)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("Send this picture unmasked?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Verify-media looks for exact copies, so the picture leaves unmasked (only its EXIF and GPS are stripped): anyone visible in it reaches Google Lens, Yandex, Bing, TinEye and Baidu. The Journal records which file left unmasked and to which engines.")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("Cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => { setAsk(false); openIt() }}>{t("Open unmasked")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PasteDialog open={paste} onClose={() => setPaste(false)} slug={slug} files={files} sent={tun?.open ? tun.files.map(f => f.file) : []} />
    </section>
  )
}

function PasteDialog({ open, onClose, slug, files, sent }: { open: boolean; onClose: () => void; slug: string; files: { file: string; label: string }[]; sent: string[] }) {
  const basket = useBasket(), choices = sent.length ? sent : files.map(f => f.file)
  const [engine, setEngine] = useState("lens"), [file, setFile] = useState<string>(""), [text, setText] = useState(""), [caps, setCaps] = useState<string[]>([]), zone = useRef<HTMLDivElement>(null)
  const chosen = file || choices[0] || ""
  async function take(blobs: File[]) {
    const stem = chosen.split("/").pop()!.replace(/\.[^.]+$/, "")
    for (const b of blobs.filter(x => x.type.startsWith("image/"))) {
      try { const r = await api.capture(slug, b, `${engine}-${stem}.png`); setCaps(c => [...c, r.path]) } catch (e) { toast.error((e as Error).message) }
    }
  }
  function add() {
    const label = ENGINES.find(e => e.id === engine)?.label ?? engine
    basket.add({ tag: "reverse-results", text: `${label} on ${chosen}: ${text.trim()}${caps.length ? ` | captures: ${caps.join(", ")}` : ""}` })
    toast.success(t("Added to the prompt")); setText(""); setCaps([]); onClose()
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Paste results")}</DialogTitle><DialogDescription>{t("What a search engine showed for one picture: text and screenshots go to the agent.")}</DialogDescription></DialogHeader>
        <Chips label={t("Engine")} size="xs" value={engine} onChange={setEngine} options={ENGINES.map(e => ({ value: e.id, label: e.label, icon: ENGINE_ICON[e.id] ?? "search" }))} />
        <Select value={chosen} onValueChange={setFile}><SelectTrigger className="w-full" aria-label={t("File")}><SelectValue placeholder={t("File…")} /></SelectTrigger>
          <SelectContent><SelectGroup>{choices.map(f => <SelectItem key={f} value={f}>{f.split("/").pop()}</SelectItem>)}</SelectGroup></SelectContent></Select>
        <Textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={t("Paste the text of the results")} aria-label={t("Pasted text")} />
        <div ref={zone} role="group" tabIndex={0} aria-label={t("Paste or drop screenshots here")} data-testid="paste-zone"
          onPaste={e => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); take(f) } }}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); take([...e.dataTransfer.files]) }}
          className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {t("Paste or drop screenshots here. Captures are saved to the case right away.")}
          {caps.length > 0 && <ul className="mt-2 flex flex-col gap-0.5 font-mono text-xs text-foreground">{caps.map(c => <li key={c}>{c}</li>)}</ul>}
        </div>
        <DialogFooter><Button type="button" onClick={add} disabled={!chosen || (!text.trim() && !caps.length)}>{t("Add to prompt")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
