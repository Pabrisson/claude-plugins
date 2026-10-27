import { budget } from "@engine/budget.js"
import { score } from "@engine/decide.js"
import { daysOnline, negotiation, typeOf, unitPrice } from "@engine/market.js"
import { MessageSquarePlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Dpe } from "@/components/dpe"
import { nearby } from "@/components/map-view"
import { Gap } from "@/components/ruler"
import { StatusBadge } from "@/components/status"
import { TypeIcon } from "@/components/type-icon"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Listing, PropertyType } from "@/lib/api"
import { eur, num, perUnit, share, titleOf, TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"

// 2 to 4 listings side by side, on what decides between them
export function CompareTab() {
  const { data, compare, toggleCompare, marketFor, aidsFor, profile, select, addFeedback } = useSearch()
  const ls = compare.map(id => data.listings.find(l => l.id === id)).filter(Boolean) as Listing[]
  if (ls.length < 2)
    return (
      <Empty className="m-4 border">
        <EmptyHeader>
          <EmptyTitle>Choisissez 2 à 4 biens</EmptyTitle>
          <EmptyDescription>Dans le dossier d'un bien, « Comparer » l'ajoute ici. {ls.length === 1 ? "Un bien est déjà choisi." : ""}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  const pois = Array.isArray(data.area.pois) ? data.area.pois : []
  const rows: [string, (l: Listing) => React.ReactNode][] = [
    ["Score", l => { const v = score(l, aidsFor(l)).value; return v == null ? "—" : <b className="tabular-nums">{v} / 100</b> }],
    ["Type", l => <span className="flex items-center gap-1.5"><TypeIcon type={l.property_type} className="size-4" />{TYPE_LABEL[l.property_type ?? "flat"]}</span>],
    ["Prix", l => <b>{eur(l.price)}</b>],
    ["Surface, pièces", l => [l.area && `${l.area} m²`, l.land_area && `terrain ${l.land_area} m²`, l.rooms && `${l.rooms} p.`].filter(Boolean).join(" · ") || "—"],
    ["Prix unitaire", l => perUnit(unitPrice(l), typeOf(l) as PropertyType)],
    ["Marché", l => <Gap ppm2={unitPrice(l)} refPpm2={marketFor(l).ref?.ppm2} long />],
    ["Négociation", l => { const n = negotiation(l, marketFor(l).ref?.ppm2); return n ? `${share(n.low)} à ${share(n.high)}` : "—" }],
    ["En ligne", l => `${daysOnline(l) ?? "—"} j${l.urgent ? " · urgent" : ""}`],
    ["DPE", l => <Dpe value={l.dpe?.energy} />],
    ["Étage", l => (l.floor == null ? "—" : l.floor === 0 ? "RDC" : `${l.floor}ᵉ${l.features.elevator ? ", ascenseur" : l.features.elevator === false ? ", sans ascenseur" : ""}`)],
    ["Extérieur", l => [l.features.balcony && "balcon", l.features.terrace && "terrasse", l.features.garden && "jardin"].filter(Boolean).join(", ") || "—"],
    ["Charges", l => (l.fees.condo_yearly ? `${eur(Math.round(l.fees.condo_yearly / 12))}/mois` : "—")],
    ["Coût total", l => eur(budget(l, profile).total)],
    ["Mensualité", l => eur(budget(l, profile).monthly)],
    ["Endettement", l => { const d = budget(l, profile).debt_ratio; return d == null ? "—" : share(d, 1) }],
    ["Transports à 500 m", l => num(nearby(l.location.point, pois).transport?.count ?? 0)],
    ["Commerces à 500 m", l => num(nearby(l.location.point, pois).shops?.count ?? 0)],
    ["Mon statut", l => (l.my_status ? <StatusBadge status={l.my_status} /> : "À trier")],
  ]
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Comparer {ls.length} biens</h2>
        <Button variant="outline" size="sm" onClick={() => { addFeedback({ kind: "comparer", text: ls.map(l => l.id).join(", ") }); toast.success("Ajouté au prompt pour Claude") }}>
          <MessageSquarePlusIcon data-icon="inline-start" />Comparer avec Claude
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              {ls.map(l => (
                <TableHead key={l.id} className="min-w-44">
                  <span className="flex items-center justify-between gap-2">
                    <button type="button" className="truncate text-left font-semibold hover:underline" onClick={() => select(l.id)}>{titleOf(l)}</button>
                    <Button variant="ghost" size="icon-xs" aria-label="Retirer du comparateur" onClick={() => toggleCompare(l.id)}><XIcon /></Button>
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([label, cell]) => (
              <TableRow key={label}><TableCell className="text-muted-foreground">{label}</TableCell>{ls.map(l => <TableCell key={l.id}>{cell(l)}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
