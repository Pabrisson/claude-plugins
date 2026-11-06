// the few hues the interface itself uses (statuses, confidence, warnings), each readable in light and dark;
// the data's own colors (case types, entity kinds) live in lib/colors.ts and KINDS
export const TONE = {
  neutral: "bg-muted text-muted-foreground",
  sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
} as const
export type Tone = keyof typeof TONE
