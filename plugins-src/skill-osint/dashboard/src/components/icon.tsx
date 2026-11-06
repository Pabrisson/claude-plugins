import * as lucide from "lucide-react"
import type { ComponentType } from "react"

// a lucide icon by its kebab-case name (the manifests' "icon", KINDS); the module's exports carry the aliases too
// (history, building-2…), which its `icons` map lacks; a circle when the name is unknown
const all = lucide as unknown as Record<string, ComponentType<lucide.LucideProps>>
const pascal = (s: string) => s.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())
export function Icon({ name, ...props }: { name: string } & lucide.LucideProps) {
  const C = all[pascal(name)] ?? lucide.Circle
  return <C {...props} />
}
