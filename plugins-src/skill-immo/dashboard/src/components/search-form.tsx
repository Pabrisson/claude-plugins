import { ClipboardCopyIcon, MapPinIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TypeIcon } from "@/components/type-icon"
import { api, type Criteria, type PropertyType } from "@/lib/api"
import { criteriaLabels, TYPE_LABEL, TYPE_PLURAL } from "@/lib/format"

// "budget_max=450000 rooms_min=3": the criteria as the engine takes them, an empty value clearing one
export const criteriaArg = (c: Criteria) => Object.entries(c).map(([k, v]) => `${k}=${v ?? ""}`).join(" ")

// the types of property a search covers, several at once
export function TypesField({ value, onChange }: { value: PropertyType[]; onChange: (t: PropertyType[]) => void }) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Types de bien</FieldLegend>
      <ToggleGroup type="multiple" variant="outline" size="sm" value={value} onValueChange={v => v.length && onChange(v as PropertyType[])} className="flex-wrap justify-start">
        {(Object.keys(TYPE_LABEL) as PropertyType[]).map(t => <ToggleGroupItem key={t} value={t}><TypeIcon type={t} />{TYPE_LABEL[t]}</ToggleGroupItem>)}
      </ToggleGroup>
    </FieldSet>
  )
}

// the criteria, those of the chosen types only (a parking has no rooms, a plot no DPE)
export function CriteriaFields({ value, onChange, types = ["flat"] }: { value: Criteria; onChange: (c: Criteria) => void; types?: PropertyType[] }) {
  const has = (...ts: PropertyType[]) => ts.some(t => types.includes(t))
  const n = (k: keyof Criteria) => ({
    value: (value[k] as number | undefined) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value === "" ? undefined : Number(e.target.value) }),
  })
  return (
    <FieldGroup className="grid grid-cols-2 gap-3">
      <Field><FieldLabel htmlFor="bmax">Budget max (€)</FieldLabel><Input id="bmax" type="number" inputMode="numeric" step={5000} {...n("budget_max")} /></Field>
      <Field><FieldLabel htmlFor="bmin">Budget min (€)</FieldLabel><Input id="bmin" type="number" inputMode="numeric" step={5000} {...n("budget_min")} /></Field>
      {has("flat", "house") && <Field><FieldLabel htmlFor="rmin">Pièces min</FieldLabel><Input id="rmin" type="number" min={1} {...n("rooms_min")} /></Field>}
      {has("flat", "house") && <Field><FieldLabel htmlFor="rmax">Pièces max</FieldLabel><Input id="rmax" type="number" min={1} {...n("rooms_max")} /></Field>}
      {has("flat", "house", "premises") && <Field><FieldLabel htmlFor="amin">Surface min (m²)</FieldLabel><Input id="amin" type="number" {...n("area_min")} /></Field>}
      {has("house", "land") && <Field><FieldLabel htmlFor="lmin">Terrain min (m²)</FieldLabel><Input id="lmin" type="number" step={50} {...n("land_min")} /></Field>}
      {has("flat") && <Field><FieldLabel htmlFor="fmin">Étage min</FieldLabel><Input id="fmin" type="number" min={0} {...n("floor_min")} /></Field>}
      {has("flat", "house") && <Field>
        <FieldLabel htmlFor="dpe">DPE au pire</FieldLabel>
        <Select value={value.dpe_max ?? "any"} onValueChange={v => onChange({ ...value, dpe_max: v === "any" ? undefined : v })}>
          <SelectTrigger id="dpe" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="any">Peu importe</SelectItem>{[..."ABCDEFG"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>}
      {has("flat", "house") && (
        <div className="flex flex-col justify-end gap-2">
          {has("flat") && <Field orientation="horizontal"><Switch id="elev" checked={!!value.elevator} onCheckedChange={c => onChange({ ...value, elevator: c || undefined })} /><FieldLabel htmlFor="elev">Ascenseur</FieldLabel></Field>}
          <Field orientation="horizontal"><Switch id="out" checked={!!value.outdoor} onCheckedChange={c => onChange({ ...value, outdoor: c || undefined })} /><FieldLabel htmlFor="out">Extérieur</FieldLabel></Field>
        </div>
      )}
    </FieldGroup>
  )
}

// A new search: the place (Géoplateforme's autocomplete, free), the zone, the mode, the types and the criteria, as
// a prompt to copy: Claude creates the search (the dashboard starts nothing by itself).
export const newSearchPrompt = (o: { place: string; street: boolean; zone: string; radius: number; mode: string; types: PropertyType[]; criteria: Criteria }) => [
  `/skill-immo:property-search nouvelle recherche : ${o.place}`,
  `- zone : ${o.zone === "radius" ? (o.street ? `le long de la rue, ${o.radius} m de part et d'autre` : `${o.radius} m autour du lieu`) : o.zone === "iris" ? "le quartier (IRIS)" : "la commune"}`,
  `- types : ${o.types.map(t => TYPE_PLURAL[t].toLowerCase()).join(", ")}`,
  `- annonces : ${o.mode === "stream-estate" ? "API payante (avec mon accord avant chaque dépense)" : "OpenData (gratuit)"}`,
  `- critères : ${Object.keys(o.criteria).length ? `${criteriaLabels(o.criteria).join(", ")} (${criteriaArg(o.criteria)})` : "aucun"}`,
].join("\n")

export function NewSearch({ streamEstate, trigger }: { streamEstate: boolean; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState(""), [place, setPlace] = useState<string | null>(null), [street, setStreet] = useState(false)
  const [hits, setHits] = useState<{ fulltext: string; kind: string }[]>([])
  const [zone, setZone] = useState("radius"), [radius, setRadius] = useState(500)
  const [mode, setMode] = useState(streamEstate ? "stream-estate" : "classic")
  const [criteria, setCriteria] = useState<Criteria>({}), [types, setTypes] = useState<PropertyType[]>(["flat"])

  useEffect(() => {
    if (q.length < 3 || q === place) return
    const t = setTimeout(() => api.autocomplete(q).then(setHits).catch(() => setHits([])), 200)
    return () => clearTimeout(t)
  }, [q, place])

  async function copy() {
    await navigator.clipboard.writeText(newSearchPrompt({ place: place ?? q, street, zone, radius, mode, types, criteria }))
    toast.success("Prompt copié : collez-le dans Claude Code", { description: "Claude crée la recherche ; elle apparaîtra ici." })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle recherche</DialogTitle>
          <DialogDescription>Une adresse, une rue ou un quartier. Le prompt copié, Claude crée la recherche : les ventes réelles, le quartier et les risques sont gratuits.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Command shouldFilter={false} className="rounded-lg border">
            <CommandInput placeholder="20 rue Paul Bert, Lyon" value={q} onValueChange={v => { setQ(v); setPlace(null) }} />
            {!place && q.length >= 3 && (
              <CommandList>
                <CommandEmpty>Aucun lieu trouvé.</CommandEmpty>
                <CommandGroup>
                  {hits.map(h => <CommandItem key={h.fulltext} value={h.fulltext} onSelect={() => { setPlace(h.fulltext); setQ(h.fulltext); setStreet(h.kind === "street"); setRadius(h.kind === "street" ? 300 : 500) }}><MapPinIcon />{h.fulltext}</CommandItem>)}
                </CommandGroup>
              </CommandList>
            )}
          </Command>
          <FieldSet>
            <FieldLegend variant="label">Zone</FieldLegend>
            <ToggleGroup type="single" variant="outline" value={zone} onValueChange={v => v && setZone(v)}>
              <ToggleGroupItem value="radius">{street ? "Le long de la rue" : "Autour du lieu"}</ToggleGroupItem>
              <ToggleGroupItem value="iris">Quartier (IRIS)</ToggleGroupItem>
              <ToggleGroupItem value="commune">Commune</ToggleGroupItem>
            </ToggleGroup>
            {zone === "radius" && (
              <Field>
                <FieldLabel>{street ? `Largeur : ${radius} m de part et d'autre de la rue` : `Rayon : ${radius} m`}</FieldLabel>
                <Slider min={100} max={1500} step={50} value={[radius]} onValueChange={([v]) => setRadius(v)} aria-label={street ? "Largeur" : "Rayon"} />
              </Field>
            )}
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Source des annonces</FieldLegend>
            <ToggleGroup type="single" variant="outline" value={mode} onValueChange={v => v && setMode(v)}>
              <ToggleGroupItem value="stream-estate" disabled={!streamEstate}>API payante</ToggleGroupItem>
              <ToggleGroupItem value="classic">OpenData</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>{streamEstate ? "API payante : les annonces de tous les portails, payantes (votre accord est demandé avant chaque dépense). OpenData : open data et annonces trouvées par Claude, gratuit." : "Sans clé de l'API payante : open data et annonces trouvées par Claude, gratuit."}</FieldDescription>
          </FieldSet>
          <TypesField value={types} onChange={setTypes} />
          <CriteriaFields value={criteria} onChange={setCriteria} types={types} />
        </FieldGroup>
        <DialogFooter>
          <Button onClick={copy} disabled={q.length < 3}><ClipboardCopyIcon data-icon="inline-start" />Copier le prompt pour Claude</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
