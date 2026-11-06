import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { formatPrompt } from "@engine/prompt.js"

import { t } from "@/lib/i18n"

export type Item = { tag: string; text: string }
export type Scope = { slug: string } | { all: true }
type Basket = { items: Item[]; scope: Scope; add: (i: Item) => void; remove: (i: number) => void; clear: () => void; copy: () => Promise<void> }
const Ctx = createContext<Basket | null>(null)
export const keyOf = (s: Scope) => `osint-basket:${"slug" in s ? s.slug : "all"}`
const load = (s: Scope): Item[] => { try { return JSON.parse(localStorage.getItem(keyOf(s)) ?? "[]") } catch { return [] } }
// a case's basket from another page (the home page's Refresh hands the agent steps to that case's basket)
export function addToStored(scope: Scope, items: Item[]) {
  const xs = load(scope)
  for (const i of items) if (!xs.some(x => x.tag === i.tag && x.text === i.text)) xs.push(i)
  try { localStorage.setItem(keyOf(scope), JSON.stringify(xs)) } catch { /* private window: lost */ }
}

// the prompt items picked on a page (next actions, pivots, a question, pasted results), kept per case in this browser
export function BasketProvider({ scope, children }: { scope: Scope; children: ReactNode }) {
  const key = keyOf(scope)
  const [state, setState] = useState(() => ({ key, items: load(scope) }))
  // another case's page: its own basket (set while rendering, so no frame shows the other one)
  if (state.key !== key) setState({ key, items: load(scope) })
  const items = state.items
  useEffect(() => { try { localStorage.setItem(state.key, JSON.stringify(state.items)) } catch { /* private window: kept in memory only */ } }, [state])
  const setItems = useCallback((f: (xs: Item[]) => Item[]) => setState(s => ({ ...s, items: f(s.items) })), [])
  const add = useCallback((i: Item) => setItems(xs => (xs.some(x => x.tag === i.tag && x.text === i.text) ? xs : [...xs, i])), [setItems])
  const remove = useCallback((n: number) => setItems(xs => xs.filter((_, i) => i !== n)), [setItems])
  const clear = useCallback(() => setItems(() => []), [setItems])
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(formatPrompt(scope, items))
    toast.success(t("Prompt copied: paste it to the agent"))
    setItems(() => [])
  }, [scope, items, setItems])
  const value = useMemo(() => ({ items, scope, add, remove, clear, copy }), [items, scope, add, remove, clear, copy])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export const useBasket = () => { const b = useContext(Ctx); if (!b) throw new Error("useBasket outside BasketProvider"); return b }
// a sub-case's item in its investigation's prompt ends with « (case <slug>) »: the agent does it in that case
export const inCase = (i: Item, slug: string): Item => (/\(case [a-z0-9-]+\)$/.test(i.text) ? i : { ...i, text: `${i.text} (case ${slug})` })
// what is shown of a sub-case (its note, its view, its next actions) adds to the page's prompt marked with its case
export function CaseScope({ slug, children }: { slug: string | null; children: ReactNode }) {
  const b = useBasket()
  const value = useMemo(() => (slug ? { ...b, add: (i: Item) => b.add(inCase(i, slug)) } : b), [b, slug])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
