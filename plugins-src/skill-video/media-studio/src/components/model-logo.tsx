import { cn } from "cn"

import alibaba from "@lobehub/icons-static-svg/icons/alibaba-color.svg?raw"
import assemblyai from "@lobehub/icons-static-svg/icons/assemblyai-color.svg?raw"
import bfl from "@lobehub/icons-static-svg/icons/bfl.svg?raw"
import bytedance from "@lobehub/icons-static-svg/icons/bytedance-color.svg?raw"
import elevenlabs from "@lobehub/icons-static-svg/icons/elevenlabs.svg?raw"
import fishaudio from "@lobehub/icons-static-svg/icons/fishaudio.svg?raw"
import google from "@lobehub/icons-static-svg/icons/google-color.svg?raw"
import kling from "@lobehub/icons-static-svg/icons/kling-color.svg?raw"
import krea from "@lobehub/icons-static-svg/icons/krea.svg?raw"
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?raw"
import microsoft from "@lobehub/icons-static-svg/icons/microsoft-color.svg?raw"
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg?raw"
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw"
import openai from "@lobehub/icons-static-svg/icons/openai.svg?raw"
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw"
import recraft from "@lobehub/icons-static-svg/icons/recraft.svg?raw"
import runway from "@lobehub/icons-static-svg/icons/runway.svg?raw"
import tencent from "@lobehub/icons-static-svg/icons/tencent-color.svg?raw"
import xai from "@lobehub/icons-static-svg/icons/xai.svg?raw"

// the labs' marks (LobeHub's icons, MIT), by the model id's prefix; the one-color ones take the text's color
const LOGOS: Record<string, string> = {
  alibaba, assemblyai, "black-forest-labs": bfl, bytedance, "bytedance-seed": bytedance, elevenlabs, "fish-audio": fishaudio, google,
  kwaivgi: kling, krea, meta, microsoft, minimax, mistralai: mistral, openai, qwen, recraft, runway, tencent, "x-ai": xai,
}

// a lab without a mark: its initials (HeyGen HG, Canopy Labs CL, Sourceful S) on a hue of its own
const initials = (lab: string) => {
  const words = lab.split(/\s+/).filter(Boolean)
  if (words.length > 1) return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase()
  const caps = lab.match(/[A-Z]/g) ?? []
  return caps.length > 1 ? caps.slice(0, 2).join("") : lab[0].toUpperCase()
}
const hue = (lab: string) => [...lab].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

export function ModelLogo({ model, lab, className }: { model: string; lab?: string; className?: string }) {
  const prefix = model.split("/")[0], svg = LOGOS[prefix]
  if (svg)
    return (
      <span
        aria-hidden
        className={cn("grid size-7 shrink-0 place-items-center rounded-md bg-muted p-1.5 text-foreground [&>svg]:size-full", className)}
        // our own bundled files, not user content
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  const name = lab || prefix
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold text-white", className)} style={{ background: `oklch(0.55 0.13 ${hue(name)})` }}>
      {initials(name)}
    </span>
  )
}
