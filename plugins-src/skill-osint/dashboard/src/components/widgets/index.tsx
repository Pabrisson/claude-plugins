import type { ReactElement } from "react"

import { CalibrationWidget } from "@/components/widgets/calibration"
import { EvidenceWidget } from "@/components/widgets/evidence"
import { MapWidget } from "@/components/widgets/map"
import { Hypotheses } from "@/components/widgets/hypotheses"
import { Sources } from "@/components/widgets/sources"
import { TableWidget } from "@/components/widgets/table"
import { Timeline } from "@/components/widgets/timeline"
import type { CaseIndex, Manifest, View } from "@/lib/api"

export type WidgetProps = { slug: string; index: CaseIndex; view: View & { view?: string }; manifest: Manifest; pulse: number }
// the widgets a type's views may name (spec § 3.4); map, evidence and calibration come with geolocate-image
export const WIDGETS: Record<string, (p: WidgetProps) => ReactElement> = {
  evidence: p => <EvidenceWidget index={p.index} manifest={p.manifest} pulse={p.pulse} />,
  calibration: p => <CalibrationWidget index={p.index} pulse={p.pulse} />,
  map: p => <MapWidget index={p.index} pulse={p.pulse} />,
  hypotheses: p => <Hypotheses index={p.index} manifest={p.manifest} />,
  sources: p => <Sources index={p.index} />,
  timeline: p => <Timeline index={p.index} pulse={p.pulse} />,
  table: p => <TableWidget index={p.index} view={p.view} pulse={p.pulse} />,
}
export function Widget(p: WidgetProps) {
  const W = WIDGETS[p.view.widget]
  return W ? <W {...p} /> : <p className="py-10 text-center text-sm text-muted-foreground">This widget ({p.view.widget}) comes with a later version of the dashboard.</p>
}
