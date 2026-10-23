import { useState } from "react"
import { CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"

// The prompt sent to Claude, shown before copying; it can be edited first. ⌘↵ copies.
export function PromptDialog({
  prompt,
  count,
  onCopy,
  onClose,
}: {
  prompt: string | null
  count: number
  onCopy: (text: string) => void
  onClose: () => void
}) {
  // edits are local: reopening the dialog rebuilds the prompt from the feedback
  const [edited, setEdited] = useState<{ from: string; text: string } | null>(null)
  const text = edited?.from === prompt ? edited.text : (prompt ?? "")

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-4 sm:max-w-3xl"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onCopy(text)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Prompt for Claude</DialogTitle>
          <DialogDescription>
            {count} change{count > 1 ? "s" : ""} to apply. Review, edit if needed, copy, then paste it into Claude.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          spellCheck={false}
          className="max-h-[60svh] min-h-48 font-mono text-xs leading-relaxed md:text-xs"
          onChange={(e) => setEdited({ from: prompt ?? "", text: e.target.value })}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => onCopy(text)}>
            <CopyIcon data-icon="inline-start" />
            Copy <Kbd>⌘↵</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
