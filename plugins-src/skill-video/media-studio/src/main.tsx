import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"

// one sound at a time: a sound (or a video with its sound) that starts pauses the others; muted previews play on, and
// the timeline's clips (data-together) play together
document.addEventListener(
  "play",
  (e) => {
    const on = e.target as HTMLMediaElement, group = on.dataset?.together
    if (on.muted) return
    for (const m of document.querySelectorAll<HTMLMediaElement>("audio, video"))
      if (m !== on && !m.muted && !m.paused && !(group && m.dataset.together === group)) m.pause()
  },
  true
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
