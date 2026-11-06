import { formatPrompt } from "@engine/prompt.js"
import { CopyIcon, MessageSquareTextIcon, Trash2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { useBasket } from "@/lib/basket"
import { t } from "@/lib/i18n"

// The prompt being built, bottom right on every page: its items (each removable), the text the agent will read,
// « Copy prompt » (which empties it) and « Clear». Hidden while empty.
export function BasketBar() {
  const { items, scope, remove, clear, copy } = useBasket()
  if (!items.length) return null
  const text = formatPrompt(scope, items), n = t(items.length > 1 ? "{n} items" : "{n} item", { n: items.length })
  return (
    <div className="fixed right-4 bottom-4 z-40">
      <Popover>
        <PopoverTrigger asChild>
          <Button size="lg" className="rounded-full shadow-lg" aria-label={t("Prompt for the agent: {items}", { items: n })}>
            <MessageSquareTextIcon data-icon="inline-start" />{t("Prompt")}<span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums" role="status" aria-atomic="true">{items.length}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-[min(32rem,calc(100vw-2rem))]">
          <PopoverHeader>
            <PopoverTitle>{t("Prompt for the agent")}</PopoverTitle>
            <PopoverDescription>{t("Copy it, then paste it to the agent: it does each item in order.")}</PopoverDescription>
          </PopoverHeader>
          <ol className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
            {items.map((it, i) => (
              <li key={`${it.tag}|${it.text}`} className="flex items-start gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 break-words"><span className="font-mono text-xs text-muted-foreground">[{it.tag}]</span> {it.text}</span>
                <Button variant="ghost" size="icon-xs" aria-label={t("Remove item {n}", { n: i + 1 })} onClick={() => remove(i)}><XIcon /></Button>
              </li>
            ))}
          </ol>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap" aria-label={t("Prompt preview")}>{text}</pre>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={clear}><Trash2Icon data-icon="inline-start" />{t("Clear")}</Button>
            <Button onClick={copy}><CopyIcon data-icon="inline-start" />{t("Copy prompt")}</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
