import { ArrowLeftIcon, MapPinIcon, PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { TypeIcon } from "@/components/type-icon"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Hit, type PropertyType } from "@/lib/api"
import { TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"

const ALL = Object.keys(TYPE_LABEL) as PropertyType[]
// the numbers of a listing, those of its type only (a plot has no rooms, a parking no floor); `more` under « Plus de
// détails ». A plot's surface is its land.
const NUMBERS: { k: string; label: string; types: PropertyType[]; more?: boolean }[] = [
  { k: "price", label: "Prix (€)", types: ALL },
  { k: "area", label: "Surface (m²)", types: ALL },
  { k: "land_area", label: "Terrain (m²)", types: ["house"] },
  { k: "rooms", label: "Pièces", types: ["flat", "house"] },
  { k: "bedrooms", label: "Chambres", types: ["flat", "house"] },
  { k: "floor", label: "Étage", types: ["flat"] },
  { k: "construction_year", label: "Année de construction", types: ["flat", "house", "premises"], more: true },
  { k: "condo_yearly", label: "Charges de copropriété (€/an)", types: ["flat", "parking", "premises"], more: true },
  { k: "property_tax", label: "Taxe foncière (€/an)", types: ALL, more: true },
  { k: "agency_fees", label: "Frais d'agence inclus (€)", types: ALL, more: true },
]
const FEATURES: Record<string, [string, PropertyType[]]> = {
  elevator: ["Ascenseur", ["flat"]], balcony: ["Balcon", ["flat"]], terrace: ["Terrasse", ["flat", "house"]],
  garden: ["Jardin", ["house"]], cellar: ["Cave", ["flat", "house"]], parking: ["Parking", ["flat", "house"]],
}
const PUBLISHER = { PRIVATE_INDIVIDUAL: "Particulier", REAL_ESTATE_AGENCY: "Agence" } as const

// A listing the user saw elsewhere (a shop window, a visit, a tip), typed in a form: the server adds it as Claude's
// add --file does, free, with its building data. Only what is typed is sent: an empty field stays unknown.
export function ManualListing({ open, onOpenChange, onBack }: { open: boolean; onOpenChange: (o: boolean) => void; onBack: () => void }) {
  const { slug, data, reload, select } = useSearch()
  const [type, setType] = useState<PropertyType>(data.search.types?.[0] ?? "flat")
  const [f, setF] = useState<Record<string, string>>({}), [features, setFeatures] = useState<string[]>([])
  const [dpe, setDpe] = useState(""), [publisher, setPublisher] = useState("")
  const [q, setQ] = useState(""), [hits, setHits] = useState<Hit[]>([]), [hit, setHit] = useState<Hit | null>(null)
  const [busy, setBusy] = useState(false)
  const of = (ts: PropertyType[]) => ts.includes(type)

  useEffect(() => {
    if (q.length < 3 || hit) return
    const t = setTimeout(() => api.autocomplete(q).then(setHits).catch(() => setHits([])), 200)
    return () => clearTimeout(t)
  }, [q, hit])

  const text = (k: string) => ({ value: f[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) })
  const numberField = (n: (typeof NUMBERS)[number]) => (
    <Field key={n.k}>
      <FieldLabel htmlFor={`m-${n.k}`}>{n.k === "area" && type === "land" ? "Terrain (m²)" : n.label}</FieldLabel>
      <Input id={`m-${n.k}`} type="number" inputMode="numeric" min={n.k === "floor" ? 0 : 1} required={n.k === "price" || n.k === "area"} {...text(n.k)} />
    </Field>
  )

  function body() {
    const b: Record<string, unknown> = { type }
    for (const n of NUMBERS) if (of(n.types) && f[n.k]) b[n.k] = Number(f[n.k])
    if (type === "land") b.land_area = b.area
    for (const k of features) if (of(FEATURES[k][1])) b[k] = true
    if (dpe && of(["flat", "house"])) b.dpe = dpe
    for (const k of ["url", "phone", "description"]) if (f[k]?.trim()) b[k] = f[k].trim()
    if (publisher) b.publisher_type = publisher
    if (f.publisher?.trim() || publisher) b.publisher = f.publisher?.trim() || PUBLISHER[publisher as keyof typeof PUBLISHER]
    // a number and a street: the engine places it and finds its building; a street or a place: its point only
    if (hit) Object.assign(b, hit.kind === "housenumber" ? { address: hit.fulltext.split(", ")[0], postcode: hit.zipcode, city: hit.city } : { point: [hit.x, hit.y] })
    else if (q.trim()) b.address = q.trim()
    return b
  }
  function reset() {
    setF({}); setFeatures([]); setDpe(""); setPublisher(""); setQ(""); setHit(null); setHits([])
  }
  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const l = await api.addListing(slug, body())
      await reload()
      select(l.id)
      toast.success("Annonce ajoutée", { description: l.building ? "Son immeuble, ses ventes et ses risques sont dans son dossier." : undefined })
    } catch (err) {
      const x = err as Error & { id?: string }
      if (x.message !== "known") return toast.error("L'annonce n'a pas été ajoutée", { description: `Détail technique : ${x.message}` })
      select(x.id ?? null)
      toast.info("Cette annonce est déjà dans la recherche : voici son dossier")
    } finally { setBusy(false) }
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={create} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Créer une annonce</DialogTitle>
            <DialogDescription>Ce que vous savez du bien, rien de plus : un champ vide reste inconnu. L'immeuble, ses ventes et ses risques sont ajoutés gratuitement.</DialogDescription>
          </DialogHeader>
          <FieldSet>
            <FieldLegend variant="label">Type de bien</FieldLegend>
            <ToggleGroup type="single" variant="outline" size="sm" value={type} onValueChange={v => v && setType(v as PropertyType)} className="flex-wrap justify-start">
              {ALL.map(t => <ToggleGroupItem key={t} value={t}><TypeIcon type={t} />{TYPE_LABEL[t]}</ToggleGroupItem>)}
            </ToggleGroup>
          </FieldSet>
          <FieldGroup className="grid grid-cols-2 gap-3">
            {NUMBERS.filter(n => !n.more && of(n.types)).map(numberField)}
            {of(["flat", "house"]) && <Field>
              <FieldLabel htmlFor="m-dpe">DPE</FieldLabel>
              <Select value={dpe || "any"} onValueChange={v => setDpe(v === "any" ? "" : v)}>
                <SelectTrigger id="m-dpe" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="any">Inconnu</SelectItem>{[..."ABCDEFG"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>}
          </FieldGroup>
          <Field>
            <FieldLabel>Adresse</FieldLabel>
            <Command shouldFilter={false} className="rounded-lg border">
              <CommandInput aria-label="Adresse" placeholder="12 rue Paul Bert, Lyon" value={q} onValueChange={v => { setQ(v); setHit(null) }} />
              {!hit && q.length >= 3 && (
                <CommandList>
                  <CommandEmpty>Aucun lieu trouvé : l'adresse sera cherchée telle quelle.</CommandEmpty>
                  <CommandGroup>
                    {hits.map(h => <CommandItem key={h.fulltext} value={h.fulltext} onSelect={() => { setHit(h); setQ(h.fulltext) }}><MapPinIcon />{h.fulltext}</CommandItem>)}
                  </CommandGroup>
                </CommandList>
              )}
            </Command>
          </Field>
          <Field>
            <FieldLabel htmlFor="m-url">Lien de l'annonce</FieldLabel>
            <Input id="m-url" type="url" pattern="https?://.+" placeholder="https://… (facultatif)" {...text("url")} />
          </Field>
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium select-none">Plus de détails</summary>
            <div className="mt-3 flex flex-col gap-4">
              {Object.values(FEATURES).some(([, ts]) => of(ts)) && (
                <ToggleGroup type="multiple" variant="outline" size="sm" value={features} onValueChange={setFeatures} className="flex-wrap justify-start" aria-label="Atouts">
                  {Object.entries(FEATURES).filter(([, [, ts]]) => of(ts)).map(([k, [label]]) => <ToggleGroupItem key={k} value={k}>{label}</ToggleGroupItem>)}
                </ToggleGroup>
              )}
              <FieldGroup className="grid grid-cols-2 gap-3">{NUMBERS.filter(n => n.more && of(n.types)).map(numberField)}</FieldGroup>
              <FieldSet>
                <FieldLegend variant="label">Vendeur</FieldLegend>
                <ToggleGroup type="single" variant="outline" size="sm" value={publisher} onValueChange={setPublisher} className="justify-start">
                  {Object.entries(PUBLISHER).map(([k, v]) => <ToggleGroupItem key={k} value={k}>{v}</ToggleGroupItem>)}
                </ToggleGroup>
                <FieldGroup className="grid grid-cols-2 gap-3">
                  <Field><FieldLabel htmlFor="m-publisher">Nom</FieldLabel><Input id="m-publisher" {...text("publisher")} /></Field>
                  <Field><FieldLabel htmlFor="m-phone">Téléphone</FieldLabel><Input id="m-phone" type="tel" {...text("phone")} /></Field>
                </FieldGroup>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="m-description">Description</FieldLabel>
                <Textarea id="m-description" rows={3} {...text("description")} />
              </Field>
            </div>
          </details>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onBack}><ArrowLeftIcon data-icon="inline-start" />Retour</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}{busy ? "Ajout…" : "Créer l'annonce"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
