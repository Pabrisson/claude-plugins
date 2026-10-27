import { BuildingIcon, HouseIcon, LandPlotIcon, SquareParkingIcon, StoreIcon, type LucideProps } from "lucide-react"

import type { PropertyType } from "@/lib/api"
import { TYPE_LABEL } from "@/lib/format"

export const TYPE_ICON = { flat: BuildingIcon, house: HouseIcon, land: LandPlotIcon, parking: SquareParkingIcon, premises: StoreIcon } as const

// the icon of a type of property, named for screen readers
export function TypeIcon({ type, ...props }: { type?: PropertyType } & LucideProps) {
  const Icon = TYPE_ICON[type ?? "flat"]
  return <Icon role="img" aria-label={TYPE_LABEL[type ?? "flat"]} {...props} />
}
